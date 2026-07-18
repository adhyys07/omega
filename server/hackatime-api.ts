// Pure Hackatime API helpers — no fastify/auth imports, so both the route file
// (hackatime.ts) and the auth callback (auth.ts) can use it without a cycle.

const BASE = process.env.HACKATIME_BASE_URL || "https://hackatime.hackclub.com";

const PROJECTS_SINCE = process.env.HACKATIME_PROJECTS_SINCE?.trim() || "";

// The project-details stats window defaults to the last year server-side, which would
// clamp `first_heartbeat` for anything older. Ask for the full history, then filter
// to the Omega window in this helper so every caller sees the same list.
// `end_date` is deliberately omitted: it parses as midnight, which would drop today's
// heartbeats (and any project started today). Unset, it defaults to now.
const EPOCH_START = "2015-01-01";

export type HackatimeProject = {
    name: string;
    total_seconds?: number;
    /** ISO 8601 timestamp of the project's earliest heartbeat — its start date. */
    first_heartbeat?: string | null;
    last_heartbeat?: string | null;
    languages?: string[];
    archived?: boolean;
};

/** Fetch the user's projects with `first_heartbeat` / `last_heartbeat` included.
 *  Uses the stats endpoint (needs the `read` scope) rather than
 *  /authenticated/projects, which omits any start-date field. */
export async function fetchHackatimeProjectDetails(accessToken: string): Promise<HackatimeProject[]> {
    const url = new URL(`${BASE}/api/v1/users/my/projects/details`);
    url.searchParams.set("start_date", EPOCH_START);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
        throw new Error(`Failed to fetch Hackatime project details: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { projects?: HackatimeProject[] };
    const projects = data.projects ?? [];

    // Only apply a start-date cutoff when it is explicitly configured and valid.
    // A future cutoff date would hide every project, so ignore it.
    const cutoff = PROJECTS_SINCE ? new Date(`${PROJECTS_SINCE}T00:00:00`).getTime() : Number.NaN;
    const hasCutoff = Number.isFinite(cutoff) && cutoff <= Date.now();
    if (!hasCutoff) return projects;

    return projects.filter((project) => {
        if (!project.first_heartbeat) return false;
        const started = new Date(project.first_heartbeat).getTime();
        return Number.isFinite(started) && started >= cutoff;
    });
}

/** Fetch the user's Hackatime trust level (e.g. "red", "yellow", "green", "blue").
 *  Returns null if the call fails or the token lacks the `profile` scope. */
export async function fetchHackatimeTrustLevel(accessToken: string): Promise<string | null> {
    try {
        const res = await fetch(`${BASE}/api/v1/authenticated/me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { trust_factor?: { trust_level?: string } };
        return data.trust_factor?.trust_level ?? null;
    } catch {
        return null;
    }
}
