import React, { useEffect } from 'react';
import { useStore, selectTerm, loadRegistered } from '../lib/store.js';
import { courseKey } from '../lib/sections.js';
import { termName } from './shared.jsx';
import PlanItem from './PlanItem.jsx';
import Generator from './Generator.jsx';

// The page behind "Pick a schedule": choose sections by hand or let the generator find
// clash-free combinations. Either way the chosen CRNs land in that semester's plan.
export default function PlanSchedule({ term: T }) {
    const { terms, term, sectionsByTerm, loading, loadingText, error, planAll, registered, settings } = useStore((s) => s);

    const listed = terms.some((t) => String(t.code) === String(T));
    useEffect(() => {
        if (!T) return;
        // Loads that term's classes and makes it the toolbar term. A semester Banner does
        // not list has no classes to load.
        if (term !== T && listed) selectTerm(T);
        loadRegistered(T);
    }, [T]);

    const catalog = sectionsByTerm[T];
    // A term whose classes are not published answers with nothing, which is not cached.
    const unpublished = !catalog && (!listed || (term === T && !loading && error === 'No classes found for this term.'));
    const sections = catalog || [];
    const items = Object.values(planAll[T] || {}).sort((a, b) => a.key.localeCompare(b.key));
    const taken = (registered[T]?.rows || []).filter((r) => !r.dropped);

    return (
        <>
            <div className="toolbar">
                <a className="button-ghost" href="#/plan">&larr; All semesters</a>
                <h2 className="toolbar-title">Pick a schedule &middot; {termName(terms, T)}</h2>
                <span className="count">
                    {loading && !catalog ? <span className="loading"><span className="spinner" />{loadingText}</span> : ''}
                </span>
            </div>
            <div className="page-scroll">
                {!items.length && <p className="placeholder pad">No courses planned for this semester. Add some on the <a href="#/plan">Plan</a> page.</p>}
                {!catalog && !unpublished && items.length > 0 && <p className="placeholder pad">Loading this semester&rsquo;s classes…</p>}
                {unpublished && <p className="placeholder pad">This semester has no published classes yet.</p>}

                {items.length > 0 && (catalog || unpublished) && (
                    <>
                        <h2 className="section-title">Courses</h2>
                        {items.map((item) => (
                            <PlanItem key={item.key} item={item} term={T} settings={settings}
                                      sections={sections.filter((s) => courseKey(s) === item.key)} loading={false} />
                        ))}
                        <Generator term={T} items={items} taken={taken} sections={sections} settings={settings} />
                    </>
                )}
            </div>
        </>
    );
}
