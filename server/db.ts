import pg from "pg";

export const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
})

export async function migrate() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        );
    `);
}