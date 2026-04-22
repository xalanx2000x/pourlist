/**
 * US bar closing times — used for "late_night" HH window default end time.
 *
 * Source: https://en.wikipedia.org/wiki/Last_call
 * Covers state-level defaults; city-level overrides noted where significant.
 *
 * All times stored as minutes since midnight (e.g. 120 = 2:00 AM).
 * null = no statewide mandate (follow city/county rules or assume 2am default).
 *
 * Key conventions:
 * - Weekday default used for happy hour (Fri/Sat often extended)
 * - Special licenses (late-night, extended hours) ignored — use standard default
 * - States with null have no statewide mandate — caller's location must determine
 */

export type StateCloseTime = {
  closeMin: number | null   // minutes since midnight; null = no statewide default
  note?: string
}

// State → default close time (minutes since midnight)
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
  IL: { closeMin: 60, note: 'Varies by municipality; Chicago 2am (Sun–Fri) 3am (Sat)' },
  IN: { closeMin: 180 },
  IA: { closeMin: 120 },
  KS: { closeMin: 120 },
  KY: { closeMin: 120, note: 'Louisville has 4am licenses' },
  LA: { closeMin: null, note: 'No statewide mandate; New Orleans/Las Vegas 24hr' },
  ME: { closeMin: 60, note: '1am, 2am on New Year\'s Eve' },
  MD: { closeMin: 120 },
  MA: { closeMin: 120, note: 'Cities/towns may set earlier' },
  MI: { closeMin: 120, note: '4am on New Year\'s Eve' },
  MN: { closeMin: 120, note: 'Many cities restrict to 1am' },
  MS: { closeMin: 0, note: 'Midnight or 1am depending on city' },
  MO: { closeMin: 90, note: '1:30am; 3am in St. Louis & Kansas City' },
  MT: { closeMin: 90, note: '~1:30am; gas stations sell beer until 2am' },
  NE: { closeMin: 60, note: '1am; Omaha & Lincoln may go until 2am' },
  NV: { closeMin: null, note: 'No statewide mandate; Las Vegas 24hr' },
  NH: { closeMin: 60, note: 'Last call 12:45am, close 1:30am' },
  NJ: { closeMin: null, note: 'No statewide mandate; Atlantic City 24hr' },
  NM: { closeMin: 120, note: '2am Mon–Sat, midnight Sunday' },
  NY: { closeMin: 240, note: 'State law 4am; counties may set earlier (1–3am)' },
  NC: { closeMin: 120 },
  ND: { closeMin: 60, note: '1am; counties can opt up to 2am' },
  OH: { closeMin: 120, note: 'Some establishments 2:30am' },
  OK: { closeMin: 120 },
  OR: { closeMin: 150, note: '2:30am' },
  PA: { closeMin: 120, note: '2am taverns, 3am membership clubs' },
  RI: { closeMin: 60, note: '1am daily; Providence 2am Fri/Sat' },
  SC: { closeMin: null, note: 'Varies by county/municipality' },
  SD: { closeMin: 120 },
  TN: { closeMin: 180 },
  TX: { closeMin: 0, note: 'Varies by city/county; typically midnight or 2am' },
  UT: { closeMin: 60, note: 'Last call 1am, must close by 2am' },
  VT: { closeMin: 120, note: '3am on New Year\'s Eve' },
  VA: { closeMin: 120, note: 'Off-premises midnight' },
  WA: { closeMin: 120 },
  WV: { closeMin: 180 },
  WI: { closeMin: 150, note: '2am Sun–Thu, 2:30am Fri–Sat' },
  WY: { closeMin: 120 },
}

/** Fallback close time when no state data is available (2am). */
export const DEFAULT_CLOSE_MIN = 120

/**
 * Look up the default close time for a US state.
 * Returns minutes since midnight, or null if no statewide mandate.
 */
export function getStateCloseMin(stateCode: string): number | null {
  return STATE_CLOSE_TIMES[stateCode.toUpperCase()]?.closeMin ?? DEFAULT_CLOSE_MIN
}