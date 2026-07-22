import type { FastifyInstance, FastifyBaseLogger, FastifyRequest, FastifyReply } from "fastify";
import { requireRole, getSessionUser, type HcUser } from "./auth.ts";
import {
    listSubmissions, getSubmissionById, listPitches, getPitchById, setSubmissionBadges,
    getSubmissionByPitchId, listAuthUsers,
    approveSubmission, rejectSubmission, requestSubmissionChanges,
    approvePitch, rejectPitch, requestPitchChanges, getSlackIdForSub, type Row,
} from "./db.ts";
import {
    fetchThreadReplies, postReviewerMessage, dmUser, postInThread, updateReviewCard,
    editLink, pitchEditLink, frontendUrl, postBuilderControls,
        type ReviewKind, type SubmissionState,
    type Actor,
    mention, isReviewer,
} from "./slack.ts";
import { BADGES, sanitizeBadges, hydrate } from "./badges.ts";
import { checkGithubRepo, fetchReadme } from "./github-api.ts";
import { TIERS, tierBySlug, computePayout, MAX_HOURS } from "./tiers.ts";
import { setSubmissionAssessment, payoutSubmission } from "./db.ts";
/** Stored as a JSON string in Airtable; a malformed value must not break the panel. */


type ReviewAction = 'approve' | 'reject' | 'request_changes';
type GithubPayload = {
    check: Awaited<ReturnType<typeof checkGithubRepo>>;
    // null when the repo is private, missing, or simply has no README — all normal
    // outcomes a reviewer needs to see, not errors.
    readme: Awaited<ReturnType<typeof fetchReadme>> | null;
}

const ghCache = new Map<string, { at: number; data: GithubPayload }>();
const GH_TTL_MS = 5*60*1000;  // 5 minutes

const ACTION_STATE: Record<ReviewAction, SubmissionState> = {
    approve: 'approved',
    reject: 'rejected',
    request_changes: 'changes_requested',
};

const SLACK_SPECIAL_MENTION_RE = /<!(?:channel|here|everyone)>/;
const SLACK_USER_MENTION_RE = /<@([UW][A-Z0-9]+)>/g;

function extractMentionedSlackIds(text: string): string[] {
    const ids = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = SLACK_USER_MENTION_RE.exec(text)) !== null) ids.add(m[1]);
    return [...ids];
}

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
    userFeedback: string,
    internalJustification: string,
    actor: Actor,
    log: FastifyBaseLogger,
    approval?: { approvedHours?: number; tier?: string },
): Promise<SubmissionState> {
    const id = String(row.id);
    const isPitch = kind === 'pitch';
    const publicNote = String(userFeedback ?? '').trim();
    const privateNote = String(internalJustification ?? '').trim();

    // 1. Persist — the part that must succeed.
    if (action === 'request_changes') {
        if (isPitch) await requestPitchChanges(id, actor.name, publicNote);
        else await requestSubmissionChanges(id, actor.name, publicNote);
    } else if (action === 'approve') {
        // approveSubmission also promotes the row into the YSWS table.
        if (isPitch) await approvePitch(id, actor.name);
        else await approveSubmission(id, actor.name, {
            approvedHours: approval?.approvedHours,
            tier: approval?.tier,
            overrideHourJustification: privateNote,
            userFeedback: publicNote,
        });
    } else {
        if (isPitch) await rejectPitch(id, actor.name);
        else await rejectSubmission(id, actor.name);
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
                if (fresh) await updateReviewCard(kind, ch, ts, fresh, state, actor.slackId ?? undefined );

                const note = action === 'request_changes'
                    ? `✏️ ${mention(actor)} requested changes:\n>${publicNote.replace(/\n/g, '\n>')}`
                    : `${action === 'approve' ? '✅' : '❌'} ${mention(actor)} ${state} this from the platform.${publicNote ? `\n\n>${publicNote.replace(/\n/g, '\n>')}` : ''}`;
                await postInThread(ch, ts, note);
            }

            const slackId = await getSlackIdForSub(String(row.user_sub));
            if (!slackId) return;

            // Changes requested is the one state where the builder has something to do,
            // so re-post their controls (reship / withdraw) into the thread. Ephemeral,
            // so nobody else in the channel sees a withdraw button on someone's project.
            if (action === 'request_changes' && ch && ts) {
                await postBuilderControls(
                    kind,
                    { ...row, slack_channel: ch, slack_ts: ts },
                    'changes_requested',
                    slackId,
                );
            }

            const label = isPitch ? 'pitch' : 'submission';
            let dm: string;
            if (action === 'request_changes') {
                const link = isPitch ? pitchEditLink(id) : editLink(id);
                dm = `${mention(actor)} asked for changes on your Omega ${label} *${row.title}*:\n\n>${publicNote.replace(/\n/g, '\n>')}\n\nReship it here: ${link}`;
            } else if (action === 'approve') {
                const extra = publicNote ? `\n\n>${publicNote.replace(/\n/g, '\n>')}` : '';
                dm = isPitch
                    ? `💡 Your Omega pitch *${row.title}* was approved by ${mention(actor)} — start building! Submit the finished project: ${frontendUrl()}/submit${extra}`
                    : `🎉 Your Omega submission *${row.title}* was approved by ${mention(actor)}!${extra}`;
            } else {
                const extra = publicNote ? `\n\n>${publicNote.replace(/\n/g, '\n>')}` : '';
                dm = `Your Omega ${label} *${row.title}* was rejected by ${mention(actor)}. Ask in #omega if you'd like context.${extra}`;
            }
            await dmUser(slackId, dm);
        } catch (err) {
            log.error(err, 'slack sync after review action failed');
        }
    })();

    return state;
}

/** The signed-in reviewer, in the shape Slack needs. `slack_id` rides along on the
 *  session from the OIDC `slack_id` claim, so no lookup is required. When it's absent
 *  (a login that predates the scope), mention() degrades to a bold name. */
function actorOf(user: HcUser): Actor {
    return { name: user.name ?? user.sub, slackId: user.slack_id };
}

/** One handler body, registered once per kind. */
function actionHandler(kind: ReviewKind) {
    return async (req: FastifyRequest, reply: FastifyReply) => {
        const user = getSessionUser(req)!;   // requireRole guarantees a session
        const { id } = req.params as { id: string };
        const body = (req.body ?? {}) as {
            action?: string; feedback?: string; user_feedback?: string; internal_justification?: string; tier?: string; approved_hours?: unknown;
        };

        const action = body.action as ReviewAction;
        if (!['approve', 'reject', 'request_changes'].includes(action ?? '')) {
            return reply.code(400).send({ error: 'Unknown action' });
        }

        const userFeedback = String(body.user_feedback ?? body.feedback ?? '').trim();
        const internalJustification = String(body.internal_justification ?? '').trim();
        // Sending someone back with no explanation is the worst possible UX.
        if (action === 'request_changes' && !userFeedback) {
            return reply.code(400).send({ error: 'Describe what needs to change' });
        }
        if (userFeedback.length > 4000) {
            return reply.code(400).send({ error: 'Feedback is too long' });
        }
        if (internalJustification.length > 4000) {
            return reply.code(400).send({ error: 'Internal justification is too long' });
        }

        const row = kind === 'pitch' ? await getPitchById(id) : await getSubmissionById(id);
        if (!row) return reply.code(404).send({ error: 'Not found' });

        // The button being hidden client-side is not a guard.
        if (row.status === 'approved' && action === 'approve') {
            return reply.code(409).send({ error: 'Already approved' });
        }

        // Approving a PROJECT is a payment, so it cannot happen without a tier and
        // approved hours. Pitches are just ideas — they're never paid. Request-local:
        // this must NOT be module state, or two concurrent approvals would clobber it.
        let payout: { tokens: number; tier: string; hours: number } | null = null;
        if (kind === 'project' && action === 'approve') {
            const tier = tierBySlug(body.tier);
            const hours = Number(body.approved_hours);
            if (!tier) {
                return reply.code(400).send({ error: 'Pick a tier before approving' });
            }
            if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS) {
                return reply.code(400).send({ error: `Approved hours must be between 0 and ${MAX_HOURS}` });
            }
            if (!internalJustification) {
                return reply.code(400).send({ error: 'Add an internal override justification' });
            }
            payout = { tokens: computePayout(hours, tier), tier: tier.slug, hours };
            // Record the assessment before the decision, so the tier/hours are stored
            // even if the payout half fails and needs a manual retry.
            await setSubmissionAssessment(id, { tier: tier.slug, approved_hours: hours });
        }

        try {
            const status = await applyReviewAction(
                kind, row, action, userFeedback, internalJustification, actorOf(user), req.log,
                kind === 'project' && action === 'approve' && payout ? { approvedHours: payout.hours, tier: payout.tier } : undefined,
            );

            // Pay AFTER the status write lands, and awaited — unlike the Slack
            // side-effects, a failed payout is a real error the reviewer must see.
            if (payout) {
                const paid = await payoutSubmission(id, payout.tokens, user.sub);
                if (!paid.ok) {
                    req.log.error({ id, err: paid.error }, 'PAYOUT FAILED');
                    return reply.code(500).send({ error: 'Approved, but the payout failed — tell an admin' });
                }
                return {
                    ok: true, status,
                    payout: { tokens: paid.tokens, alreadyPaid: paid.alreadyPaid, tier: payout.tier, hours: payout.hours },
                };
            }
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
            user_sub: r.user_sub ?? null,
            status: r.status,
            code_url: r.code_url ?? null,
            demo_video_url: r.demo_video_url ?? null,
            // undefined for rows created before the tick existed — the panel shows
            // "predates the question" rather than a misleading "no AI".
            ai_used: r.ai_used === undefined ? null : !!r.ai_used,
            ai_disclosure: r.ai_disclosure ?? null,
            description: r.description ?? null,
            playable_url: r.playable_url ?? null,
            first_name: r.first_name ?? null,
            last_name: r.last_name ?? null,
            hackatime_hours: r.hackatime_hours ?? null,
            hasThread: !!(r.slack_channel && r.slack_ts),
            // Current awards, so the panel's chips render pre-toggled.
            badges: Array.isArray(r.badges) ? r.badges : [],
            // Payout state — prefills the assessment bar and shows what was paid.
            tier: r.tier ?? null,
            approved_hours: r.approved_hours ?? null,
            payout_tokens: r.payout_tokens ?? null,
            paid_at: r.paid_at ?? null,
            created_at: r.created_at ?? null,
        }));
    });

    app.get('/api/review/pitches', { preHandler: requireRole('reviewer') }, async (req) => {
    const { status, q } = req.query as { status?: string; q?: string };
    const rows = await listPitches(status);

    const raw = String(q ?? '').trim().toLowerCase();
    let filtered = rows;

    if (raw) {
        const needles = [...new Set([raw, raw.replace(/^@/, '')].filter(Boolean))];
        const users = await listAuthUsers();
        const bySub = new Map(users.map((u) => [String(u.sub ?? ''), u]));

        const hit = (v: unknown): boolean => {
            const s = String(v ?? '').toLowerCase();
            return needles.some((n) => s.includes(n));
        };

        filtered = rows.filter((r) => {
            const auth = bySub.get(String(r.user_sub ?? ''));
            return [
                r.title,
                r.first_name,
                r.last_name,
                r.email,
                r.user_sub,
                auth?.name,
                auth?.email,
                auth?.slack_id,
                auth?.slack_username,
                auth?.username,
            ].some(hit);
        });
    }

    return filtered.map((r) => ({
        id: r.id,
        title: r.title ?? null,
        user_sub: r.user_sub ?? null,
        status: r.status ?? 'pending',
        description: r.description ?? null,
        why: r.why ?? null,
        first_name: r.first_name ?? null,
        last_name: r.last_name ?? null,
        hasThread: !!(r.slack_channel && r.slack_ts),
        duplicate_check: parseDuplicateCheck(r.duplicate_check),
        created_at: r.created_at ?? null,
    }));
});

    /** The pitch a project came from — so a reviewer can ask "did they build what
     *  they pitched?" without going and hunting for it. Reviewer-gated, so unlike the
     *  author-facing pitchView this may safely carry `duplicate_check`. */
    app.get('/api/review/:id/pitch', { preHandler: requireRole('reviewer') }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const sub = await getSubmissionById(id);
        if (!sub) return reply.status(404).send({ error: 'Submission not found' });

        const pitchId = String(sub.pitch_id ?? '');
        // Submissions created before the pitch gate existed have no pitch. That's a
        // fact about the data, not an error — the panel renders it as "no pitch".
        if (!pitchId) return { pitch: null, reason: 'no_pitch' };

        const p = await getPitchById(pitchId).catch(() => null);
        if (!p) return { pitch: null, reason: 'missing' };   // id present but row gone

        return {
            pitch: {
                id: p.id,
                title: p.title ?? null,
                description: p.description ?? null,
                why: p.why ?? null,
                status: p.status ?? 'pending',
                review_feedback: p.review_feedback ?? null,
                duplicate_check: parseDuplicateCheck(p.duplicate_check),
                created_at: p.created_at ?? null,
            },
        };
    });

    /** The reverse: the project that fulfilled a pitch, if it's been built yet. */
    app.get('/api/review/pitches/:id/project', { preHandler: requireRole('reviewer') }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const pitch = await getPitchById(id);
        if (!pitch) return reply.status(404).send({ error: 'Pitch not found' });

        const s = await getSubmissionByPitchId(id);
        if (!s) return { project: null, reason: 'not_built' };

        return {
            project: {
                id: s.id,
                title: s.title ?? null,
                status: s.status ?? 'pending',
                code_url: s.code_url ?? null,
                playable_url: s.playable_url ?? null,
                description: s.description ?? null,
                badges: Array.isArray(s.badges) ? s.badges : [],
                created_at: s.created_at ?? null,
            },
        };
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
    
    app.get('/api/review/tiers', { preHandler: requireRole('reviewer') }, async () => TIERS);


    app.get('/api/review/:id/github', { preHandler: requireRole('reviewer') }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const row = await getSubmissionById(id);
        if (!row) return reply.status(404).send({ error: 'Submission not found' });
        const url = String(row.code_url ?? '').trim();

        if(!url) return { check: null, readme: null, reason: 'no_code_url' };

        const hit = ghCache.get(url);
        if (hit && Date.now() - hit.at < GH_TTL_MS) {
            return hit.data;
        }

        try {
            const check = await checkGithubRepo(url);
            const readme = check.readme?.found ? await fetchReadme(url) : null;
            const data: GithubPayload = { check, readme };
            ghCache.set(url, { at: Date.now(), data });
            return data;
        } catch (err) {
            req.log.error(err, 'GitHub API fetch failed');
            return { check: null, readme: null, reason: 'error' };
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

        if (SLACK_SPECIAL_MENTION_RE.test(text)) {
            return reply.status(400).send({ error: 'Mass mentions are not allowed in review threads' });
        }
        const mentionedIds = extractMentionedSlackIds(text);
        if (mentionedIds.length) {
            const submitterSlackId = await getSlackIdForSub(String(row.user_sub));
            const bad = mentionedIds.find((sid) => !isReviewer(sid) && sid !== submitterSlackId);
            if (bad) {
                return reply.status(403).send({ error: 'You can only mention reviewers/admins or this submitter' });
            }
        }

        try {
            await postReviewerMessage(
                String(row.slack_channel), String(row.slack_ts),
                actorOf(user), text,
            );
            if (alsoDm) {
                const slackId = await getSlackIdForSub(String(row.user_sub));
                if (slackId) {
                    await dmUser(slackId, `💬 ${mention(actorOf(user))} on your pitch *${row.title}*:\n\n>${text.replace(/\n/g, '\n>')}`);
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

        // Airtable stores the NAME — a raw <@U…> is unreadable in a spreadsheet.
        const updated = await setSubmissionBadges(id, slugs, user.name ?? user.sub);
        if (!updated) return reply.code(500).send({ error: 'Failed to update badges' });

        // Telling the builder what they earned is the whole point — but never let
        // a Slack failure fail the award, which is already persisted.
        if (slugs.length) {
            const names = hydrate(slugs).map((b) => `${b.icon} ${b.label}`).join(', ');
            if (row.slack_channel && row.slack_ts) {
                postInThread(
                    String(row.slack_channel), String(row.slack_ts),
                    `🏅 ${mention(actorOf(user))} awarded badges: ${names}`,
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

        if (SLACK_SPECIAL_MENTION_RE.test(text)) {
            return reply.status(400).send({ error: 'Mass mentions are not allowed in review threads' });
        }
        const mentionedIds = extractMentionedSlackIds(text);
        if (mentionedIds.length) {
            const submitterSlackId = await getSlackIdForSub(String(row.user_sub));
            const bad = mentionedIds.find((sid) => !isReviewer(sid) && sid !== submitterSlackId);
            if (bad) {
                return reply.status(403).send({ error: 'You can only mention reviewers/admins or this submitter' });
            }
        }

        try {
            await postReviewerMessage(
                String(row.slack_channel), String(row.slack_ts),
                actorOf(user), text,
            );

            if (alsoDm) {
                const slackId = await getSlackIdForSub(String(row.user_sub));
                if (slackId) {
                    await dmUser(slackId, `💬 ${mention(actorOf(user))} on your submission *${row.title}*:\n\n>${text.replace(/\n/g, '\n>')}`);
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
            