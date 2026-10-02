(async function () {
  const BASE = 'https://reg-prod.ec.ucmerced.edu/StudentRegistrationSsb/ssb';
  const TERMS = ['202630'];      // edit: term codes to scrape (see getTerms endpoint)
  const FETCH_DETAILS = false;   // true = also pull description/prereqs/restrictions/etc (slow: 1 CRN = 8 requests)
  const PAGE_SIZE = 500;         // server caps this at 500 regardless of value sent
  const DETAIL_DELAY_MS = 150;   // be polite to the server between detail calls

  const qs = (p) => new URLSearchParams(p).toString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function getJSON(url) {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error(`${url} -> ${r.status}`);
    return r.json();
  }
  async function postText(path, params) {
    const r = await fetch(`${BASE}/searchResults/${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: qs(params),
    });
    return r.text();
  }

  async function fetchTerm(term) {
    console.log(`Setting term ${term}...`);
    await fetch(`${BASE}/term/saveTerm?${qs({ mode: 'search', term, uniqueSessionId: 'scrape' + Date.now() })}`, {
      credentials: 'include',
    });

    let offset = 0;
    let all = [];
    while (true) {
      const url = `${BASE}/searchResults/searchResults?${qs({
        txt_term: term,
        pageOffset: offset,
        pageMaxSize: PAGE_SIZE,
        sortColumn: 'subjectDescription',
        sortDirection: 'asc',
      })}`;
      const data = await getJSON(url);
      if (!data || !data.success || !data.data || data.data.length === 0) break;
      all = all.concat(data.data);
      console.log(`  term ${term}: ${all.length} / ${data.totalCount}`);
      if (all.length >= data.totalCount) break;
      offset += PAGE_SIZE;
    }

    if (FETCH_DETAILS) {
      for (let i = 0; i < all.length; i++) {
        const sec = all[i];
        const params = { term: sec.term, courseReferenceNumber: sec.courseReferenceNumber };
        const [description, prerequisites, restrictions, corequisites, linkedSections, fees, attributes, syllabus] =
          await Promise.all([
            postText('getCourseDescription', params),
            postText('getSectionPrerequisites', params),
            postText('getRestrictions', params),
            postText('getCorequisites', params),
            postText('getLinkedSections', params),
            postText('getFees', params),
            postText('getSectionAttributes', params),
            postText('getSyllabus', params),
          ]);
        sec.details = { description, prerequisites, restrictions, corequisites, linkedSections, fees, attributes, syllabus };
        if (i % 25 === 0) console.log(`  details ${i + 1}/${all.length}`);
        await sleep(DETAIL_DELAY_MS);
      }
    }
    return all;
  }

  const results = {};
  for (const term of TERMS) results[term] = await fetchTerm(term);

  const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ucmerced_courses_${TERMS.join('_')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  console.log('Done — file downloaded.');
})();
