/**
 * HH time logic lives in hh-state.ts (resolveHH).
 * This file re-exports the helpers that CityPageClient needs.
 */
import { hasActiveHappyHour, resolveHH, formatMin } from '@/lib/hh-state'
export { hasActiveHappyHour, resolveHH, formatMin }
export const minsSinceMidnightInTz = () => { throw new Error('minsSinceMidnightInTz moved to hh-state.ts') }
export const currentISOWeekdayInTz = () => { throw new Error('currentISOWeekdayInTz moved to hh-state.ts') }
export const isLegacyHhTimeActive = () => { throw new Error('isLegacyHhTimeActive moved to hh-state.ts') }
export const isWindowActive = () => { throw new Error('isWindowActive moved to hh-state.ts') }
