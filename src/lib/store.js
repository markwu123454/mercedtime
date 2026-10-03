// Shared state, plus the plan that outlives a session.
//
// Small enough not to need a state library: one object, one subscriber set, and a
// React hook over useSyncExternalStore. Views read from here and never fetch.

import { useSyncExternalStore } from 'react';
import * as api from './api.js';
import { courseKey } from './sections.js';
import { DEFAULT_SETTINGS } from './schedule.js';
import { normalizeRegistration, registrationRows } from './registrations.js';
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

// --- settings -----------------------------------------------------------------

export async function updateSettings(patch) {
    const settings = { ...state.settings, ...patch };
    set({ settings });
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

// Only one term's catalog is ever being fetched: the one the user is looking at. Asking
// for another term (or leaving the page that needs it) pauses the current fetch at the
// next page boundary and keeps what it already has; coming back resumes at that offset.
//
// One fetcher is also a correctness requirement. searchResults reads the term from
// session state, so two catalogs loading together would trample each other's
// saveTerm. After a pause the session holds the other term, so the term is committed
// again before the first resumed page.
const loads = new Map();   // term -> { rows, offset, total, failed, waiters }
let committed = null;      // the term the session's search state currently holds
let running = false;

/** The term the user currently needs. On Home that is the term its schedule is drawn
 *  from; everywhere else it is the term picked in the toolbar. */
const wantedTerm = () =>
    (state.route === 'home' ? state.home.currentTerm : null) || state.term;

async function loadNextPage(term, l) {
    if (committed !== term) {
        committed = null;
        await api.saveTerm(term);
        committed = term;
    }
    const { rows, total } = await api.searchPage(term, l.offset);
    l.rows.push(...rows);
    l.offset += rows.length;
    l.total = total || l.rows.length;
    if (state.term === term) set({ sections: [...l.rows], loadingText: `Loading… ${l.offset} / ${l.total}` });
    return !rows.length || l.offset >= l.total;
}

async function runLoader() {
    if (running) return;
    running = true;
    try {
        for (;;) {
            const term = wantedTerm();
            const l = term && loads.get(term);
            if (!l || l.failed || state.sectionsByTerm[term]) return;
            try {
                if (await loadNextPage(term, l)) {
                    // An empty answer is not cached: it can be a session that never
                    // committed the term, and caching it would hide the retry.
                    if (l.rows.length) set({ sectionsByTerm: { ...state.sectionsByTerm, [term]: l.rows } });
                    loads.delete(term);
                    l.waiters.forEach((w) => w.resolve(l.rows));
                }
            } catch (e) {
                l.failed = true;
                l.waiters.splice(0).forEach((w) => w.reject(e));
            }
        }
    } finally {
        running = false;
    }
}

/** Point the loader at whatever the user currently needs. Call after anything that
 *  changes that: the selected term, the route, the home page's term. */
export function refocus() { runLoader(); }

export function setRoute(route) {
    set({ route });
    refocus();
}

/** One term's full section list, resolved once it has loaded. Does not by itself make
 *  the term the active one: the fetch runs while the term is wanted (see wantedTerm). */
export function loadSections(term) {
    const cached = state.sectionsByTerm[term];
    if (cached) return Promise.resolve(cached);
    let l = loads.get(term);
    if (!l) loads.set(term, (l = { rows: [], offset: 0, total: 0, failed: false, waiters: [] }));
    l.failed = false;                  // asking again is a retry
    const p = new Promise((resolve, reject) => l.waiters.push({ resolve, reject }));
    refocus();
    return p;
}

export async function selectTerm(term) {
    set({ term, error: null, plan: crnSet(state.planAll[term]) });
    await chrome.storage.local.set({ [TERM_KEY]: term });

    const cached = state.sectionsByTerm[term];
    if (cached) { set({ sections: cached, loading: false, loadingText: '' }); refocus(); return; }

    // Anything already fetched for this term (a paused load) shows straight away.
    const have = loads.get(term)?.rows || [];
    set({ sections: [...have], loading: true, loadingText: have.length ? `Loading… ${have.length}` : 'Loading classes…' });
    try {
        const acc = await loadSections(term);
        if (state.term !== term) return;     // the user moved on while it loaded
        set({ sections: acc, loading: false, loadingText: '' });
        if (!acc.length) set({ error: 'No classes found for this term.' });
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

// --- home page -----------------------------------------------------------------------

const smallest = (codes) => codes.map(String).sort((a, b) => Number(a) - Number(b))[0] || null;

const fatal = (e) => e.name === 'SessionExpired' || e.name === 'SessionPoisoned';

// UC Merced's term codes are the calendar year plus 10 (spring), 20 (summer) or 30 (fall).
const calendarTerm = (d = new Date()) =>
    `${d.getFullYear()}${d.getMonth() < 5 ? '10' : d.getMonth() < 8 ? '20' : '30'}`;

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

    let terms = [];
    try {
        terms = await api.getSearchTerms();
    } catch {
        // Public call; if even this fails there is nothing to browse.
        set({ error: 'Could not reach Banner to list terms.' });
        return;
    }

    const stored = (await chrome.storage.local.get(TERM_KEY))[TERM_KEY];
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
