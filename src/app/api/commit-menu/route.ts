import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!

/**
 * Derives the storage file path from a Supabase Storage public URL.
 */
function storagePathFromUrl(url: string): string {
  const match = url.match(/\/venue-photos\/(.+)$/)
  return match ? `venue-photos/${match[1]}` : ''
}

/**
 * HTML escape + strip crypto addresses from menu text.
 */
function sanitizeMenuText(text: string): string {
  return text
    .replace(/(?:0x[a-fA-F0-9]{38,42})/g, '')        // ETH/USDC/SOL — 38-42 hex chars
    .replace(/(?:bc1[a-z0-9]{39,89})/gi, '')          // Bitcoin bech32
    .replace(/(?:[13][a-zA-Z0-9]{24,33})/g, '')        // Bitcoin base58
    .replace(/(?:[LM][a-zA-Z0-9]{26,33})/g, '')        // Litecoin, Monero
    .replace(/(?:r[a-zA-Z0-9]{24,34})/g, '')          // Ripple
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * POST /api/commit-menu
 * Body: {
 *   venueId?: string        // existing venue id
 *   venueName?: string      // required if venueId not provided
 *   lat?: number
 *   lng?: number
 *   address?: string
 *   deviceHash: string
 *   menuText: string
 *   hhTime?: string
 *   photoUrls?: string[]     // pre-uploaded photo URLs
 *   photos?: File[]          // photo files to upload (FormData)
 *   venueIdForPhotos?: string // venue id to use for photo path if creating new venue
 * }
 *
 * This endpoint handles the full commit flow:
 * 1. Create venue if needed
 * 2. Upload photos to Supabase Storage
 * 3. Add photo set (with 4-set limit purge)
 * 4. Update venue menu_text + latest_menu_image_url
 */
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || ''

    let body: Record<string, unknown>
    let formData: FormData | null = null

    if (contentType.includes('multipart/form-data')) {
      formData = await req.formData()
      body = Object.fromEntries(formData.entries())
    } else {
      body = await req.json()
    }

    const {
      venueId,
      venueName,
      lat,
      lng,
      address,
      deviceHash,
      menuText,
      hhTime,
      photoUrls: existingPhotoUrls
    } = body as {
      venueId?: string
      venueName?: string
      lat?: number
      lng?: number
      address?: string
      deviceHash: string
      menuText: string
      hhTime?: string
      photoUrls?: string[]
      existingPhotoUrls?: string[]
    }

    // Validate menuText
    if (!menuText || typeof menuText !== 'string') {
      return NextResponse.json({ error: 'menuText is required' }, { status: 400 })
    }
    const sanitizedMenuText = sanitizeMenuText(menuText)
    if (sanitizedMenuText.length > 10000) {
      return NextResponse.json(
        { error: 'menuText exceeds maximum length of 10,000 characters' },
        { status: 400 }
      )
    }

    if (!deviceHash) {
      return NextResponse.json({ error: 'deviceHash is required' }, { status: 400 })
    }

    // Determine photoUrls to store
    let finalPhotoUrls: string[] = []

    // Use pre-uploaded photo URLs if provided
    if (Array.isArray(existingPhotoUrls)) {
      finalPhotoUrls = existingPhotoUrls
    }

    let targetVenueId = venueId

    // ── Step 1: Create venue if not existing ─────────────────────────────────
    if (!targetVenueId) {
      if (!venueName?.trim()) {
        return NextResponse.json(
          { error: 'venueName is required for new venues' },
          { status: 400 }
        )
      }

      const { data: newVenue, error: venueError } = await supabase
        .from('venues')
        .insert({
          name: venueName.trim(),
          lat: lat ?? null,
          lng: lng ?? null,
          address_backup: address ?? null,
          status: 'unverified',
          contributor_trust: 'new',
          zip: null,
          phone: null,
          website: null,
          type: null,
          menu_text: sanitizedMenuText.trim(),
          menu_text_updated_at: new Date().toISOString()
        })
        .select('id')
        .single()

      if (venueError) {
        console.error('commit-menu: venue insert error:', venueError)
        return NextResponse.json({ error: 'Failed to create venue' }, { status: 500 })
      }

      targetVenueId = newVenue.id
    } else {
      // ── Step 2: Update existing venue ─────────────────────────────────
      const updateFields: Record<string, unknown> = {
        menu_text: sanitizedMenuText.trim(),
        menu_text_updated_at: new Date().toISOString()
      }

      const { error: updateError } = await supabase
        .from('venues')
        .update(updateFields)
        .eq('id', targetVenueId)

      if (updateError) {
        console.error('commit-menu: venue update error:', updateError)
        return NextResponse.json({ error: 'Failed to update menu' }, { status: 500 })
      }
    }

    // ── Step 3: Upload photos (if files provided as multipart) ──────────────
    if (formData && targetVenueId) {
      const photoFiles = formData.getAll('photos') as File[]
      if (photoFiles.length > 0) {
        const uploadedUrls: string[] = []
        const timestamp = Date.now()

        for (let i = 0; i < photoFiles.length; i++) {
          const photo = photoFiles[i]
          if (!photo || typeof photo === 'string') continue

          const fileExt = (photo.name || 'jpg').split('.').pop() || 'jpg'
          const fileName = `${timestamp}-${i}-${Math.random().toString(36).slice(2)}.${fileExt}`
          const filePath = `venue-photos/${targetVenueId}/${timestamp}/${fileName}`

          const buffer = Buffer.from(await photo.arrayBuffer())

          const { error: uploadError } = await supabase.storage
            .from('venue-photos')
            .upload(filePath, buffer, {
              contentType: photo.type || 'image/jpeg',
              upsert: false
            })

          if (uploadError) {
            console.error('commit-menu: photo upload error:', uploadError)
            continue // Non-fatal — continue with other photos
          }

          const { data: urlData } = supabase.storage
            .from('venue-photos')
            .getPublicUrl(filePath)

          uploadedUrls.push(urlData.publicUrl)
        }

        finalPhotoUrls = uploadedUrls
      }
    }

    // ── Step 4: Add photo set ────────────────────────────────────────────────
    if (finalPhotoUrls.length > 0 && targetVenueId) {
      const { error: photoSetError } = await supabase
        .from('photo_sets')
        .insert({
          venue_id: targetVenueId,
          photo_urls: finalPhotoUrls
        })

      if (photoSetError) {
        console.error('commit-menu: photo_set insert error:', photoSetError)
        // Non-fatal — menu was saved
      }

      // ── Step 5: Purge oldest photo set if > 4 ────────────────────────────
      if (!photoSetError) {
        const { data: sets, error: countError } = await supabase
          .from('photo_sets')
          .select('id, created_at, photo_urls')
          .eq('venue_id', targetVenueId)
          .order('created_at', { ascending: false })

        if (!countError && sets && sets.length > 4) {
          const toDelete = sets.slice(4)
          const deleteIds = toDelete.map(s => s.id)

          // Collect storage paths to delete
          const storagePaths = toDelete
            .flatMap(s => s.photo_urls as string[])
            .map(url => storagePathFromUrl(url))
            .filter(p => p.length > 0)

          // Delete old photo set records
          await supabase
            .from('photo_sets')
            .delete()
            .in('id', deleteIds)

          // Delete old files from storage
          if (storagePaths.length > 0) {
            const uniquePaths = [...new Set(storagePaths)]
            await supabase.storage
              .from('venue-photos')
              .remove(uniquePaths)
          }
        }
      }

      // ── Step 6: Update latest_menu_image_url on venue ───────────────────
      await supabase
        .from('venues')
        .update({ latest_menu_image_url: finalPhotoUrls[0] })
        .eq('id', targetVenueId)
    }

    // ── Step 7: Clear all flags on this venue (menu committed = trust signal) ─
    await supabase.rpc('clear_flags_on_menu_commit', { p_venue_id: targetVenueId })

    // ── Step 8: Increment device submission count ──────────────────────────
    // Trust is tracked via submission count in device_stats.
    // Flags from devices with submission_count >= 10 count as "trusted" (2x weight)
    // at the database level — no code change needed here.
    await supabase.rpc('increment_device_submissions', { p_device_hash: deviceHash })

    return NextResponse.json({ venueId: targetVenueId, success: true })
  } catch (err) {
    console.error('commit-menu error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
