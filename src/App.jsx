import React, { useEffect, useState } from 'react';
import { useStore } from './lib/store.js';
import { BASE } from './lib/api.js';
import { SIGN_IN_URL, beginSignIn } from './lib/signin.js';
import Home from './routes/Home.jsx';
import Search from './routes/Search.jsx';
import Schedule from './routes/Schedule.jsx';
import Standing from './routes/Standing.jsx';
import Plan from './routes/Plan.jsx';
import History from './routes/History.jsx';

// Six flat routes, no params, no nesting — react-router would be more moving parts
// than this needs. Swap it in the moment a route grows parameters.
function useHashRoute(fallback = 'home') {
    const [route, setRoute] = useState(() => location.hash.slice(2) || fallback);
    useEffect(() => {
        const on = () => setRoute(location.hash.slice(2) || fallback);
        addEventListener('hashchange', on);
        return () => removeEventListener('hashchange', on);
    }, [fallback]);
    return route;
}

const TABS = [
    ['home', 'Home'],
    ['search', 'Find classes'],
    ['plan', 'Plan'],
    ['schedule', 'Schedule'],
    ['standing', 'Standing'],
    ['history', 'Record'],
];

export default function App() {
    const route = useHashRoute();
    const { auth, notifications } = useStore((s) => s);

    return (
        <>
            <header className="masthead">
                <span className="masthead-brand">UC Merced <b>MercedTime</b></span>
                <nav className="nav">
                    {TABS.map(([id, label]) => (
                        <a key={id} href={`#/${id}`} className="nav-item"
                           aria-current={route === id ? 'page' : undefined}>{label}</a>
                    ))}
                </nav>
                <span className="masthead-spacer" />
                {auth === 'in'
                    ? <span className="masthead-user">Signed in</span>
                    : <a className="masthead-user masthead-link" href={SIGN_IN_URL} onClick={beginSignIn}
                         title="Sign in to Banner, then come back here">Not signed in</a>}
                {/* The one control that leaves the app. Banner owns add/drop; we never do. */}
                <a className="exit-button"
                   href={`${BASE}/term/termSelection?mode=registration`}>
                    Register &rarr;
                </a>
            </header>

            <Notifications items={notifications} />

            {route === 'search' ? <Search />
                : route === 'plan' ? <Plan />
                : route === 'schedule' ? <Schedule />
                : route === 'standing' ? <Standing />
                : route === 'history' ? <History />
                : <Home />}
        </>
    );
}

function Notifications({ items }) {
    if (!items.length) return null;
    return (
        <div className="notifications" role="alert" aria-live="assertive">
            {items.map((n) => (
                <div key={n.id} className={`notification notification-${n.kind}`}>
                    <span className="notification-message">{n.message}</span>
                    {n.actions.map((a, i) => (
                        // Clicks are forwarded to Banner's original button so its own
                        // handler runs — we mirror the control, never reimplement it.
                        <button key={i} className="button-ghost" onClick={a.run}>{a.label}</button>
                    ))}
                </div>
            ))}
        </div>
    );
}
