import React, { useEffect, useMemo, useState } from 'react';
import { useStore, discoverTerms, addPlanCourse, togglePlanCourse, updateSettings } from '../lib/store.js';
import { parseCourseInput } from '../lib/sections.js';
import { calendarTerm } from '../lib/registrations.js';
import { SEASONS, courseOptions, makeTermCode, seasonOf, termLabel } from '../lib/courses.js';
import { termName, ago } from './shared.jsx';

// Every semester in one list: what you took or are taking, and what you are planning.
// Picking sections for a semester's plan is its own page (#/plan/schedule/<term>).
export default function Plan() {
    const { terms, planAll, registered, home, discovery, settings } = useStore((s) => s);

    // Past semesters are found by asking term by term; see discoverTerms.
    useEffect(() => { if (terms.length) discoverTerms(); }, [terms.length]);

    const extra = settings.extraTerms || [];
    const codes = [...new Set([...terms.map((t) => String(t.code)), ...extra, ...Object.keys(planAll)])]
        .sort((a, b) => Number(b) - Number(a));
    const now = home.currentTerm || calendarTerm();
    const taken = (c) => (registered[c]?.rows || []).filter((r) => !r.dropped);
    const hasPlan = (c) => Object.keys(planAll[c] || {}).length > 0;

    // Besides terms with something in them, offer the next two terms past the newest
    // one the student is registered in, so a plan can be started for them. More can be
    // added by hand below.
    const newestRegistered = codes.find((c) => taken(c).length);
    const base = newestRegistered && Number(newestRegistered) > Number(now) ? newestRegistered : now;
    const upcoming = terms.map((t) => String(t.code)).filter((c) => Number(c) > Number(base))
        .sort((a, b) => Number(a) - Number(b)).slice(0, 2);
    const shown = new Set([...codes.filter((c) => taken(c).length || hasPlan(c) || extra.includes(c)), ...upcoming, now]);
    const list = codes.filter((c) => shown.has(c));

    return (
        <div className="page-scroll">
            <DownloadPanel />
            <h2 className="section-title">Semesters</h2>
            <AddSemester existing={shown} />
            {discovery.status === 'running' && (
                <p className="placeholder pad"><span className="loading"><span className="spinner" />Looking for past semesters ({discovery.checked} checked)…</span></p>
            )}
            {list.map((c) => (
                <TermCard key={c} code={c} terms={terms} items={Object.values(planAll[c] || {})}
                          reg={registered[c]} rows={taken(c)} removable={extra.includes(c) && !hasPlan(c) && !taken(c).length}
                          status={Number(c) > Number(now) ? 'Upcoming' : c === now ? 'Current' : 'Past'} />
            ))}
            {discovery.status === 'done' && !list.length && <p className="placeholder pad">Nothing found yet.</p>}
        </div>
    );
}

/** What has been downloaded, what is downloading, and the controls for it. */
function DownloadPanel() {
    const { cacheMeta, downloads, settings, terms } = useStore((s) => s);
    const saved = Object.entries(cacheMeta);
    const sections = saved.reduce((n, [, m]) => n + m.count, 0);
    const busy = downloads.status === 'running';

    return (
        <section className="download-panel">
            <div className="download-line">
                <strong>Downloaded</strong>
                <span>{saved.length} term{saved.length === 1 ? '' : 's'}, {sections.toLocaleString()} sections</span>
                {busy && (
                    <span className="loading">
                        <span className="spinner" />
                        {downloads.mode === 'refresh' ? 'Updating seats for' : downloads.bg ? 'Downloading' : 'Loading'} {termName(terms, downloads.term)}
                        {downloads.total ? ` (${downloads.loaded} / ${downloads.total})` : ''}
                    </span>
                )}
                {!busy && saved.length > 0 && <span className="placeholder">Newest: {ago(Math.max(...saved.map(([, m]) => m.fetchedAt)))}</span>}
            </div>
            <div className="download-controls">
                <label className="checkbox" title="Keeps saving terms you have not downloaded while the app is open. Seat counts are only refreshed for the term you are looking at.">
                    <input type="checkbox" checked={settings.backgroundDownload}
                           onChange={(e) => updateSettings({ backgroundDownload: e.target.checked })} />
                    Keep downloading in the background
                </label>
                <label className="checkbox">
                    Keep the newest
                    <input className="field" type="number" min="1" max="60" value={settings.keepTerms}
                           onChange={(e) => updateSettings({ keepTerms: Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 1)) })} />
                    terms
                </label>
            </div>
        </section>
    );
}

/** Semesters further out than Banner lists can still be planned. */
function AddSemester({ existing }) {
    const { settings } = useStore((s) => s);
    const year = new Date().getFullYear();
    const [season, setSeason] = useState('10');
    const [y, setY] = useState(year + 1);

    const code = makeTermCode(season, y);
    const add = (e) => {
        e.preventDefault();
        updateSettings({ extraTerms: [...new Set([...(settings.extraTerms || []), code])] });
    };

    return (
        <form className="inline-form add-semester" onSubmit={add}>
            <span className="placeholder">Plan another semester</span>
            <select className="field select-field" value={season} onChange={(e) => setSeason(e.target.value)} aria-label="Season">
                {Object.entries(SEASONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <select className="field select-field" value={y} onChange={(e) => setY(Number(e.target.value))} aria-label="Year">
                {Array.from({ length: 9 }, (_, i) => year + i).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <button className="button-primary" type="submit" disabled={existing.has(code)}>
                {existing.has(code) ? 'Already listed' : 'Add semester'}
            </button>
        </form>
    );
}

function TermCard({ code, terms, items, reg, rows, status, removable }) {
    const { sectionsByTerm, courseIndex, settings } = useStore((s) => s);
    const [text, setText] = useState('');
    const [note, setNote] = useState(null);
    const past = status === 'Past';
    const sorted = [...items].sort((a, b) => a.key.localeCompare(b.key));

    // What can be added: this semester's own courses once published, else whatever
    // earlier semesters of the same season offered.
    const options = useMemo(() => courseOptions(code, courseIndex), [code, courseIndex]);
    const byKey = useMemo(() => new Map(options.list.map((c) => [c.key, c])), [options]);
    const season = SEASONS[seasonOf(code)] || 'term';

    const add = (e) => {
        e.preventDefault();
        const parsed = parseCourseInput(text);
        if (!parsed) { setNote({ error: true, text: 'Enter a course like ME 001.' }); return; }
        const known = byKey.get(parsed.key) || (sectionsByTerm[code] || []).find((s) => `${s.subject}${s.courseNumber}` === parsed.key);
        setNote(!known && options.list.length
            ? { text: `${parsed.subject} ${parsed.number} has not been offered in ${options.source === 'term' ? 'this semester' : `a past ${season}`} that is downloaded. Added anyway.` }
            : null);
        addPlanCourse(code, { ...parsed, title: known?.title || known?.courseTitle || '' });
        setText('');
    };

    return (
        <section className="term-card">
            <div className="term-head">
                <h3 className="term-title">{termName(terms, code)}</h3>
                <span className={`tag tag-term-${status.toLowerCase()}`}>{status}</span>
                {removable && (
                    <button className="button-ghost" onClick={() => updateSettings({ extraTerms: (settings.extraTerms || []).filter((c) => c !== code) })}>
                        Remove semester
                    </button>
                )}
                {!past && sorted.length > 0 && (
                    <a className="button-primary term-action" href={`#/plan/schedule/${code}`}>Pick a schedule</a>
                )}
            </div>

            {reg?.status === 'loading' && !rows.length && <p className="placeholder">Loading registrations…</p>}
            {rows.length > 0 && (
                <table className="data-table">
                    <thead><tr><th>Course</th><th>Title</th><th>CRN</th><th>Sec</th><th>Status</th><th>Grade</th></tr></thead>
                    <tbody>
                    {rows.map((r) => (
                        <tr key={r.crn}>
                            <td className="course-code">{r.subject} {r.number}</td>
                            <td>{r.title}</td>
                            <td className="numeric">{r.crn}</td>
                            <td>{r.seq}</td>
                            <td>{r.status || '—'}</td>
                            <td>{r.grade || '—'}</td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            )}

            {sorted.map((item) => {
                const seen = options.source === 'history' ? byKey.get(item.key)?.seen : null;
                return (
                    <div key={item.key} className="plan-head">
                        <span className="course-code">{item.subject} {item.number}</span>
                        <span className="course-title">{item.title || byKey.get(item.key)?.title}</span>
                        <span className="plan-state">
                            {item.crns.length
                                ? item.crns.map((crn) => <span key={crn} className="chip">CRN {crn}</span>)
                                : <span className="placeholder">
                                    {options.source === 'history'
                                        ? (seen ? `Offered ${seen.slice(-3).reverse().map(termLabel).join(', ')}` : `Not seen in a past ${season}`)
                                        : 'No section chosen'}
                                  </span>}
                        </span>
                        <button className="button-ghost" onClick={() => togglePlanCourse(code, item)}>Remove</button>
                    </div>
                );
            })}

            {!past && (
                <form className="inline-form term-add" onSubmit={add}>
                    <input className="field" list={`courses-${code}`} value={text} placeholder="Add a course, e.g. ME 001"
                           onChange={(e) => setText(e.target.value)} aria-label={`Add a course to ${termName(terms, code)}`} />
                    <datalist id={`courses-${code}`}>
                        {options.list.map((c) => <option key={c.key} value={`${c.subject} ${c.number}`}>{c.title}</option>)}
                    </datalist>
                    <button className="button-ghost" type="submit">Add</button>
                    {options.list.length > 0 && (
                        <span className="placeholder">
                            {options.source === 'term' ? 'Courses offered this semester' : `Courses offered in past ${season}s`} ({options.list.length})
                        </span>
                    )}
                    {note && <span className={note.error ? 'status-error' : 'placeholder'}>{note.text}</span>}
                </form>
            )}
        </section>
    );
}
