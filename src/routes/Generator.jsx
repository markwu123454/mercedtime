import React, { useEffect, useMemo, useState } from 'react';
import { applySchedule } from '../lib/store.js';
import { courseKey } from '../lib/sections.js';
import { DEFAULT_FILTERS, generateSchedules } from '../lib/generate.js';
import { buildBlocks, range, scheduleSvg, shortType, DAYS } from '../lib/schedule.js';
import { sectionsForRows } from '../lib/registrations.js';
import { ScheduleSvg, minsToInput, inputToMins } from './shared.jsx';

const PAGE = 24;
const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);

// Every schedule that fits the planned courses without a clash, ranked, for the user
// to pick one. Picking writes the schedule's CRNs into the plan.
export default function Generator({ term, items, taken, sections, settings }) {
    const [f, setF] = useState({ ...DEFAULT_FILTERS, gap: 15 });
    const [keepPicked, setKeepPicked] = useState(false);
    const [shown, setShown] = useState(PAGE);
    const patch = (p) => setF((cur) => ({ ...cur, ...p }));

    const fixed = useMemo(() => sectionsForRows(taken, sections), [taken, sections]);
    const { courses, skipped } = useMemo(() => {
        const registered = new Set(taken.map((r) => r.key));
        const courses = [];
        const skipped = [];
        for (const i of items) {
            if (registered.has(i.key)) continue;            // already taken: it is a fixed block
            const secs = sections.filter((s) => courseKey(s) === i.key);
            const label = `${i.subject} ${i.number}`;
            if (!secs.length) { skipped.push(label); continue; }
            courses.push({ key: i.key, label, sections: secs, require: keepPicked ? i.crns : [] });
        }
        return { courses, skipped };
    }, [items, taken, sections, keepPicked]);

    const out = useMemo(
        () => (courses.length ? generateSchedules({ courses, fixed, filters: f }) : null),
        [courses, fixed, f]);
    useEffect(() => setShown(PAGE), [out]);

    const cards = useMemo(() => (out?.results || []).slice(0, shown).map((r) => {
        const blocks = [
            ...buildBlocks(fixed, 'registered', settings.buildingScheme).blocks,
            ...buildBlocks(r.sections, 'planned', settings.buildingScheme).blocks,
        ];
        return { ...r, svg: scheduleSvg(blocks, { ...settings, showFree: false }) };
    }), [out, shown, fixed, settings]);

    return (
        <section className="generator">
            <h2 className="section-title">Find a schedule</h2>
            <div className="gen-controls">
                <label className="gen-field">Sort by
                    <select className="field select-field" value={f.sort} onChange={(e) => patch({ sort: e.target.value })}>
                        <option value="gaps">Least time between classes</option>
                        <option value="days">Fewest days on campus</option>
                        <option value="late">Latest start</option>
                        <option value="early">Earliest finish</option>
                    </select>
                </label>
                <label className="gen-field">No class before
                    <input className="field" type="time" value={minsToInput(f.earliest)}
                           onChange={(e) => patch({ earliest: e.target.value ? inputToMins(e.target.value) : 0 })} />
                </label>
                <label className="gen-field">No class after
                    <input className="field" type="time" value={minsToInput(Math.min(f.latest, 23 * 60 + 59))}
                           onChange={(e) => patch({ latest: e.target.value ? inputToMins(e.target.value) : 24 * 60 })} />
                </label>
                <label className="gen-field">Min gap between classes (min)
                    <input className="field" type="number" min="0" max="120" step="5" value={f.gap}
                           onChange={(e) => patch({ gap: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
                </label>
                <div className="gen-field">Days off
                    <div className="gen-days">
                        {DAYS.slice(0, 5).map(([, label], d) => (
                            <label key={d} className="checkbox">
                                <input type="checkbox" checked={f.daysOff.includes(d)}
                                       onChange={(e) => patch({ daysOff: e.target.checked ? [...f.daysOff, d] : f.daysOff.filter((x) => x !== d) })} />
                                {label}
                            </label>
                        ))}
                    </div>
                </div>
                <label className="checkbox">
                    <input type="checkbox" checked={f.openOnly} onChange={(e) => patch({ openOnly: e.target.checked })} />
                    Open seats only
                </label>
                <label className="checkbox">
                    <input type="checkbox" checked={keepPicked} onChange={(e) => setKeepPicked(e.target.checked)} />
                    Keep sections I already picked
                </label>
            </div>

            {skipped.length > 0 && (
                <p className="placeholder pad">Not included, no published sections: {skipped.join(', ')}.</p>
            )}
            {!courses.length && <p className="placeholder pad">Plan at least one course that has published sections to search for schedules.</p>}
            {out?.blocked.length > 0 && (
                <div className="status status-error">No section of {out.blocked.join(', ')} fits these filters, so no schedule is possible.</div>
            )}
            {out && !out.blocked.length && (
                <p className="placeholder pad">
                    {out.total === 0
                        ? 'No schedule fits without a clash. Relax a filter or drop a course.'
                        : `${out.total} schedule${out.total === 1 ? '' : 's'}${out.truncated ? ' (the search stopped early; narrow the filters to see them all)' : ''}`}
                </p>
            )}

            <div className="gen-grid">
                {cards.map((r, i) => (
                    <div key={i} className="gen-card">
                        <ScheduleSvg svg={r.svg} />
                        <div className="gen-meta">
                            {r.days} day{r.days === 1 ? '' : 's'} · {r.gaps ? `${hm(r.gaps)} between classes` : 'no gaps'} · {range(r.earliest, r.latest)}
                            {r.alternatives > 0 && ` · ${r.alternatives} equivalent`}
                        </div>
                        <div className="gen-crns">
                            {r.sections.map((s) => (
                                <span key={s.courseReferenceNumber} className="chip">
                                    {s.subject} {s.courseNumber} {shortType(s.scheduleTypeDescription)} {s.courseReferenceNumber}
                                </span>
                            ))}
                        </div>
                        <button className="button-primary" onClick={() => applySchedule(term, r.sections)}>Use this schedule</button>
                    </div>
                ))}
            </div>
            {out && out.results.length > shown && (
                <div className="pad"><button className="button-ghost" onClick={() => setShown(shown + PAGE)}>Show more</button></div>
            )}
        </section>
    );
}
