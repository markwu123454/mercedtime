// Offline check of the degree-audit logic that needs no DOM: ids, course keys, and what a plan
// does to an audit's open requirements. (The HTML parsers need a browser; see
// fixtures/uachieve/README.md.) Run: npm run check
import assert from 'node:assert/strict';
import { auditIdFromHref, courseKeyOf, normalizeNumber, plannedCourses, simulatePlan, unmetNodes } from '../src/lib/degree.js';

assert.equal(normalizeNumber('10H'), '010H');
assert.equal(normalizeNumber('010h'), '010H');
assert.equal(normalizeNumber('172'), '172');
assert.equal(courseKeyOf('sprk', '010H'), 'SPRK010H');

const seq = Buffer.from('!!!!intSeqNo=40392277').toString('base64');
assert.equal(auditIdFromHref(`read.html?id=JobQueueRun!!!!${seq}`).seq, 40392277, 'the audit number is inside the id');
assert.equal(auditIdFromHref('read.html?id=JobQueueRun!!!!not-base64').seq, null, 'an id it cannot read is not an error');
assert.equal(auditIdFromHref('list.html').seq, null);

const opt = (...keys) => keys.map((k) => ({ department: k.slice(0, -3), number: k.slice(-3) }));
const audit = {
    requirements: [
        { title: 'Done', status: 'OK', subs: [], options: [] },
        { title: 'GE', status: 'NO', options: [], subs: [
            { title: 'Arts', status: 'NO', options: opt('ART010', 'ART020') },
            { title: 'Social', status: 'NO', options: opt('PSY001', 'ART010') },
            { title: 'Writing', status: 'OK', options: [] },
            { title: 'Science', status: 'IP', options: opt('BIO001') },
        ] },
        { title: 'Major', status: 'NO', options: opt('ME001', 'ME021'), subs: [] },
        { title: 'Math', status: 'IP', options: [], subs: [] },
    ],
};

assert.deepEqual(unmetNodes(audit).map((n) => n.id), ['1.0', '1.1', '2'], 'OK and in-progress items need nothing more');

const planned = plannedCourses({ 202710: { ART010: { key: 'ART010', subject: 'ART', number: '010' }, ME001: { key: 'ME001', subject: 'ME', number: '001' } }, 202720: { ART010: { key: 'ART010', subject: 'ART', number: '010' } } });
assert.equal(planned.length, 3);

// ART010 fits Arts and Social. Social has fewer options (PSY001, ART010 vs ART010, ART020 are equal),
// so what matters is that one course is never spent twice.
let r = simulatePlan(audit, planned);
assert.equal(Object.keys(r.assigned).length, 2, 'ART010 meets one requirement and ME001 meets the major');
assert.equal(r.assigned['2'].key, 'ME001');
assert.deepEqual(r.spare, [], 'a course planned in two terms counts once and nothing is left over');
assert.equal(r.open.length, 1);
assert.equal(r.completes[2], true);
assert.equal(r.completes[1], false, 'GE still has an open requirement');
assert.equal(r.completes[0], true);
assert.equal(r.completes[3], true, 'in progress counts as met');

// fewest options first: PSY001 can only meet Social, so it must not be spent on Arts
r = simulatePlan(audit, [{ key: 'ART010', subject: 'ART', number: '010', term: 'a' }, { key: 'PSY001', subject: 'PSY', number: '001', term: 'a' }]);
assert.equal(r.assigned['1.0'].key, 'ART010');
assert.equal(r.assigned['1.1'].key, 'PSY001');
assert.equal(r.completes[1], true, 'both open GE requirements are covered');

// a planned course that no requirement lists is spare
r = simulatePlan(audit, [{ key: 'CSE030', subject: 'CSE', number: '030', term: 'a' }]);
assert.deepEqual(r.spare.map((p) => p.key), ['CSE030']);
assert.equal(Object.keys(r.assigned).length, 0);

console.log('ok (degree)');
