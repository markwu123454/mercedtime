// Banner 9 SSB client for UC Merced.
//
// Every network call in the app goes through request(). That is deliberate: four
// separate failure modes can silently break a Banner session, and they are only
// tractable if exactly one function can get them wrong.
//
//   1. Any 500 from an authenticated endpoint tears down the whole session. The
//      failing call returns its 500 normally; the *next* authenticated call is the
//      one that bounces to /saml2/authenticate. See POISONED below.
//   2. A dead session answers with the SSO login page instead of JSON, flagged by
//      the X-Login-Page response header — the same signal Banner's own bannerWeb.js
//      watches for so it never renders login HTML into a data panel.
//   3. saveTerm is keyed by mode. Priming 'search' does nothing for a page running
//      in 'courseSearch': you write one slot and read another, and searchResults
//      comes back empty with no error to explain it.
//   4. Banner resets its 25-minute idle timer from a jQuery ajaxSend hook. We use
//      fetch(), which that hook never sees, so an actively-used app still reads as
//      idle. We have to send our own keep-alive.

export const BASE = 'https://reg-prod.ec.ucmerced.edu/StudentRegistrationSsb/ssb';

const qs = (p) => new URLSearchParams(p).toString();

/** Endpoints that return 500 at UC Merced and take the session down with them.
 *  Unconfigured or unlicensed features rather than anything we are doing wrong —
 *  do not call them, and do not "handle" their errors, because by the time you see
 *  the error the session is already gone. */
export const POISONED = new Set([
    'classRegistration/getPlans',
    'contactCard/retrieveData',
]);

export class SessionExpired extends Error {
    constructor() { super('SESSION_EXPIRED'); this.name = 'SessionExpired'; }
}
export class SessionPoisoned extends Error {
    constructor(url) { super(`500 from ${url} — Banner session torn down`); this.name = 'SessionPoisoned'; }
}

const listeners = new Set();
/** Subscribe to auth transitions: fn('expired' | 'poisoned'). */
export function onSessionLost(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (kind) => listeners.forEach((fn) => fn(kind));

async function request(path, { method = 'GET', body, headers } = {}) {
    if ([...POISONED].some((p) => path.startsWith(p))) {
        throw new Error(`Refusing to call ${path}: known to 500 and poison the session.`);
    }
    const res = await fetch(`${BASE}/${path}`, {
        method,
        credentials: 'include',
        headers: { ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' } : {}), ...headers },
        body,
    });

    // Order matters: a 500 has already done its damage, so report that specifically
    // rather than letting it surface as a generic failure two calls later.
    if (res.status === 500) { emit('poisoned'); throw new SessionPoisoned(path); }
    if (res.headers.get('X-Login-Page') === 'true') { emit('expired'); throw new SessionExpired(); }
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res;
}

async function getJSON(path) {
    const res = await request(path);
    // A logged-out session can also answer with login HTML and no marker header.
    if (!(res.headers.get('content-type') || '').includes('json')) { emit('expired'); throw new SessionExpired(); }
    return res.json();
}

// --- term state -------------------------------------------------------------

/** The mode slot this app reads from. The app runs on its own page, so there is no
 *  Banner path to infer it from. */
export const currentMode = () => 'search';

// Banner's own format: 5 random characters followed by epoch milliseconds.
const uniqueSessionId = () =>
    Math.random().toString(36).slice(2, 7) + Date.now();

/** Commit a term into the session for one mode. Modes hold separate terms, which is
 *  what lets us set 'search' freely without disturbing the term the native
 *  registration page will use. Pass `mode` when priming ahead of a navigation.
 *
 *  Both steps are required, and this is the single least obvious thing about Banner.
 *  `saveTerm` alone writes a value the search endpoints do not read — verified live:
 *  after saveTerm(202610), searchResults still answered with Fall 2026 rows, and
 *  only after `POST term/search` did it return Spring 2026. `searchResults` ignores
 *  its own txt_term parameter entirely and resolves purely against session state.
 *
 *  A session that never committed a term gets zero rows back with `success: true`,
 *  which reads as "this term has no classes" rather than as a missing setup step. */
export async function saveTerm(term, mode = currentMode()) {
    await request(`term/saveTerm?${qs({ mode, term, uniqueSessionId: uniqueSessionId() })}`);
    await request(`term/search?${qs({ mode })}`, { method: 'POST', body: qs({ term, txt_term: term }) });
}

/** All terms. Public — answers with no session at all. */
export const getSearchTerms = ({ search = '', max = 100 } = {}) =>
    getJSON(`classSearch/getTerms?${qs({ searchTerm: search, offset: 1, max })}`);

/** Only terms currently open for registration. Authenticated. This list is itself
 *  the answer to "may I register, and for what" — no scraping required. */
export const getOpenTerms = ({ max = 10 } = {}) =>
    getJSON(`classRegistration/getTerms?${qs({ searchTerm: '', offset: 1, max })}`);

// --- section search (public) ------------------------------------------------

// Small pages come back much faster than large ones — the server cost is superlinear
// in pageMaxSize — so 50-row pages beat 500 for total load *and* paint incrementally.
const PAGE_SIZE = 50;

/** Stream every section for a term. onPage(rows, loaded, total) fires per page. */
export async function searchResults(term, { onPage } = {}) {
    let offset = 0;
    const all = [];
    for (;;) {
        // txt_term is ignored by the server — the term comes from session state set by
        // saveTerm() above. Sent anyway because Banner's own client sends it, so we
        // stay indistinguishable from it if that ever starts mattering.
        const data = await getJSON(`searchResults/searchResults?${qs({
            txt_term: term,
            pageOffset: offset,
            pageMaxSize: PAGE_SIZE,
            sortColumn: 'subjectDescription',
            sortDirection: 'asc',
        })}`);
        if (!data?.success || !data.data?.length) break;
        all.push(...data.data);
        const total = data.totalCount ?? all.length;
        onPage?.(data.data, all.length, total);
        offset += data.data.length;          // advance by rows actually returned
        if (all.length >= total) break;
    }
    return all;
}

// These answer with HTML fragments, not JSON, and are fetched lazily per section.
const DETAIL_ENDPOINTS = {
    description: 'getCourseDescription',
    prerequisites: 'getSectionPrerequisites',
    restrictions: 'getRestrictions',
    corequisites: 'getCorequisites',
    linkedSections: 'getLinkedSections',
    fees: 'getFees',
    attributes: 'getSectionAttributes',
};

const detailCache = new Map();

/** Fetch a section's detail fragments.
 *  Sequential on purpose. These went out as seven concurrent POSTs in the previous
 *  version, through a helper that never checked res.ok — so a 500 from any one of
 *  them was cached as legitimate fragment text while quietly killing the session.
 *  request() now throws on 500, and running in series means we stop at the first one
 *  instead of firing six more calls into a session that is already gone. */
export async function getDetails(term, crn) {
    const key = `${term}:${crn}`;
    if (detailCache.has(key)) return detailCache.get(key);
    const out = {};
    for (const [field, path] of Object.entries(DETAIL_ENDPOINTS)) {
        const res = await request(`searchResults/${path}`, {
            method: 'POST',
            body: qs({ term, courseReferenceNumber: crn }),
        });
        out[field] = (await res.text()).trim();
    }
    detailCache.set(key, out);
    return out;
}

export const peekDetails = (term, crn) => detailCache.get(`${term}:${crn}`);

// --- personal data (authenticated) ------------------------------------------
// Prefer the explicit-term endpoints. They need no saved-term state, so the app can
// switch terms client-side without mutating anything the native pages read.

/** Registrations with grades, add/drop dates, credit totals and the override flags.
 *  Takes the term explicitly, which makes it the most reliable thing to call cold. */
export const getRegistrations = (term) =>
    getJSON(`registrationHistory/reset?${qs({ term })}`);

/** Active registrations across every term. */
export const getActiveRegistrations = () =>
    getJSON('registrationHistory/renderActiveRegistrations');

/** Meetings and final exams, flattened into calendar events. Empty termFilter means
 *  the current session term; pass a code to be explicit. */
export const getRegistrationEvents = (term = '') =>
    getJSON(`classRegistration/getRegistrationEvents?${qs({ termFilter: term })}`);

/** Registration status: holds, time ticket, class standing, primary curriculum.
 *  There is no JSON for this — prepareRegistration fires no data XHR at all and the
 *  panel is server-rendered — so this returns HTML for the caller to parse. Needs
 *  mode=preReg primed first, which is a different slot from mode=registration and so
 *  cannot disturb the native register flow. */
export async function getRegistrationStatusHTML(term) {
    await saveTerm(term, 'preReg');
    const res = await request('prepareRegistration/prepareRegistration');
    return res.text();
}

// --- keep-alive --------------------------------------------------------------

let keepAliveTimer = null;

/** Banner's idle timeout is 25 minutes (maxInactiveInterval 1500) and its own timer
 *  only resets on jQuery XHRs, which ours are not. Ten minutes leaves room for a
 *  missed tick. Paused while the tab is hidden so a background tab does not hold a
 *  session open indefinitely. */
export function startKeepAlive({ intervalMs = 10 * 60 * 1000 } = {}) {
    stopKeepAlive();
    const ping = () => {
        if (document.visibilityState !== 'visible') return;
        request('keepAlive/data').catch(() => { /* onSessionLost subscribers handle it */ });
    };
    keepAliveTimer = setInterval(ping, intervalMs);
    return stopKeepAlive;
}

export function stopKeepAlive() {
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = null;
}
