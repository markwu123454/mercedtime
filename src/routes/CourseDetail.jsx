import React, { useEffect, useMemo, useState } from 'react';
import { loadSections, addPlanCourse } from '../lib/store.js';
import { futureTerms } from '../lib/courses.js';
import * as api from '../lib/api.js';
import {
    buildAnchors, bySeq, classMeetings, courseKey, fmtMeeting, primaryFaculty, seatsLabel, tierOf,
} from '../lib/sections.js';
import { locationLabel } from '../lib/buildings.js';
import { termName } from './shared.jsx';

const STATE = {
    done: ['Done', 'done'],
    taking: ['Taking now', 'ip'],
    plan: ['In your plan', 'plan'],
    todo: ['Not taken or planned', 'todo'],
};

const Field = ({ label, children }) => (
    <div className="detail-section">
        <div className="detail-label">{label}</div>
        <div className="detail-body">{children}</div>
    </div>
);

/** The right-hand panel for a course picked on the Degree page, in the style of Find classes:
 *  what state it is in, which requirements it counts toward, where it has been offered, its
 *  sections in a downloaded semester, and Banner's own description, prerequisites and so on. */
export default function CourseDetail({ courseKeyStr, state, audit, history, planned, courseIndex, cacheMeta, sectionsByTerm, terms, nextTerm, scheme, now }) {
    const [pick, setPick] = useState(null);
    const [details, setDetails] = useState(null);
    const [detailError, setDetailError] = useState(null);
    useEffect(() => setPick(null), [courseKeyStr]);

    const [, subject = '', number = ''] = courseKeyStr.match(/^([A-Z]+)(\d.*)$/) || [];

    const offered = useMemo(
        () => Object.keys(courseIndex).filter((t) => courseIndex[t].some((c) => c[0] === courseKeyStr)).sort((a, b) => Number(b) - Number(a)),
        [courseIndex, courseKeyStr]);
    const downloaded = offered.filter((t) => cacheMeta[t]);
    const term = pick && downloaded.includes(pick) ? pick : (downloaded.includes(nextTerm) ? nextTerm : downloaded[0] || null);

    const title = useMemo(() => {
        const idx = offered.map((t) => courseIndex[t].find((c) => c[0] === courseKeyStr)).find((c) => c?.[3]);
        if (idx) return idx[3];
        const norm = (s) => s.replace(/\s+/g, '').toUpperCase();
        const h = (history || []).find((r) => norm(r.course) === courseKeyStr && r.title);
        if (h) return h.title;
        for (const req of audit?.requirements || []) {
            for (const node of [req, ...req.subs]) {
                const c = node.courses.find((x) => norm(x.course) === courseKeyStr && x.description);
                if (c) return c.description;
            }
        }
        return '';
    }, [offered, courseIndex, courseKeyStr, history, audit]);

    const countsToward = useMemo(() => {
        const norm = (s) => s.replace(/\s+/g, '').toUpperCase();
        const out = [];
        for (const req of audit?.requirements || []) {
            for (const [node, label] of [[req, req.title || req.name], ...req.subs.map((s) => [s, `${req.title || req.name} › ${s.title}`])]) {
                const applied = node.courses.some((c) => norm(c.course) === courseKeyStr);
                const option = node.options.some((o) => `${o.department}${o.number}`.replace(/\s+/g, '').toUpperCase().replace(/^([A-Z]+)0*(\d)/, '$1$2') === courseKeyStr.replace(/^([A-Z]+)0*(\d)/, '$1$2'));
                if (applied || option) out.push({ label, applied });
            }
        }
        return out;
    }, [audit, courseKeyStr]);

    useEffect(() => { if (term) loadSections(term).catch(() => {}); }, [term]);
    const sections = useMemo(
        () => (term ? (sectionsByTerm[term] || []).filter((s) => courseKey(s) === courseKeyStr).sort(bySeq) : []),
        [term, sectionsByTerm, courseKeyStr]);
    const anchor = useMemo(() => buildAnchors(sections)[0]?.anchor, [sections]);

    // Banner's own text for the course, from the first lecture section of the chosen semester.
    useEffect(() => {
        setDetails(null);
        setDetailError(null);
        if (!anchor || !term) return;
        let cancelled = false;
        api.getDetails(term, anchor.courseReferenceNumber)
            .then((d) => { if (!cancelled) setDetails(d); })
            .catch((e) => { if (!cancelled) setDetailError(e.message); });
        return () => { cancelled = true; };
    }, [anchor, term]);

    const [label, tone] = STATE[state] || STATE.todo;
    const plannedTerms = [...new Set(planned.filter((p) => p.key === courseKeyStr).map((p) => p.term))];

    return (
        <aside className="detail-pane">
            <h2 className="detail-title">{subject} {number}</h2>
            <div className="detail-sub">{title || 'Title not known yet'}</div>

            <div className="detail-section">
                <span className={`tag tag-req-${tone}`}>{label}</span>
                {plannedTerms.length > 0 && <span className="placeholder"> {plannedTerms.map((t) => termName(terms, t)).join(', ')}</span>}
            </div>

            <Field label="Counts toward">
                {countsToward.length
                    ? countsToward.map((c, i) => <p key={i}>{c.label}{c.applied ? ' (applied)' : ''}</p>)
                    : <span className="placeholder">Not listed in this audit.</span>}
            </Field>

            <Field label="Offered">
                {offered.length
                    ? offered.slice(0, 8).map((t) => termName(terms, t)).join(', ') + (offered.length > 8 ? ` and ${offered.length - 8} more` : '')
                    : <span className="placeholder">Not in any downloaded semester.</span>}
            </Field>

            {downloaded.length > 0 && (
                <Field label="Sections">
                    <select className="field select-field" value={term || ''} onChange={(e) => setPick(e.target.value)} aria-label="Semester">
                        {downloaded.map((t) => <option key={t} value={t}>{termName(terms, t)}</option>)}
                    </select>
                    {sections.length === 0 && <p className="placeholder">Loading sections…</p>}
                    {sections.map((s) => {
                        const seats = seatsLabel(s);
                        const tier = tierOf(s);
                        return (
                            <div key={s.courseReferenceNumber} className="section-line">
                                <div><span className="numeric">{s.courseReferenceNumber}</span> &middot; {s.sequenceNumber} {s.scheduleTypeDescription}</div>
                                <div className="placeholder">{classMeetings(s).map(fmtMeeting).join('; ') || '—'} &middot; {classMeetings(s).map((m) => locationLabel(m, scheme)).filter(Boolean).join('; ') || '—'}</div>
                                <div className="placeholder">{primaryFaculty(s) || 'Instructor not listed'} &middot; <span className={`tag tag-${tier}`}><span className={`dot dot-${tier}`} />{seats.primary}</span></div>
                            </div>
                        );
                    })}
                </Field>
            )}

            {detailError && <div className="status status-error">Could not load details: {detailError}</div>}
            {term && anchor && !details && !detailError && <p className="placeholder">Loading details…</p>}
            {details && Object.entries(details).map(([field, html]) => html && (
                <Field key={field} label={field.replace(/([A-Z])/g, ' $1')}>
                    {/* Banner's HTML fragments, as in Find classes: same-origin content rendered inside the shadow root. */}
                    <div dangerouslySetInnerHTML={{ __html: html }} />
                </Field>
            ))}

            <AddToTerm courseKeyStr={courseKeyStr} subject={subject} number={number} title={title} planned={planned} terms={terms} now={now} />
        </aside>
    );
}

/** Add this course to the plan of a semester in the next four years. A semester with something
 *  planned shows up on the Plan page by itself, so nothing else has to be set up. */
function AddToTerm({ courseKeyStr, subject, number, title, planned, terms, now }) {
    const [added, setAdded] = useState(null);
    useEffect(() => setAdded(null), [courseKeyStr]);
    const options = useMemo(() => futureTerms(now), [now]);
    const have = new Set(planned.filter((p) => p.key === courseKeyStr).map((p) => p.term));

    return (
        <Field label="Add to a future semester">
            <select className="field select-field" value="" aria-label="Add to a future semester"
                    onChange={(e) => {
                        const t = e.target.value;
                        if (!t) return;
                        addPlanCourse(t, { key: courseKeyStr, subject, number, title });
                        setAdded(t);
                    }}>
                <option value="">Choose a semester…</option>
                {options.map((t) => (
                    <option key={t} value={t} disabled={have.has(t)}>{termName(terms, t)}{have.has(t) ? ' (planned)' : ''}</option>
                ))}
            </select>
            {added && <p className="placeholder">Added to {termName(terms, added)}. <a href="#/plan">Open Plan</a></p>}
        </Field>
    );
}
