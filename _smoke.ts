import { getHackatimeToken, syncBanFromTrust, listAuthUsers } from './server/db.ts'
import { fetchHackatimeTrustLevel } from './server/hackatime-api.ts'

// Pass the subject to test against: SMOKE_SUB='ident!xxxx' npx tsx _smoke.ts
const sub = process.env.SMOKE_SUB
if (!sub) {
  console.error('Set SMOKE_SUB to the auth subject you want to smoke-test.')
  process.exit(1)
}

const token = await getHackatimeToken(sub)
console.log('has stored hackatime token:', !!token)
if (token) {
  const trust = await fetchHackatimeTrustLevel(token)
  console.log('fetched trust level:', trust)
  await syncBanFromTrust(sub, trust)
  console.log('syncBanFromTrust ran')
}
const users = await listAuthUsers()
const me = users.find((u) => u.sub === sub)
console.log('row now →', { hackatime_trust: me?.hackatime_trust, banned: me?.banned, role: me?.role })
