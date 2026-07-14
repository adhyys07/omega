<script lang="ts">
  import { onMount } from 'svelte'
  import Review from './Review.svelte'
  import Stages from './Stages.svelte'

  let path = $state(location.pathname)

  // The dev routes are not registered at all unless ALLOW_DEV_TOOLS=1, so a 404 here
  // is the honest answer to "are dev tools on?" — no need for a separate config flag.
  let devEnabled = $state(false)

  onMount(() => {
    const onPop = () => (path = location.pathname)
    addEventListener('popstate', onPop)
    fetch('/api/admin/dev/stages', { credentials: 'include' })
      .then((r) => { devEnabled = r.ok })
      .catch(() => { devEnabled = false })
    return () => removeEventListener('popstate', onPop)
  })

  function go(to: string, e: MouseEvent) {
    e.preventDefault()
    history.pushState({}, '', to)
    path = to
  }

  const TOOLS = [
    { id: 'users',    label: '◉ Users',     href: '/admin' },
    { id: 'review',   label: '⚖ Review',    href: '/admin/review' },
    { id: 'orders',   label: '☑ Fulfillment',     href: '/admin/orders' },
    { id: 'items',    label: '▣ Shop items', href: '/admin/items' },
    { id: 'signups',  label: '✉ Signups',    href: '/admin/signups' },
  ]

  const tools = $derived(
    devEnabled
      ? [...TOOLS, { id: 'stages', label: '⚡ Stage jump', href: '/admin/stages' }]
      : TOOLS
  )

  const active = $derived(
    path.startsWith('/admin/review') ? 'review' :
    path.startsWith('/admin/stages') ? 'stages' :
    path.startsWith('/admin/orders') ? 'orders' :
    path.startsWith('/admin/items') ? 'items' :
    path.startsWith('/admin/signups') ? 'signups' :
    'users'
  )

  type AdminUser = {
    sub: string
    email: string | null
    name: string | null
    verification_status: string | null
    ysws_eligible: boolean | null
    slack_id: string | null
    role: 'user' | 'reviewer' | 'admin'
    banned: boolean
    hackatime_trust: string | null
    tokens: number
    phone_number: string | null
    address: string | null
    created_at: string
    last_login: string
  }

  type Order = {
    id: number
    item_name: string
    cost: number
    quantity: number
    status: 'pending' | 'fulfilled' | 'cancelled' | 'refunded'
    shipping: string | null
    note: string | null
    tracking: string | null
    created_at: string
    fulfilled_at: string | null
    user_name: string | null
    user_email: string | null
    user_slack_id: string | null
  }

  let orders = $state<Order[]>([])
  let ordersStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle')
  let orderFilter = $state<'all' | 'pending' | 'fulfilled' | 'cancelled' | 'refunded'>('pending')
  const ORDER_FILTERS = ['pending', 'fulfilled', 'refunded', 'cancelled', 'all'] as const

  async function loadOrders() {
    ordersStatus = 'loading'
    try {
      const qs = orderFilter === 'all' ? '' : `?status=${orderFilter}`
      const res = await fetch(`/api/admin/orders${qs}`)
      if (!res.ok) throw new Error()
      orders = await res.json()
      ordersStatus = 'ready'
    } catch {
      ordersStatus = 'error'
    }
  }

  function setOrderFilter(f: typeof orderFilter) {
    orderFilter = f
    loadOrders()
  }

  async function fulfillOrder(o: Order){
    if (!confirm(`Mark order #${o.id} (${o.item_name}) as fulfilled?`)) return
    const tracking = prompt('Tracking / fulfillment reference (optional):') ?? ''
    const res = await fetch(`/api/admin/orders/${o.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'fulfilled', tracking: tracking.trim() || undefined }),
    })
    if (res.ok) {
      const u = await res.json()
      o.status = u.status; o.tracking = u.tracking; o.fulfilled_at = u.fulfilled_at
      if (orderFilter !== 'all' && orderFilter !== 'fulfilled') orders = orders.filter((x) => x.id !== o.id)
    }
  }

  async function cancelOrder(o: Order){
    if (!confirm(`Cancel order #${o.id}? (Refund Ω tokens manually if needed.)`)) return
    const res = await fetch(`/api/admin/orders/${o.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    })
    if (res.ok) {
      o.status = 'cancelled'
      if (orderFilter !== 'all' && orderFilter !== 'cancelled') orders = orders.filter((x) => x.id !== o.id)
    }
  }

  async function refundOrder(o: Order){
    if (!confirm(`Refund order #${o.id} (${o.item_name})? Credit the Ω tokens back manually if needed.`)) return
    const res = await fetch(`/api/admin/orders/${o.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'refunded' }),
    })
    if (res.ok) {
      o.status = 'refunded'
      if (orderFilter !== 'all' && orderFilter !== 'refunded') orders = orders.filter((x) => x.id !== o.id)
    }
  }

  const ROLE_OPTIONS = ['user', 'reviewer', 'admin'] as const

  // Base URL for opening a member's profile in the Slack workspace.
  const SLACK_TEAM_URL = 'https://hackclub.slack.com/team/'

  let status = $state<'loading' | 'forbidden' | 'unauth' | 'ready' | 'error'>('loading')
  let users = $state<AdminUser[]>([])
  let me = $state<{ name?: string; email?: string } | null>(null)
  let q = $state('')

  onMount(async () => {
    try {
      const meRes = await fetch('/api/admin/me')
      if (meRes.status === 401) { status = 'unauth'; return }
      if (meRes.status === 403) { status = 'forbidden'; return }
      if (!meRes.ok) throw new Error()
      me = await meRes.json()

      const res = await fetch('/api/admin/users')
      if (!res.ok) throw new Error()
      users = await res.json()
      status = 'ready'
    } catch {
      status = 'error'
    }
  })

  const shown = $derived(
    q.trim() === ''
      ? users
      : users.filter((u) => {
          const hay = `${u.name ?? ''} ${u.email ?? ''} ${u.slack_id ?? ''}`.toLowerCase()
          return hay.includes(q.trim().toLowerCase())
        }),
  )

  const fmt = (s: string) => {
    const d = new Date(s)
    return isNaN(d.getTime()) ? '—' : d.toLocaleString()
  }

  type Signup = { id: number; email: string; created_at: string }
  let signups = $state<Signup[]>([])
  let signupsStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle')

  async function loadSignups() {
    signupsStatus = 'loading'
    try {
      const res = await fetch('/api/admin/signups')
      if (!res.ok) throw new Error()
      signups = await res.json()
      signupsStatus = 'ready'
    } catch {
      signupsStatus = 'error'
    }
  }

  type AdminItem = {
    id: number; slug: string; name: string; description: string; cost: number;
    category: string; icon: string | null; image_url: string | null; 
    stock: number | null; active: boolean; sort_order: number
  }

  let adminItems = $state<AdminItem[]>([])
  let itemsStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle')

  const CATEGORIES = ['hardware', 'dev_account', 'gear', 'tools']

  type FormState = {
    slug: string; name: string; description: string; cost: number | null
    category: string; icon: string; image_url: string
    stock: number | null; sort_order: number | null
  }
  const blankForm = (): FormState => ({
    slug: '',
    name: '',
    description: '',
    cost: null,
    category: 'hardware',
    icon: '',
    image_url: '',
    stock: null,
    sort_order: null,
  })

  let form = $state<FormState>(blankForm())
  let saving = $state(false)
  let formError = $state('')

  async function loadItems() {
    itemsStatus = 'loading'
    try {
      const res = await fetch('/api/admin/items')
      if (!res.ok) throw new Error()
      adminItems = await res.json()
      itemsStatus = 'ready'
    } catch {
      itemsStatus = 'error'
    }
  }

  async function changeRole(u: AdminUser, role: string, select: HTMLSelectElement){
    const prev = u.role
    if (role === prev) return

    const who = u.name ?? u.email ?? 'this user'
    const warning = role === 'admin' ? '\n\nAdmins can manage users, tokens, and bans.' : ''
    // The select is bound one-way, so u.role never changes on cancel and Svelte
    // won't re-render it — reset the element to keep it in step with the data.
    if (!confirm(`Change ${who}'s role from "${prev}" to "${role}"?${warning}`)) {
      select.value = prev
      return
    }

    u.role = role as AdminUser['role']
    const res = await fetch(`/api/admin/users/${encodeURIComponent(u.sub)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    if (!res.ok) {
      u.role = prev
      select.value = prev
      alert(`Couldn't change ${who}'s role.`)
    }
  }

  async function adjustTokens(u: AdminUser) {
    const raw = prompt(
      `Adjust tokens for ${u.name ?? u.email ?? 'user'}.\nCurrent balance: ⏣ ${u.tokens}\n\nEnter amount — positive to grant, negative to deduct:`,
    )
    if (raw === null) return
    const delta = Number(raw.trim())
    if (!Number.isInteger(delta) || delta === 0) { alert('Enter a non-zero whole number (e.g. 50 or -20).'); return }
    const reason = prompt('Reason (optional — saved to the audit log):') ?? ''
    const res = await fetch(`/api/admin/users/${encodeURIComponent(u.sub)}/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta, reason: reason.trim() || undefined }),
    })
    if (res.ok) {
      const data = await res.json()
      u.tokens = data.tokens
    } else {
      const err = await res.json().catch(() => ({}))
      alert(err.error ?? 'Failed to adjust tokens.')
    }
  }

  async function toggleBan(u: AdminUser) {
    const next = !u.banned
    // Check before banning: explicit confirmation, and don't allow banning admins.
    if (next) {
      if (u.role === 'admin') {
        alert("You can't ban an admin.")
        return
      }
      if (!confirm(`Ban ${u.name ?? u.email ?? 'this user'}? They'll be locked out and redirected away.`)) return
    }
    const prev = u.banned
    u.banned = next // optimistic
    const res = await fetch(`/api/admin/users/${encodeURIComponent(u.sub)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ banned: next }),
    })
    if (!res.ok) u.banned = prev // revert on failure
  }

  async function addItem() {
    formError = ''
    if (!form.slug || !form.name || !form.description || form.cost == null || !form.category) {
      formError = 'Please fill in all required fields.'
      return
    }
    saving = true
    try {
      const res = await fetch('/api/admin/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          {
            slug: form.slug.trim(),
            name: form.name.trim(),
            description: form.description.trim(),
            cost: form.cost,
            category: form.category,
            icon: form.icon.trim() || null,
            image_url: form.image_url.trim() || null,
            stock: form.stock,
            sort_order: form.sort_order ?? 0,
          }
        ),
      })
      if (res.status === 409) { formError = 'An item with that slug already exists.'; return }
      if (!res.ok) { formError = 'Failed to add item. Please try again.'; return }
      form = blankForm()
      await loadItems()
    } catch {
      formError = 'Failed to add item. Please try again.'
    } finally {
      saving = false
    }
  }

  async function deleteItem(id: number) {
    if (!confirm('Delete this item permanently?')) return
    const res = await fetch(`/api/admin/items/${id}`, { method: 'DELETE' })
    if (res.ok) adminItems = adminItems.filter((i) => i.id !== id)
  }

  async function toggleActive(item: AdminItem) {
    const res = await fetch(`/api/admin/items/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !item.active }) })
    if (res.ok) item.active = !item.active
  }

  $effect(()=> {
    if (active === 'signups' && signupsStatus === 'idle') loadSignups()
    if (active === 'items' && itemsStatus === 'idle') loadItems()
    if (active === 'orders' && ordersStatus === 'idle') loadOrders()
  })
</script>

<div class="admin">
  <div class="grain"></div>
  <div class="halftone"></div>

  <header style="position:sticky; top:0; z-index:40; background:#f4ead5cc; backdrop-filter:blur(6px); border-bottom:2.5px solid #1c1714;">
    <div style="display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 24px;">
      <a href="/" onclick={(e) => go('/', e)} style="display:inline-flex; align-items:center; gap:8px; font-family:'Syne',sans-serif; font-weight:800; font-size:1.1rem; color:#1c1714; text-decoration:none;">
      <span style="color:var(--orange);">Ω</span> Omega Admin
      </a>
      {#if me}
        <div style="font-size:.82rem; color:#5b4f44; font-weight:700;">{me.name ?? me.email}</div>
      {/if}
    </div>

    <nav style="display:flex; gap:8px; padding:0 24px 12px; flex-wrap: wrap;">
      {#each tools as tool (tool.id)}
        <a
          href={tool.href}
          onclick={(e) => go(tool.href, e)}
          style="
            padding:8px 16px;
            border:2px solid #1c1714;
            border-radius:10px 14px 9px 13px/13px 9px 14px 10px;
            font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.82rem;
            text-decoration:none;
            box-shadow:2px 2px 0 rgba(28,23,20,.18);
            background:{active === tool.id ? 'var(--orange)' : '#fbf4e6'};
            color:{active === tool.id ? '#fff' : '#1c1714'};
          "
        >{tool.label}</a>
      {/each}
    </nav>
  </header>

  <div style="max-width:1500px; margin:0 auto; padding:48px 24px 80px;">
  {#if active === 'users'}
    <div style="font-size:.72rem; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:var(--orange); margin-bottom:10px;">✦ Admin</div>
    <h1 style="font-family:'Syne',sans-serif; font-weight:800; font-size:clamp(2.2rem,7vw,3.4rem); letter-spacing:-.02em; margin:0; text-shadow:3px 3px 0 rgba(255,69,0,.16);">Users</h1>

    {#if status === 'loading'}
      <p style="color:#5b4f44; margin-top:24px;">Loading…</p>
    {:else if status === 'unauth'}
      <p style="color:#c2451a; font-weight:700; margin-top:24px;">You're not signed in. <a href="/api/auth/login" style="color:var(--orange);">Sign in</a> first.</p>
    {:else if status === 'forbidden'}
      <p style="color:#c2451a; font-weight:700; margin-top:24px;">You don't have admin access on this account.</p>
    {:else if status === 'error'}
      <p style="color:#c2451a; font-weight:700; margin-top:24px;">Couldn't load users. Is the server running?</p>
    {:else}
      <p style="font-size:1rem; color:#5b4f44; margin:12px 0 24px; max-width:560px; line-height:1.6;">
        Everyone who has signed in via Hack Club auth. <strong>{users.length}</strong> total.
      </p>

      <input
        bind:value={q}
        placeholder="Search name, email, or Slack ID…"
        style="width:100%; max-width:420px; padding:12px 16px; border:2.5px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; font-family:'Space Grotesk',sans-serif; font-size:.92rem; background:#fbf4e6; color:#1c1714; outline:none; box-shadow:4px 4px 0 rgba(28,23,20,.13); margin-bottom:24px;"
      />

      {#if shown.length === 0}
        <p style="color:#5b4f44;">No users match.</p>
      {:else}
        <div style="overflow-x:auto; border:2.5px solid #1c1714; border-radius:16px 11px 15px 12px/12px 15px 11px 16px; box-shadow:5px 5px 0 rgba(28,23,20,.13); background:#fbf4e6;">
          <table style="width:100%; border-collapse:collapse; font-size:.85rem; min-width:760px;">
            <thead>
              <tr style="background:rgba(255,69,0,.1); text-align:left;">
                <th style="padding:12px 14px; font-family:'Syne',sans-serif;">User</th>
                <th style="padding:12px 14px; font-family:'Syne',sans-serif;">Email</th>
                <th style="padding:12px 14px; font-family:'Syne',sans-serif;">Contact</th>
                <th style="padding:12px 14px; font-family:'Syne',sans-serif;">Slack ID</th>
                <th style="padding:12px 14px; font-family:'Syne',sans-serif;">Verified</th>
                <th style="padding:12px 14px; font-family:'Syne',sans-serif;">YSWS</th>
                <th style="padding:12px 14px; font-family:'Syne',sans-serif;">Trust</th>
                <th style="padding:12px 14px; font-family:'Syne',sans-serif;">Role</th>
                <th style="padding:12px 14px; font-family:'Syne',sans-serif;">Tokens</th>
                <th style="padding:12px 14px; font-family:'Syne',sans-serif;">Last login</th>
                <th style="padding:12px 14px; font-family:'Syne',sans-serif;"></th>
              </tr>
            </thead>
            <tbody>
              {#each shown as u (u.sub)}
                <tr style="border-top:2px dashed rgba(28,23,20,.22); opacity:{u.banned ? '.5' : '1'};">
                  <td style="padding:11px 14px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                      {#if u.slack_id}
                        <img
                          src={`https://cachet.dunkirk.sh/users/${u.slack_id}/r`}
                          alt={u.name ?? 'Profile'}
                          referrerpolicy="no-referrer"
                          loading="lazy"
                          style="width:34px; height:34px; border-radius:50%; border:2px solid #1c1714; object-fit:cover; background:#efe4cc; flex:none;"
                        />
                      {:else}
                        <div style="width:34px; height:34px; border-radius:50%; border:2px solid #1c1714; background:var(--orange); color:#fff; display:flex; align-items:center; justify-content:center; font-family:'Syne',sans-serif; font-weight:800; flex:none;">{(u.name ?? '?').charAt(0).toUpperCase()}</div>
                      {/if}
                      <span style="font-weight:700;">{u.name ?? '—'}</span>
                    </div>
                  </td>
                  <td style="padding:11px 14px; color:#5b4f44;">{u.email ?? '—'}</td>
                  <td style="padding:11px 14px; color:#5b4f44; max-width:220px;">
                    {#if u.phone_number || u.address}
                      {#if u.phone_number}<div style="white-space:nowrap;">{u.phone_number}</div>{/if}
                      {#if u.address}<div style="font-size:.78rem; white-space:pre-wrap;">{u.address}</div>{/if}
                    {:else}
                      —
                    {/if}
                  </td>
                  <td style="padding:11px 14px; color:#5b4f44; font-family:monospace;">
                    {#if u.slack_id}
                      <a href={`${SLACK_TEAM_URL}${u.slack_id}`} target="_blank" rel="noopener" style="color:var(--orange); text-decoration:underline; text-decoration-style:wavy; text-underline-offset:3px;">{u.slack_id}</a>
                    {:else}
                      —
                    {/if}
                  </td>
                  <td style="padding:11px 14px; color:#5b4f44;">{u.verification_status ?? '—'}</td>
                  <td style="padding:11px 14px;">{u.ysws_eligible ? '✓' : '—'}</td>
                  <td style="padding:11px 14px;">
                    {#if u.hackatime_trust}
                      {@const c = { red: '#c2451a', yellow: '#b07410', green: '#3d7a40', blue: '#2f6db0' }[u.hackatime_trust] ?? '#5b4f44'}
                      <span style="display:inline-flex; align-items:center; gap:5px; font-size:.75rem; font-weight:700; color:{c};">
                        <span style="width:9px; height:9px; border-radius:50%; background:{c}; border:1px solid #1c1714;"></span>{u.hackatime_trust}
                      </span>
                    {:else}
                      —
                    {/if}
                  </td>
                  <td style="padding:11px 14px;">
                    <select
                      value={u.role}
                      onchange={(e) => changeRole(u, e.currentTarget.value, e.currentTarget)}
                      style="border:2px solid #1c1714; border-radius:6px; padding:4px 8px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.75rem; background:{u.role === 'reviewer' ? 'rgba(47,109,176,.14)' : u.role === 'admin' ? 'rgba(255,69,0,.16)' : '#fbf4e6'}; color:#1c1714; cursor:pointer;"
                    >
                      {#each ROLE_OPTIONS as r}<option value={r}>{r}</option>{/each}
                    </select>
                  </td>
                  <td style="padding:11px 14px; white-space:nowrap;">
                    <span style="font-weight:700; margin-right:8px;">⏣ {u.tokens}</span>
                    <button
                      onclick={() => adjustTokens(u)}
                      title="Grant or deduct tokens"
                      style="cursor:pointer; border:2px solid #1c1714; border-radius:6px; padding:3px 9px; font-weight:700; font-size:.75rem; background:rgba(255,69,0,.14); color:#1c1714;"
                    >± Adjust</button>
                  </td>
                  <td style="padding:11px 14px; color:#5b4f44; white-space:nowrap;">{fmt(u.last_login)}</td>
                  <td style="padding:11px 14px;">
                    {#if u.role !== 'admin'}
                      <button
                        onclick={() => toggleBan(u)}
                        style="cursor:pointer; border:2px solid {u.banned ? '#1c1714' : '#c2451a'}; border-radius:6px; padding:4px 12px; font-weight:700; font-size:.75rem; background:{u.banned ? '#1c1714' : 'transparent'}; color:{u.banned ? '#fff' : '#c2451a'};"
                      >{u.banned ? 'Unban' : 'Ban'}</button>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}

  {:else if active === 'orders'}
    <div style="font-size:.72rem; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:var(--orange); margin-bottom:10px;">✦ Admin</div>
    <h1 style="font-family:'Syne',sans-serif; font-weight:800; font-size:clamp(2.2rem,7vw,3.4rem); letter-spacing:-.02em; margin:0; text-shadow:3px 3px 0 rgba(255,69,0,.16);">Fulfillment</h1>

    <div style="display:flex; gap:8px; flex-wrap:wrap; margin:22px 0 24px;">
      {#each ORDER_FILTERS as f}
        <button
          onclick={() => setOrderFilter(f)}
          style="padding:7px 16px; border:2px solid #1c1714; border-radius:100px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.8rem; text-transform:capitalize; cursor:pointer; box-shadow:2px 2px 0 rgba(28,23,20,.18); background:{orderFilter === f ? 'var(--orange)' : '#fbf4e6'}; color:{orderFilter === f ? '#fff' : '#1c1714'};"
        >{f}</button>
      {/each}
    </div>

    {#if ordersStatus === 'loading'}
      <p style="color:#5b4f44;">Loading orders…</p>
    {:else if ordersStatus === 'error'}
      <p style="color:#c2451a; font-weight:700;">Couldn't load orders. Is the server running?</p>
    {:else if orders.length === 0}
      <p style="color:#5b4f44;">No {orderFilter === 'all' ? '' : orderFilter} orders.</p>
    {:else}
      <div style="overflow-x:auto; border:2.5px solid #1c1714; border-radius:16px 11px 15px 12px/12px 15px 11px 16px; box-shadow:5px 5px 0 rgba(28,23,20,.13); background:#fbf4e6;">
        <table style="width:100%; border-collapse:collapse; font-size:.85rem; min-width:880px;">
          <thead>
            <tr style="background:rgba(255,69,0,.1); text-align:left;">
              <th style="padding:12px 14px; font-family:'Syne',sans-serif;">#</th>
              <th style="padding:12px 14px; font-family:'Syne',sans-serif;">Item</th>
              <th style="padding:12px 14px; font-family:'Syne',sans-serif;">Buyer</th>
              <th style="padding:12px 14px; font-family:'Syne',sans-serif;">Ship to</th>
              <th style="padding:12px 14px; font-family:'Syne',sans-serif;">Cost</th>
              <th style="padding:12px 14px; font-family:'Syne',sans-serif;">Placed</th>
              <th style="padding:12px 14px; font-family:'Syne',sans-serif;">Status</th>
              <th style="padding:12px 14px; font-family:'Syne',sans-serif;"></th>
            </tr>
          </thead>
          <tbody>
            {#each orders as o (o.id)}
              <tr style="border-top:2px dashed rgba(28,23,20,.22); opacity:{o.status === 'cancelled' ? '.55' : '1'};">
                <td style="padding:11px 14px; color:#5b4f44; font-family:monospace;">{o.id}</td>
                <td style="padding:11px 14px;">
                  <div style="font-weight:700;">{o.item_name}</div>
                  {#if o.quantity > 1}<div style="font-size:.72rem; color:#5b4f44;">×{o.quantity}</div>{/if}
                </td>
                <td style="padding:11px 14px; color:#5b4f44;">
                  <div style="font-weight:700; color:#1c1714;">{o.user_name ?? '—'}</div>
                  <div style="font-size:.74rem;">{o.user_email ?? '—'}</div>
                </td>
                <td style="padding:11px 14px; color:#5b4f44; max-width:220px; white-space:pre-wrap;">{o.shipping ?? '—'}</td>
                <td style="padding:11px 14px; white-space:nowrap;">⏣ {o.cost}</td>
                <td style="padding:11px 14px; color:#5b4f44; white-space:nowrap;">{fmt(o.created_at)}</td>
                <td style="padding:11px 14px;">
                  <span style="display:inline-block; padding:3px 10px; border:1.5px solid #1c1714; border-radius:6px; font-size:.72rem; font-weight:700; text-transform:capitalize;
                    background:{o.status === 'fulfilled' ? 'rgba(74,150,80,.2)' : o.status === 'cancelled' ? '#e3d4b8' : o.status === 'refunded' ? 'rgba(47,109,176,.15)' : 'rgba(255,179,71,.25)'};
                    color:{o.status === 'fulfilled' ? '#3d7a40' : o.status === 'cancelled' ? '#5b4f44' : o.status === 'refunded' ? '#2f6db0' : '#b07410'};">{o.status}</span>
                  {#if o.tracking}<div style="font-size:.7rem; color:#5b4f44; margin-top:4px; font-family:monospace;">{o.tracking}</div>{/if}
                </td>
                <td style="padding:11px 14px; white-space:nowrap;">
                  {#if o.status === 'pending'}
                    <button onclick={() => fulfillOrder(o)} style="cursor:pointer; border:2px solid #1c1714; border-radius:6px; padding:4px 12px; font-weight:700; font-size:.75rem; background:var(--orange); color:#fff; margin-right:6px;">Fulfill</button>
                    <button onclick={() => cancelOrder(o)} style="cursor:pointer; border:2px solid #c2451a; border-radius:6px; padding:4px 12px; font-weight:700; font-size:.75rem; background:transparent; color:#c2451a;">Cancel</button>
                  {:else if o.status === 'fulfilled'}
                    <button onclick={() => refundOrder(o)} style="cursor:pointer; border:2px solid #2f6db0; border-radius:6px; padding:4px 12px; font-weight:700; font-size:.75rem; background:transparent; color:#2f6db0;">Refund</button>
                  {:else}
                    <span style="color:#9c8a6e; font-size:.74rem;">{o.fulfilled_at ? fmt(o.fulfilled_at) : '—'}</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

  {:else if active === 'items'}
    <div style="font-size:.72rem; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:var(--orange); margin-bottom:10px;">✦ Admin</div>
    <h1 style="font-family:'Syne',sans-serif; font-weight:800; font-size:clamp(2.2rem,7vw,3.4rem); letter-spacing:-.02em; margin:0; text-shadow:3px 3px 0 rgba(255,69,0,.16);">Shop items</h1>
    
    <div style="margin-top:24px; background:#fbf4e6; border:2.5px solid #1c1714; border-radius:16px 11px 15px 12px/12px 15px 11px 16px; box-shadow:5px 5px 0 rgba(28,23,20,.13); padding:22px;">
      <div style="font-family:'Syne',sans-serif; font-weight:800; font-size:1.1rem; margin-bottom:14px;">Add an item</div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px;">
        <input bind:value={form.slug} placeholder="Slug (unique)" class="ai" />
        <input bind:value={form.name} placeholder="Name" class="ai" />
        <input bind:value={form.cost} placeholder="Cost (tokens)" type="number" class="ai" />
        <select bind:value={form.category} class='ai'>
          {#each CATEGORIES as cat}<option value={cat}>{cat}</option>{/each}
        </select>
        <input bind:value={form.stock} placeholder="Stock (leave blank for unlimited)" type="number" class="ai" />
        <input bind:value={form.sort_order} type="number" placeholder="sort order (0)" class="ai" />
        <input bind:value={form.icon} placeholder="icon emoji (fallback)" class="ai" />
        <input bind:value={form.image_url} placeholder="Image URL" class="ai" />
        </div>
        <textarea bind:value={form.description} placeholder="description" rows="2" class="ai" style="width:100%; margin-top:12px; resize:vertical;"></textarea>

        {#if formError}
          <p style="color:#c2451a; font-weight:700; margin:12px 0 0;">{formError}</p>
        {/if}

        <button
          onclick={addItem}
          disabled={saving}
          style="margin-top:14px; background:var(--orange); color:#fff; border:2.5px solid #1c1714; border-radius:9px 13px 8px 12px/12px 8px 13px 9px; padding:11px 22px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.9rem; cursor:{saving ? 'wait' : 'pointer'}; box-shadow:3px 3px 0 #1c1714;"
        >{saving ? 'Saving…' : '+ Add item'}</button>
        </div>
    <div style="margin-top:32px;">
      {#if itemsStatus === 'loading'}
        <p style="color:#5b4f44;">No Items Yet, add one above</p>
      {:else if itemsStatus === 'error'}
        <p style="color:#c2451a; font-weight:700;">Couldn't load items. Is the server running?</p>
      {:else if adminItems.length === 0}
        <p style="color:#5b4f44;">No Items Yet, add one above</p>
      {:else}
        <div style="overflow-x:auto; border:2.5px solid #1c1714; border-radius:16px 11px 15px 12px/12px 15px 11px 16px; box-shadow:5px 5px 0 rgba(28,23,20,.13); background:#fbf4e6;">
          <table style="width:100%; border-collapse:collapse; font-size:.85rem; min-width:760px;">
            <thead>
              <tr style="background:rgba(255,69,0,.1); text-align:left;">
                <th style="padding:12px 14px; font-family:'Syne',sans-serif;">Item</th>
                <th style="padding:12px 14px; font-family:'Syne',sans-serif;">Category</th>
                <th style="padding:12px 14px; font-family:'Syne',sans-serif;">Cost</th>
                <th style="padding:12px 14px; font-family:'Syne',sans-serif;">Stock</th>
                <th style="padding:12px 14px; font-family:'Syne',sans-serif;">Active</th>
                <th style="padding:12px 14px; font-family:'Syne',sans-serif;"></th>
              </tr>
            </thead>
            <tbody>
              {#each adminItems as item (item.id)}
                <tr style="border-top:2px dashed rgba(28,23,20,.22);">
                 <td style="padding:11px 14px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                      {#if item.image_url}
                        <img src={item.image_url} alt={item.name} style="width:40px; height:40px; object-fit:cover; border:2px solid #1c1714; border-radius:8px; background:#efe4cc; flex:none;" />
                      {:else}
                        <div style="width:40px; height:40px; display:flex; align-items:center; justify-content:center; border:2px solid #1c1714; border-radius:8px; background:rgba(255,69,0,.14); flex:none;">{item.icon ?? '★'}</div>
                      {/if}
                      <div>
                        <div style="font-weight:700;">{item.name}</div>
                        <div style="font-size:.72rem; color:#5b4f44; font-family:monospace;">{item.slug}</div>
                      </div>
                    </div>
                  </td>
                  <td style="padding:11px 14px; color:#5b4f44;">{item.category}</td>
                  <td style="padding:11px 14px; color:#5b4f44;">{item.cost}</td>
                  <td style="padding:11px 14px; color:#5b4f44;">{item.stock ?? '∞'} </td>
                  <td style = "padding:11px 14px; color:#5b4f44;">
                     <button onclick={() => toggleActive(item)} style="cursor:pointer; border:2px solid #1c1714; border-radius:6px; padding:3px 10px; font-weight:700; font-size:.75rem; background:{item.active ? 'rgba(74,150,80,.2)' : '#e3d4b8'}; color:{item.active ? '#3d7a40' : '#5b4f44'};">{item.active ? 'live' : 'hidden'}</button>
                  </td>
                  <td style="padding:11px 14px;">
                    <button onclick={() => deleteItem(item.id)} style="cursor:pointer; border:2px solid #1c1714; border-radius:6px; padding:3px 10px; font-weight:700; font-size:.75rem; background:#e3d4b8; color:#5b4f44;">Delete</button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>

  {:else if active === 'review'}
    <div style="font-size:.72rem; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:var(--orange); margin-bottom:10px;">✦ Admin</div>
    <h1 style="font-family:'Syne',sans-serif; font-weight:800; font-size:clamp(2.2rem,7vw,3.4rem); letter-spacing:-.02em; margin:0 0 8px; text-shadow:3px 3px 0 rgba(255,69,0,.16);">Review</h1>
    <p style="font-size:1rem; color:#5b4f44; margin:0 0 24px;">Every submission and its Slack thread. Messages you send here land in the project's thread.</p>
    <Review />

  {:else if active === 'stages'}
    <div style="font-size:.72rem; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:var(--orange); margin-bottom:10px;">✦ Admin</div>
    <h1 style="font-family:'Syne',sans-serif; font-weight:800; font-size:clamp(2.2rem,7vw,3.4rem); letter-spacing:-.02em; margin:0 0 8px; text-shadow:3px 3px 0 rgba(255,69,0,.16);">Stage jump</h1>
    <p style="font-size:1rem; color:#5b4f44; margin:0 0 24px;">Drop your own account at any point in the builder flow, then walk it as a builder would.</p>
    <Stages />

  {:else if active === 'signups'}
    <div style="font-size:.72rem; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:var(--orange); margin-bottom:10px;">✦ Admin</div>
    <h1 style="font-family:'Syne',sans-serif; font-weight:800; font-size:clamp(2.2rem,7vw,3.4rem); letter-spacing:-.02em; margin:0; text-shadow:3px 3px 0 rgba(255,69,0,.16);">Email signups</h1>
    
    {#if signupsStatus === 'loading'}
        <p style="color:#5b4f44; margin-top:24px;">Loading…</p>
    {:else if signupsStatus === 'error'}
        <p style="color:#c2451a; font-weight:700; margin-top:24px;">Couldn't load signups. Is the server running?</p>
    {:else}
      <p style="font-size:1rem; color:#5b4f44; margin:12px 0 24px;">Emails captured from the landing-page form. <strong>{signups.length}</strong> total.</p>
      {#if signups.length === 0}
        <p style="color:#5b4f44;">No signups yet.</p>
      {:else}
        <div style="overflow-x:auto; border:2.5px solid #1c1714; border-radius:16px 11px 15px 12px/12px 15px 11px 16px; box-shadow:5px 5px 0 rgba(28,23,20,.13); background:#fbf4e6;">
          <table style="width:100%; border-collapse:collapse; font-size:.85rem; min-width:560px;">
            <thead>
              <tr style="background:rgba(255,69,0,.1); text-align:left;">
                <th style="padding:12px 14px; font-family:'Syne',sans-serif;">Email</th>
                <th style="padding:12px 14px; font-family:'Syne',sans-serif;">Created</th>
              </tr>
            </thead>
            <tbody>
              {#each signups as s (s.id)}
                <tr style="border-top:2px dashed rgba(28,23,20,.22);">
                  <td style="padding:11px 14px; color:#5b4f44;">{s.email}</td>
                  <td style="padding:11px 14px; color:#5b4f44; white-space:nowrap;">{fmt(s.created_at)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}
  {/if}
  </div>
</div>

<style>
  .admin {
    position: relative;
    min-height: 100vh;
    background: #f4ead5;
    color: #1c1714;
    font-family: 'Space Grotesk', sans-serif;
    line-height: 1.5;
    overflow-x: hidden;
  }
  .grain {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 60;
    mix-blend-mode: multiply;
    opacity: 0.09;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 220px 220px;
  }
  .halftone {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 59;
    mix-blend-mode: multiply;
    opacity: 0.13;
    background-image: radial-gradient(rgba(28, 23, 20, 0.85) 22%, transparent 24%);
    background-size: 6px 6px;
  }

  .ai {
    padding: 10px 14px;
    border:2.5px solid #1c1714;
    border-radius:10px 14px 9px 13px/13px 9px 14px 10px;
    font-family:'Space Grotesk',sans-serif;
    font-size :0.88rem;
    background:#fbf4e6;
    color:#1c1714;
    outline:none;

  }
</style>
