#!/usr/bin/env python3
"""Fetch EIA state-average residential electricity prices into
commuteplanner/data/electricity-prices.json.

Scrapes EIA Electric Power Monthly Table 5.6.A (average price by state and
sector, latest month) using only the Python standard library. The commute
planner reads the JSON same-origin to price EV commutes by the home state.
EIA publishes monthly with roughly a two-month lag; rerun when convenient.

Usage: python3 commuteplanner/update_electricity.py [saved-table.html]
"""

import html
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

URL = "https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_5_6_a"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/127.0 Safari/537.36")
OUT = Path(__file__).parent / "data" / "electricity-prices.json"

STATE_CODES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
    "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC",
    "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL",
    "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
    "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
    "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
    "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR",
    "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
    "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA",
    "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
}

MONTHS = {m: i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"], start=1)}


def fetch_html():
    req = urllib.request.Request(URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as res:
        return res.read().decode("utf-8", errors="replace")


def cells(row):
    return [html.unescape(re.sub(r"<[^>]+>", "", c)).strip()
            for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]


def parse(page):
    rows = [cells(r) for r in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S)]

    # Header like "by State, June 2026 and 2025 (Cents per Kilowatthour)" -> "2026-06".
    as_of = None
    for r in rows:
        m = re.search(r"by State,\s+([A-Z][a-z]+)\s+(\d{4})", " ".join(r))
        if m and m.group(1) in MONTHS:
            as_of = f"{int(m.group(2)):04d}-{MONTHS[m.group(1)]:02d}"
            break

    # The first numeric column is Residential for the latest month, in cents/kWh.
    states, national = {}, None
    for r in rows:
        if len(r) < 2:
            continue
        name = re.sub(r"\s+", " ", r[0])
        try:
            cents = float(r[1].replace(",", ""))
        except ValueError:
            continue
        if name in STATE_CODES:
            states[STATE_CODES[name]] = round(cents / 100, 4)
        elif name.startswith("U.S."):
            national = round(cents / 100, 4)
    return as_of, national, states


def main():
    try:
        page = Path(sys.argv[1]).read_text() if len(sys.argv) > 1 else fetch_html()
        as_of, national, states = parse(page)
        if len(states) < 50:  # 50 states + DC expected
            raise ValueError(f"only parsed {len(states)} states — table layout may have changed")
        if not national:
            raise ValueError("no U.S. total row found")
        data = {
            "source": "EIA Electric Power Monthly, Table 5.6.A (residential, cents/kWh)",
            "asOf": as_of,
            "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "unit": "$/kWh",
            "national": national,
            "states": states,
        }
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
        print(f"Wrote {OUT}: {len(states)} states, US {national:.4f} $/kWh, as of {as_of}")
    except Exception as err:
        print(f"update_electricity: failed ({err}) — page will fall back to its "
              f"national-average constant", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
