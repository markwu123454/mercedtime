// Persistent storage for downloaded catalogs, in IndexedDB.
//
// A term's section list is megabytes, far over chrome.storage.local's quota, so it lives
// here. Four stores: `catalogs` (the rows), `meta` (when each was fetched, how many rows;
// small enough to read all at once), `partials` (an interrupted download, so it resumes
// instead of restarting) and `courses` (the course list of each term, which the planner
// searches without opening a catalog).
//
// The cache is an optimisation, never a dependency: every call swallows its own failure,
// and where IndexedDB does not exist (the offline checks run under Node) it falls back to
// memory.

const DB_NAME = 'mercedtime-cache';
const STORES = ['catalogs', 'meta', 'partials', 'courses'];

const memory = Object.fromEntries(STORES.map((s) => [s, new Map()]));
let dbp = null;

function open() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    dbp ??= new Promise((resolve) => {
        try {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => STORES.forEach((s) => req.result.createObjectStore(s, { keyPath: 'term' }));
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
            req.onblocked = () => resolve(null);
        } catch { resolve(null); }
    });
    return dbp;
}

const wrap = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
});

async function get(store, term) {
    const db = await open();
    if (!db) return memory[store].get(term);
    try { return await wrap(db.transaction(store).objectStore(store).get(term)); } catch { return undefined; }
}

async function put(store, value) {
    const db = await open();
    if (!db) { memory[store].set(value.term, value); return; }
    try { await wrap(db.transaction(store, 'readwrite').objectStore(store).put(value)); } catch { /* cache only */ }
}

async function del(store, term) {
    const db = await open();
    if (!db) { memory[store].delete(term); return; }
    try { await wrap(db.transaction(store, 'readwrite').objectStore(store).delete(term)); } catch { /* cache only */ }
}

async function all(store) {
    const db = await open();
    if (!db) return [...memory[store].values()];
    try { return await wrap(db.transaction(store).objectStore(store).getAll()); } catch { return []; }
}

export const getCatalog = (term) => get('catalogs', term);

export async function putCatalog(term, rows, fetchedAt = Date.now()) {
    await put('catalogs', { term, rows, fetchedAt });
    await put('meta', { term, fetchedAt, count: rows.length });
}

export const listMeta = () => all('meta');
export const getPartial = (term) => get('partials', term);
export const putPartial = (term, partial) => put('partials', { term, ...partial, savedAt: Date.now() });
export const delPartial = (term) => del('partials', term);
export const putCourses = (term, list) => put('courses', { term, list });
export const allCourses = () => all('courses');
