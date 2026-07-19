<script lang="ts">
  import { onMount } from 'svelte'

  function go(path: string, e: MouseEvent) {
    e.preventDefault()
    history.pushState({}, '', path)
    dispatchEvent(new PopStateEvent('popstate'))
  }

  type Item = {
    id: number
    slug: string
    name: string
    description: string
    cost: number
    category: 'hardware' | 'dev_account' | 'gear' | 'tools'
    icon: string | null
    image_url: string | null
    stock: number | null
  }
  
  type ShopUser = {
    name?: string
    slack_id?: string
    tokens: number
  }

  let balance = $state(0)
  let user = $state<ShopUser | null>(null)
  let items = $state<Item[]>([])
  let itemsReady = $state(false)
  let itemsError = $state(false)
  let active = $state('All')

  onMount(async () => {
    try {
      const r = await fetch('/api/auth/me', { credentials: 'include' })
      if (r.ok) {
        const data = (await r.json()) as ShopUser
        user = data

        const tokens = Number(data.tokens)
        balance = Number.isFinite(tokens) ? tokens : 0
      }
    } catch {
      balance = 0
    }
    try {
      const r = await fetch('/api/shop/items')
      if (!r.ok) throw new Error()
      items = await r.json()
    } catch {
      itemsError = true
    } finally {
      itemsReady = true
    }
  })

  // presentation lives here (NOT in the DB)
  const CAT = {
    hardware: { label: 'hardware', tagBg: 'rgba(74,150,80,.16)', tagColor: '#3d7a40', iconBg: 'rgba(74,150,80,.16)' },
    dev_account: { label: 'dev account', tagBg: 'rgba(255,69,0,.12)', tagColor: '#c2451a', iconBg: 'rgba(255,69,0,.14)' },
    gear: { label: 'gear', tagBg: 'rgba(255,179,71,.2)', tagColor: '#b07410', iconBg: 'rgba(255,179,71,.2)' },
    tools: { label: 'tools', tagBg: 'rgba(47,109,176,.13)', tagColor: '#2f6db0', iconBg: 'rgba(47,109,176,.13)' },
  } as const

  const RADII = [
    '18px 11px 16px 12px/12px 16px 11px 18px',
    '11px 18px 12px 16px/16px 12px 18px 11px',
    '16px 12px 18px 11px/11px 18px 12px 16px',
    '12px 16px 11px 18px/18px 11px 16px 12px',
    '15px 11px 16px 9px/9px 16px 11px 15px',
    '11px 15px 9px 16px/16px 9px 15px 11px',
  ]

  const categories = ['All', 'Hardware', 'Dev account', 'Gear', 'Tools']
  const shown = $derived(
    active === 'All'
      ? items
      : items.filter((i) => CAT[i.category]?.label.toLowerCase() === active.toLowerCase()),
  )
</script>

<div class="shop">
  <div class="grain"></div>
  <div class="halftone"></div>

  <header style="position:sticky; top:0; z-index:40; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:16px 24px; background:#f4ead5cc; backdrop-filter:blur(6px); border-bottom:2.5px solid #1c1714;">
    <a href="/" onclick={(e) => go('/', e)} style="display:inline-flex; align-items:center; gap:8px; font-family:'Syne',sans-serif; font-weight:800; font-size:1.1rem; color:#1c1714; text-decoration:none;">
      <span style="color:var(--orange);">Ω</span> Omega Shop
    </a>
    <div style="display:flex; align-items:center; gap:12px;">
      <div style="display:inline-flex; align-items:center; gap:8px; background:#fbf4e6; border:2.5px solid #1c1714; border-radius:100px; padding:8px 16px; font-weight:700; box-shadow:3px 3px 0 rgba(28,23,20,.13);">
        <span style="color:var(--orange);">⏣</span> {balance} <span style="font-size:.8rem; color:#5b4f44;">tokens</span>
      </div>
      {#if user?.slack_id}
        <img
          src={`https://cachet.dunkirk.sh/users/${user.slack_id}/r`}
          alt={user.name ?? 'Profile'}
          referrerpolicy="no-referrer"
          style="width:42px; height:42px; border-radius:50%; border:2.5px solid #1c1714; box-shadow:3px 3px 0 #1c1714; object-fit:cover; background:#fbf4e6;"
        />
      {/if}
    </div>
  </header>

  <div style="max-width:980px; margin:0 auto; padding:48px 24px 8px;">
    <div style="font-size:.72rem; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:var(--orange); margin-bottom:10px;">✦ Redeem your hours</div>
    <h1 style="font-family:'Syne',sans-serif; font-weight:800; font-size:clamp(2.2rem,7vw,3.4rem); letter-spacing:-.02em; margin:0; text-shadow:3px 3px 0 rgba(255,69,0,.16);">The Omega Shop</h1>
    <p style="font-size:1rem; color:#5b4f44; margin:12px 0 0; max-width:560px; line-height:1.6;">Spend the tokens you earned from approved hours.<br> Higher tiers = more tokens per hour.</p>

    <div style="display:flex; gap:9px; flex-wrap:wrap; margin-top:24px;">
      {#each categories as c}
        <button
          onclick={() => (active = c)}
          style="padding:8px 16px; border:2px solid #1c1714; border-radius:100px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.82rem; cursor:pointer; box-shadow:2px 2px 0 rgba(28,23,20,.18); background:{active === c ? 'var(--orange)' : '#fbf4e6'}; color:{active === c ? '#fff' : '#1c1714'};"
        >{c}</button>
      {/each}
    </div>
  </div>

  <div style="max-width:980px; margin:0 auto; padding:24px 24px 80px;">
    {#if !itemsReady}
      <p style="color:#5b4f44;">Loading the shop…</p>
    {:else if itemsError}
      <p style="color:#c2451a; font-weight:700;">Couldn't load items. Is the server running?</p>
    {:else if shown.length === 0}
      <p style="color:#5b4f44;">Nothing in this category yet.</p>
    {:else}
      <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:18px;">
        {#each shown as item, i (item.id)}
          {@const c = CAT[item.category]}
          {@const soldOut = item.stock !== null && item.stock <= 0}
          <div style="display:flex; flex-direction:column; background:#fbf4e6; border:2.5px solid #1c1714; border-radius:{RADII[i % RADII.length]}; padding:20px; box-shadow:5px 5px 0 rgba(28,23,20,.13);">
            {#if item.image_url}
                <img
                    src={item.image_url}
                    alt={item.name}
                    style="width:100%; height:150px; object-fit:cover; border:2.5px solid #1c1714; border-radius:13px 9px 12px 8px/8px 12px 9px 13px; background:#efe4cc; margin-bottom:14px; display:block;"
                    />
            {:else}
                <div style="width:54px; height:54px; display:flex; align-items:center; justify-content:center; font-size:1.6rem; border:2.5px solid #1c1714; border-radius:13px 9px 12px 8px/8px 12px 9px 13px; background:{c?.iconBg ?? 'rgba(255,69,0,.14)'}; margin-bottom:14px;">{item.icon ?? '★'}</div>
            {/if} 

            <div style="font-family:'Syne',sans-serif; font-size:1.05rem; font-weight:800; margin-bottom:5px;">{item.name}</div>
            <div style="font-size:.82rem; color:#5b4f44; line-height:1.55; flex:1;">{item.description}</div>
            <span style="align-self:flex-start; margin-top:12px; font-size:.62rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; padding:4px 10px; border:1.5px solid #1c1714; border-radius:6px; background:{c?.tagBg}; color:{c?.tagColor};">{c?.label ?? item.category}</span>
            <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:16px;">
              <div style="font-family:'Syne',sans-serif; font-weight:800; font-size:1.2rem;"><span style="color:var(--orange);">⏣</span> {item.cost}</div>
              <button
                disabled={soldOut || balance < item.cost}
                style="background:{soldOut || balance < item.cost ? '#d8cbb0' : 'var(--orange)'}; color:#fff; border:2.5px solid #1c1714; border-radius:9px 13px 8px 12px/12px 8px 13px 9px; padding:9px 16px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.82rem; cursor:{soldOut || balance < item.cost ? 'not-allowed' : 'pointer'}; box-shadow:3px 3px 0 #1c1714;"
              >{soldOut ? 'Sold out' : balance < item.cost ? 'Locked' : 'Redeem'}</button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .shop {
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
  button {
    transition: transform 0.1s;
  }
  button:not(:disabled):hover {
    transform: translate(-1px, -1px);
  }
</style>
