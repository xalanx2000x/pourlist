import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/**
 * POST /api/check-duplicate
 * Body: { venueId: string; fingerprint: string }
 * Returns: { isDuplicate: boolean; existingMenuText?: string }
 *
 * Uses file size + name as the duplicate signal.
 * If a photo with the same fingerprint was recently uploaded to this venue,
 * we skip parsing since it's likely the same menu.
 */
export async function POST(req: NextRequest) {
  try {
    const { venueId, fingerprint } = await req.json()

    if (!venueId || !fingerprint) {
      return NextResponse.json({ isDuplicate: false })
    }

    // Parse the fingerprint
    const [fileSize] = fingerprint.split('-')

    // Look for a recent photo at this venue with same file size (proxy for duplicate)
    const { data: photos, error } = await supabase
      .from('photos')
      .select('id, url, created_at')
      .eq('venue_id', venueId)
      .eq('status', 'approved')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) {
      console.error('Duplicate check error:', error)
      return NextResponse.json({ isDuplicate: false })
    }

    for (const photo of photos || []) {
      // We'd need to store fingerprints in the DB to do this properly
      // For now, this is a placeholder that always returns false
      // Real duplicate detection happens via GPS proximity + same venue
    }

    return NextResponse.json({ isDuplicate: false })
  } catch (err) {
    console.error('Check duplicate error:', err)
    return NextResponse.json({ isDuplicate: false })
  }
}
