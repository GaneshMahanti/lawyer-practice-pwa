// ==============================================================================
// eCourts Reference Data for Andhra Pradesh Judicial Districts & Court Complexes
// Sourced from eCourts Services (services.ecourts.gov.in)
// Supports inline advocate customization and extensible additions
// ==============================================================================

export const DEFAULT_STATE = 'Andhra Pradesh';

export const CASE_CATEGORIES = ['Civil', 'Crime', 'Family', 'NIA'] as const;
export type CaseCategory = (typeof CASE_CATEGORIES)[number];

export const DEFAULT_CASE_TYPES: Record<CaseCategory, string[]> = {
  Civil: ['OS (Original Suit)', 'OP (Original Petition)', 'Appeal Suit (AS)', 'EP (Execution Petition)'],
  Crime: ['CC (Calendar Case)', 'SC (Sessions Case)', 'Bail Application', 'Crl.MP'],
  Family: ['FCOP (Family Court OP)', 'MC (Maintenance Case)', 'HMOP (Hindu Marriage OP)'],
  NIA: ['NI Act (Sec 138 Cheque Bounce)', 'STC (Summary Trial Case)'],
};

/**
 * Andhra Pradesh 13 Judicial Districts
 * (Follows the Indian Court System boundaries, not the 26 redrawn administrative districts)
 */
export const AP_JUDICIAL_DISTRICTS: string[] = [
  'Anantapur',
  'Chittoor',
  'East Godavari',
  'Guntur',
  'Kadapa',
  'Krishna',
  'Kurnool',
  'Nellore',
  'Prakasam',
  'Srikakulam',
  'Visakhapatnam',
  'Vizianagaram',
  'West Godavari',
];

/**
 * eCourts Court Complexes per Judicial District
 */
export const DEFAULT_COURT_COMPLEXES: Record<string, string[]> = {
  Anantapur: [
    'Anantapur District Court Complex',
    'Dharmavaram Court Complex',
    'Gooty Court Complex',
    'Hindupur Court Complex',
    'Kadiri Court Complex',
    'Madakasira Court Complex',
    'Penukonda Court Complex',
    'Rayadurg Court Complex',
    'Tadipatri Court Complex',
    'Uravakonda Court Complex',
  ],
  Chittoor: [
    'Chittoor District Court Complex',
    'Tirupati Court Complex',
    'Madanapalle Court Complex',
    'Srikalahasti Court Complex',
    'Palamaner Court Complex',
    'Piler Court Complex',
    'Nagari Court Complex',
    'Kuppam Court Complex',
    'Punganur Court Complex',
    'Vayalpad Court Complex',
  ],
  'East Godavari': [
    'Rajahmundry District Court Complex',
    'Kakinada Court Complex',
    'Amalapuram Court Complex',
    'Ramachandrapuram Court Complex',
    'Peddapuram Court Complex',
    'Pithapuram Court Complex',
    'Mandapeta Court Complex',
    'Tuni Court Complex',
    'Razole Court Complex',
    'Kothapeta Court Complex',
  ],
  Guntur: [
    'Guntur District Court Complex',
    'Tenali Court Complex',
    'Narasaraopet Court Complex',
    'Bapatla Court Complex',
    'Mangalagiri Court Complex',
    'Sattenapalli Court Complex',
    'Repalle Court Complex',
    'Chilakaluripet Court Complex',
    'Macherla Court Complex',
    'Gurazala Court Complex',
    'Vinukonda Court Complex',
  ],
  Kadapa: [
    'Kadapa District Court Complex',
    'Proddatur Court Complex',
    'Pulivendula Court Complex',
    'Rajampet Court Complex',
    'Rayachoty Court Complex',
    'Jammalamadugu Court Complex',
    'Badvel Court Complex',
    'Mydukur Court Complex',
  ],
  Krishna: [
    'Machilipatnam District Court Complex',
    'Vijayawada Court Complex',
    'Gudivada Court Complex',
    'Nuzvid Court Complex',
    'Jaggaiahpet Court Complex',
    'Nandigama Court Complex',
    'Gannavaram Court Complex',
    'Avanigadda Court Complex',
    'Tiruvuru Court Complex',
    'Kaikaluru Court Complex',
  ],
  Kurnool: [
    'Kurnool District Court Complex',
    'Nandyal Court Complex',
    'Adoni Court Complex',
    'Yemmiganur Court Complex',
    'Allagadda Court Complex',
    'Dhone Court Complex',
    'Nandikotkur Court Complex',
    'Atmakur Court Complex',
    'Pattikonda Court Complex',
  ],
  Nellore: [
    'Nellore District Court Complex',
    'Gudur Court Complex',
    'Kavali Court Complex',
    'Kovur Court Complex',
    'Atmakur Court Complex',
    'Sullurpeta Court Complex',
    'Naidupeta Court Complex',
    'Venkatagiri Court Complex',
  ],
  Prakasam: [
    'Ongole District Court Complex',
    'Chirala Court Complex',
    'Markapur Court Complex',
    'Kandukur Court Complex',
    'Addanki Court Complex',
    'Giddalur Court Complex',
    'Kanigiri Court Complex',
    'Darsi Court Complex',
  ],
  Srikakulam: [
    'Srikakulam District Court Complex',
    'Tekkali Court Complex',
    'Palakonda Court Complex',
    'Palasa Court Complex',
    'Rajam Court Complex',
    'Narasannapeta Court Complex',
    'Sompeta Court Complex',
    'Amadalavalasa Court Complex',
  ],
  Visakhapatnam: [
    'Visakhapatnam District Court Complex',
    'Anakapalle Court Complex',
    'Gajuwaka Court Complex',
    'Chodavaram Court Complex',
    'Bheemunipatnam Court Complex',
    'Narsipatnam Court Complex',
    'Yellamanchili Court Complex',
    'Pendurthi Court Complex',
    'Madugula Court Complex',
  ],
  Vizianagaram: [
    'Vizianagaram District Court Complex',
    'Bobbili Court Complex',
    'Parvathipuram Court Complex',
    'Salur Court Complex',
    'Cheepurupalli Court Complex',
    'Kothavalasa Court Complex',
    'Srungavarapukota Court Complex',
  ],
  'West Godavari': [
    'Eluru District Court Complex',
    'Bhimavaram Court Complex',
    'Tadepalligudem Court Complex',
    'Tanuku Court Complex',
    'Palakol Court Complex',
    'Narasapuram Court Complex',
    'Kovvur Court Complex',
    'Jangareddygudem Court Complex',
    'Nidadavole Court Complex',
  ],
};

const CUSTOM_DISTRICTS_KEY = 'vakildesk_custom_districts';
const CUSTOM_COMPLEXES_KEY = 'vakildesk_custom_complexes';
const CUSTOM_CASE_TYPES_KEY = 'vakildesk_custom_case_types';

/**
 * Get all districts (default 13 AP + any custom added by advocate)
 */
export function getDistricts(): string[] {
  if (typeof window === 'undefined') return AP_JUDICIAL_DISTRICTS;
  try {
    const raw = localStorage.getItem(CUSTOM_DISTRICTS_KEY);
    const custom: string[] = raw ? JSON.parse(raw) : [];
    return Array.from(new Set([...AP_JUDICIAL_DISTRICTS, ...custom]));
  } catch {
    return AP_JUDICIAL_DISTRICTS;
  }
}

export function addCustomDistrict(district: string): string[] {
  const clean = district.trim();
  if (!clean || typeof window === 'undefined') return getDistricts();
  try {
    const raw = localStorage.getItem(CUSTOM_DISTRICTS_KEY);
    const custom: string[] = raw ? JSON.parse(raw) : [];
    if (!custom.includes(clean)) {
      custom.push(clean);
      localStorage.setItem(CUSTOM_DISTRICTS_KEY, JSON.stringify(custom));
    }
  } catch {}
  return getDistricts();
}

/**
 * Get court complexes for a given district
 */
export function getCourtComplexes(district: string): string[] {
  const defaults = DEFAULT_COURT_COMPLEXES[district] || [`${district} Court Complex`];
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(CUSTOM_COMPLEXES_KEY);
    const customMap: Record<string, string[]> = raw ? JSON.parse(raw) : {};
    const custom = customMap[district] || [];
    return Array.from(new Set([...defaults, ...custom]));
  } catch {
    return defaults;
  }
}

export function addCustomCourtComplex(district: string, complex: string): string[] {
  const clean = complex.trim();
  if (!clean || typeof window === 'undefined') return getCourtComplexes(district);
  try {
    const raw = localStorage.getItem(CUSTOM_COMPLEXES_KEY);
    const customMap: Record<string, string[]> = raw ? JSON.parse(raw) : {};
    if (!customMap[district]) {
      customMap[district] = [];
    }
    if (!customMap[district].includes(clean)) {
      customMap[district].push(clean);
      localStorage.setItem(CUSTOM_COMPLEXES_KEY, JSON.stringify(customMap));
    }
  } catch {}
  return getCourtComplexes(district);
}

/**
 * Get case types for category
 */
export function getCaseTypes(category: CaseCategory): string[] {
  const defaults = DEFAULT_CASE_TYPES[category] || ['General'];
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(CUSTOM_CASE_TYPES_KEY);
    const customMap: Record<string, string[]> = raw ? JSON.parse(raw) : {};
    const custom = customMap[category] || [];
    return Array.from(new Set([...defaults, ...custom]));
  } catch {
    return defaults;
  }
}

export function addCustomCaseType(category: CaseCategory, caseType: string): string[] {
  const clean = caseType.trim();
  if (!clean || typeof window === 'undefined') return getCaseTypes(category);
  try {
    const raw = localStorage.getItem(CUSTOM_CASE_TYPES_KEY);
    const customMap: Record<string, string[]> = raw ? JSON.parse(raw) : {};
    if (!customMap[category]) {
      customMap[category] = [];
    }
    if (!customMap[category].includes(clean)) {
      customMap[category].push(clean);
      localStorage.setItem(CUSTOM_CASE_TYPES_KEY, JSON.stringify(customMap));
    }
  } catch {}
  return getCaseTypes(category);
}

/**
 * Generate recent years array (current year back 15 years)
 */
export function getRecentYears(): number[] {
  const currentYear = new Date().getFullYear();
  const years: number[] = [];
  for (let y = currentYear; y >= currentYear - 15; y--) {
    years.push(y);
  }
  return years;
}
