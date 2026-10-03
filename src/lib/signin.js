import { BASE } from './api.js';

// Sending the tab to Banner to log in, and back. The service worker (dist/background.js) does
// the rest: once the tab lands on a Banner page it checks whether the student is signed in,
// tries other login-starting URLs if not, and returns the tab to this app when it is.
//
// The first URL is the hop Banner's own "Prepare for Registration" link goes through; it needs
// a login, and after one it leads on to the term page.
export const SIGN_IN_URL = `${BASE}/registration/registerPostSignIn?mode=preReg`;

export async function beginSignIn(e) {
    e.preventDefault();
    try {
        const tab = await chrome.tabs.getCurrent();
        await chrome.storage.session.set({ pendingSignIn: { tabId: tab?.id, at: Date.now(), attempt: 0 } });
    } catch { /* without the flag the user simply stays in Banner after signing in */ }
    location.href = SIGN_IN_URL;
}
