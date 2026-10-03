import React, { useEffect, useState } from 'react';
import { useStore, discoverTerms, addPlanCourse, togglePlanCourse } from '../lib/store.js';
import { parseCourseInput, courseKey } from '../lib/sections.js';
import { calendarTerm } from '../lib/registrations.js';
import { termName } from './shared.jsx';

// Every semester in one list: what you took or are taking, and what you are planning.
// Picking sections for a semester's plan is its own page (#/plan/schedule/<term>).
export default function Plan() {
    const { terms, planAll, registered, home, discovery } = useStore((s) => s);

    // Past semesters are found by asking term by term; see discoverTerms.
    useEffect(() => { if (terms.length) discoverTerms(); }, [terms.length]);

    const codes = terms.map((t) => String(t.code)).sort((a, b) => Number(b) - Number(a));
    const now = home.currentTerm || calendarTerm();
    const taken = (c) => (registered[c]?.rows || []).filter((r) => !r.dropped);
    const hasPlan = (c) => Object.keys(planAll[c] || {}).length > 0;

    // Besides terms with something in them, offer the next two terms past the newest
    // one the student is registered in, so a plan can be started for them.
    const newestRegistered = codes.find((c) => taken(c).length);
    const base = newestRegistered && Number(newestRegistered) > Number(now) ? newestRegistered : now;
    const upcoming = codes.filter((c) => Number(c) > Number(base)).slice(-2);
    const shown = new Set([...codes.filter((c) => taken(c).length || hasPlan(c)), ...upcoming, ...codes.filter((c) => c === now)]);
    const list = codes.filter((c) => shown.has(c));

    return (
        <div className="page-scroll">
            <h2 className="section-title">Semesters</h2>
            {discovery.status === 'running' && (
                <p className="placeholder pad"><span className="loading"><span className="spinner" />Looking for past semesters ({discovery.checked} checked)…</span></p>
            )}
            {list.map((c) => (
                <TermCard key={c} code={c} terms={terms} items={Object.values(planAll[c] || {})}
                          reg={registered[c]} rows={taken(c)}
                          status={Number(c) > Number(now) ? 'Upcoming' : c === now ? 'Current' : 'Past'} />
            ))}
            {discovery.status === 'done' && !list.length && <p className="placeholder pad">Nothing found yet.</p>}
        </div>
    );
}

function TermCard({ code, terms, items, reg, rows, status }) {
    const { sectionsByTerm } = useStore((s) => s);
    const [text, setText] = useState('');
    const [problem, setProblem] = useState(null);
    const past = status === 'Past';
    const sorted = [...items].sort((a, b) => a.key.localeCompare(b.key));

    const add = (e) => {
        e.preventDefault();
        const parsed = parseCourseInput(text);
        if (!parsed) { setProblem('Enter a course like ME 001.'); return; }
        setProblem(null);
        const known = (sectionsByTerm[code] || []).find((s) => courseKey(s) === parsed.key);
        addPlanCourse(code, { ...parsed, title: known?.courseTitle || '' });
        setText('');
    };

    return (
        <section className="term-card">
            <div className="term-head">
                <h3 className="term-title">{termName(terms, code)}</h3>
                <span className={`tag tag-term-${status.toLowerCase()}`}>{status}</span>
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

            {sorted.map((item) => (
                <div key={item.key} className="plan-head">
                    <span className="course-code">{item.subject} {item.number}</span>
                    <span className="course-title">{item.title}</span>
                    <span className="plan-state">
                        {item.crns.length
                            ? item.crns.map((crn) => <span key={crn} className="chip">CRN {crn}</span>)
                            : <span className="placeholder">No section chosen</span>}
                    </span>
                    <button className="button-ghost" onClick={() => togglePlanCourse(code, item)}>Remove</button>
                </div>
            ))}

            {!past && (
                <form className="inline-form term-add" onSubmit={add}>
                    <input className="field" value={text} placeholder="Add a course, e.g. ME 001"
                           onChange={(e) => setText(e.target.value)} aria-label={`Add a course to ${termName(terms, code)}`} />
                    <button className="button-ghost" type="submit">Add</button>
                    {problem && <span className="status-error">{problem}</span>}
                </form>
            )}
        </section>
    );
}
