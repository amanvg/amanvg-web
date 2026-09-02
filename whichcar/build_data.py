#!/usr/bin/env python3
"""Export the EPA vehicles.csv into a compact JSON the /whichcar/ page can load.

Usage: python3 whichcar/build_data.py [path/to/vehicles.csv]
Source: https://www.fueleconomy.gov/feg/download.shtml (vehicles.csv)
"""
import csv, json, sys, os

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Documents/vehicles.csv")
OUT = os.path.join(os.path.dirname(__file__), "data", "vehicles.json")

# Columns kept, in output order. Numeric ones are coerced; blanks become null.
COLS = [
    ("year", int), ("make", str), ("model", str), ("baseModel", str),
    ("VClass", str), ("drive", str), ("trany", str),
    ("cylinders", float), ("displ", float),
    ("tCharger", str), ("sCharger", str), ("atvType", str), ("fuelType", str),
    ("comb08", int), ("city08", int), ("highway08", int), ("fuelCost08", int), ("youSaveSpend", int), ("co2TailpipeGpm", float),
    ("guzzler", str), ("range", int), ("eng_dscr", str), ("evMotor", str), ("startStop", str),
]

def coerce(v, t):
    v = (v or "").strip()
    if v == "" or v == "NA":
        return None
    if t is int:
        f = float(v); return int(f) if f.is_integer() else f
    if t is float:
        f = float(v); return int(f) if f.is_integer() else f
    return v

rows = []
with open(SRC, newline="", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        rows.append([coerce(r[c], t) for c, t in COLS])

rows.sort(key=lambda r: (r[0], r[1], r[2]))
with open(OUT, "w", encoding="utf-8") as f:
    json.dump({"columns": [c for c, _ in COLS], "rows": rows}, f, separators=(",", ":"), ensure_ascii=False)
print(f"wrote {len(rows)} rows to {OUT} ({os.path.getsize(OUT)/1e6:.1f} MB)")
