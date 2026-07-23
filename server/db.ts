import type { HcUser } from "./auth.ts";

// --- Airtable REST client ---------------------------------------------------
// The whole platform is backed by an Airtable base instead of Postgres. Tables
// are referenced by name; record IDs (rec…) are the canonical `id` for shop
// items and orders. auth_users is keyed by the OIDC `sub` (a field), so writes
// there look the record up by `sub` first to get its Airtable record id.

const API = "https://api.airtable.com/v0";
const BASE_ID = process.env.AIRTABLE_BASE_ID!;
const PAT = process.env.AIRTABLE_PAT!;

const TABLE = {
    authUsers: "auth_users",
    shopItems: "shop_items",
    orders: "orders",
    signups: "signups",
    tokenAdjustments: "token_adjustments",
    pitches: "pitches",
    projectSubmissions: "project_submissions",
    yswsSubmissions: "YSWS Project Submission",
} as const;


export type Assessment = { tier: string; approved_hours: number };

export type ApprovalSubmissionOptions = {
    approvedHours?: number;
    tier?: string;
    overrideHourJustification?: string;
    userFeedback?: string;
};

export async function setSubmissionAssessment(id: string, a: Assessment): Promise<Row |null> {
    return updateRecord(TABLE.projectSubmissions, id, {
        tier: a.tier,
        approved_hours: a.approved_hours,
    });
}

export type PayoutResult =
    | { ok: true; tokens: number; alreadyPaid: false }
    | { ok: true; tokens: number; alreadyPaid: true }
    | { ok: false; error: string };

export type ShopOrderResult =
    | { ok: true; order: Row; tokens: number }
    | { ok: false; error: string };

type AirtableRecord = { id: string; createdTime: string; fields: Record<string, unknown> };
export type Row = { id: string } & Record<string, unknown>;

/** A record shaped for consumers: the Airtable field bag flattened, with the
 *  record id exposed as `id`. */
function flatten(rec: AirtableRecord): Row {
    // Expose Airtable's intrinsic record-creation time as `created`, so nothing
    // has to manage a created_at field by hand (#6 — native created time).
    return { id: rec.id, created: rec.createdTime, ...rec.fields };
}

/** Escape a value for interpolation into an Airtable filterByFormula string literal. */
function esc(value: string): string {
    return value.replace(/'/g, "\\'");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function at(path: string, init?: RequestInit, attempt = 0): Promise<any> {
    const res = await fetch(`${API}/${BASE_ID}/${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${PAT}`,
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
        },
    });
    // Airtable allows only 5 req/sec per base. Back off and retry on 429 rather
    // than surfacing a 500 to the caller. Honor Retry-After when present.
    if (res.status === 429 && attempt < 4) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
        await sleep(waitMs);
        return at(path, init, attempt + 1);
    }
    if (!res.ok) {
        const body = await res.text();
        const err = new Error(`Airtable ${res.status} on ${path}: ${body}`) as Error & { status?: number };
        err.status = res.status;
        throw err;
    }
    return res.json();
}

type SortSpec = { field: string; direction: "asc" | "desc" };

/** Fetch every record from a table (following pagination), optionally filtered/sorted. */
async function listAll(
    table: string,
    opts: { filterByFormula?: string; sort?: SortSpec[] } = {},
): Promise<Row[]> {
    const out: Row[] = [];
    let offset: string | undefined;
    do {
        const params = new URLSearchParams({ pageSize: "100" });
        if (opts.filterByFormula) params.set("filterByFormula", opts.filterByFormula);
        opts.sort?.forEach((s, i) => {
            params.set(`sort[${i}][field]`, s.field);
            params.set(`sort[${i}][direction]`, s.direction);
        });
        if (offset) params.set("offset", offset);
        const data = await at(`${encodeURIComponent(table)}?${params}`);
        out.push(...(data.records as AirtableRecord[]).map(flatten));
        offset = data.offset;
    } while (offset);
    return out;
}

async function getRecordById(table: string, id: string): Promise<Row | null> {
    try {
        const data = await at(`${encodeURIComponent(table)}/${id}`);
        return flatten(data as AirtableRecord);
    } catch (err) {
        if ((err as { status?: number }).status === 404) return null;
        throw err;
    }
}



async function findOne(table: string, formula: string): Promise<Row | null> {
    const params = new URLSearchParams({ filterByFormula: formula, maxRecords: "1" });
    const data = await at(`${encodeURIComponent(table)}?${params}`);
    const rec = (data.records as AirtableRecord[])[0];
    return rec ? flatten(rec) : null;
}

async function createRecord(table: string, fields: Record<string, unknown>): Promise<Row> {
    const data = await at(encodeURIComponent(table), {
        method: "POST",
        // typecast lets us write select options by name (auto-creating them) and
        // parse loose date strings — e.g. a brand-new shop-item `category`.
        body: JSON.stringify({ fields, typecast: true }),
    });
    return flatten(data as AirtableRecord);
}

async function updateRecord(table: string, id: string, fields: Record<string, unknown>): Promise<Row | null> {
    try {
        const data = await at(`${encodeURIComponent(table)}/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ fields, typecast: true }),
        });
        return flatten(data as AirtableRecord);
    } catch (err) {
        if ((err as { status?: number }).status === 404) return null;
        throw err;
    }
}

async function deleteRecord(table: string, id: string): Promise<boolean> {
    try {
        const data = await at(`${encodeURIComponent(table)}/${id}`, { method: "DELETE" });
        return Boolean(data.deleted);
    } catch (err) {
        if ((err as { status?: number }).status === 404) return false;
        throw err;
    }
}

export async function payoutSubmission(
    id: string,
    tokens: number,
    reviewerSub: string | null,
): Promise<PayoutResult> {
    const s = await getSubmissionById(id);
    if (!s) return { ok: false, error: "Submission not found" };

    // The idempotency guard. `paid_at` is the field we set below; reading anything
    // else here (there is no `paid` field) would mean the guard never trips and every
    // retry pays again. A second approve reads paid_at and walks away.
    if (s.paid_at) return { ok: true, tokens: Number(s.payout_tokens ?? 0), alreadyPaid: true };
    const sub = String(s.user_sub ?? "");
    if (!sub) return { ok: false, error: "Submission has no user_sub" };

    // Order matters: CLAIM (write paid_at) before CREDIT. If the process dies between
    // the two, we've under-paid — a claim with no credit, visible and fixable by hand.
    // The other order risks paying twice, which isn't recoverable. Fail toward owing.
    await updateRecord(TABLE.projectSubmissions, id, {
        payout_tokens: tokens,
        paid_at: now(),
    });
     const res = await adjustUserTokens(
        sub, tokens, `Omega payout — ${s.title ?? 'project'} (${s.tier ?? '?'})`, reviewerSub,
    );
    if (!res.ok) {
        // The claim stands but the credit failed. Loud, because it needs a human.
        return { ok: false, error: `PAYOUT CLAIMED BUT NOT CREDITED for ${id}: ${res.error}` };
    }

    // Return the PAYOUT, not res.tokens — that's the user's new balance, a different
    // number the reviewer never asked about.
    return { ok: true, tokens, alreadyPaid: false };
}

const now = () => new Date().toISOString();
const bool = (v: unknown): boolean => v === true;
/** Lookup and linked-record fields come back as arrays; take the first scalar. */
const first = (v: unknown): unknown => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

// --- Signups (email-only landing-page signups) ------------------------------

export async function createSignup(email: string): Promise<{ created: boolean; row?: Row }> {
    const existing = await findOne(TABLE.signups, `LOWER({email})='${esc(email)}'`);
    if (existing) return { created: false };
    const row = await createRecord(TABLE.signups, { email });
    return { created: true, row: { id: row.id, email: row.email, created_at: row.created ?? now() } };
}

export async function countSignups(): Promise<number> {
    const rows = await listAll(TABLE.signups);
    return rows.length;
}

export async function listSignups(): Promise<Row[]> {
    // `created` is Airtable's intrinsic record time (synthesized in flatten), not
    // a real field, so it can't go in the API sort param — order in JS instead.
    const rows = await listAll(TABLE.signups);
    rows.sort((a, b) => String(b.created ?? "").localeCompare(String(a.created ?? "")));
    return rows.map((r) => ({ id: r.id, email: r.email, created_at: r.created ?? null }));
}

// --- Shop items -------------------------------------------------------------

function shopItemView(r: Row): Row {
    return {
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        cost: r.cost,
        category: r.category,
        icon: r.icon ?? "",
        image_url: r.image_url ?? null,
        stock: r.stock ?? null,
        active: bool(r.active),
        sort_order: r.sort_order ?? 0,
    };
}

export async function listActiveShopItems(): Promise<Row[]> {
    const rows = await listAll(TABLE.shopItems, {
        filterByFormula: "{active}=1",
        sort: [{ field: "sort_order", direction: "asc" }],
    });
    // Frontend shop view: drop the admin-only fields.
    return rows.map((r) => {
        const v = shopItemView(r);
        delete (v as Record<string, unknown>).active;
        delete (v as Record<string, unknown>).sort_order;
        return v;
    });
}

export async function listAllShopItems(): Promise<Row[]> {
    const rows = await listAll(TABLE.shopItems, {
        sort: [{ field: "sort_order", direction: "asc" }],
    });
    return rows.map(shopItemView);
}

export async function createShopItem(input: {
    slug: string;
    name: string;
    description: string;
    cost: number;
    category: string;
    icon?: string | null;
    image_url?: string | null;
    stock?: number | null;
    sort_order?: number;
}): Promise<Row> {
    const dup = await findOne(TABLE.shopItems, `{slug}='${esc(input.slug)}'`);
    if (dup) {
        const err = new Error("duplicate slug") as Error & { code?: string };
        err.code = "DUPLICATE_SLUG";
        throw err;
    }
    const fields: Record<string, unknown> = {
        slug: input.slug,
        name: input.name,
        description: input.description,
        cost: input.cost,
        category: input.category,
        active: true,
        sort_order: input.sort_order ?? 0,
    };
    if (input.icon) fields.icon = input.icon;
    if (input.image_url) fields.image_url = input.image_url;
    if (input.stock !== null && input.stock !== undefined) fields.stock = input.stock;
    const row = await createRecord(TABLE.shopItems, fields);
    return shopItemView(row);
}

export async function createShopOrder(input: {
    userSub: string;
    itemId: string;
    note?: string | null;
}): Promise<ShopOrderResult> {
    const user = await findAuthUser(input.userSub);
    if (!user) return { ok: false, error: "User not found" };

    const item = await getRecordById(TABLE.shopItems, input.itemId);
    if (!item) return { ok: false, error: "Item not found" };
    if (!bool(item.active)) return { ok: false, error: "Item is not active" };

    const cost = Number(item.cost ?? 0);
    if (!Number.isFinite(cost) || cost < 0) { return { ok: false, error: "Item has invalid cost" }; }

    const stock = item.stock == null ? null : Number(item.stock);
    if (stock !== null && stock <= 0) { return { ok: false, error: "Item is out of stock" }; }

    const note = String(input.note ?? "").trim() || null;

    const order = await createRecord(TABLE.orders, {
        user: [user.id],
        user_sub: input.userSub,
        item_name: item.name ?? "",
        cost,
        quantity: 1,
        status: "pending",
        shipping: null,
        note,
        tracking: null,
        created_at: now(),
    });

    const charged = await adjustUserTokens(input.userSub, -cost, `Shop order ${order.id} for ${item.name ?? 'item'}`, null);
    if (!charged.ok) {
        await deleteRecord(TABLE.orders, order.id);
        return { ok: false, error: `Failed to charge user: ${charged.error}` };
    }

    if (stock !== null) {
        await updateRecord(TABLE.shopItems, String(item.id), { stock: Math.max(0, stock - 1) });
    }

    return { ok: true, order, tokens: charged.tokens };
}

export async function setShopItemActive(id: string, active: boolean): Promise<Row | null> {
    const row = await updateRecord(TABLE.shopItems, id, { active });
    return row ? { id: row.id, active: bool(row.active) } : null;
}

export async function deleteShopItem(id: string): Promise<boolean> {
    return deleteRecord(TABLE.shopItems, id);
}

// --- Auth users -------------------------------------------------------------

async function findAuthUser(sub: string): Promise<Row | null> {
    const rows = await listAll(TABLE.authUsers, {
        filterByFormula: `{sub}='${esc(sub)}'`,
        sort: [{ field: 'last_login', direction: 'desc' }],
    });
    return rows[0] ?? null;
}

function normalizeAddress(address: HcUser["address"] | undefined) {
    const streetAddress1 = address?.street_address?.trim() || null;
    const locality = address?.locality?.trim() || null;
    const region = address?.region?.trim() || null;
    const postalCode = address?.postal_code?.trim() || null;
    const country = address?.country?.trim() || null;

    const formatted = 
        address?.formatted?.trim() 
        || [streetAddress1, locality, region, postalCode, country].filter(Boolean).join(', ')
        || null;
    
    return {
        address: formatted,
        street_address: streetAddress1,
        locality,
        region,
        postal_code: postalCode,
        country,
    };
}



export async function upsertAuthUser(u: HcUser): Promise<void> {
    const existing = await findAuthUser(u.sub);

        const address = normalizeAddress(u.address);

    const fields: Record<string, unknown> = {
        email: u.email ?? null,
        name: u.name ?? null,
        verification_status: u.verification_status ?? null,
        ysws_eligible: u.ysws_eligible ?? false,
        slack_id: u.slack_id ?? null,
        phone_number: u.phone_number ?? null,
        address: address.address,
        birthdate: u.birthdate ?? null,
        last_login: now(),
    };
    if (existing) {
        await updateRecord(TABLE.authUsers, existing.id, fields);
    } else {
        await createRecord(TABLE.authUsers, {
            sub: u.sub,
            ...fields,
            created_at: now(),
            role: "user",
            banned: false,
            tokens: 0,
        });
    }
}

/** Everyone whose birthday (month + day) is today. Empty birthdates are excluded. */
export async function listBirthdaysToday(): Promise<Row[]> {
    const t = new Date();
    const m = t.getMonth() + 1;
    const d = t.getDate();
    const rows = await listAll(TABLE.authUsers, {
        filterByFormula: `AND({birthdate}, MONTH({birthdate})=${m}, DAY({birthdate})=${d})`,
    });
    return rows.map((r) => ({
        id: r.id,
        sub: r.sub,
        name: r.name ?? null,
        email: r.email ?? null,
        slack_id: r.slack_id ?? null,
        birthdate: r.birthdate ?? null,
    }));
}


export async function adjustUserTokens(sub: string, delta: number, reason: string | null, adminSub: string | null): Promise<{ok : true; tokens: number} | {ok: false; error: string}> {
    // Airtable has no transactions or row locks (the Postgres version used
    // SELECT ... FOR UPDATE), so this is read-then-write: two concurrent
    // adjustments to the same user could race. Acceptable at admin-panel scale.
    const user = await findAuthUser(sub);
    if (!user) return { ok: false, error: 'User not found' };
    const next = Number(user.tokens ?? 0) + delta;
    if (next < 0) return { ok: false, error: 'Insufficient tokens' };
    await updateRecord(TABLE.authUsers, user.id, { tokens: next });
    // Audit-log the adjustment; `user` links to the auth_users record.
    await createRecord(TABLE.tokenAdjustments, {
        user_sub: sub,
        user: [user.id],
        delta,
        reason: reason || null,
        admin_sub: adminSub ?? null,
    });
    return { ok: true, tokens: next };
}

export async function getAuthUserMeta(sub: string): Promise<{ role: string; banned: boolean; tokens: number }> {
    const row = await findAuthUser(sub);
    return { role: (row?.role as string) ?? "user", banned: bool(row?.banned), tokens: Number(row?.tokens ?? 0) };
}

export type AuthUserIdentity = {
    name: string | null;
    email: string | null;
    slack_id: string | null;
    slack_username: string | null;
    role: string;
};

export async function getAuthUserBySub(sub: string): Promise<AuthUserIdentity | null> {
    const row = await findAuthUser(sub);
    if (!row) return null;
    return {
        name: (row.name as string) ?? null,
        email: (row.email as string) ?? null,
        slack_id: (row.slack_id as string) ?? null,
        slack_username: (row.slack_username as string) ?? null,
        role: (row.role as string) ?? "user",
    };
}

export async function setAuthUserRole(sub: string, role: string): Promise<boolean> {
    const row = await findAuthUser(sub);
    if (!row) return false;
    await updateRecord(TABLE.authUsers, row.id, { role });
    return true;
}

export async function setAuthUserBanned(sub: string, banned: boolean): Promise<boolean> {
    const row = await findAuthUser(sub);
    if (!row) return false;
    await updateRecord(TABLE.authUsers, row.id, { banned });
    return true;
}

/** Reconcile a user's ban state with their Hackatime trust level, run on every
 *  login/authorize:
 *    - trust "red"            → ban (follow the banned workflow)
 *    - recovered from "red"   → lift the ban (give normal access again)
 *    - anything else          → leave `banned` untouched, so manual admin bans survive
 *  The last-seen trust level is stored to tell a trust-ban apart from an admin ban. */
export async function syncBanFromTrust(sub: string, trustLevel: string | null): Promise<void> {
    // Null means we couldn't determine trust (fetch failed / no profile scope) —
    // never change ban state on an unknown, or a transient error would auto-unban.
    if (trustLevel === null) return;
    const row = await findAuthUser(sub);
    if (!row) return;
    const prevTrust = (row.hackatime_trust as string) ?? null;

    const fields: Record<string, unknown> = { hackatime_trust: trustLevel };
    if (trustLevel === "red") {
        fields.banned = true;
    } else if (prevTrust === "red") {
        // Trust recovered since last time — clear the trust-based ban.
        fields.banned = false;
    }
    await updateRecord(TABLE.authUsers, row.id, fields);
}

export async function listAuthUsers(): Promise<Record<string, unknown>[]> {
    const rows = await listAll(TABLE.authUsers, { sort: [{ field: "last_login", direction: "desc" }] });
    return rows.map((r) => ({
        sub: r.sub,
        email: r.email ?? null,
        name: r.name ?? null,
        verification_status: r.verification_status ?? null,
        ysws_eligible: bool(r.ysws_eligible),
        slack_id: r.slack_id ?? null,
        slack_username: r.slack_username ?? null,
        role: (r.role as string) ?? "user",
        banned: bool(r.banned),
        hackatime_trust: r.hackatime_trust ?? null,
        tokens: Number(r.tokens ?? 0),
        phone_number: r.phone_number ?? null,
        address: r.address ?? null,
        created_at: r.created ?? null,
        last_login: r.last_login ?? null,
    }));
}

export async function setHackatimeToken(sub: string, token: string | null): Promise<void> {
    const row = await findAuthUser(sub);
    if(!row) return;
    await updateRecord(TABLE.authUsers, row.id, { hackatime_token: token });
}

export async function getHackatimeToken(sub: string): Promise<string | null> {
    const row = await findAuthUser(sub);
    return (row?.hackatime_token as string) ?? null;
}

// --- Phone Number & Address -----------------------------------------------------------------
export async function getAuthUserContact(sub:string,): Promise<{ phone_number: string | null; address: string | null } | null> {
    const row = await findAuthUser(sub);
    if (!row) return null;
    return { phone_number: (row.phone_number as string) ?? null, address: (row.address as string) ?? null };
}

// -- Submissions -----------------------------------------------------------------
export type SubmissionInput = {
    user_sub: string;
    /** The approved pitch this project fulfills — required; you pitch before you build. */
    pitch_id: string;
    title: string;
    code_url: string;
    playable_url: string;
    description: string;
    screenshot_url?: string;
    demo_video_url?: string;
    /** Did the builder use AI at all? Drives whether ai_disclosure is required. */
    ai_used?: boolean;
    /** What they used AI for. Required only when ai_used is true; empty otherwise. */
    ai_disclosure?: string;
    hackatime_project?: string;
    hackatime_hours?: number | null;
    /** YYYY-MM-DD — the project's first Hackatime heartbeat. */
    hackatime_start_date?: string | null;
    /** Set only by the admin dev stage-seeder. Marks a row wipeSeeded() may delete. */
    seeded?: boolean;
};



export async function createSubmission(input: SubmissionInput): Promise<Row> {
    // Identity (name/email) is pulled from the signed-in user's stored profile —
    // the form never re-asks for personal info.
    const u = await findAuthUser(input.user_sub);
    const [first_name, ...rest] = String(u?.name ?? "").split(" ");
    const fields: Record<string, unknown> = {
        title: input.title,
        user_sub: input.user_sub,
        pitch_id: input.pitch_id,
        code_url: input.code_url,
        playable_url: input.playable_url,
        description: input.description,
        screenshot_url: input.screenshot_url ?? "",
        demo_video_url: input.demo_video_url ?? "",
        ai_used: input.ai_used ?? false,
        ai_disclosure: input.ai_disclosure ?? "",
        hackatime_project: input.hackatime_project ?? null,

        first_name: first_name ?? "",
        last_name: rest.join(" "),
        email: (u?.email as string) ?? "",
        status: "pending",
        seeded: input.seeded ?? false,
        created_at: now(),
    };
    if (input.hackatime_hours !== null && input.hackatime_hours !== undefined) {
        fields.hackatime_hours = input.hackatime_hours;
    }
    if (input.hackatime_start_date) {
        fields.hackatime_start_date = input.hackatime_start_date;
    }
    return createRecord(TABLE.projectSubmissions, fields);
}

export async function getSubmissionById(id: string): Promise<Row | null> {
    return getRecordById(TABLE.projectSubmissions, id);
}

export async function listSubmissions(status?: string): Promise<Row[]> {
    return listAll(
        TABLE.projectSubmissions,
        status ? { filterByFormula: `{status}='${esc(status)}'` } : {},
    );
}

export async function listSubmissionsBySub(sub: string): Promise<Row[]> {
    const rows = await listAll(TABLE.projectSubmissions, {
        filterByFormula: `{user_sub}='${esc(sub)}'`,
    });
    // newest first (created_at is a real field we set on insert)
    rows.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
    return rows.map((r) => ({
        id: r.id,
        title: r.title ?? null,
        status: r.status ?? "pending",
        code_url: r.code_url ?? null,
        hackatime_project: r.hackatime_project ?? null,
        hackatime_start_date: r.hackatime_start_date ?? null,
        review_feedback: r.review_feedback ?? null,
        playable_url: r.playable_url ?? null,
        description: r.description ?? null,
        screenshot_url: r.screenshot_url ?? null,
        demo_video_url: r.demo_video_url ?? null,
        ai_used: bool(r.ai_used),
        ai_disclosure: r.ai_disclosure ?? null,
        badges: Array.isArray(r.badges) ? r.badges : [],
        created_at: r.created_at ?? null,
    }));
}

/** The project that fulfilled a given pitch, if one has been submitted yet.
 *  `pitch_id` is plain text holding a record id — the relationship lives in the app,
 *  not in Airtable — so this is a scan by formula rather than a link traversal. */
export async function getSubmissionByPitchId(pitchId: string): Promise<Row | null> {
    const rows = await listAll(TABLE.projectSubmissions, {
        filterByFormula: `{pitch_id}='${esc(pitchId)}'`,
    });
    rows.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
    return rows[0] ?? null;
}

export async function rejectSubmission(id: string, reviewer?: string): Promise<void> {
    await updateRecord(TABLE.projectSubmissions, id, {
        status: "rejected",
        reviewed_by: reviewer ?? null,
        reviewed_at: now(),
    });
}

export async function withdrawSubmission(id: string): Promise<void> {
    await updateRecord(TABLE.projectSubmissions, id, {
        status: "withdrawn", reviewed_at: now(),
    });
}

export async function withdrawPitch(id: string): Promise<void> {
    await updateRecord(TABLE.pitches, id, {
        status: "withdrawn", reviewed_at: now(),
    });
}

export async function approveSubmission(id: string, reviewer?: string, options: ApprovalSubmissionOptions = {}): Promise<Row | null> {
    const s = await getSubmissionById(id);
    if (!s) return null;
    if (s.status === "approved") return s;

    const approvedHours = options.approvedHours ?? (Number(s.approved_hours ?? 0) || null);
    const overrideHourJustification = options.overrideHourJustification ?? null;
    const userFeedback = options.userFeedback ?? null;
    const tier = options.tier ?? (s.tier as string | undefined) ?? null;
    const auth = await findAuthUser(String(s.user_sub ?? ''));

    // Promote submission + reviewer assessment data into the YSWS record.
    const y: Record<string, unknown> = {
        "First Name": s.first_name ?? "",
        "Last Name": s.last_name ?? "",
        "Email": s.email ?? "",
        "Code URL": s.code_url ?? "",
        "Playable URL": s.playable_url ?? "",
        "Description": s.description ?? "",
        "Approved Hours": approvedHours,
        "Override Hour Justification": overrideHourJustification,
        "User Feedback": userFeedback,
        "Tier": tier,
    };

    const addressFields: Record<string, unknown> = {
        "Address": (auth?.address as string) ?? "",
        "Street Address 1": (auth?.street_address as string) ?? "",
        "City": (auth?.locality as string) ?? "",
        "State / Province / Region": (auth?.region as string) ?? "",
        "Postal Code": (auth?.postal_code as string) ?? "",
        "Country": (auth?.country as string) ?? "",
    };

    for (const [field, value] of Object.entries(addressFields)) {
        if (String(value ?? "").trim()) y[field] = value;
    }
    

    const ysws = await createRecord(TABLE.yswsSubmissions, y);

    await updateRecord(TABLE.projectSubmissions, id, {
        status: "approved",
        reviewed_by: reviewer ?? null,
        reviewed_at: now(),
        ysws_record_id: ysws.id,
        review_feedback: userFeedback,
        override_hour_justification: overrideHourJustification,
    });
    return ysws;
}

export async function setSubmissionSlackRef(id: string, channel: string, ts: string): Promise<void> {
  await updateRecord(TABLE.projectSubmissions, id, { slack_channel: channel, slack_ts: ts })
}

export async function requestSubmissionChanges(id: string, reviewer: string, feedback: string): Promise<void> {
  await updateRecord(TABLE.projectSubmissions, id, {
    status: 'changes_requested',
    review_feedback: feedback,
    reviewed_by: reviewer,
    reviewed_at: now(),
  })
}

export async function resubmitSubmission(
    id:string,
    patch: Partial<Pick<SubmissionInput, 'title' | 'code_url' | 'playable_url' | 'description' | 'screenshot_url' | 'demo_video_url' | 'ai_used' | 'ai_disclosure' >>
): Promise<Row | null> {
    return updateRecord(TABLE.projectSubmissions, id, {
        ...patch,
        status: 'pending',
        resubmitted_at: now(),
    });
}

export async function getSlackIdForSub(sub: string): Promise<string | null> {
  const u = await findAuthUser(sub)
  return ((u?.slack_id as string) ?? null) || null
}

/** The OIDC sub behind a Slack user id — the inverse of getSlackIdForSub. */
export async function getSubForSlackId(slackId: string): Promise<string | null> {
    const row = await findOne(TABLE.authUsers, `{slack_id}='${esc(slackId)}'`);
    return (row?.sub as string) ?? null;
}

// --- Pitches ----------------------------------------------------------------
// A pitch is the idea a builder proposes *before* spending 20+ hours on it.
// Reviewers approve/reject it through the same Slack card + thread flow as a
// project submission; an approved pitch is what unlocks project submission.

export type PitchInput = {
    user_sub: string;
    title: string;
    description: string;
    /** How the idea helps people — the second half of the landing-page prompt. */
    why: string;
    reference_file_url?: string | null;
    /** Set only by the admin dev stage-seeder. Marks a row wipeSeeded() may delete. */
    seeded?: boolean;
};

/** The AUTHOR-facing shape of a pitch. This is a whitelist on purpose: anything
 *  not listed here can never reach the person who submitted it. `duplicate_check`
 *  is deliberately absent — it's a reviewer-only signal. */
function pitchView(r: Row): Row {
    return {
        id: r.id,
        title: r.title ?? null,
        description: r.description ?? null,
        why: r.why ?? null,
        status: r.status ?? "pending",
        review_feedback: r.review_feedback ?? null,
        first_name: r.first_name ?? null,
        last_name: r.last_name ?? null,
        created_at: r.created_at ?? null,
    };
}

/** Stores the reviewer-only duplicate-idea verdict as JSON. */
export async function setPitchDuplicateCheck(id: string, check: unknown): Promise<void> {
    await updateRecord(TABLE.pitches, id, { duplicate_check: JSON.stringify(check) });
}

export async function setSubmissionBadges(
    id: string, slugs: string[], reviewer?: string,
): Promise<Row | null> {
    return updateRecord(TABLE.projectSubmissions, id, {
        badges: slugs,
        badges_awarded_by: reviewer ?? null,
        badges_awarded_at: now(),
    });
}

export async function createPitch(input: PitchInput): Promise<Row> {
    const u = await findAuthUser(input.user_sub);
    const [first_name, ...rest] = String(u?.name ?? "").split(" ");
    return createRecord(TABLE.pitches, {
        user_sub: input.user_sub,
        title: input.title,
        reference_file_url: input.reference_file_url ?? null,
        description: input.description,
        why: input.why,
        first_name: first_name ?? "",
        last_name: rest.join(" "),
        email: (u?.email as string) ?? "",
        status: "pending",
        seeded: input.seeded ?? false,
        created_at: now(),
    });
}

export async function getPitchById(id: string): Promise<Row | null> {
    return getRecordById(TABLE.pitches, id);
}

export async function listPitches(status?: string): Promise<Row[]> {
    const rows = await listAll(
        TABLE.pitches,
        status ? { filterByFormula: `{status}='${esc(status)}'` } : {},
    );
    rows.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
    return rows;
}

export async function listPitchesBySub(sub: string): Promise<Row[]> {
    const rows = await listAll(TABLE.pitches, { filterByFormula: `{user_sub}='${esc(sub)}'` });
    rows.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
    return rows.map(pitchView);
}

/** The pitches a user may attach a project to. */
export async function listApprovedPitchesBySub(sub: string): Promise<Row[]> {
    const rows = await listAll(TABLE.pitches, {
        filterByFormula: `AND({user_sub}='${esc(sub)}',{status}='approved')`,
    });
    return rows.map(pitchView);
}

export async function setPitchSlackRef(id: string, channel: string, ts: string): Promise<void> {
    await updateRecord(TABLE.pitches, id, { slack_channel: channel, slack_ts: ts });
}

export async function approvePitch(id: string, reviewer?: string): Promise<void> {
    await updateRecord(TABLE.pitches, id, {
        status: "approved",
        reviewed_by: reviewer ?? null,
        reviewed_at: now(),
    });
}

export async function rejectPitch(id: string, reviewer?: string): Promise<void> {
    await updateRecord(TABLE.pitches, id, {
        status: "rejected",
        reviewed_by: reviewer ?? null,
        reviewed_at: now(),
    });
}

export async function requestPitchChanges(id: string, reviewer: string, feedback: string): Promise<void> {
    await updateRecord(TABLE.pitches, id, {
        status: "changes_requested",
        review_feedback: feedback,
        reviewed_by: reviewer,
        reviewed_at: now(),
    });
}

export async function resubmitPitch(
    id: string,
    patch: Partial<Pick<PitchInput, "title" | "description" | "why" | "reference_file_url">>,
): Promise<Row | null> {
    return updateRecord(TABLE.pitches, id, {
        ...patch,
        status: "pending",
        resubmitted_at: now(),
    });
}

export async function listOrders(status?: string): Promise<Row[]> {
    // The user fields ride along as lookups through the `user` link, so there's
    // no separate auth_users fetch/join — Airtable resolves them for us.
    const orders = await listAll(TABLE.orders, status ? { filterByFormula: `{status}='${esc(status)}'` } : {});
    const rows = orders.map((o) => ({
        id: o.id,
        item_name: o.item_name,
        cost: o.cost,
        quantity: o.quantity ?? 1,
        status: o.status ?? "pending",
        shipping: o.shipping ?? null,
        note: o.note ?? null,
        tracking: o.tracking ?? null,
        created_at: o.created ?? null,
        fulfilled_at: o.fulfilled_at ?? null,
        user_name: first(o.user_name),
        user_email: first(o.user_email),
        user_slack_id: first(o.user_slack_id),
    }));
    // Pending first, then newest-created first — matches the old SQL ordering.
    rows.sort((a, b) => {
        const ap = a.status === "pending" ? 1 : 0;
        const bp = b.status === "pending" ? 1 : 0;
        if (ap !== bp) return bp - ap;
        return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
    });
    return rows;
}

export async function updateOrder(
    id: string,
    patch: { status?: string; tracking?: string; note?: string },
    adminSub?: string | null,
): Promise<Row | null> {
    const fields: Record<string, unknown> = {};
    if (patch.status !== undefined) fields.status = patch.status;
    if (patch.tracking !== undefined) fields.tracking = patch.tracking;
    if (patch.note !== undefined) fields.note = patch.note;
    if (patch.status === "fulfilled") {
        fields.fulfilled_at = now();
        fields.fulfilled_by = adminSub ?? null;
    }
    const row = await updateRecord(TABLE.orders, id, fields);
    if (!row) return null;
    return {
        id: row.id,
        status: row.status,
        tracking: row.tracking ?? null,
        note: row.note ?? null,
        fulfilled_at: row.fulfilled_at ?? null,
    };
}

// --- Dev tools -------------------------------------------------------------
// Used only by the admin stage-seeder (server/dev.ts), which is itself only
// registered when ALLOW_DEV_TOOLS=1.

/** Deletes every SEEDED pitch and submission belonging to `sub`, and nothing else.
 *  The `{seeded}=1` half of each formula is load-bearing: it is what makes a stage
 *  reset unable to destroy a real builder's work, even their own. */
export async function wipeSeeded(sub: string): Promise<{ pitches: number; submissions: number }> {
    const where = `AND({user_sub}='${esc(sub)}',{seeded}=1)`;
    const [pitches, submissions] = await Promise.all([
        listAll(TABLE.pitches, { filterByFormula: where }),
        listAll(TABLE.projectSubmissions, { filterByFormula: where }),
    ]);
    // Sequential on purpose: Airtable caps us at 5 req/sec and a wipe is not hot.
    for (const r of submissions) await deleteRecord(TABLE.projectSubmissions, String(r.id));
    for (const r of pitches) await deleteRecord(TABLE.pitches, String(r.id));
    return { pitches: pitches.length, submissions: submissions.length };
}

export type ReviewDataCleanupOptions = {
    scope?: 'all' | 'seeded' | 'user';
    userSub?: string;
    dryRun?: boolean;
};

export async function cleanupReviewData(options: ReviewDataCleanupOptions = {}): Promise<{
    scope: 'all' | 'seeded' | 'user';
    dryRun: boolean;
    pitches: number;
    submissions: number;
    yswsRows: number;
}> {
    const scope = options.scope ?? 'all';
    const dryRun = options.dryRun !== false;

    let pitchFormula = '';
    let submissionFormula = '';

    if (scope === 'seeded') {
        pitchFormula = '{seeded}=1';
        submissionFormula = '{seeded}=1';
    } else if (scope === 'user') {
        if (!options.userSub) throw new Error('userSub is required when scope=user');
        const sub = esc(options.userSub);
        pitchFormula = `{user_sub}='${sub}'`;
        submissionFormula = `{user_sub}='${sub}'`;
    }

    const [pitches, submissions] = await Promise.all([
        listAll(TABLE.pitches, pitchFormula ? { filterByFormula: pitchFormula } : {}),
        listAll(TABLE.projectSubmissions, submissionFormula ? { filterByFormula: submissionFormula } : {}),
    ]);

    const yswsIds = [...new Set(
        submissions
            .map((s) => String(s.ysws_record_id ?? '').trim())
            .filter(Boolean),
    )];

    if (!dryRun) {
        // Submissions are removed before pitches to avoid leaving dangling pitch_id pointers.
        for (const s of submissions) await deleteRecord(TABLE.projectSubmissions, String(s.id));
        for (const p of pitches) await deleteRecord(TABLE.pitches, String(p.id));
        // Best effort: skip missing YSWS rows and keep cleanup moving.
        for (const yid of yswsIds) {
            try {
                await deleteRecord(TABLE.yswsSubmissions, yid);
            } catch {
                // Ignore failures from external table drift.
            }
        }
    }

    return {
        scope,
        dryRun,
        pitches: pitches.length,
        submissions: submissions.length,
        yswsRows: yswsIds.length,
    };
}
