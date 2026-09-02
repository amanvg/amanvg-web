#!/usr/bin/env python3
"""Fetch today's AAA state-average gas prices into commute/data/gas-prices.json.

Scrapes https://gasprices.aaa.com/state-gas-price-averages/ (updated daily)
using only the Python standard library. The commute page reads the JSON
same-origin — gasprices.aaa.com sends no CORS headers, so the browser can't
fetch it directly. Run by .github/workflows/commute-gas-prices.yml.
"""

import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

URL = "https://gasprices.aaa.com/state-gas-price-averages/"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/127.0 Safari/537.36")
OUT = Path(__file__).parent / "data" / "gas-prices.json"


def fetch_html():
    req = urllib.request.Request(URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as res:
        return res.read().decode("utf-8", errors="replace")


def parse_as_of(html):
    # "Price as of 8/31/26" -> ISO 2026-08-31
    m = re.search(r"Price as of (\d{1,2})/(\d{1,2})/(\d{2,4})", html)
    if not m:
        return None
    month, day, year = (int(g) for g in m.groups())
    if year < 100:
        year += 2000
    return f"{year:04d}-{month:02d}-{day:02d}"


def parse_states(html):
    states = {}
    for row in re.findall(r"<tr>(.*?)</tr>", html, re.S):
        code = re.search(r"\?state=([A-Z]{2})", row)
        regular = re.search(r'class="regular"[^>]*>\s*\$([\d.]+)', row)
        premium = re.search(r'class="premium"[^>]*>\s*\$([\d.]+)', row)
        if code and regular and premium:
            states[code.group(1)] = {
                "regular": round(float(regular.group(1)), 2),
                "premium": round(float(premium.group(1)), 2),
            }
    return states


def main():
    try:
        html = fetch_html()
        states = parse_states(html)
        if len(states) < 40:  # sanity check: expect 50 states + DC
            raise ValueError(f"only parsed {len(states)} states — page layout may have changed")
        data = {
            "source": "AAA Gas Prices (gasprices.aaa.com)",
            "asOf": parse_as_of(html),
            "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "states": states,
        }
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
        print(f"Wrote {OUT.relative_to(Path.cwd()) if OUT.is_relative_to(Path.cwd()) else OUT}: "
              f"{len(states)} states, prices as of {data['asOf']}")
    except Exception as err:
        print(f"update_prices: failed ({err}) — page will fall back to live "
              f"national-average scaling", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
