// Pure Hackatime API helpers — no fastify/auth imports, so both the route file
// (hackatime.ts) and the auth callback (auth.ts) can use it without a cycle.

const BASE = process.env.HACKATIME_BASE_URL || "https://hackatime.hackclub.com";

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
