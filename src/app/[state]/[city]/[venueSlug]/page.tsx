/**
 * /[state]/[city]/[venueSlug] — NEW SEO-friendly venue URL.
 *
 * Example: /ca/los-angeles/clydes-prime-rib
 *
 * Fetches by new_slug (/{state}/{city}/{venueSlug}), validates the state/city
 * segments match the venue's stored geo, falls back to old slug lookup on miss.
 *
 * noindex: venues with no happy hour data (hasHappyHourData controls the rest).
 */
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { supabaseServer } from '@/lib/supabase-server'
import { hasHappyHourData } from '@/lib/happy-hour-data'
import { venueSlug } from '@/lib/slug'
import { getHhLabel } from '@/lib/format-schedule'
import VenueLiveBadge from '@/components/VenueLiveBadge'
import { formatAddress, normalizeAddress } from '@/lib/format-address'
import { buildVenueTitle } from '@/lib/format-title'

const BASE_URL = 'https://pourlist.app'

// ─── Data fetch ────────────────────────────────────────────────────────────────

async function getVenueByNewSlug(state: string, city: string, venueSlug: string) {
  const newSlug = `/${state}/${city}/${venueSlug}`
  try {
    const { data } = await supabaseServer
      .from('venues')
      .select('*')
      .eq('new_slug', newSlug)
      .single()

    // Validate geo segments match the venue
    if (data && data.state?.toLowerCase() === state && data.city?.toLowerCase() === city) {
      return data
    }
    return null
  } catch {
    return null
  }
}

// Fallback: try old slug if new_slug lookup missed
async function getVenueByOldSlug(slug: string) {
  try {
    const { data } = await supabaseServer
      .from('venues')
      .select('*')
      .eq('slug', slug)
      .single()
    return data
  } catch {
    return null
  }
}

async function getVenue(state: string, city: string, venueSlug: string) {
  const v = await getVenueByNewSlug(state, city, venueSlug)
  if (v) return v
  // Fallback: maybe this slug is from the old format (for redirects from old URLs)
  return getVenueByOldSlug(venueSlug)
}

async function getAllIndexableVenues() {
  const { data } = await supabaseServer
    .from('venues')
    .select('id, new_slug, slug, name, hh_type, menu_text, hh_summary')
    .not('hh_type', 'is', null)

  if (!data) return []
  return data
    .filter(v => hasHappyHourData(v) && v.new_slug)
    .map(v => {
      const parts = v.new_slug!.split('/')
      return {
        state: parts[1] ?? '',
        city: parts[2] ?? '',
        venueSlug: parts[3] ?? '',
      }
    })
}

// ─── Static params ─────────────────────────────────────────────────────────

export async function generateStaticParams() {
  try {
    const venues = await getAllIndexableVenues()
    return venues
  } catch {
    return []
  }
}

export const dynamicParams = true
export const revalidate = 86_400

// ─── Metadata ──────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string; city: string; venueSlug: string }>
}): Promise<Metadata> {
  const { state, city, venueSlug } = await params
  const venue = await getVenue(state, city, venueSlug)
  if (!venue) return { title: 'Venue not found' }

  const indexable = hasHappyHourData(venue)
  const name = venue.name ?? 'Unknown Venue'
  const schedule = getHhLabel(venue)
  const description = schedule
    ? `${name} happy hour: ${schedule}. ${venue.menu_text ?? ''}`.trim()
    : `${name} — crowd-sourced happy hour directory.`

  const canonical = `${BASE_URL}${venue.new_slug ?? `/${state}/${city}/${venueSlug}`}`

  return {
    title: buildVenueTitle(venue),
    description: description.slice(0, 160),
    alternates: { canonical },
    openGraph: {
      title: schedule ? `${name} Happy Hour — ${schedule}` : name,
      description: description.slice(0, 160),
      images: [{
        url: venue.latest_menu_image_url ?? `${BASE_URL}/og-default.png`,
        width: 1200,
        height: 630,
      }],
    },
    robots: indexable ? {} : { index: false, follow: true },
  }
}

// ─── JSON-LD ────────────────────────────────────────────────────────────────

function buildJsonLd(venue: NonNullable<Awaited<ReturnType<typeof getVenue>>>, state: string, city: string, venueSlug: string) {
  const schemaType = venue.type === 'Restaurant' ? 'Restaurant' : 'BarOrPub'
  const url = `${BASE_URL}/${state}/${city}/${venueSlug}`

  const fields: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': schemaType,
    name: venue.name,
    url,
  }

  const cleanAddress = normalizeAddress(venue.address)
  if (cleanAddress) {
    fields.address = {
      '@type': 'PostalAddress',
      streetAddress: cleanAddress,
      addressLocality: venue.city ?? city,
      addressRegion: (venue.state ?? state).toUpperCase(),
      postalCode: venue.zip ?? '',
      addressCountry: 'US',
    }
  }

  if (venue.lat != null && venue.lng != null) {
    fields.geo = { '@type': 'GeoCoordinates', latitude: venue.lat, longitude: venue.lng }
  }

  if (venue.menu_text) {
    fields.description = venue.menu_text
  }

  return fields
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default async function NewVenuePage({
  params,
}: {
  params: Promise<{ state: string; city: string; venueSlug: string }>
}) {
  const { state, city, venueSlug } = await params
  const venue = await getVenue(state, city, venueSlug)
  if (!venue) notFound()

  const indexable = hasHappyHourData(venue)
  const schedule = getHhLabel(venue)
  const canonical = `${BASE_URL}${venue.new_slug ?? `/${state}/${city}/${venueSlug}`}`
  const jsonLd = buildJsonLd(venue, state, city, venueSlug)

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="min-h-screen bg-white dark:bg-gray-950">
        {/* Header */}
        <header className="border-b border-gray-200 bg-white dark:bg-gray-900 px-4 py-4">
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <a href="/" className="text-amber-600 hover:text-amber-700 font-semibold text-sm">
              ← PourList map
            </a>
            <VenueLiveBadge venue={venue} />
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            {venue.name}
          </h1>

          {formatAddress(venue) && (
            <p className="text-gray-500 text-sm mb-6">{formatAddress(venue)}</p>
          )}

          {indexable ? (
            <div className="space-y-6">
              {schedule && (
                <div>
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Happy Hour
                  </h2>
                  <p className="text-lg text-gray-900 dark:text-gray-100">{schedule}</p>
                </div>
              )}
              {venue.menu_text && (
                <div>
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Deals & Menu
                  </h2>
                  <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{venue.menu_text}</p>
                </div>
              )}
              {venue.lat != null && venue.lng != null && (
                <a
                  href={`/?venue=${venueSlug}`}
                  className="inline-flex items-center justify-center gap-2 w-full sm:w-auto bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold py-3 px-6 rounded-xl transition-colors shadow-sm"
                >
                  📍 View on map
                </a>
              )}
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
              <p className="text-gray-900 font-semibold mb-1.5 text-base">
                No happy hour here yet — be the first!
              </p>
              <p className="text-gray-700 text-sm mb-5">
                Snap a photo of the menu and you&apos;ll put{' '}
                <span className="font-medium">{venue.name}</span> on the map for everyone.
              </p>
              <a
                href={`/?venue=${venueSlug}`}
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold py-3 px-6 rounded-xl transition-colors shadow-sm"
              >
                📷 Scan Menu
              </a>
            </div>
          )}
        </main>
      </div>
    </>
  )
}
