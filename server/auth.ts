import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import "@fastify/cookie"; // loads the type augmentation for reply.setCookie / req.cookies / req.unsignCookie
import crypto from "node:crypto";
import { upsertAuthUser, getAuthUserMeta, getHackatimeToken, syncBanFromTrust } from "./db.ts";
import { fetchHackatimeTrustLevel } from "./hackatime-api.ts";

const ISSUER = 'https://auth.hackclub.com';
const AUTHORIZE_URL = `${ISSUER}/oauth/authorize`;
const TOKEN_URL = `${ISSUER}/oauth/token`;
const USERINFO_URL = `${ISSUER}/oauth/userinfo`;

// `openid` is required for the /oauth/userinfo endpoint to accept the access token.
// The provider strictly validates scopes: one un-grantable scope fails the whole
// authorize call. Per the HC OAuth guide, community apps may request
// `openid profile email name slack_id verification_status` (this app also has phone +
// address enabled). `ysws_eligible` is NOT a requestable scope — it's a claim returned
// with verification_status and only populated once the account is YSWS-verified.
const SCOPES = 'openid profile email slack_id phone address verification_status birthdate';

const STATE_COOKIE = 'hc_oauth_state';
const SESSION_COOKIE = 'hc_session';
const isProd = process.env.NODE_ENV === 'production';

export const ROLES = ['user', 'reviewer', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export type HcUser = {
    sub: string;
    name?: string;
    given_name?: string;
    family_name?: string;
    email?: string;
    email_verified?: boolean;
    verification_status?: string;
    ysws_eligible?: boolean;
    slack_id?: string;
    slack_username?: string;
    preferred_username?: string;
    phone_number?: string;
    phone_number_verified?: boolean;
    birthdate?: string;
    address?: {
        formatted?: string;
        street_address?: string;
        locality?: string;
        region?: string;
        postal_code?: string;
        country?: string;
    };
}

export default async function authRoutes(app: FastifyInstance) {
    app.get('/api/auth/login', async (_req, reply) => {
        const state = crypto.randomBytes(16).toString('hex');

        reply.setCookie(STATE_COOKIE, state, {
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            secure: isProd,
            signed: true,
            maxAge: 5 * 60, // 5 minutes (maxAge is in SECONDS)
        })

        const url = new URL(AUTHORIZE_URL);
        url.searchParams.set('client_id', process.env.HC_CLIENT_ID!)
        url.searchParams.set('redirect_uri', process.env.HC_REDIRECT_URI!)
        url.searchParams.set('response_type', 'code')
        url.searchParams.set('scope', SCOPES)
        url.searchParams.set('state', state)

        return reply.redirect(url.toString());
    })

    app.get('/api/auth/callback', async (req, reply) => {
        const { code, state } = req.query as { code?: string; state?: string };

        const signed = req.cookies[STATE_COOKIE];
        const expected = signed ? req.unsignCookie(signed) : null;

        if (!code || !state || !expected || expected.value !== state) {
            return reply.code(400).send({ error: 'Invalid request' });
        }

        try {
            const tokenRes =  await fetch(TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: process.env.HC_REDIRECT_URI!,
                    client_id: process.env.HC_CLIENT_ID!,
                    client_secret: process.env.HC_CLIENT_SECRET!,
                }),
            })
            if (!tokenRes.ok) {
                req.log.error({ status: tokenRes.status, body: await tokenRes.text() }, 'token exchange failed')
                return reply.code(502).send({ error: 'Token exchange failed' })
            }

            const tokens = (await tokenRes.json()) as { access_token: string; scope?: string; id_token?: string }
            req.log.info({ grantedScope: tokens.scope }, 'token granted scopes') // DEBUG

                        const userRes = await fetch(USERINFO_URL, {
                headers: { 'Authorization': `Bearer ${tokens.access_token}` },
            })
            if (!userRes.ok) {
                req.log.error({ status: userRes.status, body: await userRes.text() }, 'user info fetch failed')
                return reply.code(502).send({ error: 'User info fetch failed' })
            }
            const user = (await userRes.json()) as HcUser;
            req.log.info({ userinfoKeys: Object.keys(user) }, 'userinfo response') // DEBUG (keys only — no PII values in logs)

            // A session without its auth_users row breaks identity, roles, pitches,
            // and payouts. Treat persistence as part of login instead of hiding errors.
            await upsertAuthUser(user)

            reply.setCookie(SESSION_COOKIE, JSON.stringify(user), {
                path: '/',
                httpOnly: true,
                sameSite: 'lax',
                secure: isProd,
                signed: true,
                maxAge: 7 * 24 * 60 * 60, // 7 days (maxAge is in SECONDS)
            })

            // Immediately chain into Hackatime linking after a fresh Hack Club login,
            // unless this user has already connected their Hackatime account.
            const hackatimeToken = await getHackatimeToken(user.sub);
            if (!hackatimeToken) {
                return reply.redirect('/api/hackatime/login');
            }

            // Re-evaluate Hackatime trust on every login so a recovered account
            // regains access and a newly-flagged (red) account gets banned.
            const trust = await fetchHackatimeTrustLevel(hackatimeToken);
            await syncBanFromTrust(user.sub, trust);

            return reply.redirect(process.env.FRONTEND_URL || '/');
        } catch (err) {
            req.log.error(err, 'auth callback error')
            return reply.code(500).send({ error: 'Auth FAILED' })
        }
    })

    app.get('/api/auth/me', async (req, reply) => {
        const user = getSessionUser(req);
        if (!user) {
            return reply.code(401).send({ error: 'Not authenticated' });
        }
        const meta = await getAuthUserMeta(user.sub);
        const role = isAdmin(user) ? 'admin' : meta.role;
        return { ...user, role, banned: meta.banned, tokens: meta.tokens };
    })

    app.post('/api/auth/logout', async (_req, reply) => {
        reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return  { ok : true };
    })
}

// --- Shared session / admin helpers (used by the admin routes) ---

/** Parse and verify the signed session cookie, returning the user or null. */
export function getSessionUser(req: FastifyRequest): HcUser | null {
    const raw = req.cookies[SESSION_COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : null;
    if (!unsigned?.valid || !unsigned.value) return null;
    try {
        return JSON.parse(unsigned.value) as HcUser;
    } catch {
        return null;
    }
}

export function requireRole(...allowed: Role[]) {
    return async (req: FastifyRequest, reply: FastifyReply) => {
        const user = getSessionUser(req);
        if (!user) return reply.code(401).send({ error: 'Not authenticated' });
        if(isAdmin(user)) return; // admins can do anything
        const meta = await getAuthUserMeta(user.sub);
        if (meta.banned) return reply.code(403).send({ error: 'banned' });
        if (meta.role  === 'admin') return; // admins can do anything
        if (!allowed.includes(meta.role as Role)) {
            return reply.code(403).send({ error: 'Forbidden' });
        }
    };
}


const ADMIN_SLACK_IDS = (process.env.ADMIN_SLACK_IDS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Admin access is granted by matching the signed-in user's slack_id or email
 *  against the ADMIN_SLACK_IDS / ADMIN_EMAILS env allow-lists. */
export function isAdmin(user: HcUser | null): boolean {
    if (!user) return false;
    if (user.slack_id && ADMIN_SLACK_IDS.includes(user.slack_id)) return true;
    if (user.email && ADMIN_EMAILS.includes(user.email.toLowerCase())) return true;
    return false;
}

