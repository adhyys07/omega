import type { FastifyInstance } from "fastify";
import { getSessionUser } from "./auth.ts";

const CDN_UPLOAD_URL = "https://cdn.hackclub.com/api/v4/upload";

const IMAGE_EXT: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
};

const VIDEO_EXT: Record<string, string> = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
};

const EXT: Record<string, string> = { ...IMAGE_EXT, ...VIDEO_EXT };

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_VIDEO_BYTES = 64 * 1024 * 1024; // 64MB

export default async function uploadRoutes(app: FastifyInstance) {
    app.addContentTypeParser(/^(image|video)\//, { parseAs: "buffer" }, (_req, body, done) => done(null, body));

    // bodyLimit is the ceiling for any upload; images are held to the tighter limit below.
    app.post('/api/uploads/media', { bodyLimit: MAX_VIDEO_BYTES }, async (req, reply) => {
        const user = getSessionUser(req);
        if (!user) return reply.status(401).send({ error: 'Unauthorized' });

        const key = process.env.CDN_API_KEY;
        if (!key) return reply.status(500).send({ error: 'Upload service not configured' });

        const contentType = String(req.headers["content-type"] ?? "");
        if (!EXT[contentType]) {
            return reply.code(415).send({ error: "Only PNG, JPEG, GIF, WebP images or MP4, WebM, MOV videos are allowed" });
        }

        const bytes = req.body as Buffer;
        if (!bytes || bytes.length === 0) {
            return reply.code(400).send({ error: "No file uploaded" });
        }

        const limit = VIDEO_EXT[contentType] ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
        if (bytes.length > limit) {
            return reply.code(413).send({ error: `File is too large (max ${Math.round(limit / 1024 / 1024)}MB)` });
        }

        const form = new FormData();
        const name = safeName((req.query as { name?: string }).name ?? "", contentType);
        form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), name);

        const res = await fetch(CDN_UPLOAD_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}` },
            body: form,
        });

        if (!res.ok) {
            const err = (await res.json().catch(() => ({}))) as { error?: string };
            req.log.error({ status: res.status, err }, "CDN upload failed");
            return reply.code(502).send({ error: "Upload failed" });
        }

        const data = (await res.json()) as { url: string };
        return { url: data.url };
    });
}

function safeName(raw: string, contentType: string): string {
    const base =
        raw.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 60) || "upload";
    return `${base}${EXT[contentType]}`;
}