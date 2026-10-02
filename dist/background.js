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
