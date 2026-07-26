<script lang="ts">
  import { onMount } from 'svelte'
  import ProfilePopover from './ProfilePopover.svelte'

  type Project = {
    id: string
    title: string
    description: string
    creator_name: string
    creator_slack_id: string | null
    category: string
    demo_url: string | null
    repo_url: string | null
    status: string
    tier: string
    badges: string[]
    created_at: string
    image_url: string | null
  }

  let projects = $state<Project[]>([])
  let projectsReady = $state(false)
  let projectsError = $state(false)
  let user = $state<{ name?: string; email?: string; slack_id?: string } | null>(null)
  let filterTier = $state('All')
  let sortBy = $state('recent')

  const SLACK_TEAM_URL = 'https://hackclub.slack.com/team/'
  const TIERS = ['All', 'Starter', 'Builder', 'Elite']
  const TIER_COLORS: Record<string, { bg: string; color: string }> = {
    Starter: { bg: 'rgba(91,79,68,.12)', color: '#5b4f44' },
    Builder: { bg: 'rgba(255,107,53,.16)', color: '#c2451a' },
    Elite: { bg: 'var(--orange)', color: '#fff' },
  }

  const shown = $derived.by(() => {
    let filtered = filterTier === 'All' ? projects : projects.filter((p) => p.tier === filterTier)
    if (sortBy === 'recent') {
      return filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    } else if (sortBy === 'tier') {
      const tierOrder = { Elite: 0, Builder: 1, Starter: 2 }
      return filtered.sort((a, b) => (tierOrder[a.tier as keyof typeof tierOrder] ?? 3) - (tierOrder[b.tier as keyof typeof tierOrder] ?? 3))
    }
    return filtered
  })

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    user = null
    location.reload()
  }

  onMount(async () => {
    try {
      const r = await fetch('/api/auth/me')
      if (r.ok) {
        user = await r.json()
      }
    } catch {
      user = null
    }

    try {
      const r = await fetch('/api/gallery/projects')
      if (!r.ok) throw new Error()
      projects = await r.json()
    } catch {
      projectsError = true
    } finally {
      projectsReady = true
    }
  })

  function go(path: string, e: MouseEvent) {
    e.preventDefault()
    history.pushState({}, '', path)
    dispatchEvent(new PopStateEvent('popstate'))
  }
</script>

<div class="gallery">
  <div class="grain"></div>
  <div class="halftone"></div>

  <header style="position:sticky; top:0; z-index:40; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:16px 24px; background:#f4ead5cc; backdrop-filter:blur(6px); border-bottom:2.5px solid #1c1714;">
    <a href="/" onclick={(e) => go('/', e)} style="display:inline-flex; align-items:center; gap:8px; font-family:'Syne',sans-serif; font-weight:800; font-size:1.1rem; color:#1c1714; text-decoration:none;">
      <span style="color:var(--orange);">Ω</span> Project Gallery
    </a>
    <ProfilePopover {user} size={42} onSignOut={logout} />
  </header>

  <div style="max-width:1100px; margin:0 auto; padding:48px 24px 8px;">
    <div style="font-size:.72rem; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:var(--orange); margin-bottom:10px;">✦ Showcase</div>
    <h1 style="font-family:'Syne',sans-serif; font-weight:800; font-size:clamp(2.2rem,7vw,3.4rem); letter-spacing:-.02em; margin:0; text-shadow:3px 3px 0 rgba(255,69,0,.16);">Built with Omega</h1>
    <p style="font-size:1rem; color:#5b4f44; margin:12px 0 0; max-width:560px; line-height:1.6;">Explore the projects built by the community. From Starter to Elite tier — real apps, real engineering.</p>

    <div style="display:flex; gap:16px; flex-wrap:wrap; margin-top:32px;">
      <div>
        <div style="font-size:.75rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:#5b4f44; margin-bottom:8px;">Tier</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          {#each TIERS as tier}
            <button
              onclick={() => (filterTier = tier)}
              style="padding:8px 16px; border:2px solid #1c1714; border-radius:100px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.82rem; cursor:pointer; box-shadow:2px 2px 0 rgba(28,23,20,.18); background:{filterTier === tier ? 'var(--orange)' : '#fbf4e6'}; color:{filterTier === tier ? '#fff' : '#1c1714'};"
            >{tier}</button>
          {/each}
        </div>
      </div>

      <div>
        <div style="font-size:.75rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:#5b4f44; margin-bottom:8px;">Sort</div>
        <select
          bind:value={sortBy}
          style="padding:8px 12px; border:2px solid #1c1714; border-radius:8px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.82rem; background:#fbf4e6; color:#1c1714; cursor:pointer;"
        >
          <option value="recent">Most recent</option>
          <option value="tier">Highest tier</option>
        </select>
      </div>
    </div>
  </div>

  <div style="max-width:1100px; margin:0 auto; padding:24px 24px 80px;">
    {#if !projectsReady}
      <p style="color:#5b4f44;">Loading the gallery…</p>
    {:else if projectsError}
      <p style="color:#c2451a; font-weight:700;">Couldn't load projects. Is the server running?</p>
    {:else if shown.length === 0}
      <p style="color:#5b4f44;">No projects yet. Be the first to ship something!</p>
    {:else}
      <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:20px;">
        {#each shown as project (project.id)}
          <div style="display:flex; flex-direction:column; background:#fbf4e6; border:2.5px solid #1c1714; border-radius:18px 12px 16px 13px/13px 16px 12px 18px; padding:20px; box-shadow:5px 5px 0 rgba(28,23,20,.13); overflow:hidden;">
            {#if project.image_url}
              <img
                src={project.image_url}
                alt={project.title}
                style="width:100%; height:180px; object-fit:cover; border:2.5px solid #1c1714; border-radius:13px 9px 12px 8px/8px 12px 9px 13px; background:#efe4cc; margin-bottom:14px; display:block;"
              />
            {:else}
              <div style="width:100%; height:180px; background:rgba(255,69,0,.1); border:2.5px solid #1c1714; border-radius:13px 9px 12px 8px/8px 12px 9px 13px; margin-bottom:14px; display:flex; align-items:center; justify-content:center; color:#c2451a; font-size:2rem;">
                🚀
              </div>
            {/if}

            <div style="font-family:'Syne',sans-serif; font-size:1.1rem; font-weight:800; margin-bottom:6px; line-height:1.3;">{project.title}</div>

            <div style="font-size:.9rem; color:#5b4f44; line-height:1.5; flex:1; margin-bottom:12px;">{project.description}</div>

            <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; font-size:.85rem;">
              {#if project.creator_slack_id}
                <a href={`${SLACK_TEAM_URL}${project.creator_slack_id}`} target="_blank" rel="noopener" style="color:var(--orange); text-decoration:underline; text-decoration-style:wavy; font-weight:600;">
                  @{project.creator_name}
                </a>
              {:else}
                <span style="color:#5b4f44; font-weight:600;">{project.creator_name}</span>
              {/if}
            </div>

            {#if project.badges && project.badges.length > 0}
              <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;">
                {#each project.badges as badge}
                  <span style="display:inline-block; font-size:.62rem; font-weight:700; letter-spacing:.08em; text-transform:uppercase; padding:3px 8px; border:1px solid #1c1714; border-radius:4px; background:rgba(255,69,0,.12); color:#c2451a;">
                    {badge}
                  </span>
                {/each}
              </div>
            {/if}

            <div style="display:flex; align-items:center; gap:8px; margin-bottom:14px;">
              <span
                style="display:inline-block; padding:4px 10px; border:1.5px solid #1c1714; border-radius:6px; font-size:.62rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; background:{TIER_COLORS[project.tier]?.bg}; color:{TIER_COLORS[project.tier]?.color};"
              >
                {project.tier}
              </span>
            </div>

            <div style="display:flex; gap:8px;">
              {#if project.demo_url}
                <a
                  href={project.demo_url}
                  target="_blank"
                  rel="noopener"
                  style="flex:1; display:inline-flex; align-items:center; justify-content:center; background:var(--orange); color:#fff; border:2px solid #1c1714; border-radius:9px 13px 8px 12px/12px 8px 13px 9px; padding:8px 12px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.8rem; text-decoration:none; box-shadow:3px 3px 0 #1c1714;"
                >
                  Demo →
                </a>
              {/if}
              {#if project.repo_url}
                <a
                  href={project.repo_url}
                  target="_blank"
                  rel="noopener"
                  style="flex:1; display:inline-flex; align-items:center; justify-content:center; background:#fbf4e6; color:#1c1714; border:2px solid #1c1714; border-radius:13px 9px 12px 8px/8px 12px 9px 13px; padding:8px 12px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.8rem; text-decoration:none; box-shadow:2px 2px 0 rgba(28,23,20,.13);"
                >
                  Code
                </a>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .gallery {
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
</style>
