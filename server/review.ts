import type { FastifyInstance} from "fastify";
import { requireRole, getSessionUser } from "./auth.ts";
import { listSubmissions, getSubmissionById } from "./db.ts";
import { fetchThreadReplies, postReviewerMessage, dmUser } from "./slack.ts";
import { getSlackIdForSub } from "./db.ts";

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
            created_at: r.created_at ?? null,
        }));
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
}
            