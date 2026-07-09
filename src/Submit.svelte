<script lang="ts">
  import { onMount } from 'svelte'

  // Only project-specific fields are collected here — name/email are taken from
  // the signed-in user's profile server-side, and address/birthday are gathered
  // later at the prizes step. No personal info is entered on this form.
  let f = $state({ title: '', code_url: '', playable_url: '', description: '' })

  let user = $state<null | { name?: string }>(null)
  let authReady = $state(false)
  let submitting = $state(false)
  let done = $state(false)
  let error = $state('')

  onMount(async () => {
    try {
      const r = await fetch('/api/auth/me')
      if (r.ok) user = await r.json()
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
      <input bind:value={f.code_url} type="url" placeholder="Code URL (repository)" required style={inputStyle} />
      <input bind:value={f.playable_url} type="url" placeholder="Playable / demo URL (optional)" style={inputStyle} />
      <textarea bind:value={f.description} placeholder="Describe what you built" rows="6" required style={inputStyle}></textarea>

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
