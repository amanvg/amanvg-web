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

with open(SRC, newline="", encoding="utf-8") as f:
    raw = list(csv.DictReader(f))

# ── Derived sizeClass ──────────────────────────────────────────────────────
# EPA only sized SUVs (small/standard) from 2013 and vans (cargo/passenger)
# from 1998. Older rows get a size by, in order: the same make+baseModel's
# later EPA size; for vans, cargo/passenger words in the model name; for
# SUVs, displacement under 3.0 L = small (where EPA's own classes split).
SMALL_SUV = {"Small Sport Utility Vehicle 2WD", "Small Sport Utility Vehicle 4WD"}
STD_SUV = {"Standard Sport Utility Vehicle 2WD", "Standard Sport Utility Vehicle 4WD"}
UNSIZED_SUV = {"Sport Utility Vehicle - 2WD", "Sport Utility Vehicle - 4WD", "Special Purpose Vehicle",
               "Special Purpose Vehicle 2WD", "Special Purpose Vehicle 4WD", "Special Purpose Vehicles",
               "Special Purpose Vehicles/2wd", "Special Purpose Vehicles/4wd"}
CARGO_VAN = {"Vans, Cargo Type"}
PASS_VAN = {"Vans, Passenger Type", "Vans Passenger"}
UNSIZED_VAN = {"Vans"}

def direct_size(vc):
    if vc in SMALL_SUV: return "small"
    if vc in STD_SUV: return "standard"
    if vc in CARGO_VAN: return "cargo"
    if vc in PASS_VAN: return "passenger"
    return None

votes = {}
for r in raw:
    sz = direct_size(r["VClass"])
    if sz:
        votes.setdefault((r["make"], r["baseModel"]), []).append(sz)
model_size = {k: max(set(v), key=v.count) for k, v in votes.items()}

def infer_size(r):
    vc = r["VClass"]
    sz = direct_size(vc)
    if sz: return sz
    key = (r["make"], r["baseModel"])
    if vc in UNSIZED_SUV:
        if key in model_size and model_size[key] in ("small", "standard"): return model_size[key]
        d = coerce(r["displ"], float)
        return None if d is None else ("small" if d < 3.0 else "standard")
    if vc in UNSIZED_VAN:
        if key in model_size and model_size[key] in ("cargo", "passenger"): return model_size[key]
        m = r["model"].lower()
        if "cargo" in m: return "cargo"
        if any(w in m for w in ("passenger", "wagon", "rally", "sport van", "club")): return "passenger"
        if " van" in m or m.endswith("van") or "vandura" in m or "econoline" in m: return "cargo"
        return None
    return None

rows = []
for r in raw:
    rows.append([coerce(r[c], t) for c, t in COLS] + [infer_size(r)])

rows.sort(key=lambda r: (r[0], r[1], r[2]))
with open(OUT, "w", encoding="utf-8") as f:
    json.dump({"columns": [c for c, _ in COLS] + ["sizeClass"], "rows": rows}, f, separators=(",", ":"), ensure_ascii=False)
print(f"wrote {len(rows)} rows to {OUT} ({os.path.getsize(OUT)/1e6:.1f} MB)")
