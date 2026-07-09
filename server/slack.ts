import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { HcUser } from './auth.ts';
import type { Row } from './db.ts';

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const REVIEW_CHANNEL = process.env.SLACK_REVIEW_CHANNEL;
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? '';

export async function notifySlackOfNewSubmission(user: HcUser, row: Row): Promise<void> {
    if (!SLACK_TOKEN || !REVIEW_CHANNEL) return;
    const blocks = [
        { type: "header", text: { type: "plain_text", text: "🚀 New Omega submission" } },
        { type: "section", fields: [
            { type: "mrkdwn", text: `*Project:*\n${row.title}` },
            { type: "mrkdwn", text: `*By:*\n${row.first_name} ${row.last_name}` },
            { type: "mrkdwn", text: `*Code:*\n${row.code_url || "—"}` },
            { type: "mrkdwn", text: `*Playable:*\n${row.playable_url || "—"}` },
        ] },
        { type: "section", text: { type: "mrkdwn", text: `*Description:*\n${String(row.description ?? "").slice(0, 2900)}` } },
        { type: "actions", block_id: `submission:${row.id}`, elements: [
            { type: "button", style: "primary", text: { type: "plain_text", text: "✅ Approve" }, value: row.id, action_id: "approve_submission" },
            { type: "button", style: "danger",  text: { type: "plain_text", text: "❌ Reject"  }, value: row.id, action_id: "reject_submission" },
        ] },
    ];
    const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${SLACK_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ channel: REVIEW_CHANNEL, text: `New Omega submission by ${user.name ?? user.sub}`, blocks }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    if (!data.ok) throw new Error(`Failed to notify Slack: ${data.error}`);
}

export function verifySlackSignature(req: FastifyRequest & { rawBody?: string }): boolean {
    const ts = req.headers['x-slack-request-timestamp'] as string | undefined;
    const sig = req.headers['x-slack-signature'] as string | undefined;
    if (!ts || !sig || !req.rawBody) return false;
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 60 * 5) return false; // older than 5 minutes
    const mine = "v0=" + crypto.createHmac("sha256", SIGNING_SECRET).update(`v0:${ts}:${req.rawBody}`).digest("hex");
    try { return crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(sig)); } catch { return false; }
}
