/**
 * US bar closing times — used as default end time for "late_night" HH windows.
 *
 * Sources:
 * - State-level: https://en.wikipedia.org/wiki/Last_call (April 2026)
 * - City overrides: Wikipedia city-specific section + targeted searches (2026)
 *
 * All times stored as minutes since midnight (e.g. 120 = 2:00 AM).
 * null = no statewide/city mandate (venue sets its own hours).
 *
 * For cities not listed: use state default, or 2am (120) if no state default.
 * For "late_night" windows where endMin is null: use city/state closeMin as default.
 */

export type StateCloseTime = {
  closeMin: number | null   // minutes since midnight; null = no mandate
  note?: string
}

export type CityCloseTime = {
  closeMin: number | null
  note?: string
}

// ── State-level defaults ─────────────────────────────────────────────────────
export const STATE_CLOSE_TIMES: Record<string, StateCloseTime> = {
  AL: { closeMin: 120, note: 'Birmingham & Mobile may extend later' },
  AK: { closeMin: 300, note: '5am; some cities restrict further' },
  AZ: { closeMin: 120 },
  AR: { closeMin: 120 },
  CA: { closeMin: 120 },
  CO: { closeMin: 120 },
  CT: { closeMin: 120, note: '1am Sun–Thu, 2am Fri–Sat' },
  DE: { closeMin: 60, note: 'Service stops 1am, drinks off by 2am' },
  DC: { closeMin: 180, note: '2am weeknights, 3am Fri/Sat, 4am NYE' },
  FL: { closeMin: 120, note: 'Some cities (Miami, Key West, Broward) extend to 4–5am' },
  GA: { closeMin: 120, note: 'Varies by county; Atlanta 2:30am' },
  HI: { closeMin: 240, note: 'Not all bars qualify for 4am license' },
  ID: { closeMin: 120 },
  IL: { closeMin: 60, note: 'Varies; Chicago 2am Sun–Fri, 3am Sat' },
  IN: { closeMin: 180 },
  IA: { closeMin: 120 },
  KS: { closeMin: 120 },
  KY: { closeMin: 120, note: 'Louisville has 4am licenses' },
  LA: { closeMin: null, note: 'No statewide mandate' },
  ME: { closeMin: 60, note: '1am, 2am on New Year\'s Eve' },
  MD: { closeMin: 120 },
  MA: { closeMin: 120, note: 'Cities/towns may set earlier' },
  MI: { closeMin: 120, note: '4am on New Year\'s Eve' },
  MN: { closeMin: 120, note: 'Many cities restrict to 1am' },
  MS: { closeMin: 0, note: 'Midnight or 1am by city' },
  MO: { closeMin: 90, note: '1:30am; 3am in St. Louis & Kansas City' },
  MT: { closeMin: 90, note: '~1:30am; gas stations sell beer until 2am' },
  NE: { closeMin: 60, note: '1am; Omaha & Lincoln may go until 2am' },
  NV: { closeMin: null, note: 'No statewide mandate' },
  NH: { closeMin: 60, note: 'Last call 12:45am, close 1:30am' },
  NJ: { closeMin: null, note: 'No statewide mandate; most cities 2am' },
  NM: { closeMin: 120, note: '2am Mon–Sat, midnight Sunday' },
  NY: { closeMin: 240, note: 'State law 4am; counties may set earlier (1–3am)' },
  NC: { closeMin: 120 },
  ND: { closeMin: 60, note: '1am; counties can opt up to 2am' },
  OH: { closeMin: 120, note: 'Some venues 2:30am' },
  OK: { closeMin: 120 },
  OR: { closeMin: 150, note: '2:30am' },
  PA: { closeMin: 120, note: 'Taverns; clubs 3am' },
  RI: { closeMin: 60, note: '1am daily; Providence 2am Fri/Sat' },
  SC: { closeMin: null, note: 'Varies by county; most ~2am' },
  SD: { closeMin: 120 },
  TN: { closeMin: 180 },
  TX: { closeMin: null, note: 'Varies by city/county (midnight–2am)' },
  UT: { closeMin: 60, note: 'Last call 1am, must close by 2am' },
  VT: { closeMin: 120, note: '3am on New Year\'s Eve' },
  VA: { closeMin: 120, note: 'Off-premises midnight' },
  WA: { closeMin: 120 },
  WV: { closeMin: 180 },
  WI: { closeMin: 150, note: '2am Sun–Thu, 2:30am Fri–Sat' },
  WY: { closeMin: 120 },
}

// ── City-level overrides ─────────────────────────────────────────────────────
// Key major cities that differ from their state default.
// Lookup order: city → state default → 2am fallback.
//
// Format: "City, ST" → closeMin (minutes since midnight)
export const CITY_CLOSE_TIMES: Record<string, CityCloseTime> = {

  // ── Louisiana (state default: null = no mandate) ──
  'New Orleans, LA': { closeMin: null, note: '24hr — no close time mandate' },
  'Baton Rouge, LA': { closeMin: 120 },
  'Shreveport, LA': { closeMin: 240, note: '6am downtown, 4am elsewhere' },
  'Lake Charles, LA': { closeMin: 150, note: 'Closes 2:30am Sun, open Mon–Sat 6am–2:30am' },
  'Lafayette, LA': { closeMin: 120 },
  'Monroe, LA': { closeMin: 120 },

  // ── Nevada (state default: null = no mandate) ──
  'Las Vegas, NV': { closeMin: null, note: '24hr — no close time mandate' },
  'Reno, NV': { closeMin: null, note: 'No mandate; typically 2–4am' },
  'Henderson, NV': { closeMin: null },
  'Sparks, NV': { closeMin: null },
  'Carson City, NV': { closeMin: 120 },

  // ── New Jersey (state default: null = no mandate) ──
  'Atlantic City, NJ': { closeMin: null, note: '24hr — no close time mandate' },
  'Jersey City, NJ': { closeMin: 120, note: 'Last call ~1:30am, 2am Fri/Sat' },
  'Newark, NJ': { closeMin: 120 },
  'Elizabeth, NJ': { closeMin: 120 },
  'Trenton, NJ': { closeMin: 120 },
  'Paterson, NJ': { closeMin: 120 },

  // ── South Carolina (state default: null = varies by county) ──
  'Charleston, SC': { closeMin: 120 },
  'Columbia, SC': { closeMin: 120 },
  'Greenville, SC': { closeMin: 120 },
  'Myrtle Beach, SC': { closeMin: 120 },
  'Spartanburg, SC': { closeMin: 120 },
  'Aiken, SC': { closeMin: 120 },

  // ── Texas (state default: null = varies by city) ──
  'Austin, TX': { closeMin: 120 },
  'Houston, TX': { closeMin: 0, note: 'Midnight Mon–Sat, 1am Sun (Harris County)' },
  'Dallas, TX': { closeMin: 120 },
  'San Antonio, TX': { closeMin: 120 },
  'Fort Worth, TX': { closeMin: 120 },
  'El Paso, TX': { closeMin: 120 },
  'Arlington, TX': { closeMin: 120 },
  'Corpus Christi, TX': { closeMin: 120 },
  'Plano, TX': { closeMin: 120 },
  'Lubbock, TX': { closeMin: 120 },
  'Irving, TX': { closeMin: 120 },
  'Garland, TX': { closeMin: 120 },
  'Frisco, TX': { closeMin: 120 },
  'McKinney, TX': { closeMin: 120 },
  'Amarillo, TX': { closeMin: 120 },
  'Grand Prairie, TX': { closeMin: 120 },
  'Brownsville, TX': { closeMin: 120 },
  'Killeen, TX': { closeMin: 120 },
  'Laredo, TX': { closeMin: 120 },
  'Pasadena, TX': { closeMin: 120 },
  'Beaumont, TX': { closeMin: 120 },
  'Antelope, TX': { closeMin: null }, // not a real city, skip
  'McAllen, TX': { closeMin: 120 },

  // ── City overrides for states with non-2am defaults ──
  // Georgia — state default is 2am but Atlanta is 2:30am
  'Atlanta, GA': { closeMin: 150, note: '2:30am; Underground Atlanta 4am' },
  'Augusta, GA': { closeMin: 120 },
  'Columbus, GA': { closeMin: 120 },
  'Savannah, GA': { closeMin: 180 }, // 3am from Wikipedia

  // Florida — Miami, Key West, Broward extend
  'Miami, FL': { closeMin: 300, note: '5am; Downtown Entertainment District 24hr' },
  'Jacksonville, FL': { closeMin: 120 },
  'Tampa, FL': { closeMin: 180 }, // 3am
  'St. Petersburg, FL': { closeMin: 180 }, // 3am
  'Key West, FL': { closeMin: 240 }, // 4am
  'Fort Lauderdale, FL': { closeMin: 240, note: 'Broward County 4am' },
  'Orlando, FL': { closeMin: 120 },
  'Tallahassee, FL': { closeMin: 120 },

  // Illinois — Chicago has 2am Sun–Fri, 3am Sat
  'Chicago, IL': { closeMin: 120, note: '2am Sun–Fri, 3am Sat; ext license 4am/5am' },
  'Bloomington, IL': { closeMin: 60, note: '1am weeknights, 2am weekends' },
  'Peoria, IL': { closeMin: 240, note: 'Downtown district 4am; other areas 1–2am' },
  'Champaign, IL': { closeMin: 120 },

  // Missouri
  'St. Louis, MO': { closeMin: 90, note: '1:30am standard, 3am in designated areas' },
  'Kansas City, MO': { closeMin: 90, note: '1:30am standard, 3am in designated areas' },
  'Springfield, MO': { closeMin: 90 },

  // Connecticut — 2am Fri/Sat, 1am Sun–Thu
  'Bridgeport, CT': { closeMin: 120 },
  'New Haven, CT': { closeMin: 120 },
  'Stamford, CT': { closeMin: 120 },
  'Hartford, CT': { closeMin: 120 },

  // Massachusetts — Boston 2am, but some towns earlier
  'Boston, MA': { closeMin: 120 },
  'Worcester, MA': { closeMin: 120 },
  'Springfield, MA': { closeMin: 120 },
  'Cambridge, MA': { closeMin: 120 },

  // New York — State law 4am; NYC, Albany, Buffalo, Saratoga at 4am; others vary
  'New York, NY': { closeMin: 240 }, // 4am
  'Buffalo, NY': { closeMin: 240, note: '4am; 24hr on holidays' },
  'Albany, NY': { closeMin: 240 }, // 4am
  'Rochester, NY': { closeMin: 120 }, // 2am
  'Syracuse, NY': { closeMin: 120 }, // 2am
  'Binghamton, NY': { closeMin: 180 }, // 3am
  'Saratoga Springs, NY': { closeMin: 240 }, // 4am
  'Elmira, NY': { closeMin: 60 }, // 1am
  'Geneva, NY': { closeMin: 60 }, // 1am
  'Ithaca, NY': { closeMin: 60 }, // 1am

  // Ohio
  'Cincinnati, OH': { closeMin: 135, note: 'Last call 2:15am, close 2:30am' },
  'Cleveland, OH': { closeMin: 150 }, // 2:30am
  'Columbus, OH': { closeMin: 150 }, // 2:30am
  'Dayton, OH': { closeMin: 120 },
  'Toledo, OH': { closeMin: 120 },
  'Akron, OH': { closeMin: 120 },

  // Colorado
  'Denver, CO': { closeMin: 120 },
  'Colorado Springs, CO': { closeMin: 120 },
  'Aurora, CO': { closeMin: 120 },
  'Fort Collins, CO': { closeMin: 120 },
  'Lakewood, CO': { closeMin: 120 },
  'Boulder, CO': { closeMin: 120 },

  // Wisconsin — 2am Sun–Thu, 2:30am Fri/Sat
  'Milwaukee, WI': { closeMin: 150, note: '2:30am standard' },
  'Madison, WI': { closeMin: 150 },
  'Green Bay, WI': { closeMin: 150 },

  // Indiana
  'Indianapolis, IN': { closeMin: 180 }, // 3am
  'Bloomington, IN': { closeMin: 180 }, // 3am
  'Fort Wayne, IN': { closeMin: 180 }, // 3am

  // Kentucky
  'Louisville, KY': { closeMin: 120, note: '2am standard, 4am with special license' },
  'Lexington, KY': { closeMin: 150 }, // 2:30am

  // Tennessee
  'Nashville, TN': { closeMin: 180 }, // 3am
  'Memphis, TN': { closeMin: 180 },
  'Knoxville, TN': { closeMin: 180 },
  'Chattanooga, TN': { closeMin: 180 },
  'Clarksville, TN': { closeMin: 180 },

  // West Virginia
  'Charleston, WV': { closeMin: 180 },
  'Huntington, WV': { closeMin: 180 },

  // Washington
  'Seattle, WA': { closeMin: 120 },
  'Spokane, WA': { closeMin: 120 },
  'Tacoma, WA': { closeMin: 120 },
  'Vancouver, WA': { closeMin: 120 },

  // Arizona
  'Phoenix, AZ': { closeMin: 120 },
  'Tucson, AZ': { closeMin: 120 },
  'Mesa, AZ': { closeMin: 120 },
  'Scottsdale, AZ': { closeMin: 120 },
  'Chandler, AZ': { closeMin: 120 },
  'Gilbert, AZ': { closeMin: 120 },
  'Glendale, AZ': { closeMin: 120 },
  'Tempe, AZ': { closeMin: 120 },

  // Oregon
  'Portland, OR': { closeMin: 150 }, // 2:30am

  // Pennsylvania
  'Philadelphia, PA': { closeMin: 120 },
  'Pittsburgh, PA': { closeMin: 120 },

  // Virginia
  'Virginia Beach, VA': { closeMin: 120 },
  'Norfolk, VA': { closeMin: 120 },
  'Chesapeake, VA': { closeMin: 120 },
  'Richmond, VA': { closeMin: 120 },
  'Newport News, VA': { closeMin: 120 },
  'Alexandria, VA': { closeMin: 120 },
  'Hampton, VA': { closeMin: 120 },
  'Arlington, VA': { closeMin: 120 },

  // North Carolina
  'Charlotte, NC': { closeMin: 120 },
  'Raleigh, NC': { closeMin: 120 },
  'Greensboro, NC': { closeMin: 120 },
  'Durham, NC': { closeMin: 120 },
  'Winston-Salem, NC': { closeMin: 120 },
  'Fayetteville, NC': { closeMin: 120 },

  // Utah
  'Salt Lake City, UT': { closeMin: 60 }, // 1am
  'Provo, UT': { closeMin: 60 },
  'West Valley City, UT': { closeMin: 60 },
  'West Jordan, UT': { closeMin: 60 },

  // Minnesota
  'Minneapolis, MN': { closeMin: 120 },
  'St. Paul, MN': { closeMin: 120 },

  // Nebraska
  'Omaha, NE': { closeMin: 120 },
  'Lincoln, NE': { closeMin: 120 },

  // Alabama
  'Birmingham, AL': { closeMin: 120 },
  'Montgomery, AL': { closeMin: 120 },
  'Mobile, AL': { closeMin: null, note: 'No close time for private club licenses' },

  // Mississippi
  'Jackson, MS': { closeMin: 0 }, // Midnight
  'Gulfport, MS': { closeMin: 0 },

  // New Mexico
  'Albuquerque, NM': { closeMin: 120 },

  // Iowa
  'Des Moines, IA': { closeMin: 120 },
  'Cedar Rapids, IA': { closeMin: 120 },

  // Arkansas
  'Little Rock, AR': { closeMin: 120 },

  // Oklahoma
  'Oklahoma City, OK': { closeMin: 120 },
  'Tulsa, OK': { closeMin: 120 },

  // Kansas
  'Wichita, KS': { closeMin: 120 },

  // Idaho
  'Boise, ID': { closeMin: 120 },
  'Meridian, ID': { closeMin: 120 },
  'Idaho Falls, ID': { closeMin: 120 },
  'Pocatello, ID': { closeMin: 120 },

  // Montana
  'Billings, MT': { closeMin: 90 },
  'Missoula, MT': { closeMin: 90 },
  'Great Falls, MT': { closeMin: 90 },

  // Alaska
  'Anchorage, AK': { closeMin: 300, note: '5am standard' },

  // Hawaii (state default 4am)
  'Urban Honolulu, HI': { closeMin: 240 }, // Honolulu CDP
  'Kailua, HI': { closeMin: 240 },

  // Rhode Island — Providence 2am Fri/Sat, 1am weeknights
  'Providence, RI': { closeMin: 120, note: '2am Fri/Sat & eves of holidays, else 1am' },
  'Warwick, RI': { closeMin: 60 },
  'Cranston, RI': { closeMin: 60 },

  // New Hampshire
  'Manchester, NH': { closeMin: 60 },
  'Nashua, NH': { closeMin: 60 },

  // Maine — no city over 100k, state default 1am applies

  // Vermont — no city over 100k, state default 2am applies

  // Wyoming — no city over 100k, state default 2am applies

  // Delaware — no city over 100k, state default 1am applies

  // West Virginia — Charleston covered above

  // South Dakota
  'Sioux Falls, SD': { closeMin: 120 },
  'Rapid City, SD': { closeMin: 120 },

  // North Dakota
  'Fargo, ND': { closeMin: 60 },
  'Grand Forks, ND': { closeMin: 60 },

  // New Jersey — additional cities
  'Edison, NJ': { closeMin: 120 },
  'Woodbridge, NJ': { closeMin: 120 },
  'Lakewood, NJ': { closeMin: 120 },

  // South Carolina — additional
  'North Charleston, SC': { closeMin: 120 },
  'Mount Pleasant, SC': { closeMin: 120 },
  'Rock Hill, SC': { closeMin: 120 },

  // Louisiana — additional
  'Metairie, LA': { closeMin: null }, // CDP; follows Orleans Parish or state default
  'Bossier City, LA': { closeMin: 120 },

  // Nevada — additional
  'North Las Vegas, NV': { closeMin: null },
  'Spring Valley, NV': { closeMin: null }, // CDP near Las Vegas
  'Enterprise, NV': { closeMin: null }, // CDP near Las Vegas
  'Paradise, NV': { closeMin: null }, // CDP near Las Vegas

  // Texas — additional
  'Tyler, TX': { closeMin: 120 },
  'Waco, TX': { closeMin: 120 },
  'Odessa, TX': { closeMin: 120 },
  'Midland, TX': { closeMin: 120 },
  'San Angelo, TX': { closeMin: 120 },
  'Longview, TX': { closeMin: 120 },
  'College Station, TX': { closeMin: 120 },
  'Bryan, TX': { closeMin: 120 },
  'Sugar Land, TX': { closeMin: 120 },
  'Pearland, TX': { closeMin: 120 },
  'Missouri City, TX': { closeMin: 120 },
  'Baytown, TX': { closeMin: 120 },
  'Pharr, TX': { closeMin: 120 },
  'Missions, TX': { closeMin: 120 },
  'Conroe, TX': { closeMin: 120 },
  'Huntsville, TX': { closeMin: 120 },
  'Texas City, TX': { closeMin: 120 },
}

/** Fallback close time when no state or city data is available. */
export const DEFAULT_CLOSE_MIN = 120 // 2:00 AM

/**
 * Look up the default close time for a city+state pair.
 * Returns minutes since midnight, or null if no mandate.
 */
export function getCityCloseMin(city: string, state: string): number | null {
  const cityKey = `${city}, ${state.toUpperCase()}`
  if (cityKey in CITY_CLOSE_TIMES) {
    return CITY_CLOSE_TIMES[cityKey].closeMin
  }
  return STATE_CLOSE_TIMES[state.toUpperCase()]?.closeMin ?? DEFAULT_CLOSE_MIN
}

/**
 * Look up the default close time for a US state code.
 * Returns minutes since midnight, or null if no statewide mandate.
 */
export function getStateCloseMin(stateCode: string): number | null {
  return STATE_CLOSE_TIMES[stateCode.toUpperCase()]?.closeMin ?? DEFAULT_CLOSE_MIN
}