import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useStore, selectTerm, togglePlanSection, togglePlanCourse } from '../lib/store.js';
import * as api from '../lib/api.js';
import {
    groupCourses, parseQuery, searchRank, RANK_MISS,
    tierOf, bundleTier, seatsLabel, waitlistStatus, modality,
    classMeetings, examMeetings, fmtMeeting, fmtLoc, primaryFaculty,
    credits, courseKey,
} from '../lib/sections.js';

const COLUMNS = ['', 'CRN', 'Sec', 'Type', 'Cr', 'Instructor', 'Days/Time', 'Location', 'Seats', 'Modality'];

export default function Search() {
    const { sections, terms, term, loading, loadingText, error, plan } = useStore((s) => s);

    const [query, setQuery] = useState('');
    const [subject, setSubject] = useState('');
    const [type, setType] = useState('');
    const [sort, setSort] = useState('code');
    const [openOnly, setOpenOnly] = useState(false);
    const [planOnly, setPlanOnly] = useState(false);
    const [expanded, setExpanded] = useState(() => new Set());
    const [expandedAnchor, setExpandedAnchor] = useState(() => new Set());
    const [selection, setSelection] = useState(null);

    // Typing stays responsive while the (measured ~9ms over 6k sections) filter runs.
    const deferredQuery = useDeferredValue(query);
    const searching = deferredQuery.trim() !== '';

    const subjects = useMemo(
        () => [...new Set(sections.map((s) => s.subject))].sort(), [sections]);
    const types = useMemo(
        () => [...new Set(sections.map((s) => s.scheduleTypeDescription).filter(Boolean))].sort(), [sections]);

    const { groups, matchCount } = useMemo(() => {
        const { needle, words } = parseQuery(deferredQuery);
        const ranks = new Map();
        const kept = sections.filter((s) => {
            if (subject && s.subject !== subject) return false;
            if (type && s.scheduleTypeDescription !== type) return false;
            if (openOnly && tierOf(s) === 'full') return false;
            if (planOnly && !plan.has(s.courseReferenceNumber)) return false;
            if (needle) {
                const r = searchRank(s, needle, words);
                if (r === RANK_MISS) return false;
                ranks.set(s, r);
            }
            return true;
        });
        return {
            groups: groupCourses(kept, { sort, rankOf: needle ? ((s) => ranks.get(s)) : null }),
            matchCount: kept.length,
        };
    }, [sections, deferredQuery, subject, type, openOnly, planOnly, sort, plan]);

    const toggle = (setFn) => (key) => setFn((prev) => {
        const next = new Set(prev);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
    });

    return (
        <>
            <div className="toolbar">
                <select className="field select-field" value={term || ''}
                        onChange={(e) => selectTerm(e.target.value)} aria-label="Term">
                    {terms.map((t) => <option key={t.code} value={t.code}>{t.description}</option>)}
                </select>
                <input className="field search-field" type="search" value={query}
                       placeholder="Search title, subject, CRN, instructor…"
                       onChange={(e) => setQuery(e.target.value)} aria-label="Search classes" />
                <select className="field select-field" value={subject}
                        onChange={(e) => setSubject(e.target.value)} aria-label="Subject">
                    <option value="">All subjects</option>
                    {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="field select-field" value={type}
                        onChange={(e) => setType(e.target.value)} aria-label="Type">
                    <option value="">All types</option>
                    {types.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select className="field select-field" value={sort}
                        onChange={(e) => setSort(e.target.value)} aria-label="Sort">
                    <option value="code">Sort: Code</option>
                    <option value="title">Sort: Title</option>
                    <option value="units">Sort: Units</option>
                    <option value="open">Sort: Most seats</option>
                </select>
                <label className="checkbox">
                    <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
                    Open only
                </label>
                <label className="checkbox">
                    <input type="checkbox" checked={planOnly} onChange={(e) => setPlanOnly(e.target.checked)} />
                    My plan
                </label>
                <span className="count">
                    {loading
                        ? <span className="loading"><span className="spinner" />{loadingText}</span>
                        : `${groups.length} course${groups.length === 1 ? '' : 's'} · ${matchCount} section${matchCount === 1 ? '' : 's'}`}
                </span>
            </div>

            <div className="legend">
                <span className="legend-item"><span className="dot dot-open" />Open</span>
                <span className="legend-item"><span className="dot dot-low" />Filling up</span>
                <span className="legend-item"><span className="dot dot-full" />Full — counts cross-listed and required linked sections</span>
            </div>

            {error && <div className="status status-error">{error}</div>}

            <div className="panes">
                <div className="list-pane">
                    <table className="data-table">
                        <thead><tr>{COLUMNS.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
                        <tbody>
                        {groups.map((g) => {
                            const open = searching || expanded.has(g.key);
                            return (
                                <React.Fragment key={g.key}>
                                    <tr className="course-row"
                                        aria-selected={selection?.key === g.key || undefined}
                                        onClick={() => { toggle(setExpanded)(g.key); setSelection({ type: 'course', key: g.key, group: g }); }}>
                                        <td colSpan={COLUMNS.length}>
                                            <span className="caret">{open ? '▾' : '▸'}</span>
                                            <span className="course-code">{g.subject} {g.number}</span>{' '}
                                            <span className="course-title">{g.title}</span>{' '}
                                            <span className={`tag tag-${g.tier}`}>
                                                <span className={`dot dot-${g.tier}`} />
                                                {g.seatsOpen} seat{g.seatsOpen === 1 ? '' : 's'}
                                            </span>
                                        </td>
                                    </tr>
                                    {open && g.anchors.map((b) => {
                                        const crn = b.anchor.courseReferenceNumber;
                                        const kidsOpen = b.children.length > 0 && (searching || expandedAnchor.has(crn));
                                        return (
                                            <React.Fragment key={crn}>
                                                <SectionRow sec={b.anchor} className="section-row"
                                                            groupTier={b.children.length ? bundleTier(b) : null}
                                                            caret={b.children.length ? (kidsOpen ? '▾' : '▸') : null}
                                                            onCaret={() => toggle(setExpandedAnchor)(crn)}
                                                            planned={plan.has(crn)}
                                                            onSelect={() => setSelection({ type: 'section', sec: b.anchor })}
                                                            selected={selection?.sec === b.anchor} />
                                                {kidsOpen && b.children.map((c) => (
                                                    <SectionRow key={c.courseReferenceNumber} sec={c} className="child-row"
                                                                planned={plan.has(c.courseReferenceNumber)}
                                                                onSelect={() => setSelection({ type: 'section', sec: c })}
                                                                selected={selection?.sec === c} />
                                                ))}
                                            </React.Fragment>
                                        );
                                    })}
                                </React.Fragment>
                            );
                        })}
                        </tbody>
                    </table>
                </div>
                <DetailPane selection={selection} term={term} plan={plan} />
            </div>
        </>
    );
}

function SectionRow({ sec, className, caret, onCaret, groupTier, planned, selected, onSelect }) {
    const tier = groupTier || tierOf(sec);
    const seats = seatsLabel(sec);
    const wl = waitlistStatus(sec);
    const mod = modality(sec);
    const cm = classMeetings(sec);
    return (
        <tr className={className} aria-selected={selected || undefined} onClick={onSelect}>
            <td>
                {caret && <button className="caret" onClick={(e) => { e.stopPropagation(); onCaret(); }}
                                  aria-label={caret === '▾' ? 'Collapse linked sections' : 'Expand linked sections'}>{caret}</button>}
                <input type="checkbox" checked={planned} onClick={(e) => e.stopPropagation()}
                       onChange={() => togglePlanSection(sec)}
                       aria-label={`Add CRN ${sec.courseReferenceNumber} to plan`} />
            </td>
            <td className="numeric">{sec.courseReferenceNumber}</td>
            <td>{sec.sequenceNumber}</td>
            <td>{sec.scheduleTypeDescription}</td>
            <td className="numeric">{credits(sec)}</td>
            <td>{primaryFaculty(sec) || '—'}</td>
            <td>{cm.map(fmtMeeting).join('; ') || '—'}{examMeetings(sec).length ? ' · E' : ''}</td>
            <td>{cm.map(fmtLoc).filter(Boolean).join('; ') || '—'}</td>
            <td className="numeric" title={seats.note || undefined}>
                <span className={`tag tag-${tier}`}><span className={`dot dot-${tier}`} />{seats.primary}</span>
                {wl && ` ${wl.short}`}
            </td>
            <td>{mod.text}{mod.inferred ? '*' : ''}</td>
        </tr>
    );
}

function DetailPane({ selection, term, plan }) {
    const planAll = useStore((s) => s.planAll);
    const [details, setDetails] = useState(null);
    const [detailError, setDetailError] = useState(null);
    const sec = selection?.type === 'section' ? selection.sec : null;

    useEffect(() => {
        setDetails(null);
        setDetailError(null);
        if (!sec || !term) return;
        let cancelled = false;
        api.getDetails(term, sec.courseReferenceNumber)
            .then((d) => { if (!cancelled) setDetails(d); })
            .catch((e) => { if (!cancelled) setDetailError(e.message); });
        return () => { cancelled = true; };
    }, [sec, term]);

    if (!selection) {
        return <aside className="detail-pane"><p className="placeholder">Select a course or section for details.</p></aside>;
    }

    if (selection.type === 'course') {
        const g = selection.group;
        return (
            <aside className="detail-pane">
                <h2 className="detail-title">{g.subject} {g.number}</h2>
                <div className="detail-sub">{g.title}</div>
                <div className="detail-section">
                    <label className="checkbox">
                        <input type="checkbox" checked={!!planAll[term]?.[g.key]}
                               onChange={() => togglePlanCourse(term, { key: g.key, subject: g.subject, number: g.number, title: g.title })} />
                        Course in my plan
                    </label>
                </div>
                <div className="detail-section">
                    <div className="detail-label">Options</div>
                    <div className="detail-body">
                        {g.anchors.length} schedule option{g.anchors.length === 1 ? '' : 's'} · {g.seatsOpen} seat{g.seatsOpen === 1 ? '' : 's'} across them
                    </div>
                </div>
                <div className="detail-section">
                    <div className="detail-label">Units</div>
                    <div className="detail-body">{g.units || '—'}</div>
                </div>
            </aside>
        );
    }

    const wl = waitlistStatus(sec);
    const exams = examMeetings(sec);
    return (
        <aside className="detail-pane">
            <h2 className="detail-title">{sec.subject} {sec.courseNumber}-{sec.sequenceNumber}</h2>
            <div className="detail-sub">{sec.courseTitle} · CRN {sec.courseReferenceNumber}</div>

            <div className="detail-section">
                <label className="checkbox">
                    <input type="checkbox" checked={plan.has(sec.courseReferenceNumber)}
                           onChange={() => togglePlanSection(sec)} />
                    In my plan
                </label>
            </div>

            {wl && <Field label="Waitlist">{wl.long}</Field>}
            {exams.length > 0 && (
                <Field label="Final exam">
                    {exams.map((mt, i) => <p key={i}>{fmtMeeting(mt)} · {fmtLoc(mt) || 'TBA'} · {mt.startDate}</p>)}
                </Field>
            )}

            {detailError && <div className="status status-error">Could not load details: {detailError}</div>}
            {!details && !detailError && <p className="placeholder">Loading details…</p>}
            {details && Object.entries(details).map(([field, html]) => html && (
                <Field key={field} label={field.replace(/([A-Z])/g, ' $1')}>
                    {/* Banner returns HTML fragments here. They are same-origin content from
                        the authenticated app, rendered inside our shadow root where they
                        cannot restyle anything outside it. */}
                    <div dangerouslySetInnerHTML={{ __html: html }} />
                </Field>
            ))}
        </aside>
    );
}

const Field = ({ label, children }) => (
    <div className="detail-section">
        <div className="detail-label">{label}</div>
        <div className="detail-body">{children}</div>
    </div>
);
