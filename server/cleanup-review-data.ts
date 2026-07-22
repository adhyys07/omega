import 'dotenv/config'
import { cleanupReviewData, type ReviewDataCleanupOptions } from './db.ts'

const args = process.argv.slice(2)
const execute = args.includes('--execute')
const confirmation = args.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length)
const userSub = args.find((arg) => arg.startsWith('--user='))?.slice('--user='.length).trim()
const scopeArg = args.find((arg) => arg.startsWith('--scope='))?.slice('--scope='.length)

if (args.includes('--help')) {
  console.log(`Usage:
  npm run cleanup:review
  npm run cleanup:review -- --scope=seeded
  npm run cleanup:review -- --scope=user --user=<user_sub>

Dry-run is always the default. To perform deletion, add both:
  --execute --confirm=DELETE_REVIEW_DATA_ONCE

Scopes:
  all      All pitches, project submissions, and linked YSWS rows (default)
  seeded   Only rows explicitly marked as seeded test data
  user     Only rows belonging to --user=<user_sub>
`)
  process.exit(0)
}

if (scopeArg && !['all', 'seeded', 'user'].includes(scopeArg)) {
  throw new Error('--scope must be all, seeded, or user')
}

const scope = (scopeArg ?? 'all') as NonNullable<ReviewDataCleanupOptions['scope']>
if (scope === 'user' && !userSub) {
  throw new Error('--user=<user_sub> is required when --scope=user')
}

if (execute && confirmation !== 'DELETE_REVIEW_DATA_ONCE') {
  throw new Error('Deletion requires --confirm=DELETE_REVIEW_DATA_ONCE')
}

const result = await cleanupReviewData({
  scope,
  userSub,
  dryRun: !execute,
})

console.table(result)
if (!execute) {
  console.log('Dry run only. No records were deleted.')
} else {
  console.log('One-time cleanup completed. Remove this script after verifying Airtable.')
}
