import pg from "pg";
import type { HcUser } from "./auth.ts";

export const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
})
export async function migrateAuth(){
    await pool.query(`
        CREATE TABLE IF NOT EXISTS auth_users (
            sub     TEXT PRIMARY KEY,
            email   TEXT,
            name    TEXT,
            verification_status TEXT,
            ysws_eligible BOOLEAN,
            slack_id TEXT,
            role TEXT NOT NULL DEFAULT 'user',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_login TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    `);
    await pool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';`)
}

export async function upsertAuthUser(u: HcUser) {
    await pool.query(`
        INSERT INTO auth_users (sub, email, name, verification_status, ysws_eligible, slack_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (sub) DO UPDATE SET
            email = EXCLUDED.email,
            name = EXCLUDED.name,
            verification_status = EXCLUDED.verification_status,
            ysws_eligible = EXCLUDED.ysws_eligible,
            slack_id = EXCLUDED.slack_id,
            last_login = now();
    `, [u.sub, u.email, u.name, u.verification_status, u.ysws_eligible, u.slack_id]);
}

export async function migrateShop(){
    await pool.query(`
        CREATE TABLE IF NOT EXISTS shop_items (
            id SERIAL PRIMARY KEY,
            slug TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            cost INTEGER NOT NULL,
            category TEXT NOT NULL,
            icon TEXT,
            image_url TEXT,
            stock INTEGER,
            active BOOLEAN NOT NULL DEFAULT true,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        `)
    
    await pool.query(`ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS image_url TEXT;`)
}

export async function seedShop(){
    const rows: [string, string, string, number, string, string, string | null, number | null, number][] = [
    ['android-phone',   'Android phone',      'A mid-range Android device to test on real hardware.', 60,  'hardware',    '🤖', 'https://placehold.co/600x400/3d7a40/fff?text=Android', 10, 1],
    ['iphone-refurb',   'iPhone (refurb)',    'Refurbished iPhone so you can ship + test on iOS.',    110, 'hardware',    '', 'https://placehold.co/600x400/3d7a40/fff?text=Android' ,  5,  2],
    ['play-license',    'Play Store license', '$25 Google Play developer account grant.',             12,  'dev_account', '▶', 'https://placehold.co/600x400/3d7a40/fff?text=Android' , null, 3],
    ['apple-developer', 'Apple Developer',    '$100 Apple Developer Program membership.',             45,  'dev_account',  '','https://placehold.co/600x400/3d7a40/fff?text=Android',null, 4],
    ['mech-keyboard',   'Mech keyboard',      'A clacky 65% keyboard to make the grind comfy.',       40,  'gear',        '⌨', 'https://placehold.co/600x400/3d7a40/fff?text=Android' , 8,  5],
    ['dev-credits',     'Dev tool credits',   'Cloud / API / design-tool credits for builders.',      20,  'tools',       '✦', 'https://placehold.co/600x400/3d7a40/fff?text=Android',  null, 6],
  ]
  for (const [slug, name, description, cost, category, icon, image_url, stock, sort] of rows) {
    await pool.query(
      `INSERT INTO shop_items (slug, name, description, cost, category, icon, image_url, stock, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (slug) DO UPDATE SET image_url = EXCLUDED.image_url`,
      [slug, name, description, cost, category, icon, image_url, stock, sort],
    )
  }
}

export async function migrate() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        );
    `);
}

export async function getAuthUserRole(sub: string): Promise<string> {
    const { rows } = await pool.query(`SELECT role FROM auth_users WHERE sub = $1`, [sub]);
    return rows[0]?.role ?? 'user';
}

export async function setAuthUserRole(sub: string, role: string): Promise<boolean> {
    const { rowCount } = await pool.query(
        `UPDATE auth_users SET role = $1 WHERE sub = $2`,
        [role, sub],
    );
    return (rowCount ?? 0) > 0;
}