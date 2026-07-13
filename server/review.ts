import type { FastifyInstance, FastifyBaseLogger, FastifyRequest, FastifyReply } from "fastify";
import { requireRole, getSessionUser } from "./auth.ts";
import {
    listSubmissions, getSubmissionById, listPitches, getPitchById, setSubmissionBadges,
    approveSubmission, rejectSubmission, requestSubmissionChanges,
    approvePitch, rejectPitch, requestPitchChanges, getSlackIdForSub, type Row,
} from "./db.ts";
import {
    fetchThreadReplies, postReviewerMessage, dmUser, postInThread, updateReviewCard,
    editLink, pitchEditLink, frontendUrl, type ReviewKind, type SubmissionState,
} from "./slack.ts";
import { BADGES, sanitizeBadges, hydrate } from "./badges.ts";
/** Stored as a JSON string in Airtable; a malformed value must not break the panel. */


type ReviewAction = 'approve' | 'reject' | 'request_changes';

const ACTION_STATE: Record<ReviewAction, SubmissionState> = {
    approve: 'approved',
    reject: 'rejected',
    request_changes: 'changes_requested',
};

function parseDuplicateCheck(raw: unknown): unknown {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

/** Applies a review decision. The Airtable write is authoritative and awaited;
 *  every Slack side-effect is best-effort, so the panel keeps working with Slack
 *  unconfigured or down. */
async function applyReviewAction(
    kind: ReviewKind,
    row: Row,
    action: ReviewAction,
    feedback: string,
    reviewerName: string,
    log: FastifyBaseLogger,
): Promise<SubmissionState> {
    const id = String(row.id);
    const isPitch = kind === 'pitch';

    // 1. Persist — the part that must succeed.
    if (action === 'request_changes') {
        if (isPitch) await requestPitchChanges(id, reviewerName, feedback);
        else await requestSubmissionChanges(id, reviewerName, feedback);
    } else if (action === 'approve') {
        // approveSubmission also promotes the row into the YSWS table.
        if (isPitch) await approvePitch(id, reviewerName);
        else await approveSubmission(id, reviewerName);
    } else {
        if (isPitch) await rejectPitch(id, reviewerName);
        else await rejectSubmission(id, reviewerName);
    }

    const state = ACTION_STATE[action];

    // 2. Mirror into Slack. Deliberately not awaited: a missing bot token must not
    //    turn a successfully-recorded decision into a 500.
    void (async () => {
        try {
            const ch = row.slack_channel ? String(row.slack_channel) : '';
            const ts = row.slack_ts ? String(row.slack_ts) : '';

            if (ch && ts) {
                // Rewrite the card so its buttons match reality — otherwise someone
                // scrolling Slack could act again on an already-decided item.
                const fresh = isPitch ? await getPitchById(id) : await getSubmissionById(id);
                if (fresh) await updateReviewCard(kind, ch, ts, fresh, state);

                const note = action === 'request_changes'
                    ? `✏️ *${reviewerName}* requested changes:\n>${feedback.replace(/\n/g, '\n>')}`
                    : `${action === 'approve' ? '✅' : '❌'} *${reviewerName}* ${state} this from the platform.`;
                await postInThread(ch, ts, note);
            }

            const slackId = await getSlackIdForSub(String(row.user_sub));
            if (!slackId) return;

            const label = isPitch ? 'pitch' : 'submission';
            let dm: string;
            if (action === 'request_changes') {
                const link = isPitch ? pitchEditLink(id) : editLink(id);
                dm = `Your Omega ${label} *${row.title}* needs changes:\n\n>${feedback.replace(/\n/g, '\n>')}\n\nReship it here: ${link}`;
            } else if (action === 'approve') {
                dm = isPitch
                    ? `💡 Your Omega pitch *${row.title}* was approved — start building! Submit the finished project: ${frontendUrl()}/submit`
                    : `🎉 Your Omega submission *${row.title}* was approved!`;
            } else {
                dm = `Your Omega ${label} *${row.title}* was rejected. Ask in #omega if you'd like context.`;
            }
            await dmUser(slackId, dm);
        } catch (err) {
            log.error(err, 'slack sync after review action failed');
        }
    })();

    return state;
}

/** One handler body, registered once per kind. */
function actionHandler(kind: ReviewKind) {
    return async (req: FastifyRequest, reply: FastifyReply) => {
        const user = getSessionUser(req)!;   // requireRole guarantees a session
        const { id } = req.params as { id: string };
        const body = (req.body ?? {}) as { action?: string; feedback?: string };

        const action = body.action as ReviewAction;
        if (!['approve', 'reject', 'request_changes'].includes(action ?? '')) {
            return reply.code(400).send({ error: 'Unknown action' });
        }

        const feedback = String(body.feedback ?? '').trim();
        // Sending someone back with no explanation is the worst possible UX.
        if (action === 'request_changes' && !feedback) {
            return reply.code(400).send({ error: 'Describe what needs to change' });
        }
        if (feedback.length > 4000) {
            return reply.code(400).send({ error: 'Feedback is too long' });
        }

        const row = kind === 'pitch' ? await getPitchById(id) : await getSubmissionById(id);
        if (!row) return reply.code(404).send({ error: 'Not found' });

        // The button being hidden client-side is not a guard.
        if (row.status === 'approved' && action === 'approve') {
            return reply.code(409).send({ error: 'Already approved' });
        }

        try {
            const status = await applyReviewAction(
                kind, row, action, feedback, user.name ?? user.sub, req.log,
            );
            return { ok: true, status };
        } catch (err) {
            req.log.error(err, 'review action failed');
            return reply.code(500).send({ error: 'Could not save the decision' });
        }
    };
}

export default async function reviewRoutes(app: FastifyInstance) {
    app.get('/api/review/submissions', { preHandler: requireRole('reviewer') }, async (req) => {
        const status = (req.query as { status?: string }).status;
        const rows = await listSubmissions(status);
        rows.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
        return rows.map((r) => ({
            id: r.id,
            title: r.title ?? null,
            status: r.status,
            code_url: r.code_url ?? null,
            first_name: r.first_name ?? null,
            last_name: r.last_name ?? null,
            hackatime_hours: r.hackatime_hours ?? null,
            hasThread: !!(r.slack_channel && r.slack_ts),
            // Current awards, so the panel's chips render pre-toggled.
            badges: Array.isArray(r.badges) ? r.badges : [],
            created_at: r.created_at ?? null,
        }));
    });

    app.get('/api/review/pitches', { preHandler: requireRole('reviewer') }, async (req) => {
        const status = (req.query as { status?: string }).status;
        const rows = await listPitches(status);
        return rows.map((r) => ({
            id: r.id,
            title: r.title ?? null,
            status: r.status ?? 'pending',
            description: r.description ?? null,
            why: r.why ?? null,
            first_name: r.first_name ?? null,
            last_name: r.last_name ?? null,
            hasThread: !!(r.slack_channel && r.slack_ts),
            // Reviewer-only: the duplicate-idea verdict never reaches the author,
            // whose endpoint goes through pitchView (which omits this field).
            duplicate_check: parseDuplicateCheck(r.duplicate_check),
            created_at: r.created_at ?? null,
        }));
    });

    /** A pitch's Slack thread. Pitches and projects live in different tables, so
     *  the thread route needs to know which one it's looking at. */
    app.get('/api/review/pitches/:id/thread', { preHandler: requireRole('reviewer') }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const row = await getPitchById(id);
        if (!row) return reply.status(404).send({ error: 'Pitch not found' });
        if (!row.slack_channel || !row.slack_ts) return { messages: [], reason: 'no_thread' };
        try {
            return { messages: await fetchThreadReplies(String(row.slack_channel), String(row.slack_ts)) };
        } catch (err) {
            req.log.error(err, 'Failed to fetch pitch thread');
            return reply.code(502).send({ error: 'Failed to fetch Slack thread' });
        }
    });

    app.post('/api/review/pitches/:id/message', { preHandler: requireRole('reviewer') }, async (req, reply) => {
        const user = getSessionUser(req)!;
        const { id } = req.params as { id: string };
        const text = String((req.body as { text?: string }).text ?? '').trim();
        const alsoDm = (req.body as { dmSubmitter?: boolean })?.dmSubmitter === true;

        if (!text) return reply.status(400).send({ error: 'Message text is required' });
        if (text.length > 4000) return reply.status(400).send({ error: 'Message text is too long' });

        const row = await getPitchById(id);
        if (!row) return reply.status(404).send({ error: 'Pitch not found' });
        if (!row.slack_channel || !row.slack_ts) {
            return reply.status(409).send({ error: 'Pitch has no Slack thread' });
        }

        try {
            await postReviewerMessage(
                String(row.slack_channel), String(row.slack_ts),
                user.name ?? 'A reviewer', text,
            );
            if (alsoDm) {
                const slackId = await getSlackIdForSub(String(row.user_sub));
                if (slackId) {
                    await dmUser(slackId, `💬 *${user.name ?? 'A reviewer'}* on your pitch *${row.title}*:\n\n>${text.replace(/\n/g, '\n>')}`);
                }
            }
            return { ok: true };
        } catch (err) {
            req.log.error(err, 'post reviewer pitch message failed');
            return reply.code(502).send({ error: 'Slack rejected the message' });
        }
    });

    app.get('/api/review/:id/thread', { preHandler: requireRole('reviewer') }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const row = await getSubmissionById(id);
        if (!row) return reply.status(404).send({ error: 'Submission not found' });
        if (!row.slack_channel || !row.slack_ts) {
            // Submitted before Slack was wired up, or the card failed to post.
            return { messages: [], reason: 'no_thread' };
        }
        try {
            const messages = await fetchThreadReplies(String(row.slack_channel), String(row.slack_ts));
            return { messages};
        } catch (err) {
            req.log.error(err, 'Failed to fetch Slack thread');
            return reply.code(502).send({ error: 'Failed to fetch Slack thread' });
        }
    });

    app.get('/api/review/badges', { preHandler: requireRole('reviewer') }, async () => BADGES);

    /** Awarding REPLACES the badge set — the reviewer toggles chips and saves the
     *  final list, so un-awarding a mistake needs no separate delete route. */
    app.post('/api/review/:id/badges', { preHandler: requireRole('reviewer') }, async (req, reply) => {
        const user = getSessionUser(req)!;
        const { id } = req.params as { id: string };

        // Whitelist against the catalog: a reviewer's browser is still a client,
        // and typecast:true would otherwise let a junk slug create a real option.
        const slugs = sanitizeBadges((req.body as { badges?: unknown })?.badges);

        const row = await getSubmissionById(id);
        if (!row) return reply.code(404).send({ error: 'Submission not found' });

        const updated = await setSubmissionBadges(id, slugs, user.name ?? user.sub);
        if (!updated) return reply.code(500).send({ error: 'Failed to update badges' });

        // Telling the builder what they earned is the whole point — but never let
        // a Slack failure fail the award, which is already persisted.
        if (slugs.length) {
            const names = hydrate(slugs).map((b) => `${b.icon} ${b.label}`).join(', ');
            if (row.slack_channel && row.slack_ts) {
                postInThread(
                    String(row.slack_channel), String(row.slack_ts),
                    `🏅 *${user.name ?? 'A reviewer'}* awarded badges: ${names}`,
                ).catch((err: unknown) => req.log.error(err, 'badge thread post failed'));
            }
            getSlackIdForSub(String(row.user_sub))
                .then((slackId) => {
                    if (slackId) return dmUser(slackId, `🏅 You earned badges on *${row.title}*: ${names}`);
                })
                .catch((err: unknown) => req.log.error(err, 'badge DM failed'));
        }

        return { ok: true, badges: slugs };
    });

    app.post('/api/review/:id/message', { preHandler: requireRole('reviewer') }, async (req, reply) => {
        const user = getSessionUser(req)!;
        const { id } = req.params as { id: string };
        const text = String((req.body as { text?: string }).text ?? '').trim();
        const alsoDm = (req.body as { dmSubmitter?: boolean })?.dmSubmitter === true;

        if (!text) return reply.status(400).send({ error: 'Message text is required' });
        if (text.length > 4000) return reply.status(400).send({ error: 'Message text is too long' });

        const row = await getSubmissionById(id);
        if (!row) return reply.status(404).send({ error: 'Submission not found' });
        if (!row.slack_channel || !row.slack_ts) {
            return reply.status(409).send({ error: 'Submission has no Slack thread' });
        }

        try {
            await postReviewerMessage(
                String(row.slack_channel), String(row.slack_ts),
                user.name ?? 'A reviewer', text,
            );

            if (alsoDm) {
                const slackId = await getSlackIdForSub(String(row.user_sub));
                if (slackId) {
                    await dmUser(slackId, `💬 *${user.name ?? 'A reviewer'}* on your submission *${row.title}*:\n\n>${text.replace(/\n/g, '\n>')}`);
                }
            }
            return { ok: true };
        } catch (err) {
            req.log.error(err, 'post reviewer message failed');
            return reply.code(502).send({ error: 'Slack rejected the message' });
        }
    });

    // Approve / reject / request-changes, straight from the platform. The static
    // "pitches" segment wins over the :id param, so ordering here is not load-bearing.
    app.post('/api/review/pitches/:id/action', { preHandler: requireRole('reviewer') }, actionHandler('pitch'));
    app.post('/api/review/:id/action', { preHandler: requireRole('reviewer') }, actionHandler('project'));
}
            