# amanvg-web

Personal site for https://www.amanvg.com, served by GitHub Pages straight from
`main` (see `CNAME`). No build step, no framework, no shared JS: every project
is one folder with a self-contained `index.html`, and the home page `index.html`
links to each one with a card.

## Change management (mandatory)

Before any code, content, or data change, present three plans of at most
three sentences each, then ask for approval with an Approve / Reject dropdown
(the AskUserQuestion tool) and start only on Approve:

1. **Implementation plan** — what will change, where, and how.
2. **Backout plan** — how to undo it (usually `git revert` or restoring the file).
3. **Testing plan** — how the change is verified, in the browser where it applies.
4. **Commit and push approval** — once the testing plan has passed and the
   results are reported, ask with a second Approve / Reject dropdown whether
   to commit and push. Approve: commit with the standard message, fetch and
   rebase onto `origin/main`, push, report the commit hash. Reject: leave the
   working tree as it is.

This applies to every change, however small, including edits to this file.
A Reject means make no changes and ask what to adjust.

## Working here

- Preview with the `site` config in `.claude/launch.json` (Python `http.server`
  on port 8765), then open `http://localhost:8765/<folder>/`. Root-relative
  paths like `/commute/data/gas-prices.json` work locally and in production.
- Verify changes in the browser before reporting them done; check the console.
- Commit messages follow the log: `<folder>: <what changed>` for edits,
  `Add <Name> at /<folder>/` for a new section. Commit and push only when asked.
- Bots commit to `main` every 30 minutes (Seattle Sports snapshot) and daily
  (gas prices), so `git fetch && git rebase origin/main` before pushing.
- Dates are ISO-8601 (`2026-09-08`), currency is USD, times are UTC.

## Look and copy

- Home page (`/`): follows `DESIGN.md` (Federal Park Serigraph light, Nocturne
  dark; Oswald, Vollkorn, Work Sans; 0px corners, hard print-strike shadows).
  Light and dark follow the system setting with a sun/moon icon toggle. Do not
  use Inter, `.card`, or the blue accent there.
- `/seattlesports/`: follows `DESIGN.md` like the home page (same header,
  light/dark toggle, Sources footer). Team panels keep each team's official
  colour on the header band only; bodies sit on the card surface.
- `/tirepressure/`: follows `DESIGN.md` like `/seattlesports/`; unit chips live
  in the masthead, results sit on framed signboards.
- `/cve/`: follows `DESIGN.md` like `/tirepressure/`; exposure, environment and
  window chips live in the masthead, tier blocks (Act, Attend, Track*, Track)
  carry the result.
- `/commute/`: follows `DESIGN.md` like `/tirepressure/`; car, route and pump
  price inputs sit left, fare signboards and cost, miles, hours ledgers sit
  right, and results update live (no Calculate button).
- `/tempest/`, `/mlbstadiums/`, `/USStates/`, `/worldmap/`, `/trust/`: follow
  `DESIGN.md` like `/seattlesports/`; region, division and section chips live in
  the masthead, counts sit on signboards, lists are ledgers.
- `/frontier/`: follows `DESIGN.md` like `/commute/`; reads the committed
  `data/log.json`, read-only until a device is Connected (no browser copy).
  Truck setup sits left on Maintenance; due-status signboards, schedule and
  history sit right. On Fuel the Add fill-up form sits left (Connected only),
  MPG signboards and the 10 newest fill-ups sit right. A Cost chip (off by
  default, saved per browser) shows cost.
- `/USStates/`, `/worldmap/`, `/mlbstadiums/`: open on the committed
  `data/visited.json`; a "Create your own" button switches to a blank,
  browser-saved copy with Export/Import in the same schema. No personal name
  appears in these or any new UI text.
- `/carpicker/` (unlinked): still the old dark theme. Copy the `:root` tokens,
  nav (`← amanvg` back link, centered title), `.card`, and form styles from the
  page itself rather than inventing new ones. Inter from Google Fonts, 20px
  card radius, accent `#3b82f6`. It keeps this look until it is migrated.
- Desktop first. Design and verify at 1440×900 and 1024×768 before phone
  widths: inputs and results visible together, key controls above the fold.
  Collapse to one column below 960px.
- UI text is labels, questions, counts, and attribution only. No taglines,
  help text, or explanatory sentences in the page.
- Attribute data sources in the page footer or the map attribution.

## Data

- Called directly from the browser: fueleconomy.gov REST (`/ws/rest`, cache
  responses in localStorage), Nominatim (max 1 request/second, sleep between
  calls), the public OSRM demo router, zippopotam.us for zip → state,
  Open-Meteo (current temperature, elevation, 10-year daily archive; summary
  cached in localStorage per day).
- Sources without CORS are scraped by stdlib-only Python scripts into a
  committed `data/*.json` the page reads same-origin:
  - `commute/update_prices.py` → `commute/data/gas-prices.json`, daily AAA
    state averages, run by `.github/workflows/commute-gas-prices.yml`.
  - `seattlesports/build-snapshot.mjs` → `seattlesports/data/snapshot.json`,
    run by `.github/workflows/seattlesports-snapshot.yml`.
  - `cve/update.py` → `cve/data/snapshot.json`, CISA KEV, FIRST EPSS, NVD and
    CVE.org (CISA SSVC), run every 6 hours by `.github/workflows/cve-snapshot.yml`.
- `USStates/data/visited.json`, `worldmap/data/visited.json` and
  `mlbstadiums/data/visited.json` are hand-edited config (`{"version":1,
  "visited":[...]}`), read same-origin; a browser Export uses the same schema.
- `frontier/data/log.json` is the only Frontier data (`version`, `truck`,
  `services`, `fuel`); seeded from a Fuelly CSV export (cost 0, no price
  data). Visitors read it same-origin. A device that pastes a fine-grained
  GitHub token (this repo, Contents read and write; kept in that browser's
  `localStorage`, `frontier:gh`) reads it through the GitHub API and saves by
  committing it (fresh read, change, PUT with sha, one retry on conflict);
  commit messages are `frontier: log fill-up` / `frontier: delete fill-up`.
  The map "Create your own" copies save to `localStorage` (`<folder>:mine`)
  with Export/Import; there is no other backend.
- Workflows only commit when real data moved (they ignore timestamp-only diffs).

## Sections

- `/commute/` Commute Cost Calculator: weekly/monthly/yearly cost and hours
  tables for a car and two addresses.
- `/tirepressure/` Tire Pressure: fill pressure that averages to the cold
  placard over the next 30 days, from current temperature, 10-year climate
  and altitude. Follows `DESIGN.md`; units °F/°C and PSI/kPa/bar.
- `/cve/` CVE Triage: recent CISA KEV and likely-exploited CVEs tiered Act,
  Attend, Track*, Track from exploitation, EPSS, exposure, environment and a
  browser-saved watchlist. Follows `DESIGN.md`.
- `/frontier/` Frontier Maintenance: service and fill-up log for a 2022+ Nissan
  Frontier, due status from odometer and date against Nissan's schedule, cost
  and MPG ledgers, all read from the committed log; fill-ups are logged from
  the page once a device is Connected (services are edited in `data/log.json`).
- `/seattlesports/`, `/tempest/`, `/USStates/`, `/worldmap/`, `/mlbstadiums/`:
  dashboards and maps; `carpicker/` is an older, unlinked page.
- Home categories: Sports, Personal (Frontier, US States, Countries, MLB
  Stadiums), Weather, Security, Calculators.
