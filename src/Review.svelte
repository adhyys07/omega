<script lang="ts">
  import { onMount } from 'svelte'

  type Sub = {
    id: string
    title: string | null
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
  let showFeedBack = $state(false)
  let feedback = $state('')
  let internalJustification = $state('')
  let actionMsg = $state('')
  let actionErr = $state('')
  let tiers = $state<TierDef[]>([])
  let tier = $state<string>('')
  let hours = $state<number | null>(null)
  
  type Msg = { ts: string; author: string; text: string; isBot: boolean; isParent: boolean }

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
      const r = await apiFetch(listUrl(kind))
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
    showFeedBack = false
    feedback = ''
    internalJustification = ''
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

    // Request-changes is two-click: reveal the box, then send. Feedback is
    // mandatory — the server rejects an empty one too.
    if (action === 'request_changes' && !showFeedBack) {
      showFeedBack = true
      return
    }
    if (action === 'request_changes' && !feedback.trim()) {
      actionErr = 'Please provide feedback for the submitter.'
      return
    }

    // Approving a project must carry a tier + hours, or the server rejects it.
    if (kind === 'projects' && action === 'approve') {
      if (!tier) { actionErr = 'Pick a tier before approving.'; return }
      if (hours == null || hours <= 0) { actionErr = 'Enter the approved hours.'; return }
      if (!internalJustification.trim()) { actionErr = 'Enter the override-hour justification.'; return }
    }

    acting = true
    try {
      const r = await apiFetch(actionUrl(kind, selected.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          feedback: feedback.trim(),
          user_feedback: feedback.trim(),
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
      showFeedBack = false
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
  const who = (s: Sub) => `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim() || '—'

  const card =
    'background:#fbf4e6; border:2.5px solid #1c1714; border-radius:16px 11px 15px 12px/12px 15px 11px 16px; box-shadow:5px 5px 0 rgba(28,23,20,.13);'
</script>

<div style="display:flex; gap:8px; margin-bottom:20px;">
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

{#if loading}
  <p style="color:#5b4f44;">Loading…</p>
{:else if listErr}
  <p style="color:#c2451a; font-weight:700;">{listErr}</p>
{:else if !subs.length}
  <p style="color:#5b4f44;">No {kind} yet.</p>
{:else}
  <div class="review-grid">
    <!-- queue -->
    <div style={card}>
      <div style="padding:14px 16px; border-bottom:2px dashed rgba(28,23,20,.28); font-family:'Syne',sans-serif; font-weight:800; font-size:.95rem;">
        Queue <span style="color:#5b4f44; font-weight:600; font-size:.8rem;">({subs.length})</span>
      </div>
      <div style="max-height:60vh; overflow-y:auto;">
        {#each subs as s (s.id)}
          <button
            onclick={() => open(s)}
            style="
              display:block; width:100%; text-align:left; cursor:pointer;
              padding:12px 16px; border:none; border-bottom:2px dashed rgba(28,23,20,.18);
              font-family:'Space Grotesk',sans-serif;
              background:{selected?.id === s.id ? 'rgba(255,69,0,.12)' : 'transparent'};
            "
          >
            <div style="font-weight:700; color:#1c1714; font-size:.88rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
              {s.title ?? 'Untitled'}
            </div>
            <div style="display:flex; align-items:center; gap:6px; margin-top:4px; flex-wrap:wrap;">
              <span style="display:inline-block; padding:2px 8px; border:1.5px solid #1c1714; border-radius:6px; font-size:.62rem; font-weight:700; text-transform:uppercase; letter-spacing:.06em; {STATUS_STYLE[s.status] ?? STATUS_STYLE.pending}">
                {STATUS_LABEL[s.status] ?? s.status}
              </span>
              <span style="font-size:.72rem; color:#5b4f44;">{who(s)}</span>
              {#if s.created_at}
                <span title={fmtDate(s.created_at)} style="font-size:.72rem; color:#5b4f44;">· {fmtDay(s.created_at)}</span>
              {/if}
              {#if s.duplicate_check?.matches?.length}
                <span title="Possible duplicate idea — open to see the matches" style="font-size:.72rem; color:#b07410; font-weight:700;">🤖 dupe?</span>
              {/if}
              {#if !s.hasThread}
                <span title="No Slack thread — predates the integration, or the card failed to post" style="font-size:.72rem; color:#b07410;">⚠ no thread</span>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    </div>

    <!-- thread -->
    <div style={card}>
      {#if !selected}
        <p style="padding:20px; color:#5b4f44; font-family:'Space Grotesk',sans-serif;">Pick a submission to see its Slack thread.</p>
      {:else}
        <div style="padding:14px 16px; border-bottom:2px dashed rgba(28,23,20,.28);">
          <div style="font-family:'Syne',sans-serif; font-weight:800; font-size:1rem;">{selected.title ?? 'Untitled'}</div>
          <div style="font-family:'Space Grotesk',sans-serif; font-size:.78rem; color:#5b4f44; margin-top:2px;">
            {who(selected)}
            {#if selected.created_at} · <span title="Submitted">🕘 {fmtDate(selected.created_at)}</span>{/if}
            {#if selected.hackatime_hours} · {selected.hackatime_hours}h{/if}
          </div>
        </div>

        <!-- everything a reviewer needs to open, one click away -->
        {#if kind === 'projects'}
          <div style="padding:12px 16px; border-bottom:2px dashed rgba(28,23,20,.28); display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
            {#if selected.code_url}
              <a href={selected.code_url} target="_blank" rel="noopener" style={btn}>⌥ Repo</a>
            {/if}
            {#if selected.playable_url}
              <a href={selected.playable_url} target="_blank" rel="noopener" style={btn}>▶ Demo</a>
            {/if}
            {#if selected.demo_video_url}
              <a href={selected.demo_video_url} target="_blank" rel="noopener" style={btn}>🎬 Video</a>
            {/if}

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

            {#if kind === 'projects'}
              <div style="margin-bottom:12px; padding:12px 14px; border:2px dashed rgba(28,23,20,.28); border-radius:12px; background:rgba(255,179,71,.07);">
                <div style="font-size:.68rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:#b07410; margin-bottom:8px;">
                  💰 Payout {#if selected.paid_at}· already paid{/if}
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

                    {#if selected.hackatime_hours}
                      <span style="font-size:.75rem; color:#5b4f44;">claimed: {selected.hackatime_hours}h</span>
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
                  <textarea
                    bind:value={feedback}
                    placeholder="Shown to the builder and sent in the DM."
                    rows="3"
                    style="width:100%; box-sizing:border-box; margin-top:6px; padding:11px 13px; border:2.5px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; font-family:'Space Grotesk',sans-serif; font-size:.85rem; background:#fbf4e6; color:#1c1714; outline:none; box-shadow:3px 3px 0 #1c1714; resize:vertical;"
                  ></textarea>
                </label>

                <label style="display:block; font-family:'Space Grotesk',sans-serif; font-size:.78rem; font-weight:700; color:#1c1714;">
                  Internal override justification
                  <textarea
                    bind:value={internalJustification}
                    placeholder="Why these hours were overridden. Stored with the YSWS submission only."
                    rows="3"
                    style="width:100%; box-sizing:border-box; margin-top:6px; padding:11px 13px; border:2.5px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; font-family:'Space Grotesk',sans-serif; font-size:.85rem; background:#fbf4e6; color:#1c1714; outline:none; box-shadow:3px 3px 0 #1c1714; resize:vertical;"
                  ></textarea>
                </label>
              </div>
            {:else if showFeedBack}
              <label style="display:block; font-family:'Space Grotesk',sans-serif; font-size:.78rem; font-weight:700; color:#1c1714; margin-bottom:10px;">
                User feedback
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
                onclick={() => act('approve')}
                disabled={acting}
                style="background:#3d7a40; color:#fff; border:2.5px solid #1c1714; border-radius:10px 7px 11px 6px/6px 11px 7px 10px; padding:9px 18px; font-family:'Syne',sans-serif; font-weight:800; font-size:.8rem; cursor:{acting ? 'wait' : 'pointer'}; box-shadow:3px 3px 0 #1c1714; opacity:{acting ? '.6' : '1'};"
              >Approve</button>

              <button
                onclick={() => act('request_changes')}
                disabled={acting}
                style="background:#2f6db0; color:#fff; border:2.5px solid #1c1714; border-radius:7px 10px 6px 11px/11px 6px 10px 7px; padding:9px 18px; font-family:'Syne',sans-serif; font-weight:800; font-size:.8rem; cursor:{acting ? 'wait' : 'pointer'}; box-shadow:3px 3px 0 #1c1714; opacity:{acting ? '.6' : '1'};"
              >{showFeedBack ? 'Send changes' : 'Request changes'}</button>

              <button
                onclick={() => act('reject')}
                disabled={acting}
                style="background:#b3261e; color:#fff; border:2.5px solid #1c1714; border-radius:10px 7px 11px 6px/6px 11px 7px 10px; padding:9px 18px; font-family:'Syne',sans-serif; font-weight:800; font-size:.8rem; cursor:{acting ? 'wait' : 'pointer'}; box-shadow:3px 3px 0 #1c1714; opacity:{acting ? '.6' : '1'};"
              > Reject</button>

              {#if showFeedBack}
                <button
                  onclick={() => { showFeedBack = false; feedback = ''; actionMsg = ''; actionErr = '' }}
                  style="background:transparent; color:#5b4f44; border:2px solid #1c1714; border-radius:8px; padding:9px 14px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.78rem; cursor:pointer;"
                >Cancel</button>
              {/if}

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

        {#if !selected.hasThread}
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
                <div style="font-family:'Space Grotesk',sans-serif;">
                  <div style="display:flex; align-items:baseline; gap:8px;">
                    <strong style="font-size:.82rem; color:#1c1714;">{m.author}</strong>
                    <small style="font-size:.68rem; color:#9c8a6e;">{fmtTs(m.ts)}</small>
                  </div>
                  <div style="font-size:.85rem; color:#1c1714; white-space:pre-wrap; line-height:1.5; margin-top:2px;">
                    {m.text}
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
    </div>
  </div>
{/if}

<style>
  .review-grid {
    display: grid;
    grid-template-columns: minmax(0, 340px) minmax(0, 1fr);
    gap: 20px;
    align-items: start;
  }

  @media (max-width: 860px) {
    .review-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
