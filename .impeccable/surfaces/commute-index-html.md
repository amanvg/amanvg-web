---
version: 1
slug: "commute-index-html"
primary_target: "commute/index.html"
related_targets: []
---

# /commute/ surface brief

Scope: whole-page migration of `commute/index.html` into the DESIGN.md serigraph world (light Federal Park, dark Nocturne), like `/tirepressure/`. Mode: Operate. Build path: code-led (no image generation).

Audience and job: Aman or anyone with a link; pick a car, enter two addresses, read what the drive costs per day, week, month, year in dollars, miles and hours. Inputs and results visible together at 1440x900 and 1024x768; one column under 960px.

Unresolved: none. Structure locked by the user: live results (no Calculate button), copy compressed to labels, tags and counts. Structure roll not run (seed af856c7e rolled but not used; user and precedent fixed the composition).

## Direction contract

THESIS: A commute is a posted fare. The page owns one idea: the answer is struck onto framed signboards the instant the inputs are valid, refusing the stacked-cards-then-Calculate form.

OWN-WORLD: DESIGN.md as shipped on /tirepressure/: pine masthead band over a framed sheet, 3px frame, 4px hard print-strike shadow, 0px corners, deboss wells for inputs, Oswald signboard numerals, Work Sans uppercase labels, Vollkorn entry, ochre accent for selection, clay for errors, triple-stripe divider, round pills only for tags.

STORY: The visitor sees what is still needed (car, route, prices as stamp pills), fills them left to right, and watches the per-day fare boards and the week/month/year ledgers fill and re-strike on every change. They believe the number because the source (AAA date, EPA rating, OSRM miles) sits beside it, and they act by switching fuel basis or days in office.

FIRST VIEWPORT: 1440x900. Sticky pine header with amanvg and the sun/moon toggle. Sheet below: pine masthead "Commute Cost". Left panel (about 4/11): Car selects, EPA city/combined/hwy readout with MPG adjuster, Route addresses with Find, Pump prices with source pill. Right panel (about 7/11): needs-row of stamp pills, then two or three fare signboards (Regular, Premium or Diesel, All-in IRS) with Oswald numerals at about 64px, a pill row (MPG, gallons, miles, highway/city split), then the cost ledger with basis chips above its 1 to 5 day rows. Miles and hours ledgers sit below, side by side.

FORM: Two-column workbench, the same composition class as /tirepressure/, not from the roll; seed key af856c7e.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
