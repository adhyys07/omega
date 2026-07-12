<script lang="ts">
  import { onMount } from 'svelte'

  type Sub = {
    id: string
    title: string | null
    status: string
    first_name: string | null
    last_name: string | null
    code_url: string | null
    hackatime_hours: number | null
    hasThread: boolean
    created_at: string | null
  }
  type Msg = { ts: string; author: string; text: string; isBot: boolean; isParent: boolean }

  let subs = $state<Sub[]>([])
  let loading = $state(true)
  let listErr = $state('')
  let selected = $state<Sub | null>(null)
  let messages = $state<Msg[]>([])
  let draft = $state('')
  let dmSubmitter = $state(false)
  let sending = $state(false)
  let loadingThread = $state(false)
  let err = $state('')

  const STATUS_STYLE: Record<string, string> = {
    approved: 'background:rgba(74,150,80,.16); color:#3d7a40;',
    rejected: 'background:rgba(179,38,30,.14); color:#b3261e;',
    pending: 'background:rgba(255,179,71,.22); color:#b07410;',
    changes_requested: 'background:rgba(47,109,176,.14); color:#2f6db0;',
  }
  const STATUS_LABEL: Record<string, string> = { changes_requested: 'changes req.' }

  onMount(async () => {
    try {
      const r = await fetch('/api/review/submissions')
      if (!r.ok) throw new Error()
      subs = await r.json()
    } catch {
      listErr = "Couldn't load submissions. Is the server running?"
    } finally {
      loading = false
    }
  })

  async function open(s: Sub) {
    selected = s
    messages = []
    err = ''
    if (!s.hasThread) return
    loadingThread = true
    try {
      const r = await fetch(`/api/review/${s.id}/thread`)
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Could not load the thread')
      const data = await r.json()
      messages = data.messages ?? []
    } catch (e) {
      err = e instanceof Error ? e.message : 'Could not load the thread'
    } finally {
      loadingThread = false
    }
  }

  async function send() {
    const text = draft.trim()
    if (!text || !selected) return
    sending = true
    err = ''
    try {
      const r = await fetch(`/api/review/${selected.id}/message`, {
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

{#if loading}
  <p style="color:#5b4f44;">Loading…</p>
{:else if listErr}
  <p style="color:#c2451a; font-weight:700;">{listErr}</p>
{:else if !subs.length}
  <p style="color:#5b4f44;">No submissions yet.</p>
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
            {#if selected.hackatime_hours} · {selected.hackatime_hours}h{/if}
            {#if selected.code_url}
              · <a href={selected.code_url} target="_blank" rel="noopener" style="color:#c2451a; font-weight:700; text-decoration:none;">code ↗</a>
            {/if}
          </div>
        </div>

        {#if !selected.hasThread}
          <p style="padding:20px; color:#5b4f44; font-family:'Space Grotesk',sans-serif; font-size:.85rem;">
            No Slack thread for this submission — it predates the Slack integration, or the card failed to post.
          </p>
        {:else}
          <div style="padding:16px; max-height:44vh; overflow-y:auto; display:flex; flex-direction:column; gap:14px;">
            {#if loadingThread}
              <p style="color:#5b4f44; font-family:'Space Grotesk',sans-serif;">Loading thread…</p>
            {:else if !messages.length}
              <p style="color:#5b4f44; font-family:'Space Grotesk',sans-serif; font-size:.85rem;">No messages yet.</p>
            {:else}
              {#each messages as m (m.ts)}
                <div style="font-family:'Space Grotesk',sans-serif;">
                  <div style="display:flex; align-items:baseline; gap:8px;">
                    <strong style="font-size:.82rem; color:#1c1714;">{m.author}</strong>
                    <small style="font-size:.68rem; color:#9c8a6e;">{fmtTs(m.ts)}</small>
                  </div>
                  <div style="font-size:.85rem; color:#1c1714; white-space:pre-wrap; line-height:1.5; margin-top:2px;">
                    {m.isParent ? '📋 (the submission card)' : m.text}
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
