import type { FastifyInstance } from "fastify";
import { getSessionUser } from "./auth.ts";
import { createSubmission, approveSubmission, rejectSubmission,listSubmissionsBySub, type SubmissionInput } from "./db.ts";
import { notifySlackOfNewSubmission, verifySlackSignature } from "./slack.ts";


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

    app.post('/api/submissions', async (req, reply) => {
        const user = getSessionUser(req);
        if (!user) return reply.status(401).send({ error: 'Unauthorized' });

        const b = (req.body ?? {}) as Partial<SubmissionInput>;
        const required: (keyof SubmissionInput)[] = ["title", "code_url", "playable_url", "description"];
        for (const k of required) {
            if (!b[k] || String(b[k]).trim() === "") return reply.code(400).send({ error: `Missing field: ${k}` });
        }

        if (b.demo_video_url && !/^https:\/\//i.test(b.demo_video_url.trim())) {
            return reply.code(400).send({ error: "Demo video URL must be an https link" });
        }

        if (b.hackatime_start_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.hackatime_start_date)) {
            return reply.code(400).send({ error: "Hackatime start date must be a YYYY-MM-DD date" });
        }

        try {
            const row = await createSubmission({ ...(b as SubmissionInput), user_sub: user.sub });
            notifySlackOfNewSubmission(user, row).catch((err: unknown) => req.log.error(err, "slack notify failed"));
            return reply.code(201).send({ ok: true, id: row.id });
        } catch (err) {
            req.log.error(err, "submission failed");
            return reply.code(500).send({ error: "Submission failed" });
        }
    });

    app.post('/api/slack/interactivity', async (req, reply) => {
        if (!verifySlackSignature(req as any)) return reply.code(401).send("Bad Signature");

        const payload = JSON.parse((req.body as URLSearchParams).get("payload") ?? "{}");
        const action = payload?.actions?.[0];
        const id: string | undefined = action?.value;
        if (!id) return reply.code(400).send();

        const approved = action.action_id === "approve_submission";
        try {
            if (approved) await approveSubmission(id, payload.user?.username);
            else await rejectSubmission(id, payload.user?.username);
        } catch (err) {
            req.log.error(err, "submission approval/rejection failed");
            await fetch(payload.response_url, { method: "POST", headers:{ "Content-Type": "application/json"}, body: JSON.stringify({ text: `Error processing submission: ${String(err)}` }), });
            return reply.code(200).send();
        }

        await fetch(payload.response_url, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                replace_original: true,
                text: `Submission ${approved ? "✅ *approved* (promoted to YSWS)" : "❌ *rejected*"} by <@${payload.user.id}>`,
            }),
        });
        return reply.code(200).send();
    });
}