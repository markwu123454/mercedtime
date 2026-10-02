import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { hideBannerChrome, bannerUserName } from './lib/banner.js';
import { boot } from './lib/store.js';

// Imported as strings, not as a stylesheet: Vite would otherwise emit a <link> or a
// <style> into the host page's <head>, which is the thing the shadow root exists to
// avoid. `?inline` gives us the text to put inside the boundary instead.
import tokensCSS from './styles/tokens.css?inline';
import appCSS from './styles/app.css?inline';

// --- route guard -------------------------------------------------------------
// The manifest matches all of /ssb/*, so this bundle loads on every Banner page.
// Anything not listed here falls through to Banner untouched — above all
// classRegistration, which owns the real add/drop and must never be taken over.
// Add a route here only once there is code behind it.
const ROUTES = ['registration', 'classSearch'];

function shouldMount() {
    const section = (location.pathname.match(/\/ssb\/([^/]+)/) || [])[1];
    if (!ROUTES.includes(section)) return false;
    // /ssb/registration/registerPostSignIn is the SSO landing hop that replays the
    // mode you were heading to before logging in. It normally 302s without rendering,
    // but never take it over if it ever does — that would swallow the deep link.
    if (/\/ssb\/registration\/registerPostSignIn/.test(location.pathname)) return false;
    return true;
}

if (shouldMount()) {
    const userName = bannerUserName();   // read before we hide the header
    hideBannerChrome();

    // closed mode: Banner's scripts cannot reach in and query our tree, and ours
    // cannot be styled by its CSS. The dropdown-clipping bug that started this
    // project is structurally impossible on this side of the boundary.
    const host = document.createElement('div');
    host.id = 'mercedtime-root';
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = tokensCSS + '\n' + appCSS;
    shadow.append(style);

    const mount = document.createElement('div');
    mount.className = 'app';
    shadow.append(mount);

    createRoot(mount).render(<React.StrictMode><App /></React.StrictMode>);
    boot({ userName });
}
