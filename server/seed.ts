import 'dotenv/config'

const BASE_ID = process.env.AIRTABLE_BASE_ID!
const PAT = process.env.AIRTABLE_PAT!
const API = 'https://api.airtable.com/v0'

const TEST_USER_SUB = 'seed-test-user-123'

const projects = [
  {
    title: 'Real-time Collab Notes',
    description: 'A Notion-like collaborative notes app with live cursor tracking and instant updates.',
    demo_url: 'https://collab-notes-demo.vercel.app',
    repo_url: 'https://github.com/example/collab-notes',
    image_url: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800',
    tier: 'Elite',
  },
  {
    title: 'AI Code Reviewer',
    description: 'GitHub bot that reviews pull requests using Claude AI, provides detailed feedback and suggestions.',
    demo_url: 'https://github.com/apps/ai-code-reviewer',
    repo_url: 'https://github.com/example/ai-code-reviewer',
    image_url: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800',
    tier: 'Builder',
  },
  {
    title: 'Habit Tracker Dashboard',
    description: 'Beautiful habit tracking app with streak counters, progress analytics, and daily reminders.',
    demo_url: 'https://habit-tracker-demo.netlify.app',
    repo_url: 'https://github.com/example/habit-tracker',
    image_url: 'https://images.unsplash.com/photo-1531746790731-6c087fecd65a?w=800',
    tier: 'Starter',
  },
  {
    title: 'Music Visualizer',
    description: 'Real-time audio visualization with customizable effects, equalizer controls, and Spotify integration.',
    demo_url: 'https://music-viz-demo.netlify.app',
    repo_url: 'https://github.com/example/music-visualizer',
    image_url: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800',
    tier: 'Elite',
  },
  {
    title: 'Task Automation CLI',
    description: 'Command-line tool for automating repetitive development tasks like file generation and deployment.',
    demo_url: null,
    repo_url: 'https://github.com/example/task-automation-cli',
    image_url: null,
    tier: 'Builder',
  },
]

async function createRecord(table: string, fields: Record<string, unknown>) {
  const res = await fetch(`${API}/${BASE_ID}/${table}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records: [{ fields }] }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Airtable ${res.status} on ${table}: ${body}`)
  }

  const data = (await res.json()) as { records: { id: string; fields: Record<string, unknown> }[] }
  return data.records[0]
}

async function seed() {
  console.log('🌱 Starting gallery seed...')

  for (const project of projects) {
    try {
      const now = new Date().toISOString()

      // Create a submission directly (skip tier for now due to Airtable permissions)
      await createRecord('project_submissions', {
        title: project.title,
        description: project.description,
        status: 'approved',
        user_sub: TEST_USER_SUB,
        created_at: now,
        code_url: project.repo_url || 'https://github.com/example/placeholder',
        playable_url: project.demo_url || 'https://example.com',
        first_name: 'Seed',
        last_name: 'User',
        email: 'seed@example.com',
        seeded: true,
      })

      console.log(`✅ Created & approved ${project.tier}: ${project.title}`)
    } catch (err) {
      console.error(`❌ Error seeding ${project.title}:`, err)
    }
  }

  console.log('✨ Gallery seeding complete!')
  process.exit(0)
}

seed().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
