import type { FastifyInstance } from 'fastify';
import "@fastify/cookie"; // loads the type augmentation for reply.setCookie / req.cookies / req.unsignCookie
import crypto from "node:crypto";
import { getSessionUser } from "./auth.ts";
import { setHackatimeToken, getHackatimeToken, syncBanFromTrust } from "./db.ts";
import { fetchHackatimeTrustLevel } from "./hackatime-api.ts";

const BASE =  process.env.HACKATIME_BASE_URL ?? 'https://hackatime.hackclub.com';
const AUTHORIZE_URL = `${BASE}/oauth/authorize`;
const TOKEN_URL = `${BASE}/oauth/token`;
const PROJECTS_URL = `${BASE}/api/v1/authenticated/projects`;
// The /api/v1/authenticated/* data endpoints (projects, hours) require the
// `profile` scope — `read` alone gets a 403 "insufficient_scope". Request both.
const SCOPES = process.env.HACKATIME_SCOPES || "read profile";

const STATE_COOKIE = 'hackatime_oauth_state';

const isProd = process.env.NODE_ENV === 'production';

async function fetchHackatimeProjects(accessToken: string) {
    const res = await fetch(PROJECTS_URL, {
        headers: {
            'Authorization': `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch Hackatime projects: ${res.status} ${res.statusText}`);
    return res.json();
}

export default async function hackatimeRoutes(app: FastifyInstance) {
    app.get('/api/hackatime/login', async (req, reply) => {
        const user = getSessionUser(req);
        if (!user) return reply.status(401).send({ error: 'Unauthorized' });

        const state = crypto.randomBytes(16).toString('hex');
        reply.setCookie(STATE_COOKIE, state, {
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            secure: isProd,
            signed: true,
            maxAge: 5 * 60, // 5 minutes (maxAge is in SECONDS)
        });

        const url = new URL(AUTHORIZE_URL);
        url.searchParams.set('client_id', process.env.HACKATIME_CLIENT_ID!);
        url.searchParams.set('redirect_uri', process.env.HACKATIME_REDIRECT_URI!);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('scope', SCOPES);
        url.searchParams.set('state', state);
        return reply.redirect(url.toString());
    });

    app.get('/api/auth/hackatime/callback', async (req, reply) => {
        const user = getSessionUser(req);
        if (!user) return reply.status(401).send({ error: 'Unauthorized' });

        const { code, state } = req.query as { code?: string; state?: string };
        const signed = req.cookies[STATE_COOKIE];
        const expected = signed ? req.unsignCookie(signed) : null;
        if (!code || !state || !expected || expected.value !== state) {
            return reply.code(400).send({ error: 'Invalid request' });
        }

        try {
            const tokenRes = await fetch(TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body : new URLSearchParams({
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: process.env.HACKATIME_REDIRECT_URI!,
                    client_id: process.env.HACKATIME_CLIENT_ID!,
                    client_secret: process.env.HACKATIME_CLIENT_SECRET!,
                }),
            });
            if (!tokenRes.ok) {
                req.log.error({ status: tokenRes.status, body: await tokenRes.text() }, 'Hackatime token exchange failed');
                return reply.code(502).send({ error: 'Hackatime token exchange failed' });
            }
            
             const tok = (await tokenRes.json()) as {
                access_token: string; expires_in?: number; scope?: string;
            };

            await setHackatimeToken(user.sub, tok.access_token);

            // Gate access on Hackatime trust: red → banned, recovered → unbanned.
            const trust = await fetchHackatimeTrustLevel(tok.access_token);
            await syncBanFromTrust(user.sub, trust);

            reply.clearCookie(STATE_COOKIE, { path: '/' });
            return reply.redirect(process.env.FRONTEND_URL || "/");
            }   catch (err) {
            req.log.error({ err }, 'Hackatime callback error');
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });

    app.get('/api/hackatime/projects', async (req, reply) => {
        const user = getSessionUser(req);
        if (!user) return reply.status(401).send({ error: 'Unauthorized' });

        const token = await getHackatimeToken(user.sub);
        if (!token) return reply.status(404).send({ error: 'Hackatime token not found' });

        try {
            return await fetchHackatimeProjects(token);
        } catch (err) {
            req.log.error({ err }, 'Failed to fetch Hackatime projects');
            return reply.code(502).send({ error: 'Failed to fetch Hackatime projects' });
        }
    });
}