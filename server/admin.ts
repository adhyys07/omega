import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getSessionUser, isAdmin } from "./auth.ts";
import { pool } from "./db.ts";

export default async function adminRoutes(app: FastifyInstance) {
    // Gate every admin route: 401 if not signed in, 403 if signed in but not an admin.
    const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
        const user = getSessionUser(req);
        if (!user) return reply.code(401).send({ error: 'Not authenticated' });
        if (!isAdmin(user)) return reply.code(403).send({ error: 'Forbidden' });
    };

    // Lightweight check the frontend uses to decide whether to show the Admin UI.
    app.get('/api/admin/me', { preHandler: requireAdmin }, async (req) => {
        const user = getSessionUser(req);
        return { admin: true, name: user?.name, email: user?.email, slack_id: user?.slack_id };
    });

    app.get('/api/admin/signups', { preHandler: requireAdmin }, async () => {
        const { rows } = await pool.query(
            `SELECT id, email, created_at FROM users ORDER BY created_at DESC`,
        );
        return rows;
    });

    app.get('/api/admin/items', { preHandler: requireAdmin }, async () => {
        const { rows } = await pool.query(
            `SELECT id, slug, name, description, cost, category, icon, image_url, stock, active, sort_order
               FROM shop_items ORDER BY sort_order, id`,
        );
        return rows;
    });

    app.post('/api/admin/items', { preHandler: requireAdmin }, async (req, reply) => {
        const b = (req.body ?? {}) as Record<string, unknown>;
        const slug = String(b.slug ?? '').trim();
        const name = String(b.name ?? '').trim();
        const description = String(b.description ?? '').trim();
        const cost = Number(b.cost);
        const category = String(b.category ?? '').trim();
        const icon = String(b.icon ?? '').trim();
        const image_url = String(b.image_url ?? '').trim();
        const stock = Number(b.stock);
        const sort_order = Number(b.sort_order);

        if (!slug || !name || !description || !category || !Number.isFinite(cost)) {
            return reply.code(400).send({ error: 'slug, name, description, category and cost are required' });
        }

        try {
            const { rows } = await pool.query(
                `INSERT INTO shop_items (slug, name, description, cost, category, icon, image_url, stock, sort_order)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                 RETURNING id, slug, name, description, cost, category, icon, image_url, stock, active, sort_order`,
                [slug, name, description, cost, category, icon || null, image_url || null,
                    Number.isFinite(stock) ? stock : null,
                    Number.isFinite(sort_order) ? sort_order : 0],
            );
            return reply.code(201).send(rows[0]);
        }   catch (err) {
            if ((err as { code?: string }).code === '23505') {
                return reply.code(409).send({ error: 'An item with that slug already exists' });
            }
            req.log.error(err, 'failed to create shop item');
            return reply.code(500).send({ error: 'Failed to create shop item' });
        }
    });

    app.patch('/api/admin/items/:id', { preHandler: requireAdmin }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const b = (req.body ?? {}) as { active?: boolean};
        if (typeof b.active !== 'boolean') {
            return reply.code(400).send({ error: 'active must be a boolean' });
        }
        const { rows } = await pool.query(
            `UPDATE shop_items SET active = $1 WHERE id = $2 RETURNING id, active`,
            [b.active, Number(id)],
        );
        if (rows.length === 0) { return reply.code(404).send({ error: 'Item not found' }); }
        return rows[0];
    });

    app.delete('/api/admin/items/:id', { preHandler: requireAdmin }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const { rowCount } = await pool.query(`DELETE FROM shop_items WHERE id = $1`, [Number(id)]);
        if (rowCount === 0) { return reply.code(404).send({ error: 'Item not found' }); }
        return { ok: true };
    });
    // Everyone who has signed in via Hack Club auth.
    app.get('/api/admin/users', { preHandler: requireAdmin }, async () => {
        const { rows } = await pool.query(
            `SELECT sub, email, name, verification_status, ysws_eligible, slack_id, created_at, last_login
               FROM auth_users
              ORDER BY last_login DESC`,
        );
        return rows;
    });
}
