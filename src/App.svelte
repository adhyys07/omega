<script lang="ts">
  import { onMount } from 'svelte'

  // --- Countdown ---
  const target = new Date('2026-07-27T00:00:00').getTime()
  let d = $state('00')
  let h = $state('00')
  let m = $state('00')
  let s = $state('00')

  const pad = (n: number) => String(n).padStart(2, '0')

  function tick() {
    let diff = target - Date.now()
    if (diff < 0) diff = 0
    d = pad(Math.floor(diff / 86400000))
    h = pad(Math.floor((diff % 86400000) / 3600000))
    m = pad(Math.floor((diff % 3600000) / 60000))
    s = pad(Math.floor((diff % 60000) / 1000))
  }

  onMount(() => {
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  })

  // --- Signup ---
  let email = $state('')
  let signedUp = $state(false)
  let invalid = $state(false)

  function signup() {
    const value = email.trim()
    if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      invalid = true
      return
    }
    invalid = false
    signedUp = true
  }

  // --- Data ---
  const heroDecos = [
    { style: 'left:8%; top:22%; font-size:2.8rem; color:var(--orange); transform:rotate(-14deg);', char: '✦' },
    { style: 'right:11%; top:18%; font-size:1.9rem; color:#2f6db0; transform:rotate(12deg);', char: '✦' },
    { style: 'left:13%; top:62%; font-size:1.5rem; color:#1c1714; transform:rotate(9deg);', char: '✧' },
    { style: 'right:13%; bottom:24%; font-size:2.1rem; color:var(--orange); transform:rotate(-7deg);', char: '✦' },
    { style: 'left:9%; bottom:32%; font-size:1.2rem; color:#2f6db0; transform:rotate(16deg);', char: '✳' },
  ]

  const cdUnits = [
    { get v() { return d }, label: 'days', radius: '16px 9px 15px 10px/10px 15px 9px 16px', rot: '-1.5deg' },
    { get v() { return h }, label: 'hrs', radius: '10px 15px 9px 16px/15px 10px 16px 9px', rot: '1deg' },
    { get v() { return m }, label: 'min', radius: '15px 10px 16px 9px/9px 16px 10px 15px', rot: '-.8deg' },
    { get v() { return s }, label: 'sec', radius: '9px 16px 10px 15px/16px 9px 15px 10px', rot: '1.4deg' },
  ]

  const steps = [
    {
      n: '01',
      r: '48% 52% 50% 50%/55% 48% 52% 45%',
      title: 'Pitch your idea',
      body: "Submit a proposal — tell us what you're building and how it'll help people. We'll review and get back to you.",
      cta: { label: 'Submit proposal →', radius: '9px 6px 10px 5px/5px 10px 6px 9px' },
    },
    {
      n: '02',
      r: '52% 48% 50% 50%/45% 52% 48% 55%',
      title: 'Build your app',
      body: 'Minimum 20 hours per project. Log everything in Hackatime — reviewers verify every session.',
      cta: null,
    },
    {
      n: '03',
      r: '48% 52% 50% 50%/55% 48% 52% 45%',
      title: 'Submit your project',
      body: 'Drop your repo, a demo video, and your hour log. Up to 2 projects per person over two months.',
      cta: { label: 'Submit project →', radius: '6px 9px 5px 10px/10px 5px 9px 6px' },
    },
    {
      n: '04',
      r: '52% 48% 50% 50%/45% 52% 48% 55%',
      title: 'Get reviewed & earn currency',
      body: 'Reviewers and orgs approve your hours. Currency = approved hours × your tier multiplier.',
      cta: null,
    },
    {
      n: '05',
      r: '48% 52% 50% 50%/55% 48% 52% 45%',
      title: 'Spend in the Omega shop',
      body: 'Pick what you actually want — phones, dev licenses, dev tools, and more.',
      cta: null,
    },
  ]

  const criteria = [
    { n: '01', title: 'Unique idea', body: 'Does it stand apart from everything else out there?', r: '16px 9px 15px 11px/11px 15px 9px 16px', rot: '-.8deg' },
    { n: '02', title: 'Complexity', body: 'Technical depth, real systems, real engineering.', r: '9px 16px 11px 15px/15px 11px 16px 9px', rot: '.7deg' },
    { n: '03', title: 'UI / UX', body: 'Beautiful, intuitive, thoughtfully designed screens.', r: '15px 11px 16px 9px/9px 16px 11px 15px', rot: '-.5deg' },
    { n: '04', title: 'Feature quality', body: 'Every feature ships complete — no half-baked work.', r: '11px 15px 9px 16px/16px 9px 15px 11px', rot: '1deg' },
    { n: '05', title: 'Real-world use', body: 'Would people actually download and use this app?', r: '16px 9px 15px 11px/11px 15px 9px 16px', rot: '-.9deg' },
  ]

  const badges = [
    { char: '▲', label: 'Android Builder', bg: 'rgba(74,150,80,.16)', color: '#3d7a40', r: '10px 7px 11px 6px/6px 11px 7px 10px', rot: '-1.2deg' },
    { char: '◉', label: 'iOS Shipper', bg: 'rgba(255,107,53,.16)', color: '#c2451a', r: '7px 10px 6px 11px/11px 6px 10px 7px', rot: '.9deg' },
    { char: '✦', label: 'Gemini Integration', bg: 'rgba(47,109,176,.16)', color: '#2f6db0', r: '10px 7px 11px 6px/6px 11px 7px 10px', rot: '-.6deg' },
    { char: '▣', label: 'Cider Crossover', bg: 'rgba(255,179,71,.2)', color: '#b07410', r: '7px 10px 6px 11px/11px 6px 10px 7px', rot: '1.1deg' },
    { char: '◆', label: 'Dual Platform', bg: 'rgba(255,107,53,.16)', color: '#c2451a', r: '10px 7px 11px 6px/6px 11px 7px 10px', rot: '-1deg' },
    { char: '⚡', label: 'Elite Tier', bg: 'rgba(255,179,71,.2)', color: '#b07410', r: '7px 10px 6px 11px/11px 6px 10px 7px', rot: '.7deg' },
  ]

  const tiers = [
    { icon: '◔', name: 'Starter', desc: 'Basic mechanics, clean UI, working features', mult: '1.0×', rate: '~$4 / hr', bg: '#fbf4e6', iconBg: 'rgba(91,79,68,.12)', iconR: '50%', cardR: '16px 11px 15px 12px/12px 15px 11px 16px', rot: '-.5deg', multColor: '#5b4f44', nameColor: '#1c1714', descColor: '#5b4f44', rateColor: '#5b4f44', shadow: '4px 4px 0 rgba(28,23,20,.13)' },
    { icon: '◑', name: 'Builder', desc: 'Multiple systems, polished design, real-world value', mult: '1.25×', rate: '~$5 / hr', bg: '#fbf4e6', iconBg: 'rgba(255,107,53,.16)', iconR: '13px 9px 12px 8px/8px 12px 9px 13px', cardR: '11px 16px 12px 15px/15px 12px 16px 11px', rot: '.6deg', multColor: '#c2451a', nameColor: '#1c1714', descColor: '#5b4f44', rateColor: '#5b4f44', shadow: '4px 4px 0 rgba(28,23,20,.13)' },
    { icon: '⚡', name: 'Elite ⚡', desc: 'Exceptional complexity, shipping quality — truly rare', mult: '1.5×', rate: 'up to $6 / hr', bg: 'var(--orange)', iconBg: 'rgba(255,255,255,.25)', iconR: '9px 13px 8px 12px/12px 8px 13px 9px', cardR: '15px 12px 16px 11px/11px 16px 12px 15px', rot: '-.7deg', multColor: '#fff', nameColor: '#fff', descColor: 'rgba(255,255,255,.85)', rateColor: 'rgba(255,255,255,.85)', shadow: '5px 5px 0 #1c1714' },
  ]

  const rules = [
    { lead: 'No double dipping.', rest: ' Omega submissions cannot count toward any other YSWS program. No exceptions.', last: false },
    { lead: '20 hours minimum per project.', rest: ' Hackatime logs required. Reviewers verify every session.', last: false },
    { lead: 'Max 2 projects', rest: ' per participant over the two-month window.', last: false },
    { lead: 'Fraud = ban.', rest: ' Fulfillment cancelled, case sent to the Hack Club fraud team. Severity determines the ban length.', last: true },
  ]

  const faqs = [
    { q: 'Do I need to build Android AND iOS?', a: "Yes — that's the Omega challenge. Both platforms, at least 20 hours each. No shortcuts." },
    { q: 'How does shop currency work?', a: 'Approved hours × tier multiplier = currency. Roughly $4–6 per hour. Spend it on anything in the shop.' },
    { q: 'Can I also submit to Cider or Gemini?', a: 'No. No double dipping with any other YSWS program whatsoever.' },
    { q: "Who's eligible?", a: 'High schoolers or younger. 100% free — funded by Hack Club donors.' },
    { q: 'How much does it cost?', a: 'Nothing. The entire program is free, funded by donations to The Hack Foundation.' },
  ]

  const footerLinks = [
    { href: 'https://hackclub.com/philosophy', label: 'Philosophy' },
    { href: 'https://hackclub.com/team', label: 'Team' },
    { href: 'https://hackclub.com/jobs', label: 'Jobs' },
    { href: 'https://hackclub.com/donate', label: 'Donate' },
    { href: 'https://github.com/hackclub', label: 'GitHub' },
    { href: 'https://hackclub.com/slack', label: 'Slack' },
  ]

  const tickerItems = ['You Ship', 'We Ship', 'Android', 'iOS', 'Build & Ship', 'Earn Badges', 'Shop Rewards', '20+ Hours', 'Tier System']
</script>

<div class="omega">
  <!-- paper grain overlay -->
  <div class="grain"></div>
  <!-- riso halftone dot layer -->
  <div class="halftone"></div>

  <!-- Flag -->
  <a href="https://hackclub.com/"><img style="position: absolute; top: 0; left: 10px; border: 0; width: 256px; z-index: 999;" src="https://assets.hackclub.com/banners/2026.svg" alt="Hack Club"/></a>

  <!-- Hero -->
  <div style="text-align:center; padding:96px 24px 56px; min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; position:relative;">
    {#each heroDecos as deco}
      <div class="hero-deco" style="position:absolute; {deco.style} pointer-events:none;">{deco.char}</div>
    {/each}

    <div class="hero-deco" style="position:absolute; left:6%; top:44%; background:#2f6db0; color:#fff; border:2.5px solid #1c1714; border-radius:12px 7px 13px 6px/6px 13px 7px 12px; padding:9px 15px; font-family:'Syne',sans-serif; font-weight:800; font-size:.82rem; transform:rotate(-8deg); box-shadow:4px 4px 0 #1c1714;">Android + iOS</div>

    <div class="hero-deco" style="position:absolute; right:6%; top:38%; width:112px; height:112px; border:2.5px solid #1c1714; border-radius:50%; display:flex; align-items:center; justify-content:center; text-align:center; transform:rotate(-13deg); background:rgba(255,69,0,.09); box-shadow:4px 5px 0 rgba(28,23,20,.16);">
      <div style="font-family:'Syne',sans-serif; font-weight:800; font-size:1.05rem; letter-spacing:.04em; text-transform:uppercase; color:#c2451a; line-height:1.05;">100%<br>Free<br><span style="font-size:.62rem; color:#1c1714; letter-spacing:.08em;">to enter</span></div>
    </div>

    <div class="hero-deco" style="position:absolute; left:18%; bottom:13%; transform:rotate(-5deg); text-align:left; pointer-events:none;">
      <div style="font-family:'Syne',sans-serif; font-weight:800; font-size:1rem; color:#1c1714; margin-bottom:2px;">real rewards</div>
      <svg width="78" height="50" viewBox="0 0 78 50" fill="none"><path d="M4 6 C 30 0 56 14 70 38" stroke="#1c1714" stroke-width="2.5" fill="none" stroke-linecap="round"></path><path d="M70 38 l-13 -2 M70 38 l-2 -13" stroke="#1c1714" stroke-width="2.5" fill="none" stroke-linecap="round"></path></svg>
    </div>

    <div style="display:inline-flex; align-items:center; gap:8px; background:#fbf4e6; border:2.5px solid #1c1714; border-radius:100px; padding:8px 18px; font-size:.7rem; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--orange); box-shadow:3px 3px 0 rgba(28,23,20,.13); transform:rotate(-1deg); margin-bottom:30px;">
      <span style="color:var(--orange); font-size:.85rem; line-height:1;">✦</span>
      You Ship, We Ship · YSWS 2026
    </div>

    <div style="font-family:'Syne',sans-serif; font-weight:800; font-size:clamp(5rem,21vw,10rem); letter-spacing:-.03em; line-height:.82; text-shadow:4px 4px 0 rgba(255,69,0,.22), -3px -3px 0 rgba(47,109,176,.16);">
      <span style="color:var(--orange);">Ω</span><span style="color:#1c1714;">mega</span>
    </div>

    <div style="display:flex; align-items:center; justify-content:center; gap:14px; margin:22px 0 16px;">
      <span style="height:2.5px; width:46px; background:#1c1714; border-radius:2px;"></span>
      <span style="font-size:.7rem; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:#1c1714;">Dual Platform · Build &amp; Ship · Real Rewards</span>
      <span style="height:2.5px; width:46px; background:#1c1714; border-radius:2px;"></span>
    </div>

    <h1 style="font-family:'Syne',sans-serif; font-weight:700; font-size:clamp(1.7rem,3.8vw,2.5rem); color:#1c1714; max-width:660px; margin:0 auto 18px; line-height:1.26;">
      Build Android + iOS apps. Get rewarded for <span style="background:linear-gradient(104deg, rgba(255,107,53,0) 0%, rgba(255,107,53,.55) 5%, rgba(255,107,53,.6) 95%, rgba(255,107,53,0) 100%); padding:0 .12em; -webkit-box-decoration-break:clone; box-decoration-break:clone;">both.</span>
    </h1>
    <p style="font-size:1.15rem; color:#5b4f44; max-width:540px; margin:0 auto 30px; line-height:1.72;">Ship apps across two platforms, earn badges, and trade your approved hours in the Omega shop.</p>

    <div style="display:inline-flex; align-items:center; gap:8px; background:#fbf4e6; border:2.5px solid #1c1714; border-radius:100px; padding:12px 26px; font-weight:700; font-size:1rem; color:#1c1714; box-shadow:3px 3px 0 rgba(28,23,20,.13); transform:rotate(.6deg); margin-bottom:34px;">
      <span style="color:var(--orange);">▣</span> Jul 27 – Sep 15, 2026 &nbsp;·&nbsp; ~2 months
    </div>

    <!-- Countdown -->
    <div style="display:flex; justify-content:center; align-items:flex-start; gap:10px; margin-bottom:32px; flex-wrap:wrap;">
      {#each cdUnits as unit, i}
        <div style="background:#fbf4e6; border:2.5px solid #1c1714; border-radius:{unit.radius}; padding:16px 22px; min-width:92px; box-shadow:4px 4px 0 rgba(28,23,20,.13); transform:rotate({unit.rot});">
          <div style="font-family:'Syne',sans-serif; font-size:2.7rem; font-weight:800; color:var(--orange); line-height:1;">{unit.v}</div>
          <div style="font-size:.66rem; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:#5b4f44; margin-top:6px;">{unit.label}</div>
        </div>
        {#if i < cdUnits.length - 1}
          <div style="font-family:'Syne',sans-serif; font-size:2.3rem; color:var(--orange); padding-top:18px;">✦</div>
        {/if}
      {/each}
    </div>

    <div style="display:flex; gap:14px; justify-content:center; flex-wrap:wrap;">
      <a href="#submit" class="btn-primary" style="display:inline-flex; align-items:center; gap:8px; background:var(--orange); color:#fff; border:2.5px solid #1c1714; border-radius:15px 10px 16px 9px/9px 16px 10px 15px; padding:17px 36px; font-weight:700; font-size:1.12rem; text-decoration:none; box-shadow:5px 5px 0 #1c1714;">→ Submit your project</a>
      <a href="#how" class="btn-ghost" style="display:inline-flex; align-items:center; background:#fbf4e6; color:#1c1714; border:2.5px solid #1c1714; border-radius:10px 15px 9px 16px/15px 10px 16px 9px; padding:17px 36px; font-weight:700; font-size:1.12rem; text-decoration:none; box-shadow:5px 5px 0 rgba(28,23,20,.2);">How it works</a>
    </div>
  </div>

  <!-- Ticker -->
  <div style="overflow:hidden; background:var(--orange); border-top:2.5px solid #1c1714; border-bottom:2.5px solid #1c1714; padding:11px 0;" aria-hidden="true">
    <div style="display:inline-flex; gap:26px; white-space:nowrap; animation:omega-scroll 30s linear infinite; will-change:transform;">
      {#each [0, 1] as _}
        <div style="display:inline-flex; gap:26px; padding-left:26px; align-items:center; font-family:'Syne',sans-serif; font-size:.82rem; font-weight:800; letter-spacing:.1em; text-transform:uppercase; color:#1c1714;">
          {#each tickerItems as item, j}
            <span>{item}</span><span style="color:#fff;">{j === 2 ? '+' : '✦'}</span>
          {/each}
        </div>
      {/each}
    </div>
  </div>

  <!-- How it works -->
  <div id="how" style="max-width:760px; margin:0 auto; padding:66px 24px;">
    <div class="eyebrow">✦ How it works</div>
    <h2 class="sec-h">Your launch sequence</h2>
    <svg width="220" height="11" viewBox="0 0 220 11" fill="none" style="display:block; margin-bottom:16px;"><path d="M3 7 Q 28 2 52 6 T 104 6 T 156 6 T 214 5" stroke="var(--orange)" stroke-width="3" fill="none" stroke-linecap="round"></path></svg>
    <p style="font-size:.95rem; color:#5b4f44; margin-bottom:28px; line-height:1.7; max-width:560px;">Build apps on Android and iOS. Reviewers approve your hours, you earn shop currency to spend on what you actually want.</p>

    <div style="display:flex; gap:9px; flex-wrap:wrap; margin-bottom:34px;">
      <span style="display:inline-flex; align-items:center; gap:6px; padding:8px 14px; border:2px solid #1c1714; border-radius:9px 13px 8px 12px/12px 8px 13px 9px; font-weight:700; font-size:.8rem; background:rgba(255,107,53,.14); color:#c2451a; transform:rotate(-1deg);">▲ Android app</span>
      <span style="display:inline-flex; align-items:center; gap:6px; padding:8px 14px; border:2px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; font-weight:700; font-size:.8rem; background:rgba(255,107,53,.14); color:#c2451a; transform:rotate(.8deg);">◉ iOS app</span>
      <span style="display:inline-flex; align-items:center; gap:6px; padding:8px 14px; border:2px solid #1c1714; border-radius:9px 13px 8px 12px/12px 8px 13px 9px; font-weight:700; font-size:.8rem; background:rgba(47,109,176,.13); color:#2f6db0; transform:rotate(-.6deg);">◷ 20+ hrs each</span>
      <span style="display:inline-flex; align-items:center; gap:6px; padding:8px 14px; border:2px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; font-weight:700; font-size:.8rem; background:rgba(47,109,176,.13); color:#2f6db0; transform:rotate(1deg);">❥ Max 2 projects</span>
    </div>

    <div style="display:flex; flex-direction:column;">
      {#each steps as step, i}
        <div style="display:flex; gap:20px; padding:24px 0; {i < steps.length - 1 ? 'border-bottom:2px dashed rgba(28,23,20,.28);' : ''} align-items:flex-start;">
          <div style="flex:none; width:50px; height:50px; display:flex; align-items:center; justify-content:center; font-family:'Syne',sans-serif; font-weight:800; font-size:1.1rem; color:#1c1714; border:2.5px solid #1c1714; border-radius:{step.r}; background:rgba(255,69,0,.16); box-shadow:3px 3px 0 rgba(28,23,20,.13); margin-top:2px;">{step.n}</div>
          <div>
            <div style="font-family:'Syne',sans-serif; font-size:1.05rem; font-weight:800; margin-bottom:5px;">{step.title}</div>
            <div style="font-size:.88rem; color:#5b4f44; line-height:1.65;">{step.body}</div>
            {#if step.cta}
              <a href="#submit" class="step-link" style="display:inline-flex; align-items:center; gap:6px; margin-top:11px; background:var(--orange); color:#fff; border:2px solid #1c1714; border-radius:{step.cta.radius}; padding:7px 14px; font-size:.8rem; font-weight:700; text-decoration:none; box-shadow:3px 3px 0 #1c1714;">{step.cta.label}</a>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- Criteria + Badges -->
  <div class="band">
    <div style="max-width:760px; margin:0 auto;">
      <div class="eyebrow">✦ Judging criteria</div>
      <h2 class="sec-h">What makes a great project?</h2>
      <svg width="200" height="11" viewBox="0 0 200 11" fill="none" style="display:block; margin-bottom:16px;"><path d="M3 7 Q 26 2 50 6 T 100 6 T 150 6 T 196 5" stroke="var(--orange)" stroke-width="3" fill="none" stroke-linecap="round"></path></svg>
      <p style="font-size:.95rem; color:#5b4f44; margin-bottom:30px; line-height:1.7; max-width:560px;">Every submission is scored across five dimensions. Nail them all and you're climbing into Elite tier.</p>

      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:13px;">
        {#each criteria as c}
          <div style="background:#fbf4e6; border:2.5px solid #1c1714; border-radius:{c.r}; padding:18px 16px; box-shadow:4px 4px 0 rgba(28,23,20,.13); transform:rotate({c.rot});">
            <div style="font-family:'Syne',sans-serif; font-size:1.7rem; font-weight:800; color:var(--orange); line-height:1; margin-bottom:8px;">{c.n}</div>
            <div style="font-size:.9rem; font-weight:700; margin-bottom:4px;">{c.title}</div>
            <div style="font-size:.77rem; color:#5b4f44; line-height:1.5;">{c.body}</div>
          </div>
        {/each}
      </div>

      <div style="margin-top:42px;">
        <div style="font-size:.72rem; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:var(--orange); margin-bottom:8px;">✦ Achievement badges</div>
        <p style="font-size:.9rem; color:#5b4f44; line-height:1.65; max-width:560px; margin-bottom:18px;">Hit specific milestones to unlock badges — each one can unlock bonus shop items. One project can earn multiple.</p>
        <div style="display:flex; flex-wrap:wrap; gap:10px;">
          {#each badges as b}
            <span style="display:inline-flex; align-items:center; gap:6px; padding:8px 14px; border:2px solid #1c1714; border-radius:{b.r}; font-size:.8rem; font-weight:700; background:{b.bg}; color:{b.color}; box-shadow:2px 2px 0 rgba(28,23,20,.18); transform:rotate({b.rot});">{b.char} {b.label}</span>
          {/each}
        </div>
      </div>
    </div>
  </div>

  <!-- Shop -->
  <div style="max-width:760px; margin:0 auto; padding:66px 24px;">
    <div class="eyebrow">✦ The shop</div>
    <h2 class="sec-h">Spend your hours on real stuff</h2>
    <svg width="240" height="11" viewBox="0 0 240 11" fill="none" style="display:block; margin-bottom:16px;"><path d="M3 7 Q 30 2 56 6 T 112 6 T 168 6 T 236 5" stroke="var(--orange)" stroke-width="3" fill="none" stroke-linecap="round"></path></svg>
    <p style="font-size:.95rem; color:#5b4f44; margin-bottom:30px; line-height:1.7; max-width:560px;">~$4–6 per approved hour based on your tier. No fixed reward — pick what you actually want from the shop.</p>

    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:15px;">
      <!-- Mobile phones -->
      <div style="position:relative; background:#fbf4e6; border:2.5px solid #1c1714; border-radius:18px 11px 16px 12px/12px 16px 11px 18px; padding:22px 18px; box-shadow:5px 5px 0 rgba(28,23,20,.13); transform:rotate(-.6deg);">
        <div style="position:absolute; top:-11px; left:22px; width:64px; height:22px; background:rgba(255,179,71,.5); border:1px solid rgba(170,110,30,.3); transform:rotate(-4deg); mix-blend-mode:multiply;"></div>
        <div style="width:46px; height:46px; display:flex; align-items:center; justify-content:center; border:2.5px solid #1c1714; border-radius:13px 9px 12px 8px/8px 12px 9px 13px; background:rgba(255,69,0,.14); margin-bottom:14px;"><svg width="24" height="24" viewBox="0 0 26 26" fill="none"><path d="M8.5 3 Q7 3 7 4.6 L7 21 Q7 22.6 8.6 22.6 L17 22.4 Q18.6 22.4 18.5 20.8 L18.4 4.5 Q18.4 3 16.8 3.1 Z" stroke="#1c1714" stroke-width="2" stroke-linejoin="round"></path><line x1="11" y1="19.6" x2="14.6" y2="19.4" stroke="#1c1714" stroke-width="2" stroke-linecap="round"></line></svg></div>
        <div style="font-family:'Syne',sans-serif; font-size:1rem; font-weight:800; margin-bottom:5px;">Mobile phones</div>
        <div style="font-size:.8rem; color:#5b4f44; line-height:1.5;">Android or iOS devices from the catalog to test your apps on real hardware.</div>
        <span style="display:inline-block; margin-top:11px; font-size:.62rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; padding:4px 10px; border:1.5px solid #1c1714; border-radius:6px; background:rgba(255,69,0,.12); color:#c2451a;">hardware</span>
      </div>
      <!-- Play Store license -->
      <div style="background:#fbf4e6; border:2.5px solid #1c1714; border-radius:11px 18px 12px 16px/16px 12px 18px 11px; padding:22px 18px; box-shadow:5px 5px 0 rgba(28,23,20,.13); transform:rotate(.7deg);">
        <div style="width:46px; height:46px; display:flex; align-items:center; justify-content:center; border:2.5px solid #1c1714; border-radius:9px 13px 8px 12px/12px 8px 13px 9px; background:rgba(74,150,80,.16); margin-bottom:14px;"><svg width="24" height="24" viewBox="0 0 26 26" fill="none"><path d="M7.5 4 Q7 4 7.2 4.8 L7 20.5 Q7 21.4 7.9 20.9 L20 13.2 Q20.8 12.7 20 12.1 Z" stroke="#1c1714" stroke-width="2" stroke-linejoin="round"></path></svg></div>
        <div style="font-family:'Syne',sans-serif; font-size:1rem; font-weight:800; margin-bottom:5px;">Play Store license</div>
        <div style="font-size:.8rem; color:#5b4f44; line-height:1.5;">$25 Google Play Developer account grant — publish your Android app.</div>
        <span style="display:inline-block; margin-top:11px; font-size:.62rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; padding:4px 10px; border:1.5px solid #1c1714; border-radius:6px; background:rgba(74,150,80,.14); color:#3d7a40;">dev account</span>
      </div>
      <!-- iOS dev license -->
      <div style="background:#fbf4e6; border:2.5px solid #1c1714; border-radius:16px 12px 18px 11px/11px 18px 12px 16px; padding:22px 18px; box-shadow:5px 5px 0 rgba(28,23,20,.13); transform:rotate(-.5deg);">
        <div style="width:46px; height:46px; display:flex; align-items:center; justify-content:center; border:2.5px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; background:rgba(28,23,20,.08); margin-bottom:14px;"><svg width="24" height="24" viewBox="0 0 26 26" fill="none"><path d="M13 9.2 C9.5 6.5 4.3 8.2 4.8 13.6 C5.2 19 9 22.3 13 20.8 C17 22.3 20.8 19 21.2 13.6 C21.7 8.2 16.5 6.5 13 9.2 Z" stroke="#1c1714" stroke-width="2" stroke-linejoin="round"></path><path d="M13.2 9 C13 6.3 14.6 4.3 17 3.6" stroke="#1c1714" stroke-width="2" stroke-linecap="round"></path></svg></div>
        <div style="font-family:'Syne',sans-serif; font-size:1rem; font-weight:800; margin-bottom:5px;">iOS dev license</div>
        <div style="font-size:.8rem; color:#5b4f44; line-height:1.5;">$100 Apple Developer Membership — land your app on the App Store.</div>
        <span style="display:inline-block; margin-top:11px; font-size:.62rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; padding:4px 10px; border:1.5px solid #1c1714; border-radius:6px; background:rgba(255,69,0,.12); color:#c2451a;">dev account</span>
      </div>
      <!-- Dev gear -->
      <div style="position:relative; background:#fbf4e6; border:2.5px solid #1c1714; border-radius:12px 16px 11px 18px/18px 11px 16px 12px; padding:22px 18px; box-shadow:5px 5px 0 rgba(28,23,20,.13); transform:rotate(.9deg);">
        <div style="width:46px; height:46px; display:flex; align-items:center; justify-content:center; border:2.5px solid #1c1714; border-radius:8px 12px 9px 13px/13px 9px 12px 8px; background:rgba(255,179,71,.2); margin-bottom:14px;"><svg width="24" height="24" viewBox="0 0 26 26" fill="none"><path d="M13 8.5 Q9 8.5 8.6 12.6 Q8.4 16.8 13 17 Q17.4 16.8 17.2 12.6 Q16.8 8.5 13 8.5 Z" stroke="#1c1714" stroke-width="2" stroke-linejoin="round"></path><path d="M13 3.4 L13 5.8 M13 20.2 L13 22.6 M3.6 13 L6 12.9 M20 13 L22.4 12.9 M6.2 6.2 L8 8 M18 18 L19.8 19.8 M19.8 6.2 L18 8 M8 18 L6.2 19.8" stroke="#1c1714" stroke-width="2" stroke-linecap="round"></path></svg></div>
        <div style="font-family:'Syne',sans-serif; font-size:1rem; font-weight:800; margin-bottom:5px;">Dev gear</div>
        <div style="font-size:.8rem; color:#5b4f44; line-height:1.5;">Software, accessories, and productivity tools for serious builders.</div>
        <span style="display:inline-block; margin-top:11px; font-size:.62rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; padding:4px 10px; border:1.5px solid #1c1714; border-radius:6px; background:rgba(255,179,71,.18); color:#b07410;">tools</span>
      </div>
    </div>
  </div>

  <!-- Tiers + Rules + FAQ -->
  <div class="band">
    <div style="max-width:760px; margin:0 auto;">
      <div class="eyebrow">✦ Tier system</div>
      <h2 class="sec-h">Go harder. Earn more.</h2>
      <svg width="180" height="11" viewBox="0 0 180 11" fill="none" style="display:block; margin-bottom:16px;"><path d="M3 7 Q 24 2 46 6 T 92 6 T 138 6 T 176 5" stroke="var(--orange)" stroke-width="3" fill="none" stroke-linecap="round"></path></svg>
      <p style="font-size:.95rem; color:#5b4f44; margin-bottom:28px; line-height:1.7; max-width:560px;">Your tier is set by app complexity. Higher tier = bigger multiplier. Elite is intentionally rare — only the sharpest builds reach it.</p>

      <div style="display:flex; flex-direction:column; gap:12px;">
        {#each tiers as t}
          <div style="display:flex; align-items:center; gap:18px; background:{t.bg}; border:2.5px solid #1c1714; border-radius:{t.cardR}; padding:20px 22px; box-shadow:{t.shadow}; transform:rotate({t.rot});">
            <div style="flex:none; width:48px; height:48px; display:flex; align-items:center; justify-content:center; border:2.5px solid #1c1714; border-radius:{t.iconR}; background:{t.iconBg}; font-size:1.2rem;">{t.icon}</div>
            <div style="flex:1;">
              <div style="font-family:'Syne',sans-serif; font-size:1.1rem; font-weight:800; color:{t.nameColor};">{t.name}</div>
              <div style="font-size:.8rem; color:{t.descColor}; margin-top:2px;">{t.desc}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-family:'Syne',sans-serif; font-size:1.7rem; font-weight:800; color:{t.multColor}; line-height:1;">{t.mult}</div>
              <div style="font-size:.72rem; color:{t.rateColor}; font-weight:600; margin-top:3px;">{t.rate}</div>
            </div>
          </div>
        {/each}
      </div>

      <!-- Rules -->
      <div style="margin-top:50px;">
        <div style="font-size:.72rem; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:var(--orange); margin-bottom:8px;">✦ Ground rules</div>
        <h3 class="sub-h">Mission parameters</h3>
        <div>
          {#each rules as rule}
            <div style="display:flex; gap:14px; align-items:flex-start; padding:17px 0; {rule.last ? '' : 'border-bottom:2px dashed rgba(28,23,20,.28);'} font-size:.9rem; color:#5b4f44; line-height:1.6;">
              <span style="flex:none; color:var(--orange); margin-top:1px;">◆</span>
              <div><strong style="color:#1c1714;">{rule.lead}</strong>{rule.rest}</div>
            </div>
          {/each}
        </div>
      </div>

      <!-- FAQ -->
      <div style="margin-top:50px;">
        <div style="font-size:.72rem; font-weight:700; letter-spacing:.18em; text-transform:uppercase; color:var(--orange); margin-bottom:8px;">✦ FAQ</div>
        <h3 class="sub-h">Got questions?</h3>
        <div>
          {#each faqs as faq}
            <div style="padding:19px 0; border-bottom:2px dashed rgba(28,23,20,.28);">
              <div style="font-family:'Syne',sans-serif; font-size:.98rem; font-weight:700; margin-bottom:7px;">{faq.q}</div>
              <div style="font-size:.88rem; color:#5b4f44; line-height:1.68;">{faq.a}</div>
            </div>
          {/each}
          <div style="padding:19px 0;">
            <div style="font-family:'Syne',sans-serif; font-size:.98rem; font-weight:700; margin-bottom:7px;">I need help!</div>
            <div style="font-size:.88rem; color:#5b4f44; line-height:1.68;">Jump into <a href="https://hackclub.com/slack" target="_blank" rel="noopener" style="color:var(--orange); font-weight:600; text-decoration:underline; text-decoration-style:wavy; text-underline-offset:3px;">#omega on Hack Club Slack</a> — we're always there.</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- CTA -->
  <div id="submit" style="background:var(--orange); border-bottom:2.5px solid #1c1714; text-align:center; padding:72px 24px; position:relative;">
    <h2 style="font-family:'Syne',sans-serif; font-weight:800; font-size:clamp(2.2rem,8vw,4rem); letter-spacing:-.02em; color:#fff; margin:0 0 8px; line-height:1; text-shadow:4px 4px 0 #1c1714;">Ready to ship?</h2>
    <p style="font-size:.95rem; font-weight:600; color:rgba(255,255,255,.9); margin-bottom:28px;">Android + iOS. Badges. Real rewards. Launches July 27.</p>

    {#if signedUp}
      <div style="display:inline-flex; align-items:center; gap:10px; background:#fbf4e6; border:2.5px solid #1c1714; border-radius:14px 9px 15px 10px/10px 15px 9px 14px; padding:14px 24px; font-family:'Syne',sans-serif; font-weight:800; font-size:1rem; color:#1c1714; box-shadow:4px 4px 0 #1c1714;">✦ You're on the list — see you July 27!</div>
    {:else}
      <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap; max-width:440px; margin:0 auto;">
        <input
          type="email"
          bind:value={email}
          onkeydown={(e) => e.key === 'Enter' && signup()}
          placeholder="your@email.com"
          aria-label="Email address"
          style="flex:1; min-width:200px; padding:14px 16px; border:2.5px solid #1c1714; border-radius:12px 8px 13px 9px/9px 13px 8px 12px; font-family:'Space Grotesk',sans-serif; font-size:.92rem; background:#fbf4e6; color:#1c1714; outline:none; box-shadow:4px 4px 0 {invalid ? '#b3261e' : '#1c1714'};"
        />
        <button
          onclick={signup}
          class="signup-btn"
          style="background:#1c1714; color:#fff; border:2.5px solid #1c1714; border-radius:9px 13px 8px 12px/12px 8px 13px 9px; padding:14px 24px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:.92rem; cursor:pointer; box-shadow:4px 4px 0 rgba(28,23,20,.35);"
        >Sign up →</button>
      </div>
    {/if}

    <div style="margin-top:16px;">
      <a href="https://hackclub.com/slack" target="_blank" rel="noopener" style="display:inline-flex; align-items:center; gap:6px; color:rgba(255,255,255,.9); font-size:.85rem; font-weight:700; text-decoration:none;">Join Slack · <span style="color:#fff; text-decoration:underline; text-decoration-style:wavy; text-underline-offset:3px;">#omega</span></a>
    </div>
  </div>

  <!-- Footer -->
  <div style="background:#e3d4b8; padding:48px 24px; text-align:center;">
    <div style="max-width:720px; margin:0 auto;">
      <div style="font-family:'Syne',sans-serif; font-size:1.1rem; font-weight:800; margin-bottom:10px;">A Hack Club project</div>
      <p style="font-size:.84rem; line-height:1.7; max-width:480px; margin:0 auto 22px; color:#5b4f44;">Hack Club is a 501(c)(3) nonprofit supporting 20k+ technical high schoolers. You Ship, We Ship — build something real, get something real back.</p>
      <div style="display:flex; gap:18px; justify-content:center; flex-wrap:wrap; margin-bottom:18px;">
        {#each footerLinks as link}
          <a href={link.href} target="_blank" rel="noopener" class="footer-link" style="color:#5b4f44; font-size:.8rem; font-weight:600; text-decoration:none;">{link.label}</a>
        {/each}
      </div>
      <div style="font-size:.72rem; color:#9c8a6e;">© 2026 Hack Club · 501(c)(3) nonprofit · EIN: 81-2908499</div>
    </div>
  </div>
</div>

<style>
  .omega {
    position: relative;
    min-height: 100vh;
    background: #f4ead5;
    color: #1c1714;
    font-family: 'Space Grotesk', sans-serif;
    line-height: 1.5;
    overflow-x: hidden;
  }

  .grain {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 60;
    mix-blend-mode: multiply;
    opacity: 0.09;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 220px 220px;
  }

  .halftone {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 59;
    mix-blend-mode: multiply;
    opacity: 0.13;
    background-image: radial-gradient(rgba(28, 23, 20, 0.85) 22%, transparent 24%);
    background-size: 6px 6px;
    background-position: 0 0;
  }

  .eyebrow {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--orange);
    margin-bottom: 10px;
  }

  .sec-h {
    font-family: 'Syne', sans-serif;
    font-weight: 800;
    font-size: clamp(2rem, 6vw, 2.9rem);
    letter-spacing: -0.02em;
    line-height: 1.02;
    margin: 0 0 2px;
    text-shadow: 3px 3px 0 rgba(255, 69, 0, 0.16);
  }

  .sub-h {
    font-family: 'Syne', sans-serif;
    font-weight: 800;
    font-size: clamp(1.5rem, 4vw, 2.1rem);
    letter-spacing: -0.02em;
    margin: 0 0 14px;
  }

  .band {
    background: #ece0c8;
    border-top: 2.5px solid #1c1714;
    border-bottom: 2.5px solid #1c1714;
    padding: 66px 24px;
  }

  @keyframes omega-scroll {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(-50%);
    }
  }

  @media (max-width: 980px) {
    .hero-deco {
      display: none !important;
    }
  }

  /* hover states (from the original inline style-hover hints) */
  .btn-primary,
  .btn-ghost {
    transition: transform 0.1s, box-shadow 0.1s;
  }
  .btn-primary:hover {
    transform: translate(-2px, -2px);
    box-shadow: 7px 7px 0 #1c1714;
  }
  .btn-ghost:hover {
    transform: translate(-2px, -2px);
    box-shadow: 7px 7px 0 rgba(28, 23, 20, 0.2);
  }
  .step-link,
  .signup-btn {
    transition: transform 0.1s;
  }
  .step-link:hover,
  .signup-btn:hover {
    transform: translate(-1px, -1px);
  }
  .footer-link:hover {
    color: var(--orange);
  }
</style>
