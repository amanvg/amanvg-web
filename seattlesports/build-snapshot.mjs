#!/usr/bin/env node
//
// Builds the Seattle Sports data snapshot.
//
// site.api.espn.com stopped sending Access-Control-Allow-Origin, so the browser
// can't call it directly, and proxying through a Cloudflare Worker now gets a 403
// from ESPN's edge. This script does the fetching server-side (in CI, where CORS
// is irrelevant) and writes a JSON file that ships with the site, so the page
// reads its slow-moving data same-origin. Live scores are fetched by the browser
// straight from cdn.espn.com, which still sends CORS headers.
//
// Output: seattlesports/data/snapshot.json

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const ESPN_V2 = 'https://site.api.espn.com/apis/v2/sports';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'data', 'snapshot.json');

const TEAMS = [
    { name: 'Seahawks', sport: 'football', league: 'nfl',   divisionTeams: ['SEA', 'SF', 'LAR', 'ARI'] },
    { name: 'Mariners', sport: 'baseball', league: 'mlb',   divisionTeams: ['SEA', 'HOU', 'TEX', 'LAA', 'OAK', 'ATH'] },
    { name: 'Kraken',   sport: 'hockey',   league: 'nhl',   divisionTeams: ['SEA', 'VAN', 'CGY', 'EDM', 'LA', 'ANA', 'SJ', 'VGK'] },
    { name: 'Sounders', sport: 'soccer',   league: 'usa.1', divisionTeams: null }, // full conference
];

const SEASON_PHASES = {
    1: { label: 'Pre-Season',     cls: 'phase-pre' },
    2: { label: 'Regular Season', cls: 'phase-regular' },
    3: { label: 'Playoffs',       cls: 'phase-post' },
    4: { label: 'Offseason',      cls: 'phase-off' },
};

// MLS doesn't use the 1-4 season-type ids (it reports type 13846), so the id
// lookup misses and the badge would read "Offseason" mid-season. The feed still
// names the phase, so fall back to that.
const PHASE_CLS = [
    [/pre.?season/i,             'phase-pre'],
    [/regular/i,                 'phase-regular'],
    [/playoff|post.?season|cup/i,'phase-post'],
    [/off.?season/i,             'phase-off'],
];

function resolveSeasonPhase(data) {
    const season = data.season ?? data.requestedSeason ?? null;
    const byId = SEASON_PHASES[season?.type];
    if (byId) return byId;

    const name = season?.name;
    if (name) {
        const hit = PHASE_CLS.find(([re]) => re.test(name));
        return { label: name, cls: hit ? hit[1] : 'phase-regular' };
    }
    return { label: 'Offseason', cls: 'phase-off' };
}

const STANDINGS_SORT = {
    nfl:     { stat: 'winPercent', desc: true },
    mlb:     { stat: 'winPercent', desc: true },
    nhl:     { stat: 'points',     desc: true },
    'usa.1': { stat: 'points',     desc: true },
};

async function getJSON(url) {
    const res = await fetch(url, {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'amanvg-web seattlesports snapshot (+https://github.com/amanvg)',
        },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
    return res.json();
}

// ── Trimming ────────────────────────────────────────────────
// The page only reads a handful of fields per event. Storing the raw ESPN
// payloads would bloat the committed snapshot (and its diffs) for no gain.

function trimCompetitor(c) {
    return {
        homeAway: c.homeAway,
        winner: c.winner,
        score: typeof c.score === 'object' ? (c.score?.displayValue ?? c.score?.value ?? null) : c.score,
        team: {
            id: c.team?.id,
            abbreviation: c.team?.abbreviation,
            shortDisplayName: c.team?.shortDisplayName,
            logo: c.team?.logos?.[0]?.href || c.team?.logo || '',
        },
    };
}

function trimEvent(ev) {
    const comp = ev?.competitions?.[0];
    if (!comp) return null;
    const broadcast = comp.broadcasts?.[0]?.names?.[0];
    return {
        date: ev.date,
        competitions: [{
            status: {
                type: {
                    state: comp.status?.type?.state,
                    shortDetail: comp.status?.type?.shortDetail,
                    description: comp.status?.type?.description,
                },
            },
            competitors: (comp.competitors || []).map(trimCompetitor),
            broadcasts: broadcast ? [{ names: [broadcast] }] : [],
        }],
    };
}

// ESPN returns ~38 stats per standings entry; the page reads these. Keeping the
// rest would quadruple the snapshot and make every cron commit a noisy diff.
const STAT_KEEP = new Set([
    'wins', 'losses', 'ties', 'draws', 'winPercent', 'gamesBehind', 'otLosses', 'points',
    'W', 'L', 'T', 'D', 'PCT', 'GB', 'OTL', 'PTS',
]);

function trimEntry(e) {
    return {
        team: {
            id: e.team?.id,
            abbreviation: e.team?.abbreviation,
            displayName: e.team?.displayName,
        },
        stats: (e.stats || [])
            .filter(s => STAT_KEEP.has(s.name) || STAT_KEEP.has(s.abbreviation))
            .map(s => ({
                name: s.name,
                abbreviation: s.abbreviation,
                displayValue: s.displayValue ?? (s.value != null ? String(s.value) : null),
            })),
    };
}

function stat(entry, name) {
    const s = entry?.stats?.find(s => s.name === name || s.abbreviation === name);
    return s ? s.displayValue : null;
}

// ── Fetching ────────────────────────────────────────────────

async function lookupTeam(team) {
    const data = await getJSON(`${ESPN}/${team.sport}/${team.league}/teams`);
    const all = data.sports[0].leagues[0].teams;
    const match = all.find(t =>
        t.team.location?.toLowerCase() === 'seattle'
        || t.team.displayName?.toLowerCase().includes('seattle')
    );
    if (!match) throw new Error(`no Seattle team in ${team.league} feed`);
    return {
        id: match.team.id,
        logo: match.team.logos?.[0]?.href ?? null,
        abbreviation: match.team.abbreviation,
        displayName: match.team.displayName,
    };
}

async function fetchSchedule(team, id) {
    const data = await getJSON(`${ESPN}/${team.sport}/${team.league}/teams/${id}/schedule`);
    const events = data.events || [];

    const seasonPhase = resolveSeasonPhase(data);

    let lastGame = null, liveGame = null, nextGame = null;
    for (const ev of events) {
        const state = ev.competitions?.[0]?.status?.type?.state;
        if (state === 'post') {
            // Always keep the most-recent completed game (leagues vary in sort order)
            if (!lastGame || new Date(ev.date) > new Date(lastGame.date)) lastGame = ev;
        } else if (state === 'in') {
            liveGame = ev;
        } else if (state === 'pre') {
            // Always keep the earliest upcoming game
            if (!nextGame || new Date(ev.date) < new Date(nextGame.date)) nextGame = ev;
        }
    }

    // Some leagues (e.g. MLS) don't include future games in the team schedule
    // endpoint. Fall back to the scoreboard to find the next upcoming game.
    if (!nextGame) {
        const today = new Date();
        const future = new Date(today);
        future.setDate(today.getDate() + 21);
        const fmt = d => d.toISOString().slice(0, 10).replace(/-/g, '');
        try {
            const sb = await getJSON(`${ESPN}/${team.sport}/${team.league}/scoreboard?dates=${fmt(today)}-${fmt(future)}&limit=100`);
            for (const ev of sb.events || []) {
                const comp = ev.competitions?.[0];
                if (comp?.competitors?.some(c => String(c.team?.id) === String(id))) {
                    nextGame = ev;
                    break;
                }
            }
        } catch { /* non-critical */ }
    }

    return {
        seasonPhase,
        lastGame: lastGame && trimEvent(lastGame),
        liveGame: liveGame && trimEvent(liveGame),
        nextGame: nextGame && trimEvent(nextGame),
    };
}

async function fetchStandings(team, id) {
    const data = await getJSON(`${ESPN_V2}/${team.sport}/${team.league}/standings`);

    // Find the conference/league group that contains our team
    let teamEntry = null;
    let conferenceEntries = [];
    for (const conf of data.children || []) {
        const entries = conf.standings?.entries || [];
        const found = entries.find(e => String(e.team?.id) === String(id));
        if (found) {
            teamEntry = found;
            conferenceEntries = entries;
            break;
        }
    }
    if (!teamEntry) return null;

    let divEntries = team.divisionTeams
        ? conferenceEntries.filter(e => team.divisionTeams.includes(e.team?.abbreviation))
        : [...conferenceEntries];

    divEntries = divEntries.map(trimEntry);

    const sortCfg = STANDINGS_SORT[team.league];
    if (sortCfg) {
        divEntries.sort((a, b) => {
            const aVal = parseFloat(stat(a, sortCfg.stat));
            const bVal = parseFloat(stat(b, sortCfg.stat));
            const aNum = isNaN(aVal) ? -Infinity : aVal;
            const bNum = isNaN(bVal) ? -Infinity : bVal;
            return sortCfg.desc ? bNum - aNum : aNum - bNum;
        });
    }

    return { teamEntry: trimEntry(teamEntry), divisionEntries: divEntries };
}

async function buildTeam(team) {
    const meta = await lookupTeam(team);
    const [schedule, standings] = await Promise.all([
        fetchSchedule(team, meta.id),
        fetchStandings(team, meta.id).catch(e => {
            console.warn(`  standings failed for ${team.name}: ${e.message}`);
            return null;
        }),
    ]);
    return { ...meta, schedule, standings };
}

// ── Main ────────────────────────────────────────────────────

const results = await Promise.allSettled(TEAMS.map(buildTeam));

const teams = {};
const failures = [];
results.forEach((r, i) => {
    const name = TEAMS[i].name;
    if (r.status === 'fulfilled') {
        teams[name] = r.value;
        console.log(`✓ ${name}`);
    } else {
        teams[name] = { error: r.reason?.message || 'fetch failed' };
        failures.push(`${name}: ${r.reason?.message}`);
        console.error(`✗ ${name}: ${r.reason?.message}`);
    }
});

// A total wipeout means ESPN is blocking this runner — fail loudly rather than
// committing an empty snapshot over good data.
if (failures.length === TEAMS.length) {
    console.error('\nAll teams failed — refusing to write snapshot.');
    process.exit(1);
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), teams }, null, 1) + '\n');

console.log(`\nWrote ${OUT}${failures.length ? ` (${failures.length} partial failure(s))` : ''}`);
