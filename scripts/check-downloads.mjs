// Offline check of saved catalogs, background downloading and seat refresh. Drives the
// real store against a mocked Banner. Run: npm run check
import assert from 'node:assert/strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (term, n, seats) => Array.from({ length: n }, (_, i) => ({
    courseReferenceNumber: `${term}-${i}`, term, subject: 'ME', courseNumber: String(i % 5 + 1).padStart(3, '0'),
    subjectCourse: `ME${String(i % 5 + 1).padStart(3, '0')}`, courseTitle: `Course ${i % 5}`, seatsAvailable: seats,
}));
const DATA = { 202710: [], 202630: mk('202630', 120, 5), 202610: mk('202610', 70, 5), 202530: mk('202530', 60, 5) };

const log = [];
let session = null;
globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
globalThis.location = { pathname: '/ssb/' };
globalThis.document = { visibilityState: 'hidden' };
globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const path = u.pathname.split('/ssb/')[1];
    const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    if (path === 'term/saveTerm') return json({});
    if (path === 'term/search') { session = new URLSearchParams(init.body).get('term'); return json({}); }
    if (path === 'searchResults/searchResults') {
        await sleep(3);
        const off = Number(u.searchParams.get('pageOffset'));
        log.push(`${session}@${off}`);
        const rows = DATA[session] || [];
        const fault = globalThis.flaky?.(session, off);
        if (fault === 'fail') return json({ success: false });
        if (fault === 'empty') return json({ success: true, totalCount: rows.length, data: [] });
        if (fault === 'wrong') return json({ success: true, totalCount: rows.length, data: mk('202610', 50, 1) });
        return json({ success: true, totalCount: rows.length, data: rows.slice(off, off + 50) });
    }
    throw new Error(`unexpected ${path}`);
};

const store = await import('../src/lib/store.js');
const cache = await import('../src/lib/cache.js');
const { courseOptions, futureTerms } = await import('../src/lib/courses.js');
const until = async (fn, ms = 4000) => { for (let i = 0; i < ms / 2 && !fn(); i++) await sleep(2); assert.ok(fn(), 'timed out'); };
const count = (term) => log.filter((l) => l.startsWith(`${term}@`)).length;
const S = () => store.getState();

store.set({
    route: 'plan',
    terms: [202710, 202630, 202610, 202530].map((c) => ({ code: String(c), description: String(c) })),
    settings: { ...S().settings, backgroundDownload: true, keepTerms: 4 },
});

// 1. With nothing wanted, terms download in the background, newest first, and are saved.
store.refocus();
await until(() => S().cacheMeta['202530']);
assert.ok(count('202630') > 0 && count('202610') > 0 && count('202530') > 0, 'every uncached term was downloaded');
assert.equal(count('202710'), 1, 'an unpublished term costs one empty page, then is left alone');
assert.equal((await cache.getCatalog('202630')).rows.length, 120, 'the catalog is saved');
assert.deepEqual(Object.keys(S().sectionsByTerm), [], 'a background download is not kept in memory');
assert.ok(S().courseIndex['202630'].length === 5, 'its course list is indexed');
await sleep(150);
const settled = log.length;
await sleep(150);
assert.equal(log.length, settled, 'nothing is re-downloaded once saved, and nothing polls for the unpublished term');

// 2. Viewing a saved term reads it from the cache without touching Banner.
const before = log.length;
await store.selectTerm('202630');
assert.equal(S().sections.length, 120);
assert.equal(log.length, before, 'a fresh saved copy is shown without a request');

// 3. Seats refresh only when the copy is stale and the user is viewing seats.
DATA['202630'] = mk('202630', 120, 0);               // Banner now says every section is full
S().cacheMeta['202630'].fetchedAt = Date.now() - 10 * 60 * 1000;
store.set({ route: 'home' });
store.refocus();
await sleep(100);
assert.equal(S().sections[0].seatsAvailable, 5, 'Home does not refresh seats');
store.setRoute('search');
await until(() => S().sections[0].seatsAvailable === 0);
assert.equal(S().sections.length, 120, 'a refresh keeps every row');
assert.equal((await cache.getCatalog('202630')).rows[0].seatsAvailable, 0, 'the refreshed seats are saved');
const afterRefresh = log.length;
await sleep(100);
assert.equal(log.length, afterRefresh, 'a fresh copy is not refreshed again');

// 4. A section added since the download appears after a refresh; the others stay.
DATA['202630'] = [...mk('202630', 120, 0), ...mk('202630', 125, 3).slice(120)];
store.refreshSeats('202630');
await until(() => S().sections.length === 125);
assert.equal(S().sections.at(-1).seatsAvailable, 3);

// 5. Background download is switchable.
DATA['202520'] = mk('202520', 30, 1);
store.set({ terms: [...S().terms, { code: '202520', description: '202520' }] });
await store.updateSettings({ backgroundDownload: false, keepTerms: 5 });
await sleep(120);
assert.ok(!S().cacheMeta['202520'], 'turning it off stops new downloads');
await store.updateSettings({ backgroundDownload: true });
await until(() => S().cacheMeta['202520']);

// 6. Summer-style planning: a term with no classes offers the courses seen in earlier terms of its season.
const idx = { '202510': [['ME001', 'ME', '001', 'Intro']], '202610': [['CSE030', 'CSE', '030', 'DS']], '202630': [['PHYS008', 'PHYS', '008', 'P']] };
const summerList = courseOptions('202720', { ...idx, '202520': [['MATH011', 'MATH', '011', 'Calc']] });
assert.deepEqual(summerList.list.map((c) => c.key), ['MATH011'], 'only past summers feed a summer term');
assert.deepEqual(courseOptions('202710', idx).list.map((c) => c.key), ['CSE030', 'ME001'], 'spring offers the spring courses');
assert.equal(courseOptions('202710', idx).source, 'history');

// the semesters offered for planning ahead: every spring, summer and fall for four years
const ahead = futureTerms('202630');
assert.equal(ahead[0], '202710', 'starts with the next semester');
assert.equal(ahead.at(-1), '203030', 'ends four years on');
assert.equal(ahead.length, 12);
assert.ok(ahead.includes('202820'), 'summers are included');
assert.equal(futureTerms('202710')[0], '202720');
assert.equal(futureTerms('202710').at(-1), '203110');

// 7. A semester Banner does not list is never sent to Banner.
const n = log.length;
assert.deepEqual(await store.loadSections('203330'), []);
assert.equal(log.length, n);


// --- interruptions: a download that is disturbed must finish, not stop part way --------------
store.tuning.backoffMs = 1;
store.tuning.retryMs = 60;
const faults = { '202440': ['fail'], '202430': ['empty'], '202420': ['wrong'], '202410': ['fail', 'fail', 'fail', 'fail'] };
const seenAt = {};      // `${term}@${offset}` -> how many requests it took
globalThis.flaky = (term, off) => {
    const k = `${term}@${off}`;
    seenAt[k] = (seenAt[k] || 0) + 1;
    if (off !== 50) return null;                         // only the second page misbehaves
    const plan = faults[term];
    return plan && seenAt[k] <= plan.length ? plan[seenAt[k] - 1] : null;
};
for (const t of ['202440', '202430', '202420', '202410', '202400']) DATA[t] = mk(t, t === '202430' ? 130 : 100, 1);
cache.putPartial('202400', { rows: DATA['202400'].slice(0, 50), offset: 50, total: 100 });   // an earlier session got this far

store.set({
    terms: [...S().terms, ...['202440', '202430', '202420', '202410', '202400'].map((c) => ({ code: c, description: c }))],
});
await store.updateSettings({ backgroundDownload: true, keepTerms: 20 });
await until(() => ['202440', '202430', '202420', '202410', '202400'].every((t) => S().cacheMeta[t]), 8000);

for (const t of ['202440', '202430', '202420', '202410', '202400']) {
    const cat = await cache.getCatalog(t);
    assert.equal(cat.rows.length, DATA[t].length, `${t} was saved complete, not cut short`);
    assert.equal(cat.total, DATA[t].length, `${t} records the total Banner reported`);
    assert.equal(new Set(cat.rows.map((r) => r.courseReferenceNumber)).size, cat.rows.length, `${t} has no duplicate rows`);
    assert.ok(cat.rows.every((r) => r.term === t), `${t} holds only its own rows`);
}
assert.ok(seenAt['202410@50'] > 4, 'a download that gave up tried again later');
assert.equal(seenAt['202410@0'], 1, 'and resumed where it stopped instead of starting over');
assert.equal(seenAt['202400@0'], undefined, 'a partial from an earlier session is resumed, not restarted');

// a catalog saved short of Banner's total, or without one, is not trusted
await cache.putCatalog('202390', DATA['202400'].slice(0, 40), Date.now(), 90);
await cache.putCatalog('202380', DATA['202400'].slice(0, 40), Date.now(), 0);
await store.hydrateCacheMeta();
await sleep(20);
assert.ok(!S().cacheMeta['202390'] && !S().cacheMeta['202380'], 'unfinished catalogs are dropped from the saved list');
assert.equal(await cache.getCatalog('202390'), undefined);
globalThis.flaky = undefined;

console.log('ok (downloads)');
process.exit(0);
