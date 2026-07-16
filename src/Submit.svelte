<script lang="ts">
  import { onMount } from 'svelte'

  // Only project-specific fields are collected here — name/email are taken from
  // the signed-in user's profile server-side, and address/birthday are gathered
  // later at the prizes step. No personal info is entered on this form.
  let f = $state({
     pitch_id: '',
     title: '', code_url: '', playable_url: '', description: '', screenshot_url: '',
     demo_video_url: '',
     ai_disclosure: '',
     hackatime_project: '', hackatime_hours: null as number | null,
     hackatime_start_date: null as string | null,

   })

  // You pitch before you build: only an approved pitch unlocks this form.
  type EligiblePitch = { id: string; title: string | null }
  let eligiblePitches = $state<EligiblePitch[]>([])
  let pitchesLoaded = $state(false)

  type UploadField = 'screenshot_url' | 'demo_video_url'

  const MAX_BYTES: Record<UploadField, number> = {
    screenshot_url: 8 * 1024 * 1024,
    demo_video_url: 64 * 1024 * 1024,
  }

  const ACCEPT: Record<UploadField, string> = {
    screenshot_url: 'image/png,image/jpeg,image/gif,image/webp',
    demo_video_url: 'video/mp4,video/webm,video/quicktime',
  }

  type Submission = {
    id: string
    title: string | null
    status: string
    code_url: string | null
    playable_url: string | null
    description: string | null
    screenshot_url: string | null
    demo_video_url: string | null
    ai_disclosure: string | null
    hackatime_project: string | null
    hackatime_start_date: string | null
    review_feedback: string | null
    badges: string[]
    created_at: string
  }

  // Presentation only — the server whitelists which slugs can ever be awarded.
  const BADGE_META: Record<string, { icon: string; label: string; bg: string; color: string }> = {
    android_builder:    { icon: '▲', label: 'Android Builder',    bg: 'rgba(74,150,80,.16)',  color: '#3d7a40' },
    ios_shipper:        { icon: '◉', label: 'iOS Shipper',        bg: 'rgba(255,107,53,.16)', color: '#c2451a' },
    gemini_integration: { icon: '✦', label: 'Gemini Integration', bg: 'rgba(47,109,176,.16)', color: '#2f6db0' },
    cider_crossover:    { icon: '▣', label: 'Cider Crossover',    bg: 'rgba(255,179,71,.2)',  color: '#b07410' },
    dual_platform:      { icon: '◆', label: 'Dual Platform',      bg: 'rgba(255,107,53,.16)', color: '#c2451a' },
    elite_tier:         { icon: '⚡', label: 'Elite Tier',         bg: 'rgba(255,179,71,.2)',  color: '#b07410' },
  }

  let projects = $state<HtProject[]>([])
  let projectsLoaded = $state(false)
  let htLinked = $state(true)
  let user = $state<null | { name?: string }>(null)
  let authReady = $state(false)
  let submitting = $state(false)
  let submissions = $state<Submission[]>([])
  let submissionsLoaded = $state(false)
  let done = $state(false)
  let uploading = $state<UploadField | null>(null)
  let compressing = $state(false)
  let compressProgress = $state(0)
  let uploadError = $state('')
  let error = $state('')
  let ghCheck = $state<null | {
    host: 'github' | 'other'
    isPublic: boolean
    exists: boolean
    readme: { found: boolean; chars: number; tooSmall: boolean } | null
    error?: string
  } >(null)
  let ghChecking = $state(false)
  let ghSeq = 0
  // Reship mode: /submit?edit=recXXX prefills the form and PATCHes instead of POSTing.
  let editId = $state<string | null>(null)
  let reviewFeedback = $state<string | null>(null)

  const busy = $derived(!!uploading || compressing)

  type HtProject = { name?: string; total_seconds?: number; first_heartbeat?: string | null }

  onMount(async () => {
    editId = new URLSearchParams(location.search).get('edit')
    try {
      const r = await fetch('/api/auth/me')
      if (r.ok) { user = await r.json(); await Promise.all([loadProjects(), loadSubmissions(), loadEligiblePitches()]) }
    } catch {
      // not signed in / backend down
    } finally {
      authReady = true
    }
    if (editId) prefillForEdit(editId)
  })

  function prefillForEdit(id: string) {
    const s = submissions.find((x) => x.id === id)
    if (!s) { editId = null; return }  // not theirs, or not loaded — fall back to a fresh submission
    if (s.status !== 'changes_requested') { editId = null; return }
    reviewFeedback = s.review_feedback
    f.title = s.title ?? ''
    f.code_url = s.code_url ?? ''
    f.playable_url = s.playable_url ?? ''
    f.description = s.description ?? ''
    f.screenshot_url = s.screenshot_url ?? ''
    f.demo_video_url = s.demo_video_url ?? ''
    f.ai_disclosure = s.ai_disclosure ?? ''
    f.hackatime_project = s.hackatime_project ?? ''
    f.hackatime_start_date = s.hackatime_start_date ?? null
  }

  async function submit(e: Event) {
    e.preventDefault()
    submitting = true
    error = ''
    try {
      const r = await fetch(editId ? `/api/submissions/${editId}` : '/api/submissions', {
        method: editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Submission failed')
      done = true
      loadSubmissions()
    } catch (err) {
      error = err instanceof Error ? err.message : 'Something went wrong'
    } finally {
      submitting = false
    }
  }

  async function loadSubmissions(){
    try {
      const r = await fetch('/api/submissions/mine')
      if (!r.ok) throw new Error()
      submissions = await r.json()
    } catch {
      // ignore
    } finally {
      submissionsLoaded = true
    }
  }

  async function loadEligiblePitches(){
    try {
      const r = await fetch('/api/submissions/eligible-pitches')
      if (!r.ok) throw new Error()
      eligiblePitches = await r.json()
      // One approved pitch? Pick it — no reason to make them choose from a list of one.
      if (eligiblePitches.length === 1) f.pitch_id = eligiblePitches[0].id
    } catch {
      // ignore — the locked state below covers it
    } finally {
      pitchesLoaded = true
    }
  }

  async function checkRepo(){
    const url = f.code_url.trim()
    ghCheck = null
    if (!url) return
    const seq = ++ghSeq
    ghChecking = true
    try {
      const r = await fetch(`/api/github/check?url=${encodeURIComponent(url)}`)
      const data = await r.json()
      if (seq === ghSeq) ghCheck = data
    } catch {
    } finally {
      if (seq === ghSeq) ghChecking = false
    }
  }

  const STATUS_STYLE: Record<string, string> = {
  approved: 'background:rgba(74,150,80,.16); color:#3d7a40;',
  rejected: 'background:rgba(179,38,30,.14); color:#b3261e;',
  pending:  'background:rgba(255,179,71,.22); color:#b07410;',
  changes_requested: 'background:rgba(47,109,176,.14); color:#2f6db0;',
}

  const STATUS_LABEL: Record<string, string> = {
    changes_requested: 'changes requested',
  }

  const fmtDate = (iso: string) => 
    iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'


  async function uploadMedia(e: Event, field: UploadField){
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    uploadError = ''
    const limit = MAX_BYTES[field]

    let payload = file
    if (field === 'demo_video_url' && file.type.startsWith('video/')) {
      compressing = true
      compressProgress = 0
      try {
        // Loaded on demand — the codec library is large and most visitors never upload a video.
        const { compressVideo } = await import('./lib/compressVideo')
        payload = await compressVideo(file, { onProgress: (p) => (compressProgress = p) })
      } catch (err) {
        // Best-effort: fall back to the original and let the size check below decide.
        console.warn('Video compression failed, using original', err)
      } finally {
        compressing = false
      }
    }

    if (payload.size > limit) {
      const mb = Math.round(limit / 1024 / 1024)
      uploadError = payload === file
        ? `File is too large (max ${mb}MB)`
        : `Still ${(payload.size / 1024 / 1024).toFixed(0)}MB after compression (max ${mb}MB) — try a shorter clip`
      input.value = ''
      return
    }

    uploading = field
    try {
      const r = await fetch(`/api/uploads/media?name=${encodeURIComponent(payload.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': payload.type },
      body: payload,
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(data.error ?? 'Upload failed')
    f[field] = data.url
    } catch (err) {
      uploadError = err instanceof Error ? err.message : 'Something went wrong'
    } finally {
      uploading = null
      input.value = ''
    }
  }

  async function loadProjects(){
    try{
      const r = await fetch('/api/hackatime/projects')
      if (r.status === 404) {
        htLinked = false
        return
      }
      if (!r.ok) throw new Error()
      const data = await r.json()
      projects = Array.isArray(data) ? data : (data.data ?? data.projects ?? [])
    } catch {

    } finally {
      projectsLoaded = true
    }
  }
  function onProjectChange() {
    const p = projects.find((x) => x.name === f.hackatime_project)
    f.hackatime_hours = p?.total_seconds ? Math.round((p.total_seconds / 3600) * 10) / 10 : null
    f.hackatime_start_date = p?.first_heartbeat ? p.first_heartbeat.slice(0, 10) : null
  }

  function formatStartDate(iso: string) {
    return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    })
  }

  const inputStyle =
    'padding:13px 15px; border:2.5px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; font-family:\'Space Grotesk\',sans-serif; font-size:.92rem; background:#fbf4e6; color:#1c1714; outline:none; box-shadow:4px 4px 0 #1c1714;'
</script>

<div class="submit-page">
  <a href="/" class="back" aria-label="Back home">← Back</a>

  {#if !authReady}
    <div style="font-family:'Space Grotesk',sans-serif; color:#5b4f44;">Loading…</div>

  {:else if !user}
    <div style="text-align:center; font-family:'Space Grotesk',sans-serif;">
      <h1 style="font-family:'Syne',sans-serif; font-weight:800; color:#1c1714;">Sign in to submit</h1>
      <p style="color:#5b4f44; margin:10px 0 22px;">You need to sign in with Hack Club before submitting a project.</p>
      <a
        href="/api/auth/login"
        style="display:inline-flex; background:var(--orange); color:#fff; border:2.5px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; padding:13px 26px; font-weight:800; text-decoration:none; box-shadow:4px 4px 0 #1c1714;"
      >Sign in with Hack Club</a>
    </div>

  {:else if done}
    <div style="text-align:center; max-width:520px; font-family:'Space Grotesk',sans-serif;">
      <div style="font-family:'Syne',sans-serif; font-weight:800; font-size:1.6rem; color:#1c1714; margin-bottom:8px;">{editId ? '♻️ Reshipped!' : '🎉 Submission received!'}</div>
      <p style="color:#5b4f44;">Our reviewers will take it from here — you'll hear back once it's been looked at.</p>
      <a href="/" style="display:inline-block; margin-top:22px; color:#c2451a; font-weight:700; text-decoration:none;">← Back home</a>
    </div>

  {:else if !editId && pitchesLoaded && !eligiblePitches.length}
    <!-- Step 01 gates step 03: no approved pitch, no project submission. -->
    <div style="text-align:center; max-width:520px; font-family:'Space Grotesk',sans-serif;">
      <div style="font-family:'Syne',sans-serif; font-weight:800; font-size:1.6rem; color:#1c1714; margin-bottom:8px;">💡 Pitch your idea first</div>
      <p style="color:#5b4f44; line-height:1.6;">
        Projects need an <strong>approved pitch</strong> before you can submit them — that's how we make sure you don't sink 20+ hours into something we can't accept.
      </p>
      <a
        href="/pitch"
        style="display:inline-flex; margin-top:22px; background:var(--orange); color:#fff; border:2.5px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; padding:13px 26px; font-weight:800; text-decoration:none; box-shadow:4px 4px 0 #1c1714;"
      >Pitch an idea →</a>
      <div style="margin-top:14px;">
        <a href="/" style="color:#c2451a; font-weight:700; text-decoration:none; font-size:.85rem;">← Back home</a>
      </div>
    </div>

  {:else}
    <div class="submit-grid">
      <div class="pane pane-form">
    <form
      onsubmit={submit}
      style="width:100%; display:flex; flex-direction:column; gap:12px; background:#fbf4e6; border:3px solid #1c1714; border-radius:18px 12px 16px 13px/13px 16px 12px 18px; box-shadow:7px 7px 0 #1c1714; padding:30px;"
    >
      <h1 style="font-family:'Syne',sans-serif; font-weight:800; font-size:1.6rem; color:#1c1714; margin:0;">{editId ? 'Reship your project' : 'Submit your project'}</h1>
      <p style="font-family:'Space Grotesk',sans-serif; font-size:.8rem; color:#5b4f44; margin:0 0 2px;">
        Submitting as <strong>{user.name ?? 'you'}</strong>. We'll pull your details from your account.
      </p>

      {#if !editId && eligiblePitches.length > 1}
        <select bind:value={f.pitch_id} required style={inputStyle}>
          <option value="" disabled selected>Which approved pitch is this?</option>
          {#each eligiblePitches as p}
            <option value={p.id}>{p.title ?? 'Untitled pitch'}</option>
          {/each}
        </select>
      {:else if !editId && eligiblePitches.length === 1}
        <div style="font-family:'Space Grotesk',sans-serif; font-size:.8rem; color:#3d7a40; font-weight:700;">
          ✓ Building on your approved pitch: <strong>{eligiblePitches[0].title ?? 'Untitled'}</strong>
        </div>
      {/if}

      {#if editId && reviewFeedback}
        <div style="background:rgba(47,109,176,.1); border:2px solid #2f6db0; border-radius:11px 8px 12px 9px/9px 12px 8px 11px; padding:12px 14px; font-family:'Space Grotesk',sans-serif; font-size:.82rem; color:#1c1714;">
          <div style="font-weight:700; color:#2f6db0; margin-bottom:4px;">✏️ Changes requested by the reviewer</div>
          <div style="white-space:pre-wrap; line-height:1.5;">{reviewFeedback}</div>
        </div>
      {/if}

      <div class="form-split">
        <div class="form-col">
          <input bind:value={f.title} placeholder="Project title" required style={inputStyle} />

          {#if !htLinked}
            <a
              href="/api/hackatime/login"
              style="display:inline-flex; align-items:center; gap:6px; background:#fbf4e6; color:#1c1714; border:2.5px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; padding:13px 15px; font-weight:700; text-decoration:none; box-shadow:4px 4px 0 #1c1714;"
            >⏱ Connect Hackatime to pick a project</a>
          {:else if projectsLoaded && projects.length}
            <select bind:value={f.hackatime_project} onchange={onProjectChange} required style={inputStyle}>
              <option value="" disabled selected>Select your Hackatime project</option>
              {#each projects as p}
                <option value={p.name}>
                  {p.name}{p.total_seconds ? ` — ${Math.round(p.total_seconds / 3600 * 10) / 10}h` : ''}
                </option>
              {/each}
            </select>
            {#if f.hackatime_start_date}
              <div style="font-family:'Space Grotesk',sans-serif; font-size:.8rem; color:#5b4f44; margin-top:-4px;">
                ⏳ Started on <strong>{formatStartDate(f.hackatime_start_date)}</strong>
              </div>
            {/if}
          {:else if projectsLoaded}
            <div style="font-family:'Space Grotesk',sans-serif; font-size:.8rem; color:#5b4f44;">
              No Hackatime projects found — you can still submit without selecting one.
            </div>
          {/if}

          <div class="field">
            <input bind:value={f.screenshot_url} type="url" placeholder="Screenshot URL" style={inputStyle} />
            <label style="font-family:'Space Grotesk',sans-serif; font-size:.75rem; font-weight:700; color:#5b4f44; cursor:{busy ? 'wait' : 'pointer'};">
              {uploading === 'screenshot_url' ? 'Uploading screenshot…' : '⬆ or upload a screenshot'}
              <input type="file" accept={ACCEPT.screenshot_url} disabled={busy} onchange={(e) => uploadMedia(e, 'screenshot_url')} style="display:none;" />
            </label>
          </div>

          <div class="field">
            <input bind:value={f.demo_video_url} type="url" placeholder="Demo video URL (optional)" style={inputStyle} />
            <label style="font-family:'Space Grotesk',sans-serif; font-size:.75rem; font-weight:700; color:#5b4f44; cursor:{busy ? 'wait' : 'pointer'};">
              {#if compressing}
                Compressing video… {Math.round(compressProgress * 100)}%
              {:else if uploading === 'demo_video_url'}
                Uploading video…
              {:else}
                ⬆ or upload a video (max 64MB)
              {/if}
              <input type="file" accept={ACCEPT.demo_video_url} disabled={busy} onchange={(e) => uploadMedia(e, 'demo_video_url')} style="display:none;" />
            </label>
          </div>
        </div>

        <div class="form-col">
          <div class="url-row">
            <div class="field url-code">
              <input bind:value={f.code_url} onblur={checkRepo} type="url" placeholder="Code URL (repository)" required style={inputStyle} />
            </div>

            <div class="field url-demo">
              <input bind:value={f.playable_url} type="url" placeholder="Playable / demo URL" required style={inputStyle} />
            </div>
          </div>

          {#if ghChecking}
            <div style="font-family:'Space Grotesk',sans-serif; font-size:.75rem; color:#5b4f44; margin-top:-6px;">Checking repo…</div>
          {:else if ghCheck}
            {#if ghCheck.host === 'other'}
              <div style="font-family:'Space Grotesk',sans-serif; font-size:.75rem; color:#5b4f44; margin-top:-6px;">Not a GitHub URL — reviewers will open it manually.</div>
            {:else if ghCheck.error}
              <div style="font-family:'Space Grotesk',sans-serif; font-size:.75rem; color:#b07410; margin-top:-6px;">⚠️ Couldn't verify: {ghCheck.error}</div>
            {:else if !ghCheck.isPublic}
              <div style="font-family:'Space Grotesk',sans-serif; font-size:.75rem; color:#b3261e; font-weight:700; margin-top:-6px;">❌ This repo isn't public — reviewers won't be able to open it.</div>
            {:else if ghCheck.readme && !ghCheck.readme.found}
              <div style="font-family:'Space Grotesk',sans-serif; font-size:.75rem; color:#b07410; margin-top:-6px;">⚠️ Public, but no README found. Reviewers rely on it.</div>
            {:else if ghCheck.readme && ghCheck.readme.tooSmall}
              <div style="font-family:'Space Grotesk',sans-serif; font-size:.75rem; color:#b07410; margin-top:-6px;">⚠️ Public ✓ — but the README looks thin ({ghCheck.readme.chars} chars). Consider expanding it.</div>
            {:else}
              <div style="font-family:'Space Grotesk',sans-serif; font-size:.75rem; color:#3d7a40; font-weight:700; margin-top:-6px;">✓ Public repo with a README.</div>
            {/if}
          {/if}

          <textarea bind:value={f.description} placeholder="Describe what you built" rows="3" required class="description" style={inputStyle}></textarea>

          <div class="ai-block">
            <label for="ai_disclosure" style="display:block; font-family:'Space Grotesk',sans-serif; font-size:.82rem; font-weight:700; color:#1c1714; margin-bottom:4px;">
              🤖 AI use <span style="color:var(--orange);">*</span>
            </label>
            <textarea
              id="ai_disclosure"
              bind:value={f.ai_disclosure}
              rows="2"
              required
              placeholder={'e.g. "Used Claude for debugging and boilerplate. Wrote the actual app logic myself."\n\nDidn\'t use any? Just write "None".'}
              style={inputStyle}
            ></textarea>
            <div class="ai-help" style="font-family:'Space Grotesk',sans-serif; font-size:.75rem; color:#5b4f44;">
              Keep it short and specific.
            </div>
          </div>
        </div>
      </div>

      {#if uploadError}
        <div style="font-family:'Space Grotesk',sans-serif; font-size:.85rem; color:#b3261e; font-weight:700;">{uploadError}</div>
      {/if}

      {#if error}
        <div style="font-family:'Space Grotesk',sans-serif; font-size:.85rem; color:#b3261e; font-weight:700;">{error}</div>
      {/if}

      <button
        type="submit"
        disabled={submitting || busy}
        style="background:var(--orange); color:#fff; border:2.5px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; padding:14px; font-family:'Syne',sans-serif; font-weight:800; font-size:1rem; cursor:pointer; box-shadow:4px 4px 0 #1c1714; opacity:{submitting || busy ? '.6' : '1'};"
      >{submitting ? (editId ? 'Reshipping…' : 'Submitting…') : (editId ? 'Reship project' : 'Submit project')}</button>
    </form>
      </div>

      <aside class="pane">
        <div style="background:#fbf4e6; border:3px solid #1c1714; border-radius:18px 12px 16px 13px/13px 16px 12px 18px; box-shadow:7px 7px 0 #1c1714; padding:24px;">
          <h2 style="font-family:'Syne',sans-serif; font-weight:800; font-size:1.15rem; color:#1c1714; margin:0 0 4px;">Your projects</h2>
          <p style="font-family:'Space Grotesk',sans-serif; font-size:.78rem; color:#5b4f44; margin:0 0 14px;">
            {submissions.length} of 3 submitted
          </p>

          {#if !submissionsLoaded}
            <div style="font-family:'Space Grotesk',sans-serif; font-size:.82rem; color:#5b4f44;">Loading…</div>
          {:else if !submissions.length}
            <div style="font-family:'Space Grotesk',sans-serif; font-size:.82rem; color:#5b4f44; border-top:2px dashed rgba(28,23,20,.28); padding-top:14px;">
              Nothing submitted yet — your first project will show up here.
            </div>
          {:else}
            <div style="overflow-x:auto;">
              <table style="width:100%; border-collapse:collapse; font-family:'Space Grotesk',sans-serif; font-size:.82rem;">
                <thead>
                  <tr style="text-align:left; color:#5b4f44; font-size:.68rem; letter-spacing:.12em; text-transform:uppercase;">
                    <th style="padding:0 10px 8px 0; font-weight:700;">Project</th>
                    <th style="padding:0 10px 8px 0; font-weight:700;">Status</th>
                    <th style="padding:0 0 8px; font-weight:700;">Sent</th>
                  </tr>
                </thead>
                <tbody>
                  {#each submissions as s (s.id)}
                    <tr style="border-top:2px dashed rgba(28,23,20,.28);">
                      <td style="padding:11px 10px 11px 0; max-width:220px;">
                        <div style="font-weight:700; color:#1c1714; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                          {s.title ?? 'Untitled'}
                        </div>
                        {#if s.hackatime_project}
                          <div style="color:#5b4f44; font-size:.72rem;">⏱ {s.hackatime_project}</div>
                        {/if}
                        {#if s.badges?.length}
                          <div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:4px;">
                            {#each s.badges as slug (slug)}
                              {#if BADGE_META[slug]}
                                <span
                                  title={BADGE_META[slug].label}
                                  style="display:inline-flex; align-items:center; gap:3px; padding:2px 7px; border:1.5px solid #1c1714; border-radius:6px; font-size:.62rem; font-weight:700; background:{BADGE_META[slug].bg}; color:{BADGE_META[slug].color};"
                                >{BADGE_META[slug].icon} {BADGE_META[slug].label}</span>
                              {/if}
                            {/each}
                          </div>
                        {/if}
                      </td>
                      <td style="padding:11px 10px 11px 0;">
                        <span style="display:inline-block; padding:3px 9px; border:1.5px solid #1c1714; border-radius:6px; font-size:.66rem; font-weight:700; text-transform:uppercase; letter-spacing:.06em; {STATUS_STYLE[s.status] ?? STATUS_STYLE.pending}">
                          {STATUS_LABEL[s.status] ?? s.status}
                        </span>
                        {#if s.status === 'changes_requested'}
                          <a href="/submit?edit={s.id}" style="display:block; margin-top:4px; color:#2f6db0; font-size:.7rem; font-weight:700; text-decoration:none;">✏️ Reship →</a>
                        {/if}
                      </td>
                      <td style="padding:11px 0; color:#5b4f44; white-space:nowrap;">{fmtDate(s.created_at)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      </aside>
    </div>
  {/if}
</div>

<style>
  /* The form is sized to fit one screen, so nothing scrolls at rest.
     min-height (not height) lets short viewports fall back to page scroll
     rather than clipping the submit button. */
  .submit-page {
    position: relative;
    min-height: 100svh;
    box-sizing: border-box;
    /* top padding reserves room for .back so it never overlaps the card */
    padding: 72px 20px 24px;
    background: #f4ead5;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .back {
    position: absolute;
    top: 20px;
    left: 20px;
    z-index: 5;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 18px;
    background: #fbf4e6;
    color: #1c1714;
    border: 2.5px solid #1c1714;
    border-radius: 10px 15px 9px 16px / 15px 10px 16px 9px;
    box-shadow: 4px 4px 0 #1c1714;
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 700;
    font-size: 0.85rem;
    text-decoration: none;
    transition: transform 0.1s, box-shadow 0.1s;
  }

  .back:hover {
    transform: translate(-2px, -2px);
    box-shadow: 6px 6px 0 #1c1714;
  }

  .submit-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.62fr);
    gap: 24px;
    align-items: start;
    width: 100%;
    max-width: 1320px;
    /* the form pane stretches to this; the textarea absorbs whatever is left over.
       96px = .submit-page's 72px top + 24px bottom padding */
    min-height: calc(100svh - 96px);
  }

  /* the cards cast a 7px offset shadow — without this it clips at the edges */
  .pane {
    padding: 4px 10px 10px 4px;
    overflow: visible;
  }

  .pane-form {
    display: flex;
    align-self: stretch;
  }

  .pane-form > form {
    flex: 1;
  }

  .form-split {
    display: grid;
    grid-template-columns: minmax(0, 0.88fr) minmax(0, 1.12fr);
    gap: 12px;
    align-items: start;
  }

  .form-col {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  .pane-form > form {
    width: 100%;
    max-width: 100%;
  }

  /* Grows into the leftover vertical space on tall screens; `rows` is the floor. */
  .description {
    flex: 1;
    resize: vertical;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .url-row {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
    gap: 8px;
    align-items: start;
  }

  .url-code,
  .url-demo {
    min-width: 0;
  }

  .field :global(input),
  .field :global(textarea) {
    width: 100%;
    min-width: 0;
  }

  .ai-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .ai-help {
    margin-top: 0;
    line-height: 1.35;
  }

  @media (max-width: 900px) {
    .submit-page {
      align-items: flex-start;
    }
    .submit-grid {
      grid-template-columns: minmax(0, 1fr);
      max-width: 620px;
      /* stacked: let each card size to its content instead of stretching */
      min-height: 0;
    }
    .pane-form {
      display: block;
    }
    .form-split {
      grid-template-columns: 1fr;
    }
    .url-row {
      grid-template-columns: 1fr;
    }
  }

</style>
