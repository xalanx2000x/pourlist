export async function geocodeLocation(
  query: string
): Promise<{ lat: number; lng: number } | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', '1')

  try {
    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'PourList/1.0 (contact@pourlist.app)',
      },
    })

    if (!res.ok) {
      console.error('Nominatim geocode error:', res.status, await res.text())
      return null
    }

    const results = await res.json()
    if (!results || results.length === 0) {
      return null
    }

    const first = results[0]
    return {
      lat: parseFloat(first.lat),
      lng: parseFloat(first.lon),
    }
  } catch (err) {
    console.error('Nominatim geocode failed:', err)
    return null
  }
}
