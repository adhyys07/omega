<script lang="ts">
  type User = {
    name?: string
    email?: string
    slack_id?: string
    role?: string
    banned?: boolean
    birthdate?: string
    verification_status?: string
    ysws_eligible?: boolean
  }

  type Props = {
    user: User | null
    size?: number
    isAdmin?: boolean
    onSignOut?: () => void | Promise<void>
  }

  let { user, size = 68, isAdmin = false, onSignOut }: Props = $props()

  let open = $state(false)
  let hackatimeState = $state<'idle' | 'checking' | 'linked' | 'unlinked' | 'error'>('idle')

  async function refreshHackatime() {
    hackatimeState = 'checking'
    try {
      const res = await fetch('/api/hackatime/projects', { credentials: 'include' })
      if (res.status === 404) {
        hackatimeState = 'unlinked'
        return
      }
      if (!res.ok) throw new Error()
      hackatimeState = 'linked'
    } catch {
      hackatimeState = 'error'
    }
  }

  function toggle(e: MouseEvent) {
    e.stopPropagation()
    open = !open
    if (open) void refreshHackatime()
  }

  async function signOut(e: MouseEvent) {
    e.stopPropagation()
    await onSignOut?.()
    open = false
  }

  function stop(e: MouseEvent) {
    e.stopPropagation()
  }
</script>

<svelte:window onclick={() => (open = false)} />

<div style="position:relative; display:inline-flex; align-items:flex-start;">
  <button
    onclick={toggle}
    title={user?.name ?? 'Account'}
    aria-haspopup="dialog"
    aria-expanded={open}
    style="padding:0; border:none; background:none; cursor:pointer; line-height:0; border-radius:50%;"
  >
    {#if user?.slack_id}
      <img
        src={`https://cachet.dunkirk.sh/users/${user.slack_id}/r`}
        alt={user.name || 'Profile'}
        referrerpolicy="no-referrer"
        loading="lazy"
        style={`width:${size}px; height:${size}px; border-radius:50%; border:3px solid #1c1714; box-shadow:4px 4px 0 #1c1714; object-fit:cover; background:#fbf4e6; display:block;`}
      />
    {:else}
      <div style={`width:${size}px; height:${size}px; border-radius:50%; border:3px solid #1c1714; box-shadow:4px 4px 0 #1c1714; background:var(--orange); color:#fff; display:flex; align-items:center; justify-content:center; font-family:'Syne',sans-serif; font-weight:800; font-size:${Math.max(16, Math.round(size * 0.24))}px;`}>
        {(user?.name ?? '?').charAt(0).toUpperCase()}
      </div>
    {/if}
  </button>

  {#if open}
    <div
      role="dialog"
      tabindex="-1"
      aria-label="Account details"
      onclick={stop}
      onkeydown={(e) => e.key === 'Escape' && (open = false)}
      style="position:absolute; top:calc(100% + 16px); right:0; width:min(380px, calc(100vw - 32px)); background:#fbf4e6; border:2.5px solid #1c1714; border-radius:14px 9px 15px 10px/10px 15px 9px 14px; box-shadow:5px 5px 0 #1c1714; padding:14px; display:flex; flex-direction:column; gap:12px;"
    >
      <div style="display:flex; gap:12px; align-items:center;">
        {#if user?.slack_id}
          <img
            src={`https://cachet.dunkirk.sh/users/${user.slack_id}/r`}
            alt={user.name || 'Profile'}
            referrerpolicy="no-referrer"
            style="width:54px; height:54px; border-radius:50%; border:2.5px solid #1c1714; box-shadow:3px 3px 0 #1c1714; object-fit:cover; background:#fff;"
          />
        {:else}
          <div style="width:54px; height:54px; border-radius:50%; border:2.5px solid #1c1714; box-shadow:3px 3px 0 #1c1714; background:var(--orange); color:#fff; display:flex; align-items:center; justify-content:center; font-family:'Syne',sans-serif; font-weight:800; font-size:1.2rem; flex:none;">
            {(user?.name ?? '?').charAt(0).toUpperCase()}
          </div>
        {/if}
        <div style="min-width:0;">
          <div style="font-family:'Syne',sans-serif; font-size:1.05rem; font-weight:800; color:#1c1714; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            {user?.name ?? 'Unknown user'}
          </div>
          <div style="font-family:'Space Grotesk',sans-serif; font-size:.78rem; color:#5b4f44; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            {user?.email ?? 'No email on file'}
          </div>
        </div>
      </div>

      <div style="padding:10px 12px; border:2px dashed rgba(28,23,20,.18); border-radius:12px; background:rgba(251,244,230,.7);">
        <div style="font-size:.68rem; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:var(--orange); margin-bottom:6px;">Hack Club linkage</div>
        <div style="font-family:'Space Grotesk',sans-serif; font-size:.8rem; color:#1c1714; line-height:1.6;">
          <div><strong>Slack:</strong> {user?.slack_id ? `linked (${user.slack_id})` : 'not linked'}</div>
          <div><strong>Role:</strong> {user?.role ?? 'user'}</div>
          {#if user?.verification_status}
            <div><strong>Verification:</strong> {user.verification_status}</div>
          {/if}
          {#if user?.ysws_eligible}
            <div><strong>YSWS:</strong> eligible</div>
          {/if}
          {#if user?.birthdate}
            <div><strong>Birthday:</strong> {user.birthdate}</div>
          {/if}
          {#if user?.banned}
            <div><strong>Status:</strong> <span style="color:#b3261e; font-weight:700;">banned</span></div>
          {/if}
        </div>
      </div>

      <div style="padding:10px 12px; border:2px dashed rgba(28,23,20,.18); border-radius:12px; background:rgba(251,244,230,.7);">
        <div style="font-size:.68rem; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:var(--orange); margin-bottom:6px;">Hackatime linkage</div>
        <div style="font-family:'Space Grotesk',sans-serif; font-size:.8rem; color:#1c1714; line-height:1.6;">
          {#if hackatimeState === 'checking'}
            Checking connection…
          {:else if hackatimeState === 'linked'}
            Connected
          {:else if hackatimeState === 'unlinked'}
            Not linked yet
          {:else if hackatimeState === 'error'}
            Could not check right now
          {:else}
            Not checked yet
          {/if}
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
          <a
            href="/api/hackatime/login"
            onclick={stop}
            style="display:inline-flex; align-items:center; gap:6px; background:#fbf4e6; color:#1c1714; border:2.5px solid #1c1714; border-radius:10px 15px 9px 16px/15px 10px 16px 9px; padding:8px 12px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.78rem; text-decoration:none;"
          >
            Connect Hackatime
          </a>
          <button
            onclick={(e) => { e.stopPropagation(); void refreshHackatime() }}
            style="display:inline-flex; align-items:center; gap:6px; background:#fbf4e6; color:#1c1714; border:2.5px solid #1c1714; border-radius:10px 15px 9px 16px/15px 10px 16px 9px; padding:8px 12px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.78rem; cursor:pointer;"
          >
            Refresh status
          </button>
        </div>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        {#if isAdmin}
          <a
            href="/admin"
            onclick={stop}
            style="display:inline-flex; align-items:center; gap:6px; background:var(--orange); color:#fff; border:2.5px solid #1c1714; border-radius:10px 15px 9px 16px/15px 10px 16px 9px; padding:8px 12px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.8rem; text-decoration:none;"
          >
            Admin panel
          </a>
        {/if}
        <button
          onclick={signOut}
          style="display:inline-flex; align-items:center; gap:6px; background:#fbf4e6; color:#1c1714; border:2.5px solid #1c1714; border-radius:10px 15px 9px 16px/15px 10px 16px 9px; padding:8px 12px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.8rem; cursor:pointer;"
        >
          Sign out
        </button>
      </div>
    </div>
  {/if}
</div>
