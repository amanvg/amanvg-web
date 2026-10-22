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
  dark; Oswald, Vollkorn, Work Sans; 0px corners, 1px rules, no offset shadows,
  pills or nested boxes; uppercase only for titles, bands, buttons, chips and
  table heads).
  Light and dark follow the system setting with a sun/moon icon toggle. Do not
  use Inter, `.card`, or the blue accent there.
- `/seattlesports/`: follows `DESIGN.md` like the home page (same header,
  light/dark toggle, Sources footer). Team panels keep each team's official
  colour on the header band only; bodies sit on the card surface.
- `/tirepressure/`: follows `DESIGN.md` like `/seattlesports/`; unit chips live
  in the masthead, results sit on a tally strip.
- `/cve/`: follows `DESIGN.md` like `/tirepressure/`; window chips live in the
  masthead, tier blocks (Act, Attend, Track*, Track) carry the result. The tier
  is a literal lookup in CISA SSVC Table 9 with Mission & Well-being fixed at
  Medium (no subjective inputs); each item shows its Exploitation, Automatable
  and Impact, the tier tooltip its Table 9 row. Values come
  from CISA Vulnrichment (KEV is always Active); missing ones are derived from
  the CVSS vector (else the worse value) and marked `~`. EPSS only ranks.
- `/commute/`: follows `DESIGN.md` like `/tirepressure/`; car, route and pump
  price inputs sit left, a fare tally strip and cost, miles, hours ledgers sit
  right, and results update live (no Calculate button).
- `/tempest/`, `/mlbstadiums/`, `/USStates/`, `/worldmap/`, `/trust/`: follow
  `DESIGN.md` like `/seattlesports/`; region, division and section chips live in
  the masthead, counts sit on tally strips, lists are ledgers.
- `/kpitree/`: follows `DESIGN.md` like `/tirepressure/`; Copy, PNG and SVG
  sit in the masthead, a level tally strip and the tree toolbar (Child,
  Sibling, Link, Delete, undo/redo, zoom, Fit, Example, Clear) sit above a
  full-width pan-and-zoom canvas. The tree is the editor (Miro-style, auto-tidy
  left to right): select a box for + controls, type or double-click to edit,
  drag onto a box to move under it or beside it. Boxes keep Bernie Smith's
  level colours on their tab only (Strategic green, Theme orange, Tactical
  purple, Measure blue); conflicts are red lines, companions double lines.
  Exports always use the light colours on white with Work Sans and Oswald
  inlined from Google Fonts (PNG at 3×).
- `/qualitycontrol/`: follows `DESIGN.md` like `/kpitree/` and is built the
  same way, by clicking, never by typed syntax. Copy, PNG and SVG plus the
  seven tool chips sit in the masthead, the toolbar sits above the work area,
  and only the charts get a tally strip (diagrams have no result to tally). Fishbone and Flow Chart are a full-width pan-and-zoom
  canvas edited like the KPI tree (select a box for + controls, type or
  double-click to edit, drag onto a box to move it, undo/redo, Fit, Example,
  Clear) with automatic layout. Pareto, Histogram, Control Chart, Scatter and
  Check Sheet are an editable grid (title, + Row, × per row, Enter moves down,
  paste fills cells) left of a live inline-SVG chart. Exports use the light
  colours on white like `/kpitree/` (plots at 1200×675, diagrams at natural
  size).
- `/qualityplanning/`: same shell and editing model as `/qualitycontrol/`
  (clicking only, automatic layout, Copy/PNG/SVG and tool chips in the
  masthead, tally strip only where a tool has a result). Affinity, Tree, PDPC,
  Interrelationship, Matrix and Activity Network are canvases; Prioritization
  is an editable grid beside a ranked bar chart. Tools without a root box
  (Affinity, Interrelationship, Matrix, Activity Network, and Flow Chart on
  `/qualitycontrol/`) carry an editable title band for the problem at the top
  of the canvas; an empty band is left out of exports. On both pages the
  canvas fits the window: the scroll wheel zooms at the cursor, a drag pans
  from anywhere (over lines too; a line is selected by a plain click), and Fit
  shows the whole diagram. Hovering or selecting an Interrelationship factor
  fades everything not linked to it.
- `/frontier/`: follows `DESIGN.md` like `/commute/`; reads the log from the
  Worker API, read-only until a device is Connected (no browser copy). The
  odometer is locked to the highest reading across fill-ups and services and
  shows in the masthead as a D40-style amber LCD (flat, same in both themes,
  DSEG7 Classic Bold self-hosted in `frontier/fonts/` under the SIL OFL, lit
  digits over unlit `888888`).
  Truck setup sits left on Maintenance; due-status tally strip, schedule and
  history sit right. On Fuel the Add fill-up form (date, odometer, gallons, Partial and Missed
  previous flags) sits left (Connected only); a fill-up's pencil loads it into
  the form to edit. MPG runs full tank to full tank: partial gallons roll into
  the next full fill, a missed fill-up drops the open tank, and Miles by month
  ignores the flags;
  Average, Last fill-up (each with its change) and Best MPG tally strip, then
  a mini strip (fill-ups, gallons, gal/100 mi, avg range as average MPG × the average gallons of tanks of 15+ gal,
  best miles per fill-up counting only fills of 10+ gal), the MPG by fill-up and month chart (WBR
  6-12: the last 6 tanks, ticked by their closing fill-up's number in the log
  (#57), a gap, then the last 12 calendar months
  ending this month; inline-SVG line, one hue, every point labelled, the line
  breaks where a month has no fill-up, y axis fitted to include dashed Target
  20 (green) and Threshold 16 (red, the EPA rating) KPI lines (unlabelled),
  dots red below
  the threshold and green at or above the target; fill-ups stack above
  months when slots drop under 30px), then the MPG distribution (tanks per whole MPG, tallest bin
  labelled), then the 10 newest fill-ups (with miles per tank and flags; MPG red
  below the 16 MPG threshold, green at or above the 20 MPG target) sit right. No cost is shown on Fuel
  (fill-ups save cost 0). History (`#history`) is one full-width column of
  ownership charts: first To the Moon, an inline-SVG serigraph of the odometer
  along an Earth-to-Moon arc (238,855 mi), every milestone reached (1,000,
  10,000, then each 10,000; dated by the first fill-up at or past it) a ring on
  the arc with a short dashed leader to a `10k - 2026-06-05` label placed newest
  first where it overlaps nothing (newest in the path colour; no room leaves the
  ring and its title), with a Driven / To go / Arrival
  tally strip (arrival at the first-to-latest reading pace), then Miles by month (column chart, one hue, miles
  from fill-up odometer distance by fill date, from the first fill-up's month
  to this month with a dashed average line; bars and labels scale to fit), then an Odometer line chart of
  every fill-up and service reading over the whole log.
- `/USStates/`, `/worldmap/`, `/mlbstadiums/`: open on the committed
  `data/visited.json`; a "Create your own" button switches to a blank,
  browser-saved copy with Export/Import in the same schema. No personal name
  appears in these or any new UI text.
- `/spreadsheet/`: keeps its own spreadsheet look (green `#107c41` title bar,
  ribbon, grid), not `DESIGN.md`. It is an installable web app
  (`manifest.webmanifest`, network-first `sw.js`; bump `CACHE` in `sw.js` when
  adding files) with SheetJS 0.18.5 vendored in `vendor/`.
- `/carpicker/` (unlinked): still the old dark theme. Copy the `:root` tokens,
  nav (`← amanvg` back link, centered title), `.card`, and form styles from the
  page itself rather than inventing new ones. Inter from Google Fonts, 20px
  card radius, accent `#3b82f6`. It keeps this look until it is migrated.
- Desktop first. Verify every UI change at these viewports (CSS px), desktops
  before phones: 2560×1440 (4K 16:9 monitor scaled), 1728×1117 (16" MacBook
  Pro default), 1512×982 (14" MacBook Pro default), 440×956 (iPhone Pro Max),
  402×874 (iPhone Pro). Inputs and results visible together, key controls
  above the fold. Collapse to one column below 960px.
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
- Frontier data lives in a Cloudflare D1 database (`frontier`) behind the
  Worker `frontier-log` (`frontier/worker/`: `worker.js`, `schema.sql`,
  `seed.sql`, `wrangler.toml`), deployed with `npx wrangler deploy` from that
  folder. `GET /log` is public and returns the `version`, `truck`, `services`,
  `fuel` shape; `GET /auth`, `POST /fuel`, `PUT /fuel/:id`, `DELETE /fuel/:id`, `POST /services`,
  `DELETE /services/:id` and `PUT /truck` need the
  `FRONTIER_KEY` secret, as do all KPI tree routes for `/kpitree/`, reads
  included (`GET /kpi`, `GET /kpi/:id`, `PUT /kpi/:id`, `DELETE /kpi/:id`;
  table `kpi_trees`, created on the remote database with
  `npx wrangler d1 execute frontier --remote --file schema.sql`). The key
  (`npx wrangler secret put FRONTIER_KEY`) is what a device pastes into Connect (kept in its `localStorage`, `frontier:key`).
  CORS allows only amanvg.com and localhost:8765. `frontier/data/log.json` is
  the Fuelly seed only (cost 0, no price data); the page does not read it.
  Preview: `npx wrangler dev --local --port 8787` in `frontier/worker/`
  (local key from a gitignored `.dev.vars`), the page uses it on localhost.
  The map "Create your own" copies save to `localStorage` (`<folder>:mine`)
  with Export/Import.
- Workflows only commit when real data moved (they ignore timestamp-only diffs).

## Sections

- `/commute/` Commute Cost Calculator: weekly/monthly/yearly cost and hours
  tables for a car and two addresses.
- `/tirepressure/` Tire Pressure: fill pressure that averages to the cold
  placard over the next 30 days, from current temperature, 10-year climate
  and altitude. Follows `DESIGN.md`; units °F/°C and PSI/kPa/bar.
- `/cve/` CVE Triage: recent CISA KEV and likely-exploited CVEs tiered Act,
  Attend, Track*, Track by the CISA SSVC decision tree, with a browser-saved
  watchlist that ranks matches first. Follows `DESIGN.md`.
- `/frontier/` Frontier Maintenance: service and fill-up log for a 2022+ Nissan
  Frontier, due status from odometer and date against Nissan's schedule, cost
  and MPG ledgers; fill-ups and services are logged from the page once a device
  is Connected.
- `/kpitree/` KPI Tree: Bernie Smith-style KPI tree built by clicking (+ adds
  the next level or a sibling; Link connects a shared box or draws a conflict
  or companion line). Not connected it keeps one tree in `localStorage`
  (`kpitree:tree`, version 2: nodes with ordered children, roots, rels).
  Connected with the Frontier key (same `frontier:key`, so Connect or
  Disconnect on either page does both), a tree picker with New, Rename,
  Duplicate and Delete lists the trees on the Worker, edits autosave there,
  and `kpitree:open` remembers the open tree; a first connect to an empty
  server uploads the browser's saved tree.
- `/qualitycontrol/` Quality Control: the seven basic quality tools. Fishbone:
  effect box; a new or cleared one starts on the service 4 Ps (Policies,
  Procedures, People, Plant); + adds a category (alternating above and below the spine) or a
  cause. Flow chart: + adds the next step, Decision turns a step into a
  diamond, its right + adds a No side box that returns to the step above, and
  Link points its No arrow at any step. Pareto sorts with Other last, with a
  cumulative line and 80% rule; Histogram uses Sturges bins with optional
  LSL/Target/USL and Cpk; Control Chart is an individuals chart (mean ± 2.66 ×
  average moving range, red beyond limits, amber on runs of 8); Scatter has a
  least-squares line and r; Check Sheet draws tallies with row and column
  totals and editable columns. Saved in `localStorage` (`qualitycontrol:data`,
  version 2, per-tool state); no Worker.
- `/qualityplanning/` Quality Planning: the seven management and planning
  tools. Affinity: groups with idea cards (drag cards between groups). Tree:
  goal and means left to right. PDPC: objective, activity, risk and
  countermeasure top-down, countermeasures marked feasible (○) or not (✕);
  tally counts covered and open risks. Interrelationship: factors evenly along an oval
  shaped like the canvas, grown until no boxes touch, then until no arrow crosses
  a box only while it still fits the canvas at 100%,
  Link draws cause → effect (one arrow per pair), most outgoing is the key
  driver and most incoming the key outcome. Matrix: click a cell to cycle
  positive (+1) / neutral (0) / negative (−1) opinion, with signed net totals
  per row and column; tally shows the most positive and most negative rows. Prioritization:
  weighted criteria × option scores, ranked. Activity Network: activities with
  durations, + adds a successor or a parallel activity, Link sets "follows"
  (loops refused), critical path method gives ES/EF/LS/LF and slack, critical
  path in red. Saved in `localStorage` (`qualityplanning:data`, version 1).
- `/spreadsheet/` Spreadsheet: workbook with formulas, sheets, charts and
  .xlsx/.csv open and save, saved in `localStorage` (`spreadsheet:workbook`).
- `/seattlesports/`, `/tempest/`, `/USStates/`, `/worldmap/`, `/mlbstadiums/`:
  dashboards and maps; `carpicker/` is an older, unlinked page.
- Home categories: Sports, Personal (Frontier, US States, Countries, MLB
  Stadiums), Weather, Security, Calculators.
