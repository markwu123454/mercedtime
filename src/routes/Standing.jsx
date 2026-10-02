import React from 'react';
import { useStore } from '../lib/store.js';

// Not built yet. Two tiers when it is, because the data has two very different
// reliability profiles:
//
//   Core (JSON, robust) — classRegistration/getTerms returns *only* terms open for
//   registration, which is itself the answer to "may I register and for what", plus
//   getOLRStartDate / getOLREndDate for the window. No scraping.
//
//   Detail (scraped, fragile) — holds, time ticket, class standing and primary
//   curriculum live only in prepareRegistration's server-rendered HTML; that page
//   fires no data XHR at all. api.getRegistrationStatusHTML + banner.parseRegistrationStatus
//   handle it, and both fail soft so a Banner upgrade degrades this to a link rather
//   than to a confidently blank card.
export default function Standing() {
    const openTerms = useStore((s) => s.openTerms);
    return (
        <div className="route-stub">
            <h2>Standing</h2>
            <p>Not built yet. This route answers one question: <em>may I register, when, and for what?</em></p>
            {openTerms.length > 0 && (
                <p>Open for registration right now: {openTerms.map((t) => t.description).join(', ')}.</p>
            )}
            <ul>
                <li>Registration window and time ticket</li>
                <li>Holds, split into blocking and informational</li>
                <li>Credit total against min/max hours</li>
                <li>Primary curriculum</li>
            </ul>
            <p>
                Until then: <a href="/StudentRegistrationSsb/ssb/term/termSelection?mode=preReg">Prepare for Registration</a>
            </p>
        </div>
    );
}
