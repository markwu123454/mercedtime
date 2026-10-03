// Degree-audit logic that needs no DOM or network: ids, course keys, and what a plan would do
// to the requirements an audit lists.
//
// The audit (see audit.js) says which requirements are met and, for each unmet one, which
// courses could meet it. The plan says which courses the student intends to take. Matching
// the two is the "what would this plan finish?" answer, done here locally; nothing is sent
// back to uAchieve.

/** uAchieve's course number ("010H", "10") as Banner writes it: three digits and any letters. */
export function normalizeNumber(n) {
    const m = String(n ?? '').trim().toUpperCase().match(/^0*(\d+)([A-Z]*)$/);
    return m ? m[1].padStart(3, '0') + m[2] : String(n ?? '').trim().toUpperCase();
}

/** "SPRK" + "010H" -> "SPRK010H", the key a planned course has. */
export const courseKeyOf = (department, number) =>
    `${String(department ?? '').trim().toUpperCase()}${normalizeNumber(number)}`;

// How a requirement's instruction starts. An audit heading is a title and an instruction in one
// element ("Introductory Physics I" + "Complete the following courses:"), and the two can arrive
// with nothing between them.
const INSTRUCTION = /(Complete|All courses|All of the following|Choose|Select|Earn|A minimum of|At least)(?=[\s\w])/;

/** "Mathematics RequirementComplete five courses from the following list:" ->
 *  { title: 'Mathematics Requirement', description: 'Complete five courses from the following list:' }.
 *  Text with no instruction in it is all title. */
export function splitHeading(text) {
    const t = String(text ?? '').replace(/\s+/g, ' ').trim();
    const m = INSTRUCTION.exec(t);
    if (m && m.index > 0) return { title: t.slice(0, m.index).trim(), description: t.slice(m.index).trim() };
    return { title: t, description: '' };
}

/** "ENGR 057" or "SPRK 010H" as a course key, or null for text that is not a course. */
export function keyFromCourseText(text) {
    const m = String(text ?? '').trim().match(/^([A-Za-z]{2,5})\s*(\d+[A-Za-z]*)$/);
    return m ? courseKeyOf(m[1], m[2]) : null;
}

/** The audit id inside a read.html link: ".../read.html?id=JobQueueRun!!!!<base64>" where the
 *  base64 is "!!!!intSeqNo=40392277". Returns { param, seq } (seq null if it will not decode). */
export function auditIdFromHref(href) {
    const param = decodeURIComponent((String(href).match(/[?&]id=([^&#]+)/) || [])[1] || '');
    let seq = null;
    try {
        const b64 = param.split('!!!!')[1];
        const m = b64 && atob(b64).match(/intSeqNo=(\d+)/);
        seq = m ? Number(m[1]) : null;
    } catch { /* an id this does not understand is still a usable link */ }
    return { param, seq };
}

/** The planned courses across every semester, as [{ key, subject, number, term }]. */
export function plannedCourses(planAll) {
    return Object.entries(planAll).flatMap(([term, items]) =>
        Object.values(items || {}).map((i) => ({ key: i.key, subject: i.subject, number: i.number, term })));
}

// OK is met; IP is met once the in-progress courses finish. Neither needs another course.
const needsCourse = (status) => status !== 'OK' && status !== 'IP';

/** The things in an audit that still need a course: each unmet sub-requirement, and each
 *  unmet requirement that has no sub-requirements of its own. */
export function unmetNodes(audit) {
    const out = [];
    audit.requirements.forEach((req, ri) => {
        if (req.subs.length) {
            req.subs.forEach((sub, si) => { if (needsCourse(sub.status)) out.push({ id: `${ri}.${si}`, ri, si, node: sub }); });
        } else if (needsCourse(req.status)) {
            out.push({ id: `${ri}`, ri, si: null, node: req });
        }
    });
    return out;
}

/** What a set of planned courses would do to the audit.
 *
 *  Each planned course can meet one requirement. The requirements with the fewest options go
 *  first so a course that fits only one place is not spent on a roomier one.
 *
 *  Returns { assigned: { [nodeId]: plannedCourse }, spare: [plannedCourse], open: [nodeId],
 *  completes: { [requirementIndex]: bool } }. `spare` are planned courses that meet nothing
 *  the audit lists (free electives, or courses not in any option list). */
export function simulatePlan(audit, planned) {
    const nodes = unmetNodes(audit)
        .map((n) => ({ ...n, keys: new Set(n.node.options.map((o) => courseKeyOf(o.department, o.number))) }))
        .sort((a, b) => a.keys.size - b.keys.size);
    const free = [...new Map(planned.map((p) => [p.key, p])).values()];   // a course planned twice counts once
    const assigned = {};
    for (const n of nodes) {
        const hit = free.findIndex((p) => n.keys.has(p.key));
        if (hit >= 0) assigned[n.id] = free.splice(hit, 1)[0];
    }
    const all = unmetNodes(audit);
    const open = all.filter((n) => !assigned[n.id]).map((n) => n.id);
    const completes = {};
    audit.requirements.forEach((req, ri) => {
        const mine = all.filter((n) => n.ri === ri);
        completes[ri] = !needsCourse(req.status) || (mine.length > 0 && mine.every((n) => assigned[n.id]));
    });
    return { assigned, spare: free, open, completes };
}
