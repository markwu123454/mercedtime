// Every non-conflicting way to take a set of courses, as a pure function.
//
// A course is taken as one bundle: its anchor section plus one section from each group
// of linked sections (the lab, the discussion). Banner's own rule, which sections.js
// already relies on: you register the anchor and a linked section, not all of them.
// The search is a depth-first walk over courses, abandoning a branch the moment a
// section clashes with something already placed.

import { buildAnchors, classMeetings, courseKey, primaryFaculty, tierOf } from './sections.js';
import { DAYS, toMin } from './schedule.js';

const letterOf = (s) => (String(s.linkIdentifier || '').match(/^([A-Za-z]+)/) || [])[1] || '';

/** All ways to take one course: each anchor with one linked section per letter group. */
export function courseChoices(sections) {
    const out = [];
    for (const b of buildAnchors(sections)) {
        const groups = new Map();
        for (const c of b.children) {
            const k = letterOf(c);
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k).push(c);
        }
        let combos = [[b.anchor]];
        for (const g of groups.values()) combos = combos.flatMap((base) => g.map((c) => [...base, c]));
        out.push(...combos);
    }
    return out;
}

/** Timed weekly meetings. A section with none (TBA, online) cannot clash with anything.
 *  `soft(section)` marks a meeting the student might skip (a lecture). */
export const meetingsOf = (sections, soft = () => false) => sections.flatMap((s) =>
    classMeetings(s).filter((m) => m.beginTime && m.endTime).flatMap((m) =>
        DAYS.flatMap(([key], day) => (m[key]
            ? [{ day, start: toMin(m.beginTime), end: toMin(m.endTime), soft: !!soft(s) }]
            : []))));

const clash = (a, b, gap) => a.day === b.day && a.start < b.end + gap && b.start < a.end + gap;

export const DEFAULT_FILTERS = {
    sort: 'gaps',          // 'gaps' | 'days' | 'late' | 'early'
    earliest: 0,           // no class may start before this (minutes after midnight)
    latest: 24 * 60,       // no class may end after this
    daysOff: [],           // day indexes (0 = Mon) with no classes at all
    gap: 0,                // minimum minutes between two classes on the same day
    openOnly: false,       // skip full sections
    // Skippable lectures (see isSoft): when on, they stop counting as days on campus,
    // as gaps, and against the start/end/days-off filters. allowSoftClash additionally
    // lets one overlap another class, on the assumption that you would skip it.
    skipLectures: false,
    allowSoftClash: false,
};

function metrics(all, skip) {
    // Meetings that count: with skipLectures a skippable lecture does not.
    const meetings = skip ? all.filter((m) => !m.soft) : all;
    const days = new Map();
    for (const m of meetings) {
        if (!days.has(m.day)) days.set(m.day, []);
        days.get(m.day).push(m);
    }
    let gaps = 0;
    for (const list of days.values()) {
        list.sort((a, b) => a.start - b.start);
        for (let i = 1; i < list.length; i++) gaps += Math.max(0, list[i].start - list[i - 1].end);
    }
    const lectureOnlyDays = skip
        ? new Set(all.filter((m) => m.soft && !days.has(m.day)).map((m) => m.day)).size
        : 0;
    return {
        days: days.size,
        lectureOnlyDays,
        skippable: skip ? all.filter((m) => m.soft).length : 0,
        gaps,
        earliest: meetings.length ? Math.min(...meetings.map((m) => m.start)) : 0,
        latest: meetings.length ? Math.max(...meetings.map((m) => m.end)) : 0,
    };
}

const SORTS = {
    gaps: (a, b) => a.gaps - b.gaps || a.days - b.days || b.earliest - a.earliest,
    days: (a, b) => a.days - b.days || a.gaps - b.gaps || b.earliest - a.earliest,
    late: (a, b) => b.earliest - a.earliest || a.gaps - b.gaps || a.days - b.days,
    early: (a, b) => a.latest - b.latest || a.gaps - b.gaps || a.days - b.days,
};

/** Search for schedules.
 *
 *  courses: [{ key, label, sections, require?: [crn] }]  sections of the term for that
 *           course; `require` limits it to bundles containing those CRNs.
 *  fixed:   sections already taken (registered). They block time and appear in no choice.
 *  isSoft:  (section) => bool, which lectures count as skippable when filters.skipLectures.
 *
 *  Returns { results, total, truncated, blocked }. `blocked` lists courses with no
 *  section that fits the filters on its own, which makes any schedule impossible.
 *  Schedules identical in time and instructor are collapsed into one with a count of
 *  `alternatives`; `truncated` means a cap stopped the search before it finished. */
export function generateSchedules({ courses, fixed = [], filters = {}, isSoft = () => false, keep = 300, cap = 20000, maxNodes = 400000 }) {
    const f = { ...DEFAULT_FILTERS, ...filters };
    const off = new Set(f.daysOff);
    const soft = f.skipLectures ? isSoft : () => false;
    // A skippable lecture is exempt from the time-of-day and days-off filters.
    const counts = (m) => !(f.skipLectures && m.soft);
    const clashes = (a, b, gap) => clash(a, b, gap) && !(f.allowSoftClash && f.skipLectures && (a.soft || b.soft));

    const fits = (sections, meetings) =>
        meetings.every((m) => !counts(m) || (m.start >= f.earliest && m.end <= f.latest && !off.has(m.day)))
        && (!f.openOnly || sections.every((s) => tierOf(s) !== 'full'))
        // a lecture that overlaps its own lab is not a real option
        && !meetings.some((a, i) => meetings.slice(i + 1).some((b) => clashes(a, b, 0)));

    const options = courses.map((c) => ({
        ...c,
        choices: courseChoices(c.sections)
            .filter((sections) => !c.require?.length || c.require.every((crn) => sections.some((s) => s.courseReferenceNumber === crn)))
            .map((sections) => ({ sections, meetings: meetingsOf(sections, soft) }))
            .filter((ch) => fits(ch.sections, ch.meetings)),
    }));

    const blocked = options.filter((o) => !o.choices.length).map((o) => o.label || o.key);
    if (blocked.length) return { results: [], total: 0, truncated: false, blocked };

    options.sort((a, b) => a.choices.length - b.choices.length);   // fewest options first: prune early
    const fixedMeetings = meetingsOf(fixed, soft);
    const placed = [...fixedMeetings];
    const picks = [];
    const seen = new Map();
    let nodes = 0;
    let truncated = false;

    const signature = () => picks.flatMap((ch, i) => ch.sections.map((s) =>
        `${options[i].key}|${primaryFaculty(s)}|${meetingsOf([s]).map((m) => `${m.day}:${m.start}-${m.end}`).sort().join(',')}`)).sort().join(';');

    const walk = (i) => {
        if (truncated) return;
        if (++nodes > maxNodes) { truncated = true; return; }
        if (i === options.length) {
            const sig = signature();
            const hit = seen.get(sig);
            if (hit) { hit.alternatives++; return; }
            if (seen.size >= cap) { truncated = true; return; }
            seen.set(sig, {
                sections: picks.flatMap((ch) => ch.sections),
                alternatives: 0,
                ...metrics(placed, f.skipLectures),
            });
            return;
        }
        for (const ch of options[i].choices) {
            if (ch.meetings.some((m) => placed.some((p) => clashes(m, p, f.gap)))) continue;
            placed.push(...ch.meetings);
            picks.push(ch);
            walk(i + 1);
            picks.pop();
            placed.length -= ch.meetings.length;
            if (truncated) return;
        }
    };
    walk(0);

    const all = [...seen.values()];
    all.sort(SORTS[f.sort] || SORTS.gaps);
    return { results: all.slice(0, keep), total: all.length, truncated, blocked: [] };
}

/** Group sections by course, for applying a chosen schedule back to the plan. */
export const byCourse = (sections) => {
    const m = new Map();
    for (const s of sections) {
        const k = courseKey(s);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(s);
    }
    return m;
};
