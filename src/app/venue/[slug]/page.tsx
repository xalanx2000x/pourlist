/**
 * /venue/[slug] — OLD venue URL format.
 *
 * This route acts as a redirector when the venue has a new_slug,
 * and falls back to rendering the old-style page when it doesn't
 * (OSM seed venues, or venues not yet re-slugged in Phase 3).
 */
import { notFound, redirect } from 'next/navigation'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { venueSlug } from '@/lib/slug'
import { hasHappyHourData } from '@/lib/happy-hour-data'
import { getHhLabel } from '@/lib/format-schedule'
import VenueLiveBadge from '@/components/VenueLiveBadge'
import { formatAddress, normalizeAddress } from '@/lib/format-address'
import { buildVenueTitle } from '@/lib/format-title'

const BASE_URL = 'https://pourlist.app'

async function getVenueBySlug(slug: string) {
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<import('next').Metadata> {
  const { slug } = await params
  const venue = await getVenueBySlug(slug)
  if (!venue) return { title: 'Venue not found' }

  const indexable = hasHappyHourData(venue)
  const name = venue.name ?? 'Unknown Venue'
  const schedule = getHhLabel(venue)
  const description = schedule
    ? `${name} happy hour: ${schedule}. ${venue.menu_text ?? ''}`.trim()
    : `${name} — crowd-sourced happy hour directory for Portland, Oregon.`

  const slugStr = venue.slug ?? venueSlug(venue)
  const canonical = `${BASE_URL}/venue/${slugStr}`

  // noindex when: needs_geo_review (geo-incomplete/limbo) OR venue has no happy hour data
  const noIndex = venue.needs_geo_review || !indexable

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
    ...(noIndex ? { robots: { index: false, follow: true } } : {}),
  }
}

function buildJsonLd(venue: NonNullable<Awaited<ReturnType<typeof getVenueBySlug>>>) {
  const schemaType = venue.type === 'Restaurant' ? 'Restaurant' : 'BarOrPub'
  const slug = venue.slug ?? venueSlug(venue)
  const url = `${BASE_URL}/venue/${slug}`

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
      addressLocality: venue.city ?? 'Portland',
      addressRegion: venue.state ?? 'OR',
      postalCode: venue.zip ?? '',
      addressCountry: 'US',
    }
  }

  if (venue.lat != null && venue.lng != null) {
    fields.geo = { '@type': 'GeoCoordinates', latitude: venue.lat, longitude: venue.lng }
  }

  if (venue.menu_text) fields.description = venue.menu_text

  return fields
}

export default async function VenuePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const venue = await getVenueBySlug(slug)
  if (!venue) notFound()

  // If venue has a new_slug, redirect permanently (301) to the new URL.
  // Uses NextResponse to force 301 — Next.js redirect() defaults to 307/308.
  if (venue.new_slug) {
    return NextResponse.redirect(new URL(venue.new_slug, BASE_URL), 301)
  }

  const indexable = hasHappyHourData(venue)
  const schedule = getHhLabel(venue)
  const slugStr = venue.slug ?? venueSlug(venue)
  const jsonLd = buildJsonLd(venue)

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="min-h-screen bg-white dark:bg-gray-950">
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
                  href={`/?venue=${slugStr}`}
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
                href={`/?venue=${slugStr}`}
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
