// Offline check of the free-time maths against the reference week (the Mon-Fri
// schedule the free-time boxes were designed from). Run: npm run check
import assert from 'node:assert/strict';
import { freeTimes, range, DEFAULT_SETTINGS } from '../src/lib/schedule.js';
import { buildingName, locationLabel } from '../src/lib/buildings.js';
import { ticketWindows, ticketState, pacificToEpoch } from '../src/lib/ticket.js';
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


// time-ticket windows, exactly as Banner writes them (Pacific time)
const panel = `<p>Please register within these times:</p>
  <p>11/12/2026 01:00 PM - 12/07/2026 11:59 PM</p>
  <p>12/11/2026 09:00 AM - 02/08/2027 11:59 PM</p>`;
const win = ticketWindows(panel);
assert.equal(win.length, 2);
assert.equal(win[0].start, Date.UTC(2026, 10, 12, 21, 0), '1:00 PM PST is 21:00 UTC in November');
assert.equal(win[0].end, Date.UTC(2026, 11, 8, 7, 59));
assert.equal(win[1].start, Date.UTC(2026, 11, 11, 17, 0));
assert.equal(win[1].end, Date.UTC(2027, 1, 9, 7, 59));
assert.equal(pacificToEpoch(2026, 7, 1, 9, 0), Date.UTC(2026, 6, 1, 16, 0), 'July is daylight time, UTC-7');
assert.equal(ticketState(win, Date.UTC(2026, 10, 1)).kind, 'upcoming');
assert.equal(ticketState(win, Date.UTC(2026, 10, 1)).start, win[0].start);
assert.equal(ticketState(win, Date.UTC(2026, 10, 20)).kind, 'open');
assert.equal(ticketState(win, Date.UTC(2026, 11, 9)).start, win[1].start, 'between windows, the next one is the target');
assert.equal(ticketState(win, Date.UTC(2026, 11, 9)).kind, 'upcoming');
assert.equal(ticketState(win, Date.UTC(2027, 2, 1)).kind, 'ended');
assert.equal(ticketState([]).kind, 'unknown');
assert.equal(ticketWindows('Your time ticket allows registration.').length, 0);
assert.deepEqual(parseCourseInput('me 1'), { key: 'ME001', subject: 'ME', number: '001' });
assert.equal(parseCourseInput('nonsense!'), null);
console.log('ok');
