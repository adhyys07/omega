import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { HcUser } from './auth.ts';
import { getSlackIdForSub, type Row } from './db.ts';

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const REVIEW_CHANNEL = process.env.SLACK_REVIEW_CHANNEL;
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? '';
const FRONTEND_URL = process.env.FRONTEND_URL ?? '';

/** Slack user ids allowed to act on submissions (reuse the admin allowlist). */
const REVIEWER_IDS = new Set(
    (process.env.ADMIN_SLACK_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
);

export function isReviewer(slackUserId?: string): boolean {
    return !!slackUserId && REVIEWER_IDS.has(slackUserId);
}

export type SubmissionState =
    | 'pending' | 'changes_requested' | 'approved' | 'rejected' | 'withdrawn';

export type Actor = { name: string; slackId?: string | null };


/** Thin wrapper over the Slack Web API that throws on `{ ok: false }`. */
async function slack<T = Record<string, unknown>>(method: string, body: unknown): Promise<T & { ok: boolean }> {
    const res = await fetch(`https://slack.com/api/${method}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${SLACK_TOKEN}`,
            'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(body),
    });
    const data = (await res.json()) as T & { ok: boolean; error?: string };
    if (!data.ok) throw new Error(`slack.${method} failed: ${data.error}`);
    return data;
}

const STATE_BANNER: Record<SubmissionState, string> = {
    // Never empty: this now always renders as a context block, and Slack rejects a
    // context element whose text is an empty string (invalid_blocks).
    pending: '⏳ *Awaiting review*',
    changes_requested: '✏️ *Changes requested*',
    approved: '✅ *Approved* — promoted to YSWS',
    rejected: '❌ *Rejected*',
    withdrawn: '🗑 *Withdrawn by the builder*',
};

async function slackGet<T = Record<string, unknown>>(
    method: string,
    params: Record<string, string>,
): Promise<T & { ok: boolean }> {
    const qs = new URLSearchParams(params);
    const res = await fetch(`https://slack.com/api/${method}?${qs}`, {
        headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
    });
    const data = (await res.json()) as T & { ok: boolean; error?: string };
    if (!data.ok) throw new Error(`slack.${method} failed: ${data.error}`);
    return data;
}

export type ThreadMessage = {
    ts: string;
    userId: string | null;
    author: string;
    avatar_url: string | null;
    text: string;
    isBot: boolean;
    isParent: boolean;
};

type SlackProfile = {
    handle: string;
    name: string;
    avatar_url: string | null;
};

const userProfileCache = new Map<string, SlackProfile>();
const BOT_ACTOR_PREFIX = /^<@([UW][A-Z0-9]+)>:\s*/;

async function slackProfile(userId: string): Promise<SlackProfile> {
    const hit = userProfileCache.get(userId);
    if (hit) return hit;
    try {
        const d = await slackGet<{ user?: { real_name?: string; name?: string; profile?: { image_48?: string } } }>('users.info', { user: userId });
        const profile: SlackProfile = {
            handle: d.user?.name ?? d.user?.real_name ?? userId,
            name: d.user?.real_name ?? d.user?.name ?? userId,
            avatar_url: d.user?.profile?.image_48 ?? null,
        };
        userProfileCache.set(userId, profile);
        return profile;
    } catch {
        return { handle: userId, name: userId, avatar_url: null };
    }
}

function stripActorPrefix(text: string): string {
    return text.replace(BOT_ACTOR_PREFIX, '');
}

export async function fetchThreadReplies(channel: string, ts: string): Promise<ThreadMessage[]> {
    if (!SLACK_TOKEN) return [];
    const data = await slackGet<{
        messages?: {
            ts: string;
            user?: string;
            text?: string;
            bot_id?: string;
            username?: string;
            icons?: { image_48?: string };
        }[];
    }>('conversations.replies', { channel, ts, limit: '100' });

    const msgs = data.messages ?? [];
    return Promise.all(
        msgs.map(async (m): Promise<ThreadMessage> => {
            const text = m.text ?? '';

            // User-authored replies: resolve display name + avatar from Slack profile.
            if (!m.bot_id && m.user) {
                const p = await slackProfile(m.user);
                return {
                    ts: m.ts,
                    userId: m.user,
                    author: p.name,
                    avatar_url: p.avatar_url,
                    text,
                    isBot: false,
                    isParent: m.ts === ts,
                };
            }

            // Bot-authored reviewer message; payload starts with "<@U...>:".
            const actorId = text.match(BOT_ACTOR_PREFIX)?.[1];
            if (actorId) {
                const p = await slackProfile(actorId);
                return {
                    ts: m.ts,
                    userId: actorId,
                    author: p.name,
                    avatar_url: p.avatar_url,
                    text: stripActorPrefix(text),
                    isBot: true,
                    isParent: m.ts === ts,
                };
            }

            // Generic bot/system message fallback.
            return {
                ts: m.ts,
                userId: m.user ?? null,
                author: m.username ?? 'Omega bot',
                avatar_url: m.icons?.image_48 ?? null,
                text,
                isBot: !!m.bot_id,
                isParent: m.ts === ts,
            };
        }),
    );
}
/** A real Slack mention when we know who acted, a bold name when we don't.
 *  Must be synchronous: every call site interpolates it straight into a template
 *  string, and an async version would render as "[object Promise]".
 *  Takes the Slack USER ID (U…), not a handle — <@handle> does not resolve. */
export function mention(actor: Actor): string {
    return actor.slackId ? `<@${actor.slackId}>` : `*${actor.name}*`;
}

export async function postEphemeralInThread(
    channel: string, threadTs: string, slackUserId: string,
    blocks: unknown[], fallback: string,
): Promise<boolean> {
    if (!SLACK_TOKEN) return false;
    const res = await fetch(`https://slack.com/api/chat.postEphemeral`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${SLACK_TOKEN}`,
            'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
            channel,
            thread_ts: threadTs,
            user: slackUserId,
            text: fallback, blocks,
        }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    // Best-effort by design — never throw. The commonest failure is
    // `user_not_in_channel`: an ephemeral needs its recipient present in the channel.
    if (!json.ok) console.warn(`chat.postEphemeral failed: ${json.error ?? 'unknown'}`);
    return !!json.ok;
}

export function builderControlBlocks(kind: ReviewKind, row: Row, state: SubmissionState): unknown[] | null {
    const value = `${kind}:${row.id}`;
    const isPitch = kind === 'pitch';
    const edit = isPitch ? pitchEditLink(String(row.id)) : editLink(String(row.id));
    const elements: unknown[] = [];

    if (state === 'changes_requested'){
        elements.push({
            type: 'button',
            style: 'primary',
            text: { type: 'plain_text', text: 'Edit and reship' },
            url: edit, value, action_id: 'builder_reship',
        });
    } 

    if ( state === 'pending' || state === 'changes_requested') {
        elements.push({
            type: 'button',
            style: 'danger',
            text: { type: 'plain_text', text: 'Withdraw' },
            value, action_id: 'builder_withdraw',
            confirm: {
                title: { type: 'plain_text', text: 'Withdraw this?' },
                text: { type: 'plain_text', text: `Are you sure you want to withdraw this ${isPitch ? 'pitch' : 'submission'}?` },
                confirm: { type: 'plain_text', text: 'Yes, withdraw' },
                deny: { type: 'plain_text', text: 'Cancel' },
            },
        });
    }

    if (!elements.length) return null;
    return [
        {
            type: 'context',
             elements: [{
                type: 'mrkdwn',
                text: state === 'changes_requested'
                    ? '✏️ *A reviewer asked for changes.* Only you can see these buttons.'
                    : '⏳ *Awaiting review.* Only you can see these buttons.',
            }],
        },
            { type: 'actions', block_id: value, elements },
    ];
}

export async function postBuilderControls(
    kind: ReviewKind, row: Row, state: SubmissionState, slackUserId: string
): Promise<void> {
    const channel = String(row.slack_channel ?? '');
    const ts = String(row.slack_ts ?? '');
    if (!channel || !ts || !slackUserId) return;
    const blocks = builderControlBlocks(kind, row, state);
    if (!blocks) return;
    await postEphemeralInThread(channel, ts, slackUserId, blocks, 'Omega builder controls');
}

/** Replies to an interaction, visible only to the clicker, without touching the
 *  original message. Used to turn away anyone who isn't the builder. */
export async function respondEphemeral(responseUrl: string, text: string): Promise<void> {
    if (!responseUrl) return;
    await fetch(responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response_type: 'ephemeral', replace_original: false, text }),
    });
}

export async function respondEmpheral(respondUrl: string, text: string): Promise<void> {
    await fetch(respondUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, response_type: 'ephemeral', replace_original: false }),
    });
}

export async function postReviewerMessage(
    channel: string,
    ts: string,
    author: Actor,
    text: string,
): Promise<void> {
    if (!SLACK_TOKEN) return;
    const rendered = `${mention(author)}: ${text}`;

    // Prefer native actor attribution in Slack (name + avatar) when we know the
    // acting reviewer's Slack id. Requires chat:write.customize in the workspace.
    if (author.slackId) {
        const p = await slackProfile(author.slackId);
        try {
            await slack('chat.postMessage', {
                channel,
                thread_ts: ts,
                text: rendered,
                username: p.handle,
                ...(p.avatar_url ? { icon_url: p.avatar_url } : {}),
            });
            return;
        } catch {
            // Fall through to a standard bot post below when customization is not allowed.
        }
    }

    await slack('chat.postMessage', {
        channel,
        thread_ts: ts,
        text: rendered,
    });
}

/** The two things reviewers act on. A pitch is the idea; a project is the build. */
export type ReviewKind = 'project' | 'pitch';

/** Button values carry `kind:id` so one interactivity endpoint can route both.
 *  Cards posted before pitches existed carry a bare id — treat those as projects. */
export function parseActionValue(value: string): { kind: ReviewKind; id: string } {
    const i = value.indexOf(':');
    if (i === -1) return { kind: 'project', id: value };
    const kind = value.slice(0, i);
    return { kind: kind === 'pitch' ? 'pitch' : 'project', id: value.slice(i + 1) };
}

async function submitterMention(row: Row, user?: HcUser): Promise<string> {
    const fromSession = typeof user?.slack_id === 'string' ? user.slack_id : null;
    if (fromSession) return `<@${fromSession}>`;

    const sub = typeof row.user_sub === 'string' ? row.user_sub : user?.sub;
    if (sub) {
        const slackId = await getSlackIdForSub(sub).catch(() => null);
        if (slackId) return `<@${slackId}>`;
    }

    return '-';
}



/** The review card. Action buttons render only while the item is actionable. */
function reviewBlocks(kind: ReviewKind, row: Row, state: SubmissionState, byLine: string, actor?: string): unknown[] {
    const isPitch = kind === 'pitch';

    const blocks: unknown[] = [
        {
            type: 'header',
            text: { type: 'plain_text', text: isPitch ? '💡 Omega pitch' : '🚀 Omega submission' },
        },
        {
            type: 'section',
            fields: isPitch
                ? [
                    { type: 'mrkdwn', text: `*Idea:*\n${row.title ?? '—'}` },
                    { type: 'mrkdwn', text: `*By:*\n${`${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || '—'}` },
                    { type: 'mrkdwn', text: `*Submitter ID:*\n${row.user_sub ?? '—'}` },
                ]
                : [
                    { type: 'mrkdwn', text: `*Project:*\n${row.title ?? '—'}` },
                    { type: 'mrkdwn', text: `*By:*\n${byLine}` },
                    { type: 'mrkdwn', text: `*Submitter ID:*\n${row.user_sub ?? '—'}` },
                    { type: 'mrkdwn', text: `*Code:*\n${row.code_url || '—'}` },
                    { type: 'mrkdwn', text: `*Playable:*\n${row.playable_url || '—'}` },
                ],
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*${isPitch ? 'What they\'re building' : 'Description'}:*\n${String(row.description ?? '').slice(0, 2900)}`,
            },
        },
    ];

    if (isPitch && row.why) {
        blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: `*How it helps people:*\n${String(row.why).slice(0, 2900)}` },
        });
    }

    if (!isPitch && row.demo_video_url) {
        blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: `*Demo video:*\n${row.demo_video_url}` },
        });
    }

    // Decisions are made in the panel, never here. Slack renders one card for the
    // whole channel — there is no per-viewer visibility in Block Kit — so an in-card
    // Approve button is a button the builder can see on their own pitch. The panel is
    // reviewer-gated, so the card links there instead of acting.
    if (state === 'pending' || state === 'changes_requested') {
        blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: `<${panelLink(kind, String(row.id))}|⚖ *Review in panel* ↗>` },
        });
    }

    blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `${STATE_BANNER[state]}${actor ? ` by <@${actor}>` : ''}` }],
    });
    return blocks;
}

/** Deep link into the review panel, landing on this exact item. */
export function panelLink(kind: ReviewKind, id: string): string {
    const k = kind === 'pitch' ? 'pitches' : 'projects';
    return `${frontendUrl()}/admin/review?kind=${k}&id=${encodeURIComponent(id)}`;
}

/** Posts a review card as a new top-level message. Returns the coordinates
 *  needed to edit it or reply in its thread later, or null if Slack is unconfigured. */
export async function notifySlackOfNewReview(
    kind: ReviewKind,
    user: HcUser,
    row: Row,
): Promise<{ channel: string; ts: string } | null> {
    if (!SLACK_TOKEN || !REVIEW_CHANNEL) return null;
    const label = kind === 'pitch' ? 'pitch' : 'submission';
    const byLine = await submitterMention(row, user);
    const data = await slack<{ channel: string; ts: string }>('chat.postMessage', {
        channel: REVIEW_CHANNEL,
        text: `New Omega ${label} by ${byLine}`,
        blocks: reviewBlocks(kind, row, 'pending', byLine),
    });
    return { channel: data.channel, ts: data.ts };
}

/** Back-compat wrapper — project submissions. */
export async function notifySlackOfNewSubmission(
    user: HcUser,
    row: Row,
): Promise<{ channel: string; ts: string } | null> {
    return notifySlackOfNewReview('project', user, row);
}

/** Rewrites an existing review card in place to reflect a new state. */
export async function updateReviewCard(
    kind: ReviewKind,
    channel: string,
    ts: string,
    row: Row,
    state: SubmissionState,
    actor?: string,
): Promise<void> {
    if (!SLACK_TOKEN) return;
    const byLine = await submitterMention(row);
    await slack('chat.update', {
        channel,
        ts,
        text: `${kind === 'pitch' ? 'Pitch' : 'Submission'} ${state}`,
        blocks: reviewBlocks(kind, row, state, byLine, actor),
    });
}

/** Back-compat wrapper — project submissions. */
export async function updateSubmissionCard(
    channel: string,
    ts: string,
    row: Row,
    state: SubmissionState,
    actor?: string,
): Promise<void> {
    return updateReviewCard('project', channel, ts, row, state, actor);
}

/** Replies in the review message's thread. */
export async function postInThread(channel: string, ts: string, text: string): Promise<void> {
    if (!SLACK_TOKEN) return;
    await slack('chat.postMessage', { channel, thread_ts: ts, text });
}

/** DMs a user. Passing a user id as `channel` makes Slack open the IM implicitly. */
export async function dmUser(slackUserId: string, text: string): Promise<void> {
    if (!SLACK_TOKEN || !slackUserId) return;
    await slack('chat.postMessage', { channel: slackUserId, text });
}

export function editLink(submissionId: string): string {
    return `${FRONTEND_URL}/submit?edit=${encodeURIComponent(submissionId)}`;
}

export function pitchEditLink(pitchId: string): string {
    return `${FRONTEND_URL}/pitch?edit=${encodeURIComponent(pitchId)}`;
}

/** Where the frontend lives — used to link builders back into the app. */
export function frontendUrl(): string {
    return FRONTEND_URL;
}

/** Opens the "request changes" feedback modal. trigger_id is valid for ~3s, so
 *  this must be called before acking the interaction, not after. */
export async function openChangesModal(
    triggerId: string,
    kind: ReviewKind,
    submissionId: string,
    channel: string,
    ts: string,
): Promise<void> {
    if (!SLACK_TOKEN) return;
    await slack('views.open', {
        trigger_id: triggerId,
        view: {
            type: 'modal',
            callback_id: 'request_changes_modal',
            private_metadata: JSON.stringify({ kind, id: submissionId, channel, ts }),
            title: { type: 'plain_text', text: 'Request changes' },
            submit: { type: 'plain_text', text: 'Send' },
            close: { type: 'plain_text', text: 'Cancel' },
            blocks: [
                {
                    type: 'input',
                    block_id: 'feedback',
                    label: { type: 'plain_text', text: 'What needs to change?' },
                    element: {
                        type: 'plain_text_input',
                        action_id: 'value',
                        multiline: true,
                        placeholder: { type: 'plain_text', text: 'Be specific — this is sent to the submitter verbatim.' },
                    },
                },
            ],
        },
    });
}

export function verifySlackSignature(req: FastifyRequest & { rawBody?: string }): boolean {
    const ts = req.headers['x-slack-request-timestamp'] as string | undefined;
    const sig = req.headers['x-slack-signature'] as string | undefined;
    if (!ts || !sig || !req.rawBody) return false;
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 60 * 5) return false; // older than 5 minutes
    const mine = 'v0=' + crypto.createHmac('sha256', SIGNING_SECRET).update(`v0:${ts}:${req.rawBody}`).digest('hex');
    try { return crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(sig)); } catch { return false; }
}
