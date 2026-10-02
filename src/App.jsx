import React, { useEffect, useState } from 'react';
import { useStore, set as setState } from './lib/store.js';
import { observeNotifications, bannerSignOut } from './lib/banner.js';
import Search from './routes/Search.jsx';
import Standing from './routes/Standing.jsx';
import Plan from './routes/Plan.jsx';
import History from './routes/History.jsx';

// Four flat routes, no params, no nesting — react-router would be more moving parts
// than this needs. Swap it in the moment a route grows parameters.
function useHashRoute(fallback = 'search') {
    const [route, setRoute] = useState(() => location.hash.slice(2) || fallback);
    useEffect(() => {
        const on = () => setRoute(location.hash.slice(2) || fallback);
        addEventListener('hashchange', on);
        return () => removeEventListener('hashchange', on);
    }, [fallback]);
    return route;
}

const TABS = [
    ['standing', 'Standing'],
    ['search', 'Find classes'],
    ['plan', 'Plan'],
    ['history', 'Record'],
];

export default function App() {
    const route = useHashRoute();
    const { userName, auth, notifications } = useStore((s) => s);

    // Banner writes real errors and the session-timeout prompt into a notification
    // centre inside the header we hide. Mirror it or those become unreachable.
    useEffect(() => observeNotifications((n) => setState({ notifications: n })), []);

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
                {auth === 'in' && userName
                    ? <>
                        <span className="masthead-user">{userName}</span>
                        <button className="nav-item" onClick={bannerSignOut}>Sign out</button>
                      </>
                    : <span className="masthead-user">Not signed in</span>}
                {/* The one control that leaves the app. Banner owns add/drop; we never do. */}
                <a className="exit-button"
                   href="/StudentRegistrationSsb/ssb/term/termSelection?mode=registration">
                    Register &rarr;
                </a>
            </header>

            <Notifications items={notifications} />

            {route === 'standing' ? <Standing />
                : route === 'plan' ? <Plan />
                : route === 'history' ? <History />
                : <Search />}
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
