// Pure GitHub API helpers — no fastify/auth imports, so any route can use them.
// A token is optional but strongly recommended: it lifts the rate limit from
// 60 req/hr (per IP, unauthenticated) to 5,000 req/hr. No scopes are required.

const API = "https://api.github.com";
const TOKEN = process.env.GITHUB_TOKEN;

// Below this many non-whitespace characters, a README is "too small" to be a
// real project writeup. Tuned to flag a bare title + one line, not a full doc.
const MIN_README_CHARS = 250;

export type GithubCheck = {
    /** Whether the URL even points at github.com — non-GitHub code hosts are skipped, not failed. */
    host: "github" | "other";
    repo: { owner: string; name: string } | null;
    exists: boolean;
    /** true only if we could fetch it as a public repo. */
    isPublic: boolean;
    readme: {
        found: boolean;
        chars: number;
        tooSmall: boolean;
        rawUrl: string | null;   // raw.githubusercontent.com URL — for the dashboard to fetch/link
        htmlUrl: string | null;  // github.com blob URL — for "open on GitHub"
        path: string | null;     // e.g. "README.md" or "docs/README.md"
} | null;

    /** Set when the check itself failed (rate limit, network) rather than the repo being bad. */
    error?: string;
};

/** Parse an owner/repo out of a GitHub URL. Returns null for any non-GitHub host. */
export function parseGithubRepo(raw: string): { owner: string; repo: string } | null {
    try {
        const u = new URL(raw.trim());
        if (!/(^|\.)github\.com$/i.test(u.hostname)) return null;
        const [owner, repo] = u.pathname.replace(/^\/+/, "").split("/");
        if (!owner || !repo) return null;
        return { owner, repo: repo.replace(/\.git$/i, "") };
    } catch {
        return null;
    }
}

function headers(accept = "application/vnd.github+json"): Record<string, string> {
    return {
        Accept: accept,
        // GitHub rejects requests with no User-Agent.
        "User-Agent": "omega-ysws-review",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    };
}

/** Verifies a code URL points at a fetchable public GitHub repo with a substantive README. */
export async function checkGithubRepo(url: string): Promise<GithubCheck> {
    const parsed = parseGithubRepo(url);
    if (!parsed) {
        return { host: "other", repo: null, exists: false, isPublic: false, readme: null };
    }
    const repo = { owner: parsed.owner, name: parsed.repo };
    const base: GithubCheck = { host: "github", repo, exists: false, isPublic: false, readme: null };

    try {
        // 1. Repo metadata. A private repo returns 404 to unauthenticated/foreign
        //    callers — indistinguishable from "doesn't exist", which is fine here:
        //    either way a reviewer can't open it.
        const meta = await fetch(`${API}/repos/${parsed.owner}/${parsed.repo}`, { headers: headers() });

        if (meta.status === 404) return { ...base, exists: false, isPublic: false };
        if (meta.status === 403 || meta.status === 429) {
            return { ...base, error: "GitHub rate limit hit — try again shortly" };
        }
        if (!meta.ok) return { ...base, error: `GitHub error ${meta.status}` };

        const data = (await meta.json()) as { private?: boolean };
        const isPublic = data.private === false;
        if (!isPublic) return { ...base, exists: true, isPublic: false };

        // 2. README. The /readme endpoint returns the primary readme regardless of
        //    name or folder. `Accept: raw` gives us the decoded body directly.
        const rd = await fetch(`${API}/repos/${parsed.owner}/${parsed.repo}/readme`, {
            headers: headers(),
        });

        if (rd.status === 404) {
            return { ...base, exists: true, isPublic: true, readme: { found: false, chars: 0, tooSmall: true, rawUrl: null, htmlUrl:null, path:null } };
        }
        if (!rd.ok) {
            return { ...base, exists: true, isPublic: true, error: `README fetch failed (${rd.status})` };
        }

        const rdData = (await rd.json()) as {
            content?: string; encoding?: string;
            download_url?: string; html_url?: string; path?: string;
        };
        const text = rdData.encoding === "base64" && rdData.content
            ? Buffer.from(rdData.content, "base64").toString("utf-8")
            : "";
        const chars = text.replace(/\s+/g, "").length; // meaningful content, not raw bytes
        return {
            ...base,
            exists: true,
            isPublic: true,
            readme: { found: true, chars, tooSmall: chars < MIN_README_CHARS, rawUrl: rdData.download_url ?? null, htmlUrl: rdData.html_url ?? null, path: rdData.path ?? null },
        };
    } catch (err) {
        return { ...base, error: `Could not reach GitHub: ${String(err)}` };
    }
}

export type ReadmeResult = {
    found: boolean;
    rawUrl: string | null;
    htmlUrl: string | null;
    path: string | null;
    content: string;   // decoded markdown, ready to render
    chars: number;
};

/** Fetches just the primary README of a repo. For the review dashboard to
 *  render or link the raw file. Returns found:false if the repo/readme is
 *  missing or unreachable. */
export async function fetchReadme(url: string): Promise<ReadmeResult> {
    const empty: ReadmeResult = { found: false, rawUrl: null, htmlUrl: null, path: null, content: "", chars: 0 };
    const parsed = parseGithubRepo(url);
    if (!parsed) return empty;

    try {
        const rd = await fetch(`${API}/repos/${parsed.owner}/${parsed.repo}/readme`, { headers: headers() });
        if (!rd.ok) return empty;

        const data = (await rd.json()) as {
            content?: string; encoding?: string;
            download_url?: string; html_url?: string; path?: string;
        };
        const content = data.encoding === "base64" && data.content
            ? Buffer.from(data.content, "base64").toString("utf-8")
            : "";
        return {
            found: true,
            rawUrl: data.download_url ?? null,
            htmlUrl: data.html_url ?? null,
            path: data.path ?? null,
            content,
            chars: content.replace(/\s+/g, "").length,
        };
    } catch {
        return empty;
    }
}
