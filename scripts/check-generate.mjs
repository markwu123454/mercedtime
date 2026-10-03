// Offline check of the schedule generator: hand-built cases with known answers, then a
// run over real courses from the Fall 2026 fixture that verifies every result
// independently. Run: npm run check
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateSchedules, meetingsOf, courseChoices } from '../src/lib/generate.js';

const sec = (key, crn, days, begin, end, extra = {}) => {
    const dayKeys = { M: 'monday', T: 'tuesday', W: 'wednesday', R: 'thursday', F: 'friday' };
    return {
        subject: key.slice(0, -3), courseNumber: key.slice(-3), subjectCourse: key,
        courseReferenceNumber: crn, sequenceNumber: '01', seatsAvailable: 5, maximumEnrollment: 20,
        meetingsFaculty: [{ meetingTime: { beginTime: begin, endTime: end, ...Object.fromEntries([...days].map((d) => [dayKeys[d], true])) } }],
        ...extra,
    };
};
const course = (key, sections, require) => ({ key, label: key, sections, require });

// X has two lecture times, Y clashes with X's MW time, Z is a lecture with two labs.
const X = [sec('XX001', 'x1', 'MW', '0900', '1000', { linkIdentifier: '' }), sec('XX001', 'x2', 'TR', '0900', '1000', { sequenceNumber: '02' })];
const Y = [sec('YY001', 'y1', 'MW', '0930', '1030')];
const Z = [
    sec('ZZ001', 'z1', 'MWF', '1300', '1400', { linkIdentifier: 'A1' }),
    sec('ZZ001', 'zl1', 'T', '1000', '1200', { linkIdentifier: 'B1', sequenceNumber: '01L' }),
    sec('ZZ001', 'zl2', 'T', '1400', '1600', { linkIdentifier: 'B1', sequenceNumber: '02L' }),
];
const courses = [course('XX001', X), course('YY001', Y), course('ZZ001', Z)];
const crns = (r) => r.sections.map((s) => s.courseReferenceNumber).sort().join(',');

assert.equal(courseChoices(Z).length, 2, 'a lecture pairs with one lab at a time');
let r = generateSchedules({ courses });
assert.deepEqual(r.results.map(crns).sort(), ['x2,y1,z1,zl1', 'x2,y1,z1,zl2'], 'Y clashes with X on MW, so X must be TR');
r = generateSchedules({ courses, filters: { gap: 15 } });
assert.deepEqual(r.results.map(crns), ['x2,y1,z1,zl2'], 'a 15 minute gap rules out the 10:00 lab after X ends at 10:00');
r = generateSchedules({ courses, filters: { daysOff: [1] } });
assert.equal(r.total, 0, 'Tuesday off leaves no schedule');
assert.deepEqual(r.blocked, ['ZZ001'], 'blocked names the course with no fitting section on its own: both labs are on Tuesday');
r = generateSchedules({ courses, filters: { earliest: 9 * 60 + 15 } });
assert.deepEqual(r.blocked.sort(), ['XX001'], 'nothing in XX001 starts after 9:15');
r = generateSchedules({ courses: [course('XX001', X), course('YY001', Y)], fixed: [sec('FF001', 'f1', 'TR', '0900', '1000')] });
assert.equal(r.total, 0, 'a fixed registered class blocks X on TR as well');
r = generateSchedules({ courses: [course('ZZ001', Z, ['zl2'])] });
assert.deepEqual(r.results.map(crns), ['z1,zl2'], 'require keeps only bundles containing the picked CRN');
const full = X.map((s) => ({ ...s, seatsAvailable: 0, maximumEnrollment: 20, openSection: false }));
assert.equal(generateSchedules({ courses: [course('XX001', full)], filters: { openOnly: true } }).blocked.length, 1);

// identical time and instructor collapse into one result with a count
const twin = [sec('TT001', 't1', 'MW', '1000', '1100'), sec('TT001', 't2', 'MW', '1000', '1100', { sequenceNumber: '02' })];
r = generateSchedules({ courses: [course('TT001', twin)] });
assert.equal(r.total, 1);
assert.equal(r.results[0].alternatives, 1);

// ranking
const A = [sec('AA001', 'a1', 'M', '0800', '0900'), sec('AA001', 'a2', 'M', '1000', '1100', { sequenceNumber: '02' })];
const Bc = [sec('BB001', 'b1', 'M', '1300', '1400')];
const byGaps = generateSchedules({ courses: [course('AA001', A), course('BB001', Bc)], filters: { sort: 'gaps' } });
assert.deepEqual(byGaps.results.map(crns), ['a2,b1', 'a1,b1'], 'less time between classes ranks first');
const late = generateSchedules({ courses: [course('AA001', A), course('BB001', Bc)], filters: { sort: 'late' } });
assert.deepEqual(late.results.map(crns), ['a2,b1', 'a1,b1'], 'latest start ranks first');

// --- real courses ---------------------------------------------------------------------
const rows = JSON.parse(fs.readFileSync(new URL('../fixtures/sections-202630.json', import.meta.url), 'utf8'))['202630'];
const keys = ['ME001', 'MATH024', 'PHYS008', 'WRI010', 'DSC008', 'CSE030'];
const real = keys.map((k) => course(k, rows.filter((s) => s.subjectCourse === k)));
assert.ok(real.every((c) => c.sections.length), 'fixture has all six courses');
const t0 = Date.now();
const res = generateSchedules({ courses: real, filters: { gap: 15, sort: 'gaps' } });
const ms = Date.now() - t0;
assert.ok(ms < 2000, `search took ${ms}ms`);
assert.ok(res.total > 0, 'six real courses have at least one clash-free schedule');

for (const r of res.results) {
    const ms = meetingsOf(r.sections);
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
        const a = ms[i], b = ms[j];
        assert.ok(!(a.day === b.day && a.start < b.end + 15 && b.start < a.end + 15), 'no two classes closer than the gap');
    }
    const perCourse = new Map();
    for (const s of r.sections) perCourse.set(s.subjectCourse, (perCourse.get(s.subjectCourse) || 0) + 1);
    assert.deepEqual([...perCourse.keys()].sort(), [...keys].sort(), 'every course appears once');
    for (const k of keys) {
        const secs = r.sections.filter((s) => s.subjectCourse === k);
        const anchors = secs.filter((s) => !/^[B-Z]/.test(s.linkIdentifier || 'A'));
        assert.equal(anchors.length, 1, `${k} has exactly one anchor`);
    }
}
for (let i = 1; i < res.results.length; i++) assert.ok(res.results[i - 1].gaps <= res.results[i].gaps, 'sorted by gaps');
console.log(`ok (${res.total} schedules for ${keys.length} real courses in ${ms}ms)`);

// Picking a schedule writes its CRNs into the plan, one item per course
globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
const store = await import('../src/lib/store.js');
store.set({ term: 'T', planAll: { T: { XX001: { key: 'XX001', subject: 'XX', number: '001', title: '', crns: ['x1'], info: {} } } } });
await store.applySchedule('T', [X[1], Y[0]]);
const plan = store.getState().planAll.T;
assert.deepEqual(plan.XX001.crns, ['x2'], 'replaces the course\'s earlier pick');
assert.deepEqual(plan.YY001.crns, ['y1'], 'adds a course that was not in the plan');
assert.deepEqual([...store.getState().plan].sort(), ['x2', 'y1']);
console.log('ok (apply)');
process.exit(0);
