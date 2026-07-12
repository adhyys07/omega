// Duplicate-idea detection for pitches — reviewer-facing only.
//
// Two stages, because sending every existing pitch to a model on each submission
// scales badly: a free local text-overlap prefilter shortlists a handful of
// candidates, then ONE model call judges whether any are genuinely the same idea.
//
// The endpoint is OpenAI-compatible (Hack Club AI, or any drop-in replacement).
// If HC_AI_KEY is unset the whole feature no-ops — it must never block a pitch.

const AI_BASE = process.env.HC_AI_BASE_URL ?? "https://ai.hackclub.com/api/v1";
const AI_KEY = process.env.HC_AI_KEY;
const AI_MODEL = process.env.HC_AI_MODEL;

/** Below this Jaccard score, shared words are coincidence rather than a shared idea. */
const PREFILTER_FLOOR = 0.08;
/** The model must be at least this confident before we show a reviewer anything. */
const MIN_CONFIDENCE = 0.6;

export type Candidate = { id: string; title: string; description: string };
export type SimilarPitch = { id: string; title: string; reason: string; score: number };

/** The reviewer-only verdict we persist on a pitch. */
export type DuplicateCheck = {
    checkedAt: string;
    matches: SimilarPitch[];
};

export function aiEnabled(): boolean {
    return !!AI_KEY;
}

/** Normalized word set. Short words are dropped — they carry no signal. */
function tokens(s: string): Set<string> {
    return new Set(
        s.toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((w) => w.length > 3),
    );
}

/** Jaccard overlap |A∩B| / |A∪B| — cheap, local, good enough to shortlist. */
function jaccard(a: Set<string>, b: Set<string>): number {
    if (!a.size || !b.size) return 0;
    let hits = 0;
    for (const t of a) if (b.has(t)) hits++;
    return hits / (a.size + b.size - hits);
}

/** Stage 1 — the most textually-overlapping existing pitches. No API call. */
export function shortlist(
    pitch: { title: string; description: string },
    corpus: Candidate[],
    take = 5,
): Candidate[] {
    const mine = tokens(`${pitch.title} ${pitch.description}`);
    return corpus
        .map((c) => ({ c, score: jaccard(mine, tokens(`${c.title} ${c.description}`)) }))
        .filter((x) => x.score > PREFILTER_FLOOR)
        .sort((a, b) => b.score - a.score)
        .slice(0, take)
        .map((x) => x.c);
}

/** Strips ```json fences — models add them even when told not to. */
function parseJson<T>(raw: string): T | null {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
    try { return JSON.parse(cleaned) as T; } catch { return null; }
}

/** Stage 2 — one call: which shortlisted pitches are actually the same idea? */
export async function findDuplicates(
    pitch: { title: string; description: string; why: string },
    candidates: Candidate[],
): Promise<SimilarPitch[]> {
    if (!AI_KEY || !candidates.length) return [];

    const prompt = `You are screening project pitches for DUPLICATE IDEAS.

NEW PITCH
Title: ${pitch.title}
Building: ${pitch.description}
Helps people by: ${pitch.why}

EXISTING PITCHES
${candidates.map((c, i) => `[${i}] id=${c.id}\nTitle: ${c.title}\nBuilding: ${c.description}`).join("\n\n")}

Which existing pitches are SUBSTANTIALLY THE SAME IDEA as the new one? Two pitches
are the same idea only if they solve the same problem, for the same users, in
essentially the same way. Sharing a category is NOT enough: two games are not
duplicates, two fitness apps are not duplicates, and two todo apps with different
angles are not duplicates. Be conservative — a false accusation is worse than a miss.

Respond with ONLY a JSON array. No prose, no markdown fences:
[{"id":"<id from the list above>","score":<0.0-1.0 confidence>,"reason":"<one sentence>"}]
Return [] if none are duplicates.`;

    const res = await fetch(`${AI_BASE}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${AI_KEY}`,
        },
        body: JSON.stringify({
            ...(AI_MODEL ? { model: AI_MODEL } : {}),
            messages: [{ role: "user", content: prompt }],
            temperature: 0, // determinism beats creativity for a judgment call
        }),
        // Without this a 302 to the login page becomes a 200 of HTML, sails past
        // the status check below, and dies as an opaque JSON parse error.
        redirect: "manual",
    });

    if (res.status >= 300 && res.status < 400) {
        throw new Error(`AI endpoint redirected (${res.status}) — HC_AI_BASE_URL is wrong or the key was not accepted`);
    }
    if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 200)}`);

    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("json")) {
        throw new Error(`AI returned ${ctype || "non-JSON"} (probably a login page) — check HC_AI_BASE_URL`);
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const parsed = parseJson<SimilarPitch[]>(data.choices?.[0]?.message?.content ?? "");
    if (!Array.isArray(parsed)) return [];

    // Trust the judgment; never trust the model to invent valid record ids.
    const byId = new Map(candidates.map((c) => [c.id, c]));
    return parsed
        .filter((p) => byId.has(p.id) && typeof p.score === "number" && p.score >= MIN_CONFIDENCE)
        .map((p) => ({
            id: p.id,
            title: byId.get(p.id)!.title,
            score: p.score,
            reason: String(p.reason ?? "").slice(0, 300),
        }));
}
