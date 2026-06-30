<script lang="ts">
  function go(path: string, e: MouseEvent) {
    e.preventDefault()
    history.pushState({}, '', path)
    dispatchEvent(new PopStateEvent('popstate'))
  }

  type Cat = 'Getting started' | 'Android' | 'iOS' | 'Cross-platform' | 'Design' | 'Publishing' | 'Hack Club'

  type Resource = {
    cat: Cat
    title: string
    desc: string
    href: string
  }

  // Presentation per category (border accent + tag colors)
  const CAT_STYLE: Record<Cat, { bg: string; color: string }> = {
    'Getting started': { bg: 'rgba(255,69,0,.12)',   color: '#c2451a' },
    Android:           { bg: 'rgba(74,150,80,.16)',  color: '#3d7a40' },
    iOS:               { bg: 'rgba(28,23,20,.08)',   color: '#1c1714' },
    'Cross-platform':  { bg: 'rgba(47,109,176,.13)', color: '#2f6db0' },
    Design:            { bg: 'rgba(255,179,71,.2)',  color: '#b07410' },
    Publishing:        { bg: 'rgba(255,69,0,.12)',   color: '#c2451a' },
    'Hack Club':       { bg: 'rgba(255,69,0,.16)',   color: '#c2451a' },
  }

  const RESOURCES: Resource[] = [
    // Getting started
    { cat: 'Getting started', title: 'Pick a stack', desc: 'Native (Kotlin/Swift) vs cross-platform (Flutter/React Native) — how to choose.', href: 'https://developer.android.com/courses' },
    { cat: 'Getting started', title: 'Git & GitHub basics', desc: 'Version control you’ll need for your submission repo.', href: 'https://docs.github.com/en/get-started' },

    // Android
    { cat: 'Android', title: 'Android Developer docs', desc: 'The official home for everything Android.', href: 'https://developer.android.com/docs' },
    { cat: 'Android', title: 'Jetpack Compose', desc: 'Modern declarative UI toolkit for Android.', href: 'https://developer.android.com/jetpack/compose/documentation' },
    { cat: 'Android', title: 'Kotlin language docs', desc: 'The language most Android apps are written in today.', href: 'https://kotlinlang.org/docs/home.html' },
    { cat: 'Android', title: 'Android Studio', desc: 'Download + set up the official IDE.', href: 'https://developer.android.com/studio' },

    // iOS
    { cat: 'iOS', title: 'Apple Developer docs', desc: 'Reference for all Apple platforms & frameworks.', href: 'https://developer.apple.com/documentation' },
    { cat: 'iOS', title: 'SwiftUI tutorials', desc: 'Build iOS UIs declaratively, step by step.', href: 'https://developer.apple.com/tutorials/swiftui' },
    { cat: 'iOS', title: 'The Swift book', desc: 'Learn the Swift language from scratch.', href: 'https://docs.swift.org/swift-book/' },
    { cat: 'iOS', title: 'Xcode', desc: 'Apple’s IDE — required to build & ship iOS apps.', href: 'https://developer.apple.com/xcode/' },

    // Cross-platform
    { cat: 'Cross-platform', title: 'Flutter docs', desc: 'One Dart codebase → Android + iOS.', href: 'https://docs.flutter.dev/' },
    { cat: 'Cross-platform', title: 'React Native', desc: 'Build native apps with React.', href: 'https://reactnative.dev/docs/getting-started' },
    { cat: 'Cross-platform', title: 'Expo', desc: 'The fastest way to start a React Native app.', href: 'https://docs.expo.dev/' },

    // Design
    { cat: 'Design', title: 'Material Design 3', desc: 'Google’s design system for Android.', href: 'https://m3.material.io/' },
    { cat: 'Design', title: 'Apple HIG', desc: 'Human Interface Guidelines for great iOS UX.', href: 'https://developer.apple.com/design/human-interface-guidelines' },

    // Publishing
    { cat: 'Publishing', title: 'Google Play Console', desc: 'Publish & manage your Android app.', href: 'https://support.google.com/googleplay/android-developer' },
    { cat: 'Publishing', title: 'App Store Connect', desc: 'Submit & manage your iOS app.', href: 'https://developer.apple.com/app-store-connect/' },

    // Hack Club
    { cat: 'Hack Club', title: 'Hackatime', desc: 'Log your build hours — required for Omega submissions.', href: 'https://hackatime.hackclub.com/' },
    { cat: 'Hack Club', title: '#omega on Slack', desc: 'Ask questions and get unblocked fast.', href: 'https://hackclub.com/slack' },
  ]

  const CATEGORIES = ['All', 'Getting started', 'Android', 'iOS', 'Cross-platform', 'Design', 'Publishing', 'Hack Club'] as const
  let active = $state<(typeof CATEGORIES)[number]>('All')
  let q = $state('')

  const shown = $derived(
    RESOURCES.filter((r) => {
      const okCat = active === 'All' || r.cat === active
      const okQ = q.trim() === '' || `${r.title} ${r.desc}`.toLowerCase().includes(q.trim().toLowerCase())
      return okCat && okQ
    }),
  )

  const ROTS = ['-.5deg', '.6deg', '-.7deg', '.5deg', '-.4deg', '.7deg']
  const RADII = [
    '18px 11px 16px 12px/12px 16px 11px 18px',
    '11px 18px 12px 16px/16px 12px 18px 11px',
    '16px 12px 18px 11px/11px 18px 12px 16px',
    '12px 16px 11px 18px/18px 11px 16px 12px',
  ]

  const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } }
</script>

<div class="docs">
  <div class="grain"></div>
  <div class="halftone"></div>

  <header style="position:sticky; top:0; z-index:40; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:16px 24px; background:#f4ead5cc; backdrop-filter:blur(6px); border-bottom:2.5px solid #1c1714;">
    <a href="/" onclick={(e) => go('/', e)} style="display:inline-flex; align-items:center; gap:8px; font-family:'Syne',sans-serif; font-weight:800; font-size:1.1rem; color:#1c1714; text-decoration:none;">
      <span style="color:var(--orange);">Ω</span> Omega Guides
    </a>
  </header>

  <div style="max-width:980px; margin:0 auto; padding:48px 24px 8px;">
    <div style="font-size:.72rem; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:var(--orange); margin-bottom:10px;">✦ Builder docs</div>
    <h1 style="font-family:'Syne',sans-serif; font-weight:800; font-size:clamp(2.2rem,7vw,3.4rem); letter-spacing:-.02em; margin:0; text-shadow:3px 3px 0 rgba(255,69,0,.16);">Guides & docs</h1>
    <p style="font-size:1rem; color:#5b4f44; margin:12px 0 0; max-width:560px; line-height:1.6;">Everything you need to build and ship Android + iOS apps for Omega.</p>

    <input
      bind:value={q}
      placeholder="Search guides…"
      style="display:block; width:100%; max-width:420px; margin-top:22px; padding:12px 16px; border:2.5px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; font-family:'Space Grotesk',sans-serif; font-size:.92rem; background:#fbf4e6; color:#1c1714; outline:none; box-shadow:4px 4px 0 rgba(28,23,20,.13);"
    />

    <div style="display:flex; gap:9px; flex-wrap:wrap; margin-top:18px;">
      {#each CATEGORIES as c}
        <button
          onclick={() => (active = c)}
          style="padding:8px 16px; border:2px solid #1c1714; border-radius:100px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.82rem; cursor:pointer; box-shadow:2px 2px 0 rgba(28,23,20,.18); background:{active === c ? 'var(--orange)' : '#fbf4e6'}; color:{active === c ? '#fff' : '#1c1714'};"
        >{c}</button>
      {/each}
    </div>
  </div>

  <div style="max-width:980px; margin:0 auto; padding:24px 24px 80px;">
    {#if shown.length === 0}
      <p style="color:#5b4f44;">No guides match that search.</p>
    {:else}
      <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:18px;">
        {#each shown as r, i (r.href)}
          {@const s = CAT_STYLE[r.cat]}
          <a
            href={r.href}
            target="_blank"
            rel="noopener"
            class="doc-card"
            style="display:flex; flex-direction:column; text-decoration:none; color:#1c1714; background:#fbf4e6; border:2.5px solid #1c1714; border-radius:{RADII[i % RADII.length]}; padding:20px; box-shadow:5px 5px 0 rgba(28,23,20,.13); transform:rotate({ROTS[i % ROTS.length]});"
          >
            <span style="align-self:flex-start; font-size:.62rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; padding:4px 10px; border:1.5px solid #1c1714; border-radius:6px; background:{s.bg}; color:{s.color}; margin-bottom:12px;">{r.cat}</span>
            <div style="font-family:'Syne',sans-serif; font-size:1.05rem; font-weight:800; margin-bottom:6px;">{r.title}</div>
            <div style="font-size:.82rem; color:#5b4f44; line-height:1.55; flex:1;">{r.desc}</div>
            <div style="margin-top:14px; font-size:.75rem; font-weight:700; color:var(--orange);">{host(r.href)} ↗</div>
          </a>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .docs {
    position: relative;
    min-height: 100vh;
    background: #f4ead5;
    color: #1c1714;
    font-family: 'Space Grotesk', sans-serif;
    line-height: 1.5;
    overflow-x: hidden;
  }
  .grain {
    position: fixed; inset: 0; pointer-events: none; z-index: 60;
    mix-blend-mode: multiply; opacity: 0.09;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 220px 220px;
  }
  .halftone {
    position: fixed; inset: 0; pointer-events: none; z-index: 59;
    mix-blend-mode: multiply; opacity: 0.13;
    background-image: radial-gradient(rgba(28, 23, 20, 0.85) 22%, transparent 24%);
    background-size: 6px 6px;
  }
  .doc-card { transition: transform 0.1s, box-shadow 0.1s; }
  .doc-card:hover { transform: translate(-2px, -2px) rotate(0deg) !important; box-shadow: 7px 7px 0 rgba(28,23,20,.18); }
</style>
