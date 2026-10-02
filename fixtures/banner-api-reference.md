Signed in fine, Duo auto-approved, and the deep link survived the round trip. Nothing was added, dropped, or submitted.

Auth chain
reg-prod.ec.ucmerced.edu  (Banner 9 SP, Spring Security SAML)
└─ 302 → shib.ucmerced.edu/idp/profile/SAML2/POST/SSO   (password + Duo)
└─ POST assertion → /StudentRegistrationSsb/saml/SSO/alias/registrationssb-prod-sp
└─ 302 → /ssb/registration/registerPostSignIn?mode=preReg
└─ 302 → /ssb/term/termSelection?mode=preReg

Intent survives SSO through registerPostSignIn, which replays the mode param you were heading to. That is why clicking "Prepare for Registration" pre-login dropped you back at the term selector for that exact mode rather than the menu.

Two independent session lifetimes stack here. When the Banner session died mid-exploration, the next request bounced to /saml2/authenticate/registrationssb-prod-sp and re-federated silently, with no password and no Duo, because the IdP session was still alive. So Banner session death is cheap to recover from; IdP session death is not.

Logout endpoint is saml/logout?local=true (from the logoutEndpoint meta), meaning app-local logout that leaves the IdP session intact.

Cookies

JS can read 19 cookies on that origin, and every one of them is analytics or infrastructure:

nmstat, _fbp, _scid, _scid_r, _sctr, _mkto_trk, _tt_enable_cookie, _ttp, ttcsid, ttcsid_*×3, _ga, _ga_*×3, _uetvid, AWSALB, AWSALBCORS

No JSESSIONID and no _shibsession_* visible, so the auth cookies are HttpOnly. Good posture. Two things worth noting anyway:

AWSALB / AWSALBCORS are ALB stickiness. Your Banner session is pinned to one backend node, so anything replaying requests has to carry those or risk landing on a node that does not know the session.
Snapchat, TikTok, Meta, Marketo, GA and Bing cookies are scoped to .ucmerced.edu, so they ride along on every authenticated request to the registration host. That is a parent-domain scoping choice, not something Banner does.
CSRF and session config

From <meta> tags on every page:

meta	value
synchronizerToken	UUID, per session (redacted)
maxInactiveInterval	1500 (25 min idle)
transactionTimeout	300
keepAliveURL	/ssb/keepAlive/data

bannerWeb.js installs a global $.ajaxPrefilter that reads that meta and sets X-Synchronizer-Token on every jQuery XHR. Detection of a dead session is header-based: $(document).ajaxComplete checks for X-Login-Page: true on the response, which is how it avoids silently rendering the SSO login HTML into a data panel.

Keep-alive is a plain $.ajax GET to /ssb/keepAlive/data (returns 10 bytes), fired from an inactivity-notification widget, and it resets the timer client-side too.

Finding: the synchronizer token is not enforced on reads. GET getRegistrationEvents and POST getMeetingInformationForRegistrations both return 200 with the header omitted entirely. The session cookie alone is sufficient. I did not probe whether it is enforced on submitRegistration or the add/drop endpoints, since that would require sending a write.

Context handoff

Term is server-side session state, not a URL parameter. The sequence:

GET /ssb/classRegistration/getTerms?searchTerm=202630&offset=1&max=1 populates the select2
GET /ssb/term/saveTerm?mode=registration&term=202630&uniqueSessionId=ct64k1787436890341 writes it into the session
POST /ssb/term/search?mode=registration (hidden field txt_term=202630) navigates
GET /ssb/classRegistration/classRegistration with no parameters at all

Step 4 is the point. Every downstream data call is parameterless because the server already knows the term. The uniqueSessionId is [5 random chars][epoch ms], generated per tab, and it is what lets one Banner session hold different terms in different tabs at the same time. It is also keyed by mode, so mode=preReg and mode=registration carry separate saved terms.

"View Registration Information" is the exception. It skips term selection entirely and passes the term explicitly as reset?term=202630, driven by its own in-page dropdown.

Read endpoints

Skipping the catalog/section-detail family per your note. The personal-data reads:

Enrolled courses, full detail

POST /ssb/classRegistration/getMeetingInformationForRegistrations

No body needed. Returned 10 objects with the complete Banner section schema: courseReferenceNumber, courseTitle, subject, courseNumber, sequenceNumber, creditHours, billHours, gradingMode, instructionalMethod, campus, college, department, faculty, meetingsFaculty, enrollment, maximumEnrollment, seatsAvailable, waitCount, crossList*, partOfTerm, …. This is the richest single call. Available from both the Register for Classes and View Registration Information contexts.

Calendar events (meetings + final exams, flattened)

GET /ssb/classRegistration/getRegistrationEvents?termFilter=

17 objects for 10 sections, so recurring meetings and finals are expanded. Keys: id, title, start, end, editable, allDay, className, term, crn, subject, courseNumber. Empty termFilter means current session term; pass a term code for multi-term.

Registration records with totals

GET /ssb/registrationHistory/reset?term=202630
→ { data: { registrations[10], totalCredit:"18", totalBill:"18", minHours:"0", maxHours:"18" } }

Each registration carries the full academic record view, not just the section: grade, gradeMidTerm, gradeDate, gradeIncompleteFinal, addDate, startDate, lastAttendance, attendanceHour, courseRegistrationStatusDescription, statusIndicator, waitlistPriority, studyPathName, studyPathKeySequence, creditHour, billHour, meetingTimes, faculty, plus the whole *Override family (preqOverride, majorOverride, levelOverride, campusOverride, repeatOverride, mexcOverride, programOverride, testOverride, duplicateOverride, studentAttributeOverride, approvalOverride). This is the one to use if you want grades and add/drop dates rather than schedule shape.

Active registrations across terms

GET /ssb/registrationHistory/renderActiveRegistrations
→ { data: { registrations[10], activeRegConfig } }

Same record shape, plus a column-config object.

Other reads

GET  /ssb/classRegistration/getPlans          plans + selectPlanConfig + getThirdPartyData
GET  /ssb/classRegistration/getOLRStartDate | getOLREndDate
POST /ssb/classRegistration/getSectionDetailsFromCRN
GET  /ssb/registrationPicture/picture
GET  /ssb/contactCard/retrieveData            (500'd for me)
GET  /ssb/menu?type=Personal                  XML
GET  /ssb/selfServiceMenu/data                XML
GET  /ssb/userPreference/fetchUsageTracking
GET  /ssb/keepAlive/data

Writes present on the page, untouched: addRegistrationItem, addCRNRegistrationItems, addMultiTermClassRegistrations, submitRegistration, submitSummaryRegistration, autoDropConfirm, finishAddAuthorizationPopup, finishMultiTermPopup, finishOLRPopup.

Two gotchas

Endpoint URLs are not literals in the JS bundles. They are stashed in data-endpoint attributes on DOM elements and read at call time ($("#getRegistrationEvents").attr("data-endpoint")). Grepping the bundles finds nothing; enumerating [data-endpoint] on a loaded page finds all 54.

The server enforces flow order, and it is aggressive about it. Mid-exploration I fetched /ssb/registrationHistory/registrationHistory as an XHR while the server-side context was still classRegistration, and the entire Banner session was invalidated. Every subsequent call redirected to re-auth. I cannot prove that request was the trigger, but the timing is exact, and nothing else in that batch was unusual. Practical consequence: hitting a full page controller out of band appears to be treated as a flow violation, so anything replaying these calls should stay inside one context or re-establish it through the real navigation path.

Ran a controlled test on this, and it overturned my earlier explanation. Details below.

The five options
Option	mode	Term list from	Lands on	Session
Prepare for Registration	preReg	classRegistration/getTerms	/ssb/prepareRegistration/prepareRegistration	authenticated
Register for Classes	registration	classRegistration/getTerms	/ssb/classRegistration/classRegistration	authenticated
Search Class Schedule	search	classSearch/getTerms	/ssb/classSearch/classSearch (inferred, did not complete the click-through)	anonymous
Browse Course Catalog	courseSearch	classSearch/getTerms	/ssb/courseSearch/courseSearch (inferred)	anonymous
View Registration Information	none	in-page dropdown	/ssb/registrationHistory/registrationHistory	authenticated
Prepare for Registration is the read-only gate check: student status, academic standing, holds, time ticket window, class standing, plus the Primary Curriculum panel (level, college, degree, program, campus, catalog/admit term, major, department, concentration).
Register for Classes is the transactional one: Find Classes / Enter CRNs / Schedule and Options tabs, the calendar, and the Summary panel with the Action dropdowns and Submit. All the write endpoints live here.
Search Class Schedule and Browse Course Catalog are the guest paths. Their term selector says "Select a Term for Class Search", offers every term rather than only terms open for registration, does not preselect, and the header shows no name. They run with no Banner identity at all.
View Registration Information skips term selection entirely and passes the term explicitly (reset?term=202630). It is the historical/record view: grades, add dates, statuses, active registrations across terms.

Also worth knowing: /ssb/registration (the menu itself) renders anonymously. The SAML redirect fires on the first protected controller, not on the menu.

Is context shared? Mostly yes

Data endpoints are not bound to the page you are sitting on. From the registrationHistory page I called, all 200:

GET  /ssb/registrationHistory/reset?term=202630
GET  /ssb/registrationHistory/renderActiveRegistrations
GET  /ssb/classRegistration/getRegistrationEvents?termFilter=
POST /ssb/classRegistration/getMeetingInformationForRegistrations
GET  /ssb/classSearch/get_subject?term=202630&offset=1&max=5

That spans three different modules from one page. So there is no per-page endpoint whitelist.

What is actually shared is the session, and inside it the saved term, which saveTerm writes keyed by mode. preReg and registration hold separate saved terms, so a parameterless call resolves against whichever mode you last established. registrationHistory sidesteps this by taking term as a parameter, which makes it the most reliable thing to call cold.

Three real gates, none of them the page you are on:

Authentication. classSearch/* is public and answers with no session at all. Everything under classRegistration/*, registrationHistory/*, prepareRegistration/* needs one.
Feature configuration. getPlans and contactCard/retrieveData return 500 at UCM in every context I tried. Those look unconfigured or unlicensed rather than context-gated.
Term state, for the parameterless calls only.
Correction: what actually kills the session

I said earlier that fetching a page controller out of band was a flow violation. That was wrong. Controlled test, single batch, one page:

registrationHistory/reset      -> 200
classSearch/get_subject        -> 200
classRegistration/getPlans     -> 500      ← trigger
registrationHistory/reset      -> 200 REDIRECTED-TO-AUTH
classSearch/get_subject        -> 200

Any 500 tears down the authenticated session. The failing call itself returns the 500 normally; the next authenticated call is the one that bounces to /saml2/authenticate/.... The public endpoint keeps answering right through it, which is what confirms the teardown is on the authenticated session rather than the connection.

That explains both earlier incidents. Run one: contactCard/retrieveData 500'd, and registrationPicture was simply the next authenticated call. Run two: getPlans 500'd, classSearch/get_subject survived because it is public, and getOLRStartDate took the blame for being next in line. Neither registrationHistory nor getOLRStartDate did anything wrong.

Practical consequence: avoid getPlans and contactCard/retrieveData entirely. One stray call to either poisons the session for everything after it. Recovery is cheap (load any protected page, silent SAML re-auth, no password, no Duo), but it costs a full page round trip each time.

For reading enrolled courses cold, the cheapest reliable path is to land on registrationHistory/registrationHistory once, then call reset?term=XXXXXX, renderActiveRegistrations, getMeetingInformationForRegistrations, and getRegistrationEvents off that one session. All four work from there, and only the first needs a term.
---

## Correction: `POST term/search` is the commit, not a navigation

Verified live 2026-08-28, from `/ssb/registration` on an authenticated session.

The context-handoff sequence above lists `POST /ssb/term/search?mode=…` as the step
that "navigates". It does more than that — **it is the only step that actually commits
the term.** `saveTerm` on its own writes a value the search endpoints never read.

Evidence:

| action | `searchResults` returns |
|---|---|
| `saveTerm(mode=search, term=202610)`, then search | 1703 rows, **Fall 2026** |
| no saveTerm at all, ask `txt_term=202530` | 1703 rows, **Fall 2026** |
| `POST term/search?mode=search` with `term=202610` | 1575 rows, **Spring 2026** |

Two consequences:

1. **`searchResults` ignores its own `txt_term` parameter entirely.** The term is
   session state, full stop. Passing a term to that endpoint and trusting the result
   is how you silently render one term's sections under another term's label.
2. **A session that never committed a term gets `success: true` with zero rows.**
   That reads as "this term has no classes" rather than as a missing setup step, and
   it is the failure any client hits when it calls only `saveTerm`.

`saveTerm`'s response body is `{"maxterm": "202630"}` — it echoes the maximum term,
not what you saved, so it gives no signal that the write went nowhere.

Live section counts at the time of writing: 202530 = 1621, 202610 = 1575,
202620 = (untested), 202630 = 1703.

## Correction: the term key in the scraped JSON is wrong

`scripts/ucmerced_scraper.*` writes the *requested* term as the top-level key but
appears to scrape whatever the session had committed — the same bug as above, one
layer up. `fixtures/sections-202610-spring.json` is keyed `202630` while containing
1575 rows, which matches the live Spring 2026 count exactly. Trust the row count and
each row's own `term` / `termDesc`, not the key.
