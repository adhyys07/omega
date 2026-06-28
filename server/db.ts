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
            created_at TIMESTAMPZ NOT NULL DEFAULT now(),
            last_login TIMESTAMPZ NOT NULL DEFAULT now()
        );
    `);

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

export async function migrate() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        );
    `);
}