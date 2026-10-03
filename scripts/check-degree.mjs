// Offline check of the degree-audit logic that needs no DOM: ids, course keys, and what a plan
// does to an audit's open requirements. (The HTML parsers need a browser; see
// fixtures/uachieve/README.md.) Run: npm run check
import assert from 'node:assert/strict';
import { auditIdFromHref, courseKeyOf, dedupeRequirements, keyFromCourseText, normalizeNumber, plannedCourses, simulatePlan, splitHeading, tidyDescription, unmetNodes } from '../src/lib/degree.js';

assert.equal(normalizeNumber('10H'), '010H');
assert.equal(normalizeNumber('010h'), '010H');
assert.equal(normalizeNumber('172'), '172');
assert.equal(courseKeyOf('sprk', '010H'), 'SPRK010H');

assert.equal(keyFromCourseText('ENGR 057'), 'ENGR057');
assert.equal(keyFromCourseText(' sprk 010h '), 'SPRK010H');
assert.equal(keyFromCourseText('Transfer credit'), null, 'text that is not a course is ignored');

// headings as the real audit shows them, with the title and instruction run together
const cases = [
    ['Aerospace Engineering EmphasisComplete three of the following courses:', 'Aerospace Engineering Emphasis', 'Complete three of the following courses:'],
    ['ME Major Requirements All courses must be completed with a C- grade or better', 'ME Major Requirements', 'All courses must be completed with a C- grade or better'],
    ['Introductory Physics IComplete the following courses:', 'Introductory Physics I', 'Complete the following courses:'],
    ['Mathematics RequirementComplete five courses from the following list:', 'Mathematics Requirement', 'Complete five courses from the following list:'],
    ['Computing RequirementComplete the following course:', 'Computing Requirement', 'Complete the following course:'],
    ['Residency', 'Residency', ''],
    ['Complete Core', 'Complete Core', ''],
];
assert.equal(tidyDescription('To see the complete course list, click here. Complete'), '');
assert.equal(tidyDescription('Complete two courses: Needed'), 'Complete two courses:');
assert.deepEqual(splitHeading('Scientific Method To see the complete course list, click here.'), { title: 'Scientific Method', description: '' });
for (const [text, title, description] of cases) assert.deepEqual(splitHeading(text), { title, description }, text);

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

// a report that lists everything twice must not double the requirements
const once = audit.requirements;
const twice = dedupeRequirements([...once, ...once]);
assert.equal(twice.length, once.length, 'an exact repeat of the whole list is dropped');
assert.deepEqual(twice.map((r) => r.title), once.map((r) => r.title), 'and the first copy stays, in order');
const same = { name: 'X', title: 'Same title', description: '', status: 'NO', needs: {}, options: opt('ART010'), courses: [], subs: [] };
assert.equal(dedupeRequirements([same, { ...same, options: opt('ART020') }]).length, 2, 'same title with different options is a different requirement');
const dbl = simulatePlan({ requirements: twice }, planned);
assert.equal(Object.keys(dbl.assigned).length, Object.keys(simulatePlan(audit, planned).assigned).length, 'planned courses are counted once');

console.log('ok (degree)');
