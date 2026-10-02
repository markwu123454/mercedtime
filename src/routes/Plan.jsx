import React from 'react';
import { useStore } from '../lib/store.js';

// Not built yet. The plan itself already works — it is persisted per term in
// chrome.storage and drives the "My plan" filter in Find classes. What is missing is
// the view that turns it into a decision:
//
//   - weekly grid, enrolled solid and planned ghosted
//   - conflict highlighting (pure client-side maths over meetingsFaculty, and the
//     single thing Banner cannot do at all — it will not tell you two sections clash
//     until you submit and get an error)
//   - projected credits against minHours / maxHours from registrationHistory/reset
//   - .ics export
export default function Plan() {
    const { plan, term } = useStore((s) => s);
    return (
        <div className="route-stub">
            <h2>Plan</h2>
            <p>Not built yet. {plan.size} section{plan.size === 1 ? '' : 's'} saved for {term || 'this term'}.</p>
            <ul>
                <li>Weekly grid: enrolled solid, planned ghosted</li>
                <li>Conflict detection before you register, not after</li>
                <li>Projected credits against your min/max hours</li>
                <li>Export to calendar</li>
            </ul>
        </div>
    );
}
