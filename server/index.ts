import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { pool, migrate, migrateAuth, migrateShop, seedShop } from './db.ts'
import cookie from '@fastify/cookie'
import authRoutes from './auth.ts'
import adminRoutes from './admin.ts'

const app = Fastify({ logger: true })

await app.register(cors, {
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
})

await app.register(cookie, {
  secret: process.env.SESSION_SECRET!})

await app.register(authRoutes)
await app.register(adminRoutes)

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
    const { rows } = await pool.query(
      `INSERT INTO users (email) VALUES ($1)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, created_at`,
      [value],
    )
    // Already signed up → still a success from the user's point of view
    if (rows.length === 0) return reply.code(200).send({ alreadyExists: true })
    return reply.code(201).send(rows[0])
  } catch (err) {
    req.log.error(err)
    return reply.code(500).send({ error: 'Something went wrong' })
  }
})

app.get('/api/shop/items', async () => {
  const { rows } = await pool.query(
    `SELECT id, slug, name, description, cost, category, icon, image_url, stock
      FROM shop_items WHERE active = true ORDER BY sort_order, id`,
  )
  return rows
})

app.get('/api/signup', async () => {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM users')
  return { count: rows[0].count }
})

await migrateAuth()
await migrateShop()
await seedShop()
await migrate()

const port = Number(process.env.PORT ?? 3000)
await app.listen({ port, host: '0.0.0.0' })

