// Building names. Banner reports a code ("CLSSRM") and a long description
// ("Classroom and Office 1 Bldg"); the names people actually use for these buildings
// are neither. The table is fixed and covers every building in the Fall 2026 data.
// A building missing from it falls back to Banner's own description so a new building
// never renders blank.

const COMMON = {
    CLSSRM: 'COB1',
    COB2: 'COB2',
    ADMIN: 'Admin',
    KOLLIG: 'Library',
    SCIENG: 'SE1',
    SE2: 'SE2',
    ACS: 'ACS',
    SSB: 'SSB',
    GRAN: 'Granite',
    GLCR: 'Glacier',
    SSM: 'SSM',
    SRE: 'SRE',
    BSP: 'BSP',
    REMOTE: 'Remote',
    NONE: 'None',
};

export const BUILDING_SCHEMES = [
    ['common', 'Common names'],
    ['banner', 'Banner names'],
];

// Banner is not consistent about a building's code ("Ruiz Administration" turned up
// under a code that is not ADMIN), but its description is stable, so the description is
// matched too. The first pattern that matches wins.
const BY_DESCRIPTION = [
    [/remote/i, 'Remote'],
    [/administration|^admin\b/i, 'Admin'],
    [/classroom and office 1/i, 'COB1'],
    [/classroom and office 2/i, 'COB2'],
    [/library/i, 'Library'],
    [/science and engineering 1/i, 'SE1'],
    [/science and engineering 2/i, 'SE2'],
    [/arts\s*(&|and)\s*computational/i, 'ACS'],
    [/student services/i, 'SSB'],
    [/granite/i, 'Granite'],
    [/glacier/i, 'Glacier'],
    [/social sciences/i, 'SSM'],
    [/sustainability research/i, 'SRE'],
    [/biomedical/i, 'BSP'],
];

// Banner's descriptions arrive HTML-escaped ("Arts &amp; Computational Sciences").
const decode = (s) => String(s ?? '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Name of the building for one meetingTime under the chosen scheme. */
export function buildingName(mt, scheme = 'common') {
    const code = mt.building;
    if (scheme === 'common') {
        if (!code) return COMMON.NONE;
        if (COMMON[code]) return COMMON[code];
        const desc = decode(mt.buildingDescription);
        return BY_DESCRIPTION.find(([re]) => re.test(desc))?.[1] || desc || code;
    }
    return decode(mt.buildingDescription) || code || '';
}

/** Remote instruction has no room; Banner fills the room field with filler ("ONLY"). */
export const isRemote = (mt) => mt.building === 'REMOTE' || /remote/i.test(mt.buildingDescription || '');

/** "COB2, Room 170". Long names switch to "Rm" so the label still fits a day column. */
export function locationLabel(mt, scheme = 'common') {
    const name = buildingName(mt, scheme);
    if (isRemote(mt)) return name;
    if (!name) return mt.room ? `Room ${mt.room}` : '';
    if (!mt.room) return name;
    const full = `${name}, Room ${mt.room}`;
    return full.length > 18 ? `${name}, Rm ${mt.room}` : full;
}
