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
Served by GitHub Pages from `main`. No build step, no framework, no shared JS: one self-contained `index.html` per project. Data comes from public APIs called in the browser (fueleconomy.gov, Nominatim, OSRM, zippopotam.us) or from committed `data/*.json` files refreshed by scripts and GitHub Actions. Dates are ISO-8601, currency is USD, times are UTC.

## Capabilities and Constraints
- Sections: `/commute/`, `/roadtrip/`, `/whichcar/`, `/commuteplanner/` (growing into a comparison of commute transport modes), `/seattlesports/`, `/tempest/`, `/USStates/`, `/worldmap/`, `/mlbstadiums/`, `/trust/`. `carpicker/` is older and unlinked.
- Desktop first: verify at 1440×900 and 1024×768, collapse to one column below 960px.
- UI text is labels, questions, counts, and attribution only. No taglines, help text, or explanatory sentences.
- Data sources are attributed in the page footer or map attribution.
- EVs are shown by kWh/100 mi, never MPGe. Blue is reserved for driving in Commute Planner.
- Every change goes through the approval process in `CLAUDE.md`.

## Brand Commitments
Home page (`/`): WPA serigraph look defined in `DESIGN.md`, in two modes that follow the system setting with a sun/moon icon toggle. Light is Federal Park Serigraph (parchment, pine, ochre, clay); dark is Nocturne Serigraph (midnight pine, campfire amber, terracotta). Oswald headings, Vollkorn body, Work Sans labels, 0px corners, hard print-strike shadows, a framed real public-domain poster crop, a flush stack of colour-banded accordion categories. No illustration, seals, emblems, AI-generated art, URLs on rows, or per-category counts. Real assets only, credited in the Sources row; the owner handles any licensing.

`/seattlesports/` keeps the earlier poster look (night-green ground, Barlow Condensed, flat bands, four team panels in the teams' official colours, ESPN credited in Sources) until it is migrated to `DESIGN.md`.

Other app pages (`/commute/`, `/roadtrip/`, `/whichcar/`, `/commuteplanner/`, etc.): not yet migrated. They keep the earlier look until each is taken up one step at a time: dark theme, Inter, 20px card radius, accent `#3b82f6`, shared nav (`← amanvg` back link, centered title), shared `.card` and form styles.

## Evidence on Hand
Live data files: `commute/data/gas-prices.json`, `seattlesports/data/snapshot.json`, `commuteplanner/data/electricity-prices.json`, `whichcar/data/vehicles.json`. No testimonials, usage metrics, or customer claims exist and none should be invented.

## Product Principles
- One small app, one question, answered accurately with real data.
- Each project stays self-contained and dependency-free.
- Show labels and results, not explanations.
- Growth happens in small steps; the owner's interest sets the direction.
