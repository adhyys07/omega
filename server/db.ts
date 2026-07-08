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
} as const;

type AirtableRecord = { id: string; createdTime: string; fields: Record<string, unknown> };
type Row = { id: string } & Record<string, unknown>;

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

export async function setShopItemActive(id: string, active: boolean): Promise<Row | null> {
    const row = await updateRecord(TABLE.shopItems, id, { active });
    return row ? { id: row.id, active: bool(row.active) } : null;
}

export async function deleteShopItem(id: string): Promise<boolean> {
    return deleteRecord(TABLE.shopItems, id);
}

// --- Auth users -------------------------------------------------------------

async function findAuthUser(sub: string): Promise<Row | null> {
    return findOne(TABLE.authUsers, `{sub}='${esc(sub)}'`);
}

export async function upsertAuthUser(u: HcUser): Promise<void> {
    const existing = await findAuthUser(u.sub);

    const a =  u.address;
    const formattedAddress =
        a?.formatted ??
        ([a?.street_address, a?.locality, a?.region, a?.postal_code, a?.country]
            .filter(Boolean)
            .join(', ') || null);

    const fields: Record<string, unknown> = {
        email: u.email ?? null,
        name: u.name ?? null,
        verification_status: u.verification_status ?? null,
        ysws_eligible: u.ysws_eligible ?? false,
        slack_id: u.slack_id ?? null,
        phone_number: u.phone_number ?? null,
        address: formattedAddress,
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

export async function getAuthUserMeta(sub: string): Promise<{ role: string; banned: boolean }> {
    const row = await findAuthUser(sub);
    return { role: (row?.role as string) ?? "user", banned: bool(row?.banned) };
}

export async function getAuthUserBySub(
    sub: string,
): Promise<{ email: string | null; slack_id: string | null; role: string } | null> {
    const row = await findAuthUser(sub);
    if (!row) return null;
    return {
        email: (row.email as string) ?? null,
        slack_id: (row.slack_id as string) ?? null,
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

export async function listAuthUsers(): Promise<Record<string, unknown>[]> {
    const rows = await listAll(TABLE.authUsers, { sort: [{ field: "last_login", direction: "desc" }] });
    return rows.map((r) => ({
        sub: r.sub,
        email: r.email ?? null,
        name: r.name ?? null,
        verification_status: r.verification_status ?? null,
        ysws_eligible: bool(r.ysws_eligible),
        slack_id: r.slack_id ?? null,
        role: (r.role as string) ?? "user",
        banned: bool(r.banned),
        tokens: Number(r.tokens ?? 0),
        phone_number: r.phone_number ?? null,
        address: r.address ?? null,
        created_at: r.created ?? null,
        last_login: r.last_login ?? null,
    }));
}

// --- Phone Number & Address -----------------------------------------------------------------
export async function getAuthUserContact(sub:string,): Promise<{ phone_number: string | null; address: string | null } | null> {
    const row = await findAuthUser(sub);
    if (!row) return null;
    return { phone_number: (row.phone_number as string) ?? null, address: (row.address as string) ?? null };
}


// --- Orders -----------------------------------------------------------------

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
