#!/usr/bin/env python3
"""Build cve/data/snapshot.json for the CVE Triage page.

Sources (stdlib only, no keys):
  CISA KEV            known_exploited_vulnerabilities.json   (no CORS, so scraped here)
  FIRST EPSS          epss_scores-current.csv.gz
  NVD 2.0             CVEs published in the window (discovery only)
  CVE.org (cveawg)    CVSS, SSVC exploitation from CISA Vulnrichment, vendor/product

Candidates are every KEV entry added in the window, plus CVEs published in the
window that have EPSS >= EPSS_MIN or a CISA exploitation of poc/active.
The page decides the tier (CISA SSVC Table 9); this script only collects facts.
exploitation/automatable/impact are CISA's published SSVC values, or null when
CISA has not scored the CVE (KEV entries are always "active").

Usage: python3 cve/update.py
"""
import csv
import gzip
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

WINDOW_DAYS = 30
EPSS_MIN = 0.1        # a non-KEV CVE is a candidate at or above this score
EPSS_LOOKUP = 0.02    # CVEs at or above this get an SSVC lookup for a PoC signal
MAX_LIKELY = 150
OUT = Path(__file__).parent / "data" / "snapshot.json"

KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
EPSS_URL = "https://epss.cyentia.com/epss_scores-current.csv.gz"
NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"
CVE_URL = "https://cveawg.mitre.org/api/cve/"
UA = "amanvg.com-cve-triage (+https://www.amanvg.com/cve/)"


def get(url, tries=4, timeout=60):
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            err = e
        except Exception as e:  # network blips, NVD 5xx
            err = e
        time.sleep(3 * (n + 1))
    raise RuntimeError(f"{url}: {err}")


def get_json(url, **kw):
    raw = get(url, **kw)
    return None if raw is None else json.loads(raw)


def load_kev(since):
    d = get_json(KEV_URL)
    entries = {}
    for v in d["vulnerabilities"]:
        if v["dateAdded"] >= since:
            entries[v["cveID"]] = v
    return d["catalogVersion"], d["count"], entries


def load_epss():
    raw = gzip.decompress(get(EPSS_URL)).decode()
    lines = raw.splitlines()
    date = lines[0].split("score_date:")[1][:10]
    rows = csv.reader(io.StringIO("\n".join(lines[1:])))
    next(rows)
    return date, {r[0]: (float(r[1]), float(r[2])) for r in rows}


def load_published(start, end):
    """IDs and publish dates of CVEs published in [start, end] (NVD, paged)."""
    out, idx = {}, 0
    while True:
        q = urllib.parse.urlencode({
            "pubStartDate": start.strftime("%Y-%m-%dT%H:%M:%S.000"),
            "pubEndDate": end.strftime("%Y-%m-%dT%H:%M:%S.000"),
            "resultsPerPage": 2000, "startIndex": idx,
        })
        d = get_json(f"{NVD_URL}?{q}", timeout=120)
        for v in d["vulnerabilities"]:
            out[v["cve"]["id"]] = v["cve"]["published"][:10]
        idx += d["resultsPerPage"]
        if idx >= d["totalResults"]:
            return out
        time.sleep(7)  # NVD allows 5 requests per 30 s without a key


def best_cvss(cna, adp):
    """Highest-priority base score and vector: CNA v4/v3.1/v3.0, then ADP."""
    for container in [cna] + adp:
        for m in container.get("metrics") or []:
            for key in ("cvssV4_0", "cvssV3_1", "cvssV3_0"):
                if key in m and "baseScore" in m[key]:
                    return float(m[key]["baseScore"]), m[key]["version"], m[key].get("vectorString")
    return None, None, None


def enrich(cve_id):
    """CVSS, vendor/product, title and CISA SSVC options from the CVE record."""
    d = get_json(CVE_URL + cve_id, tries=2)
    if not d or "containers" not in d:
        return {}
    cna, adp = d["containers"].get("cna", {}), d["containers"].get("adp", [])
    info = {}
    info["cvss"], info["cvssVersion"], info["cvssVector"] = best_cvss(cna, adp)
    for a in [cna] + adp:
        for aff in a.get("affected") or []:
            if aff.get("vendor") and aff.get("product"):
                info["vendor"], info["product"] = aff["vendor"], aff["product"]
                break
        if "vendor" in info:
            break
    info["title"] = cna.get("title")
    cwe_id, named, plain = None, None, None
    for a in [cna] + adp:
        for pt in a.get("problemTypes") or []:
            for dsc in pt.get("descriptions") or []:
                text = (dsc.get("description") or "").strip()
                m = re.match(r"^(CWE-\d+)\b\s*[:\-]?\s*(.*)$", text)
                cid = dsc.get("cweId") or (m.group(1) if m else "")
                if not cwe_id and re.fullmatch(r"CWE-\d+", cid):
                    cwe_id = cid
                if m and m.group(2) and not named:
                    named = m.group(2)
                elif not m and text and not text.upper().startswith("NVD-CWE-") and not plain:
                    plain = text
    info["cweId"] = cwe_id
    info["cwe"] = named or plain
    for a in adp:
        for m in a.get("metrics") or []:
            o = (m.get("other") or {})
            if o.get("type") == "ssvc":
                opts = {k: v for opt in o["content"]["options"] for k, v in opt.items()}
                info["exploitation"] = opts.get("Exploitation")
                info["automatable"] = opts.get("Automatable")
                info["impact"] = opts.get("Technical Impact")
    return info


def main():
    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=WINDOW_DAYS)).strftime("%Y-%m-%d")

    version, kev_count, kev = load_kev(since)
    epss_date, epss = load_epss()

    previous = json.loads(OUT.read_text()) if OUT.exists() else None
    try:
        published = load_published(now - timedelta(days=WINDOW_DAYS), now)
    except Exception as e:
        # NVD is flaky; keep KEV current and carry the last likely-next list.
        print(f"NVD unavailable ({e}); carrying previous likely-next list", file=sys.stderr)
        published = None

    likely_ids = []
    if published is not None:
        pool = [(c, epss[c][0]) for c in published if c in epss and c not in kev and epss[c][0] >= EPSS_LOOKUP]
        pool.sort(key=lambda t: -t[1])
        likely_ids = [c for c, _ in pool]
    elif previous:
        likely_ids = [i["id"] for i in previous["items"] if not i["kev"]]

    items = []
    for cve_id in sorted(kev):
        k = kev[cve_id]
        info = enrich(cve_id)
        items.append({
            "id": cve_id,
            "vendor": k["vendorProject"], "product": k["product"],
            "name": k["vulnerabilityName"],
            "published": None,
            "kev": {
                "added": k["dateAdded"], "due": k["dueDate"],
                "ransomware": k.get("knownRansomwareCampaignUse") == "Known",
            },
            "epss": round(epss[cve_id][0], 3) if cve_id in epss else None,
            "percentile": round(epss[cve_id][1], 3) if cve_id in epss else None,
            "cvss": info.get("cvss"), "cvssVersion": info.get("cvssVersion"),
            "cvssVector": info.get("cvssVector"),
            "exploitation": "active",
            "automatable": info.get("automatable"), "impact": info.get("impact"),
            "cweId": info.get("cweId"), "cwe": info.get("cwe"),
        })
        time.sleep(0.15)

    likely = []
    for cve_id in likely_ids:
        score, pct = epss[cve_id]
        info = enrich(cve_id)
        time.sleep(0.15)
        exploitation = info.get("exploitation")
        if score < EPSS_MIN and exploitation in (None, "none"):
            continue
        likely.append({
            "id": cve_id,
            "vendor": info.get("vendor"), "product": info.get("product"),
            "name": info.get("title"),
            "published": (published or {}).get(cve_id),
            "kev": None,
            "epss": round(score, 3), "percentile": round(pct, 3),
            "cvss": info.get("cvss"), "cvssVersion": info.get("cvssVersion"),
            "cvssVector": info.get("cvssVector"),
            "exploitation": exploitation,
            "automatable": info.get("automatable"), "impact": info.get("impact"),
            "cweId": info.get("cweId"), "cwe": info.get("cwe"),
        })
        if len(likely) >= MAX_LIKELY:
            break
    items += sorted(likely, key=lambda i: i["id"])

    snapshot = {
        "generatedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "windowDays": WINDOW_DAYS,
        "kevCatalogVersion": version,
        "kevCount": kev_count,
        "epssDate": epss_date,
        "items": items,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(snapshot, indent=1, ensure_ascii=False) + "\n")
    n_kev = sum(1 for i in items if i["kev"])
    print(f"{len(items)} items ({n_kev} KEV, {len(items) - n_kev} likely-next)")


if __name__ == "__main__":
    main()
