// Turning Banner's registration records into the same shape the rest of the app
// already understands, so the schedule code has one input type.
//
// registrationHistory/reset and renderActiveRegistrations carry the section's course
// fields plus the student's own (status, grade). None of this is read defensively by
// accident: the record shape has only been seen through banner-api-reference.md, so
// every field is optional here and a missing one degrades to "unknown" instead of
// throwing.

import { courseKey } from './sections.js';

const DROPPED = /drop|delet|cancel|withdr/i;

const asMeetings = (r) => {
    if (Array.isArray(r.meetingsFaculty) && r.meetingsFaculty.length) return r.meetingsFaculty;
    if (Array.isArray(r.meetingTimes)) {
        return r.meetingTimes.map((m) => ({ meetingTime: m.meetingTime || m }));
    }
    return [];
};

export function normalizeRegistration(r, fallbackTerm = '') {
    const status = r.courseRegistrationStatusDescription || r.statusDescription || '';
    return {
        crn: String(r.courseReferenceNumber ?? ''),
        term: String(r.term ?? r.termCode ?? fallbackTerm ?? ''),
        subject: r.subject || '',
        number: r.courseNumber || '',
        title: r.courseTitle || '',
        seq: r.sequenceNumber || '',
        key: courseKey({ subject: r.subject, courseNumber: r.courseNumber, subjectCourse: r.subjectCourse }),
        status,
        grade: r.grade || '',
        dropped: DROPPED.test(status),
        meetingsFaculty: asMeetings(r),
        scheduleTypeDescription: r.scheduleTypeDescription || r.scheduleType || r.scheduleDescription || '',
    };
}

/** The records inside either endpoint's envelope. */
export const registrationRows = (res) => res?.data?.registrations ?? res?.registrations ?? [];

/** Section-like objects for a set of registered rows. The term's catalog wins when it
 *  has the CRN, since its shape is known; the record's own meetings are the fallback. */
export function sectionsForRows(rows, catalog = []) {
    const byCrn = new Map(catalog.map((s) => [s.courseReferenceNumber, s]));
    return rows.filter((r) => !r.dropped).map((r) => byCrn.get(r.crn) || ({
        courseReferenceNumber: r.crn,
        subject: r.subject,
        courseNumber: r.number,
        courseTitle: r.title,
        sequenceNumber: r.seq,
        scheduleTypeDescription: r.scheduleTypeDescription,
        meetingsFaculty: r.meetingsFaculty,
    }));
}

// UC Merced's term codes are the calendar year plus 10 (spring), 20 (summer) or 30 (fall).
export const calendarTerm = (d = new Date()) =>
    `${d.getFullYear()}${d.getMonth() < 5 ? '10' : d.getMonth() < 8 ? '20' : '30'}`;
