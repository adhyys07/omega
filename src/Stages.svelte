<script lang="ts">
  // Jump the SIGNED-IN ADMIN's own account to any point in the builder flow.
  // The server does this by seeding rows, not by relaxing gates — so once you land,
  // you are hitting exactly the same 403/409 checks a real builder hits.

  type Stage = {
    id: string
    label: string
    icon: string
    blurb: string
  }

  const STAGES: Stage[] = [
    { id: 'fresh',            icon: '○', label: 'Fresh account',   blurb: 'No pitch, no project. Submit is locked behind "Pitch your idea first".' },
    { id: 'pitch_pending',    icon: '◔', label: 'Pitch pending',   blurb: 'Pitch submitted, awaiting review. Submit still locked.' },
    { id: 'pitch_changes',    icon: '↺', label: 'Pitch sent back', blurb: 'Reviewer asked for changes. Lands you in pitch reship mode.' },
    { id: 'pitch_approved',   icon: '◕', label: 'Pitch approved',  blurb: 'Submit unlocks and the pitch appears in the project selector.' },
    { id: 'project_pending',  icon: '◑', label: 'Project pending', blurb: 'Project submitted against the approved pitch. Sits in the review queue.' },
    { id: 'project_changes',  icon: '↻', label: 'Project sent back', blurb: 'Reviewer asked for changes. Lands you in project reship mode.' },
    { id: 'project_approved', icon: '●', label: 'Project approved', blurb: 'Approved and badge-able. The end of the happy path.' },
  ]

  let busy = $state<string | null>(null)
  let msg = $state('')
  let err = $state('')

  async function jump(stage: Stage) {
    busy = stage.id
    msg = ''
    err = ''
    try {
      const res = await fetch('/api/admin/dev/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ stage: stage.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`)
      msg = `Seeded "${stage.label}" — sending you to ${data.goto}…`
      // A full load, not pushState: every page reads its state on mount, and we
      // want them re-reading the rows we just wrote, not the ones they cached.
      setTimeout(() => (location.href = data.goto), 550)
    } catch (e) {
      err = e instanceof Error ? e.message : 'Something went wrong'
      busy = null
    }
  }

  async function reset() {
    busy = 'reset'
    msg = ''
    err = ''
    try {
      const res = await fetch('/api/admin/dev/reset', { method: 'POST', credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`)
      const { pitches = 0, submissions = 0 } = data.wiped ?? {}
      msg = `Cleared ${pitches} seeded pitch${pitches === 1 ? '' : 'es'} and ${submissions} seeded project${submissions === 1 ? '' : 's'}.`
    } catch (e) {
      err = e instanceof Error ? e.message : 'Something went wrong'
    } finally {
      busy = null
    }
  }
</script>

<div style="border:2px solid #1c1714; border-radius:14px 10px 16px 9px/9px 16px 10px 14px; background:rgba(255,179,71,.14); padding:14px 18px; margin:0 0 24px; box-shadow:3px 3px 0 rgba(28,23,20,.12);">
  <strong style="font-family:'Space Grotesk',sans-serif; font-size:.9rem;">⚠ Dev tool.</strong>
  <span style="font-size:.88rem; color:#5b4f44;">
    These buttons rewrite <em>your own</em> pitch and project rows so you can walk the flow as a builder.
    Seeded rows are tagged and are the only rows a reset can delete — your real work is never touched.
    Every gate stays live: nothing here lets you skip a check.
  </span>
</div>

{#if msg}
  <p style="margin:0 0 16px; padding:10px 14px; border:2px solid #3d7a40; border-radius:10px; background:rgba(74,150,80,.12); color:#2f5f32; font-weight:700; font-size:.88rem;">{msg}</p>
{/if}
{#if err}
  <p style="margin:0 0 16px; padding:10px 14px; border:2px solid #c2451a; border-radius:10px; background:rgba(255,107,53,.12); color:#a33813; font-weight:700; font-size:.88rem;">{err}</p>
{/if}

<div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:14px;">
  {#each STAGES as stage (stage.id)}
    <button
      onclick={() => jump(stage)}
      disabled={busy !== null}
      style="
        text-align:left; cursor:{busy ? 'wait' : 'pointer'};
        padding:16px 18px;
        border:2px solid #1c1714;
        border-radius:12px 16px 10px 15px/15px 10px 16px 12px;
        background:{busy === stage.id ? 'var(--orange)' : '#fbf4e6'};
        color:{busy === stage.id ? '#fff' : '#1c1714'};
        box-shadow:3px 3px 0 rgba(28,23,20,.18);
        opacity:{busy && busy !== stage.id ? .5 : 1};
        font-family:'Space Grotesk',sans-serif;
        transition:transform .08s ease;
      "
    >
      <div style="display:flex; align-items:center; gap:9px; font-weight:800; font-size:.95rem; margin-bottom:6px;">
        <span style="font-size:1.05rem;">{stage.icon}</span>{stage.label}
      </div>
      <div style="font-size:.82rem; line-height:1.45; color:{busy === stage.id ? 'rgba(255,255,255,.9)' : '#5b4f44'};">
        {stage.blurb}
      </div>
    </button>
  {/each}
</div>

<button
  onclick={reset}
  disabled={busy !== null}
  style="
    margin-top:22px; cursor:{busy ? 'wait' : 'pointer'};
    padding:10px 20px;
    border:2px solid #1c1714;
    border-radius:10px 14px 9px 13px/13px 9px 14px 10px;
    background:#fbf4e6; color:#1c1714;
    font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.84rem;
    box-shadow:2px 2px 0 rgba(28,23,20,.18);
  "
>✕ Clear my seeded rows</button>
