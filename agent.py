#!/usr/bin/env python3
"""
muse — website agent for amanvg.com

Phase 1 (Opus):   Plans what to build and why.
Phase 2 (Sonnet): Executes the plan into a complete project page.

Usage:
  muse            # run normally
  muse --dry-run  # plan only, don't write or push
"""

import html
import json
import os
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).parent
INDEX = REPO / "index.html"
LOG = REPO / "agent.log"

OPUS   = "claude-opus-4-5-20251101"
SONNET = "claude-sonnet-4-5-20251101"

FOLDER_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
GRADIENT_RE = re.compile(r"^linear-gradient\(90deg, #[0-9a-fA-F]{3,8}, #[0-9a-fA-F]{3,8}\)$")


# ─────────────────────────────────────────
# Utilities
# ─────────────────────────────────────────

def log(msg):
    from datetime import datetime
    line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M')}] {msg}"
    print(line)
    with LOG.open("a") as f:
        f.write(line + "\n")


def load_env():
    env_file = REPO / ".env"
    if env_file.exists() and "ANTHROPIC_API_KEY" not in os.environ:
        for line in env_file.read_text().splitlines():
            if line.startswith("ANTHROPIC_API_KEY="):
                os.environ["ANTHROPIC_API_KEY"] = line.split("=", 1)[1].strip()
                break

    if not os.environ.get("ANTHROPIC_API_KEY"):
        log("ERROR: ANTHROPIC_API_KEY not set. Add it to .env or export it.")
        sys.exit(1)


def get_existing_projects():
    return re.findall(r'href="/([^/"]+)/"', INDEX.read_text())


def validate_plan(p):
    """Model output is untrusted: it becomes a folder name and HTML in index.html."""
    if not isinstance(p, dict):
        raise ValueError("plan is not an object")
    for key in ("folder", "title", "description", "icon", "gradient", "spec"):
        if not isinstance(p.get(key), str) or not p[key].strip():
            raise ValueError(f"plan.{key} must be a non-empty string")
    if not FOLDER_RE.match(p["folder"]):
        raise ValueError(f"plan.folder {p['folder']!r} must match {FOLDER_RE.pattern}")
    if (REPO / p["folder"]).resolve().parent != REPO.resolve():
        raise ValueError("plan.folder escapes the repository")
    if not GRADIENT_RE.match(p["gradient"]):
        raise ValueError(f"plan.gradient {p['gradient']!r} is not linear-gradient(90deg, #hex, #hex)")
    if not isinstance(p.get("tags"), list) or not 1 <= len(p["tags"]) <= 6 or not all(isinstance(t, str) and t.strip() for t in p["tags"]):
        raise ValueError("plan.tags must be 1-6 non-empty strings")
    for key, limit in (("title", 80), ("description", 300), ("icon", 16)):
        if len(p[key]) > limit:
            raise ValueError(f"plan.{key} is longer than {limit} characters")
    return p


def add_card_to_index(card):
    esc = lambda v: html.escape(str(v), quote=True)
    page = INDEX.read_text()
    tags_html = "".join(f'\n            <span class="tag">{esc(t)}</span>' for t in card["tags"])
    new_card = f"""
      <a class="card" href="/{card['folder']}/">
        <div class="card-stripe" style="background: {card['gradient']};"></div>
        <div class="card-top">
          <div class="card-icon-wrap">{esc(card['icon'])}</div>
        </div>
        <div class="card-title">{esc(card['title'])}</div>
        <p class="card-desc">{esc(card['description'])}</p>
        <div class="card-footer">
          <div class="card-tags">{tags_html}
          </div>
          <span class="card-cta">Open →</span>
        </div>
      </a>

"""
    updated = page.replace("    </div>\n  </main>", new_card + "    </div>\n  </main>")
    if updated == page:
        raise RuntimeError("Could not find insertion point in index.html — layout may have changed.")
    INDEX.write_text(updated)


def git_commit_push(folder, title):
    def run(cmd):
        result = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"`{' '.join(cmd)}` failed:\n{result.stderr}")
        return result.stdout.strip()

    run(["git", "add", "--", "index.html", folder])
    run(["git", "commit", "-m", f"muse: add '{title}'"])
    run(["git", "push"])


def strip_fences(text):
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    return text.strip()


# ─────────────────────────────────────────
# Phase 1 — Opus plans
# ─────────────────────────────────────────

def plan(client, existing):
    log("Phase 1 — Opus is planning...")

    prompt = f"""You are the creative director for amanvg.com, a dark personal site.

Existing projects: {existing}

Your job: decide what ONE new project page to add next. Think carefully — pick something that:
- Is genuinely interesting or useful
- Fits the vibe (personal, exploratory, a bit nerdy)
- Can be built as a fully self-contained HTML page (no build step, no auth)
- Uses only free public APIs if any (open-meteo, Wikipedia, etc.)
- Won't duplicate what's already there

Think through a few options, then commit to the best one. Return a concise plan as JSON:
{{
  "reasoning": "Why this project, why now, what makes it interesting",
  "folder": "slug-name",
  "title": "Display Title",
  "description": "One sentence for the homepage card",
  "icon": "🔥",
  "gradient": "linear-gradient(90deg, #hex1, #hex2)",
  "tags": ["tag1", "tag2"],
  "spec": "Detailed spec for the builder: what the page does, what it looks like, any APIs to use, key interactions, dark theme details"
}}

Respond with ONLY valid JSON."""

    response = client.messages.create(
        model=OPUS,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    )

    plan_data = validate_plan(json.loads(strip_fences(response.content[0].text)))
    log(f"Opus chose: {plan_data['title']}")
    log(f"Reasoning: {plan_data['reasoning']}")
    return plan_data


# ─────────────────────────────────────────
# Phase 2 — Sonnet executes
# ─────────────────────────────────────────

def execute(client, plan_data):
    log("Phase 2 — Sonnet is building...")

    prompt = f"""You are building a web page for amanvg.com based on this plan:

Title: {plan_data['title']}
Folder: {plan_data['folder']}
Description: {plan_data['description']}
Spec: {plan_data['spec']}

Dark theme tokens:
  bg: #141414 | surface: #1e1e1e | border: #2e2e2e
  text-primary: #fff | text-secondary: #b0b0b0 | text-tertiary: #606060
  font: Inter (Google Fonts) | radius-card: 20px | radius-pill: 999px

Requirements:
- Fully self-contained single HTML file — no build step
- Back link in the nav: <a href="/">← amanvg</a> matching the main site nav style
- Sticky nav with backdrop-filter blur, border-bottom like the main site
- Must work immediately when opened — no setup, no login
- Clean, polished — match the quality of the existing pages
- If using an external API, handle errors gracefully

Return ONLY the complete HTML as a plain string (no JSON wrapper, no markdown fences)."""

    response = client.messages.create(
        model=SONNET,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}]
    )

    html = strip_fences(response.content[0].text)
    log(f"Sonnet wrote {len(html):,} chars of HTML")
    return html


# ─────────────────────────────────────────
# Main
# ─────────────────────────────────────────

def run():
    dry_run = "--dry-run" in sys.argv

    load_env()

    from anthropic import Anthropic
    client = Anthropic()

    existing = get_existing_projects()
    log(f"Existing projects: {existing}")

    # Phase 1: Opus plans
    plan_data = plan(client, existing)

    if dry_run:
        log("-- DRY RUN: plan complete, not writing anything --")
        print(json.dumps(plan_data, indent=2))
        return

    # Safety: don't overwrite existing folders
    project_dir = REPO / plan_data["folder"]
    if project_dir.exists():
        log(f"WARNING: /{plan_data['folder']}/ already exists — skipping.")
        sys.exit(0)

    # Phase 2: Sonnet builds
    html = execute(client, plan_data)

    # Write files
    project_dir.mkdir()
    (project_dir / "index.html").write_text(html)
    log(f"Wrote {project_dir}/index.html")

    add_card_to_index(plan_data)
    log("Updated index.html")

    git_commit_push(plan_data["folder"], plan_data["title"])
    log(f"Done → https://amanvg.com/{plan_data['folder']}/")


if __name__ == "__main__":
    run()
