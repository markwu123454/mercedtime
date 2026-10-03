// Registration time tickets, as plain functions of text.
//
// Banner lists the windows in which a student may register as lines like
//   11/12/2026 01:00 PM - 12/07/2026 11:59 PM
// in Pacific time (the institution's). They are parsed here with no DOM so they can be
// checked under Node; banner.js feeds them the page's text.

const TZ = 'America/Los_Angeles';

const wall = (t) => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    }).formatToParts(new Date(t));
    const g = (k) => Number(parts.find((p) => p.type === k).value);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
};

/** The instant at which a Pacific-time wall clock reads y-mo-d h:mi. Daylight saving is
 *  handled by asking what the clock reads and correcting twice. */
export function pacificToEpoch(y, mo, d, h, mi) {
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    let t = guess - (wall(guess) - guess);
    t = guess - (wall(t) - t);
    return t;
}

const STAMP = '(\\d{1,2})/(\\d{1,2})/(\\d{4})\\s+(\\d{1,2}):(\\d{2})\\s*([AaPp][Mm])';
const RANGE = new RegExp(`${STAMP}\\s*[-\\u2013\\u2014]\\s*${STAMP}`, 'g');

const stamp = (mo, d, y, h, mi, ap) =>
    pacificToEpoch(Number(y), Number(mo), Number(d), (Number(h) % 12) + (/p/i.test(ap) ? 12 : 0), Number(mi));

/** Every "start - end" window in the text, as { start, end } epoch milliseconds, earliest first. */
export function ticketWindows(text) {
    const out = [];
    for (const m of String(text).matchAll(RANGE)) {
        out.push({ start: stamp(m[1], m[2], m[3], m[4], m[5], m[6]), end: stamp(m[7], m[8], m[9], m[10], m[11], m[12]) });
    }
    return out.sort((a, b) => a.start - b.start);
}

/** Where `now` stands against the windows.
 *   open      inside one: { start, end }
 *   upcoming  before the next one: { start, end }
 *   ended     after the last
 *   unknown   no windows were found */
export function ticketState(windows, now = Date.now()) {
    if (!windows?.length) return { kind: 'unknown' };
    const w = windows.find((x) => now < x.end);
    if (!w) return { kind: 'ended', end: windows[windows.length - 1].end };
    return { kind: now >= w.start ? 'open' : 'upcoming', start: w.start, end: w.end };
}
