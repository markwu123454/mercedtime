// Which courses a semester is likely to offer, from the semesters already downloaded.
//
// A semester whose classes are not published yet has no catalog, but courses repeat by
// season: a summer term mostly offers what earlier summers did. So the options for a
// term are every course seen in a downloaded term of the same season.

import { courseKey } from './sections.js';

export const SEASONS = { 10: 'Spring', 20: 'Summer', 30: 'Fall' };
export const seasonOf = (term) => String(term).slice(4);
export const yearOf = (term) => String(term).slice(0, 4);

/** "Summer 2028" for a code Banner may not list yet. */
export const termLabel = (code) => `${SEASONS[seasonOf(code)] || 'Term'} ${yearOf(code)}`;

/** The code Banner would give a semester. */
export const makeTermCode = (season, year) => `${year}${season}`;

/** The distinct courses in a term's sections, as [key, subject, number, title]. */
export function courseList(rows) {
    const seen = new Map();
    for (const s of rows) {
        const key = courseKey(s);
        if (!seen.has(key)) seen.set(key, [key, s.subject, s.courseNumber, s.courseTitle || '']);
    }
    return [...seen.values()];
}

/** Course options for planning `term`.
 *
 *  index: { [term]: [[key, subject, number, title], ...] } for every downloaded term.
 *  A published term offers its own courses (source 'term'); otherwise the courses seen
 *  in earlier terms of the same season (source 'history'), each with the terms it
 *  appeared in. */
export function courseOptions(term, index) {
    const own = index[term];
    if (own?.length) {
        return { source: 'term', list: own.map(([key, subject, number, title]) => ({ key, subject, number, title, seen: [term] })) };
    }
    const season = seasonOf(term);
    const byKey = new Map();
    for (const t of Object.keys(index).sort()) {
        if (t === String(term) || seasonOf(t) !== season) continue;
        for (const [key, subject, number, title] of index[t]) {
            const cur = byKey.get(key) || { key, subject, number, title, seen: [] };
            cur.title = title || cur.title;      // the newest title wins
            cur.seen.push(t);
            byKey.set(key, cur);
        }
    }
    const list = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
    return { source: 'history', list };
}
