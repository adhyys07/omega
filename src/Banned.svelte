<script lang="ts">
  import { onMount } from 'svelte'

  // Where banned users get sent. Change to whatever you want.
  const REDIRECT_URL = 'https://fraud.hackclub.com'
  const SECONDS = 7

  let left = $state(SECONDS)
  onMount(() => {
    const iv = setInterval(() => {
      left -= 1
      if (left <= 0) {
        clearInterval(iv)
        location.href = REDIRECT_URL
      }
    }, 1000)
    return () => clearInterval(iv)
  })
</script>

<div class="banned">
  <div class="grain"></div>
  <div style="max-width:520px; text-align:center; padding:0 24px;">
    <div style="font-size:.72rem; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:#c2451a; margin-bottom:14px;">✖ Access revoked</div>
    <h1 style="font-family:'Syne',sans-serif; font-weight:800; font-size:clamp(2.4rem,9vw,3.6rem); letter-spacing:-.02em; margin:0; line-height:1; text-shadow:3px 3px 0 rgba(194,69,26,.2);">You've been banned</h1>
    <p style="font-size:1rem; color:#5b4f44; margin:18px auto 0; max-width:420px; line-height:1.6;">
      Your access to Omega has been removed. If you think this is a mistake, reach out in <a href="https://hackclub.com/slack" style="color:var(--orange); font-weight:700;">#omega</a> on Hack Club Slack.
    </p>
    <p style="font-size:.85rem; color:#9c8a6e; margin-top:24px;">Redirecting in {left}s…</p>
    <a href={REDIRECT_URL} style="display:inline-flex; margin-top:14px; background:#1c1714; color:#fff; border:2.5px solid #1c1714; border-radius:9px 13px 8px 12px/12px 8px 13px 9px; padding:12px 26px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.92rem; text-decoration:none; box-shadow:4px 4px 0 rgba(28,23,20,.3);">Leave now →</a>
  </div>
</div>

<style>
  .banned {
    position: fixed;
    inset: 0;
    z-index: 9999;
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
