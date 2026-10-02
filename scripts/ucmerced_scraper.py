"""
UC Merced Class Search scraper.

Setup:
1. Log into https://reg-prod.ec.ucmerced.edu/StudentRegistrationSsb/ssb/classSearch/classSearch in your browser.
2. Open DevTools > Network, reload the page, click any request to reg-prod.ec.ucmerced.edu,
   and copy the full "Cookie" request header value.
3. Paste it into COOKIE_HEADER below.
4. pip install requests
5. python ucmerced_scraper.py
"""
import requests, json, time, sys

BASE = "https://reg-prod.ec.ucmerced.edu/StudentRegistrationSsb/ssb"
COOKIE_HEADER = "PASTE_YOUR_COOKIE_HEADER_HERE"
TERMS = ["202630"]        # term codes to scrape; see get_terms() below to list them
PAGE_SIZE = 500           # server caps this at 500 regardless of value sent
FETCH_DETAILS = False     # True = also pull description/prereqs/restrictions/etc per CRN (slow)
DETAIL_DELAY = 0.15

session = requests.Session()
session.headers.update({"Cookie": COOKIE_HEADER, "User-Agent": "Mozilla/5.0"})


def get_terms():
    r = session.get(f"{BASE}/classSearch/getTerms", params={"searchTerm": "", "offset": 1, "max": 50})
    r.raise_for_status()
    return r.json()


def set_term(term):
    r = session.get(f"{BASE}/term/saveTerm", params={"mode": "search", "term": term, "uniqueSessionId": "scrape"})
    r.raise_for_status()


def fetch_sections(term):
    set_term(term)
    offset, all_sections = 0, []
    while True:
        params = {
            "txt_term": term, "pageOffset": offset, "pageMaxSize": PAGE_SIZE,
            "sortColumn": "subjectDescription", "sortDirection": "asc",
        }
        r = session.get(f"{BASE}/searchResults/searchResults", params=params)
        r.raise_for_status()
        data = r.json()
        if not data.get("success") or not data.get("data"):
            break
        all_sections.extend(data["data"])
        total = data.get("totalCount", 0)
        print(f"  term {term}: {len(all_sections)}/{total}")
        if len(all_sections) >= total:
            break
        offset += PAGE_SIZE
    return all_sections


def fetch_details(term, crn):
    params = {"term": term, "courseReferenceNumber": crn}
    endpoints = ["getCourseDescription", "getSectionPrerequisites", "getRestrictions",
                 "getCorequisites", "getLinkedSections", "getFees", "getSectionAttributes", "getSyllabus"]
    out = {}
    for ep in endpoints:
        r = session.post(f"{BASE}/searchResults/{ep}", data=params)
        out[ep] = r.text if r.ok else None
        time.sleep(DETAIL_DELAY)
    return out


def main():
    if "PASTE_YOUR" in COOKIE_HEADER:
        sys.exit("Set COOKIE_HEADER first (see instructions at top of file).")
    results = {}
    for term in TERMS:
        print(f"Fetching term {term}...")
        sections = fetch_sections(term)
        if FETCH_DETAILS:
            for i, sec in enumerate(sections):
                sec["details"] = fetch_details(sec["term"], sec["courseReferenceNumber"])
                if i % 25 == 0:
                    print(f"    details {i + 1}/{len(sections)}")
        results[term] = sections
    with open("ucmerced_courses.json", "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print("Saved to ucmerced_courses.json")


if __name__ == "__main__":
    main()
