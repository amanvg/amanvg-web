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

- Dark theme. Copy the `:root` tokens, nav (`← amanvg` back link, centered
  title), `.card`, and form styles from an existing page such as
  `commuteplanner/index.html` rather than inventing new ones. Inter from
  Google Fonts, 20px card radius, accent `#3b82f6`.
- UI text is labels, questions, counts, and attribution only. No taglines,
  help text, or explanatory sentences in the page.
- Attribute data sources in the page footer or the map attribution.

## Data

- Called directly from the browser: fueleconomy.gov REST (`/ws/rest`, cache
  responses in localStorage), Nominatim (max 1 request/second, sleep between
  calls), the public OSRM demo router, zippopotam.us for zip → state.
- Sources without CORS are scraped by stdlib-only Python scripts into a
  committed `data/*.json` the page reads same-origin:
  - `commute/update_prices.py` → `commute/data/gas-prices.json`, daily AAA
    state averages, run by `.github/workflows/commute-gas-prices.yml`.
  - `seattlesports/build-snapshot.mjs` → `seattlesports/data/snapshot.json`,
    run by `.github/workflows/seattlesports-snapshot.yml`.
  - `commuteplanner/update_electricity.py` →
    `commuteplanner/data/electricity-prices.json`, EIA state residential
    $/kWh, run by hand (EIA publishes monthly).
  - `whichcar/build_data.py` → `whichcar/data/vehicles.json` from the EPA
    `vehicles.csv` download, run by hand.
- Workflows only commit when real data moved (they ignore timestamp-only diffs).

## Sections

- `/commute/` Commute Cost Calculator: weekly/monthly/yearly cost and hours
  tables for a car and two addresses.
- `/roadtrip/` Road Trip Cost Calculator: multi-state fuel pricing along a route.
- `/whichcar/` What car should I buy: questionnaire over the EPA vehicle data.
- `/commuteplanner/` Commute Planner: map, blue driving route, one-way
  distance, drive time, and cost. Cars are assessed by type: gas by MPG and
  AAA price, EVs by kWh/100 mi and EIA electricity (never show MPGe), PHEVs
  split each leg of the round trip between battery and gas using the
  charge-at-home / charge-at-destination checkboxes, and the tile shows half
  of that as the one-way cost. Its purpose is to grow, one small step at
  a time, into a comparison of the modes of transport available for a commute;
  blue is reserved for driving. Turn-by-turn directions exist behind
  `SHOW_DIRECTIONS = false`.
- `/seattlesports/`, `/tempest/`, `/USStates/`, `/worldmap/`, `/mlbstadiums/`:
  dashboards and maps; `carpicker/` is an older, unlinked page.
