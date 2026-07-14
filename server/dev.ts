import type { FastifyInstance } from "fastify";
import { getSessionUser, requireRole } from "./auth.ts";
import {
    approvePitch, approveSubmission, createPitch, createSubmission,
    requestPitchChanges, requestSubmissionChanges, wipeSeeded,
} from "./db.ts";

/** Where a user sits in the flow is not a field — it is derived from their rows.
 *  So "jump to a stage" means: put the caller's OWN pitch/submission rows into the
 *  shape that stage implies, then let the real gates do their real work. Nothing here
 *  bypasses a check; it only creates the data a check reads. That is the whole point —
 *  an admin who skipped the gates would be testing a different platform than the one
 *  builders use. */
const STAGES = [
    'fresh',            // no rows          → Submit locked: "Pitch your idea first"
    'pitch_pending',    // pitch pending    → still locked, awaiting review
    'pitch_changes',    // pitch sent back  → /pitch?edit=<id> reship mode
    'pitch_approved',   // pitch approved   → Submit unlocks, pitch in the selector
    'project_pending',  // + submission     → sitting in the review queue
    'project_changes',  // sent back        → Submit reship mode
    'project_approved', // approved         → badges, shop
] as const;

type Stage = typeof STAGES[number];

const isStage = (s: unknown): s is Stage => STAGES.includes(s as Stage);

const SEEDER = 'Dev Seeder';

const FIXTURE_PITCH = {
    title: '[test] Pocket Tide Clock',
    description:
        'A tiny widget that shows the next high and low tide for whatever beach you are standing on, '
        + 'using the device GPS and NOAA station data. No account, no ads, opens in under a second.',
    why: 'Surfers and tidepoolers check tide charts constantly and every existing app buries the one '
        + 'number they want under a login wall and three interstitials.',
};

const FIXTURE_PROJECT = {
    title: '[test] Pocket Tide Clock',
    code_url: 'https://github.com/hackclub/site',
    playable_url: 'https://hackclub.com',
    description:
        'Shipped the tide widget: GPS lookup, nearest NOAA station, next four tide events, '
        + 'and an offline cache so it still works with no signal at the beach.',
    ai_disclosure:
        'Used Claude to debug my Room database migrations and to generate the settings-screen '
        + 'boilerplate. Wrote the NOAA station matching and the offline cache myself.',
};

export default async function devRoutes(app: FastifyInstance) {
    app.get('/api/admin/dev/stages', { preHandler: requireRole('admin') }, async () => ({ stages: STAGES }));

    app.post('/api/admin/dev/stage', { preHandler: requireRole('admin') }, async (req, reply) => {
        const user = getSessionUser(req)!;   // requireRole guarantees a session
        const { stage } = (req.body ?? {}) as { stage?: unknown };
        if (!isStage(stage)) return reply.code(400).send({ error: 'Unknown stage' });

        try {
            // Always start from zero so stages are idempotent: clicking the same button
            // twice leaves you in the same place rather than stacking duplicate rows.
            const wiped = await wipeSeeded(user.sub);

            if (stage === 'fresh') {
                return { ok: true, stage, wiped, goto: '/submit' };
            }

            // We call the db layer directly rather than our own HTTP routes, which means
            // no Slack card is posted and no AI duplicate check runs against fixture text.
            const pitch = await createPitch({ ...FIXTURE_PITCH, user_sub: user.sub, seeded: true });
            const pitchId = String(pitch.id);

            if (stage === 'pitch_changes') {
                await requestPitchChanges(pitchId, SEEDER, 'Narrow the scope — which beach, which tide source?');
                return { ok: true, stage, wiped, pitch_id: pitchId, goto: `/pitch?edit=${pitchId}` };
            }
            if (stage === 'pitch_pending') {
                return { ok: true, stage, wiped, pitch_id: pitchId, goto: '/pitch' };
            }

            // Every remaining stage needs an approved pitch — the submission gate demands one.
            await approvePitch(pitchId, SEEDER);
            if (stage === 'pitch_approved') {
                return { ok: true, stage, wiped, pitch_id: pitchId, goto: '/submit' };
            }

            const sub = await createSubmission({
                ...FIXTURE_PROJECT, pitch_id: pitchId, user_sub: user.sub, seeded: true,
            });
            const subId = String(sub.id);

            if (stage === 'project_changes') {
                await requestSubmissionChanges(subId, SEEDER, 'Add a demo link we can actually open.');
            } else if (stage === 'project_approved') {
                await approveSubmission(subId, SEEDER);
            }
            return { ok: true, stage, wiped, pitch_id: pitchId, submission_id: subId, goto: '/submit' };
        } catch (err) {
            req.log.error(err, 'stage seed failed');
            return reply.code(500).send({ error: 'Could not seed that stage' });
        }
    });

    app.post('/api/admin/dev/reset', { preHandler: requireRole('admin') }, async (req, reply) => {
        const user = getSessionUser(req)!;
        try {
            return { ok: true, wiped: await wipeSeeded(user.sub) };
        } catch (err) {
            req.log.error(err, 'dev reset failed');
            return reply.code(500).send({ error: 'Could not reset' });
        }
    });
}
