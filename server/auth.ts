import type { FastifyInstance } from "fastify";
import "@fastify/cookie"; // loads the type augmentation for reply.setCookie / req.cookies / req.unsignCookie
import crypto from "node:crypto";

const ISSUER = 'https://auth.hackclub.com';
const AUTHORIZE_URL = `${ISSUER}/oauth/authorize`;
const TOKEN_URL = `${ISSUER}/oauth/token`;
const USERINFO_URL = `${ISSUER}/oauth/userinfo`;

const SCOPES = 'openid profile email verification_status';

const STATE_COOKIE = 'hc_oauth_state';
const SESSION_COOKIE = 'hc_session';
const isProd = process.env.NODE_ENV === 'production';

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

            const tokens = (await tokenRes.json()) as { access_token: string }

            const userRes = await fetch(USERINFO_URL, {
                headers: { 'Authorization': `Bearer ${tokens.access_token}` },
            })
            if (!userRes.ok) {
                req.log.error({ status: userRes.status, body: await userRes.text() }, 'user info fetch failed')
                return reply.code(502).send({ error: 'User info fetch failed' })
            }
            const user = (await userRes.json()) as HcUser;

            reply.setCookie(SESSION_COOKIE, JSON.stringify(user), {
                path: '/',
                httpOnly: true,
                sameSite: 'lax',
                secure: isProd,
                signed: true,
                maxAge: 7 * 24 * 60 * 60, // 7 days (maxAge is in SECONDS)
            })

            return reply.redirect(process.env.FRONTEND_URL || '/');
        } catch (err) {
            req.log.error(err, 'auth callback error')
            return reply.code(500).send({ error: 'Auth FAILED' })
        }
    })

    app.get('/api/auth/me', async (req, reply) => {
        const raw = req.cookies[SESSION_COOKIE];
        const unsigned = raw ? req.unsignCookie(raw) : null;
        if (!unsigned?.valid || !unsigned.value) {
            return reply.code(401).send({ error: 'Not authenticated' });
        }
        try {
            return JSON.parse(unsigned.value) as HcUser;
        }
        catch {
            return reply.code(401).send({ error: 'Bad Session' });
        }
    })

    app.post('/api/auth/logout', async (_req, reply) => {
        reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return  { ok : true };
    })
}

