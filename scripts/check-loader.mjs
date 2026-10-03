// Offline check of the catalog loader: only the wanted term is fetched, a switch pauses
// the old term at a page boundary, and coming back resumes where it stopped.
// Drives the real store against a mocked Banner. Run: npm run check
import assert from 'node:assert/strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rowsFor = (term, n) => Array.from({ length: n }, (_, i) => ({ courseReferenceNumber: `${term}${i}`, subject: 'X', courseNumber: '001' }));
const DATA = { A: rowsFor('A', 220), B: rowsFor('B', 130), D: rowsFor('D', 200) };

const log = [];
let session = null;                                   // the term Banner's session holds
globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
globalThis.location = { pathname: '/ssb/' };
globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const path = u.pathname.split('/ssb/')[1];
    const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    if (path === 'term/saveTerm') { log.push(`save:${u.searchParams.get('term')}`); return json({}); }
    if (path === 'term/search') { session = new URLSearchParams(init.body).get('term'); return json({}); }
    if (path === 'searchResults/searchResults') {
        await sleep(8);
        const off = Number(u.searchParams.get('pageOffset'));
        log.push(`${session}@${off}`);
        const rows = (DATA[session] || []).slice(off, off + 50);
        return json({ success: true, totalCount: (DATA[session] || []).length, data: rows });
    }
    throw new Error(`unexpected ${path}`);
};

const store = await import('../src/lib/store.js');
const offsets = (term) => log.filter((l) => l.startsWith(`${term}@`)).map((l) => Number(l.split('@')[1]));
const until = async (fn) => { for (let i = 0; i < 500 && !fn(); i++) await sleep(2); assert.ok(fn(), 'timed out'); };

// --- switching terms in Find classes ------------------------------------------------
store.set({ route: 'search' });
store.selectTerm('A');
await until(() => offsets('A').length >= 2);          // part way through A
await store.selectTerm('B');                           // switch: A pauses, B loads
assert.equal(store.getState().sectionsByTerm.B.length, 130);
assert.equal(store.getState().sections.length, 130);
assert.ok(!store.getState().sectionsByTerm.A, 'A must not have finished');
assert.ok(Math.max(...offsets('A')) <= 100, 'at most the page already in flight finishes after the switch');

const fetchedBefore = offsets('A').length;
await sleep(120);
assert.equal(offsets('A').length, fetchedBefore, 'a paused term must not keep loading in the background');

await store.selectTerm('A');                           // back: resumes where it stopped
assert.equal(store.getState().sectionsByTerm.A.length, 220);
assert.deepEqual(offsets('A'), [0, 50, 100, 150, 200], 'resume must continue, not restart or repeat');
assert.equal(log.filter((l) => l === 'save:A').length, 2, 'the term is committed again after a pause');

// --- leaving Home pauses the home page's term ----------------------------------------
store.set({ route: 'home', home: { ...store.getState().home, currentTerm: 'D' } });
store.setRoute('home');
const done = store.loadSections('D');
await until(() => offsets('D').length >= 2);
store.setRoute('search');                              // the toolbar term (A) is already cached
await sleep(40);
const stalled = offsets('D').length;
await sleep(120);
assert.equal(offsets('D').length, stalled, 'D pauses when Home is left');
assert.ok(stalled < 4);
store.setRoute('home');
await done;
assert.deepEqual(offsets('D'), [0, 50, 100, 150]);

console.log('ok');
process.exit(0);
