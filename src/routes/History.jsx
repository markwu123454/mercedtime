import React from 'react';

// Not built yet. All of it comes from two calls that are already wired up in api.js:
// getRegistrations(term) — which takes the term explicitly and is therefore the most
// reliable thing to call cold — and getActiveRegistrations() for every term at once.
//
// Worth surfacing beyond what Banner shows: the *Override family (preqOverride,
// majorOverride, repeatOverride, …) is present in that payload but has no UI anywhere
// in Banner.
export default function History() {
    return (
        <div className="route-stub">
            <h2>Record</h2>
            <p>Not built yet.</p>
            <ul>
                <li>Grades by term, with add and drop dates</li>
                <li>Registration status and waitlist priority</li>
                <li>Override flags Banner never displays</li>
            </ul>
            <p>
                Until then: <a href="/StudentRegistrationSsb/ssb/registrationHistory/registrationHistory">View Registration Information</a>
            </p>
        </div>
    );
}
