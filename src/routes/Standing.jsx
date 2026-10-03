import React, { useEffect, useState } from 'react';
import { useStore, loadTicket } from '../lib/store.js';
import { BASE } from '../lib/api.js';
import { ticketState } from '../lib/ticket.js';
import { termName, useNow } from './shared.jsx';

const fmt = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

// May I register, when, and for what: the registration status Banner shows on its
// Prepare for Registration page, read from that page's HTML (parsePrepareRegistration).
export default function Standing() {
    const { terms, openTerms, home, tickets } = useStore((s) => s);
    const now = useNow(1000);

    const choices = [...new Set([home.nextTerm, home.currentTerm, ...openTerms.map((t) => String(t.code))].filter(Boolean))]
        .sort((a, b) => Number(b) - Number(a));
    const [term, setTerm] = useState(null);
    const active = term || home.nextTerm || choices[0] || null;

    useEffect(() => { if (active) loadTicket(active); }, [active]);

    const t = active ? tickets[active] : null;
    const page = t?.page;
    const state = ticketState(page?.windows, now);

    return (
        <div className="page-scroll">
            <div className="toolbar">
                <select className="field select-field" value={active || ''} onChange={(e) => setTerm(e.target.value)} aria-label="Term">
                    {choices.map((c) => <option key={c} value={c}>{termName(terms, c)}</option>)}
                </select>
                <button className="button-ghost" onClick={() => loadTicket(active, { force: true })}>Refresh</button>
                <a className="button-ghost" href={`${BASE}/term/termSelection?mode=preReg`}>Open on Banner &rarr;</a>
            </div>

            {!active && <p className="placeholder pad">No term to show yet.</p>}
            {t?.status === 'loading' && !page && <p className="placeholder pad">Loading your registration status…</p>}
            {t?.status === 'error' && <div className="status status-error">Could not load your registration status. Sign in to Banner and refresh.</div>}
            {t?.status === 'ok' && !page && <p className="placeholder pad">Banner did not show a registration status for this term.</p>}

            {page && (
                <div className="standing">
                    <section className="card">
                        <h2 className="card-title">Registration status &middot; {page.term || termName(terms, active)}</h2>
                        {page.messages.map((m, i) => (
                            <div key={i} className={`standing-message standing-${m.kind}`}>
                                {m.lines.map((line, j) => <p key={j}>{line}</p>)}
                            </div>
                        ))}
                        {state.kind !== 'unknown' && (
                            <div className="detail-section">
                                <div className="detail-label">Registration windows</div>
                                {page.windows.map((w, i) => (
                                    <p key={i} className={now >= w.end ? 'window-past' : ''}>{fmt(w.start)} &ndash; {fmt(w.end)}</p>
                                ))}
                            </div>
                        )}
                    </section>
                    {page.curriculum.length > 0 && (
                        <section className="card">
                            <h2 className="card-title">Primary curriculum</h2>
                            <dl className="curriculum">
                                {page.curriculum.map((r) => (
                                    <React.Fragment key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></React.Fragment>
                                ))}
                            </dl>
                        </section>
                    )}
                </div>
            )}
        </div>
    );
}
