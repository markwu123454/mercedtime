import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { boot } from './lib/store.js';

// Imported as strings, not as a stylesheet: the shadow root below owns all styling, so
// `?inline` gives us the text to put inside the boundary instead of a <link> in <head>.
import tokensCSS from './styles/tokens.css?inline';
import appCSS from './styles/app.css?inline';

// This is the extension's own page (app.html). The redirect rule in rules.json sends
// /ssb/courseSearch/courseSearch here, so nothing from Banner is on the page and there
// is no host DOM to read or hide.
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
boot();
