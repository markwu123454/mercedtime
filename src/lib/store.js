// Shared state, plus the plan that outlives a session.
//
// Small enough not to need a state library: one object, one subscriber set, and a
// React hook over useSyncExternalStore. Views read from here and never fetch.

import { useSyncExternalStore } from 'react';
import * as api from './api.js';
import { courseKey } from './sections.js';
import * as cache from './cache.js';
import { courseList, termLabel } from './courses.js';
import { byCourse } from './generate.js';
import { DEFAULT_SETTINGS } from './schedule.js';
import { normalizeRegistration, registrationRows, calendarTerm } from './registrations.js';
import { parseTimeTicket } from './banner.js';

const PLAN_KEY = 'mercedtime_plan_v2';
const TERM_KEY = 'mercedtime_term';
const SETTINGS_KEY = 'mercedtime_settings';

let state = {
    route: 'home',          // which tab is showing; decides which term's catalog loads
    term: null,
    terms: [],
    openTerms: [],          // terms open for registration — the "may I register" signal
    sections: [],           // the selected term's catalog
    sectionsByTerm: {},     // every catalog loaded this session, so a term loads once
    loading: false,
    loadingText: '',
    error: null,
    auth: 'unknown',        // 'unknown' | 'in' | 'out'
    userName: null,
    notifications: [],
    // The plan, per term: { [term]: { [courseKey]: { key, subject, number, title, crns, info } } }.
    // Keyed by course because a future term's CRNs are not published yet; a CRN is added
    // to its course once a section exists. `info` snapshots the section label per CRN so
    // the home page can list CRNs without loading that term's catalog.
    planAll: {},
    plan: new Set(),        // CRNs planned for the selected term — drives "My plan" in Find classes
    registered: {},         // { [term]: { status: 'loading' | 'ok' | 'error', rows: [] } }
    home: { status: 'idle', error: null, currentTerm: null, nextTerm: null, activeRows: [] },
    tickets: {},            // { [term]: { status: 'loading' | 'ok' | 'error', at: ms | null, text } }
    settings: DEFAULT_SETTINGS,
    discovery: { status: 'idle', checked: 0 },
    cacheMeta: {},          // { [term]: { fetchedAt, count } } for every downloaded catalog
    courseIndex: {},        // { [term]: [[key, subject, number, title]] } for every downloaded catalog
    downloads: { status: 'idle', term: null, mode: null, bg: false, loaded: 0, total: 0 },   // the search for past semesters (see discoverTerms)
};

const subs = new Set();
export const getState = () => state;
export function set(patch) {
    state = { ...state, ...patch };
    subs.forEach((fn) => fn());
}
const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };

/** Read one slice of state. Pass a selector so a view only re-renders for what it uses. */
export function useStore(select = (s) => s) {
    return useSyncExternalStore(subscribe, () => select(state));
}

const crnSet = (items) => new Set(Object.values(items || {}).flatMap((i) => i.crns));

// --- plan persistence --------------------------------------------------------

async function savePlan(planAll) {
    set({ planAll, plan: crnSet(planAll[state.term]) });
    await chrome.storage.local.set({ [PLAN_KEY]: planAll });
}

const withTerm = (planAll, term, fn) => {
    const items = { ...(planAll[term] || {}) };
    fn(items);
    return { ...planAll, [term]: items };
};

const newItem = (c) => ({
    key: c.key, subject: c.subject, number: c.number, title: c.title || '', crns: [], info: {},
});

/** Add or remove a whole course from a term's plan. */
export function togglePlanCourse(term, course) {
    return savePlan(withTerm(state.planAll, term, (items) => {
        if (items[course.key]) delete items[course.key];
        else items[course.key] = newItem(course);
    }));
}

export const addPlanCourse = (term, course) =>
    savePlan(withTerm(state.planAll, term, (items) => { items[course.key] ??= newItem(course); }));

/** Add or remove one section (by CRN) under its course in the selected term's plan.
 *  Planning a section also plans its course. */
export function togglePlanSection(sec, term = state.term) {
    const crn = sec.courseReferenceNumber;
    const key = courseKey(sec);
    return savePlan(withTerm(state.planAll, term, (items) => {
        const item = { ...(items[key] || newItem({
            key, subject: sec.subject, number: sec.courseNumber, title: sec.courseTitle,
        })) };
        item.title ||= sec.courseTitle || '';
        if (item.crns.includes(crn)) {
            item.crns = item.crns.filter((c) => c !== crn);
            item.info = { ...item.info };
            delete item.info[crn];
        } else {
            item.crns = [...item.crns, crn];
            item.info = { ...item.info, [crn]: { seq: sec.sequenceNumber, type: sec.scheduleTypeDescription } };
        }
        items[key] = item;
    }));
}

/** Make a generated schedule the plan for its courses: each course's picked sections
 *  are replaced by this schedule's. Courses not in the schedule are left alone. */
export function applySchedule(term, sections) {
    return savePlan(withTerm(state.planAll, term, (items) => {
        for (const [key, secs] of byCourse(sections)) {
            const first = secs[0];
            const item = { ...(items[key] || newItem({
                key, subject: first.subject, number: first.courseNumber, title: first.courseTitle,
            })) };
            item.crns = secs.map((s) => s.courseReferenceNumber);
            item.info = Object.fromEntries(secs.map((s) => [s.courseReferenceNumber, { seq: s.sequenceNumber, type: s.scheduleTypeDescription }]));
            items[key] = item;
        }
    }));
}

// --- settings -----------------------------------------------------------------

export async function updateSettings(patch) {
    const settings = { ...state.settings, ...patch };
    set({ settings });
    refocus();     // download settings change what the loader should be doing
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

// --- session -----------------------------------------------------------------

// A lost session is a first-class state, never an empty table. Search is public, so
// the app stays useful signed out — only the personal routes need to say so.
api.onSessionLost((kind) => set({
    auth: 'out',
    error: kind === 'poisoned'
        ? 'Banner ended the session after a server error. Reload to sign back in.'
        : null,
}));

// --- catalogs ------------------------------------------------------------------

// Every catalog is downloaded once and kept (IndexedDB, see cache.js). The loader works
// on one thing at a time, a page at a time, and picks what by priority:
//
//   1. the term the user is looking at, if it has never been downloaded
//   2. that term's seat numbers, if the user is viewing seats and the copy is stale
//   3. in the background, the next term nobody has downloaded yet
//
// Seats are only refreshed for what is being viewed; background downloads never
// refresh anything already saved. Switching what is wanted pauses the current job at
// the next page and keeps its progress; coming back resumes at that offset.
//
// One fetcher is also a correctness requirement. searchResults reads the term from
// session state, so two downloads at once would trample each other's saveTerm. After a
// pause the session holds the other term, so the term is committed again first.
const SEAT_TTL_MS = 5 * 60 * 1000;         // how old a copy may be before viewing it refreshes seats
const BG_PAGE_DELAY_MS = 250;              // background downloads go gently
const EMPTY_RETRY_MS = 30 * 60 * 1000;     // how long before asking again about a term with no classes
const PARTIAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REFRESH_RESTART_MS = 3 * 60 * 1000;  // an abandoned seat refresh this old starts over
const PAGE_RETRIES = 3;                    // a page that fails is asked for again this many times

/** Delays that tests shorten. retryMs: before a download that gave up tries again, from
 *  where it stopped. backoffMs: base wait between attempts at a failing page. */
export const tuning = { retryMs: 60 * 1000, backoffMs: 500 };

const loads = new Map();     // `${mode}:${term}` -> { mode, term, rows, offset, total, failed, waiters, ... }
const emptyAt = new Map();   // term -> when Banner last answered with no classes for it
const forced = new Set();    // terms whose seats the user asked to refresh now
const hydrating = new Map();
let committed = null;        // the term the session's search state currently holds
let running = false;
let lastProgress = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isListed = (t) => state.terms.some((x) => String(x.code) === String(t));
const inMemory = (t) => !!state.sectionsByTerm[t];
const isCached = (t) => !!state.cacheMeta[t];

/** The term the user currently needs. On Home that is the term its schedule is drawn
 *  from; everywhere else it is the term picked in the toolbar. */
const wantedTerm = () =>
    (state.route === 'home' ? state.home.currentTerm : null) || state.term;

/** Seats matter on the pages that show them. */
const viewingSeats = () => state.route === 'search' || state.route === 'plan';

const entry = (mode, term) => {
    const key = `${mode}:${term}`;
    if (!loads.has(key)) {
        loads.set(key, { mode, term, rows: [], offset: 0, total: 0, failedAt: 0, retries: 0, waiters: [], init: false, pages: 0, startedAt: Date.now() });
    }
    return loads.get(key);
};

/** A download that gave up is left alone for a while, then picked up again from where it
 *  stopped. Giving up is never final. */
const resting = (l) => !!l && l.failedAt && Date.now() - l.failedAt < tuning.retryMs;

/** Bring a saved catalog into memory. */
function hydrate(term) {
    if (state.sectionsByTerm[term]) return Promise.resolve(state.sectionsByTerm[term]);
    if (!hydrating.has(term)) {
        hydrating.set(term, cache.getCatalog(term).then((c) => {
            hydrating.delete(term);
            if (!c) return [];
            set({ sectionsByTerm: { ...state.sectionsByTerm, [term]: c.rows } });
            return c.rows;
        }));
    }
    return hydrating.get(term);
}

function bgCandidates() {
    if (!state.settings.backgroundDownload) return [];
    const desc = state.terms.map((t) => String(t.code)).sort((a, b) => Number(b) - Number(a));
    const planned = Object.keys(state.planAll).filter((t) => Object.keys(state.planAll[t] || {}).length);
    const now = Date.now();
    return [...new Set([...planned, ...(state.settings.extraTerms || []), ...desc.slice(0, state.settings.keepTerms)])]
        .filter((t) => isListed(t) && !isCached(t) && !resting(loads.get(`full:${t}`))
            && !(emptyAt.has(t) && now - emptyAt.get(t) < EMPTY_RETRY_MS));
}

function pickJob() {
    const fg = wantedTerm();
    if (fg && isListed(fg)) {
        const full = loads.get(`full:${fg}`);
        if (full && !resting(full) && !inMemory(fg) && !isCached(fg)) return { term: fg, mode: 'full', bg: false };
        if (viewingSeats() && fg === state.term && isCached(fg) && !resting(loads.get(`refresh:${fg}`))
            && (forced.has(fg) || Date.now() - state.cacheMeta[fg].fetchedAt > SEAT_TTL_MS)) {
            return { term: fg, mode: 'refresh', bg: false };
        }
    }
    const next = bgCandidates()[0];
    return next ? { term: next, mode: 'full', bg: true } : null;
}

const dedupe = (rows) => [...new Map(rows.map((r) => [r.courseReferenceNumber, r])).values()];

async function saveCatalog(term, rows, total) {
    const fetchedAt = Date.now();
    await cache.putCatalog(term, rows, fetchedAt, total);
    const list = courseList(rows);
    cache.putCourses(term, list);
    set({
        cacheMeta: { ...state.cacheMeta, [term]: { fetchedAt, count: rows.length, total } },
        courseIndex: { ...state.courseIndex, [term]: list },
    });
}

/** Fetch the next page of a download. Returns true when the term is complete.
 *
 *  A page counts only if it is good: Banner reported success, the rows belong to this
 *  term, and an empty page only ends the list when Banner's own total says the list is
 *  over. Anything else (a failed page, rows from another term because something else
 *  changed the session's term, an empty page part way through) throws, and the caller
 *  asks again with the term committed afresh. Treating those as "the end" is what used to
 *  save half a term as if it were the whole thing. */
async function stepPage(l, bg) {
    if (l.mode === 'full' && !l.init) {
        l.init = true;
        const part = await cache.getPartial(l.term);
        if (part && !l.rows.length && Date.now() - part.savedAt < PARTIAL_MAX_AGE_MS) {
            l.rows = part.rows; l.offset = part.offset; l.total = part.total || 0;     // resume an earlier download
        }
    }
    if (bg) await sleep(BG_PAGE_DELAY_MS);
    if (committed !== l.term) {
        committed = null;
        await api.saveTerm(l.term);
        committed = l.term;
    }
    const res = await api.searchPage(l.term, l.offset);
    if (!res.ok) throw new Error('Banner did not return the next page');
    if (res.rows.some((r) => r.term && String(r.term) !== String(l.term))) {
        committed = null;
        throw new Error('Banner returned another term; the session lost this one');
    }
    if (res.total != null) l.total = res.total;

    if (!res.rows.length) {
        if (l.total > 0 && l.offset < l.total) {
            committed = null;
            throw new Error(`Banner returned an empty page at ${l.offset} of ${l.total}`);
        }
        return true;                                  // nothing here, and Banner agrees the list is over
    }
    l.rows.push(...res.rows);
    l.offset += res.rows.length;
    l.pages++;
    l.retries = 0;

    if (l.mode === 'full' && state.term === l.term) set({ sections: [...l.rows], loadingText: `Loading… ${l.offset} / ${l.total || '?'}` });
    if (l.mode === 'full' && l.pages % 3 === 0) cache.putPartial(l.term, { rows: l.rows, offset: l.offset, total: l.total });
    // Progress for the status line, at most a few times a second.
    if (Date.now() - lastProgress > 700) {
        lastProgress = Date.now();
        set({ downloads: { status: 'running', term: l.term, mode: l.mode, bg, loaded: l.offset, total: l.total } });
    }
    return l.total > 0 ? l.offset >= l.total : false;
}

async function finish(l) {
    loads.delete(`${l.mode}:${l.term}`);
    const { term } = l;

    if (l.mode === 'full') {
        const rows = dedupe(l.rows);
        cache.delPartial(term);
        if (!rows.length) {
            // Not cached: it can be a term whose classes are not published, or a session
            // that never committed the term, and either deserves another look later.
            emptyAt.set(term, Date.now());
            l.waiters.forEach((w) => w.resolve([]));
            return;
        }
        await saveCatalog(term, rows, l.total || rows.length);
        // Memory only for what is being used; a background download is saved and dropped.
        if (l.waiters.length || term === state.term || term === wantedTerm()) {
            set({ sectionsByTerm: { ...state.sectionsByTerm, [term]: rows } });
        }
        // A download that gave up and later finished on its own: bring the page up to date.
        if (term === state.term) set({ sections: rows, loading: false, loadingText: '', error: null });
        l.waiters.forEach((w) => w.resolve(rows));
        return;
    }

    // refresh: newer rows replace their saved copies; classes new since the download are added
    const base = state.sectionsByTerm[term] || (await cache.getCatalog(term))?.rows || [];
    const merged = dedupe([...base, ...l.rows]);
    await saveCatalog(term, merged, Math.max(l.total, merged.length));
    forced.delete(term);
    if (inMemory(term)) set({ sectionsByTerm: { ...state.sectionsByTerm, [term]: merged } });
    if (state.term === term) set({ sections: merged });
}

async function runLoader() {
    if (running) return;
    running = true;
    try {
        for (;;) {
            const fg = wantedTerm();
            if (fg && isCached(fg) && !inMemory(fg)) await hydrate(fg);     // saved copy first
            const job = pickJob();
            if (!job) { set({ downloads: { status: 'idle', term: null, mode: null, bg: false, loaded: 0, total: 0 } }); return; }

            const l = entry(job.mode, job.term);
            if (job.mode === 'refresh' && !l.rows.length && Date.now() - l.startedAt > REFRESH_RESTART_MS) l.startedAt = Date.now();
            try {
                if (await stepPage(l, job.bg)) await finish(l);
            } catch (e) {
                // Ask for the same page again a few times; the loop will pick this job up
                // again where it left off. After that, give up for a while (never for good).
                if (l.mode === 'full') cache.putPartial(l.term, { rows: l.rows, offset: l.offset, total: l.total });
                if (++l.retries <= PAGE_RETRIES) { await sleep(tuning.backoffMs * 2 ** (l.retries - 1)); continue; }
                l.retries = 0;
                l.failedAt = Date.now();
                l.waiters.splice(0).forEach((w) => w.reject(e));
                set({ downloads: { status: 'idle', term: null, mode: null, bg: false, loaded: 0, total: 0 } });
                setTimeout(refocus, tuning.retryMs + 50);
            }
        }
    } finally {
        running = false;
    }
}

/** Point the loader at whatever the user currently needs. Call after anything that
 *  changes that: the selected term, the route, the home page's term, the settings. */
export function refocus() { runLoader(); }

export function setRoute(route) {
    set({ route });
    refocus();
}

/** One term's full section list, resolved once it is available: from memory, from the
 *  saved copy, or downloaded. Does not by itself make the term the active one; a
 *  download runs while the term is wanted (see wantedTerm), else in the background. */
export async function loadSections(term) {
    if (state.sectionsByTerm[term]) return state.sectionsByTerm[term];
    if (isCached(term)) return hydrate(term);
    if (!isListed(term)) return [];            // a semester Banner does not list yet has nothing to fetch
    emptyAt.delete(term);                      // asking again is a retry
    const l = entry('full', term);
    l.failedAt = 0;
    l.retries = 0;
    const p = new Promise((resolve, reject) => l.waiters.push({ resolve, reject }));
    refocus();
    return p;
}

/** Re-read seat numbers for a term now, instead of waiting for them to go stale. */
export function refreshSeats(term = state.term) {
    forced.add(term);
    loads.delete(`refresh:${term}`);     // also clears a refresh that gave up
    refocus();
}

export async function selectTerm(term) {
    set({ term, error: null, plan: crnSet(state.planAll[term]) });
    await chrome.storage.local.set({ [TERM_KEY]: term });

    const inMem = state.sectionsByTerm[term];
    if (inMem) { set({ sections: inMem, loading: false, loadingText: '' }); refocus(); return; }

    // Anything already fetched for this term (a paused download) shows straight away.
    const have = loads.get(`full:${term}`)?.rows || [];
    set({ sections: [...have], loading: true, loadingText: have.length ? `Loading… ${have.length}` : 'Loading classes…' });
    try {
        const acc = await loadSections(term);
        if (state.term !== term) return;     // the user moved on while it loaded
        set({ sections: acc, loading: false, loadingText: '' });
        if (!acc.length) set({ error: 'No classes found for this term.' });
        refocus();
    } catch (e) {
        if (state.term !== term) return;
        set({
            loading: false,
            error: e.name === 'SessionExpired'
                ? 'Your Banner session expired. Reload the page to sign in again.'
                : `Failed to load classes: ${e.message}`,
        });
    }
}

/** Saved catalogs and course lists, read at startup (the rows themselves load on use). */
export async function hydrateCacheMeta() {
    const [all, courses] = await Promise.all([cache.listMeta(), cache.allCourses()]);
    // A saved catalog with fewer sections than Banner said it has, or saved before totals
    // were recorded, may be a download that ended early. It is dropped and fetched again.
    const meta = [];
    for (const m of all) {
        if (m.total && m.count >= m.total) meta.push(m);
        else cache.dropCatalog(m.term);
    }
    set({
        cacheMeta: Object.fromEntries(meta.map((m) => [m.term, { fetchedAt: m.fetchedAt, count: m.count, total: m.total }])),
        courseIndex: Object.fromEntries(courses.map((c) => [c.term, c.list])),
    });
}

// --- registrations -----------------------------------------------------------------

/** Registrations for one term, by the explicit-term endpoint. */
export async function loadRegistered(term) {
    if (!term || state.registered[term]?.status === 'loading') return;
    set({ registered: { ...state.registered, [term]: { status: 'loading', rows: state.registered[term]?.rows || [] } } });
    try {
        const rows = registrationRows(await api.getRegistrations(term)).map((r) => normalizeRegistration(r, term));
        set({ auth: 'in', registered: { ...state.registered, [term]: { status: 'ok', rows } } });
    } catch {
        set({ registered: { ...state.registered, [term]: { status: 'error', rows: [] } } });
    }
}

/** Find the semesters the student has registrations in, so Plan can list them all.
 *  Walks the term list newest to oldest, one request at a time, and stops once it has
 *  found some and then run into three empty terms in a row (nobody registers before
 *  they enrol), or after a dozen terms with nothing found. Runs once per session. */
export async function discoverTerms() {
    if (state.discovery.status !== 'idle') return;
    set({ discovery: { status: 'running', checked: 0 } });
    const codes = state.terms.map((t) => String(t.code)).sort((a, b) => Number(b) - Number(a));
    let found = false;
    let empties = 0;
    let checked = 0;
    for (const t of codes) {
        if (state.registered[t]?.status !== 'ok') await loadRegistered(t);
        checked++;
        set({ discovery: { status: 'running', checked } });
        const has = (state.registered[t]?.rows || []).some((r) => !r.dropped);
        if (has) { found = true; empties = 0; } else if (found) empties++;
        if (found && empties >= 3) break;
        if (!found && checked >= 12) break;
        if (state.auth === 'out') break;
    }
    set({ discovery: { status: 'done', checked } });
}

// --- home page -----------------------------------------------------------------------

const smallest = (codes) => codes.map(String).sort((a, b) => Number(a) - Number(b))[0] || null;

const fatal = (e) => e.name === 'SessionExpired' || e.name === 'SessionPoisoned';

let openTermsReady = Promise.resolve();

/** The student's current registrations.
 *
 *  registrationHistory/reset takes its term explicitly and is the call that works cold
 *  (banner-api-reference.md), so it goes first; the parameterless active-registrations
 *  call follows. If that comes back empty, ask term by term for the likeliest terms
 *  rather than showing an empty home page. */
async function fetchHomeRows() {
    const known = state.terms.map((t) => String(t.code)).sort((a, b) => Number(b) - Number(a));
    const guess = known.find((c) => Number(c) <= Number(calendarTerm())) || known[0];
    const byTerm = {};
    const fetchTerm = async (t) => {
        byTerm[t] ??= registrationRows(await api.getRegistrations(t)).map((r) => normalizeRegistration(r, t));
        return byTerm[t];
    };

    const prime = state.term || guess;
    if (prime) {
        try { await fetchTerm(prime); } catch (e) { if (fatal(e)) throw e; }
    }
    try {
        const active = registrationRows(await api.getActiveRegistrations())
            .map((r) => normalizeRegistration(r, guess)).filter((r) => !r.dropped);
        if (active.length) return active;
    } catch (e) { if (fatal(e)) throw e; }

    await openTermsReady;
    const candidates = [...new Set([guess, ...state.openTerms.map((t) => String(t.code)), ...known.slice(0, 3)])]
        .filter(Boolean).slice(0, 5);
    const withRows = [];
    for (const t of candidates) {
        try { if ((await fetchTerm(t)).some((r) => !r.dropped)) withRows.push(t); } catch (e) { if (fatal(e)) throw e; }
    }
    const now = calendarTerm();
    const chosen = withRows.filter((c) => Number(c) <= Number(now)).sort((a, b) => Number(b) - Number(a))[0]
        || smallest(withRows);
    return chosen ? byTerm[chosen].filter((r) => !r.dropped) : [];
}

/** What the home page needs: which term is "now", which is next, and the next term's
 *  time ticket. The current term is the earliest term with active registrations. */
export async function loadHome() {
    if (state.home.status === 'loading') return;
    set({ home: { ...state.home, status: 'loading', error: null } });
    let live = [];
    let error = null;
    try {
        live = await fetchHomeRows();
        set({ auth: 'in' });
    } catch (e) {
        error = e.name === 'SessionExpired' ? 'signed-out' : e.message;
    }
    const currentTerm = smallest(live.map((r) => r.term).filter(Boolean));
    set({ home: { ...state.home, status: error ? 'error' : 'ok', error, currentTerm, activeRows: live } });

    // What the home page draws from. It loads while Home is showing; the loader moves
    // to the toolbar's term as soon as the user leaves.
    if (currentTerm) { loadSections(currentTerm).catch(() => {}); refocus(); }

    await openTermsReady;
    const codes = (list) => list.map((t) => String(t.code));
    const later = (list) => smallest(list.filter((c) => Number(c) > Number(currentTerm)));
    // With no registrations to anchor on, fall back to the first term open for
    // registration, then to the newest term Banner lists.
    const nextTerm = currentTerm
        ? later(codes(state.openTerms)) || later(codes(state.terms))
        : smallest(codes(state.openTerms)) || codes(state.terms).sort((a, b) => Number(b) - Number(a))[0] || null;
    set({ home: { ...state.home, nextTerm } });
    if (nextTerm) loadTicket(nextTerm);
}

export async function loadTicket(term) {
    if (state.tickets[term]?.status === 'loading') return;
    set({ tickets: { ...state.tickets, [term]: { status: 'loading', at: null, text: null } } });
    try {
        const { at, text } = parseTimeTicket(await api.getRegistrationStatusHTML(term));
        set({ tickets: { ...state.tickets, [term]: { status: 'ok', at: at ? at.getTime() : null, text } } });
    } catch {
        set({ tickets: { ...state.tickets, [term]: { status: 'error', at: null, text: null } } });
    }
}

export const setTicketOverride = (term, ms) => updateSettings({
    ticketOverride: { ...(state.settings.ticketOverride || {}), [term]: ms },
});

// --- boot --------------------------------------------------------------------

export async function boot() {
    api.startKeepAlive();

    const saved = await chrome.storage.local.get([PLAN_KEY, SETTINGS_KEY]);
    set({
        planAll: saved[PLAN_KEY] || {},
        settings: { ...DEFAULT_SETTINGS, ...(saved[SETTINGS_KEY] || {}) },
    });
    await hydrateCacheMeta();
    setInterval(() => { if (document.visibilityState === 'visible') refocus(); }, 60 * 1000);   // seats go stale while a page stays open

    let terms = [];
    try {
        terms = await api.getSearchTerms();
    } catch {
        // Public call. If even this fails, work from what has been downloaded.
        terms = Object.keys(state.cacheMeta).sort((a, b) => Number(b) - Number(a))
            .map((code) => ({ code, description: termLabel(code) }));
        if (!terms.length) {
            set({ error: 'Could not reach Banner to list terms.' });
            return;
        }
    }

    const savedTerm = (await chrome.storage.local.get(TERM_KEY))[TERM_KEY];
    const stored = terms.some((t) => String(t.code) === String(savedTerm)) ? savedTerm : null;   // a hand-added semester is not a toolbar term
    set({ terms, term: stored || null });

    // Which terms are open for registration. Authenticated and optional — its absence
    // just means we cannot show the registration window, not that anything is broken.
    openTermsReady = api.getOpenTerms()
        .then((o) => set({ openTerms: o, auth: 'in' }))
        .catch(() => {});

    // The home page goes first: a few small requests, and it queues the current term's
    // catalog ahead of the selected term's. Loading the selected term's catalog first
    // (dozens of pages) used to hold the home page's own data back until it finished.
    await loadHome();

    const term = stored || state.home.currentTerm || terms[0]?.code || null;
    set({ term });
    if (term) await selectTerm(term);
}
