// Weekly schedule maths and the SVG for it, as pure functions of sections.
//
// Framework-free like sections.js so it can be checked against the fixtures without a
// browser. The SVG is a string rather than JSX for the same reason, and because the
// Download button needs the identical markup.

import { classMeetings, courseKey } from './sections.js';
import { locationLabel } from './buildings.js';

export const DAYS = [
    ['monday', 'Mon'], ['tuesday', 'Tue'], ['wednesday', 'Wed'], ['thursday', 'Thu'],
    ['friday', 'Fri'], ['saturday', 'Sat'], ['sunday', 'Sun'],
];

export const DEFAULT_SETTINGS = {
    buildingScheme: 'common',
    showFree: true,
    freeStart: 9 * 60,       // minutes after midnight
    freeEnd: 19 * 60,
    padBefore: 15,
    padAfter: 15,
    minFree: 60,             // shorter gaps are not worth drawing
    includePlanned: true,
};

/** "0930" -> 570 */
export const toMin = (t) => {
    const s = String(t).padStart(4, '0');
    return parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(2), 10);
};

/** 570 -> "9:30" (no am/pm: the axis already says which half of the day it is) */
export const clock = (m) => `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, '0')}`;
export const range = (a, b) => `${clock(a)}-${clock(b)}`;
const axisLabel = (h) => `${h % 12 || 12}${h % 24 >= 12 ? 'pm' : 'am'}`;

/** "Lecture-Supplem Act (Discuss)" -> "Discussion". Banner's schedule types are too
 *  long for a 124px column. */
export function shortType(desc) {
    const d = String(desc || '');
    if (/discuss/i.test(d)) return 'Discussion';
    if (/^lab/i.test(d)) return 'Lab';
    if (/^seminar/i.test(d)) return 'Seminar';
    if (/^lecture/i.test(d)) return 'Lecture';
    if (/^studio/i.test(d)) return 'Studio';
    if (/^fieldwork/i.test(d)) return 'Fieldwork';
    if (/^individual/i.test(d)) return 'Individual';
    return d.split(/[\s-]/)[0] || '';
}

/** One block per section meeting per weekday. `kind` is 'registered' or 'planned'.
 *  Meetings without a clock time (TBA) cannot be placed; they come back separately. */
export function buildBlocks(sections, kind, scheme = 'common') {
    const blocks = [];
    const unplaced = [];
    for (const sec of sections) {
        const code = `${sec.subject} ${sec.courseNumber}`;
        const meets = classMeetings(sec);
        let placed = false;
        for (const mt of meets) {
            if (!mt.beginTime || !mt.endTime) continue;
            const start = toMin(mt.beginTime);
            const end = toMin(mt.endTime);
            // The section's own schedule type first; the meeting carries a short label of
            // its own ("Lab", "Discussion") for records that arrive without one.
            const type = shortType(sec.scheduleTypeDescription) || shortType(mt.meetingTypeDescription) || 'Class';
            for (const [i, [key]] of DAYS.entries()) {
                if (!mt[key]) continue;
                placed = true;
                blocks.push({
                    day: i, start, end, kind, code, type,
                    loc: locationLabel(mt, scheme), crn: sec.courseReferenceNumber, key: courseKey(sec),
                });
            }
        }
        if (!placed) unplaced.push({ code, type: shortType(sec.scheduleTypeDescription) || 'Class', crn: sec.courseReferenceNumber, kind });
    }
    return { blocks, unplaced };
}

/** Give overlapping blocks on the same day side-by-side lanes. */
export function assignLanes(blocks) {
    const out = blocks.map((b) => ({ ...b, lane: 0, lanes: 1 }));
    for (let day = 0; day < DAYS.length; day++) {
        const col = out.filter((b) => b.day === day).sort((a, b) => a.start - b.start || a.end - b.end);
        let cluster = [];
        let clusterEnd = -1;
        const flush = () => {
            const lanes = Math.max(1, ...cluster.map((b) => b.lane + 1));
            for (const b of cluster) b.lanes = lanes;
            cluster = [];
        };
        const laneEnds = [];
        for (const b of col) {
            if (cluster.length && b.start >= clusterEnd) { flush(); laneEnds.length = 0; }
            let lane = laneEnds.findIndex((e) => e <= b.start);
            if (lane < 0) lane = laneEnds.length;
            laneEnds[lane] = b.end;
            b.lane = lane;
            cluster.push(b);
            clusterEnd = Math.max(clusterEnd, b.end);
        }
        if (cluster.length) flush();
    }
    return out;
}

/** Gaps inside [freeStart, freeEnd] that are clear of every class once each class is
 *  widened by the before/after padding. Gaps under `minFree` minutes are dropped. */
export function freeTimes(blocks, days, s) {
    const free = [];
    for (const day of days) {
        const busy = blocks
            .filter((b) => b.day === day)
            .map((b) => [Math.max(s.freeStart, b.start - s.padBefore), Math.min(s.freeEnd, b.end + s.padAfter)])
            .filter(([a, b]) => b > a)
            .sort((x, y) => x[0] - y[0]);
        let cursor = s.freeStart;
        const gap = (a, b) => { if (b - a >= Math.max(1, s.minFree)) free.push({ day, start: a, end: b }); };
        for (const [a, b] of busy) {
            if (a > cursor) gap(cursor, a);
            cursor = Math.max(cursor, b);
        }
        if (cursor < s.freeEnd) gap(cursor, s.freeEnd);
    }
    return free;
}

// --- SVG ---------------------------------------------------------------------

const LEFT = 50, TOP = 30, HOUR = 50, DAYW = 130;
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STYLE = {
    registered: { fill: '#dbeafe', stroke: '#3b82f6', text: '#1e40af', dash: '' },
    planned: { fill: '#fef3c7', stroke: '#f59e0b', text: '#92400e', dash: ' stroke-dasharray="4 3"' },
    free: { fill: '#dcfce7', stroke: '#22c55e', text: '#15803d' },
};

/** Cut a line to the width of its box (11px Arial runs about 5.6px per character, a
 *  little more in bold). Side-by-side lanes are narrow enough for this to matter. */
function fit(text, width, bold) {
    const max = Math.max(3, Math.floor(width / (bold ? 6.4 : 5.6)));
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** The weekly grid. Layout constants reproduce the reference SVG: 50px per hour, 130px
 *  per day, class boxes inset 3px, a 15-minute-wide strip of detail per line of text. */
export function scheduleSvg(inputBlocks, settings = DEFAULT_SETTINGS) {
    const blocks = assignLanes(inputBlocks);
    const used = blocks.map((b) => b.day);
    const lastDay = Math.max(4, ...used);               // Mon-Fri, plus the weekend only when needed
    const days = Array.from({ length: lastDay + 1 }, (_, i) => i);
    const free = settings.showFree ? freeTimes(blocks, days, settings) : [];

    // The grid shows 8am-8pm and stretches to hold anything outside that.
    let h0 = 8, h1 = 20;
    for (const b of blocks) { h0 = Math.min(h0, Math.floor(b.start / 60)); h1 = Math.max(h1, Math.ceil(b.end / 60)); }
    if (settings.showFree) { h0 = Math.min(h0, Math.floor(settings.freeStart / 60)); h1 = Math.max(h1, Math.ceil(settings.freeEnd / 60)); }

    const y = (m) => TOP + ((m - h0 * 60) * HOUR) / 60;
    const W = LEFT + DAYW * days.length;
    const plotH = (h1 - h0) * HOUR;
    const legendY = TOP + plotH + 20;
    const H = legendY + 35;
    const o = [];

    o.push(`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Arial, Helvetica, sans-serif">`);
    o.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
    for (const d of days) {
        o.push(`<text x="${LEFT + DAYW * d + DAYW / 2}" y="20" text-anchor="middle" font-size="13" font-weight="bold" fill="#374151">${DAYS[d][1]}</text>`);
    }
    o.push(`<rect x="${LEFT}" y="${TOP}" width="${W - LEFT}" height="${plotH}" fill="none" stroke="#e5e7eb"/>`);
    for (let k = 1; k < h1 - h0; k++) o.push(`<line x1="${LEFT}" y1="${TOP + HOUR * k}" x2="${W}" y2="${TOP + HOUR * k}" stroke="#e5e7eb"/>`);
    for (const d of days.slice(1)) o.push(`<line x1="${LEFT + DAYW * d}" y1="${TOP}" x2="${LEFT + DAYW * d}" y2="${TOP + plotH}" stroke="#e5e7eb"/>`);
    o.push('<g font-size="11" fill="#9ca3af" text-anchor="end">');
    for (let k = 0; k <= h1 - h0; k++) o.push(`<text x="45" y="${TOP + HOUR * k + 5}">${axisLabel(h0 + k)}</text>`);
    o.push('</g>');

    const f = STYLE.free;
    for (const g of free) {
        const gy = Math.round(y(g.start)), gh = Math.round(((g.end - g.start) * HOUR) / 60);
        const gx = LEFT + DAYW * g.day + 3;
        o.push(`<rect x="${gx}" y="${gy}" width="${DAYW - 6}" height="${gh}" rx="4" fill="${f.fill}" stroke="${f.stroke}" stroke-width="1"/>`);
        if (gh >= 16) o.push(`<text x="${gx + (DAYW - 6) / 2}" y="${Math.round(gy + gh / 2 + 3.5)}" font-size="11" fill="${f.text}" text-anchor="middle">${range(g.start, g.end)}</text>`);
    }
    for (const b of blocks) {
        const s = STYLE[b.kind] || STYLE.registered;
        const laneW = (DAYW - 6) / b.lanes;
        const bx = LEFT + DAYW * b.day + 3 + b.lane * laneW;
        const by = Math.round(y(b.start)), bh = Math.round(((b.end - b.start) * HOUR) / 60);
        const bw = Math.round(laneW - (b.lanes > 1 ? 2 : 0));
        o.push(`<rect x="${Math.round(bx)}" y="${by}" width="${bw}" height="${bh}" rx="4" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1"${s.dash}/>`);
        // A box too short for a second line still has to say what kind of class it is.
        const room = Math.max(1, Math.min(3, Math.floor((bh - 4) / 12)));
        const lines = (room === 1
            ? [[`${b.code} ${b.type}`, true]]
            : [[b.code, true], [`${b.type} ${range(b.start, b.end)}`, false], [b.loc, false]]
        ).slice(0, room);
        lines.forEach(([text, bold], i) => {
            if (!text) return;
            o.push(`<text x="${Math.round(bx) + 7}" y="${by + 13 + i * 12}" font-size="11" fill="${s.text}"${bold ? ' font-weight="bold"' : ''}>${esc(fit(text, bw - 10, bold))}</text>`);
        });
    }

    const legend = [['registered', 'Class']];
    if (blocks.some((b) => b.kind === 'planned')) legend.push(['planned', 'Planned']);
    if (settings.showFree) legend.push(['free', 'Free time']);
    legend.forEach(([kind, label], i) => {
        const s = STYLE[kind];
        const x = LEFT + i * 90;
        o.push(`<rect x="${x}" y="${legendY}" width="12" height="12" fill="${s.fill}" stroke="${s.stroke}"${s.dash || ''}/>`);
        o.push(`<text x="${x + 18}" y="${legendY + 10}" font-size="12" fill="#374151">${label}</text>`);
    });
    o.push('</svg>');
    return o.join('\n');
}
