import type { FastifyInstance } from "fastify";
import { getSessionUser } from "./auth.ts";
import {
  createSubmission, approveSubmission, rejectSubmission, listSubmissionsBySub,
  getSubmissionById, setSubmissionSlackRef, requestSubmissionChanges,
  resubmitSubmission, getSlackIdForSub, type SubmissionInput,
  getPitchById, approvePitch, rejectPitch, requestPitchChanges, listApprovedPitchesBySub,
  withdrawSubmission, withdrawPitch,
} from './db.ts';
import {
  notifySlackOfNewSubmission, verifySlackSignature, isReviewer, updateSubmissionCard,
  updateReviewCard, postInThread, dmUser, openChangesModal, editLink, pitchEditLink,
  parseActionValue, frontendUrl, postBuilderControls, respondEphemeral, type ReviewKind,
} from "./slack.ts";
import { checkGithubRepo } from "./github-api.ts";

/** Actions the BUILDER owns. Everything else on a card is a reviewer action. */
const BUILDER_ACTIONS = new Set(['builder_withdraw', 'builder_reship']);
const MAX_ACTIVE_SUBMISSIONS = 2;   // per user, at any one time
const ACTIVE_SUBMISSION_STATUSES = new Set(["pending", "changes_requested"]);

/** The tick drives the description. Ticked → you must say what for. Unticked → the
 *  description is meaningless, so we don't demand it. A tick with an empty description
 *  is the one combination we reject: a claim with no substance. Returns an error
 *  string, or null if valid. */
function validateAiUsage(b: Partial<SubmissionInput>): string | null {
    if (b.ai_used === true && String(b.ai_disclosure ?? "").trim() === "") {
        return "You ticked 'used AI' — say what you used it for";
    }
    if (String(b.ai_disclosure ?? "").length > 2000) {
        return "AI disclosure is too long";
    }
    return null;
}

/** Normalize what actually gets stored: an unticked box must never keep stale text
 *  from a previous draft. */
function normalizeAiUsage(b: Partial<SubmissionInput>): { ai_used: boolean; ai_disclosure: string } {
    const ai_used = b.ai_used === true;
    return { ai_used, ai_disclosure: ai_used ? String(b.ai_disclosure).trim() : "" };
}

export default async function submissionRoutes(app: FastifyInstance) {
    app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (req, body, done) => {
        (req as any).rawBody = body;
        done(null, new URLSearchParams(body as string));
    });

    app.get('/api/submissions/mine', async (req, reply) => {
        const user = getSessionUser(req);
        if (!user) return reply.status(401).send({ error: 'Not authenticated' });
        return listSubmissionsBySub(user.sub);
    });

    /** The approved pitches this user may attach a project to. Empty = they can't submit yet. */
    app.get('/api/submissions/eligible-pitches', async (req, reply) => {
        const user = getSessionUser(req);
        if (!user) return reply.status(401).send({ error: 'Not authenticated' });
        return listApprovedPitchesBySub(user.sub);
    });

    app.post('/api/submissions', async (req, reply) => {
        const user = getSessionUser(req);
        if (!user) return reply.status(401).send({ error: 'Unauthorized' });

        const b = (req.body ?? {}) as Partial<SubmissionInput>;
        const required: (keyof SubmissionInput)[] = ["pitch_id", "title", "code_url", "playable_url", "description", "screenshot_url"];
        for (const k of required) {
            if (!b[k] || String(b[k]).trim() === "") return reply.code(400).send({ error: `Missing field: ${k}` });
        }
        const aiErr = validateAiUsage(b);
        if (aiErr) return reply.code(400).send({ error: aiErr });

        // You pitch before you build: a project must fulfil one of YOUR approved pitches.
        // Client-side selection is not trustworthy — re-check ownership and status here.
        let pitch;
        try {
            pitch = await getPitchById(String(b.pitch_id));
        } catch (err) {
            // Never surface raw Airtable errors: they name tables and leak token permissions.
            req.log.error(err, "pitch lookup failed");
            return reply.code(500).send({ error: "Could not verify your pitch" });
        }
        if (!pitch || pitch.user_sub !== user.sub) {
            return reply.code(403).send({ error: "Pick one of your own pitches" });
        }
        if (pitch.status !== "approved") {
            return reply.code(409).send({ error: "That pitch hasn't been approved yet" });
        }

        if (b.demo_video_url && !/^https:\/\//i.test(b.demo_video_url.trim())) {
            return reply.code(400).send({ error: "Demo video URL must be an https link" });
        }

        if (b.hackatime_start_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.hackatime_start_date)) {
            return reply.code(400).send({ error: "Hackatime start date must be a YYYY-MM-DD date" });
        }
        if (b.hackatime_hours !== null && b.hackatime_hours !== undefined && b.hackatime_hours < 20) {
            return reply.code(400).send({ error: "You need at least 20 hours to submit this project" });
        }

        const mine = await listSubmissionsBySub(user.sub);
        const activeCount = mine.filter((s) => ACTIVE_SUBMISSION_STATUSES.has(String(s.status ?? "pending"))).length;

        if (activeCount >= MAX_ACTIVE_SUBMISSIONS) {
            return reply.code(409).send({ error: `You can only have ${MAX_ACTIVE_SUBMISSIONS} active submissions at a time` });
        }
    

        try {
            const row = await createSubmission({
                ...(b as SubmissionInput), user_sub: user.sub, ...normalizeAiUsage(b),
            });
            // Post the review card, persist where it landed so later events can edit it,
            // then drop the builder's own controls into the thread — ephemeral, so only
            // they see them. The row from createSubmission predates the Slack ref, so
            // hand postBuilderControls the ref explicitly.
            notifySlackOfNewSubmission(user, row)
                .then(async (ref) => {
                    if (!ref) return;
                    await setSubmissionSlackRef(row.id, ref.channel, ref.ts);
                    const slackId = await getSlackIdForSub(user.sub);
                    if (!slackId) {
                        req.log.info({ sub: user.sub }, "no slack_id — builder gets no thread controls");
                        return;
                    }
                    await postBuilderControls(
                        "project",
                        { ...row, slack_channel: ref.channel, slack_ts: ref.ts },
                        "pending",
                        slackId,
                    );
                })
                .catch((err: unknown) => req.log.error(err, "slack notify failed"));
            return reply.code(201).send({ ok: true, id: row.id });
        } catch (err) {
            req.log.error(err, "submission failed");
            return reply.code(500).send({ error: "Submission failed" });
        }
    });

    // Owner reship: edit a submission that a reviewer sent back, flipping it to pending.
    app.patch('/api/submissions/:id', async (req, reply) => {
        const user = getSessionUser(req);
        if (!user) return reply.status(401).send({ error: 'Unauthorized' });

        const { id } = req.params as { id: string };
        const row = await getSubmissionById(id);
        if (!row) return reply.code(404).send({ error: 'Not found' });
        if (row.user_sub !== user.sub) return reply.code(403).send({ error: 'Not your submission' });
        if (row.status !== 'changes_requested') {
            return reply.code(409).send({ error: 'Only submissions with requested changes can be reshipped' });
        }

        const b = (req.body ?? {}) as Partial<SubmissionInput>;
        // A reship can change the code, so it can change the AI story too — re-ask
        // rather than silently carrying the old answer forward.
        const required: (keyof SubmissionInput)[] = ["title", "code_url", "playable_url", "description", "screenshot_url"];
        for (const k of required) {
            if (!b[k] || String(b[k]).trim() === "") return reply.code(400).send({ error: `Missing field: ${k}` });
        }
        const aiErr = validateAiUsage(b);
        if (aiErr) return reply.code(400).send({ error: aiErr });
        if (b.demo_video_url && !/^https:\/\//i.test(b.demo_video_url.trim())) {
            return reply.code(400).send({ error: "Demo video URL must be an https link" });
        }

        const patch = {
            title: b.title, code_url: b.code_url, playable_url: b.playable_url,
            description: b.description, screenshot_url: b.screenshot_url, demo_video_url: b.demo_video_url,
            ...normalizeAiUsage(b),
        };
        const updated = await resubmitSubmission(id, patch);
        if (!updated) return reply.code(500).send({ error: 'Update failed' });

        // Reuse the original review message: reply in-thread and restore the buttons.
        if (row.slack_channel && row.slack_ts) {
            const ch = String(row.slack_channel), ts = String(row.slack_ts);
            postInThread(ch, ts, `♻️ *${user.name ?? 'The submitter'}* reshipped — ready for another look.`)
                .then(() => updateSubmissionCard(ch, ts, updated, 'pending'))
                .catch((err: unknown) => req.log.error(err, "reship notify failed"));
        }
        return reply.code(200).send({ ok: true });
    });

    app.get("/api/github/check", async (req, reply) => {
        const user = getSessionUser(req);
        if (!user) return reply.status(401).send({ error: 'Unauthorized' });

        const url = (req.query as { url?: string }).url;
        if (!url) return reply.code(400).send({ error: "Missing url query param" });

        return checkGithubRepo(url)
    });


    app.post('/api/slack/interactivity', async (req, reply) => {
        if (!verifySlackSignature(req as any)) return reply.code(401).send("Bad Signature");

        const payload = JSON.parse((req.body as URLSearchParams).get("payload") ?? "{}");

        // --- reviewer submitted the "request changes" modal ---
        if (payload.type === "view_submission" && payload.view?.callback_id === "request_changes_modal") {
            const meta = JSON.parse(payload.view.private_metadata || "{}");
            const { id, channel, ts } = meta;
            const kind: ReviewKind = meta.kind === "pitch" ? "pitch" : "project";
            const feedback = String(payload.view.state?.values?.feedback?.value?.value ?? "").trim();
            if (!feedback) {
                return reply.code(200).send({ response_action: "errors", errors: { feedback: "Please describe what needs to change." } });
            }

            // Acking closes the modal; the Airtable + Slack work happens after.
            reply.code(200).send({ response_action: "clear" });

            void (async () => {
                try {
                    const reviewer = payload.user?.username ?? payload.user?.id;
                    const isPitch = kind === "pitch";

                    if (isPitch) await requestPitchChanges(id, reviewer, feedback);
                    else await requestSubmissionChanges(id, reviewer, feedback);

                    const row = isPitch ? await getPitchById(id) : await getSubmissionById(id);
                    if (!row) return;

                    const quoted = feedback.replace(/\n/g, "\n>");
                    await postInThread(channel, ts, `✏️ <@${payload.user.id}> requested changes:\n>${quoted}`);
                    await updateReviewCard(kind, channel, ts, row, "changes_requested", payload.user.id);

                                        const slackId = await getSlackIdForSub(String(row.user_sub));
                    if (slackId) {
                        await postBuilderControls(
                            kind,
                            { ...row, slack_channel: channel, slack_ts: ts },
                            "changes_requested",
                            slackId,
                        );
                        const link = isPitch ? pitchEditLink(id) : editLink(id);
                        await dmUser(slackId, `Your Omega ${isPitch ? "pitch" : "submission"} *${row.title}* needs changes:\n\n>${quoted}\n\nReship it here: ${link}`);
                    }
                } catch (err) {
                    req.log.error(err, "request_changes handling failed");
                }
            })();
            return;
        }

        // --- button click ---
        if (payload.type !== "block_actions") return reply.code(200).send();

        const action = payload.actions?.[0];
        if (!action?.value) return reply.code(400).send();
        // Buttons carry `kind:id`; cards posted before pitches existed carry a bare id.
        const { kind, id } = parseActionValue(String(action.value));
        const isPitch = kind === "pitch";

        // --- builder controls -------------------------------------------------
        // These live in an ephemeral message only the builder can see. But visibility
        // is NOT the gate: Slack ephemerals are best-effort UX, and we must never let
        // "they couldn't see the button" be the reason someone can't press it. The
        // gate is below — the clicker's Slack id must match the row's owner.
        // This branch must precede the isReviewer check, which would otherwise turn
        // the builder away from their own controls.
                if (BUILDER_ACTIONS.has(String(action.action_id))) {
            reply.code(200).send();   // ack inside Slack's 3s window, then work

            void (async () => {
                try {
                    const row = isPitch ? await getPitchById(id) : await getSubmissionById(id);
                    if (!row) return;

                    // Visibility is only UX. Ownership is always checked from the row.
                    const ownerSlackId = await getSlackIdForSub(String(row.user_sub));
                    const clicker = String(payload.user?.id ?? "");
                    if (!ownerSlackId || ownerSlackId !== clicker) {
                        await respondEphemeral(
                            payload.response_url,
                            "These controls belong to the builder who submitted this.",
                        );
                        return;
                    }

                    const state = String(row.status ?? "pending");
                    if (action.action_id === "builder_reship") {
                        if (state !== "changes_requested") {
                            await respondEphemeral(
                                payload.response_url,
                                `This ${isPitch ? "pitch" : "submission"} cannot be reshipped because it is ${state}.`,
                            );
                        }
                        // Slack already opened the URL. The website independently checks
                        // the signed-in account and status before loading or saving edits.
                        return;
                    }

                    if (state !== "pending" && state !== "changes_requested") {
                        await respondEphemeral(
                            payload.response_url,
                            `You can't withdraw this — it's already ${state}.`,
                        );
                        return;
                    }

                    if (isPitch) await withdrawPitch(id);
                    else await withdrawSubmission(id);

                    const ch = String(row.slack_channel ?? payload.channel?.id ?? "");
                    const t = String(row.slack_ts ?? payload.message?.ts ?? "");
                    if (ch && t) {
                        await postInThread(ch, t, `🗑 <@${clicker}> withdrew this — it's out of the review queue.`);
                        await updateReviewCard(kind, ch, t, row, "withdrawn", clicker);
                    }
                } catch (err) {
                    req.log.error(err, "builder action failed");
                }
            })();
            return;
        }

        // Signature proves the request is from Slack; this proves the clicker may review.
        if (!isReviewer(payload.user?.id)) {
            await fetch(payload.response_url, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ response_type: "ephemeral", text: "You're not a reviewer." }),
            });
            return reply.code(200).send();
        }

        const row = isPitch ? await getPitchById(id) : await getSubmissionById(id);
        if (!row) return reply.code(200).send();
        const channel = String(row.slack_channel ?? payload.channel?.id ?? "");
        const ts = String(row.slack_ts ?? payload.message?.ts ?? "");

        // The modal must open within trigger_id's ~3s window — before acking.
        if (action.action_id === "request_changes") {
            try {
                await openChangesModal(payload.trigger_id, kind, id, channel, ts);
            } catch (err) {
                req.log.error(err, "open changes modal failed");
            }
            return reply.code(200).send();
        }

        // Approve/reject touch Airtable (and YSWS) — too slow for Slack's 3s. Ack first.
        reply.code(200).send();

        void (async () => {
            const approved = action.action_id === "approve_submission";
            try {
                if (isPitch) {
                    if (approved) await approvePitch(id, payload.user?.username);
                    else await rejectPitch(id, payload.user?.username);
                } else {
                    if (approved) await approveSubmission(id, payload.user?.username);
                    else await rejectSubmission(id, payload.user?.username);
                }
                await updateReviewCard(kind, channel, ts, row, approved ? "approved" : "rejected", payload.user.id);

                const slackId = await getSlackIdForSub(String(row.user_sub));
                if (slackId) {
                    let msg: string;
                    if (isPitch) {
                        msg = approved
                            // An approved pitch is what unlocks project submission — say so.
                            ? `💡 Your Omega pitch *${row.title}* was approved — start building! Submit the finished project here: ${frontendUrl()}/submit`
                            : `Your Omega pitch *${row.title}* was rejected. Ask in #omega if you'd like context.`;
                    } else {
                        msg = approved
                            ? `🎉 Your Omega submission *${row.title}* was approved!`
                            : `Your Omega submission *${row.title}* was rejected. Ask in #omega if you'd like context.`;
                    }
                    await dmUser(slackId, msg);
                }
            } catch (err) {
                req.log.error(err, "approval/rejection failed");
                if (channel && ts) await postInThread(channel, ts, `⚠️ Failed to process: ${String(err)}`).catch(() => {});
            }
        })();
    });
}