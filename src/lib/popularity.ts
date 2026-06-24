/**
 * popularityScore: primarily venue views, with a recency tiebreaker so new
 * venues aren't buried. Designed so a search-demand weight can be added later.
 *
 * viewCount: from venue_view events in the last 30 days (captured at fetch time)
 * lastVerifiedAge: days since last_verified (null = use created_at)
 *
 * Score = views * 100 + recencyBonus
 * recencyBonus = max(0, 30 - ageInDays) — newer venues get up to +30 extra points
 *
 * This means:
 *   1 view + very recent = ~131
 *   10 views + 30+ days old = 1000
 *   100 views + 0 days old = 10030
 */
export function popularityScore(
  viewCount: number,
  lastVerified: string | null,
  createdAt: string
): number {
  const refDate = lastVerified ?? createdAt
  const ageMs = Date.now() - new Date(refDate).getTime()
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  const recencyBonus = Math.max(0, 30 - ageDays)
  return viewCount * 100 + recencyBonus
}

/**
 * Fetch view counts for a set of venue IDs (last 30 days).
 * Returns a map of venueId → viewCount.
 */
export async function fetchViewCounts(
  venueIds: string[],
  supabase: import('@supabase/supabase-js').SupabaseClient
): Promise<Record<string, number>> {
  if (venueIds.length === 0) return {}

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data } = await supabase
    .from('events')
    .select('venue_id')
    .eq('event_name', 'venue_view')
    .in('venue_id', venueIds)
    .gte('created_at', thirtyDaysAgo)

  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    if (!row.venue_id) continue
    counts[row.venue_id] = (counts[row.venue_id] ?? 0) + 1
  }
  return counts
}
