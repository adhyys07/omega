import 'dotenv/config';
import {
    approvePitch, createPitch, createSubmission, getPitchById, getSlackIdForSub,
    getSubmissionById, listAuthUsers, requestSubmissionChanges, setPitchSlackRef,
    setSubmissionSlackRef, wipeSeeded,
} from './db.ts';
import {
    notifySlackOfNewReview, postBuilderControls, postInThread, updateReviewCard,
} from './slack.ts';
import type { HcUser } from './auth.ts';

/** Fills the review queue with realistic test data and gives each project a real
 *  Slack card + thread, so the panel and the Slack side can be exercised together.
 *
 *  It walks the same path a real builder does — createPitch → approvePitch →
 *  createSubmission → notifySlackOfNewReview → setSubmissionSlackRef →
 *  postBuilderControls — rather than writing a finished row straight into Airtable.
 *  A seeded row that skipped the flow would test a platform nobody uses.
 *
 *  Every row is marked `seeded: true`, so wipeSeeded(sub) — and --wipe here —
 *  can take them all back out again. */

const SEEDER = 'Seed Script';
const AIRTABLE_GAP = 250;   // Airtable caps us at 5 req/sec
const SLACK_GAP = 1200;     // chat.postMessage is roughly 1/sec per channel

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Fixture = {
    pitch: { title: string; description: string; why: string };
    /** Absent for pitch-only fixtures — those sit in the pitch queue awaiting review. */
    project?: {
        title: string; code_url: string; playable_url: string; description: string;
        ai_used: boolean; ai_disclosure?: string; demo_video_url?: string;
        screenshot_url?: string; hackatime_project?: string;
        hackatime_hours?: number; hackatime_start_date?: string;
    };
    /** Where the submission should end up once its card has been posted. */
    state?: 'pending' | 'changes_requested';
    feedback?: string;
    /** Seeded thread chatter, posted as the bot when --replies is passed. */
    replies?: string[];
};

const FIXTURES: Fixture[] = [
    {
        pitch: {
            title: '[seed] Pocket Tide Clock',
            description: 'A widget that shows the next high and low tide for whatever beach you are standing on, using device GPS and NOAA station data. No account, no ads, opens in under a second.',
            why: 'Surfers and tidepoolers check tide charts constantly, and every existing app buries the one number they want under a login wall and three interstitials.',
        },
        project: {
            title: '[seed] Pocket Tide Clock',
            code_url: 'https://github.com/hackclub/site',
            playable_url: 'https://hackclub.com',
            description: 'Shipped the tide widget: GPS lookup, nearest NOAA station, the next four tide events, and an offline cache so it still works with no signal at the beach.',
            ai_used: true,
            ai_disclosure: 'Used Claude to debug Room database migrations and to generate the settings-screen boilerplate. Wrote the NOAA station matching and the offline cache myself.',
            hackatime_project: 'pocket-tide-clock',
            hackatime_hours: 41,
            hackatime_start_date: '2026-07-02',
        },
        state: 'pending',
        replies: [
            'Station matching looks solid. How does it behave when the nearest NOAA station is offline?',
            'Falls back to the next closest station within 40km and shows a staleness note on the reading.',
        ],
    },
    {
        pitch: {
            title: '[seed] Split the Bill, Offline',
            description: 'A bill splitter that works with no signal — scan the receipt, drag items onto people, and it settles who owes what with the fewest possible transfers.',
            why: 'Group dinners are where the signal is worst and the maths is most contested. Everything else in this space needs a server round-trip per tap.',
        },
        project: {
            title: '[seed] Split the Bill, Offline',
            code_url: 'https://github.com/hackclub/hackclub',
            playable_url: 'https://hackclub.com/slack',
            description: 'On-device OCR over the receipt, drag-to-assign line items, and a settle-up solver that minimises the number of transfers. The entire flow works in airplane mode.',
            ai_used: false,
            demo_video_url: 'https://hc-cdn.hel1.your-objectstorage.com/s/v3/seed-demo.mp4',
            hackatime_project: 'split-offline',
            hackatime_hours: 33,
            hackatime_start_date: '2026-07-14',
        },
        state: 'pending',
        replies: ['Is the OCR model bundled, or downloaded on first run?'],
    },
    {
        pitch: {
            title: '[seed] Kiln Log',
            description: 'A firing log for pottery studios: record each kiln run, its ramp schedule, and what came out, then compare firings that used the same glaze.',
            why: 'Community studios track firings on a clipboard that gets lost, so nobody can tell you why a glaze went right two months ago.',
        },
        project: {
            title: '[seed] Kiln Log',
            code_url: 'https://github.com/hackclub/dashboard',
            playable_url: 'https://hackclub.com/clubs',
            description: 'Logs firings with ramp schedules and photos, and diffs two runs of the same glaze side by side. Studio members share one log through a join code.',
            ai_used: true,
            ai_disclosure: 'Claude helped me design the schema for ramp segments. All the UI and the diff view are mine.',
            hackatime_project: 'kiln-log',
            hackatime_hours: 27,
            hackatime_start_date: '2026-08-01',
        },
        state: 'changes_requested',
        feedback: 'Great writeup — but the playable link 404s for anyone outside your studio. Add a demo join code or a read-only sample log we can open, then reship.',
        replies: ['Heads up: the join code in the README has expired.'],
    },
    {
        pitch: {
            title: '[seed] Transit Departure Board',
            description: 'A physical departure board for your own bus stop, driven by an ESP32 and an e-ink panel.',
            why: 'The stop by my house has no display, so you either leave early or miss it. This puts the next three departures on the wall by the door.',
        },
        project: {
            title: '[seed] Transit Departure Board',
            code_url: 'https://github.com/hackclub/OnBoard',
            playable_url: 'https://hackclub.com/onboard',
            description: 'ESP32 driving a 4.2 inch e-ink panel, pulling GTFS-realtime for the two stops I use. Custom PCB, 3D printed case, runs about six weeks on a battery.',
            ai_used: false,
            hackatime_project: 'departure-board',
            hackatime_hours: 52,
            hackatime_start_date: '2026-06-18',
        },
        state: 'pending',
    },
    // Pitch-only fixtures: these stay pending so the pitch queue is not empty either.
    {
        pitch: {
            title: '[seed] Darkroom Timer',
            description: 'A phone timer for film developing that speaks each step out loud, so you never have to open your eyes in the dark.',
            why: 'Every darkroom timer app is a bright white screen, which is the one thing a darkroom cannot have.',
        },
    },
    {
        pitch: {
            title: '[seed] Practice Room Queue',
            description: 'A shared queue for the three practice rooms in our music building, so people stop taping notes to the door.',
            why: 'The current system is a paper sign-up sheet that someone removes every Friday.',
        },
    },
];

// --- args -------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const val = (name: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3).trim();

if (flag('help')) {
    console.log(`Seed the review queue with test pitches, projects and Slack threads.

Usage:
  npm run seed:review -- --list-users
  npm run seed:review -- --email=you@example.com --dry-run
  npm run seed:review -- --email=you@example.com
  npm run seed:review -- --email=you@example.com --replies
  npm run seed:review -- --email=you@example.com --wipe

Target (one required):
  --email=<email>     Owner of the seeded rows, looked up in auth_users
  --user=<sub>        Owner by OIDC sub, if you already know it

Options:
  --count=<n>         Only seed the first n fixtures (default: all ${FIXTURES.length})
  --wipe              Delete this user's existing seeded rows first
  --no-slack          Airtable rows only; post nothing to Slack
  --pitch-cards       Also post Slack cards for pitches (the real flow does not)
  --replies           Post the fixture thread replies as the bot
  --dry-run           Print the plan and exit without writing anything
  --list-users        Print candidate auth_users and exit

Cleanup afterwards:
  npm run seed:review -- --email=you@example.com --wipe --count=0
`);
    process.exit(0);
}

if (flag('list-users')) {
    const all = await listAuthUsers();
    console.table(all.slice(0, 25).map((u) => ({
        sub: u.sub, email: u.email, name: u.name, slack_id: u.slack_id, role: u.role,
    })));
    process.exit(0);
}

const email = val('email');
const userArg = val('user');
if (!email && !userArg) {
    console.error('Pass --email=<email> or --user=<sub>. Run with --help for details.');
    process.exit(1);
}

const countArg = val('count');
const count = countArg === undefined ? FIXTURES.length : Number(countArg);
if (!Number.isInteger(count) || count < 0 || count > FIXTURES.length) {
    console.error(`--count must be a whole number between 0 and ${FIXTURES.length}`);
    process.exit(1);
}

const dryRun = flag('dry-run');
const useSlack = !flag('no-slack');
const wantPitchCards = flag('pitch-cards');
const wantReplies = flag('replies');

// --- resolve the owner ------------------------------------------------------

const users = await listAuthUsers();
const owner = email
    ? users.find((u) => String(u.email ?? '').toLowerCase() === email.toLowerCase())
    : users.find((u) => String(u.sub) === userArg);

if (!owner) {
    console.error(`No auth_users row for ${email ?? userArg}. Sign in once, or run --list-users.`);
    process.exit(1);
}

const sub = String(owner.sub);
const slackId = (await getSlackIdForSub(sub)) ?? (owner.slack_id ? String(owner.slack_id) : null);

/** notifySlackOfNewReview wants the session user; rebuild one from the stored profile. */
const asUser: HcUser = {
    sub,
    name: owner.name ? String(owner.name) : undefined,
    email: owner.email ? String(owner.email) : undefined,
    slack_id: slackId ?? undefined,
    slack_username: owner.slack_username ? String(owner.slack_username) : undefined,
};

const slackReady = !!process.env.SLACK_BOT_TOKEN && !!process.env.SLACK_REVIEW_CHANNEL;
const chosen = FIXTURES.slice(0, count);

console.log(`Owner        ${owner.name ?? '—'} <${owner.email ?? '—'}>`);
console.log(`  sub        ${sub}`);
console.log(`  slack_id   ${slackId ?? '— (no builder thread controls will be posted)'}`);
console.log(`Fixtures     ${chosen.length} (${chosen.filter((f) => f.project).length} with a project)`);
console.log(`Slack        ${!useSlack ? 'skipped (--no-slack)'
    : slackReady ? `channel ${process.env.SLACK_REVIEW_CHANNEL}` : 'not configured — cards will be skipped'}`);
console.log(`Replies      ${wantReplies ? 'yes (--replies)' : 'no'}`);
console.log(`Pitch cards  ${wantPitchCards ? 'yes (--pitch-cards)' : 'no — matches the real flow'}`);

if (flag('wipe')) {
    if (dryRun) {
        console.log('\n[dry run] would wipe this user\'s existing seeded rows');
    } else {
        const wiped = await wipeSeeded(sub);
        console.log(`\nWiped seeded rows: ${wiped.pitches} pitches, ${wiped.submissions} submissions`);
    }
}

if (dryRun) {
    console.log('\n[dry run] would create:');
    for (const f of chosen) {
        console.log(`  pitch    ${f.pitch.title}${f.project ? ' (approved)' : ' (left pending)'}`);
        if (f.project) console.log(`  ↳ project ${f.project.title} → ${f.state ?? 'pending'}`);
    }
    console.log('\nNothing was written.');
    process.exit(0);
}

// --- seed -------------------------------------------------------------------

/** Best-effort: Slack being down or misconfigured must never lose the Airtable row. */
async function trySlack<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
    try {
        return await fn();
    } catch (err) {
        console.warn(`   ! ${what}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
}

const made: { pitch: string; submission?: string; ts?: string }[] = [];

for (const f of chosen) {
    console.log(`\n> ${f.pitch.title}`);

    const pitch = await createPitch({ ...f.pitch, user_sub: sub, seeded: true });
    const pitchId = String(pitch.id);
    console.log(`   pitch    ${pitchId}`);
    await sleep(AIRTABLE_GAP);

    // A pitch with no project stays pending — that is the pitch review queue.
    if (!f.project) {
        if (useSlack && slackReady && wantPitchCards) {
            const pref = await trySlack('pitch card', () => notifySlackOfNewReview('pitch', asUser, pitch));
            if (pref) {
                await setPitchSlackRef(pitchId, pref.channel, pref.ts);
                console.log(`   card     ${pref.ts}`);
                if (slackId) {
                    const row = await getPitchById(pitchId);
                    if (row) {
                        await trySlack('builder controls', () => postBuilderControls(
                            'pitch',
                            { ...row, slack_channel: pref.channel, slack_ts: pref.ts },
                            'pending',
                            slackId,
                        ));
                    }
                }
                await sleep(SLACK_GAP);
            }
        }
        made.push({ pitch: pitchId });
        continue;
    }

    // Every project needs an approved pitch — the submission gate demands one.
    await approvePitch(pitchId, SEEDER);
    await sleep(AIRTABLE_GAP);

    const submission = await createSubmission({
        ...f.project, pitch_id: pitchId, user_sub: sub, seeded: true,
    });
    const subId = String(submission.id);
    console.log(`   project  ${subId}`);
    await sleep(AIRTABLE_GAP);

    let ref: { channel: string; ts: string } | null = null;
    if (useSlack && slackReady) {
        ref = await trySlack('review card', () => notifySlackOfNewReview('project', asUser, submission));
        if (ref) {
            await setSubmissionSlackRef(subId, ref.channel, ref.ts);
            console.log(`   card     ${ref.ts}`);
            await sleep(SLACK_GAP);
        }
    }

    // The send-back happens after the card exists, so the card gets rewritten in
    // place exactly the way a reviewer's send-back rewrites it.
    const state = f.state ?? 'pending';
    if (state === 'changes_requested') {
        await requestSubmissionChanges(subId, SEEDER, f.feedback ?? 'Please add a demo link we can open.');
        await sleep(AIRTABLE_GAP);
        if (ref) {
            const fresh = await getSubmissionById(subId);
            if (fresh) {
                await trySlack('card update', () => updateReviewCard(
                    'project', ref!.channel, ref!.ts, fresh, 'changes_requested',
                ));
            }
            await sleep(SLACK_GAP);
        }
        console.log('   state    changes_requested');
    }

    if (ref && slackId) {
        const fresh = await getSubmissionById(subId);
        if (fresh) {
            await trySlack('builder controls', () => postBuilderControls(
                'project',
                { ...fresh, slack_channel: ref!.channel, slack_ts: ref!.ts },
                state,
                slackId,
            ));
        }
        await sleep(SLACK_GAP);
    }

    if (ref && wantReplies && f.replies?.length) {
        for (const text of f.replies) {
            await trySlack('thread reply', () => postInThread(ref!.channel, ref!.ts, text));
            await sleep(SLACK_GAP);
        }
        console.log(`   replies  ${f.replies.length}`);
    }

    made.push({ pitch: pitchId, submission: subId, ts: ref?.ts });
}

console.log(`\nSeeded ${made.length} fixtures for ${owner.email ?? sub}`);
console.log(`   Review panel: ${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/admin/review`);
console.log(`   Undo:         npm run seed:review -- --user=${sub} --wipe --count=0`);
