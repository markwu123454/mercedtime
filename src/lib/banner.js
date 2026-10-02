// Everything that touches Banner's own DOM lives here, so the React side never has to
// know it is a guest in someone else's page.

/** Banner chrome we hide. The breadcrumb trail only ever links back to /ssb/registration
 *  and the header's menu, branding and sign-in all lead to the same place, so neither
 *  survives the takeover — which also frees the ~100px they occupied.
 *  Hidden, never removed: Banner's own JS holds references to these nodes and restore()
 *  has to be able to put the page back exactly as it was. */
const CHROME_IDS = ['content', 'header-main-section', 'breadcrumb-panel'];

export function hideBannerChrome() {
    const hidden = CHROME_IDS.map((id) => document.getElementById(id)).filter(Boolean);
    for (const n of hidden) n.style.setProperty('display', 'none', 'important');
    return () => { for (const n of hidden) n.style.removeProperty('display'); };
}

/** Read Banner's notification centre.
 *
 *  It lives inside the header we hide, and it is not decorative: real errors land
 *  there ("Must select a term") with prompt buttons, and so does the session-timeout
 *  warning. Hiding the header without this makes those invisible and their buttons
 *  unreachable.
 *
 *  We mirror the text and hand back a click() onto Banner's *original* button rather
 *  than reimplementing the handler, so its state machine stays authoritative.
 *  Programmatic .click() works fine on a node inside a display:none subtree. */
export function readNotifications() {
    const centre = document.getElementById('notification-center');
    if (!centre) return [];
    return [...centre.querySelectorAll('li.notification-item')].map((item, i) => ({
        id: `${i}:${item.textContent.trim().slice(0, 40)}`,
        kind: severityOf(item),
        message: (item.querySelector('.notification-message, .notification-item-message')?.textContent || '').trim(),
        actions: [...item.querySelectorAll('.notification-item-prompts button')].map((btn) => ({
            label: (btn.textContent || '').trim(),
            run: () => btn.click(),
        })),
    }));
}

// 'notification-center-message-with-prompts' shares the severity prefix but is a
// layout flag, not a severity — drop it before picking the class.
function severityOf(item) {
    return [...item.classList]
        .map((c) => (c.match(/^notification-center-message-(.+)$/) || [])[1])
        .find((k) => k && k !== 'with-prompts') || 'info';
}

/** Subscribe to Banner's notification centre. Returns an unsubscribe fn. */
export function observeNotifications(onChange) {
    const centre = document.getElementById('notification-center');
    if (!centre) return () => {};
    const obs = new MutationObserver(() => onChange(readNotifications()));
    obs.observe(centre, { childList: true, subtree: true });
    onChange(readNotifications());     // catch anything already on the page
    return () => obs.disconnect();
}

/** Banner's own sign-out control, so we can offer it after hiding the header that
 *  normally carries it. Forwarded rather than navigating to saml/logout ourselves. */
export function bannerSignOut() {
    const el = document.getElementById('signOut');
    if (el) { el.click(); return true; }
    return false;
}

/** The signed-in user's display name from the header, if present. /ssb/registration
 *  renders anonymously, so absence here is a real signal, not a parse failure. */
export const bannerUserName = () =>
    document.querySelector('#username span, #usernameForMobile span')?.textContent?.trim() || null;

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
