import React, { useEffect, useMemo } from 'react';
import { useStore, loadRegistered, updateSettings } from '../lib/store.js';
import { buildBlocks, isSoft, scheduleSvg } from '../lib/schedule.js';
import { BUILDING_SCHEMES } from '../lib/buildings.js';
import { sectionsForRows } from '../lib/registrations.js';
import { ScheduleSvg, TermSelect, downloadText, termName, minsToInput, inputToMins } from './shared.jsx';

export default function Schedule() {
    const { terms, term, sections, loading, loadingText, planAll, registered, settings } = useStore((s) => s);
    useEffect(() => { if (term) loadRegistered(term); }, [term]);

    const { svg, unplaced, unchosen, missing } = useMemo(() => {
        const rows = (registered[term]?.rows || []);
        const regSecs = sectionsForRows(rows, sections);
        const regCrns = new Set(regSecs.map((s) => s.courseReferenceNumber));

        const items = Object.values(planAll[term] || {});
        const wanted = new Set(items.flatMap((i) => i.crns));
        const planSecs = settings.includePlanned
            ? sections.filter((s) => wanted.has(s.courseReferenceNumber) && !regCrns.has(s.courseReferenceNumber))
            : [];

        const soft = (s) => isSoft(s, settings);
        const reg = buildBlocks(regSecs, 'registered', settings.buildingScheme, soft);
        const plan = buildBlocks(planSecs, 'planned', settings.buildingScheme, soft);
        // A planned CRN the term's catalog does not contain (typically a future term
        // whose classes are not published yet) has nothing to draw.
        const known = new Set(sections.map((s) => s.courseReferenceNumber));
        const missing = settings.includePlanned
            ? items.flatMap((i) => i.crns.filter((c) => !known.has(c)).map((crn) => ({ crn, code: `${i.subject} ${i.number}` })))
            : [];
        return {
            missing,
            svg: scheduleSvg([...reg.blocks, ...plan.blocks], settings),
            unplaced: [...reg.unplaced, ...plan.unplaced],
            unchosen: settings.includePlanned ? items.filter((i) => !i.crns.length) : [],
        };
    }, [term, sections, registered, planAll, settings]);

    const set = (patch) => updateSettings(patch);
    const num = (key, min, max) => (e) => {
        const v = Math.max(min, Math.min(max, parseInt(e.target.value, 10) || 0));
        set({ [key]: v });
    };

    return (
        <>
            <div className="toolbar">
                <TermSelect terms={terms} term={term} />
                <button className="button-ghost" onClick={() => downloadText(svg, `schedule-${term}.svg`, 'image/svg+xml')}>Download SVG</button>
                <span className="count">{loading ? <span className="loading"><span className="spinner" />{loadingText}</span> : termName(terms, term)}</span>
            </div>
            <div className="panes">
                <div className="list-pane schedule-pane">
                    <ScheduleSvg svg={svg} />
                    {(unplaced.length > 0 || unchosen.length > 0 || missing.length > 0) && (
                        <div className="unplaced">
                            <div className="detail-label">Not on the grid</div>
                            {unplaced.map((u) => <div key={u.kind + u.crn}>{u.code} {u.type} (CRN {u.crn}): no meeting time</div>)}
                            {missing.map((m) => <div key={m.crn}>{m.code} (CRN {m.crn}): not in this term&rsquo;s catalog</div>)}
                            {unchosen.map((i) => <div key={i.key}>{i.subject} {i.number}: no section chosen</div>)}
                        </div>
                    )}
                </div>
                <aside className="detail-pane">
                    <h2 className="detail-title">Settings</h2>

                    <div className="detail-section">
                        <label className="detail-label" htmlFor="b-scheme">Building names</label>
                        <select id="b-scheme" className="field select-field" value={settings.buildingScheme}
                                onChange={(e) => set({ buildingScheme: e.target.value })}>
                            {BUILDING_SCHEMES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                        </select>
                    </div>

                    <div className="detail-section">
                        <label className="checkbox">
                            <input type="checkbox" checked={settings.includePlanned} onChange={(e) => set({ includePlanned: e.target.checked })} />
                            Show planned sections
                        </label>
                    </div>

                    <div className="detail-section">
                        <label className="checkbox" title="Lectures rarely take attendance. A skippable lecture is drawn dashed, and a day with only those is marked optional.">
                            <input type="checkbox" checked={settings.softLectures} onChange={(e) => set({ softLectures: e.target.checked })} />
                            Lectures are skippable
                        </label>
                    </div>

                    <div className="detail-section">
                        <label className="checkbox">
                            <input type="checkbox" checked={settings.showFree} onChange={(e) => set({ showFree: e.target.checked })} />
                            Show free times
                        </label>
                    </div>

                    <fieldset className="settings-group" disabled={!settings.showFree}>
                        <div className="detail-section">
                            <label className="checkbox">
                                <input type="checkbox" checked={settings.softAsFree} onChange={(e) => set({ softAsFree: e.target.checked })} />
                                Free time ignores skippable lectures
                            </label>
                        </div>
                        <div className="detail-section">
                            <div className="detail-label">Free from</div>
                            <input className="field" type="time" value={minsToInput(settings.freeStart)}
                                   onChange={(e) => e.target.value && set({ freeStart: inputToMins(e.target.value) })} aria-label="Free time starts" />
                            {' to '}
                            <input className="field" type="time" value={minsToInput(settings.freeEnd)}
                                   onChange={(e) => e.target.value && set({ freeEnd: inputToMins(e.target.value) })} aria-label="Free time ends" />
                        </div>
                        <div className="detail-section">
                            <label className="detail-label" htmlFor="pad-b">Padding before class (min)</label>
                            <input id="pad-b" className="field" type="number" min="0" max="120" step="5"
                                   value={settings.padBefore} onChange={num('padBefore', 0, 120)} />
                        </div>
                        <div className="detail-section">
                            <label className="detail-label" htmlFor="pad-a">Padding after class (min)</label>
                            <input id="pad-a" className="field" type="number" min="0" max="120" step="5"
                                   value={settings.padAfter} onChange={num('padAfter', 0, 120)} />
                        </div>
                        <div className="detail-section">
                            <label className="detail-label" htmlFor="min-free">Shortest gap to show (min)</label>
                            <input id="min-free" className="field" type="number" min="0" max="240" step="5"
                                   value={settings.minFree} onChange={num('minFree', 0, 240)} />
                        </div>
                    </fieldset>
                </aside>
            </div>
        </>
    );
}
