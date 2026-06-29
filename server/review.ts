import type { FastifyInstance} from "fastify";
import { requireRole } from "./auth.ts";

export default async function reviewRoutes(app: FastifyInstance) {
    app.get('/api/review', { preHandler: requireRole('reviewer') }, async () => {
        return { message: 'Welcome to the review page!' };
    });
}