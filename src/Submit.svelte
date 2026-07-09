<script lang="ts">
  import { onMount } from 'svelte'

  // Only project-specific fields are collected here — name/email are taken from
  // the signed-in user's profile server-side, and address/birthday are gathered
  // later at the prizes step. No personal info is entered on this form.
  let f = $state({
     title: '', code_url: '', playable_url: '', description: '', screenshot_url: '',
     demo_video_url: '',
     hackatime_project: '', hackatime_hours: null as number | null,

   })

  type UploadField = 'screenshot_url' | 'demo_video_url'

  const MAX_BYTES: Record<UploadField, number> = {
    screenshot_url: 8 * 1024 * 1024,
    demo_video_url: 64 * 1024 * 1024,
  }

  const ACCEPT: Record<UploadField, string> = {
    screenshot_url: 'image/png,image/jpeg,image/gif,image/webp',
    demo_video_url: 'video/mp4,video/webm,video/quicktime',
  }

  let projects = $state<HtProject[]>([])
  let projectsLoaded = $state(false)
  let htLinked = $state(true)
  let user = $state<null | { name?: string }>(null)
  let authReady = $state(false)
  let submitting = $state(false)
  let done = $state(false)
  let uploading = $state<UploadField | null>(null)
  let uploadError = $state('')
  let error = $state('')

  type HtProject = { name?: string; total_seconds?: number }

  onMount(async () => {
    try {
      const r = await fetch('/api/auth/me')
      if (r.ok) { user = await r.json(); await loadProjects() }
    } catch {
      // not signed in / backend down
    } finally {
      authReady = true
    }
  })

  async function submit(e: Event) {
    e.preventDefault()
    submitting = true
    error = ''
    try {
      const r = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Submission failed')
      done = true
    } catch (err) {
      error = err instanceof Error ? err.message : 'Something went wrong'
    } finally {
      submitting = false
    }
  }

  async function uploadMedia(e: Event, field: UploadField){
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    uploadError = ''
    const limit = MAX_BYTES[field]
    if (file.size > limit) {
      uploadError = `File is too large (max ${Math.round(limit / 1024 / 1024)}MB)`
      input.value = ''
      return
    }

    uploading = field
    try {
      const r = await fetch(`/api/uploads/media?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
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
  }

  const inputStyle =
    'padding:13px 15px; border:2.5px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; font-family:\'Space Grotesk\',sans-serif; font-size:.92rem; background:#fbf4e6; color:#1c1714; outline:none; box-shadow:4px 4px 0 #1c1714;'
</script>

<div style="min-height:100svh; display:flex; align-items:center; justify-content:center; padding:48px 20px; background:#f4ead5;">
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
      <div style="font-family:'Syne',sans-serif; font-weight:800; font-size:1.6rem; color:#1c1714; margin-bottom:8px;">🎉 Submission received!</div>
      <p style="color:#5b4f44;">Our reviewers will take it from here — you'll hear back once it's been looked at.</p>
      <a href="/" style="display:inline-block; margin-top:22px; color:#c2451a; font-weight:700; text-decoration:none;">← Back home</a>
    </div>

  {:else}
    <form
      onsubmit={submit}
      style="width:100%; max-width:560px; display:flex; flex-direction:column; gap:14px; background:#fbf4e6; border:3px solid #1c1714; border-radius:18px 12px 16px 13px/13px 16px 12px 18px; box-shadow:7px 7px 0 #1c1714; padding:32px;"
    >
      <h1 style="font-family:'Syne',sans-serif; font-weight:800; font-size:1.8rem; color:#1c1714; margin:0;">Submit your project</h1>
      <p style="font-family:'Space Grotesk',sans-serif; font-size:.85rem; color:#5b4f44; margin:0 0 6px;">
        Submitting as <strong>{user.name ?? 'you'}</strong>. We'll pull your details from your account.
      </p>

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
      {:else if projectsLoaded}
        <div style="font-family:'Space Grotesk',sans-serif; font-size:.8rem; color:#5b4f44;">
          No Hackatime projects found — you can still submit without selecting one.
        </div>
      {/if}

      <input bind:value={f.code_url} type="url" placeholder="Code URL (repository)" required style={inputStyle} />
      <input bind:value={f.playable_url} type="url" placeholder="Playable / demo URL (optional)" style={inputStyle} />
      <textarea bind:value={f.description} placeholder="Describe what you built" rows="6" required style={inputStyle}></textarea>
      <input bind:value={f.screenshot_url} type="url" placeholder="Screenshot URL (public link)" style={inputStyle} />
      <label style="font-family:'Space Grotesk',sans-serif; font-size:.82rem; font-weight:700; color:#5b4f44; cursor:{uploading ? 'wait' : 'pointer'};">
        {uploading === 'screenshot_url' ? 'Uploading screenshot…' : '⬆ or upload a screenshot'}
        <input type="file" accept={ACCEPT.screenshot_url} disabled={!!uploading} onchange={(e) => uploadMedia(e, 'screenshot_url')} style="display:none;" />
      </label>

      <input bind:value={f.demo_video_url} type="url" placeholder="Demo video URL (optional)" style={inputStyle} />
      <label style="font-family:'Space Grotesk',sans-serif; font-size:.82rem; font-weight:700; color:#5b4f44; cursor:{uploading ? 'wait' : 'pointer'};">
        {uploading === 'demo_video_url' ? 'Uploading video…' : '⬆ or upload a demo video (MP4, WebM, MOV — max 64MB)'}
        <input type="file" accept={ACCEPT.demo_video_url} disabled={!!uploading} onchange={(e) => uploadMedia(e, 'demo_video_url')} style="display:none;" />
      </label>

      {#if uploadError}
        <div style="font-family:'Space Grotesk',sans-serif; font-size:.85rem; color:#b3261e; font-weight:700;">{uploadError}</div>
      {/if}

      {#if error}
        <div style="font-family:'Space Grotesk',sans-serif; font-size:.85rem; color:#b3261e; font-weight:700;">{error}</div>
      {/if}

      <button
        type="submit"
        disabled={submitting}
        style="background:var(--orange); color:#fff; border:2.5px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; padding:14px; font-family:'Syne',sans-serif; font-weight:800; font-size:1rem; cursor:pointer; box-shadow:4px 4px 0 #1c1714; opacity:{submitting ? '.6' : '1'};"
      >{submitting ? 'Submitting…' : 'Submit project'}</button>
    </form>
  {/if}
</div>
