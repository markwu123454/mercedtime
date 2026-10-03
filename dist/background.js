// Sends Banner's menu page (/ssb/registration) to the extension's own page.
// Done from a service worker with tabs.update rather than a declarativeNetRequest
// redirect, so app.html does not have to be web-accessible to the Banner origin.
const HOST = 'reg-prod.ec.ucmerced.edu';
const MENU_PATHS = [
  '/StudentRegistrationSsb/ssb/registration',
  '/StudentRegistrationSsb/ssb/registration/',
];

chrome.webNavigation.onBeforeNavigate.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    chrome.tabs.update(details.tabId, { url: chrome.runtime.getURL('app.html') });
  },
  { url: MENU_PATHS.map((pathEquals) => ({ hostEquals: HOST, schemes: ['https'], pathEquals })) },
);

// Sign-in round trip. The extension page's "Sign in" link sets pendingSignIn for its
// own tab and goes to Banner's Prepare for Registration term page, which is protected,
// so Banner sends the user through SSO and back to that URL. Only when the tab arrives
// there does it return to app.html. Nothing in between (the IdP, Duo) matches, so the
// login is never interrupted. The flag is tab-specific and expires, so a normal visit
// to that Banner page is left alone.
const SIGN_IN_TTL_MS = 10 * 60 * 1000;

chrome.webNavigation.onBeforeNavigate.addListener(
  async (details) => {
    if (details.frameId !== 0) return;
    const { pendingSignIn } = await chrome.storage.session.get('pendingSignIn');
    if (!pendingSignIn || pendingSignIn.tabId !== details.tabId) return;
    await chrome.storage.session.remove('pendingSignIn');
    if (Date.now() - pendingSignIn.at > SIGN_IN_TTL_MS) return;
    chrome.tabs.update(details.tabId, { url: chrome.runtime.getURL('app.html') });
  },
  {
    url: [{
      hostEquals: HOST, schemes: ['https'],
      pathEquals: '/StudentRegistrationSsb/ssb/term/termSelection', queryContains: 'mode=preReg',
    }],
  },
);
