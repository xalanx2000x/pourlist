/**
 * /venue/[slug] — statically-generated venue page.
 *
 * generateStaticParams pre-renders only indexable venues (those with actual
 * HH data or menu text). Non-indexable slugs still resolve on demand
 * (dynamicParams = true) so shared links don't 404.
 *
 * Server HTML = the permanent schedule only. The live "HH is active now"
 * badge lives in VenueLiveBadge.tsx ('use client') and hydrates after load.
 */
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { supabaseServer } from '@/lib/supabase-server'
import { isIndexable } from '@/lib/is-indexable'
import { venueSlug } from '@/lib/slug'
import { getHhLabel } from '@/lib/format-schedule'
import VenueLiveBadge from '@/components/VenueLiveBadge'
import { formatAddress } from '@/lib/format-address'

const BASE_URL = 'https://pourlist.app'

// ─── Data fetch ────────────────────────────────────────────────────────────────

async function getVenueBySlug(slug: string) {
  try {
    const { data } = await supabaseServer
      .from('venues')
      .select('*')
      .eq('slug', slug)
      .single()
    return data
  } catch {
    // Migration not yet applied — fall back to computing slug from name.
    // We won't find it this way, but the error handling below will
    // produce a proper 404 instead of a 500.
    return null
  }
}

async function getAllIndexableVenues() {
  // Fetch only venues that have something worth indexing.
  // The service-role client bypasses RLS so we get all rows.
  const { data } = await supabaseServer
    .from('venues')
    .select('id, slug, name, hh_type, menu_text, hh_summary')
    .not('hh_type', 'is', null)
    .order('name')

  if (!data) return []
  // isIndexable is true whenever hh_type is set, but also include
  // venues with menu_text or hh_summary even if hh_type is null.
  return data.filter(v => isIndexable(v))
}

// ─── Static params ─────────────────────────────────────────────────────────

export async function generateStaticParams() {
  try {
    const venues = await getAllIndexableVenues()
    return venues.map(v => ({ slug: v.slug ?? venueSlug(v) }))
  } catch {
    // Migration not yet applied — slug column doesn't exist.
    // Return empty; the route falls back to dynamic rendering (dynamicParams=true).
    return []
  }
}

export const dynamicParams = true
export const revalidate = 86_400 // ISR: rebuild once per day

// ─── Metadata ──────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const venue = await getVenueBySlug(slug)
  if (!venue) return { title: 'Venue not found' }

  const indexable = isIndexable(venue)
  const name = venue.name ?? 'Unknown Venue'
  const schedule = getHhLabel(venue)
  const description = schedule
    ? `${name} happy hour: ${schedule}. ${venue.menu_text ?? ''}`.trim()
    : `${name} — crowd-sourced happy hour directory for Portland, Oregon.`

  const canonical = `${BASE_URL}/venue/${venue.slug ?? venueSlug(venue)}`
  const ogImage = venue.latest_menu_image_url ?? `${BASE_URL}/og-default.png`

  return {
    title: schedule
      ? `${name} Happy Hour — ${schedule} | PourList`
      : `${name} | PourList`,
    description: description.slice(0, 160),
    alternates: { canonical },
    openGraph: {
      title: schedule
        ? `${name} Happy Hour — ${schedule}`
        : name,
      description: description.slice(0, 160),
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    ...(indexable
      ? {}
      : { robots: { index: false, follow: true } }),
  }
}

// ─── JSON-LD ────────────────────────────────────────────────────────────────

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

  if (venue.address) {
    fields.address = {
      '@type': 'PostalAddress',
      streetAddress: venue.address,
      addressLocality: 'Portland',
      addressRegion: 'OR',
      postalCode: venue.zip ?? '',
      addressCountry: 'US',
    }
  }

  if (venue.lat != null && venue.lng != null) {
    fields.geo = {
      '@type': 'GeoCoordinates',
      latitude: venue.lat,
      longitude: venue.lng,
    }
  }

  if (venue.menu_text) {
    fields.description = venue.menu_text
  }

  return fields
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default async function VenuePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const venue = await getVenueBySlug(slug)
  if (!venue) notFound()

  const indexable = isIndexable(venue)
  const schedule = getHhLabel(venue)
  const slug2 = venue.slug ?? venueSlug(venue)
  const canonical = `${BASE_URL}/venue/${slug2}`
  const jsonLd = buildJsonLd(venue)

  return (
    <>
      {/* JSON-LD structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

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
          {/* Venue name */}
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            {venue.name}
          </h1>

          {/* Address */}
          {formatAddress(venue) && (
            <p className="text-gray-500 text-sm mb-6">
              {formatAddress(venue)}
            </p>
          )}

          {/* Indexable: full schedule + deal */}
          {indexable ? (
            <div className="space-y-6">
              {schedule && (
                <div>
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Happy Hour
                  </h2>
                  <p className="text-lg text-gray-900 dark:text-gray-100">
                    {schedule}
                  </p>
                </div>
              )}

              {venue.menu_text && (
                <div>
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Deals & Menu
                  </h2>
                  <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                    {venue.menu_text}
                  </p>
                </div>
              )}

              {/* View on map CTA — completes the share loop: shared link → venue page → into the map. */}
              {venue.lat != null && venue.lng != null && (
                <a
                  href={`/?venue=${slug2}`}
                  className="inline-flex items-center justify-center gap-2 w-full sm:w-auto bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold py-3 px-6 rounded-xl transition-colors shadow-sm"
                >
                  📍 View on map
                </a>
              )}
            </div>
          ) : (
            /* Non-indexable: lighter page */
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
              <p className="text-gray-700 mb-4">
                We don't have this venue's happy hour yet.
              </p>
              <a
                href="/"
                className="inline-flex items-center gap-2 text-sm font-semibold text-amber-600 hover:text-amber-700"
              >
                🏠 Know the happy hour? Add it →
              </a>
            </div>
          )}
        </main>
      </div>
    </>
  )
}
