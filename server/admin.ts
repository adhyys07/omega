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
    listSubmissions,
    listPitches,
    listTokenAdjustments,
    getSlackIdForSub,
} from "./db.ts";
import { TIERS, USD_PER_TOKEN, TOKENS_PER_HOUR } from "./tiers.ts";
import { dmUser } from "./slack.ts";

/** What a new role actually gets them. Keys are the values in ROLES; a role with no
 *  entry simply gets the headline with no second line. */
const ROLE_BLURB: Record<string, string> = {
    admin: 'You now have the admin panel and the review queue.',
    reviewer: 'You can now review pitches and projects in the review panel.',
    user: 'Reviewer access has been removed.',
};

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

    /** Dashboard counters and budget. Three full table scans, so it's a separate
     *  route the UI loads on demand rather than something bolted onto a list endpoint. */
    app.get('/api/admin/stats', { preHandler: requireAdmin }, async () => {
        const [submissions, pitches, adjustments] = await Promise.all([
            listSubmissions(), listPitches(), listTokenAdjustments(),
        ]);

        // Airtable leaves untouched number fields empty, so every read needs a
        // fallback — Number(undefined) is NaN and would poison the whole sum.
        const sum = (rows: typeof submissions, field: string) =>
            rows.reduce((total, r) => {
                const n = Number(r[field] ?? 0);
                return total + (Number.isFinite(n) ? n : 0);
            }, 0);

        const approved = submissions.filter((s) => s.status === 'approved');
        // 'changes_requested' is waiting on the BUILDER, not a reviewer — counting
        // it here would overstate the queue a reviewer actually has to work through.
        const awaitingReview = submissions.filter((s) => s.status === 'pending');

        // Every grant lands here as a positive delta — project payouts, badge
        // awards, and manual admin top-ups alike — so this one number is the whole
        // committed spend with no risk of double-counting. Negatives are shop
        // redemptions: tokens leaving circulation, not money we owe.
        const tokensGranted = adjustments.reduce((total, a) => {
            const d = Number(a.delta ?? 0);
            return total + (Number.isFinite(d) && d > 0 ? d : 0);
        }, 0);

        // A pending project's tier isn't set until a reviewer approves it, so its
        // cost is a RANGE, not a number: hours × 10 tokens, then ×1.0 (Starter) up
        // to ×1.5 (Elite). Quoting a single figure here would be a guess dressed up
        // as a fact.
        const multipliers = TIERS.map((t) => t.multiplier);
        const pendingTokensBase = sum(awaitingReview, 'hackatime_hours') * TOKENS_PER_HOUR;
        const pendingTokensMin = pendingTokensBase * Math.min(...multipliers);
        const pendingTokensMax = pendingTokensBase * Math.max(...multipliers);

        return {
            // approved_hours is what a reviewer signed off on; hackatime_hours is
            // what the builder claimed and nobody has verified yet.
            approved_hours: sum(approved, 'approved_hours'),
            pending_hours: sum(awaitingReview, 'hackatime_hours'),
            projects_pending: awaitingReview.length,
            pitches_pending: pitches.filter((p) => p.status === 'pending').length,

            // Sent rather than duplicated client-side: the frontend never imports
            // from server/, so this keeps the explanatory copy honest if the rate
            // or the tier ladder ever changes.
            usd_per_token: USD_PER_TOKEN,
            tokens_per_hour: TOKENS_PER_HOUR,
            tier_multiplier_min: Math.min(...multipliers),
            tier_multiplier_max: Math.max(...multipliers),
            tokens_granted: tokensGranted,
            tokens_pending_min: pendingTokensMin,
            tokens_pending_max: pendingTokensMax,
            budget_committed_usd: tokensGranted * USD_PER_TOKEN,
            budget_pending_min_usd: pendingTokensMin * USD_PER_TOKEN,
            budget_pending_max_usd: pendingTokensMax * USD_PER_TOKEN,
        };
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

        // Read once, up front: the ban check needs this row, and the role DM below
        // needs the previous value to tell a real change from a no-op re-save.
        const target = await getAuthUserBySub(sub);
        if (!target) return reply.code(404).send({ error: 'User not found' });
        const previousRole = String(target.role ?? 'user');

        // --- Safety checks before a ban can go through ---
        if (b.banned === true) {
            if (requester && requester.sub === sub) {
                return reply.code(400).send({ error: "You can't ban yourself" });
            }
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
        if (b.role !== undefined && b.role !== previousRole) {
            const role = b.role;
            // Best-effort, like every other Slack side-effect here: the role is already
            // saved, and a failed DM must not turn that into a 500.
            void (async () => {
                try {
                    const slackId = await getSlackIdForSub(sub);
                    if (!slackId) return;
                    const blurb = ROLE_BLURB[role] ? `\n${ROLE_BLURB[role]}` : '';
                    await dmUser(slackId, `🔑 Your Omega role is now *${role}*.${blurb}`);
                } catch (err) {
                    req.log.error(err, 'role change DM failed');
                }
            })();
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
