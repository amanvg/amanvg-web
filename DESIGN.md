---
name: amanvg
description: Home page of amanvg.com as a flat-colour poster sheet of five category bands on a night-green ground.
colors:
  night-green: "#0f2421"
  paper-cream: "#f1e4c3"
  poster-ink: "#10201d"
  trail-gold: "#f0b43c"
  band-navy: "#1b2f66"
  band-blue: "#2c5f9e"
  band-pine: "#1f5a45"
  band-orange: "#e8742c"
  band-plum: "#6b2f4a"
typography:
  logo:
    fontFamily: "'Big Shoulders Display', 'Arial Narrow', sans-serif"
    fontSize: "30px"
    fontWeight: 900
    lineHeight: "normal"
    letterSpacing: "0.06em"
  sources-label:
    fontFamily: "'Big Shoulders Display', 'Arial Narrow', sans-serif"
    fontSize: "20px"
    fontWeight: 900
    lineHeight: "normal"
    letterSpacing: "0.3em"
  band-title:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "clamp(32px, 3.4vw, 46px)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.12em"
  row-title:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "clamp(24px, 2.4vw, 32px)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.09em"
  row-qualifier:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "0.58em"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.32em"
  nav-link:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: "normal"
    letterSpacing: "0.22em"
  sources:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "normal"
    letterSpacing: "0.2em"
rounded:
  none: "0px"
spacing:
  nav-height: "60px"
  sheet-top-gap: "44px"
  sheet-bottom-gap: "40px"
  sheet-border: "10px"
  band-height: "76px"
  row-height: "60px"
  band-pad-x: "28px"
  row-indent: "56px"
  content-max: "1200px"
  gutter-min: "40px"
components:
  band-head:
    backgroundColor: "{colors.band-navy}"
    textColor: "{colors.paper-cream}"
    typography: "{typography.band-title}"
    rounded: "{rounded.none}"
    height: "76px"
    padding: "0 28px"
  band-head-orange:
    backgroundColor: "{colors.band-orange}"
    textColor: "{colors.poster-ink}"
  project-row:
    backgroundColor: "#162652"
    textColor: "{colors.paper-cream}"
    typography: "{typography.row-title}"
    rounded: "{rounded.none}"
    height: "60px"
    padding: "0 28px 0 56px"
  nav-link:
    textColor: "{colors.paper-cream}"
    typography: "{typography.nav-link}"
    padding: "8px 14px"
  nav-link-hover:
    textColor: "{colors.trail-gold}"
  sheet:
    backgroundColor: "{colors.paper-cream}"
    rounded: "{rounded.none}"
    padding: "10px"
---

# Design System: amanvg

Scope: this system covers the home page (`/index.html`) only. The app pages (`/commute/`, `/roadtrip/`, `/commuteplanner/`, `/whichcar/`, `/seattlesports/`, `/tempest/`, `/USStates/`, `/worldmap/`, `/mlbstadiums/`, `/tirepressure/`, `/carafford/`, `/trust/`) still use the older dark / Inter / `#3b82f6` accent / 20px-radius card style and are not yet part of this system. Do not mix the two on one page.

## Overview

**Creative North Star: "The Park Poster Sheet"**

One cream-framed sheet sits on a night-green ground. Inside it, a cropped public-domain park-service poster banner is followed by five flat, saturated colour bands that step cool to warm (navy, blue, pine, orange, plum). Each band is an accordion: it opens to a stack of darker rows, one per project. Poster inspiration was taken only for colour and lettering, in condensed, all-caps, widely tracked type. It is not borrowed for illustration or pastiche.

The page is flat and printed-feeling: no gradients, no shadows at rest, no rounded corners, no imagery other than the banner. Copy is labels and titles only: band names, project names, short qualifiers, and a Sources line.

**Key Characteristics:**
- Flat saturated colour bands, cool to warm, each with a darker child-row shade derived by `color-mix`.
- Condensed all-caps tracked lettering throughout (Barlow Condensed for text, Big Shoulders Display for the logo and the Sources label).
- Cream paper frame (10px) around banner and bands; night-green ground outside it.
- Square corners everywhere; depth comes only from colour steps and an inset keyline on hover.
- Motion is limited to accordion expand, staggered row fade, and small arrow nudges, all on one easing.

## Colors

A night-green ground, cream paper, one gold accent, and five poster-flat band colours.

### Primary
- **Poster Cream** (`paper-cream`, #f1e4c3): the sheet frame, all text on dark grounds, nav rule, focus outline, skip-link fill.
- **Trail Gold** (`trail-gold`, #f0b43c): the only accent. Nav-link hover (text and border), text selection background, and the Sources label. Never a band or row colour.

### Secondary: the five bands (cool to warm, in page order)
- **Navy** (`band-navy`, #1b2f66): Sports.
- **Blue** (`band-blue`, #2c5f9e): Maps.
- **Pine** (`band-pine`, #1f5a45): Weather.
- **Orange** (`band-orange`, #e8742c): Calculators. Carries ink text, not cream.
- **Plum** (`band-plum`, #6b2f4a): Planning.
- **Child rows** are the band colour mixed 80% with 20% black (`color-mix(in srgb, band 80%, #000)`). Computed shades: navy #162652, blue #234c7e, pine #194837, plum #56263b. The orange band is the exception: its rows are orange mixed 90% with 10% white (`--mix:90%; --tint:#fff`, #ea8241), because ink text on the darker mix measured 3.75:1. These are derived, not separate tokens; always compute from the band colour.

### Neutral
- **Night Green** (`night-green`, #0f2421): page ground and sticky nav background.
- **Poster Ink** (`poster-ink`, #10201d): text on the orange band and on cream/gold fills (skip link, selection).

### Named Rules
**The Band-Owns-Its-Colour Rule.** A band sets one `--c` and one `--fg`; its head, its rows, its focus ring, and its hover keyline all derive from those two values. Nothing inside a band introduces another hue.

**The Ink-On-Orange Rule.** Cream text on orange is too weak; the orange band uses ink (#10201d) for its text. Any new light band does the same; pick `--fg` per band, not globally.

**The One Gold Rule.** Gold marks interaction on the dark ground (nav hover) and the Sources label only. It never fills a surface.

## Typography

**Text Font:** Barlow Condensed (with Arial Narrow, sans-serif); weights 600, 700, 800 loaded.
**Display Font:** Big Shoulders Display (with Arial Narrow, sans-serif); weight 900 only.

**Character:** Condensed, uppercase, and generously tracked, like lettering on a trail-service poster. Big Shoulders at 900 is reserved for the two identity marks; everything else is Barlow Condensed.

### Hierarchy
- **Logo** (Big Shoulders 900, 30px, tracking 0.06em, uppercase): the "amanvg" wordmark in the nav.
- **Band Title** (Barlow Condensed 800, clamp(32px, 3.4vw, 46px), line-height 1, tracking 0.12em, uppercase): the `h2` on each colour band.
- **Row Title** (Barlow Condensed 700, clamp(24px, 2.4vw, 32px), line-height 1, tracking 0.09em, uppercase): project names, `h3`.
- **Row Qualifier** (Barlow Condensed 600, 0.58em of the row title, tracking 0.32em, uppercase): a short trailing phrase inline with the row title, baseline-aligned, 18px gap.
- **Nav Link** (Barlow Condensed 700, 17px, tracking 0.22em, uppercase).
- **Sources** (Barlow Condensed 600, 15px, tracking 0.2em, uppercase) with the **Sources Label** in Big Shoulders 900, 20px, tracking 0.3em, gold.

### Named Rules
**The All-Caps Tracked Rule.** Every piece of text on the page is uppercase with positive letter-spacing; tracking widens as size shrinks (0.12em at band size, 0.32em at qualifier size).

**The Two Display Marks Rule.** Big Shoulders Display 900 appears only on the logo and the Sources label. Do not extend it to headings.

## Layout

Single column, content centred with a fluid gutter of `max(40px, (100% - 1200px) / 2)`, so the nav, the sheet, and the Sources line share the same edges. At 700px and below the gutter drops to 16px, the sheet border to 8px, band height to 68px, band padding to 16px, and row indent to 32px.

Vertical rhythm: sticky nav 60px with a 2px cream rule; 44px gap between nav and sheet; sheet bottom margin 40px; Sources padded 48px at the bottom. Bands are 76px tall closed; rows are 60px tall, indented 56px from the band edge so they read as children. Band head and row are grids with a flexible title column and a fixed icon column (32px and 28px) with 24px column gap. The banner is full sheet width at a height of clamp(110px, 16vw, 200px), cropped to fit with `object-fit: cover`, anchored at 50% 12% so the peaks and the light-blue notch stay in frame. `html` uses `scrollbar-gutter: stable` so expanding a band does not shift the layout.

Categories start collapsed. Accordions are independent (opening one does not close others).

## Elevation & Depth

Flat. There are no resting shadows. Depth is conveyed by the colour step from band to darker child rows and by the cream frame around the sheet. The one state-driven treatment is an inset keyline on row hover.

### Shadow Vocabulary
- **Inset Keyline** (`box-shadow: inset 0 0 0 4px var(--fg)`): row hover, drawn in the band's own text colour.

### Named Rules
**The Print-Grain Rule.** One screenprint texture sits over the whole sheet: a `.sheet::after` overlay of inline SVG fractal noise at 7% opacity with `mix-blend-mode: multiply`, so band colours and text keep their contrast within about 0.4:1 and no extra file loads. It is hidden under `forced-colors`. It is texture, not shadow or gradient; nothing else on the page is textured.

**The Flat-By-Default Rule.** Surfaces are flat at rest. Hover is a keyline, never a drop shadow or a lift.

## Shapes

Square and printed. No border radius anywhere (0px). The sheet is a 10px cream border (8px under 700px) with a 2px ink rule 3px inside its edge (`outline`, offset -7px, -6px under 700px); bands and rows are full-bleed rectangles inside it. The nav link has a 2px transparent border that turns gold on hover. Icons are two small solid SVG glyphs filled with `currentColor`: a chevron (28px, rotates 90deg when open) on band heads and a block arrow (26px) on rows.

## Components

### Navigation
Sticky, 60px, night-green with a 2px cream bottom border. Logo left, one link ("Trust") right. Link: cream, 17px tracked caps, 44px minimum height, 14px side padding, 2px transparent border. Hover: border and text turn gold. Includes a skip link that slides in on focus (cream fill, ink text).

### Band (accordion head)
Full-width button, 76px, band colour background, `--fg` text, title left and chevron right. Hover nudges the chevron 3px right. Open state rotates the chevron 90deg (0.45s). Focus ring: 3px outline in `--fg`, offset -8px (inset). The title is an `h2` wrapping the button.

### Panel and Project Row
Panel expands with a grid-rows transition (0fr to 1fr, 0.5s). Rows are 60px, darker band shade, title left and block arrow right. When a band opens, rows fade in and slide from -10px; the second to fourth rows delay by 0.06s, 0.12s, 0.18s (opacity and transform only). Hover adds the inset keyline and moves the arrow 7px right (0.3s). Row focus ring is 3px in `--fg`. Closed panels are `inert`, so their links are out of the tab order. Opening a band scrolls just enough to keep its last row 24px above the fold, never past 72px under the top edge, and stops if the visitor scrolls; under `prefers-reduced-motion` it applies at once. Easing for all expand, slide, and nudge motion: `cubic-bezier(.16, 1, .3, 1)`; the opacity fade is 0.35s `ease`. All of it is disabled under `prefers-reduced-motion`.

### Banner Plate
A cropped poster image (`/assets/banner.jpg`, North Cascades, Ivan Chermayeff, National Park Service, 1972) at the top of the sheet, decorative (empty alt), credited in the Sources row. It is the only imagery on the page.

### Sources Line
Wrapping row below the sheet, 8px/26px gaps: the gold Big Shoulders "Sources" label, then data-source names, then the banner credit. Attribution only.

## Do's and Don'ts

### Do:
- **Do** give each new category a flat saturated band colour and an explicit `--fg`, stepping along the cool-to-warm order, and derive its rows with `color-mix(in srgb, <band> 80%, #000)`.
- **Do** keep copy to labels and titles; qualifiers stay short phrases.
- **Do** keep text uppercase, Barlow Condensed, with the tracking steps above.
- **Do** keep cream (#f1e4c3) as the frame and text colour on dark grounds and gold (#f0b43c) as the only accent.
- **Do** credit any outside image or data in the Sources line.
- **Do** keep reduced-motion handling when adding transitions.

### Don't:
- **Don't** add seals, emblems, fake scenery, AI-generated assets, or poster pastiche; the poster influence is colour and type only. (Rejected by the owner.)
- **Don't** put the owner's name on a banner, URLs on rows, or per-category counts. (Rejected by the owner.)
- **Don't** add rounded corners, gradients, or resting drop shadows.
- **Don't** use gold as a surface fill or Big Shoulders Display for headings.
- **Don't** carry the older Inter / blue accent / 20px-radius card style onto this page, or this system onto the app pages without an explicit decision.

## Open Notes
- The banner's public-domain status is unconfirmed (Wikimedia Commons lists it as public domain; the owner will handle licensing).
- Text contrast measured 2026-10-03: heads 5.13 to 10.11:1; rows 6.24 to 11.66:1 (orange rows with the lighter mix 6.24:1). Orange rows are lighter than their head, the one place the child-darker step is inverted.
- Not canonized: the calculator titles carry no qualifier; the remaining row qualifiers are phrase fragments ("I have been to", "I have seen a game in"), which strain the labels-and-titles-only copy rule; the stale CSS comment mentioning a "sun-and-rays cap" no longer matches the build.
