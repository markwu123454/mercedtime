// uAchieve degree audit: reading it from the student's own logged-in session.
//
// There is no JSON API; every audit page is server-rendered HTML, so this fetches the pages
// and reads them with DOMParser. It runs from the extension page, which has host permission
// for uachieve and sends the site's cookies with `credentials: 'include'`.
//
// Parsing is written against what was observed of the site (see the notes in README) and
// fails soft: anything not found comes back empty, never as a thrown error. Only a signed-out
// session throws, as AuditSessionError.

import { auditIdFromHref, dedupeRequirements, splitHeading } from './degree.js';

export const AUDIT_BASE = 'https://ucmerced.uachieve.com/selfservice';

/** Bumped whenever parseAudit's output changes. The audit read last is kept on disk and reused
 *  while uAchieve has nothing newer, so a copy parsed by an older parser has to be read again. */
export const PARSER_VERSION = 3;

export class AuditSessionError extends Error {
    constructor() { super('uAchieve session ended'); this.name = 'AuditSessionError'; }
}

// The text of a node with a space wherever one element ends and the next begins. textContent
// runs "<b>Physics I</b><span>Complete the following</span>" together as "Physics ICompl...", and
// splits no "MATH" from "021" when they are separate spans.
function clean(node) {
    if (!node) return '';
    let out = '';
    const walk = (n) => {
        if (n.nodeType === 3) out += n.nodeValue;
        else if (n.nodeType === 1) { out += ' '; n.childNodes.forEach(walk); out += ' '; }
    };
    walk(node);
    return out.replace(/\s+/g, ' ').trim();
}

/** A requirement's heading as { title, description }. The words that start an instruction find
 *  the split; failing that, a heading made of exactly two elements is title then description. */
function heading(el) {
    if (!el) return { title: '', description: '' };
    const byWords = splitHeading(clean(el));
    if (byWords.description) return byWords;
    const parts = [...el.children].map(clean).filter(Boolean);
    return parts.length === 2 ? { title: parts[0], description: parts[1] } : byWords;
}
const num = (n) => { const m = clean(n).match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
const parse = (html) => new DOMParser().parseFromString(html, 'text/html');

// --- network ----------------------------------------------------------------------

/** A page that is the sign-in or access-denied page rather than the one asked for. */
export const looksSignedOut = (url, status, html) =>
    status === 401 || status === 403
    || /accessdenied|\/login|saml|\/cas\//i.test(url)
    || /name=["']?(j_username|password)["']?|type=["']?password["']?/i.test(html);

async function get(url) {
    const res = await fetch(url, { credentials: 'include' });
    const html = await res.text();
    if (looksSignedOut(res.url, res.status, html)) throw new AuditSessionError();
    return html;
}

export const fetchAuditList = async () => parseAuditList(await get(`${AUDIT_BASE}/audit/list.html`));
export const fetchAudit = async (href) => parseAudit(await get(href));
export const fetchCourseHistory = async (href) => parseCourseHistory(await get(href));

// --- the audit list -----------------------------------------------------------------

/** Completed audits: [{ href, seq, text }], newest first. `seq` is the audit's number, which
 *  grows with every run. */
export function parseAuditList(html) {
    const doc = parse(html);
    const seen = new Set();
    const completed = [];
    for (const a of doc.querySelectorAll('a[href*="read.html"]')) {
        const href = new URL(a.getAttribute('href'), `${AUDIT_BASE}/audit/`).href;
        if (seen.has(href)) continue;
        seen.add(href);
        completed.push({ href, seq: auditIdFromHref(href).seq, text: clean(a.closest('tr') || a) });
    }
    completed.sort((x, y) => (y.seq ?? 0) - (x.seq ?? 0));
    return { completed };
}

// --- one audit ------------------------------------------------------------------------

const status = (el, re) => (String(el?.className || '').match(re) || [])[1] || 'NONE';

// Containers the page does not show.
const HIDDEN = '[hidden], [aria-hidden="true"], .hidden, .hide, .print-only, .printOnly, .noscreen, [style*="display:none"], [style*="display: none"]';

/** Elements of `selector` that belong to `node` itself, not to a sub-requirement inside it. */
function own(node, selector) {
    const isSub = node.classList.contains('subrequirement');
    return [...node.querySelectorAll(selector)].filter((el) => {
        const sub = el.closest('.subrequirement');
        return isSub ? sub === node : !sub || !node.contains(sub);
    });
}

function readCourses(node) {
    return own(node, 'table.completedCourses tr.takenCourse').map((tr) => ({
        term: clean(tr.querySelector('td.term')),
        course: clean(tr.querySelector('.course')),
        credit: num(tr.querySelector('.credit')),
        grade: clean(tr.querySelector('.grade')),
        code: clean(tr.querySelector('.ccode')),
        description: clean(tr.querySelector('.description')),
        inProgress: tr.classList.contains('ip'),
    }));
}

function readOptions(node) {
    const seen = new Set();
    const out = [];
    for (const el of own(node, 'table.selectcourses span.course.draggable')) {
        const department = el.getAttribute('department');
        const number = el.getAttribute('number');
        const key = `${department}|${number}`;
        if (department && number && !seen.has(key)) { seen.add(key); out.push({ department, number }); }
    }
    return out;
}

/** The audit report (read.html).
 *
 *  Returns { header: { earned, needed, catalog, prepared }, historyHref,
 *  requirements: [{ name, title, description, status, needs: { hours, count }, courses, options,
 *  subs: [{ title, description, status, earned, inProgress, courses, options }] }] }.
 *  Status is OK (met), IP (met once in-progress courses finish), NO or NONE. */
export function parseAudit(html) {
    const doc = parse(html);
    const text = clean(doc.body);

    const total = text.match(/(\d+(?:\.\d+)?)\s+of\s+(\d+(?:\.\d+)?)\s+units?/i);
    const header = {
        earned: total ? Number(total[1]) : null,
        needed: total ? Number(total[2]) : null,
        catalog: (text.match(/Catalog\s*(?:Year|Term)\s*:?\s*([A-Za-z]+\s+\d{4}|\d{6})/i) || [])[1] || null,
        prepared: (text.match(/Prepared(?:\s+on)?\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*[AP]M)?)/i) || [])[1] || null,
    };
    const historyLink = doc.querySelector('a[href*="listcourses.html"]');
    const historyHref = historyLink ? new URL(historyLink.getAttribute('href'), `${AUDIT_BASE}/audit/`).href : null;

    // Requirements and sub-requirements in page order: a sub-requirement belongs to the
    // requirement before it, whether the markup nests it or lists it beside it.
    const requirements = [];
    for (const el of doc.querySelectorAll('.requirement, .subrequirement')) {
        if (el.closest(HIDDEN)) continue;                    // a hidden print or mobile copy of the report
        if (el.classList.contains('requirement')) {
            const totals = el.querySelector('table.requirementTotals tr.reqNeeds');
            requirements.push({
                name: (String(el.className).match(/rname_(\S+)/) || [])[1] || '',
                ...heading(el.querySelector('.reqTitle')),
                status: status(el, /Status_(OK|NO|IP|NONE)/),
                needs: { hours: num(totals?.querySelector('.hours')), count: num(totals?.querySelector('.count')) },
                courses: readCourses(el),
                options: readOptions(el),
                subs: [],
            });
        } else if (requirements.length) {
            const marker = el.querySelector('[class*="srTitle_substatus"]') || el;
            requirements[requirements.length - 1].subs.push({
                ...heading(el.querySelector('.subreqTitle')),
                status: status(marker, /srTitle_substatus(OK|NO|IP)/),
                earned: num(el.querySelector('.subreqEarned')),
                inProgress: num(el.querySelector('.subreqIpHours')),
                courses: readCourses(el),
                options: readOptions(el),
            });
        }
    }
    return { header, historyHref, requirements: dedupeRequirements(requirements) };
}

// --- course history ------------------------------------------------------------------------

/** listcourses.html: the second table has Term, Course Term, Course, Hours, Grade, Title, Status.
 *  Returns [{ term, courseTerm, course, hours, grade, title, status }]. Transfer and AP credit
 *  carry grade "T". */
export function parseCourseHistory(html) {
    const table = parse(html).querySelectorAll('table')[1];
    if (!table) return [];
    const head = [...table.querySelectorAll('tr')].find((tr) => tr.querySelector('th'));
    if (!head) return [];
    const cols = [...head.querySelectorAll('th')].map((th) => clean(th).toLowerCase());
    const at = (name) => cols.findIndex((c) => c.startsWith(name));
    const idx = { term: at('term'), courseTerm: at('course term'), course: at('course'), hours: at('hours'), grade: at('grade'), title: at('title'), status: at('status') };
    if (idx.course === idx.courseTerm) idx.course = cols.findIndex((c, i) => c.startsWith('course') && i !== idx.courseTerm);
    return [...table.querySelectorAll('tr')].filter((tr) => tr.querySelector('td')).map((tr) => {
        const cells = [...tr.querySelectorAll('td')].map(clean);
        const get = (i) => (i >= 0 ? cells[i] || '' : '');
        return { term: get(idx.term), courseTerm: get(idx.courseTerm), course: get(idx.course), hours: get(idx.hours), grade: get(idx.grade), title: get(idx.title), status: get(idx.status) };
    });
}

// --- running a new audit -----------------------------------------------------------------------

/** Run an audit for the declared program, as the site's own "Run Program" button does.
 *
 *  This is the one thing here that changes anything: it adds an audit to the student's saved
 *  list. It fetches create.html, takes every field of the form as the site filled it in (so the
 *  hidden token comes along), and posts it. Returns once a newer audit appears in the list, or
 *  throws after `timeoutMs`. */
export async function runAudit({ timeoutMs = 120000, pollMs = 3000, onTick } = {}) {
    const before = Math.max(0, ...(await fetchAuditList()).completed.map((a) => a.seq ?? 0));

    const url = `${AUDIT_BASE}/audit/create.html`;
    const doc = parse(await get(url));
    const form = doc.querySelector('form#auditRequest');
    if (!form) throw new Error('The audit form was not on the page');
    const body = new URLSearchParams(new FormData(form));
    const submit = form.querySelector('[type=submit][name], button[name]');
    if (submit?.name) body.set(submit.name, submit.value || '');
    const res = await fetch(new URL(form.getAttribute('action') || 'create.html', url).href, {
        method: 'POST', credentials: 'include', body,
    });
    if (looksSignedOut(res.url, res.status, '')) throw new AuditSessionError();

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, pollMs));
        const list = await fetchAuditList();
        const newest = list.completed[0];
        if (newest && (newest.seq ?? 0) > before) return newest;
        onTick?.();
    }
    throw new Error('The audit did not finish in time');
}
