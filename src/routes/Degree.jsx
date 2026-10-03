import React, { useEffect, useMemo, useState } from 'react';
import { useStore, loadDegree, runNewAudit, loadSections } from '../lib/store.js';
import { AUDIT_BASE } from '../lib/audit.js';
import { courseKeyOf, keyFromCourseText, plannedCourses, simulatePlan } from '../lib/degree.js';
import { creditNum } from '../lib/sections.js';
import { termName, ago } from './shared.jsx';

// Four states, with hue for the kind of fact and fill for how finished it is. Green is on your
// record: solid when done, an outline while it is being taken. Blue is only an intention: in
// your plan. Gray is neither. Yellow is kept for warnings and is not used here.
const STATUS = { OK: ['Complete', 'done'], IP: ['In progress', 'ip'], NO: ['Needed', 'todo'], NONE: ['No status', 'todo'] };
const OPTION_CAP = 24;

// What is left of the degree, from the student's newest uAchieve audit, and what the courses
// planned in this app would do to it. Reading is automatic; running a new audit is a button,
// because that adds an audit to the student's saved list.
export default function Degree() {
    const { degree, planAll, terms, sectionsByTerm, cacheMeta } = useStore((s) => s);
    const [tab, setTab] = useState('audit');

    useEffect(() => { loadDegree(); }, []);

    const planned = useMemo(() => plannedCourses(planAll), [planAll]);
    const plannedTerms = useMemo(() => [...new Set(planned.map((p) => p.term))], [planned]);
    // Units come from the planned term's classes where they are saved.
    useEffect(() => { plannedTerms.filter((t) => cacheMeta[t]).forEach((t) => loadSections(t).catch(() => {})); }, [plannedTerms, cacheMeta]);

    const { audit, history, meta, status } = degree;
    const sim = useMemo(() => (audit ? simulatePlan(audit, planned) : null), [audit, planned]);
    const planKeys = useMemo(() => new Set(planned.map((p) => p.key)), [planned]);
    // Courses already finished, and courses being taken now, from the audit's applied courses and
    // the history. Finished wins if a course shows up as both.
    const { doneKeys, takingKeys } = useMemo(() => {
        const done = new Set();
        const taking = new Set();
        const note = (text, inProgress) => { const k = keyFromCourseText(text); if (k) (inProgress ? taking : done).add(k); };
        for (const req of audit?.requirements || []) {
            for (const node of [req, ...req.subs]) for (const c of node.courses) note(c.course, c.inProgress);
        }
        for (const h of history || []) note(h.course, /^IP$/i.test(h.grade) || /progress/i.test(h.status));
        for (const k of done) taking.delete(k);
        return { doneKeys: done, takingKeys: taking };
    }, [audit, history]);

    const plannedUnits = useMemo(() => {
        let units = 0;
        let unknown = 0;
        for (const p of planned) {
            const secs = (sectionsByTerm[p.term] || []).filter((s) => s.subjectCourse === p.key || `${s.subject}${s.courseNumber}` === p.key);
            const u = Math.max(0, ...secs.map(creditNum));
            if (u) units += u; else unknown++;
        }
        return { units, unknown };
    }, [planned, sectionsByTerm]);

    const run = () => {
        if (window.confirm('Run a new audit on uAchieve?\n\nIt takes about ten seconds and adds an audit to your saved list there.')) runNewAudit();
    };

    return (
        <div className="page-scroll">
            <div className="toolbar">
                <button className="button-ghost" onClick={() => loadDegree({ force: true })} disabled={status === 'loading'}>Refresh</button>
                <button className="button-ghost" onClick={run} disabled={degree.running}>Run a new audit</button>
                <a className="button-ghost" href={`${AUDIT_BASE}/audit/list.html`} target="_blank" rel="noreferrer">Open uAchieve &rarr;</a>
                <span className="count">
                    {(status === 'loading' || degree.running) && <span className="loading"><span className="spinner" />{degree.running ? 'Running your audit…' : 'Reading your audit…'}</span>}
                    {status !== 'loading' && !degree.running && meta && `Read ${ago(meta.fetchedAt)}`}
                </span>
            </div>

            {audit && tab === 'audit' && (
                <div className="legend">
                    <span className="legend-item"><span className="swatch swatch-done" />Done</span>
                    <span className="legend-item"><span className="swatch swatch-ip" />Taking now</span>
                    <span className="legend-item"><span className="swatch swatch-plan" />In your plan</span>
                    <span className="legend-item"><span className="swatch swatch-todo" />Not taken or planned</span>
                </div>
            )}

            {status === 'signed-out' && (
                <div className="status status-error">
                    Sign in to uAchieve to read your degree audit.{' '}
                    <a href={`${AUDIT_BASE}/audit/list.html`} target="_blank" rel="noreferrer">Sign in &rarr;</a> then Refresh.
                </div>
            )}
            {status === 'error' && <div className="status status-error">Could not read your audit: {degree.error}</div>}
            {status === 'ok' && !audit && (
                <p className="placeholder pad">You have no completed audits yet. Run one to see what is left of your degree.</p>
            )}

            {audit && (
                <>
                    <div className="tabs-row pad">
                        <button className={`tab-button${tab === 'audit' ? ' on' : ''}`} onClick={() => setTab('audit')}>Requirements</button>
                        <button className={`tab-button${tab === 'history' ? ' on' : ''}`} onClick={() => setTab('history')}>Course history ({history.length})</button>
                    </div>

                    {tab === 'audit' && (
                        <>
                            <Summary audit={audit} plannedUnits={plannedUnits} planned={planned.length} sim={sim} />
                            {audit.requirements.map((req, ri) => (
                                <Requirement key={ri} req={req} ri={ri} sim={sim} terms={terms} planKeys={planKeys} doneKeys={doneKeys} takingKeys={takingKeys} />
                            ))}
                        </>
                    )}
                    {tab === 'history' && <History rows={history} />}
                </>
            )}
        </div>
    );
}

function Summary({ audit, plannedUnits, planned, sim }) {
    const { earned, needed, catalog, prepared } = audit.header;
    const pct = (n) => (needed ? Math.min(100, (n / needed) * 100) : 0);
    const left = sim ? sim.open.length : 0;
    return (
        <section className="card degree-summary">
            <h2 className="card-title">Degree progress</h2>
            {earned != null && needed != null ? (
                <>
                    <div className="degree-bar" role="img" aria-label={`${earned} of ${needed} units`}>
                        <span className="degree-bar-done" style={{ width: `${pct(earned)}%` }} />
                        <span className="degree-bar-plan" style={{ left: `${pct(earned)}%`, width: `${pct(earned + plannedUnits.units) - pct(earned)}%` }} />
                    </div>
                    <p>
                        <strong>{earned}</strong> of {needed} units
                        {planned > 0 && plannedUnits.units > 0 && <> &middot; plan adds <strong>{plannedUnits.units}</strong></>}
                        {plannedUnits.unknown > 0 && <span className="placeholder"> &middot; units not known for {plannedUnits.unknown} planned course{plannedUnits.unknown === 1 ? '' : 's'}</span>}
                    </p>
                </>
            ) : <p className="placeholder">The audit did not show a unit total.</p>}
            <p className="placeholder">
                {[catalog && `Catalog ${catalog}`, prepared && `Prepared ${prepared}`].filter(Boolean).join(' · ')}
            </p>
            {sim && planned > 0 && (
                <p>Your plan would meet {Object.keys(sim.assigned).length} open requirement{Object.keys(sim.assigned).length === 1 ? '' : 's'}; {left} would still be open{sim.spare.length ? `, and ${sim.spare.length} planned course${sim.spare.length === 1 ? '' : 's'} fit no listed requirement` : ''}.</p>
            )}
        </section>
    );
}

function Requirement({ req, ri, sim, terms, planKeys, doneKeys, takingKeys }) {
    const [label, tone] = STATUS[req.status] || STATUS.NONE;
    const done = sim?.completes[ri] && req.status === 'NO';
    return (
        <section className="card requirement-card">
            <div className="req-head">
                <h3 className="req-title">{req.title || req.name}</h3>
                <span className={`tag tag-req-${done ? 'plan' : tone}`}>{done ? 'Your plan finishes this' : label}</span>
                {req.status === 'NO' && (req.needs.hours || req.needs.count) ? (
                    <span className="placeholder">
                        needs {req.needs.hours ? `${req.needs.hours} units` : ''}{req.needs.hours && req.needs.count ? ', ' : ''}{req.needs.count ? `${req.needs.count} course${req.needs.count === 1 ? '' : 's'}` : ''}
                    </span>
                ) : null}
            </div>
            {req.subs.length === 0 && <Node node={req} id={`${ri}`} sim={sim} terms={terms} planKeys={planKeys} doneKeys={doneKeys} takingKeys={takingKeys} />}
            {req.subs.map((sub, si) => (
                <div key={si} className="sub-row">
                    <Node node={sub} id={`${ri}.${si}`} sim={sim} terms={terms} planKeys={planKeys} doneKeys={doneKeys} takingKeys={takingKeys} />
                </div>
            ))}
        </section>
    );
}

function Node({ node, id, sim, terms, planKeys, doneKeys, takingKeys }) {
    const [label, tone] = STATUS[node.status] || STATUS.NONE;
    const hit = sim?.assigned[id];
    const hasTitle = 'title' in node && node.title && node.subs === undefined;
    return (
        <>
            {hasTitle && (
                <div className="sub-head">
                    <span className={`dot dot-req-${hit ? 'plan' : tone}`} />
                    <strong>{node.title}</strong>
                    <span className="placeholder">{hit ? 'In your plan' : label}{node.earned ? ` · ${node.earned} units earned` : ''}{node.inProgress ? ` · ${node.inProgress} in progress` : ''}</span>
                </div>
            )}
            {node.courses.length > 0 && (
                <div className="applied">
                    {node.courses.map((c, i) => (
                        <span key={i} className={`chip chip-done${c.inProgress ? ' chip-ip' : ''}`} title={`${c.description}${c.term ? ` · ${c.term}` : ''}`}>
                            {c.course}{c.grade ? ` ${c.grade}` : ''}
                        </span>
                    ))}
                </div>
            )}
            {hit && (
                <p className="planned-hit">Your plan covers this with <strong>{hit.subject} {hit.number}</strong> in {termName(terms, hit.term)}.</p>
            )}
            {node.status !== 'OK' && node.status !== 'IP' && node.options.length > 0 && (
                <Options options={node.options} planKeys={planKeys} doneKeys={doneKeys} takingKeys={takingKeys} />
            )}
        </>
    );
}

function Options({ options, planKeys, doneKeys, takingKeys }) {
    const [all, setAll] = useState(false);
    const shown = all ? options : options.slice(0, OPTION_CAP);
    return (
        <div className="options">
            <span className="detail-label">Courses that count</span>
            <div className="applied">
                {shown.map((o) => {
                    const key = courseKeyOf(o.department, o.number);
                    const done = doneKeys.has(key);
                    const taking = !done && takingKeys.has(key);
                    const inPlan = !done && !taking && planKeys.has(key);
                    return (
                        <span key={key} className={`chip ${done ? 'chip-done' : taking ? 'chip-done chip-ip' : inPlan ? 'chip-plan' : 'chip-todo'}`}
                              title={done ? 'Done' : taking ? 'Taking now' : inPlan ? 'In your plan' : 'Not taken or planned'}>
                            {o.department} {o.number}
                        </span>
                    );
                })}
                {options.length > OPTION_CAP && (
                    <button className="button-ghost" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `+${options.length - OPTION_CAP} more`}</button>
                )}
            </div>
        </div>
    );
}

function History({ rows }) {
    if (!rows.length) return <p className="placeholder pad">No course history was found.</p>;
    return (
        <table className="data-table">
            <thead><tr><th>Term</th><th>Course</th><th>Title</th><th>Hours</th><th>Grade</th><th>Status</th></tr></thead>
            <tbody>
            {rows.map((r, i) => (
                <tr key={i}>
                    <td>{r.term || r.courseTerm}</td>
                    <td className="course-code">{r.course}</td>
                    <td>{r.title}</td>
                    <td className="numeric">{r.hours}</td>
                    <td>{r.grade}</td>
                    <td>{r.status}</td>
                </tr>
            ))}
            </tbody>
        </table>
    );
}
