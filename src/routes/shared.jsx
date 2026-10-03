import React, { useEffect, useState } from 'react';
import { selectTerm } from '../lib/store.js';

export const termName = (terms, code) => terms.find((t) => t.code === code)?.description || code || '';

export function TermSelect({ terms, term }) {
    return (
        <select className="field select-field" value={term || ''}
                onChange={(e) => selectTerm(e.target.value)} aria-label="Term">
            {terms.map((t) => <option key={t.code} value={t.code}>{t.description}</option>)}
        </select>
    );
}

/** The schedule SVG. The string comes from scheduleSvg(), which escapes everything it
 *  takes from Banner. */
export const ScheduleSvg = ({ svg }) =>
    <div className="schedule-svg" dangerouslySetInnerHTML={{ __html: svg }} />;

/** Re-renders every `ms` with the current time. */
export function useNow(ms = 1000) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), ms);
        return () => clearInterval(id);
    }, [ms]);
    return now;
}

export function downloadText(text, filename, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export const minsToInput = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const inputToMins = (v) => { const [h, m] = v.split(':').map(Number); return h * 60 + (m || 0); };
