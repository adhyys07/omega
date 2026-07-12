<script lang="ts">
  import { onMount } from 'svelte'

  // Step 01 of the flow: propose the idea before spending 20+ hours building it.
  // A reviewer approves the pitch, which is what unlocks project submission.
  let f = $state({ title: '', description: '', why: '' })

  type Pitch = {
    id: string
    title: string | null
    description: string | null
    why: string | null
    status: string
    review_feedback: string | null
    created_at: string | null
  }

  let user = $state<null | { name?: string }>(null)
  let authReady = $state(false)
  let pitches = $state<Pitch[]>([])
  let pitchesLoaded = $state(false)
  let submitting = $state(false)
  let done = $state(false)
  let error = $state('')

  // Reship mode: /pitch?edit=recXXX prefills and PATCHes instead of POSTing.
  let editId = $state<string | null>(null)
  let reviewFeedback = $state<string | null>(null)

  const STATUS_STYLE: Record<string, string> = {
    approved: 'background:rgba(74,150,80,.16); color:#3d7a40;',
    rejected: 'background:rgba(179,38,30,.14); color:#b3261e;',
    pending: 'background:rgba(255,179,71,.22); color:#b07410;',
    changes_requested: 'background:rgba(47,109,176,.14); color:#2f6db0;',
  }
  const STATUS_LABEL: Record<string, string> = { changes_requested: 'changes requested' }

  onMount(async () => {
    editId = new URLSearchParams(location.search).get('edit')
    try {
      const r = await fetch('/api/auth/me')
      if (r.ok) { user = await r.json(); await loadPitches() }
    } catch {
      // not signed in / backend down
    } finally {
      authReady = true
    }
    if (editId) prefillForEdit(editId)
  })

  async function loadPitches() {
    try {
      const r = await fetch('/api/pitches/mine')
      if (!r.ok) throw new Error()
      pitches = await r.json()
    } catch {
      // non-fatal: the list just stays empty
    } finally {
      pitchesLoaded = true
    }
  }

  function prefillForEdit(id: string) {
    const p = pitches.find((x) => x.id === id)
    if (!p || p.status !== 'changes_requested') { editId = null; return }
    reviewFeedback = p.review_feedback
    f.title = p.title ?? ''
    f.description = p.description ?? ''
    f.why = p.why ?? ''
  }

  async function submit(e: Event) {
    e.preventDefault()
    submitting = true
    error = ''
    try {
      const r = await fetch(editId ? `/api/pitches/${editId}` : '/api/pitches', {
        method: editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Could not save your pitch')
      done = true
      loadPitches()
    } catch (err) {
      error = err instanceof Error ? err.message : 'Something went wrong'
    } finally {
      submitting = false
    }
  }

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'

  const inputStyle =
    'padding:13px 15px; border:2.5px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; font-family:\'Space Grotesk\',sans-serif; font-size:.92rem; background:#fbf4e6; color:#1c1714; outline:none; box-shadow:4px 4px 0 #1c1714;'
</script>

<div class="pitch-page">
  <a href="/" class="back" aria-label="Back home">← Back</a>

  {#if !authReady}
    <div style="font-family:'Space Grotesk',sans-serif; color:#5b4f44;">Loading…</div>

  {:else if !user}
    <div style="text-align:center; font-family:'Space Grotesk',sans-serif;">
      <h1 style="font-family:'Syne',sans-serif; font-weight:800; color:#1c1714;">Sign in to pitch</h1>
      <p style="color:#5b4f44; margin:10px 0 22px;">You need to sign in with Hack Club before pitching an idea.</p>
      <a href="/api/auth/login" style="display:inline-flex; background:var(--orange); color:#fff; border:2.5px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; padding:13px 26px; font-weight:800; text-decoration:none; box-shadow:4px 4px 0 #1c1714;">Sign in with Hack Club</a>
    </div>

  {:else if done}
    <div style="text-align:center; max-width:520px; font-family:'Space Grotesk',sans-serif;">
      <div style="font-family:'Syne',sans-serif; font-weight:800; font-size:1.6rem; color:#1c1714; margin-bottom:8px;">
        {editId ? '♻️ Pitch reshipped!' : '💡 Pitch received!'}
      </div>
      <p style="color:#5b4f44;">Reviewers will take a look and get back to you. Once it's approved, you can start building — and then submit the finished project.</p>
      <a href="/" style="display:inline-block; margin-top:22px; color:#c2451a; font-weight:700; text-decoration:none;">← Back home</a>
    </div>

  {:else}
    <div class="pitch-grid">
      <div class="pane">
        <form onsubmit={submit} style="width:100%; display:flex; flex-direction:column; gap:12px; background:#fbf4e6; border:3px solid #1c1714; border-radius:18px 12px 16px 13px/13px 16px 12px 18px; box-shadow:7px 7px 0 #1c1714; padding:30px;">
          <h1 style="font-family:'Syne',sans-serif; font-weight:800; font-size:1.6rem; color:#1c1714; margin:0;">
            {editId ? 'Reship your pitch' : 'Pitch your idea'}
          </h1>
          <p style="font-family:'Space Grotesk',sans-serif; font-size:.8rem; color:#5b4f44; margin:0 0 2px;">
            Tell us what you're building and how it'll help people. We'll review and get back to you, get this approved <strong>before</strong> you sink 20+ hours in.
          </p>

          {#if editId && reviewFeedback}
            <div style="background:rgba(47,109,176,.1); border:2px solid #2f6db0; border-radius:11px 8px 12px 9px/9px 12px 8px 11px; padding:12px 14px; font-family:'Space Grotesk',sans-serif; font-size:.82rem; color:#1c1714;">
              <div style="font-weight:700; color:#2f6db0; margin-bottom:4px;">✏️ Changes requested by the reviewer</div>
              <div style="white-space:pre-wrap; line-height:1.5;">{reviewFeedback}</div>
            </div>
          {/if}

          <input bind:value={f.title} placeholder="What's the idea called?" required style={inputStyle} />
          <textarea bind:value={f.description} placeholder="What are you building?" rows="5" required style={inputStyle}></textarea>
          <textarea bind:value={f.why} placeholder="How will it help people?" rows="4" required style={inputStyle}></textarea>

          {#if error}
            <div style="font-family:'Space Grotesk',sans-serif; font-size:.85rem; color:#b3261e; font-weight:700;">{error}</div>
          {/if}

          <button
            type="submit"
            disabled={submitting}
            style="background:var(--orange); color:#fff; border:2.5px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; padding:14px; font-family:'Syne',sans-serif; font-weight:800; font-size:1rem; cursor:pointer; box-shadow:4px 4px 0 #1c1714; opacity:{submitting ? '.6' : '1'};"
          >{submitting ? (editId ? 'Reshipping…' : 'Sending…') : (editId ? 'Reship pitch' : 'Send pitch')}</button>
        </form>
      </div>

      <aside class="pane">
        <div style="background:#fbf4e6; border:3px solid #1c1714; border-radius:18px 12px 16px 13px/13px 16px 12px 18px; box-shadow:7px 7px 0 #1c1714; padding:24px;">
          <h2 style="font-family:'Syne',sans-serif; font-weight:800; font-size:1.15rem; color:#1c1714; margin:0 0 4px;">Your pitches</h2>
          <p style="font-family:'Space Grotesk',sans-serif; font-size:.78rem; color:#5b4f44; margin:0 0 16px;">
            An approved pitch unlocks project submission.
          </p>

          {#if !pitchesLoaded}
            <div style="font-family:'Space Grotesk',sans-serif; font-size:.82rem; color:#5b4f44;">Loading…</div>
          {:else if !pitches.length}
            <div style="font-family:'Space Grotesk',sans-serif; font-size:.82rem; color:#5b4f44; border-top:2px dashed rgba(28,23,20,.28); padding-top:14px;">
              No pitches yet — your first idea will show up here.
            </div>
          {:else}
            <div style="display:flex; flex-direction:column;">
              {#each pitches as p (p.id)}
                <div style="border-top:2px dashed rgba(28,23,20,.28); padding:11px 0; font-family:'Space Grotesk',sans-serif;">
                  <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                    <div style="font-weight:700; color:#1c1714; font-size:.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                      {p.title ?? 'Untitled'}
                    </div>
                    <span style="flex:none; display:inline-block; padding:3px 9px; border:1.5px solid #1c1714; border-radius:6px; font-size:.62rem; font-weight:700; text-transform:uppercase; letter-spacing:.06em; {STATUS_STYLE[p.status] ?? STATUS_STYLE.pending}">
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </div>
                  <div style="font-size:.72rem; color:#5b4f44; margin-top:3px;">{fmtDate(p.created_at)}</div>

                  {#if p.status === 'changes_requested'}
                    <a href="/pitch?edit={p.id}" style="display:inline-block; margin-top:4px; color:#2f6db0; font-size:.72rem; font-weight:700; text-decoration:none;">✏️ Reship →</a>
                  {:else if p.status === 'approved'}
                    <a href="/submit" style="display:inline-block; margin-top:4px; color:#3d7a40; font-size:.72rem; font-weight:700; text-decoration:none;">🚀 Submit the project →</a>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </aside>
    </div>
  {/if}
</div>

<style>
  .pitch-page {
    position: relative;
    min-height: 100svh;
    box-sizing: border-box;
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

  .pitch-grid {
    display: grid;
    grid-template-columns: minmax(0, 640px) minmax(0, 380px);
    gap: 28px;
    align-items: start;
    width: 100%;
    max-width: 1100px;
  }

  /* the cards cast a 7px offset shadow — without this it clips at the edges */
  .pane {
    padding: 4px 10px 10px 4px;
  }

  @media (max-width: 900px) {
    .pitch-page {
      align-items: flex-start;
    }
    .pitch-grid {
      grid-template-columns: minmax(0, 1fr);
      max-width: 620px;
    }
  }
</style>
