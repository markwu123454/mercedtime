import React, { useMemo, useState } from 'react';
import { useStore, setTicketOverride } from '../lib/store.js';
import { BASE } from '../lib/api.js';
import { buildBlocks, scheduleSvg } from '../lib/schedule.js';
import { sectionsForRows } from '../lib/registrations.js';
import { shortType } from '../lib/schedule.js';
import { ScheduleSvg, termName, useNow } from './shared.jsx';

// The home page mixes terms on purpose: the schedule is the term you are in, the timer
// and the CRNs are for the term you are about to register for.
export default function Home() {
    const { home, terms, sectionsByTerm, settings, planAll, tickets } = useStore((s) => s);
    const { currentTerm, nextTerm, activeRows } = home;

    return (
        <div className="home">
            {home.error === 'signed-out' && (
                <div className="status status-error home-banner">
                    Sign in to Banner to see your schedule and registration time.{' '}
                    <a href={`${BASE}/term/termSelection?mode=preReg`}>Sign in &rarr;</a>
                </div>
            )}
            <div className="home-grid">
                <CurrentSchedule term={currentTerm} terms={terms} rows={activeRows}
                                 catalog={sectionsByTerm[currentTerm]} settings={settings} loading={home.status === 'loading'} />
                <div className="home-side">
                    <Timer term={nextTerm} terms={terms} ticket={tickets[nextTerm]}
                           override={settings.ticketOverride?.[nextTerm]} />
                    <Crns term={nextTerm} terms={terms} items={planAll[nextTerm]} />
                </div>
            </div>
        </div>
    );
}

function CurrentSchedule({ term, terms, rows, catalog, settings, loading }) {
    const svg = useMemo(() => {
        const secs = sectionsForRows(rows.filter((r) => r.term === term), catalog);
        return scheduleSvg(buildBlocks(secs, 'registered', settings.buildingScheme).blocks, settings);
    }, [term, rows, catalog, settings]);

    return (
        <section className="card card-wide">
            <h2 className="card-title">Schedule{term ? ` · ${termName(terms, term)}` : ''}</h2>
            {loading && <p className="placeholder">Loading your registrations…</p>}
            {!loading && !term && <p className="placeholder">No active registrations found.</p>}
            {term && !catalog && <p className="placeholder">Loading this term&rsquo;s classes to place your meetings…</p>}
            {term && catalog && <ScheduleSvg svg={svg} />}
        </section>
    );
}

const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function Timer({ term, terms, ticket, override }) {
    const now = useNow(1000);
    const [editing, setEditing] = useState(false);
    const target = override ?? ticket?.at ?? null;

    if (!term) {
        return <section className="card"><h2 className="card-title">Registration</h2><p className="placeholder">No upcoming term found.</p></section>;
    }

    let body;
    if (ticket?.status === 'loading' && target == null) {
        body = <p className="placeholder">Looking up your registration time…</p>;
    } else if (target == null) {
        body = (
            <>
                <p className="placeholder">Could not read a registration time from Banner.</p>
                {ticket?.text && <p className="placeholder">Banner says: {ticket.text}</p>}
            </>
        );
    } else {
        const diff = target - now;
        body = diff <= 0
            ? <div className="timer-open">Your registration time has started.</div>
            : <Countdown ms={diff} />;
    }

    return (
        <section className="card">
            <h2 className="card-title">Registration · {termName(terms, term)}</h2>
            {body}
            {target != null && (
                <p className="placeholder">
                    {new Date(target).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })}
                    {override != null && ' (set by you)'}
                </p>
            )}
            <div className="timer-edit">
                <button className="button-ghost" onClick={() => setEditing(!editing)}>
                    {editing ? 'Cancel' : target == null ? 'Set time' : 'Change time'}
                </button>
                {editing && (
                    <>
                        <input className="field" type="datetime-local"
                               defaultValue={target != null ? toLocalInput(target) : ''}
                               onChange={(e) => e.target.value && setTicketOverride(term, new Date(e.target.value).getTime())} />
                        {override != null && <button className="button-ghost" onClick={() => setTicketOverride(term, null)}>Use Banner&rsquo;s</button>}
                    </>
                )}
            </div>
        </section>
    );
}

function Countdown({ ms }) {
    const s = Math.floor(ms / 1000);
    const parts = [[Math.floor(s / 86400), 'days'], [Math.floor(s / 3600) % 24, 'hours'], [Math.floor(s / 60) % 60, 'min'], [s % 60, 'sec']];
    return (
        <div className="timer" role="timer">
            {parts.map(([n, label]) => (
                <div key={label} className="timer-cell">
                    <div className="timer-number">{pad(n)}</div>
                    <div className="timer-label">{label}</div>
                </div>
            ))}
        </div>
    );
}

function Crns({ term, terms, items }) {
    const [copied, setCopied] = useState(null);
    const rows = Object.values(items || {}).flatMap((item) => item.crns.map((crn) => ({
        crn, label: `${item.subject} ${item.number}`, type: item.info?.[crn],
    })));
    const copy = async (text, id) => {
        try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard blocked */ }
    };

    return (
        <section className="card">
            <h2 className="card-title">CRNs{term ? ` · ${termName(terms, term)}` : ''}</h2>
            {!rows.length && <p className="placeholder">No sections chosen for this term yet. Pick them in Plan.</p>}
            {rows.map((r) => (
                <div key={r.crn} className="crn-row">
                    <span className="crn-course">{r.label}</span>
                    <span className="crn-detail">{r.type ? `${shortType(r.type.type)} ${r.type.seq}` : ''}</span>
                    <span className="crn-number numeric">{r.crn}</span>
                    <button className="button-ghost" onClick={() => copy(r.crn, r.crn)}>{copied === r.crn ? 'Copied' : 'Copy'}</button>
                </div>
            ))}
            {rows.length > 1 && (
                <button className="button-ghost" onClick={() => copy(rows.map((r) => r.crn).join('\n'), 'all')}>
                    {copied === 'all' ? 'Copied' : 'Copy all'}
                </button>
            )}
        </section>
    );
}
