"""
UC Merced Class Search scraper (Banner 9 Self-Service).

No login required — the classSearch endpoints are public. The important part is the
session handshake: searchResults returns whatever term is stored on the JSESSIONID,
NOT what you pass in txt_term. So we must POST term/search first with the same
uniqueSessionId we later query with, or we silently get the previous term's data.

    python scrape_fall2026.py [term_code]     # default 202630 = Fall Semester 2026
"""
import json
import sys
import time

import requests

BASE = "https://reg-prod.ec.ucmerced.edu/StudentRegistrationSsb/ssb"
TERM = sys.argv[1] if len(sys.argv) > 1 else "202630"
PAGE_SIZE = 500          # server caps at 500 regardless of what we send
UNIQUE_SESSION_ID = "scrape123456789"

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "X-Requested-With": "XMLHttpRequest",
})


def term_name(term):
    r = session.get(f"{BASE}/classSearch/getTerms",
                    params={"searchTerm": "", "offset": 1, "max": 100}, timeout=30)
    r.raise_for_status()
    for t in r.json():
        if t["code"] == term:
            return t["description"]
    raise SystemExit(f"Term {term} not offered. Available: "
                     + ", ".join(f'{t["code"]}={t["description"]}' for t in r.json()[:6]))


def open_session(term):
    """Establish JSESSIONID and bind the term to it."""
    session.get(f"{BASE}/term/termSelection", params={"mode": "search"}, timeout=30)
    r = session.post(f"{BASE}/term/search", params={"mode": "search"}, timeout=30, data={
        "term": term,
        "studyPath": "",
        "studyPathText": "",
        "startDatepicker": "",
        "endDatepicker": "",
        "uniqueSessionId": UNIQUE_SESSION_ID,
    })
    r.raise_for_status()


def fetch_sections(term):
    open_session(term)
    offset, all_sections = 0, []
    while True:
        r = session.get(f"{BASE}/searchResults/searchResults", timeout=60, params={
            "txt_term": term,
            "startDatepicker": "",
            "endDatepicker": "",
            "uniqueSessionId": UNIQUE_SESSION_ID,
            "pageOffset": offset,
            "pageMaxSize": PAGE_SIZE,
            "sortColumn": "subjectDescription",
            "sortDirection": "asc",
        })
        r.raise_for_status()
        data = r.json()
        if not data.get("success"):
            raise SystemExit(f"searchResults failed at offset {offset}: {data}")
        rows = data.get("data") or []
        if not rows:
            break

        bad = {s.get("term") for s in rows} - {term}
        if bad:
            raise SystemExit(f"Server returned term(s) {bad} instead of {term} — "
                             "session/term binding broke, aborting rather than saving wrong data.")

        all_sections.extend(rows)
        total = data.get("totalCount", 0)
        print(f"  {len(all_sections)}/{total}")
        if len(all_sections) >= total or len(rows) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
        # reset between pages so Banner doesn't reuse a stale result set
        session.post(f"{BASE}/classSearch/resetDataForm", timeout=30)
        open_session(term)
        time.sleep(0.3)
    return all_sections


def main():
    desc = term_name(TERM)
    print(f"Fetching {TERM} ({desc})...")
    sections = fetch_sections(TERM)

    seen, unique = set(), []
    for s in sections:
        crn = s.get("courseReferenceNumber")
        if crn not in seen:
            seen.add(crn)
            unique.append(s)

    out = f"ucmerced_courses_{TERM}.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump({TERM: unique}, f, indent=2)
    print(f"Saved {len(unique)} sections ({desc}) to {out}")


if __name__ == "__main__":
    main()
