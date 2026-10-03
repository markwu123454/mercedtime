import { BASE } from './api.js';

// Banner's Prepare for Registration term page needs a login, and after SSO it is the
// URL Banner lands on. The service worker (dist/background.js) watches for the tab
// arriving there and sends it back to this app, so the user ends up where they started.
export const SIGN_IN_URL = `${BASE}/term/termSelection?mode=preReg`;

export async function beginSignIn(e) {
    e.preventDefault();
    try {
        const tab = await chrome.tabs.getCurrent();
        await chrome.storage.session.set({ pendingSignIn: { tabId: tab?.id, at: Date.now() } });
    } catch { /* without the flag the user simply stays in Banner after signing in */ }
    location.href = SIGN_IN_URL;
}
