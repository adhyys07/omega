import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { createSignup, countSignups, listActiveShopItems } from './db.ts'
import cookie from '@fastify/cookie'
import authRoutes from './auth.ts'
import adminRoutes from './admin.ts'
import HackatimeRoutes from './hackatime.ts'
import submissionRoutes from './submissions.ts'
import uploadRoutes from './uploads.ts'
import reviewRoutes from './review.ts'
import pitchRoutes from './pitches.ts'
import devRoutes from './dev.ts'

const app = Fastify({ logger: true })

await app.register(cors, {
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
})

await app.register(cookie, {
  secret: process.env.SESSION_SECRET!})

await app.register(authRoutes)
await app.register(HackatimeRoutes)
await app.register(submissionRoutes)
await app.register(uploadRoutes)
await app.register(adminRoutes)
await app.register(reviewRoutes)
await app.register(pitchRoutes)

// The stage-seeder writes rows on an admin's behalf. It is admin-gated at the route,
// but this second gate means the endpoints simply do not exist in prod, where an env
// flag is a far smaller thing to get wrong than an auth check.
const DEV_TOOLS = process.env.ALLOW_DEV_TOOLS === '1' && process.env.NODE_ENV !== 'production'
if (DEV_TOOLS) {
  await app.register(devRoutes)
  app.log.warn('dev tools ENABLED — /api/admin/dev/* is live')
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

app.get('/api/health', async () => {
    return { status: 'ok' }
})

// Create a signup
app.post('/api/signup', async (req, reply) => {
  const { email } = (req.body ?? {}) as { email?: string }
  const value = email?.trim().toLowerCase()

  if (!value || !EMAIL_RE.test(value)) {
    return reply.code(400).send({ error: 'Invalid email' })
  }

  try {
    const { created, row } = await createSignup(value)
    // Already signed up → still a success from the user's point of view
    if (!created) return reply.code(200).send({ alreadyExists: true })
    return reply.code(201).send(row)
  } catch (err) {
    req.log.error(err)
    return reply.code(500).send({ error: 'Something went wrong' })
  }
})

app.get('/api/shop/items', async () => {
  return listActiveShopItems()
})

app.get('/api/signup', async () => {
  return { count: await countSignups() }
})

const port = Number(process.env.PORT ?? 3000)
await app.listen({ port, host: '0.0.0.0' })

