import type { FastifyInstance } from "fastify";
import { listSubmissions, getAuthUserBySub } from "./db.ts";

export default async function galleryRoutes(app: FastifyInstance) {
  app.get('/api/gallery/projects', async () => {
    try {
      const submissions = await listSubmissions();

      const approvedProjects = submissions
        .filter((s) => s.status === 'approved')
        .sort((a, b) => new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime());

      const projects = await Promise.all(
        approvedProjects.map(async (submission) => {
          const submitterSub = String(submission.submitter_user_sub ?? '');
          const creator = submitterSub
            ? await getAuthUserBySub(submitterSub)
            : null;

          return {
            id: submission.id,
            title: submission.title ?? 'Untitled',
            description: submission.description ?? '',
            creator_name: creator?.name ?? 'Anonymous',
            creator_slack_id: creator?.slack_id ?? null,
            category: submission.category ?? 'unknown',
            demo_url: submission.demo_url ?? null,
            repo_url: submission.repo_url ?? null,
            status: submission.status,
            tier: submission.tier ?? 'Starter',
            badges: submission.badges ? JSON.parse(String(submission.badges)) : [],
            created_at: String(submission.created_at ?? new Date().toISOString()),
            image_url: submission.image_url ?? null,
          };
        }),
      );

      return projects;
    } catch (err) {
      console.error('Failed to fetch gallery projects:', err);
      return [];
    }
  });
}
