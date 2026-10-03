import { ticketWindows } from './ticket.js';

// Parsing of Banner's server-rendered HTML fragments.

/** The registration-status panel of prepareRegistration's HTML.
 *
 *  There is no JSON for this: prepareRegistration fires no data XHR and the panel is
 *  server-rendered, so this is the most upgrade-fragile thing in the app. It is written
 *  against the real page (fixtures/banner-pages/prepare-registration.html) and fails
 *  soft: anything it cannot find comes back empty, never as a thrown error.
 *
 *  Returns { term, messages: [{ kind, lines, text }], curriculum: [{ label, value }],
 *  windows: [{ start, end }] }, or null when the panel is not on the page. */
export function parsePrepareRegistration(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const wrap = doc.querySelector('.reg-status-wrapper');
    if (!wrap) return null;
    const clean = (n) => (n.textContent || '').replace(/\s+/g, ' ').trim();

    const messages = [...wrap.querySelectorAll('[class*="reg-status-"]')]
        .map((n) => ({ n, kind: (n.className.match(/reg-status-(success|info|error|warning)/) || [])[1] }))
        .filter(({ kind }) => kind)
        .map(({ n, kind }) => {
            const lines = [...n.querySelectorAll('p')].map(clean).filter(Boolean);
            return { kind, lines, text: lines.join(' ') || clean(n) };
        })
        .filter((m) => m.text);

    // Curriculum: a bold label paragraph, then the paragraph holding its value.
    const curriculum = [];
    let label = null;
    for (const p of wrap.querySelectorAll('.primary-curriculum p')) {
        if (p.classList.contains('strong')) label = clean(p).replace(/:$/, '');
        else if (label) { curriculum.push({ label, value: clean(p) }); label = null; }
    }

    return {
        term: clean(wrap.querySelector('p.strong') || { textContent: '' }).replace(/^Term:\s*/, ''),
        messages,
        curriculum,
        windows: ticketWindows(wrap.textContent || ''),
    };
}
