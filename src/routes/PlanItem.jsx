import React, { useMemo, useState } from 'react';
import { togglePlanCourse, togglePlanSection, updateSettings } from '../lib/store.js';
import {
    buildAnchors, classMeetings, fmtMeeting, fmtLoc, primaryFaculty, seatsLabel, tierOf,
} from '../lib/sections.js';

// One planned course, with the section picker and the lecture setting.
export default function PlanItem({ item, term, sections, loading, settings }) {
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
                <LectureSetting courseKey={item.key} settings={settings} />
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

/** Whether this course's lecture counts as skippable. "Auto" follows the global setting. */
export function LectureSetting({ courseKey, settings }) {
    const cur = settings.softOverride?.[courseKey];
    const value = cur === undefined ? 'auto' : String(cur);
    const change = (e) => {
        const next = { ...(settings.softOverride || {}) };
        if (e.target.value === 'auto') delete next[courseKey];
        else next[courseKey] = e.target.value === 'true';
        updateSettings({ softOverride: next });
    };
    return (
        <select className="field select-field lecture-setting" value={value} onChange={change}
                aria-label={`Lecture attendance for ${courseKey}`} title="Does this course's lecture take attendance?">
            <option value="auto">Lecture: auto</option>
            <option value="true">Lecture: skippable</option>
            <option value="false">Lecture: required</option>
        </select>
    );
}
