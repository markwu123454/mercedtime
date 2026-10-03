import React, { useEffect, useMemo, useState } from 'react';
import { useStore, loadRegistered, addPlanCourse, togglePlanCourse, togglePlanSection } from '../lib/store.js';
import {
    buildAnchors, bySeq, classMeetings, courseKey, fmtMeeting, fmtLoc,
    parseCourseInput, primaryFaculty, seatsLabel, tierOf,
} from '../lib/sections.js';
import { TermSelect } from './shared.jsx';

// Planning is keyed by course ("ME 001"), not by CRN, because a future term's CRNs may
// not exist yet. A course sits in the plan without a section; once the term's classes
// are published you pick sections for it here or in Find classes.
export default function Plan() {
    const { terms, term, sections, loading, loadingText, planAll, registered } = useStore((s) => s);
    const [text, setText] = useState('');
    const [problem, setProblem] = useState(null);

    useEffect(() => { if (term) loadRegistered(term); }, [term]);

    const catalog = useMemo(() => {
        const m = new Map();
        for (const s of sections) {
            const key = courseKey(s);
            if (!m.has(key)) m.set(key, { key, subject: s.subject, number: s.courseNumber, title: s.courseTitle });
        }
        return m;
    }, [sections]);

    const items = Object.values(planAll[term] || {}).sort((a, b) => a.key.localeCompare(b.key));
    const reg = registered[term];
    const taken = (reg?.rows || []).filter((r) => !r.dropped);

    const add = (e) => {
        e.preventDefault();
        const parsed = parseCourseInput(text);
        if (!parsed) { setProblem('Enter a course like ME 001.'); return; }
        const known = catalog.get(parsed.key);
        if (!known && catalog.size) { setProblem(`${parsed.subject} ${parsed.number} is not in this term's catalog yet. It can still be added.`); }
        else setProblem(null);
        addPlanCourse(term, { ...parsed, title: known?.title || '' });
        setText('');
    };

    return (
        <>
            <div className="toolbar">
                <TermSelect terms={terms} term={term} />
                <form className="inline-form" onSubmit={add}>
                    <input className="field" list="plan-courses" value={text} placeholder="Add a course, e.g. ME 001"
                           onChange={(e) => setText(e.target.value)} aria-label="Add a course" />
                    <datalist id="plan-courses">
                        {[...catalog.values()].map((c) => <option key={c.key} value={`${c.subject} ${c.number}`}>{c.title}</option>)}
                    </datalist>
                    <button className="button-primary" type="submit">Add</button>
                </form>
                <span className="count">{loading ? <span className="loading"><span className="spinner" />{loadingText}</span> : ''}</span>
            </div>
            {problem && <div className="status status-error">{problem}</div>}

            <div className="page-scroll">
                <h2 className="section-title">Registered</h2>
                {reg?.status === 'loading' && !taken.length && <p className="placeholder pad">Loading…</p>}
                {reg?.status === 'error' && <p className="placeholder pad">Could not load registrations. Sign in to Banner to see them here.</p>}
                {reg?.status === 'ok' && !taken.length && <p className="placeholder pad">Nothing registered for this term.</p>}
                {taken.length > 0 && (
                    <table className="data-table">
                        <thead><tr><th>Course</th><th>Title</th><th>CRN</th><th>Sec</th><th>Status</th><th>Grade</th></tr></thead>
                        <tbody>
                        {taken.map((r) => (
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

                <h2 className="section-title">Planned</h2>
                {!items.length && <p className="placeholder pad">No courses planned for this term. Add one above, or tick a course in Find classes.</p>}
                {items.map((item) => (
                    <PlanItem key={item.key} item={item} term={term}
                              sections={sections.filter((s) => courseKey(s) === item.key)}
                              loading={loading} />
                ))}
            </div>
        </>
    );
}

function PlanItem({ item, term, sections, loading }) {
    const [open, setOpen] = useState(false);
    const bundles = useMemo(() => buildAnchors(sections), [sections]);
    const picked = new Set(item.crns);

    return (
        <div className="plan-item">
            <div className="plan-head">
                <button className="caret" onClick={() => setOpen(!open)} aria-label={open ? 'Hide sections' : 'Choose sections'}>{open ? '▾' : '▸'}</button>
                <span className="course-code">{item.subject} {item.number}</span>
                <span className="course-title">{item.title}</span>
                <span className="plan-state">
                    {item.crns.length
                        ? item.crns.map((crn) => (
                            <span key={crn} className="chip">CRN {crn}</span>
                        ))
                        : <span className="placeholder">{sections.length ? 'No section chosen' : loading ? 'Loading classes…' : 'No sections published yet'}</span>}
                </span>
                <button className="button-ghost" onClick={() => togglePlanCourse(term, item)}>Remove</button>
            </div>
            {open && (
                sections.length === 0
                    ? <p className="placeholder pad">This term has no published sections for {item.subject} {item.number} yet.</p>
                    : (
                        <table className="data-table">
                            <thead><tr><th></th><th>CRN</th><th>Sec</th><th>Type</th><th>Instructor</th><th>Days/Time</th><th>Location</th><th>Seats</th></tr></thead>
                            <tbody>
                            {bundles.flatMap((b) => [b.anchor, ...b.children].map((s, i) => {
                                const seats = seatsLabel(s);
                                const tier = tierOf(s);
                                return (
                                    <tr key={s.courseReferenceNumber} className={i ? 'child-row' : 'section-row'}>
                                        <td>
                                            <input type="checkbox" checked={picked.has(s.courseReferenceNumber)}
                                                   onChange={() => togglePlanSection(s, term)}
                                                   aria-label={`Plan CRN ${s.courseReferenceNumber}`} />
                                        </td>
                                        <td className="numeric">{s.courseReferenceNumber}</td>
                                        <td>{s.sequenceNumber}</td>
                                        <td>{s.scheduleTypeDescription}</td>
                                        <td>{primaryFaculty(s) || '—'}</td>
                                        <td>{classMeetings(s).map(fmtMeeting).join('; ') || '—'}</td>
                                        <td>{classMeetings(s).map(fmtLoc).filter(Boolean).join('; ') || '—'}</td>
                                        <td className="numeric"><span className={`tag tag-${tier}`}><span className={`dot dot-${tier}`} />{seats.primary}</span></td>
                                    </tr>
                                );
                            }))}
                            </tbody>
                        </table>
                    )
            )}
        </div>
    );
}
