// Offline check of the free-time maths against the reference week (the Mon-Fri
// schedule the free-time boxes were designed from). Run: npm run check
import assert from 'node:assert/strict';
import { freeTimes, range, DEFAULT_SETTINGS } from '../src/lib/schedule.js';
import { buildingName, locationLabel } from '../src/lib/buildings.js';
import { findDateTime } from '../src/lib/banner.js';
import { parseCourseInput } from '../src/lib/sections.js';

const m = (h, mi) => h * 60 + mi;
const B = (day, start, end) => ({ day, start, end });
const week = [
    B(0, m(9, 30), m(10, 20)), B(0, m(14, 30), m(16, 20)), B(0, m(16, 30), m(17, 45)),
    B(1, m(11, 30), m(12, 20)), B(1, m(16, 30), m(17, 45)),
    B(2, m(9, 30), m(10, 20)), B(2, m(11, 30), m(13, 20)), B(2, m(16, 30), m(17, 45)),
    B(3, m(11, 30), m(13, 20)), B(3, m(16, 30), m(17, 45)), B(3, m(18, 30), m(19, 50)),
    B(4, m(9, 30), m(10, 20)), B(4, m(11, 30), m(13, 20)), B(4, m(15, 30), m(17, 20)),
];
const got = {};
for (const g of freeTimes(week, [0, 1, 2, 3, 4], DEFAULT_SETTINGS)) (got[g.day] ??= []).push(range(g.start, g.end));
assert.deepEqual(got, {
    0: ['10:35-2:15', '6:00-7:00'],
    1: ['9:00-11:15', '12:35-4:15', '6:00-7:00'],
    2: ['1:35-4:15', '6:00-7:00'],
    3: ['9:00-11:15', '1:35-4:15'],
    4: ['1:35-3:15', '5:35-7:00'],
});

assert.equal(buildingName({ building: 'CLSSRM' }, 'common'), 'COB1');
assert.equal(buildingName({ building: 'ADMIN' }, 'common'), 'Admin');
assert.equal(buildingName({}, 'common'), 'None');
assert.equal(buildingName({ building: 'ACS', buildingDescription: 'Arts &amp; Computational Sciences' }, 'banner'), 'Arts & Computational Sciences');
assert.equal(locationLabel({ building: 'COB2', room: '170' }), 'COB2, Room 170');
assert.equal(locationLabel({ building: 'REMOTE', buildingDescription: 'Remote Instruction', room: 'ONLY' }), 'Remote', 'remote has no room');
assert.equal(locationLabel({ building: 'REMOTE', buildingDescription: 'Remote Instruction', room: 'ONLY' }, 'banner'), 'Remote Instruction');
// a building under a code the table has never seen is still recognised by its description
assert.equal(buildingName({ building: 'RUIZ', buildingDescription: 'Ruiz Administration Building' }, 'common'), 'Admin');
assert.equal(locationLabel({ building: 'RUIZ', buildingDescription: 'Ruiz Administration Building', room: '353' }), 'Admin, Room 353');
assert.equal(buildingName({ building: 'XYZ', buildingDescription: 'Somewhere New' }, 'common'), 'Somewhere New');

assert.equal(findDateTime('begins 11/12/2026 9:00 AM').getHours(), 9);
assert.deepEqual(parseCourseInput('me 1'), { key: 'ME001', subject: 'ME', number: '001' });
assert.equal(parseCourseInput('nonsense!'), null);
console.log('ok');
