import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getSessionUser, isAdmin, ROLES, type Role } from "./auth.ts";
import {
    listSignups,
    listAllShopItems,
    createShopItem,
    setShopItemActive,
    deleteShopItem,
    listOrders,
    updateOrder,
    listAuthUsers,
    getAuthUserBySub,
    setAuthUserRole,
        setAuthUserBanned,
    adjustUserTokens,
    upsertAuthUser,
} from "./db.ts";

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
        return listSignups();
    });

    app.get('/api/admin/items', { preHandler: requireAdmin }, async () => {
        return listAllShopItems();
    });
    
    const ORDER_STATUSES = ['pending', 'fulfilled', 'cancelled', 'refunded'] as const;

    app.get('/api/admin/orders', { preHandler: requireAdmin }, async (req) => {
        const { status } = req.query as { status?: string };
        const filter = status && ORDER_STATUSES.includes(status as typeof ORDER_STATUSES[number])
            ? status
            : undefined;
        return listOrders(filter);
    });

    app.patch('/api/admin/orders/:id', { preHandler: requireAdmin }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const b = (req.body ?? {}) as { status?: string; tracking?: string; note?: string };
        const admin = getSessionUser(req);

        if (b.status === undefined && b.tracking === undefined && b.note === undefined) {
            return reply.code(400).send({ error: 'Provide status and/or tracking and/or note' });
        }
        if (b.status !== undefined && !ORDER_STATUSES.includes(b.status as typeof ORDER_STATUSES[number])) {
            return reply.code(400).send({ error: `status must be one of ${ORDER_STATUSES.join(', ')}` });
        }

        const updated = await updateOrder(id, b, admin?.sub ?? null);
        if (!updated) { return reply.code(404).send({ error: 'Order not found' }); }
        return updated;
    });

    app.post('/api/admin/users/:sub/tokens', { preHandler: requireAdmin }, async (req, reply) => {
        const { sub } = req.params as { sub: string };
        const { delta, reason } = (req.body ?? {}) as { delta?: number; reason?: string };
        if (typeof delta !== 'number' || !Number.isInteger(delta) || delta === 0) {
            return reply.code(400).send({ error: 'delta must be a non-zero integer' });
        }
        const admin = getSessionUser(req);
        const result = await adjustUserTokens(sub, delta, reason ?? null, admin?.sub ?? null);
        if (!result.ok) {
            return reply.code(400).send({ error: result.error });
        }
        return { sub, tokens: result.tokens };
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
            const item = await createShopItem({
                slug, name, description, cost, category,
                icon: icon || null,
                image_url: image_url || null,
                stock: Number.isFinite(stock) ? stock : null,
                sort_order: Number.isFinite(sort_order) ? sort_order : 0,
            });
            return reply.code(201).send(item);
        }   catch (err) {
            if ((err as { code?: string }).code === 'DUPLICATE_SLUG') {
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
        const updated = await setShopItemActive(id, b.active);
        if (!updated) { return reply.code(404).send({ error: 'Item not found' }); }
        return updated;
    });

    app.patch('/api/admin/users/:sub', { preHandler: requireAdmin }, async (req, reply) => {
        const { sub } = req.params as { sub: string };
        const b = (req.body ?? {}) as { role?: string; banned?: boolean };
        const requester = getSessionUser(req);

        if (b.role === undefined && b.banned === undefined) {
            return reply.code(400).send({ error: 'Provide role and/or banned' });
        }

        // --- Safety checks before a ban can go through ---
        if (b.banned === true) {
            if (requester && requester.sub === sub) {
                return reply.code(400).send({ error: "You can't ban yourself" });
            }
            const target = await getAuthUserBySub(sub);
            if (!target) return reply.code(404).send({ error: 'User not found' });
            const targetIsAdmin =
                target.role === 'admin' ||
                isAdmin({ sub, email: target.email ?? undefined, slack_id: target.slack_id ?? undefined });
            if (targetIsAdmin) {
                return reply.code(403).send({ error: "You can't ban an admin" });
            }
        }

        if (b.role !== undefined) {
            if (!ROLES.includes(b.role as Role)) {
                return reply.code(400).send({ error: `role must be one of ${ROLES.join(', ')}` });
            }
            if (!(await setAuthUserRole(sub, b.role))) {
                return reply.code(404).send({ error: 'User not found' });
            }
        }
        if (b.banned !== undefined) {
            if (typeof b.banned !== 'boolean') {
                return reply.code(400).send({ error: 'banned must be a boolean' });
            }
            if (!(await setAuthUserBanned(sub, b.banned))) {
                return reply.code(404).send({ error: 'User not found' });
            }
        }
        return { sub, ...(b.role !== undefined && { role: b.role }), ...(b.banned !== undefined && { banned: b.banned }) };
    });


    app.delete('/api/admin/items/:id', { preHandler: requireAdmin }, async (req, reply) => {
        const { id } = req.params as { id: string };
        const ok = await deleteShopItem(id);
        if (!ok) { return reply.code(404).send({ error: 'Item not found' }); }
        return { ok: true };
    });
    // Everyone who has signed in via Hack Club auth.
    app.get('/api/admin/users', { preHandler: requireAdmin }, async () => {
        return listAuthUsers();
    });

    // Admin: manually resync a user by their sub. User must log in again with fresh OAuth data.
    app.post('/api/admin/users/:sub/resync', { preHandler: requireAdmin }, async (req, reply) => {
        const { sub } = req.params as { sub: string };

        const user = await getAuthUserBySub(sub);
        if (!user) {
            return reply.code(404).send({
                error: 'User not found in database',
                instruction: 'User must log in via OAuth to be synced. Once logged in, they will be added to the database.',
            });
        }

        return {
            ok: true,
            status: 'User exists in database',
            user: { name: user.name, email: user.email },
        };
    });

}
