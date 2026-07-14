import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { getSessionUser } from "./auth.ts";
import {
    createPitch, getPitchById, listPitches, listPitchesBySub, resubmitPitch,
    setPitchSlackRef, setPitchDuplicateCheck, getSlackIdForSub, type PitchInput, type Row,
} from "./db.ts";
import {
    notifySlackOfNewReview, postInThread, updateReviewCard, postBuilderControls,
} from "./slack.ts";
import { aiEnabled, findDuplicates, shortlist, type DuplicateCheck } from "./ai.ts";

const MAX_LEN = 4000;

/** Flags duplicate ideas for REVIEWERS ONLY — the verdict is stored on the pitch
 *  (absent from the author-facing projection) and commented into the review-channel
 *  thread, which submitters are not members of. Best-effort: a failure here must
 *  never block or fail the pitch itself. */
async function flagDuplicates(
    row: Row, channel: string, ts: string, log: FastifyBaseLogger,
): Promise<void> {
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
        if (!matches.length) return;

        const lines = matches
            .map((m) => `• *${m.title}* (${Math.round(m.score * 100)}% match) — ${m.reason}`)
            .join('\n');
        await postInThread(
            channel, ts,
            `🤖 *Possible duplicate idea* — this looks similar to:\n${lines}\n\n_Automated check, reviewers only. Use your judgment._`,
        );
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

        try {
            const row = await createPitch({ ...(b as PitchInput), user_sub: user.sub });
            // Post the review card, persist where it landed, then run the duplicate
            // check so its comment can land in that same (reviewer-only) thread.
            notifySlackOfNewReview('pitch', user, row)
                .then(async (ref) => {
                    if (!ref) return;
                    await setPitchSlackRef(row.id, ref.channel, ref.ts);

                    // The builder's own controls, ephemeral so only they can see them.
                    const slackId = await getSlackIdForSub(user.sub);
                    if (slackId) {
                        await postBuilderControls(
                            'pitch',
                            { ...row, slack_channel: ref.channel, slack_ts: ref.ts },
                            'pending',
                            slackId,
                        );
                    } else {
                        req.log.info({ sub: user.sub }, 'no slack_id — builder gets no thread controls');
                    }

                    await flagDuplicates(row, ref.channel, ref.ts, req.log);
                })
                .catch((err: unknown) => req.log.error(err, "slack pitch notify failed"));
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

        const updated = await resubmitPitch(id, { title: b.title, description: b.description, why: b.why });
        if (!updated) return reply.code(500).send({ error: 'Update failed' });

        // Reuse the original review message: reply in-thread and restore the buttons.
        if (row.slack_channel && row.slack_ts) {
            const ch = String(row.slack_channel), ts = String(row.slack_ts);
            postInThread(ch, ts, `♻️ *${user.name ?? 'The builder'}* reshipped this pitch — ready for another look.`)
                .then(() => updateReviewCard('pitch', ch, ts, updated, 'pending'))
                .catch((err: unknown) => req.log.error(err, "pitch reship notify failed"));
        }
        return reply.code(200).send({ ok: true });
    });
}
