// Parsing of Banner's server-rendered HTML fragments.

/** Parse the registration-status panel out of prepareRegistration's HTML.
 *
 *  There is no JSON for this: prepareRegistration fires no data XHR and the panel is
 *  server-rendered. That makes this the most upgrade-fragile thing in the app, so it
 *  is written to fail soft — an empty result means "show the native page link", never
 *  a thrown error or a confidently blank card. */
export function parseRegistrationStatus(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const wrap = doc.querySelector('.reg-status-wrapper');
    if (!wrap) return null;
    const messages = [...wrap.querySelectorAll('[class*="reg-status-"]')]
        .filter((n) => /reg-status-(success|info|error|warning)/.test(n.className))
        .map((n) => ({
            kind: (n.className.match(/reg-status-(success|info|error|warning)/) || [])[1],
            text: n.textContent.trim().replace(/\s+/g, ' '),
        }))
        .filter((m) => m.text);
    const curriculum = [...(wrap.querySelector('.reg-status-right')?.querySelectorAll('b, strong') || [])]
        .map((b) => ({
            label: b.textContent.replace(/:$/, '').trim(),
            value: (b.nextSibling?.textContent || '').trim(),
        }))
        .filter((r) => r.label && r.value);
    return { messages, curriculum };
}

// --- time ticket --------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const TIME = '(?:\\s*(?:at|,|-)?\\s*(\\d{1,2}):(\\d{2})\\s*([AaPp][Mm])?)?';
const NUMERIC = new RegExp(`(\\d{1,2})/(\\d{1,2})/(\\d{4})${TIME}`);
const WORDY = new RegExp(`(${MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})${TIME}`, 'i');

function toDate(y, mo, d, h, mi, ap) {
    let hour = h == null ? 0 : parseInt(h, 10);
    if (ap) {
        const pm = /p/i.test(ap);
        hour = hour % 12 + (pm ? 12 : 0);
    }
    const date = new Date(parseInt(y, 10), mo, parseInt(d, 10), hour, mi == null ? 0 : parseInt(mi, 10));
    return Number.isNaN(date.getTime()) ? null : date;
}

/** First date (with optional clock time) in a piece of text, as a Date. Understands
 *  "11/12/2026 9:00 AM" and "Nov 12, 2026 at 9:00 AM". */
export function findDateTime(text) {
    let m = NUMERIC.exec(text);
    if (m) return toDate(m[3], parseInt(m[1], 10) - 1, m[2], m[4], m[5], m[6]);
    m = WORDY.exec(text);
    if (m) return toDate(m[3], MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)), m[2], m[4], m[5], m[6]);
    return null;
}

/** Time ticket start from prepareRegistration's HTML.
 *
 *  Like parseRegistrationStatus this reads server-rendered prose, so it looks for the
 *  sentence that mentions a ticket or registration start and has a date in it, and
 *  fails soft: `at` is null when nothing matches and `text` carries whatever sentence
 *  was closest so the caller can show it. */
export function parseTimeTicket(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const root = doc.querySelector('.reg-status-wrapper') || doc.body;
    const sentences = (root?.textContent || '')
        .split(/(?<=[.!?])\s+|\n+/)
        .map((t) => t.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    const relevant = sentences.filter((t) => /ticket|begin|start|open|window|register/i.test(t));
    for (const t of relevant) {
        const at = findDateTime(t);
        if (at) return { at, text: t };
    }
    return { at: null, text: relevant[0] || null };
}
