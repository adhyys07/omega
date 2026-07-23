<script lang="ts">
  import { onMount } from 'svelte'

  type Sub = {
    id: string
    title: string | null
    submitter_name: string | null
    submitter_email: string | null
    submitter_slack_id: string | null
    submitter_slack_username: string | null
    status: string
    first_name: string | null
    last_name: string | null
    code_url: string | null
    playable_url?: string | null
    demo_video_url?: string | null
    ai_used?: boolean | null
    ai_disclosure?: string | null
    hackatime_hours: number | null
    description?: string | null
    why?: string | null
    hasThread: boolean
    created_at: string | null
    badges?: string[]
    tier?: string | null
    approved_hours?: number | null
    payout_tokens?: number | null
    paid_at?: string | null
    /** Reviewer-only duplicate-idea verdict. Never sent to the pitch's author. */
    duplicate_check?: {
      checkedAt: string
      matches: { id: string; title: string; score: number; reason: string }[]
    } | null
  }

  type Readme = { found: boolean; content: string; chars: number; htmlUrl: string | null; path: string | null }
  
  type GhCheck = {
    host: string
    repo: { owner: string, name: string } | null
    exists: boolean
    isPublic: boolean
    readme: { found: boolean; chars: number; tooSmall: boolean; htmlUrl: string | null } | null
    error?: string
  }

  const apiFetch = (input: string, init: RequestInit = {}) =>
    fetch(input, { credentials: 'include', ...init })

  const SLACK_TEAM_URL = 'https://hackclub.slack.com/team/'

  let gh = $state<{ check: GhCheck | null; readme: Readme | null } | null>(null)

  let loadingGh = $state(false)
  let showReadme = $state(false)

  type Badge = { slug: string; label: string; icon: string; criteria: string; bg: string; color: string }
  type TierDef = { slug: string; label: string; icon: string; multiplier: number; blurb: string; bg: string; color: string }

  let catalog = $state<Badge[]>([])
  let awarded = $state<Set<string>>(new Set())
  let savingBadges = $state(false)
  let badgeMsg = $state('')
  let acting = $state(false)
  let feedback = $state('')
  let internalJustification = $state('')
  let decisionAction = $state<'approve' | 'reject' | 'request_changes'>('approve')
  let requestedChangesCount = $state<number | null>(null)
  let actionMsg = $state('')
  let actionErr = $state('')
  let pitchSearch = $state('')
  let queueSearch = $state('')
  let queueStatus = $state<'all' | 'pending' | 'changes_requested'>('all')
  let tiers = $state<TierDef[]>([])
  let tier = $state<string>('')
  let hours = $state<number | null>(null)
  
  type Msg = {
    ts: string
    author: string
    avatar_url?: string | null
    text: string
    isBot: boolean
    isParent: boolean
  }

  // Pitches (the idea) and projects (the build) are reviewed the same way but
  // live in different tables, so the endpoints differ by kind.
  type Kind = 'projects' | 'pitches'
  let kind = $state<Kind>('pitches')

  const listUrl = (k: Kind) => (k === 'pitches' ? '/api/review/pitches' : '/api/review/submissions')
  const threadUrl = (k: Kind, id: string) =>
    k === 'pitches' ? `/api/review/pitches/${id}/thread` : `/api/review/${id}/thread`
  const messageUrl = (k: Kind, id: string) =>
    k === 'pitches' ? `/api/review/pitches/${id}/message` : `/api/review/${id}/message`
  const actionUrl = (k: Kind, id: string) =>
    k === 'pitches' ? `/api/review/pitches/${id}/action` : `/api/review/${id}/action`
  const chosenTier = $derived(tiers.find((t) => t.slug === tier) ?? null)
  // Same formula as the server's computePayout, so the preview and the payout agree.
  const preview = $derived(
    chosenTier && hours != null && hours > 0 ? Math.round(hours * 10 * chosenTier.multiplier) : null)
  

  let subs = $state<Sub[]>([])
  let loading = $state(true)
  let listErr = $state('')
  let selected = $state<Sub | null>(null)
  let messages = $state<Msg[]>([])
  const visibleMessages = $derived(messages.filter((m) => !m.isParent))
  let draft = $state('')
  let dmSubmitter = $state(false)
  let sending = $state(false)
  let loadingThread = $state(false)
  let err = $state('')

  // The other half of an idea's life: for a project, the pitch it came from; for a
  // pitch, the project that fulfilled it. Lets a reviewer answer "did they build what
  // they pitched?" without leaving the panel.
  type Counterpart = {
    id: string
    title: string | null
    status: string
    description: string | null
    why?: string | null
    review_feedback?: string | null
    code_url?: string | null
    playable_url?: string | null
    created_at?: string | null
  }
  let linked = $state<Counterpart | null>(null)
  let linkedReason = $state('')
  let loadingLink = $state(false)

  const linkUrl = (k: Kind, id: string) =>
    k === 'pitches' ? `/api/review/pitches/${id}/project` : `/api/review/${id}/pitch`

  const LINK_EMPTY: Record<string, string> = {
    not_built: 'Not built yet — no project has been submitted against this pitch.',
    no_pitch: 'No pitch attached. This project predates the pitch gate.',
    missing: 'The pitch this project points at no longer exists.',
  }

  const STATUS_STYLE: Record<string, string> = {
    approved: 'background:rgba(74,150,80,.16); color:#3d7a40;',
    rejected: 'background:rgba(179,38,30,.14); color:#b3261e;',
    pending: 'background:rgba(255,179,71,.22); color:#b07410;',
    changes_requested: 'background:rgba(47,109,176,.14); color:#2f6db0;',
    withdrawn: 'background:rgba(28,23,20,.10); color:#5b4f44;',
  }
  const STATUS_LABEL: Record<string, string> = { changes_requested: 'changes req.' }

  /** Shared look for the repo / demo / video / readme row. */
  const btn = `
    display:inline-flex; align-items:center; gap:6px; cursor:pointer;
    padding:6px 13px; border:2px solid #1c1714;
    border-radius:9px 12px 8px 11px/11px 8px 12px 9px;
    background:#fbf4e6; color:#1c1714; text-decoration:none;
    font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.78rem;
    box-shadow:2px 2px 0 rgba(28,23,20,.18);
  `

  /** "14 Jul 2026, 18:42" — absolute, because a reviewer comparing a pitch to the
   *  project built from it cares about the real dates, not "3 days ago". */
  function fmtDate(iso: string | null | undefined): string {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  /** Short form for the dense queue rows. */
  function fmtDay(iso: string | null | undefined): string {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  }

  onMount(async () => {
    // Deep link from a Slack card: ?kind=pitches|projects&id=recXXX — pick the tab
    // BEFORE loading so we fetch the right list, then open the item it names.
    const q = new URLSearchParams(location.search)
    const wantKind = q.get('kind')
    const wantId = q.get('id')
    if (wantKind === 'pitches' || wantKind === 'projects') kind = wantKind

    await load()

    if (wantId) {
      const hit = subs.find((s) => s.id === wantId)
      if (hit) open(hit)
      else listErr = 'That item is no longer in this queue.'
    }

    // Badge + tier catalogs. Both non-fatal: the chips / payout multipliers just
    // don't render if the fetch fails.
    try {
      const r = await fetch('/api/review/badges')
      if (r.ok) catalog = await r.json()
    } catch {}
    try {
      const r = await fetch('/api/review/tiers')
      if (r.ok) tiers = await r.json()
    } catch {}
  })

  function toggleBadge(slug: string) {
    const next = new Set(awarded)
    if (next.has(slug)) next.delete(slug)
    else next.add(slug)
    awarded = next   // reassign — Svelte 5 does not track Set mutation
  }

  async function saveBadges() {
    if (!selected) return
    savingBadges = true
    badgeMsg = ''
    try {
      const r = await fetch(`/api/review/${selected.id}/badges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ badges: [...awarded] }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Save failed')
      const saved = [...awarded]
      selected.badges = saved
      // keep the queue list in sync so the row's chips update too
      const inList = subs.find((s) => s.id === selected!.id)
      if (inList) inList.badges = saved
      badgeMsg = 'Saved ✓'
    } catch (e) {
      badgeMsg = e instanceof Error ? e.message : 'Save failed'
    } finally {
      savingBadges = false
    }
  }

  async function load() {
    
    loading = true
    listErr = ''
    selected = null
    messages = []
    try {
      const params = new URLSearchParams()
      if (kind === 'pitches' && pitchSearch.trim()) params.set('q', pitchSearch.trim())
      const url = params.size ? `${listUrl(kind)}?${params.toString()}` : listUrl(kind)
      const r = await apiFetch(url)
      if (!r.ok) throw new Error()
      subs = await r.json()
    } catch {
      listErr = `Couldn't load ${kind}. Is the server running?`
    } finally {
      loading = false
    }
  }

  function switchKind(k: Kind) {
    if (k === kind) return
    kind = k
    load()
  }

  async function open(s: Sub) {
    selected = s
    messages = []
    err = ''
    badgeMsg = ''
    actionMsg = ''
    actionErr = ''
    feedback = ''
    internalJustification = ''
    decisionAction = 'approve'
    requestedChangesCount = null
    awarded = new Set(s.badges ?? [])   // pre-toggle chips to what's already awarded
    // Prefill the payout bar: a prior assessment if one exists, else the reviewer
    // starts from the builder's claimed hours and adjusts.
    tier = s.tier ?? ''
    hours = s.approved_hours ?? s.hackatime_hours ?? null

    loadCounterpart(kind, s.id)   // independent of the thread; don't await
    loadGithub(s.id)              // no-ops for pitches, which have no repo

    if (!s.hasThread) return
    loadingThread = true
    try {
      const r = await apiFetch(threadUrl(kind, s.id))
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Could not load the thread')
      const data = await r.json()
      messages = data.messages ?? []
    } catch (e) {
      err = e instanceof Error ? e.message : 'Could not load the thread'
    } finally {
      loadingThread = false
    }
  }

  /** Best-effort: a failure here must never blank out the item you're reviewing. */
  async function loadCounterpart(k: Kind, id: string) {
    linked = null
    linkedReason = ''
    loadingLink = true
    try {
      const r = await apiFetch(linkUrl(k, id))
      if (!r.ok) throw new Error('lookup failed')
      const data = await r.json()
      // A stale response from a previously-selected row must not overwrite the
      // current one — the user can click through the queue faster than Airtable replies.
      if (selected?.id !== id) return
      linked = data.pitch ?? data.project ?? null
      linkedReason = linked ? '' : (data.reason ?? '')
    } catch {
      if (selected?.id === id) linkedReason = 'error'
    } finally {
      if (selected?.id === id) loadingLink = false
    }
  }

  async function loadGithub(id: string) {
    gh = null
    showReadme = false
    if (kind != 'projects') return
    loadingGh = true
    try {
      const r = await apiFetch(`/api/review/${id}/github`)
      if (!r.ok) throw new Error('lookup failed')
      const data = await r.json()
      if (selected?.id !== id) return        // stale response — user moved on
      gh = data
    } catch {
      if (selected?.id === id) gh = null
    } finally {
      if (selected?.id === id) loadingGh = false
    }
  }

  async function act(action: 'approve' | 'reject' | 'request_changes') {
    if (!selected) return
    actionErr = ''
    actionMsg = ''

    // Requesting changes requires clear reviewer guidance.
    if (action === 'request_changes' && !feedback.trim()) {
      actionErr = 'Please provide feedback for the submitter.'
      return
    }
    if (action === 'request_changes' && (requestedChangesCount == null || requestedChangesCount < 1)) {
      actionErr = 'Enter how many changes are required.'
      return
    }

    // Approving a project must carry a tier + hours, or the server rejects it.
    if (kind === 'projects' && action === 'approve') {
      if (!tier) { actionErr = 'Pick a tier before approving.'; return }
      if (hours == null || hours <= 0) { actionErr = 'Enter the approved hours.'; return }
      if (!internalJustification.trim()) { actionErr = 'Enter the override-hour justification.'; return }
    }

    const feedbackForAction =
      action === 'request_changes' && requestedChangesCount != null
        ? `[Changes requested: ${requestedChangesCount}] ${feedback.trim()}`
        : feedback.trim()

    acting = true
    try {
      const r = await apiFetch(actionUrl(kind, selected.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          feedback: feedbackForAction,
          user_feedback: feedbackForAction,
          internal_justification: internalJustification.trim(),
          ...(kind === 'projects' && action === 'approve' ? { tier, approved_hours: hours } : {}),
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error ?? 'Action failed')
      selected.status = data.status
      const inList = subs.find((s) => s.id === selected!.id)
      if (inList) inList.status = data.status
      // Reflect what was just paid, so the bar shows it without a reload.
      if (data.payout) {
        selected.tier = data.payout.tier
        selected.approved_hours = data.payout.hours
        selected.payout_tokens = data.payout.tokens
        selected.paid_at = new Date().toISOString()
      }
      feedback = ''
      internalJustification = ''
      requestedChangesCount = null
      const msg = data.payout
        ? `Approved · paid ${data.payout.tokens} Ω ✓`
        : `Marked ${data.status.replace('_', ' ')} ✓`
      // open() resets actionMsg, so re-set it after refreshing the thread.
      if (selected.hasThread) await open(selected)
      actionMsg = msg
    } catch (e) {
      actionErr = e instanceof Error ? e.message : 'Action failed'
    } finally {
      acting = false
    }
  }
  async function send() {
    const text = draft.trim()
    if (!text || !selected) return
    sending = true
    err = ''
    try {
      const r = await apiFetch(messageUrl(kind, selected.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, dmSubmitter }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Send failed')
      draft = ''
      await open(selected) // re-read the thread; Slack is the source of truth
    } catch (e) {
      err = e instanceof Error ? e.message : 'Send failed'
    } finally {
      sending = false
    }
  }

  // Slack ts is "epochSeconds.micros".
  const fmtTs = (ts: string) => new Date(Number(ts) * 1000).toLocaleString()
  const who = (s: Sub) => s.submitter_name || `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim() || '—'

  const filteredSubs = $derived.by(() => {
    const query = queueSearch.trim().toLowerCase()
    return subs.filter((s) => {
      const matchesStatus = queueStatus === 'all' || s.status === queueStatus
      const haystack = `${s.title ?? ''} ${s.submitter_name ?? ''} ${s.submitter_email ?? ''} ${s.submitter_slack_username ?? ''}`.toLowerCase()
      return matchesStatus && (!query || haystack.includes(query))
    })
  })
  const pendingCount = $derived(subs.filter((s) => s.status === 'pending').length)
  const changesCount = $derived(subs.filter((s) => s.status === 'changes_requested').length)
  const selectedPosition = $derived(selected ? filteredSubs.findIndex((s) => s.id === selected?.id) + 1 : 0)

  const card =
    'background:#fbf4e6; border:2.5px solid #1c1714; border-radius:16px 11px 15px 12px/12px 15px 11px 16px; box-shadow:5px 5px 0 rgba(28,23,20,.13);'
</script>

<div class="review-switcher" aria-label="Review queue type">
  {#each [{ k: 'pitches', label: '💡 Pitches' }, { k: 'projects', label: '🚀 Projects' }] as t}
    <button
      onclick={() => switchKind(t.k as Kind)}
      style="
        padding:8px 16px; border:2px solid #1c1714; cursor:pointer;
        border-radius:10px 14px 9px 13px/13px 9px 14px 10px;
        font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.82rem;
        box-shadow:2px 2px 0 rgba(28,23,20,.18);
        background:{kind === t.k ? 'var(--orange)' : '#fbf4e6'};
        color:{kind === t.k ? '#fff' : '#1c1714'};
      "
    >{t.label}</button>
  {/each}
</div>

<div class="review-overview" aria-label="Queue overview">
  <div><span class="overview-label">Queue</span><strong>{subs.length}</strong><span>{kind}</span></div>
  <div><span class="overview-dot pending-dot"></span><strong>{pendingCount}</strong><span>pending</span></div>
  <div><span class="overview-dot changes-dot"></span><strong>{changesCount}</strong><span>reships</span></div>
  <button onclick={load} disabled={loading} class="refresh-queue" title="Refresh the current queue">
    {loading ? 'Refreshing…' : '↻ Refresh'}
  </button>
</div>

{#if kind === 'pitches'}
  <div class="remote-search">
    <input
      bind:value={pitchSearch}
      onkeydown={(e) => e.key === 'Enter' && load()}
      placeholder="Search by name, email, or Slack username"
      style="min-width:280px; flex:1; padding:8px 12px; border:2px solid #1c1714; border-radius:9px; font-family:'Space Grotesk',sans-serif; background:#fbf4e6;"
    />
    <button
      onclick={load}
      style="padding:8px 14px; border:2px solid #1c1714; border-radius:9px; font-family:'Space Grotesk',sans-serif; font-weight:700; background:var(--orange); color:#fff; cursor:pointer;"
    >Search</button>
    <button
      onclick={() => { pitchSearch = ''; load() }}
      style="padding:8px 14px; border:2px solid #1c1714; border-radius:9px; font-family:'Space Grotesk',sans-serif; font-weight:700; background:#fbf4e6; color:#1c1714; cursor:pointer;"
    >Clear</button>
  </div>
{/if}

{#if loading}
  <p style="color:#5b4f44;">Loading…</p>
{:else if listErr}
  <p style="color:#c2451a; font-weight:700;">{listErr}</p>
{:else if !subs.length}
  <p style="color:#5b4f44;">No {kind} yet.</p>
{:else}
  <div class="review-grid">
    <!-- queue -->
    <aside class="queue-panel" style={card} aria-label={`${kind} review queue`}>
      <div class="queue-header">
        <div><span class="queue-eyebrow">Review next</span><div class="queue-title">{kind === 'pitches' ? 'Pitch queue' : 'Project queue'}</div></div>
        <span class="queue-total">{filteredSubs.length}/{subs.length}</span>
      </div>
      <div class="queue-tools">
        <label class="queue-search"><span aria-hidden="true">⌕</span><input bind:value={queueSearch} placeholder="Filter this queue…" aria-label="Filter queue" /></label>
        <div class="queue-filters" aria-label="Filter by status">
          <button class:active={queueStatus === 'all'} onclick={() => (queueStatus = 'all')}>All</button>
          <button class:active={queueStatus === 'pending'} onclick={() => (queueStatus = 'pending')}>Pending</button>
          <button class:active={queueStatus === 'changes_requested'} onclick={() => (queueStatus = 'changes_requested')}>Reships</button>
        </div>
      </div>
      <div class="queue-list">
        {#if filteredSubs.length === 0}
          <div class="queue-empty"><strong>No matching work</strong><span>Try another search or status filter.</span></div>
        {/if}
        {#each filteredSubs as s, index (s.id)}
          <button
            onclick={() => open(s)}
            class="queue-item"
            class:selected={selected?.id === s.id}
            aria-current={selected?.id === s.id ? 'true' : undefined}
          >
            <span class="queue-index">{String(index + 1).padStart(2, '0')}</span>
            <div style="font-weight:700; color:#1c1714; font-size:.88rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
              {s.title ?? 'Untitled'}
            </div>
            <div style="display:flex; align-items:center; gap:6px; margin-top:4px; flex-wrap:wrap;">
              <span style="display:inline-block; padding:2px 8px; border:1.5px solid #1c1714; border-radius:6px; font-size:.62rem; font-weight:700; text-transform:uppercase; letter-spacing:.06em; {STATUS_STYLE[s.status] ?? STATUS_STYLE.pending}">
                {STATUS_LABEL[s.status] ?? s.status}
              </span>
              <span style="font-size:.72rem; color:#5b4f44;">{who(s)}</span>
              {#if s.submitter_slack_id}
                <a href={`${SLACK_TEAM_URL}${s.submitter_slack_id}`} target="_blank" rel="noopener" style="font-size:.7rem; color:var(--orange); text-decoration:underline; text-decoration-style:wavy; text-underline-offset:2px;">· @{s.submitter_slack_username?.replace(/^@/, '') ?? s.submitter_slack_id}</a>
              {/if}
              {#if s.submitter_email}
                <span style="font-size:.7rem; color:#5b4f44;">· {s.submitter_email}</span>
              {/if}
              {#if s.created_at}
                <span title={fmtDate(s.created_at)} style="font-size:.72rem; color:#5b4f44;">· {fmtDay(s.created_at)}</span>
              {/if}
              {#if s.duplicate_check?.matches?.length}
                <span title="Possible duplicate idea — open to see the matches" style="font-size:.72rem; color:#b07410; font-weight:700;">🤖 dupe?</span>
              {/if}
              {#if kind === 'projects' && !s.hasThread}
                <span title="No Slack thread — predates the integration, or the card failed to post" style="font-size:.72rem; color:#b07410;">⚠ no thread</span>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    </aside>

    <!-- review workspace -->
    <main class="review-detail" style={card}>
      {#if !selected}
        <div class="review-empty-state">
          <span class="empty-mark">Ω</span>
          <strong>Select something to review</strong>
          <p>Choose an item from the queue. Its evidence, linked work, conversation, and decision controls will appear here.</p>
        </div>
      {:else}
        <div class="review-header">
          <div class="review-heading">
            <div class="selected-context">
              <span>{kind === 'pitches' ? 'Pitch review' : 'Project review'}</span>
              {#if selectedPosition > 0}<span>Item {selectedPosition} of {filteredSubs.length}</span>{/if}
              <span class="selected-status" style={STATUS_STYLE[selected.status] ?? STATUS_STYLE.pending}>{STATUS_LABEL[selected.status] ?? selected.status}</span>
            </div>
            {#if kind === 'projects' && (selected.playable_url || selected.code_url)}
              <a
                href={selected.playable_url ?? selected.code_url ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                class="selected-project-link"
                title={`Open ${selected.playable_url ? 'demo' : 'repository'}`}
              >{selected.title ?? 'Untitled'} ↗</a>
            {:else}
              <div class="selected-project-title">{selected.title ?? 'Untitled'}</div>
            {/if}
            <div class="review-meta">
              {who(selected)}
              {#if selected.submitter_slack_id}
                <a href={`${SLACK_TEAM_URL}${selected.submitter_slack_id}`} target="_blank" rel="noopener" style="color:var(--orange); text-decoration:underline; text-decoration-style:wavy; text-underline-offset:2px;"> · @{selected.submitter_slack_username?.replace(/^@/, '') ?? selected.submitter_slack_id}</a>
              {/if}
              {#if selected.submitter_email} · {selected.submitter_email}{/if}
              {#if selected.created_at} · <span title="Submitted">🕘 {fmtDate(selected.created_at)}</span>{/if}
              {#if selected.hackatime_hours} · {selected.hackatime_hours}h{/if}
            </div>
          </div>

          {#if kind === 'projects'}
            <div class="primary-project-actions" aria-label="Project links">
              {#if selected.playable_url}
                <a href={selected.playable_url} target="_blank" rel="noopener noreferrer" style={btn}>▶ Demo</a>
              {/if}
              {#if selected.code_url}
                <a href={selected.code_url} target="_blank" rel="noopener noreferrer" style={btn}>⌥ Repo</a>
              {/if}
              {#if selected.demo_video_url}
                <a href={selected.demo_video_url} target="_blank" rel="noopener noreferrer" style={btn}>🎬 Video</a>
              {:else}
                <button
                  disabled
                  title="No video submitted"
                  style="{btn} background:#d8c8ab; color:#5b4f44; border-color:#5b4f44; box-shadow:none; opacity:.72; cursor:not-allowed;"
                >🎬 Video</button>
              {/if}
            </div>
          {/if}
        </div>

        <!-- GitHub validation and README controls stay together below the header. -->
        {#if kind === 'projects'}
          <div style="padding:10px 16px; border-bottom:2px dashed rgba(28,23,20,.28); display:flex; gap:8px; flex-wrap:wrap; align-items:center; background:rgba(28,23,20,.025);">
            <button
              onclick={() => (showReadme = !showReadme)}
              disabled={!gh?.readme?.found}
              style="{btn} opacity:{gh?.readme?.found ? 1 : 0.45}; cursor:{gh?.readme?.found ? 'pointer' : 'not-allowed'};"
            >
              📄 README{#if gh?.readme?.found} · {gh.readme.chars} chars{/if}
            </button>

            {#if loadingGh}
              <span style="font-size:.76rem; color:#5b4f44;">checking GitHub…</span>
            {:else if gh?.check}
              <!-- `error` means the CHECK failed (rate limit, network) — not that the
                   repo is bad. Never render that as an accusation against the builder. -->
              {#if gh.check.error}
                <span style="font-size:.76rem; color:#b07410;">⚠ {gh.check.error}</span>
              {:else if gh.check.host !== 'github'}
                <span style="font-size:.76rem; color:#5b4f44;">not a GitHub repo — check manually</span>
              {:else if !gh.check.exists}
                <span style="font-size:.76rem; color:#b3261e; font-weight:700;">⚠ repo not found</span>
              {:else if !gh.check.isPublic}
                <span style="font-size:.76rem; color:#b3261e; font-weight:700;">🔒 repo is PRIVATE</span>
              {:else if gh.check.readme?.tooSmall}
                <span style="font-size:.76rem; color:#b07410; font-weight:700;">⚠ README is thin ({gh.check.readme.chars} chars)</span>
              {:else if gh.check.readme?.found}
                <span style="font-size:.76rem; color:#3d7a40; font-weight:700;">✓ public · README looks fine</span>
              {:else}
                <span style="font-size:.76rem; color:#b07410; font-weight:700;">⚠ no README</span>
              {/if}
            {/if}
          </div>

          {#if showReadme && gh?.readme?.found}
            <div style="padding:14px 16px; border-bottom:2px dashed rgba(28,23,20,.28); background:rgba(28,23,20,.03);">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:8px;">
                <span style="font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.8rem;">{gh.readme.path}</span>
                {#if gh.readme.htmlUrl}
                  <a href={gh.readme.htmlUrl} target="_blank" rel="noopener" style="font-size:.76rem; color:#c2451a; font-weight:700; text-decoration:none; white-space:nowrap;">open on GitHub ↗</a>
                {/if}
              </div>
              <!-- Rendered as TEXT on purpose. A README is attacker-controlled content
                   from an untrusted submitter; running it through a markdown->HTML
                   renderer here would be stored XSS aimed straight at an admin session.
                   Svelte escapes interpolation, so this stays inert. Do not use {@html}. -->
              <pre style="margin:0; max-height:340px; overflow:auto; white-space:pre-wrap; word-break:break-word; font-family:ui-monospace,monospace; font-size:.78rem; line-height:1.5; color:#1c1714;">{gh.readme.content}</pre>
            </div>
          {/if}
        {/if}

        <!-- AI usage. Shown for projects only; pitches have no code yet. -->
        {#if kind === 'projects'}
          <div style="padding:12px 16px; border-bottom:2px dashed rgba(28,23,20,.28);">
            <div style="font-size:.68rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--orange); margin-bottom:6px;">
              🤖 AI usage
            </div>
            <!-- Airtable stores an unchecked box as ABSENT, so a new unticked row and
                 an old pre-tick row both arrive with ai_used null. We tell them apart by
                 the disclosure: pre-tick rows always carried a (then-required) one. -->
            {#if selected.ai_used}
              <div style="font-family:'Space Grotesk',sans-serif; font-size:.82rem; font-weight:700; color:#2f6db0; margin-bottom:4px;">✓ Used AI</div>
              {#if selected.ai_disclosure}
                <p style="margin:0; font-family:'Space Grotesk',sans-serif; font-size:.85rem; line-height:1.6; color:#5b4f44; white-space:pre-wrap;">{selected.ai_disclosure}</p>
              {:else}
                <p style="margin:0; font-family:'Space Grotesk',sans-serif; font-size:.82rem; color:#b3261e; font-weight:700;">⚠ Ticked AI but gave no description.</p>
              {/if}
            {:else if selected.ai_disclosure}
              <!-- No tick but a disclosure exists → a pre-tick row. Show what they wrote. -->
              <div style="font-family:'Space Grotesk',sans-serif; font-size:.72rem; color:#b07410; margin-bottom:4px;">predates the tick</div>
              <p style="margin:0; font-family:'Space Grotesk',sans-serif; font-size:.85rem; line-height:1.6; color:#5b4f44; white-space:pre-wrap;">{selected.ai_disclosure}</p>
            {:else}
              <div style="font-family:'Space Grotesk',sans-serif; font-size:.82rem; color:#5b4f44;">No AI declared.</div>
            {/if}
          </div>
        {/if}

        <!-- lineage: the other half of this idea's life -->
        <div style="padding:12px 16px; border-bottom:2px dashed rgba(28,23,20,.28); background:rgba(47,109,176,.05);">
          <div style="font-size:.68rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:#2f6db0; margin-bottom:7px;">
            {kind === 'pitches' ? '🚀 Built as' : '💡 Pitched as'}
          </div>

          {#if loadingLink}
            <div style="font-family:'Space Grotesk',sans-serif; font-size:.8rem; color:#5b4f44;">Looking…</div>
          {:else if linked}
            <div style="font-family:'Space Grotesk',sans-serif;">
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:5px;">
                <span style="font-weight:800; font-size:.9rem;">{linked.title ?? 'Untitled'}</span>
                <span style="padding:1px 8px; border-radius:999px; font-size:.68rem; font-weight:700; {STATUS_STYLE[linked.status] ?? ''}">
                  {STATUS_LABEL[linked.status] ?? linked.status}
                </span>
                {#if linked.created_at}
                  <span style="font-size:.72rem; color:#5b4f44;">🕘 {fmtDate(linked.created_at)}</span>
                {/if}
              </div>

              {#if linked.description}
                <p style="margin:0 0 6px; font-size:.8rem; line-height:1.5; color:#5b4f44;">{linked.description}</p>
              {/if}
              {#if linked.why}
                <p style="margin:0 0 6px; font-size:.78rem; line-height:1.5; color:#5b4f44;"><strong>Why:</strong> {linked.why}</p>
              {/if}
              {#if linked.review_feedback}
                <p style="margin:0 0 6px; font-size:.78rem; line-height:1.5; color:#2f6db0;"><strong>Reviewer asked:</strong> {linked.review_feedback}</p>
              {/if}

              {#if linked.playable_url || linked.code_url}
                <div style="display:flex; gap:12px; font-size:.78rem; font-weight:700;">
                  {#if linked.playable_url}
                    <a href={linked.playable_url} target="_blank" rel="noopener" style="color:#c2451a; text-decoration:none;">demo ↗</a>
                  {/if}
                  {#if linked.code_url}
                    <a href={linked.code_url} target="_blank" rel="noopener" style="color:#c2451a; text-decoration:none;">code ↗</a>
                  {/if}
                </div>
              {/if}
            </div>
          {:else}
            <div style="font-family:'Space Grotesk',sans-serif; font-size:.8rem; color:#5b4f44;">
              {LINK_EMPTY[linkedReason] ?? 'Could not load the linked record.'}
            </div>
          {/if}
        </div>

        {#if selected.status === 'pending' || selected.status === 'changes_requested'}
          <div style="padding:14px 16px; border-bottom:2px dashed rgba(28,23,20,.28);">
            <div style="font-size:.68rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--orange); margin-bottom:8px;">
              ⚖ Decision
            </div>

            <div style="display:grid; gap:7px; margin-bottom:12px;">
              <label style="display:block; font-family:'Space Grotesk',sans-serif; font-size:.78rem; font-weight:700; color:#1c1714;">
                Decision type
                <select
                  bind:value={decisionAction}
                  style="width:100%; margin-top:6px; padding:9px 11px; border:2px solid #1c1714; border-radius:9px; font-family:'Space Grotesk',sans-serif; font-size:.84rem; background:#fbf4e6; color:#1c1714;"
                >
                  <option value="approve">Approve</option>
                  <option value="request_changes">Request changes</option>
                  <option value="reject">Reject</option>
                </select>
              </label>
              <div style="font-family:'Space Grotesk',sans-serif; font-size:.74rem; color:#5b4f44;">
                Approve accepts the submission, request changes asks for a reship, reject closes it.
              </div>
            </div>

            {#if decisionAction === 'request_changes'}
              <label style="display:block; font-family:'Space Grotesk',sans-serif; font-size:.78rem; font-weight:700; color:#1c1714; margin-bottom:10px;">
                Number of changes required
                <input
                  type="number"
                  min="1"
                  step="1"
                  bind:value={requestedChangesCount}
                  placeholder="e.g. 2"
                  style="width:130px; margin-top:6px; padding:8px 10px; border:2px solid #1c1714; border-radius:8px; font-family:'Space Grotesk',sans-serif; font-size:.84rem; background:#fbf4e6;"
                />
              </label>
            {/if}

            {#if kind === 'projects' && decisionAction === 'approve'}
              <div style="margin-bottom:12px; padding:12px 14px; border:2px dashed rgba(28,23,20,.28); border-radius:12px; background:rgba(255,179,71,.07);">
                <div style="font-size:.68rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:#b07410; margin-bottom:8px;">
                  💰 Payout {#if selected.paid_at}· already paid{/if}
                </div>

                <div class="tracked-hours" title="Total time tracked for the Hackatime project selected by the builder">
                  <div>
                    <span class="tracked-hours-label">Hackatime total</span>
                    <span class="tracked-hours-help">Tracked on this project</span>
                  </div>
                  <strong>{selected.hackatime_hours != null ? `${selected.hackatime_hours.toFixed(1)}h` : 'Not available'}</strong>
                </div>

                {#if selected.paid_at}
                  <div style="font-family:'Space Grotesk',sans-serif; font-size:.85rem; color:#5b4f44;">
                    Paid <strong style="color:#1c1714;">{selected.payout_tokens} Ω</strong>
                    — {selected.tier} tier × {selected.approved_hours}h. Approving again pays nothing.
                  </div>
                {:else}
                  <div style="display:flex; gap:7px; flex-wrap:wrap; margin-bottom:10px;">
                    {#each tiers as t (t.slug)}
                      <button
                        onclick={() => (tier = t.slug)}
                        title={t.blurb}
                        style="
                          cursor:pointer; padding:6px 12px; border:2px solid #1c1714;
                          border-radius:9px 12px 8px 11px/11px 8px 12px 9px;
                          font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.78rem;
                          background:{tier === t.slug ? t.bg : '#fbf4e6'};
                          color:{tier === t.slug ? t.color : '#5b4f44'};
                          box-shadow:{tier === t.slug ? '3px 3px 0 #1c1714' : '2px 2px 0 rgba(28,23,20,.18)'};
                        "
                      >{t.icon} {t.label} · {t.multiplier}×</button>
                    {/each}
                  </div>

                  <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                    <label style="font-family:'Space Grotesk',sans-serif; font-size:.8rem; font-weight:700;">
                      Approved hours
                      <input
                        type="number" min="0" max="500" step="0.5" bind:value={hours}
                        style="width:90px; margin-left:7px; padding:6px 9px; border:2px solid #1c1714; border-radius:8px; font-family:'Space Grotesk',sans-serif; font-size:.82rem; background:#fbf4e6;"
                      />
                    </label>

                    {#if selected.hackatime_hours != null && hours != null && hours !== selected.hackatime_hours}
                      <span class="hours-difference">{hours < selected.hackatime_hours ? '−' : '+'}{Math.abs(hours - selected.hackatime_hours).toFixed(1)}h adjustment</span>
                    {/if}

                    {#if preview !== null}
                      <span style="font-family:'Syne',sans-serif; font-weight:800; font-size:.95rem; color:#c2451a;">→ {preview} Ω</span>
                    {/if}
                  </div>

                  {#if hours !== null && hours > 0 && hours < 20}
                    <div style="margin-top:8px; font-size:.75rem; color:#b07410; font-weight:700;">
                      ⚠ Below the 20-hour minimum in the ground rules — approve only if you mean to.
                    </div>
                  {/if}
                {/if}
              </div>
            {/if}

            {#if kind === 'projects' && (selected.status === 'pending' || selected.status === 'changes_requested')}
              <div style="margin-bottom:10px; display:grid; gap:10px;">
                <label style="display:block; font-family:'Space Grotesk',sans-serif; font-size:.78rem; font-weight:700; color:#1c1714;">
                  User feedback
                  <div style="font-size:.72rem; font-weight:600; color:#5b4f44; margin-top:2px;">
                    Purpose: sent to the builder in review messages and DMs.
                  </div>
                  <textarea
                    bind:value={feedback}
                    placeholder="Shown to the builder and sent in the DM."
                    rows="3"
                    style="width:100%; box-sizing:border-box; margin-top:6px; padding:11px 13px; border:2.5px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; font-family:'Space Grotesk',sans-serif; font-size:.85rem; background:#fbf4e6; color:#1c1714; outline:none; box-shadow:3px 3px 0 #1c1714; resize:vertical;"
                  ></textarea>
                </label>

                {#if decisionAction === 'approve'}
                <label style="display:block; font-family:'Space Grotesk',sans-serif; font-size:.78rem; font-weight:700; color:#1c1714;">
                  Internal override justification
                  <div style="font-size:.72rem; font-weight:600; color:#5b4f44; margin-top:2px;">
                    Purpose: internal audit note for YSWS/hour overrides; not shown to the builder.
                  </div>
                  <textarea
                    bind:value={internalJustification}
                    placeholder="Why these hours were overridden. Stored with the YSWS submission only."
                    rows="3"
                    style="width:100%; box-sizing:border-box; margin-top:6px; padding:11px 13px; border:2.5px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; font-family:'Space Grotesk',sans-serif; font-size:.85rem; background:#fbf4e6; color:#1c1714; outline:none; box-shadow:3px 3px 0 #1c1714; resize:vertical;"
                  ></textarea>
                </label>
                {/if}
              </div>
            {:else}
              <label style="display:block; font-family:'Space Grotesk',sans-serif; font-size:.78rem; font-weight:700; color:#1c1714; margin-bottom:10px;">
                User feedback
              <div style="font-size:.72rem; font-weight:600; color:#5b4f44; margin-top:2px;">
                Purpose: sent to the submitter so they know what to change or why this was rejected.
              </div>
              <textarea
                bind:value={feedback}
                placeholder="What needs to change? This is sent to the builder verbatim."
                rows="3"
                style="width:100%; box-sizing:border-box; padding:11px 13px; border:2.5px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; font-family:'Space Grotesk',sans-serif; font-size:.85rem; background:#fbf4e6; color:#1c1714; outline:none; box-shadow:3px 3px 0 #1c1714; resize:vertical; margin-bottom:10px;"
              ></textarea>
              </label>
            {/if}

            <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
              <button
                onclick={() => act(decisionAction)}
                disabled={acting}
                style="background:{decisionAction === 'approve' ? '#3d7a40' : decisionAction === 'request_changes' ? '#2f6db0' : '#b3261e'}; color:#fff; border:2.5px solid #1c1714; border-radius:10px 7px 11px 6px/6px 11px 7px 10px; padding:9px 18px; font-family:'Syne',sans-serif; font-weight:800; font-size:.8rem; cursor:{acting ? 'wait' : 'pointer'}; box-shadow:3px 3px 0 #1c1714; opacity:{acting ? '.6' : '1'};"
              >
                {decisionAction === 'approve' ? 'Approve' : decisionAction === 'request_changes' ? 'Send changes request' : 'Reject'}
              </button>

              {#if actionErr}
                <span style="font-family:'Space Grotesk',sans-serif; font-size:.78rem; font-weight:700; color:#b3261e;">{actionErr}</span>
              {:else if actionMsg}
                <span style="font-family:'Space Grotesk',sans-serif; font-size:.78rem; font-weight:700; color:{actionMsg.includes('✓') ? '#3d7a40' : '#b3261e'};">{actionMsg}</span>
              {/if}
            </div>
          </div>
        {:else}
          <div style="padding:14px 16px; border-bottom:2px dashed rgba(28,23,20,.28); font-family:'Space Grotesk',sans-serif; font-size:.82rem; color:#5b4f44;">
            Decided: <strong>{STATUS_LABEL[selected.status] ?? selected.status}</strong>
          </div>
        {/if}

        {#if kind === 'projects' && catalog.length}
          <div style="padding:14px 16px; border-bottom:2px dashed rgba(28,23,20,.28);">
            <div style="font-size:.68rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--orange); margin-bottom:8px;">
              🏅 Badges — click to toggle, then save
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:8px;">
              {#each catalog as b (b.slug)}
                {@const on = awarded.has(b.slug)}
                <button
                  onclick={() => toggleBadge(b.slug)}
                  title={b.criteria}
                  style="
                    display:inline-flex; align-items:center; gap:6px; cursor:pointer;
                    padding:7px 12px; border:2px solid #1c1714;
                    border-radius:9px 6px 10px 5px/5px 10px 6px 9px;
                    font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.76rem;
                    background:{on ? b.bg : 'transparent'};
                    color:{on ? b.color : '#9c8a6e'};
                    box-shadow:{on ? '2px 2px 0 rgba(28,23,20,.2)' : 'none'};
                    opacity:{on ? '1' : '.55'};
                  "
                >{b.icon} {b.label}</button>
              {/each}
            </div>
            <div style="display:flex; align-items:center; gap:10px; margin-top:10px;">
              <button
                onclick={saveBadges}
                disabled={savingBadges}
                style="background:var(--orange); color:#fff; border:2.5px solid #1c1714; border-radius:10px 7px 11px 6px/6px 11px 7px 10px; padding:8px 16px; font-family:'Syne',sans-serif; font-weight:800; font-size:.78rem; cursor:{savingBadges ? 'wait' : 'pointer'}; box-shadow:3px 3px 0 #1c1714; opacity:{savingBadges ? '.6' : '1'};"
              >{savingBadges ? 'Saving…' : 'Save badges'}</button>
              {#if badgeMsg}
                <span style="font-family:'Space Grotesk',sans-serif; font-size:.78rem; font-weight:700; color:{badgeMsg === 'Saved ✓' ? '#3d7a40' : '#b3261e'};">{badgeMsg}</span>
              {/if}
            </div>
          </div>
        {/if}

        {#if kind === 'pitches' && selected.duplicate_check?.matches?.length}
          <div style="margin:14px 16px 0; padding:12px 14px; background:rgba(255,179,71,.16); border:2px solid #b07410; border-radius:11px 8px 12px 9px/9px 12px 8px 11px; font-family:'Space Grotesk',sans-serif;">
            <div style="font-weight:700; color:#b07410; font-size:.8rem; margin-bottom:6px;">
              🤖 Possible duplicate idea — reviewers only
            </div>
            {#each selected.duplicate_check.matches as m (m.id)}
              <div style="font-size:.8rem; color:#1c1714; line-height:1.5; margin-bottom:3px;">
                • <strong>{m.title}</strong> ({Math.round(m.score * 100)}% match) — {m.reason}
              </div>
            {/each}
            <div style="font-size:.7rem; color:#5b4f44; margin-top:6px;">
              Automated check. The builder never sees this — use your judgment.
            </div>
          </div>
        {/if}

        {#if kind === 'pitches' && (selected.description || selected.why)}
          <div style="padding:14px 16px; border-bottom:2px dashed rgba(28,23,20,.28); font-family:'Space Grotesk',sans-serif; display:flex; flex-direction:column; gap:10px;">
            {#if selected.description}
              <div>
                <div style="font-size:.68rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--orange);">What they're building</div>
                <div style="font-size:.85rem; color:#1c1714; white-space:pre-wrap; line-height:1.5; margin-top:3px;">{selected.description}</div>
              </div>
            {/if}
            {#if selected.why}
              <div>
                <div style="font-size:.68rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--orange);">How it helps people</div>
                <div style="font-size:.85rem; color:#1c1714; white-space:pre-wrap; line-height:1.5; margin-top:3px;">{selected.why}</div>
              </div>
            {/if}
          </div>
        {/if}

        {#if kind === 'pitches'}
          <div style="padding:16px; border-top:2px dashed rgba(28,23,20,.28); display:flex; flex-direction:column; gap:10px;">
            <div style="font-family:'Space Grotesk',sans-serif; font-size:.8rem; color:#5b4f44;">
              Pitch communication is private. This message will be sent directly to the submitter on Slack.
            </div>
            <textarea
              bind:value={draft}
              placeholder="Message the pitch submitter privately."
              rows="3"
              style="padding:11px 13px; border:2.5px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; font-family:'Space Grotesk',sans-serif; font-size:.88rem; background:#fbf4e6; color:#1c1714; outline:none; box-shadow:3px 3px 0 #1c1714; resize:vertical;"
            ></textarea>
            {#if err}
              <div style="font-family:'Space Grotesk',sans-serif; font-size:.8rem; color:#b3261e; font-weight:700;">{err}</div>
            {/if}
            <button
              onclick={send}
              disabled={sending || !draft.trim()}
              style="align-self:flex-start; background:var(--orange); color:#fff; border:2.5px solid #1c1714; border-radius:11px 8px 12px 9px/9px 12px 8px 11px; padding:10px 20px; font-family:'Syne',sans-serif; font-weight:800; font-size:.85rem; cursor:{sending || !draft.trim() ? 'not-allowed' : 'pointer'}; box-shadow:3px 3px 0 #1c1714; opacity:{sending || !draft.trim() ? '.55' : '1'};"
            >{sending ? 'Sending.' : 'Send private DM'}</button>
          </div>
        {:else if !selected.hasThread}
          <p style="padding:20px; color:#5b4f44; font-family:'Space Grotesk',sans-serif; font-size:.85rem;">
            No Slack thread for this submission — it predates the Slack integration, or the card failed to post.
          </p>
        {:else}
          <div style="padding:16px; max-height:44vh; overflow-y:auto; display:flex; flex-direction:column; gap:14px;">
            {#if loadingThread}
              <p style="color:#5b4f44; font-family:'Space Grotesk',sans-serif;">Loading thread…</p>
            {:else if !visibleMessages.length}
              <p style="color:#5b4f44; font-family:'Space Grotesk',sans-serif; font-size:.85rem;">No messages yet.</p>
            {:else}
              {#each visibleMessages as m (m.ts)}
                <div style="display:flex; align-items:flex-start; gap:8px; font-family:'Space Grotesk',sans-serif;">
                  {#if m.avatar_url}
                    <img
                      src={m.avatar_url}
                      alt={m.author}
                      style="width:22px; height:22px; border-radius:999px; border:1.5px solid #1c1714; object-fit:cover; flex:0 0 auto; margin-top:1px;"
                    />
                  {/if}
                  <div style="min-width:0;">
                    <div style="display:flex; align-items:baseline; gap:8px;">
                      <strong style="font-size:.82rem; color:#1c1714;">{m.author}</strong>
                      <small style="font-size:.68rem; color:#9c8a6e;">{fmtTs(m.ts)}</small>
                    </div>
                    <div style="font-size:.85rem; color:#1c1714; white-space:pre-wrap; line-height:1.5; margin-top:2px;">
                      {m.text}
                    </div>
                  </div>
                </div>
              {/each}
            {/if}
          </div>

          <div style="padding:14px 16px; border-top:2px dashed rgba(28,23,20,.28); display:flex; flex-direction:column; gap:10px;">
            <textarea
              bind:value={draft}
              placeholder="Message this project's thread…"
              rows="3"
              style="padding:11px 13px; border:2.5px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; font-family:'Space Grotesk',sans-serif; font-size:.88rem; background:#fbf4e6; color:#1c1714; outline:none; box-shadow:3px 3px 0 #1c1714; resize:vertical;"
            ></textarea>

            <label style="display:flex; align-items:center; gap:8px; font-family:'Space Grotesk',sans-serif; font-size:.78rem; color:#5b4f44; font-weight:700;">
              <input type="checkbox" bind:checked={dmSubmitter} />
              Also DM the submitter — they can't see the review channel
            </label>

            {#if err}
              <div style="font-family:'Space Grotesk',sans-serif; font-size:.8rem; color:#b3261e; font-weight:700;">{err}</div>
            {/if}

            <button
              onclick={send}
              disabled={sending || !draft.trim()}
              style="align-self:flex-start; background:var(--orange); color:#fff; border:2.5px solid #1c1714; border-radius:11px 8px 12px 9px/9px 12px 8px 11px; padding:10px 20px; font-family:'Syne',sans-serif; font-weight:800; font-size:.85rem; cursor:{sending || !draft.trim() ? 'not-allowed' : 'pointer'}; box-shadow:3px 3px 0 #1c1714; opacity:{sending || !draft.trim() ? '.55' : '1'};"
            >{sending ? 'Sending…' : 'Send to thread'}</button>
          </div>
        {/if}
      {/if}
    </main>
  </div>
{/if}

<style>
  .review-switcher {
    display: inline-flex;
    gap: 6px;
    margin-bottom: 14px;
    padding: 5px;
    border: 2px solid #1c1714;
    border-radius: 14px 10px 13px 11px;
    background: rgba(28, 23, 20, 0.06);
  }

  .review-switcher button { box-shadow: none !important; }

  .review-overview {
    display: flex;
    align-items: center;
    gap: 18px;
    min-height: 48px;
    margin-bottom: 18px;
    padding: 9px 12px;
    border: 2px solid rgba(28, 23, 20, 0.3);
    border-radius: 12px;
    background: rgba(251, 244, 230, 0.7);
    color: #5b4f44;
    font-size: 0.76rem;
  }

  .review-overview > div { display: flex; align-items: center; gap: 5px; }
  .review-overview strong { color: #1c1714; font-family: 'Syne', sans-serif; font-size: 1rem; }
  .overview-label { color: #9b3a18; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
  .overview-dot { width: 8px; height: 8px; border: 1px solid #1c1714; border-radius: 50%; }
  .pending-dot { background: #ffb347; }
  .changes-dot { background: #6c9fd3; }

  .refresh-queue {
    margin-left: auto;
    padding: 6px 10px;
    border: 0;
    background: transparent;
    color: #1c1714;
    cursor: pointer;
    font: 700 0.76rem 'Space Grotesk', sans-serif;
  }

  .refresh-queue:hover { color: #c2451a; }
  .refresh-queue:disabled { cursor: wait; opacity: 0.55; }
  .remote-search { display: flex; flex-wrap: wrap; gap: 8px; margin: -6px 0 16px; }

  .review-grid {
    display: grid;
    grid-template-columns: minmax(290px, 360px) minmax(0, 1fr);
    gap: 20px;
    align-items: start;
  }

  .queue-panel {
    position: sticky;
    top: 132px;
    overflow: hidden;
  }

  .queue-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 10px;
  }

  .queue-eyebrow {
    display: block;
    color: #c2451a;
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  .queue-title { margin-top: 2px; font-family: 'Syne', sans-serif; font-size: 1rem; font-weight: 800; }
  .queue-total { padding: 4px 9px; border: 1.5px solid #1c1714; border-radius: 999px; background: #fffaf0; font-size: 0.68rem; font-weight: 800; }
  .queue-tools { padding: 0 12px 12px; border-bottom: 2px dashed rgba(28, 23, 20, 0.25); }

  .queue-search {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 8px 10px;
    border: 2px solid #1c1714;
    border-radius: 9px 12px 8px 11px;
    background: #fffaf0;
  }

  .queue-search:focus-within { box-shadow: 3px 3px 0 rgba(47, 109, 176, 0.35); }
  .queue-search input { width: 100%; border: 0; outline: 0; background: transparent; color: #1c1714; font: 0.78rem 'Space Grotesk', sans-serif; }
  .queue-filters { display: flex; gap: 5px; margin-top: 8px; }

  .queue-filters button {
    flex: 1;
    padding: 5px 4px;
    border: 1.5px solid rgba(28, 23, 20, 0.5);
    border-radius: 6px;
    background: transparent;
    color: #5b4f44;
    cursor: pointer;
    font: 700 0.65rem 'Space Grotesk', sans-serif;
  }

  .queue-filters button.active { border-color: #1c1714; background: #1c1714; color: #fff; }
  .queue-list { max-height: calc(100vh - 330px); min-height: 220px; overflow-y: auto; scrollbar-color: rgba(28, 23, 20, 0.35) transparent; }

  .queue-item {
    position: relative;
    display: block;
    width: 100%;
    padding: 13px 14px 13px 44px;
    border: 0;
    border-bottom: 2px dashed rgba(28, 23, 20, 0.18);
    background: transparent;
    cursor: pointer;
    text-align: left;
    font-family: 'Space Grotesk', sans-serif;
    transition: background 0.12s ease, padding-left 0.12s ease;
  }

  .queue-item:hover { background: rgba(255, 69, 0, 0.06); }
  .queue-item.selected { padding-left: 48px; background: rgba(255, 69, 0, 0.13); box-shadow: inset 5px 0 0 #ff4500; }
  .queue-item:focus-visible { z-index: 1; outline: 3px solid #2f6db0; outline-offset: -3px; }
  .queue-index { position: absolute; top: 14px; left: 14px; color: #9c8a6e; font: 700 0.62rem 'Syne', sans-serif; }

  .queue-empty,
  .review-empty-state { display: flex; align-items: center; justify-content: center; flex-direction: column; text-align: center; }
  .queue-empty { min-height: 180px; padding: 24px; color: #5b4f44; }
  .queue-empty span { margin-top: 4px; font-size: 0.75rem; }
  .review-detail { min-width: 0; overflow: hidden; }
  .review-empty-state { min-height: 430px; padding: 48px; }
  .review-empty-state strong { font: 800 1.1rem 'Syne', sans-serif; }
  .review-empty-state p { max-width: 430px; margin: 8px 0 0; color: #5b4f44; font-size: 0.86rem; line-height: 1.55; }
  .empty-mark { display: grid; place-items: center; width: 58px; height: 58px; margin-bottom: 15px; border: 2px solid #1c1714; border-radius: 50%; background: rgba(255, 69, 0, 0.13); color: #c2451a; font: 800 1.6rem 'Syne', sans-serif; box-shadow: 4px 4px 0 rgba(28, 23, 20, 0.15); }

  .tracked-hours {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    margin-bottom: 12px;
    padding: 11px 13px;
    border: 2px solid #1c1714;
    border-radius: 10px 7px 11px 8px;
    background: #fffaf0;
    box-shadow: 3px 3px 0 rgba(28, 23, 20, 0.13);
  }

  .tracked-hours-label {
    display: block;
    color: #1c1714;
    font-size: 0.76rem;
    font-weight: 800;
  }

  .tracked-hours-help {
    display: block;
    margin-top: 1px;
    color: #7c6c5e;
    font-size: 0.67rem;
  }

  .tracked-hours strong {
    color: #c2451a;
    font-family: 'Syne', sans-serif;
    font-size: 1.35rem;
    line-height: 1;
    white-space: nowrap;
  }

  .hours-difference {
    padding: 3px 7px;
    border-radius: 999px;
    background: rgba(47, 109, 176, 0.12);
    color: #2f6db0;
    font-size: 0.7rem;
    font-weight: 800;
  }

  .review-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px;
    border-bottom: 2px dashed rgba(28, 23, 20, 0.28);
  }

  .review-heading { min-width: 0; }

  .selected-context {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 5px;
    color: #8a796b;
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .selected-context > span + span::before { margin-right: 7px; color: #c7b7a0; content: '•'; }
  .selected-status { padding: 2px 6px; border: 1px solid rgba(28, 23, 20, 0.35); border-radius: 999px; letter-spacing: 0.04em; }
  .selected-context > .selected-status::before { content: none; }

  .selected-project-title,
  .selected-project-link {
    display: block;
    overflow: hidden;
    color: #1c1714;
    font-family: 'Syne', sans-serif;
    font-size: 1rem;
    font-weight: 800;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .selected-project-link {
    text-decoration: underline;
    text-decoration-color: rgba(194, 69, 26, 0.45);
    text-underline-offset: 3px;
  }

  .selected-project-link:hover {
    color: #c2451a;
    text-decoration-color: currentColor;
  }

  .selected-project-link:focus-visible,
  .primary-project-actions a:focus-visible {
    border-radius: 4px;
    outline: 2px solid #2f6db0;
    outline-offset: 3px;
  }

  .review-meta {
    margin-top: 2px;
    color: #5b4f44;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 0.78rem;
  }

  .primary-project-actions {
    display: flex;
    flex: 0 0 auto;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  @media (max-width: 860px) {
    .review-grid { grid-template-columns: minmax(0, 1fr); }
    .queue-panel { position: static; }
    .queue-list { max-height: 360px; }
  }

  @media (max-width: 560px) {
    .review-overview { align-items: flex-start; flex-wrap: wrap; gap: 8px 14px; }
    .refresh-queue { margin-left: 0; }
    .review-switcher { display: flex; }
    .review-switcher button { flex: 1; }
    .review-header {
      align-items: stretch;
      flex-direction: column;
    }

    .primary-project-actions {
      justify-content: flex-start;
    }
  }
</style>
