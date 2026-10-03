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

// Banner's descriptions arrive HTML-escaped ("Arts &amp; Computational Sciences").
const decode = (s) => String(s ?? '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Name of the building for one meetingTime under the chosen scheme. */
export function buildingName(mt, scheme = 'common') {
    const code = mt.building;
    if (scheme === 'common') {
        if (!code) return COMMON.NONE;
        return COMMON[code] || decode(mt.buildingDescription) || code;
    }
    return decode(mt.buildingDescription) || code || '';
}

/** "COB2, Room 170". Long names switch to "Rm" so the label still fits a day column. */
export function locationLabel(mt, scheme = 'common') {
    const name = buildingName(mt, scheme);
    if (!name) return mt.room ? `Room ${mt.room}` : '';
    if (!mt.room) return name;
    const full = `${name}, Room ${mt.room}`;
    return full.length > 18 ? `${name}, Rm ${mt.room}` : full;
}
