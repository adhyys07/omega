import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { createSignup, countSignups, listActiveShopItems, createShopOrder } from './db.ts'
import { getSessionUser } from './auth.ts'
import cookie from '@fastify/cookie'
import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import authRoutes from './auth.ts'
import adminRoutes from './admin.ts'
import HackatimeRoutes from './hackatime.ts'
import submissionRoutes from './submissions.ts'
import uploadRoutes from './uploads.ts'
import reviewRoutes from './review.ts'
import pitchRoutes from './pitches.ts'

const app = Fastify({ logger: true })
const distDir = path.resolve(process.cwd(), 'dist')

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
}

function safeStaticPath(urlPath: string): string | null {
  const normalized = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '')
  if (!normalized || normalized.startsWith('..') || path.isAbsolute(normalized)) return null
  return path.join(distDir, normalized)
}

async function serveSpa(req: Parameters<typeof app.get>[0] extends string ? never : never, reply: any) {
  const rawPath = new URL((req as { url: string }).url, 'http://localhost').pathname
  const filePath = safeStaticPath(rawPath)

  if (filePath) {
    try {
      const stat = await fs.stat(filePath)
      if (stat.isFile()) {
        reply.type(MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream')
        return reply.send(createReadStream(filePath))
      }
    } catch {}
  }

  const indexPath = path.join(distDir, 'index.html')
  try {
    reply.type('text/html; charset=utf-8')
    return reply.send(createReadStream(indexPath))
  } catch {
    return reply.code(404).send({ error: 'Not Found', message: 'Built frontend not found' })
  }
}

await app.register(cors, {
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
})

const sessionSecret = process.env.SESSION_SECRET?.trim()
if (sessionSecret) {
  await app.register(cookie, { secret: sessionSecret })
} else {
  app.log.warn('SESSION_SECRET is not set; cookie sessions will be unsigned')
  await app.register(cookie)
}

await app.register(authRoutes)
await app.register(HackatimeRoutes)
await app.register(submissionRoutes)
await app.register(uploadRoutes)
await app.register(adminRoutes)
await app.register(reviewRoutes)
await app.register(pitchRoutes)




const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

app.get('/api/health', async () => {
    return { status: 'ok' }
})

// Serve the built SPA in production so direct hits to / and client-side routes
// (like /shop or /admin/review) do not fall through to a JSON 404.
app.get('/', serveSpa as never)
app.get('/*', async (req, reply) => {
  const pathname = new URL(req.url, 'http://localhost').pathname
  if (pathname.startsWith('/api/')) {
    return reply.code(404).send({ error: 'Not Found', message: `Route ${req.method}:${pathname} not found` })
  }
  return serveSpa(req as never, reply)
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

app.post('/api/shop/order', async (req, reply) => {
  const user = getSessionUser(req)
  if (!user) return reply.code(401).send({ error: 'Not authenticated' })
  
  const body = (req.body ?? {}) as { itemId?: unknown; note?: string };
  const itemId = String(body.itemId ?? '').trim()
  const noteText = String(body.note ?? '').trim()

  if (!itemId) {
    return reply.code(400).send({ error: 'Invalid itemId' })
  }

  if (noteText.length > 500) {
    return reply.code(400).send({ error: 'Note is too long' });
  }

  const result = await createShopOrder({
    userSub: user.sub,
    itemId,
    note: noteText || null,
  });

  if (!result.ok) {
    return reply.code(400).send({ error: result.error });
  }

  return result;
})



const port = Number(process.env.PORT ?? 3000)
await app.listen({ port, host: '0.0.0.0' })

