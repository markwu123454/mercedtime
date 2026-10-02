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
