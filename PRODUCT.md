# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
The site owner (Aman) and anyone they share a tool with. Visitors arrive from a link to use one small app: price a commute, plan a road trip, pick a car, check a sports schedule, or explore a map.

## Product Purpose
A personal site at https://www.amanvg.com that hosts small web apps the owner finds cool. Each app is a self-contained project that answers one question with real data. Success is that each app works, is accurate, and is pleasant to use.

## Positioning
A personal collection of single-purpose apps built for fun, not a product or portfolio pitch. Each lives in its own folder and links from a card on the home page.

## Operating Context
Served by GitHub Pages from `main`. No build step, no framework, no shared JS: one self-contained `index.html` per project. Data comes from public APIs called in the browser (fueleconomy.gov, Nominatim, OSRM, zippopotam.us, Open-Meteo) or from committed `data/*.json` files refreshed by scripts and GitHub Actions. Dates are ISO-8601, currency is USD, times are UTC.

## Capabilities and Constraints
- Sections: `/frontier/`, `/commute/`, `/tirepressure/`, `/cve/`, `/seattlesports/`, `/tempest/`, `/USStates/`, `/worldmap/`, `/mlbstadiums/`, `/trust/`. `carpicker/` is older and unlinked.
- Desktop first: verify at 1440×900 and 1024×768, collapse to one column below 960px.
- UI text is labels, questions, counts, and attribution only. No taglines, help text, or explanatory sentences.
- Data sources are attributed in the page footer or map attribution.
- Every change goes through the approval process in `CLAUDE.md`.

## Brand Commitments
Home page (`/`): WPA serigraph look defined in `DESIGN.md`, in two modes that follow the system setting with a sun/moon icon toggle. Light is Federal Park Serigraph (parchment, pine, ochre, clay); dark is Nocturne Serigraph (midnight pine, campfire amber, terracotta). Oswald headings, Vollkorn body, Work Sans labels, 0px corners, hard print-strike shadows, a framed real public-domain poster crop, a flush stack of colour-banded accordion categories. No illustration, seals, emblems, AI-generated art, URLs on rows, or per-category counts. Real assets only, credited in the Sources row; the owner handles any licensing.

`/seattlesports/`, `/tirepressure/`, `/cve/`, `/commute/` and `/frontier/` follow `DESIGN.md` like the home page. The home page groups Frontier, US States, Countries and MLB Stadiums in a Personal band; the three maps open on a committed `data/visited.json` and offer a browser-saved "Create your own" copy. New UI text never carries a personal name. `/frontier/` stores its log in the separate public repo `amanvg/frontier-data`, read-only for visitors, written by the owner's browser with a repo-scoped token. `/commute/`: pine masthead over car, route and pump-price inputs on the left and framed fare signboards with cost, miles and hours ledgers on the right; results update live. `/seattlesports/`: pine Sports-band masthead over a flush 2×2 of team panels, each team's official colour on its header band only, ledger-striped standings, ESPN credited in Sources.

Other app pages (`/USStates/`, `/worldmap/`, `/mlbstadiums/`, `/trust/`): not yet migrated. They keep the earlier look until each is taken up one step at a time: dark theme, Inter, 20px card radius, accent `#3b82f6`, shared nav (`← amanvg` back link, centered title), shared `.card` and form styles.

## Evidence on Hand
Live data files: `commute/data/gas-prices.json`, `seattlesports/data/snapshot.json`, `cve/data/snapshot.json`. No testimonials, usage metrics, or customer claims exist and none should be invented.

## Product Principles
- One small app, one question, answered accurately with real data.
- Each project stays self-contained and dependency-free.
- Show labels and results, not explanations.
- Growth happens in small steps; the owner's interest sets the direction.
