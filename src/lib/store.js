// Shared state, plus the plan that outlives a session.
//
// Small enough not to need a state library: one object, one subscriber set, and a
// React hook over useSyncExternalStore. Views read from here and never fetch.

import { useSyncExternalStore } from 'react';
import * as api from './api.js';

const PLAN_KEY = 'mercedtime_plan';
const TERM_KEY = 'mercedtime_term';

let state = {
    route: 'search',
    term: null,
    terms: [],
    openTerms: [],          // terms open for registration — the "may I register" signal
    sections: [],
    loading: false,
    loadingText: '',
    error: null,
    auth: 'unknown',        // 'unknown' | 'in' | 'out'
    userName: null,
    notifications: [],
    plan: new Set(),
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

// --- plan persistence --------------------------------------------------------

export async function loadPlan(term) {
    const o = await chrome.storage.local.get(PLAN_KEY);
    set({ plan: new Set((o[PLAN_KEY] || {})[term] || []) });
}

export async function togglePlan(crn) {
    const next = new Set(state.plan);
    next.has(crn) ? next.delete(crn) : next.add(crn);
    set({ plan: next });
    const o = await chrome.storage.local.get(PLAN_KEY);
    const all = o[PLAN_KEY] || {};
    all[state.term] = [...next];
    await chrome.storage.local.set({ [PLAN_KEY]: all });
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

// --- boot --------------------------------------------------------------------

export async function boot() {
    api.startKeepAlive();

    let terms = [];
    try {
        terms = await api.getSearchTerms();
    } catch {
        // Public call; if even this fails there is nothing to browse.
        set({ error: 'Could not reach Banner to list terms.' });
        return;
    }

    const stored = (await chrome.storage.local.get(TERM_KEY))[TERM_KEY];
    const term = stored || terms[0]?.code || null;
    set({ terms, term });

    // Which terms are open for registration. Authenticated and optional — its absence
    // just means we cannot show the registration window, not that anything is broken.
    // Succeeding also tells us there is a signed-in Banner session, since there is no
    // Banner header to read the user from.
    api.getOpenTerms().then((openTerms) => set({ openTerms, auth: 'in' })).catch(() => {});

    if (term) await selectTerm(term);
}

export async function selectTerm(term) {
    set({ term, sections: [], error: null, loading: true, loadingText: 'Loading classes…' });
    await chrome.storage.local.set({ [TERM_KEY]: term });
    await loadPlan(term);
    try {
        await api.saveTerm(term);
        const acc = [];
        await api.searchResults(term, {
            onPage: (page, loaded, total) => {
                acc.push(...page);
                // Repoint the array so subscribers see a new identity each page.
                set({ sections: [...acc], loadingText: `Loading… ${loaded} / ${total}` });
            },
        });
        set({ loading: false, loadingText: '' });
        if (!acc.length) set({ error: 'No classes found for this term.' });
    } catch (e) {
        set({
            loading: false,
            error: e.name === 'SessionExpired'
                ? 'Your Banner session expired. Reload the page to sign in again.'
                : `Failed to load classes: ${e.message}`,
        });
    }
}
