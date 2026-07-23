import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { getSessionUser } from "./auth.ts";
import {
    createPitch, getPitchById, listPitches, listPitchesBySub, resubmitPitch,
    setPitchDuplicateCheck, getSlackIdForSub, type PitchInput, type Row,
} from "./db.ts";
import { dmUser } from "./slack.ts";
import { aiEnabled, findDuplicates, shortlist, type DuplicateCheck } from "./ai.ts";

const MAX_LEN = 4000;
const MAX_PITCH_PER_USER = 3;   // per user, at any one time

/** Flags duplicate ideas for REVIEWERS ONLY. The verdict is stored on the pitch
 *  and shown in the review panel; pitches do not create Slack channel threads.
 *  Best-effort: a failure here must never block or fail the pitch itself. */
async function flagDuplicates(row: Row, log: FastifyBaseLogger): Promise<void> {
    if (!aiEnabled()) return;
    try {
        const title = String(row.title ?? '');
        const description = String(row.description ?? '');

        const corpus = (await listPitches())
            .filter((p) => p.id !== row.id)             // never match itself
            .filter((p) => p.status !== 'rejected')     // a rejected idea is fair to reuse
            .map((p) => ({
                id: String(p.id),
                title: String(p.title ?? ''),
                description: String(p.description ?? '').slice(0, 600),
            }));

        const candidates = shortlist({ title, description }, corpus);
        if (!candidates.length) return;

        const matches = await findDuplicates(
            { title, description, why: String(row.why ?? '') },
            candidates,
        );

        const check: DuplicateCheck = { checkedAt: new Date().toISOString(), matches };
        await setPitchDuplicateCheck(String(row.id), check);
    } catch (err) {
        log.error(err, 'duplicate check failed');   // fail open, always
    }
}

export default async function pitchRoutes(app: FastifyInstance) {
    app.get('/api/pitches/mine', async (req, reply) => {
        const user = getSessionUser(req);
        if (!user) return reply.status(401).send({ error: 'Not authenticated' });
        return listPitchesBySub(user.sub);
    });

    app.post('/api/pitches', async (req, reply) => {
        const user = getSessionUser(req);
        if (!user) return reply.status(401).send({ error: 'Unauthorized' });

        const b = (req.body ?? {}) as Partial<PitchInput>;
        const required: (keyof PitchInput)[] = ["title", "description", "why"];
        for (const k of required) {
            if (!b[k] || String(b[k]).trim() === "") {
                return reply.code(400).send({ error: `Missing field: ${k}` });
            }
            if (String(b[k]).length > MAX_LEN) {
                return reply.code(400).send({ error: `${k} is too long` });
            }
        }

        if (b.reference_file_url) {
        try {
            new URL(b.reference_file_url);
        } catch {
            return reply.code(400).send({ error: 'Invalid reference_file_url' });
        }
        }

        const myPitches = await listPitchesBySub(user.sub);
        if (myPitches.length >= MAX_PITCH_PER_USER) {
            return reply.code(409).send({ error: `You can only have ${MAX_PITCH_PER_USER} pitches at a time` });
        }

        try {
            const row = await createPitch({ ...(b as PitchInput), user_sub: user.sub });

            // Pitches stay out of shared Slack channels. Confirm receipt privately,
            // while duplicate detection remains reviewer-only in the web panel.
            void (async () => {
                const slackId = await getSlackIdForSub(user.sub);
                if (slackId) {
                    await dmUser(
                        slackId,
                        `💡 We received your Omega pitch *${row.title}*. We'll DM you when it is approved, rejected, or needs changes.`,
                    );
                }
            })().catch((err: unknown) => req.log.error(err, "pitch receipt DM failed"));
            void flagDuplicates(row, req.log);

            return reply.code(201).send({ ok: true, id: row.id });
        } catch (err) {
            req.log.error(err, "pitch failed");
            return reply.code(500).send({ error: "Could not save your pitch" });
        }
    });

    // Owner reship: edit a pitch a reviewer sent back, flipping it to pending.
    app.patch('/api/pitches/:id', async (req, reply) => {
        const user = getSessionUser(req);
        if (!user) return reply.status(401).send({ error: 'Unauthorized' });

        const { id } = req.params as { id: string };
        const row = await getPitchById(id);
        if (!row) return reply.code(404).send({ error: 'Not found' });
        if (row.user_sub !== user.sub) return reply.code(403).send({ error: 'Not your pitch' });
        if (row.status !== 'changes_requested') {
            return reply.code(409).send({ error: 'Only pitches with requested changes can be reshipped' });
        }

        const b = (req.body ?? {}) as Partial<PitchInput>;
        const required: (keyof PitchInput)[] = ["title", "description", "why"];
        for (const k of required) {
            if (!b[k] || String(b[k]).trim() === "") {
                return reply.code(400).send({ error: `Missing field: ${k}` });
            }
        }

        if (b.reference_file_url) {
            try {
                new URL(b.reference_file_url);
            } catch {
                return reply.code(400).send({ error: 'Invalid reference_file_url' });
            }
        }

        const updated = await resubmitPitch(id, { title: b.title, description: b.description, why: b.why, reference_file_url: b.reference_file_url });
        if (!updated) return reply.code(500).send({ error: 'Update failed' });

        return reply.code(200).send({ ok: true });
    });
}
