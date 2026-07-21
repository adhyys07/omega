<script lang="ts">
  type Props = {
    signedIn?: boolean
  }

  let { signedIn = false }: Props = $props()
</script>

<div class="forbidden">
  <div class="grain"></div>
  <div style="max-width:560px; text-align:center; padding:0 24px;">
    <div style="font-size:.72rem; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:#c2451a; margin-bottom:14px;">403 Forbidden</div>
    <h1 style="font-family:'Syne',sans-serif; font-weight:800; font-size:clamp(2.2rem,8vw,3.2rem); letter-spacing:-.02em; margin:0; line-height:1.05; text-shadow:3px 3px 0 rgba(194,69,26,.2);">Admin access only</h1>

    {#if signedIn}
      <p style="font-size:1rem; color:#5b4f44; margin:18px auto 0; max-width:460px; line-height:1.6;">
        This area is restricted to Omega admins. Your account is signed in, but it does not have admin permissions.
      </p>
    {:else}
      <p style="font-size:1rem; color:#5b4f44; margin:18px auto 0; max-width:460px; line-height:1.6;">
        You need to sign in with an admin account to access this area.
      </p>
    {/if}

    <div style="display:flex; align-items:center; justify-content:center; gap:10px; flex-wrap:wrap; margin-top:22px;">
      {#if !signedIn}
        <a href="/api/auth/login" style="display:inline-flex; background:var(--orange); color:#fff; border:2.5px solid #1c1714; border-radius:9px 13px 8px 12px/12px 8px 13px 9px; padding:11px 18px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.88rem; text-decoration:none; box-shadow:4px 4px 0 rgba(28,23,20,.25);">Sign in</a>
      {/if}
      <a href="/" style="display:inline-flex; background:#1c1714; color:#fff; border:2.5px solid #1c1714; border-radius:9px 13px 8px 12px/12px 8px 13px 9px; padding:11px 18px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.88rem; text-decoration:none; box-shadow:4px 4px 0 rgba(28,23,20,.25);">Back to home</a>
    </div>
  </div>
</div>

<style>
  .forbidden {
    position: fixed;
    inset: 0;
    z-index: 9998;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f4ead5;
    color: #1c1714;
    font-family: 'Space Grotesk', sans-serif;
  }

  .grain {
    position: fixed;
    inset: 0;
    pointer-events: none;
    mix-blend-mode: multiply;
    opacity: 0.09;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 220px 220px;
  }
</style>
