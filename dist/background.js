// Sends Banner's menu page (/ssb/registration) to the extension's own page.
// Done from a service worker with tabs.update rather than a declarativeNetRequest
// redirect, so app.html does not have to be web-accessible to the Banner origin.
const HOST = 'reg-prod.ec.ucmerced.edu';
const MENU_PATHS = [
  '/StudentRegistrationSsb/ssb/registration',
  '/StudentRegistrationSsb/ssb/registration/',
  '/StudentRegistrationSsb/ssb/registration/registration',
  '/StudentRegistrationSsb/ssb/registration/registration/',
];

chrome.webNavigation.onBeforeNavigate.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    chrome.tabs.update(details.tabId, { url: chrome.runtime.getURL('app.html') });
  },
  { url: MENU_PATHS.map((pathEquals) => ({ hostEquals: HOST, schemes: ['https'], pathEquals })) },
);

// Sign-in round trip. The extension page's "Sign in" link sets pendingSignIn for its own tab
// and sends the tab to Banner. Banner only starts a login when a page needs one, and which
// pages do is not something to assume (the term-selection page, for one, shows to anyone and
// starts nothing). So the worker checks instead of assuming:
//
//   * every time the flagged tab lands on a Banner page, it asks Banner whether the student is
//     signed in (a request that only answers JSON to a signed-in session);
//   * signed in: the tab goes back to the app;
//   * not signed in: the page did not start a login, so the tab is sent to the next URL that is
//     likely to (up to the end of the list), and the check repeats when it lands.
//
// onCommitted, not onBeforeNavigate: it fires when a navigation lands, at the URL it ended on,
// so the IdP and Duo pages (another host) and the redirects in between never trigger it and the
// login is never interrupted. The flag is tab-specific and expires, so an ordinary visit to
// Banner is left alone.
const SIGN_IN_TTL_MS = 10 * 60 * 1000;
const BASE = `https://${HOST}/StudentRegistrationSsb/ssb`;
const SIGN_IN_ENTRIES = [
  `${BASE}/registration/registerPostSignIn?mode=preReg`,        // what Banner's own "Prepare for Registration" link leads through
  `${BASE}/classRegistration/getTerms?searchTerm=&offset=1&max=1`,
  `${BASE}/prepareRegistration/prepareRegistration`,
];

/** True when Banner treats this browser as signed in: the open-terms list answers JSON. */
async function signedIn() {
  try {
    const res = await fetch(SIGN_IN_ENTRIES[1], { credentials: 'include', redirect: 'manual' });
    return res.type !== 'opaqueredirect' && res.ok
      && res.headers.get('X-Login-Page') !== 'true'
      && /json/i.test(res.headers.get('content-type') || '');
  } catch {
    return false;
  }
}

chrome.webNavigation.onCommitted.addListener(
  async (details) => {
    if (details.frameId !== 0) return;
    const { pendingSignIn: flag } = await chrome.storage.session.get('pendingSignIn');
    if (!flag || flag.tabId !== details.tabId) return;
    const app = chrome.runtime.getURL('app.html');
    const finish = async () => {
      await chrome.storage.session.remove('pendingSignIn');
      chrome.tabs.update(details.tabId, { url: app });
    };
    if (Date.now() - flag.at > SIGN_IN_TTL_MS) { await chrome.storage.session.remove('pendingSignIn'); return; }

    if (await signedIn()) { await finish(); return; }

    // This page did not start a login. Try the next URL that might; give up at the end.
    const attempt = (flag.attempt || 0) + 1;
    if (attempt >= SIGN_IN_ENTRIES.length) { await finish(); return; }
    await chrome.storage.session.set({ pendingSignIn: { ...flag, attempt } });
    chrome.tabs.update(details.tabId, { url: SIGN_IN_ENTRIES[attempt] });
  },
  { url: [{ hostEquals: HOST, schemes: ['https'], pathPrefix: '/StudentRegistrationSsb/ssb/' }] },
);
