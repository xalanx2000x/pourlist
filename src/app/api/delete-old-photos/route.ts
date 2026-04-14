/**
 * POST /api/delete-old-photos
 *
 * Multi-mode photo deletion endpoint for The Pour List.
 *
 * MODE 1 — Time-based cleanup (legacy 48h, via query params):
 *   POST /api/delete-old-photos
 *   Deletes photos and storage files older than 48 hours.
 *
 * MODE 2 — Per-venue photo cycling (called by upload-photo after new insert):
 *   POST /api/delete-old-photos  body: { photoIds: string[], paths: string[] }
 *   Deletes the specific DB records and storage files passed in.
 *   photoIds: array of UUIDs from the photos table
 *   paths:    array of storage file paths (e.g. "venue-photos/abc.jpg")
 *
 * MODE 3 — Venue-specific retention cleanup (cron fallback):
 *   POST /api/delete-old-photos  body: { venueId: string }
 *   Calls cycle_old_photos() for the given venue via RPC, then deletes
 *   the orphaned storage files.
 *
 * GET /api/delete-old-photos  →  dry-run mode (returns what would be deleted)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const STORAGE_BUCKET = 'venue-photos'
const MAX_AGE_HOURS = 48

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts the storage file path from a Supabase Storage public URL.
 * "https://xxx.supabase.co/storage/v1/object/public/venue-photos/abc.jpg"
 *   → "venue-photos/abc.jpg"
 */
function storagePathFromUrl(url: string): string {
  const match = url.match(/\/venue-photos\/(.+)$/)
  return match ? `venue-photos/${match[1]}` : ''
}

/**
 * Extracts the filename (without bucket prefix) from a storage path or URL.
 * "venue-photos/abc.jpg" → "abc.jpg"
 * "https://..."           → filename extracted from URL
 */
function fileNameFromPathOrUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('http')) {
    const match = pathOrUrl.match(/\/venue-photos\/(.+)$/)
    return match ? match[1] : pathOrUrl
  }
  const parts = pathOrUrl.split('/')
  return parts[parts.length - 1]
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — actual deletion
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const dryRun = searchParams.get('dryrun') === 'true'

    // ── Parse request body ────────────────────────────────────────────────────
    let body: {
      photoIds?: string[]
      paths?: string[]
      venueId?: string
    } = {}
    try {
      body = await req.json()
    } catch {
      // No body — fall through to time-based cleanup
    }

    // ── MODE 2: Specific photo IDs / paths (per-venue cycling) ──────────────
    if (body.photoIds?.length || body.paths?.length) {
      return handleSpecificDeletions(body.photoIds ?? [], body.paths ?? [], dryRun)
    }

    // ── MODE 3: Per-venue cycling via cycle_old_photos() ─────────────────────
    if (body.venueId) {
      return handleVenueCycling(body.venueId, dryRun)
    }

    // ── MODE 1: Legacy time-based (48h) cleanup ─────────────────────────────
    return handleTimeBasedCleanup(dryRun)

  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE 2: Delete specific photos by ID + storage paths
// ─────────────────────────────────────────────────────────────────────────────

async function handleSpecificDeletions(
  photoIds: string[],
  paths: string[],
  dryRun: boolean
) {
  // 1. Delete DB records by ID
  if (photoIds.length > 0 && !dryRun) {
    await supabaseAdmin
      .from('photos')
      .delete()
      .in('id', photoIds)
  }

  // 2. Delete storage files by path
  if (paths.length > 0 && !dryRun) {
    await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .remove(paths)
  }

  return NextResponse.json({
    mode: 'specific',
    dryRun,
    dbDeletedCount: dryRun ? 0 : photoIds.length,
    storageDeletedCount: dryRun ? 0 : paths.length,
    message: dryRun
      ? `Would delete ${photoIds.length} DB records and ${paths.length} storage files`
      : `Deleted ${photoIds.length} DB records and ${paths.length} storage files`,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE 3: Per-venue cycling — calls cycle_old_photos() then cleans storage
// ─────────────────────────────────────────────────────────────────────────────

async function handleVenueCycling(venueId: string, dryRun: boolean) {
  // Call the RPC to delete old DB records and get storage paths back
  const { data: deletedRows, error: rpcError } = await supabaseAdmin
    .rpc('cycle_old_photos', { p_venue_id: venueId })

  if (rpcError) {
    return NextResponse.json(
      { error: `cycle_old_photos RPC failed: ${rpcError.message}` },
      { status: 500 }
    )
  }

  const rows = (deletedRows ?? []) as Array<{ deleted_id: string; storage_path: string }>
  if (rows.length === 0) {
    return NextResponse.json({ mode: 'venue-cycling', dryRun, deletedCount: 0, message: 'No photos beyond 3 most recent' })
  }

  const photoIds = rows.map(r => r.deleted_id).filter(Boolean)
  const storagePaths = rows
    .map(r => r.storage_path)
    .filter(Boolean)
    .map(storagePathFromUrl)
    .filter(p => p.length > 0)

  // Storage deletion
  if (!dryRun && storagePaths.length > 0) {
    const { error: storageError } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .remove(storagePaths)

    if (storageError) {
      console.error('Storage cleanup error during venue cycling:', storageError)
      // Non-fatal — DB records are already gone
    }
  }

  return NextResponse.json({
    mode: 'venue-cycling',
    dryRun,
    deletedDbCount: dryRun ? 0 : photoIds.length,
    deletedStorageCount: dryRun ? 0 : storagePaths.length,
    message: dryRun
      ? `Would delete ${photoIds.length} DB records and ${storagePaths.length} storage files for venue ${venueId}`
      : `Cycled venue ${venueId}: deleted ${photoIds.length} DB records and ${storagePaths.length} storage files`,
    deletedPhotoIds: photoIds,
    deletedStoragePaths: storagePaths,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE 1: Legacy time-based cleanup (48h)
// ─────────────────────────────────────────────────────────────────────────────

async function handleTimeBasedCleanup(dryRun: boolean) {
  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000)

  // 1. List all files in venue-photos storage
  const { data: files, error: listError } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .list('', { limit: 1000, sortBy: { column: 'created_at', order: 'asc' } })

  if (listError) {
    return NextResponse.json({ error: `Storage list failed: ${listError.message}` }, { status: 500 })
  }

  if (!files || files.length === 0) {
    return NextResponse.json({ deletedCount: 0, message: 'No files found in storage' })
  }

  // 2. Filter to files older than MAX_AGE_HOURS
  const oldFiles = (files as Array<{ name: string; created_at: string }>).filter(
    f => f.created_at && new Date(f.created_at) < cutoff
  )

  if (oldFiles.length === 0) {
    return NextResponse.json({ deletedCount: 0, message: 'No files older than 48 hours' })
  }

  // 3. Find matching DB records by extracting filename from the `url` column.
  //    The photos.url field is a full Supabase Storage public URL, e.g.:
  //    https://xxx.supabase.co/storage/v1/object/public/venue-photos/abc.jpg
  const oldFileNames = oldFiles.map(f => f.name)

  const { data: photoRecords, error: dbError } = await supabaseAdmin
    .from('photos')
    .select('id, url')
    .not('url', 'eq', '') // guard against empty URLs

  if (dbError) {
    return NextResponse.json({ error: `DB query failed: ${dbError.message}` }, { status: 500 })
  }

  // Match DB records to old files by filename
  const matchedRecords = (photoRecords ?? []).filter((p: { id: string; url: string }) => {
    const fileName = fileNameFromPathOrUrl(p.url)
    return oldFileNames.includes(fileName)
  })
  const matchedIds = matchedRecords.map((p: { id: string }) => p.id)

  // 4. Delete from storage
  if (!dryRun) {
    const { error: storageDeleteError } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .remove(oldFileNames)

    if (storageDeleteError) {
      return NextResponse.json(
        { error: `Storage delete failed: ${storageDeleteError.message}` },
        { status: 500 }
      )
    }
  }

  // 5. Delete DB records
  if (!dryRun && matchedIds.length > 0) {
    const { error: dbDeleteError } = await supabaseAdmin
      .from('photos')
      .delete()
      .in('id', matchedIds)

    if (dbDeleteError) {
      return NextResponse.json(
        { error: `DB delete failed: ${dbDeleteError.message}`, storageDeletedCount: oldFiles.length },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({
    mode: 'time-based',
    dryRun,
    deletedCount: dryRun ? 0 : matchedIds.length,
    storageDeletedCount: dryRun ? 0 : oldFiles.length,
    message: dryRun
      ? `Would delete ${oldFiles.length} storage files and ${matchedIds.length} DB records`
      : `Deleted ${matchedIds.length} DB records and ${oldFiles.length} storage files`,
    files: dryRun ? oldFiles.map(f => ({ name: f.name, createdAt: f.created_at })) : undefined,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// GET → dry-run of time-based cleanup (convenience endpoint)
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  url.searchParams.set('dryrun', 'true')
  const dryRunReq = new NextRequest(url.toString(), { method: 'POST' })
  return POST(dryRunReq)
}
