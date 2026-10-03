// Everything we know about the shape of a Banner section, as pure functions.
//
// Framework-free on purpose: this is the part that took real work to get right and
// the part worth testing against fixtures/sections-202630.json without a browser.
//
// Design rule: trust Banner's own data shape instead of re-deriving it. In particular
// a linked section's `linkIdentifier` is `<letter><number>` — the letter is Banner's
// component-slot marker (A = the credit-bearing section you register under, anything
// else is a linked secondary), the number is the bundle. Use the letter directly
// rather than guessing the anchor from credit hours.

const DAYKEYS = [
    ['monday', 'M'], ['tuesday', 'T'], ['wednesday', 'W'],
    ['thursday', 'R'], ['friday', 'F'], ['saturday', 'S'], ['sunday', 'U'],
];

export const fmtTime = (t) => {
    if (!t) return '';
    const s = String(t).padStart(4, '0');
    let h = parseInt(s.slice(0, 2), 10);
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${s.slice(2)} ${ap}`;
};

export const meetings = (sec) => (sec.meetingsFaculty || []).map((mf) => mf.meetingTime).filter(Boolean);
export const fmtDays = (mt) => DAYKEYS.filter(([k]) => mt[k]).map(([, l]) => l).join('');

// Banner appends the final exam as an extra "meeting"; keep it out of the weekly
// days/time and surface it separately.
export const isExam = (mt) => mt.meetingType === 'EXAM' || mt.meetingScheduleType === 'EXM';
export const classMeetings = (sec) => meetings(sec).filter((mt) => !isExam(mt));
export const examMeetings = (sec) => meetings(sec).filter(isExam);

export const fmtMeeting = (mt) =>
    `${fmtDays(mt) || '—'} ${mt.beginTime ? fmtTime(mt.beginTime) + '–' + fmtTime(mt.endTime) : ''}`.trim();
export const fmtLoc = (mt) => [mt.buildingDescription || mt.building, mt.room].filter(Boolean).join(' ');

export const primaryFaculty = (sec) => {
    const f = (sec.faculty || []).find((x) => x.primaryIndicator) || (sec.faculty || [])[0];
    return f ? f.displayName : '';
};

export const credits = (sec) => sec.creditHours ?? sec.creditHourLow ?? sec.creditHourHigh ?? '';
export const creditNum = (sec) => Number(credits(sec)) || 0;   // creditHours is often null on labs
export const bySeq = (a, b) =>
    String(a.sequenceNumber).localeCompare(String(b.sequenceNumber), undefined, { numeric: true });

// --- seats: account for cross-listing rather than trusting seatsAvailable -------
// A cross-listed section shares a capacity pool with others, so seatsAvailable can
// read 0 while the shared pool still has room. Use whichever number is actually
// larger, and carry a note — never silently swap one real number for another.

export function seatInfo(sec) {
    const direct = sec.seatsAvailable ?? 0;
    const crossListed = !!sec.crossList && sec.crossListAvailable != null && sec.crossListAvailable > direct;
    const avail = crossListed ? sec.crossListAvailable : direct;
    const max = crossListed ? (sec.crossListCapacity ?? sec.maximumEnrollment ?? 0) : (sec.maximumEnrollment ?? 0);
    return { avail, max, direct, crossListed };
}

export const seatsFree = (sec) => Math.max(0, seatInfo(sec).avail);
export const isOpen = (sec) => sec.openSection === true || seatInfo(sec).avail > 0;

export const tierOf = (sec) => {
    const { avail, max } = seatInfo(sec);
    if (avail <= 0) return 'full';
    if (avail < 5 || (max > 0 && avail < max * 0.10)) return 'low';
    return 'open';
};
export const TIER_RANK = { full: 0, low: 1, open: 2 };

export function seatsLabel(sec) {
    const { avail, max, direct, crossListed } = seatInfo(sec);
    return {
        primary: `${Math.max(0, avail)}/${max || '?'}`,
        note: crossListed
            ? `cross-listed — direct section shows ${Math.max(0, direct)}/${sec.maximumEnrollment ?? '?'}`
            : null,
    };
}

// Banner's waitCount/waitAvailable read backwards at a glance ("WL 0" could mean
// nobody waiting or waitlist full, depending which field you looked at). Say it plainly.
export function waitlistStatus(sec) {
    const cap = sec.waitCapacity ?? 0;
    if (!cap) return null;
    const avail = sec.waitAvailable ?? 0;
    const count = sec.waitCount ?? 0;
    return avail > 0
        ? { full: false, short: `WL open ×${avail}`, long: `Waitlist open · ${avail} spot${avail === 1 ? '' : 's'}` }
        : { full: true, short: 'WL full', long: `Waitlist full · ${count}/${cap}` };
}

// instructionalMethodDescription is null on ~90% of sections. Rather than default that
// to "In Person" as fact, infer from whether any meeting has a room, and mark the
// result inferred so it never looks identical to reported data.
export function modality(sec) {
    if (sec.instructionalMethodDescription) return { text: sec.instructionalMethodDescription, inferred: false };
    const cm = classMeetings(sec);
    if (!cm.length) return { text: 'Not specified', inferred: true };
    return { text: cm.some((mt) => mt.building || mt.room) ? 'In Person' : 'Online / unspecified', inferred: true };
}

// --- linked-section bundles ----------------------------------------------------

const linkParts = (s) => {
    if (!s.linkIdentifier) return null;
    const m = String(s.linkIdentifier).match(/^([A-Za-z]+)(\d+)$/);
    return m ? { letter: m[1], num: m[2] } : null;
};

/** Split a course into bundles by linkIdentifier number, each anchored by its 'A'
 *  member with everything else nested under it. Unlinked sections stand alone.
 *  Multiple lecture bundles under one course (A1/B1, A2/B2, …) are independent
 *  schedule choices — kept separate, never merged. */
export function buildAnchors(sections) {
    const byNum = new Map();
    const bundles = [];
    for (const s of sections) {
        const lp = linkParts(s);
        if (!lp) { bundles.push({ anchor: s, children: [] }); continue; }
        let b = byNum.get(lp.num);
        if (!b) { byNum.set(lp.num, (b = { members: [] })); bundles.push(b); }
        b.members.push({ s, letter: lp.letter });
    }
    for (const b of bundles) {
        if (!b.members) continue;   // unlinked singleton, already {anchor, children}
        const as = b.members.filter((m) => m.letter === 'A').map((m) => m.s).sort(bySeq);
        const rest = b.members.filter((m) => m.letter !== 'A').map((m) => m.s);
        // Banner's convention is exactly one 'A' per bundle. If that ever isn't true,
        // don't guess further — take the lowest-sequence 'A' and fold the extras in
        // with the linked secondaries.
        b.anchor = as[0] || b.members.map((m) => m.s).sort(bySeq)[0];
        b.children = [...as.slice(1), ...rest].sort(bySeq);
        delete b.members;
    }
    bundles.sort((a, b) => bySeq(a.anchor, b.anchor));
    return bundles;
}

/** A bundle is only enrollable if its anchor has room AND, when it has linked
 *  secondaries, at least one of those has room too — you register the anchor plus
 *  any one linked section, not all of them. */
export function bundleTier(b) {
    const anchor = tierOf(b.anchor);
    if (anchor === 'full') return 'full';
    if (!b.children.length) return anchor;
    const best = b.children.reduce(
        (acc, c) => (TIER_RANK[tierOf(c)] > TIER_RANK[acc] ? tierOf(c) : acc), 'full');
    return TIER_RANK[best] < TIER_RANK[anchor] ? best : anchor;
}

export function bundleSeatsOpen(b) {
    if (tierOf(b.anchor) === 'full') return 0;
    if (b.children.length && !b.children.some((c) => seatsFree(c) > 0)) return 0;
    return seatsFree(b.anchor);
}

// --- grouping ------------------------------------------------------------------

export const courseKey = (s) => s.subjectCourse || `${s.subject}${s.courseNumber}`;

const SORTS = {
    code: (a, b) => `${a.subject} ${a.number}`.localeCompare(`${b.subject} ${b.number}`, undefined, { numeric: true }),
    title: (a, b) => (a.title || '').localeCompare(b.title || ''),
    units: (a, b) => b.units - a.units,
    open: (a, b) => b.seatsOpen - a.seatsOpen,
};

/** Group sections into courses. `rankOf` maps a section to its search relevance;
 *  when a query is active relevance leads and `sort` only breaks ties. */
export function groupCourses(sections, { sort = 'code', rankOf = null } = {}) {
    const map = new Map();
    for (const s of sections) {
        const key = courseKey(s);
        let g = map.get(key);
        if (!g) map.set(key, (g = { key, subject: s.subject, number: s.courseNumber, title: s.courseTitle, sections: [] }));
        g.sections.push(s);
    }
    const groups = [...map.values()];
    for (const g of groups) {
        g.units = Math.max(0, ...g.sections.map(creditNum));
        g.anchors = buildAnchors(g.sections);
        // Best tier/seats among the lecture options — you only need one to work — but
        // each option's own tier already accounts for its required linked secondaries.
        g.tier = g.anchors.reduce(
            (best, b) => (TIER_RANK[bundleTier(b)] > TIER_RANK[best] ? bundleTier(b) : best), 'full');
        g.seatsOpen = g.anchors.reduce((sum, b) => sum + bundleSeatsOpen(b), 0);
        g.rank = rankOf ? Math.min(RANK_MISS, ...g.sections.map((s) => rankOf(s) ?? RANK_MISS)) : 0;
    }
    const cmp = SORTS[sort] || (() => 0);
    groups.sort((a, b) => (a.rank - b.rank) || cmp(a, b));
    return groups;
}

// --- fuzzy search ---------------------------------------------------------------
// Query and haystack are both lower-cased with *all* whitespace removed, so "ae 172",
// "AE172" and " Ae 17 2 " are the same search — Banner writes the course id both ways
// and nobody wants to guess which.

export const squash = (v) => String(v ?? '').toLowerCase().replace(/\s+/g, '');

// Fields most- to least-relevant; a field's index becomes the section's rank. Kept as
// separate strings rather than one joined blob so a query cannot match across a field
// boundary (e.g. "lecturesmith" spanning type into instructor).
const searchFields = (s) => [
    [courseKey(s)],                 // course id — "AE172"
    [s.courseReferenceNumber],      // CRN
    [s.courseTitle],
    [s.scheduleTypeDescription, primaryFaculty(s), ...classMeetings(s).map(fmtLoc)],
];

export const RANK_MISS = 99;   // finite, so `a.rank - b.rank` never goes NaN
const PASS2 = 4;               // rank offset: whole-query hits are 0..3, per-word 4..7

/** Two passes. First the squashed query as one string, whose field tier becomes the
 *  rank. If that misses, split on whitespace and require *every* word to land
 *  somewhere on its own — that is what makes word order irrelevant, so "structures
 *  aerospace" still finds "Aerospace Structures and Materials". A section is only as
 *  relevant as its weakest word, so a second-pass rank is the worst tier any word hit,
 *  and the whole pass sorts below every first-pass result. */
export function searchRank(sec, needle, words) {
    const tiers = searchFields(sec).map((t) => t.map(squash));
    const tierOfWord = (w) => {
        for (let i = 0; i < tiers.length; i++) if (tiers[i].some((f) => f.includes(w))) return i;
        return RANK_MISS;
    };
    const whole = tierOfWord(needle);
    if (whole !== RANK_MISS) return whole;
    // Pass 2 only means anything for real words. A one-character token matches nearly
    // every section, so "a e 1 7 1" would return the whole catalogue — and spaced-out
    // input like that is already pass 1's job, since it squashes to "ae171". Drop the
    // noise tokens; if fewer than two survive there is nothing left for pass 2 to do
    // that pass 1 has not already tried.
    const real = words.filter((w) => w.length >= 2);
    if (real.length < 2) return RANK_MISS;
    let worst = 0;
    for (const w of real) {
        const t = tierOfWord(w);
        if (t === RANK_MISS) return RANK_MISS;   // every word has to match something
        worst = Math.max(worst, t);
    }
    return PASS2 + worst;
}

export const parseQuery = (raw) => ({
    needle: squash(raw),
    words: raw.trim().split(/\s+/).map(squash).filter(Boolean),
});

// --- typed course ids ------------------------------------------------------------

/** "me 1", "ME001", "Me 001" -> { key: 'ME001', subject: 'ME', number: '001' }, or null.
 *  Course numbers are three digits in Banner, so short ones are padded. */
export function parseCourseInput(raw) {
    const m = String(raw).trim().match(/^([A-Za-z]{2,5})\s*(\d{1,3})([A-Za-z]{0,2})$/);
    if (!m) return null;
    const subject = m[1].toUpperCase();
    const number = m[2].padStart(3, '0') + m[3].toUpperCase();
    return { key: subject + number, subject, number };
}
