'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/* ──────────────────────────────────────────────────────────────────────────
 * Types
 * ────────────────────────────────────────────────────────────────────────── */

type Mode = 'new' | 'edit' | 'graduate' | 'geocode'

interface VenueRow {
  id: string
  name: string
  address: string | null
  lat: number | null
  lng: number | null
  city: string | null
  state: string | null
  neighborhood: string | null
  zip: string | null
  country: string | null
  street: string | null
  phone: string | null
  website: string | null
  type: string | null
  status: string
  is_seed_data: boolean
  slug: string | null
  new_slug: string | null
  last_verified: string | null
  timezone: string | null
  menu_text: string | null
  // HH
  hh_time: string | null
  hh_summary: string | null
  hh_type: string | null
  hh_days: string | null
  hh_exclude_days: string | null
  hh_start: number | null
  hh_end: number | null
  hh_type_2: string | null
  hh_days_2: string | null
  hh_exclude_days_2: string | null
  hh_start_2: number | null
  hh_end_2: number | null
  hh_type_3: string | null
  hh_days_3: string | null
  hh_exclude_days_3: string | null
  hh_start_3: number | null
  hh_end_3: number | null
  opening_min: number | null
  latest_menu_image_url: string | null
}

interface SearchResult {
  id: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  status: string
  is_seed_data: boolean
  lat: number | null
  lng: number | null
  slug: string | null
  new_slug: string | null
  last_verified: string | null
}

interface GeocodeResult {
  place_name: string
  street: string | null
  city: string | null
  state: string | null
  neighborhood: string | null
  country: string | null
  zip: string | null
}

/* ──────────────────────────────────────────────────────────────────────────
 * Day helpers — ISO weekday (1=Mon … 7=Sun). hh_days / hh_exclude_days
 * are comma-separated ISO weekday strings, matching submit-venue's format.
 * ────────────────────────────────────────────────────────────────────────── */

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const DAY_VALUES = [1, 2, 3, 4, 5, 6, 7] as const

function parseDayCsv(s: string | null | undefined): Set<number> {
  if (!s) return new Set()
  return new Set(
    s.split(',')
      .map(x => parseInt(x.trim(), 10))
      .filter(n => n >= 1 && n <= 7)
  )
}

function dayCsvFromSet(set: Set<number>): string {
  // Always emit in 1..7 order — easier to read in DB dumps
  return DAY_VALUES.filter(d => set.has(d)).join(',')
}

/* ──────────────────────────────────────────────────────────────────────────
 * Time helpers — UI uses HH:MM strings; DB uses minutes since midnight.
 * ────────────────────────────────────────────────────────────────────────── */

function minToHHMM(min: number | null | undefined): string {
  if (min == null || isNaN(min)) return ''
  const m = ((min % (24 * 60)) + 24 * 60) % (24 * 60)
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function hhmmToMin(s: string): number | null {
  if (!s) return null
  const m = s.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = parseInt(m[1], 10)
  const mm = parseInt(m[2], 10)
  if (isNaN(h) || isNaN(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) return null
  return h * 60 + mm
}

/* ──────────────────────────────────────────────────────────────────────────
 * Window component — one HH window editor.
 * ────────────────────────────────────────────────────────────────────────── */

interface WindowProps {
  index: 1 | 2 | 3
  type: string
  days: Set<number>
  excludeDays: Set<number>
  start: string // HH:MM
  end: string
  disabled?: boolean
  onChange: (next: Partial<{ type: string; days: Set<number>; excludeDays: Set<number>; start: string; end: string }>) => void
}

function HhWindow({ index, type, days, excludeDays, start, end, disabled, onChange }: WindowProps) {
  function toggleDay(d: number) {
    if (disabled) return
    const next = new Set(days)
    if (next.has(d)) next.delete(d)
    else next.add(d)
    // Mutual exclusion with exclude set: if user picked it as include, drop it from exclude.
    const exNext = new Set(excludeDays)
    exNext.delete(d)
    onChange({ days: next, excludeDays: exNext })
  }

  function toggleExclude(d: number) {
    if (disabled) return
    const next = new Set(excludeDays)
    if (next.has(d)) next.delete(d)
    else next.add(d)
    const dayNext = new Set(days)
    dayNext.delete(d)
    onChange({ days: dayNext, excludeDays: next })
  }

  const excludeMode = type === 'late_night' || type === 'all_day'

  return (
    <fieldset
      disabled={disabled}
      className="border border-neutral-200 rounded p-3 mb-3 disabled:opacity-50"
    >
      <legend className="text-xs font-semibold text-neutral-700 px-1">
        Window {index}
      </legend>

      <div className="flex flex-wrap gap-2 mb-2">
        <label className="text-xs text-neutral-700">
          <span className="block mb-0.5">Type</span>
          <select
            value={type}
            onChange={(e) => onChange({ type: e.target.value })}
            className="text-sm border border-neutral-300 rounded px-2 py-1"
          >
            <option value="">(none)</option>
            <option value="typical">typical</option>
            <option value="late_night">late_night</option>
            <option value="all_day">all_day</option>
          </select>
        </label>

        <label className="text-xs text-neutral-700">
          <span className="block mb-0.5">Start (HH:MM 24h)</span>
          <input
            type="text"
            inputMode="numeric"
            value={start}
            placeholder="14:00"
            onChange={(e) => onChange({ start: e.target.value })}
            className="text-sm border border-neutral-300 rounded px-2 py-1 w-28"
          />
        </label>

        <label className="text-xs text-neutral-700">
          <span className="block mb-0.5">End (HH:MM 24h)</span>
          <input
            type="text"
            inputMode="numeric"
            value={end}
            placeholder="18:00"
            onChange={(e) => onChange({ end: e.target.value })}
            className="text-sm border border-neutral-300 rounded px-2 py-1 w-28"
          />
        </label>
      </div>

      <div className="mb-2">
        <p className="text-xs text-neutral-700 mb-1">
          {excludeMode ? 'Excluded days' : 'Active days'}
        </p>
        <div className="flex flex-wrap gap-1">
          {DAY_VALUES.map((d, i) => {
            const isInclude = days.has(d)
            const isExclude = excludeDays.has(d)
            return (
              <button
                key={d}
                type="button"
                onClick={() => (excludeMode ? toggleExclude(d) : toggleDay(d))}
                className={`text-xs px-2 py-1 rounded border ${
                  isInclude || isExclude
                    ? 'bg-amber-500 border-amber-600 text-white'
                    : 'bg-white border-neutral-300 text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                {DAY_LABELS[i]}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-neutral-500 mt-1">
          {excludeMode
            ? 'late_night/all_day: tap days to EXCLUDE (empty = every day)'
            : 'typical: tap days that are ACTIVE (empty = every day)'}
        </p>
      </div>
    </fieldset>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
 * Mode picker
 * ────────────────────────────────────────────────────────────────────────── */

function ModeTabs({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const tabs: Array<{ key: Mode; label: string }> = [
    { key: 'new', label: 'New' },
    { key: 'edit', label: 'Edit' },
    { key: 'graduate', label: 'Graduate seed' },
    { key: 'geocode', label: 'Geocode' },
  ]
  return (
    <div className="flex gap-1 mb-4 border-b border-neutral-200">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
            mode === t.key
              ? 'border-amber-600 text-amber-700'
              : 'border-transparent text-neutral-600 hover:text-neutral-900'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
 * Venue picker (used by EDIT, GRADUATE, GEOCODE)
 * ────────────────────────────────────────────────────────────────────────── */

function VenuePicker({
  filter,
  onPick,
}: {
  filter: 'all' | 'seed'
  onPick: (v: SearchResult) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim().length < 2) {
      setResults([])
      setError(null)
      return
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/seed/search?q=${encodeURIComponent(query.trim())}`)
        const data = await res.json()
        if (!res.ok) {
          setError(data?.reason ?? 'search_failed')
          setResults([])
        } else {
          let rows = (data.venues as SearchResult[]) ?? []
          if (filter === 'seed') rows = rows.filter(r => r.is_seed_data)
          setResults(rows)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, filter])

  return (
    <div className="bg-white border border-neutral-200 rounded p-4 mb-4">
      <label className="block text-xs font-medium text-neutral-700 mb-1">
        Search venue by name
      </label>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Type at least 2 characters…"
        className="w-full px-3 py-2 text-sm border border-neutral-300 rounded focus:outline-none focus:ring-2 focus:ring-amber-500"
      />
      {loading && <p className="mt-2 text-xs text-neutral-500">Searching…</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {!loading && query.trim().length >= 2 && results.length === 0 && (
        <p className="mt-2 text-xs text-neutral-500">No matches.</p>
      )}
      {results.length > 0 && (
        <ul className="mt-2 divide-y divide-neutral-100 max-h-96 overflow-y-auto">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPick(r)}
                className="w-full text-left px-2 py-2 hover:bg-amber-50 rounded"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-neutral-900">{r.name}</span>
                  <StatusBadge status={r.status} isSeed={r.is_seed_data} />
                </div>
                <div className="text-xs text-neutral-600">
                  {[r.address, r.city, r.state].filter(Boolean).join(', ') || '(no address)'}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function StatusBadge({ status, isSeed }: { status: string; isSeed: boolean }) {
  const styles: Record<string, string> = {
    verified: 'bg-green-100 text-green-800',
    stale: 'bg-yellow-100 text-yellow-800',
    unverified: 'bg-neutral-100 text-neutral-700',
    closed: 'bg-red-100 text-red-800',
  }
  const cls = styles[status] ?? styles.unverified
  return (
    <span className="inline-flex gap-1">
      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${cls}`}>{status}</span>
      {isSeed && (
        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-purple-100 text-purple-800">
          seed
        </span>
      )}
    </span>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
 * Main tool
 * ────────────────────────────────────────────────────────────────────────── */

export default function SeedTool({
  initialMode,
  initialVenueId,
}: {
  initialMode: Mode
  initialVenueId: string | null
}) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [loaded, setLoaded] = useState<VenueRow | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadingVenue, setLoadingVenue] = useState(false)

  // Form state
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [showCoords, setShowCoords] = useState(false)
  const [city, setCity] = useState<string>('')
  const [stateCode, setStateCode] = useState<string>('')
  const [neighborhood, setNeighborhood] = useState<string>('')
  const [zip, setZip] = useState<string>('')
  const [country, setCountry] = useState<string>('')
  const [phone, setPhone] = useState('')
  const [website, setWebsite] = useState('')
  const [venueType, setVenueType] = useState('')
  const [openingMin, setOpeningMin] = useState('14:00')
  const [menuText, setMenuText] = useState('')
  const [hhSummary, setHhSummary] = useState('')
  const [hhTime, setHhTime] = useState('')

  const [w1Type, setW1Type] = useState('')
  const [w1Days, setW1Days] = useState<Set<number>>(new Set())
  const [w1Exclude, setW1Exclude] = useState<Set<number>>(new Set())
  const [w1Start, setW1Start] = useState('14:00')
  const [w1End, setW1End] = useState('18:00')

  const [w2Type, setW2Type] = useState('')
  const [w2Days, setW2Days] = useState<Set<number>>(new Set())
  const [w2Exclude, setW2Exclude] = useState<Set<number>>(new Set())
  const [w2Start, setW2Start] = useState('14:00')
  const [w2End, setW2End] = useState('18:00')

  const [w3Type, setW3Type] = useState('')
  const [w3Days, setW3Days] = useState<Set<number>>(new Set())
  const [w3Exclude, setW3Exclude] = useState<Set<number>>(new Set())
  const [w3Start, setW3Start] = useState('14:00')
  const [w3End, setW3End] = useState('18:00')

  const [photos, setPhotos] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [geocoding, setGeocoding] = useState(false)
  const [coordsChangedSinceGeocode, setCoordsChangedSinceGeocode] = useState(true)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [lookupPlaceName, setLookupPlaceName] = useState<string | null>(null)
  const [lookupTier, setLookupTier] = useState<'precise' | 'close' | 'approximate' | 'imprecise' | null>(null)
  const [pendingAction, setPendingAction] = useState<'close' | 'delete' | null>(null)

  // Geocode debounce: when lat/lng changes (and parses), call /api/seed/geocode
  // and update the canonical display fields.
  useEffect(() => {
    const latNum = parseFloat(lat)
    const lngNum = parseFloat(lng)
    if (isNaN(latNum) || isNaN(lngNum)) return
    setCoordsChangedSinceGeocode(true)
    const t = setTimeout(async () => {
      setGeocoding(true)
      try {
        const res = await fetch(`/api/seed/geocode?lat=${latNum}&lng=${lngNum}`)
        const data = await res.json()
        if (res.ok && data?.success && data.result) {
          const r = data.result as GeocodeResult
          setCity(r.city ?? '')
          setStateCode(r.state ?? '')
          setNeighborhood(r.neighborhood ?? '')
          setZip(r.zip ?? '')
          setCountry(r.country ?? '')
          setCoordsChangedSinceGeocode(false)
        }
      } catch {
        // Silent — Tyler can fill manually
      } finally {
        setGeocoding(false)
      }
    }, 500)
    return () => clearTimeout(t)
  }, [lat, lng])

  // Auto-open the coords toggle when EDIT/GRADUATE pre-fills (they're second-class
  // but visible so Tyler sees the values).
  useEffect(() => {
    if (mode === 'edit' || mode === 'graduate') setShowCoords(true)
  }, [mode])

  // Load venue when initialVenueId set OR when picker chooses one
  const loadVenue = useCallback(async (id: string) => {
    setLoadingVenue(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/seed/venue?id=${id}`)
      const data = await res.json()
      if (!res.ok || !data?.success) {
        setLoadError(data?.reason ?? 'load_failed')
        setLoaded(null)
        return
      }
      const v = data.venue as VenueRow
      setLoaded(v)
      prefillFromVenue(v)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingVenue(false)
    }
  }, [])

  useEffect(() => {
    if (initialVenueId) loadVenue(initialVenueId)
  }, [initialVenueId, loadVenue])

  function prefillFromVenue(v: VenueRow) {
    setName(v.name ?? '')
    setAddress(v.address ?? '')
    setLat(v.lat != null ? String(v.lat) : '')
    setLng(v.lng != null ? String(v.lng) : '')
    setCity(v.city ?? '')
    setStateCode(v.state ?? '')
    setNeighborhood(v.neighborhood ?? '')
    setZip(v.zip ?? '')
    setCountry(v.country ?? '')
    setPhone(v.phone ?? '')
    setWebsite(v.website ?? '')
    setVenueType(v.type ?? '')
    setOpeningMin(v.opening_min != null ? minToHHMM(v.opening_min) : '')
    setMenuText(v.menu_text ?? '')
    setHhSummary(v.hh_summary ?? '')
    setHhTime(v.hh_time ?? '')
    setW1Type(v.hh_type ?? ''); setW1Days(parseDayCsv(v.hh_days)); setW1Exclude(parseDayCsv(v.hh_exclude_days)); setW1Start(minToHHMM(v.hh_start)); setW1End(minToHHMM(v.hh_end))
    setW2Type(v.hh_type_2 ?? ''); setW2Days(parseDayCsv(v.hh_days_2)); setW2Exclude(parseDayCsv(v.hh_exclude_days_2)); setW2Start(minToHHMM(v.hh_start_2)); setW2End(minToHHMM(v.hh_end_2))
    setW3Type(v.hh_type_3 ?? ''); setW3Days(parseDayCsv(v.hh_days_3)); setW3Exclude(parseDayCsv(v.hh_exclude_days_3)); setW3Start(minToHHMM(v.hh_start_3)); setW3End(minToHHMM(v.hh_end_3))
    setCoordsChangedSinceGeocode(false)
  }

  function clearForm() {
    setName(''); setAddress(''); setLat(''); setLng(''); setCity(''); setStateCode(''); setNeighborhood(''); setZip(''); setCountry('')
    setPhone(''); setWebsite(''); setVenueType(''); setOpeningMin(''); setMenuText(''); setHhSummary(''); setHhTime('')
    setW1Type(''); setW1Days(new Set()); setW1Exclude(new Set()); setW1Start(''); setW1End('')
    setW2Type(''); setW2Days(new Set()); setW2Exclude(new Set()); setW2Start(''); setW2End('')
    setW3Type(''); setW3Days(new Set()); setW3Exclude(new Set()); setW3Start(''); setW3End('')
    setPhotos([]); setLoaded(null); setResult(null); setCoordsChangedSinceGeocode(true)
  }

  async function lookupCoords() {
    if (!address.trim()) {
      setLookupError("Enter an address first.")
      return
    }
    setLookupLoading(true)
    setLookupError(null)
    setLookupPlaceName(null)
    setLookupTier(null)
    try {
      const res = await fetch('/api/seed/geocode-address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, city: city || undefined, state: stateCode || undefined }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        const msg = data.message || data.reason || 'Lookup failed'
        const detail = data.mapboxStatus ? ` (Mapbox status: ${data.mapboxStatus})` : ''
        setLookupError(msg + detail)
        return
      }
      setLat(String(data.lat))
      setLng(String(data.lng))
      setLookupPlaceName(data.place_name)
      setLookupTier(data.tier)
      setCoordsChangedSinceGeocode(false)
    } catch {
      setLookupError('Network error — try again')
    } finally {
      setLookupLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setResult(null)

    try {
      const fd = new FormData()
      fd.set('mode', mode)
      if (mode !== 'new' && loaded) fd.set('venueId', loaded.id)
      fd.set('venueName', name)
      fd.set('address', address)
      if (lat) fd.set('lat', lat)
      if (lng) fd.set('lng', lng)
      fd.set('phone', phone)
      fd.set('website', website)
      fd.set('type', venueType)
      if (openingMin) fd.set('opening_min', String(hhmmToMin(openingMin) ?? ''))
      fd.set('menuText', menuText)
      fd.set('hhSummary', hhSummary)
      if (hhTime) fd.set('hhTime', hhTime)

      function setWindow(idx: 1 | 2 | 3, type: string, days: Set<number>, ex: Set<number>, start: string, end: string) {
        const suffix = idx === 1 ? '' : `_${idx}`
        if (type) fd.set(`hh_type${suffix}`, type)
        const dStr = dayCsvFromSet(days)
        const eStr = dayCsvFromSet(ex)
        if (dStr) fd.set(`hh_days${suffix}`, dStr)
        if (eStr) fd.set(`hh_exclude_days${suffix}`, eStr)
        if (start) fd.set(`hh_start${suffix}`, String(hhmmToMin(start) ?? ''))
        if (end) fd.set(`hh_end${suffix}`, String(hhmmToMin(end) ?? ''))
      }
      setWindow(1, w1Type, w1Days, w1Exclude, w1Start, w1End)
      setWindow(2, w2Type, w2Days, w2Exclude, w2Start, w2End)
      setWindow(3, w3Type, w3Days, w3Exclude, w3Start, w3End)

      for (const p of photos) fd.append('photos', p)

      const res = await fetch('/api/seed/venue', { method: 'POST', body: fd })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        const reason = data?.reason ?? 'unknown'
        const detail = data?.error ? ` — ${data.error}` : ''
        setResult({ ok: false, message: `Save failed: ${reason}${detail}` })
        return
      }

      const recoveredFrom = data.recoveredFrom as string | undefined
      const tail = recoveredFrom ? ` (recovered from ${recoveredFrom})` : ''
      setResult({ ok: true, message: `Saved ${data.mode ?? mode}${tail}. venueId=${data.venueId}` })
      if (mode === 'new') {
        // Clear form after a fresh create so Tyler can do another
        clearForm()
      } else if (data.venueId) {
        // Reload to reflect canonical state from server
        loadVenue(data.venueId)
      }
    } catch (err) {
      setResult({ ok: false, message: `Network error: ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDestructiveAction(action: 'close' | 'delete') {
    if (!loaded) return
    setSubmitting(true)
    setResult(null)
    try {
      const fd = new FormData()
      fd.set('mode', action)
      fd.set('venueId', loaded.id)
      const res = await fetch('/api/seed/venue', { method: 'POST', body: fd })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        const reason = data?.reason ?? 'unknown'
        const detail = data?.error ? ` — ${data.error}` : ''
        setResult({ ok: false, message: `${action} failed: ${reason}${detail}` })
        return
      }
      setResult({ ok: true, message: `Venue ${action}d.` })
      // Reload to reflect server state
      loadVenue(loaded.id)
    } catch (err) {
      setResult({ ok: false, message: `Network error: ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setSubmitting(false)
      setPendingAction(null)
    }
  }

  async function handleLogout() {
    await fetch('/api/seed/logout', { method: 'POST' })
    window.location.href = '/seed'
  }

  // GEOCODE mode uses a simpler flow — just pick a venue and click Run.
  // The form fields are irrelevant (server reads stored lat/lng). Render a
  // compact version.
  if (mode === 'geocode') {
    return (
      <div className="min-h-screen bg-neutral-50 p-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-semibold text-neutral-900">/seed — Geocode</h1>
            <button type="button" onClick={handleLogout} className="text-xs text-neutral-600 hover:text-neutral-900">
              Logout
            </button>
          </div>
          <ModeTabs mode={mode} onChange={setMode} />
          <p className="text-sm text-neutral-600 mb-3">
            Re-run reverseGeocodeStructured on the venue&apos;s stored lat/lng.
            Updates city/state/neighborhood/zip/country/street and slug.
            Address (your typed text) and status are NOT changed.
          </p>
          <VenuePicker
            filter="all"
            onPick={(r) => runGeocodeFor(r.id)}
          />
          {loadingVenue && <p className="text-sm text-neutral-500">Loading venue…</p>}
          {loadError && <p className="text-sm text-red-600">{loadError}</p>}
          {loaded && (
            <div className="bg-white border border-neutral-200 rounded p-4 mt-2">
              <div className="text-sm font-medium text-neutral-900">{loaded.name}</div>
              <div className="text-xs text-neutral-600 mb-2">
                lat/lng: {loaded.lat}, {loaded.lng}
              </div>
              <button
                type="button"
                onClick={() => runGeocodeFor(loaded.id)}
                disabled={submitting}
                className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded hover:bg-amber-700 disabled:bg-neutral-300"
              >
                {submitting ? 'Geocoding…' : 'Run geocode'}
              </button>
              {result && (
                <p className={`mt-3 text-xs ${result.ok ? 'text-green-700' : 'text-red-700'}`}>{result.message}</p>
              )}
              {result?.ok && (result as { geocoded?: GeocodeResult }).geocoded && (
                <pre className="mt-2 text-xs bg-neutral-50 p-2 rounded border border-neutral-200 overflow-x-auto">
                  {JSON.stringify((result as { geocoded?: GeocodeResult }).geocoded, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  async function runGeocodeFor(id: string) {
    setSubmitting(true)
    setResult(null)
    try {
      const fd = new FormData()
      fd.set('mode', 'geocode')
      fd.set('venueId', id)
      const res = await fetch('/api/seed/venue', { method: 'POST', body: fd })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        setResult({ ok: false, message: `Geocode failed: ${data?.reason ?? 'unknown'}` })
        return
      }
      setResult({
        ok: true,
        message: `Geocoded. city=${data.geocoded?.city ?? '—'} state=${data.geocoded?.state ?? '—'}`,
      })
      // Reflect geocoded values back into `loaded` so the picker card updates.
      if (data.geocoded) {
        setLoaded((prev) => prev ? { ...prev, ...data.geocoded } : prev)
      }
    } catch (err) {
      setResult({ ok: false, message: `Network error: ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 p-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold text-neutral-900">
            /seed — {mode === 'new' ? 'New venue' : mode === 'edit' ? 'Edit venue' : 'Graduate seed'}
          </h1>
          <button type="button" onClick={handleLogout} className="text-xs text-neutral-600 hover:text-neutral-900">
            Logout
          </button>
        </div>

        <ModeTabs mode={mode} onChange={(m) => { setMode(m); clearForm() }} />

        {(mode === 'edit' || mode === 'graduate') && !loaded && (
          <VenuePicker
            filter={mode === 'graduate' ? 'seed' : 'all'}
            onPick={(r) => loadVenue(r.id)}
          />
        )}

        {loadingVenue && <p className="text-sm text-neutral-500">Loading venue…</p>}
        {loadError && <p className="text-sm text-red-600">{loadError}</p>}

        {loaded && (mode === 'edit' || mode === 'graduate') && (
          <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4 text-xs text-amber-900">
            Editing <strong>{loaded.name}</strong> — current status:{' '}
            <StatusBadge status={loaded.status} isSeed={loaded.is_seed_data} />
            {loaded.status === 'closed' && (
              <span className="ml-2 text-amber-800">(saving will recover to verified)</span>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-white border border-neutral-200 rounded p-4">
          {/* PRIMARY FIELDS */}
          <fieldset className="mb-4">
            <legend className="text-sm font-semibold text-neutral-900 mb-2">Identity</legend>

            <label className="block mb-3">
              <span className="block text-xs font-medium text-neutral-700 mb-1">Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm border border-neutral-300 rounded focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </label>

            <label className="block mb-3">
              <span className="block text-xs font-medium text-neutral-700 mb-1">
                Address <span className="text-neutral-500">(your typed text — wins over geocoder)</span>
              </span>
              <input
                type="text"
                value={address}
                onChange={(e) => { setAddress(e.target.value); setLookupError(null); setLookupPlaceName(null); setLookupTier(null) }}
                placeholder="1314 NW Glisan St, Portland, OR"
                className="w-full px-3 py-2 text-sm border border-neutral-300 rounded focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </label>

            {/* Look up precise coordinates from Mapbox */}
            <div className="mb-4">
              <button
                type="button"
                onClick={lookupCoords}
                disabled={lookupLoading || !address.trim()}
                className="text-xs px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded border border-amber-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {lookupLoading ? 'Looking up…' : 'Look up coordinates'}
              </button>
              {lookupError && (
                <p className="mt-1 text-xs text-red-600">{lookupError}</p>
              )}
              {lookupPlaceName && lookupTier && (
                <p className={`mt-1 text-xs font-medium ${
                  lookupTier === 'precise' ? 'text-green-700' :
                  lookupTier === 'close' ? 'text-yellow-700' :
                  lookupTier === 'approximate' ? 'text-orange-700' :
                  'text-red-700'
                }`}>
                  {lookupTier === 'precise' ? '●' : lookupTier === 'close' ? '◐' : lookupTier === 'approximate' ? '○' : '✕'}{" "}
                  {lookupTier.charAt(0).toUpperCase() + lookupTier.slice(1)} — set from: {lookupPlaceName}
                </p>
              )}
            </div>

            {/* Coords: SECONDARY. Pre-filled from existing row or geocoder.
                Visually de-emphasized. */}
            <div className="mb-3">
              <button
                type="button"
                onClick={() => setShowCoords((s) => !s)}
                className="text-xs text-neutral-600 hover:text-neutral-900"
              >
                {showCoords ? '▼' : '▶'} Coordinates (advanced)
              </button>
              {showCoords && (
                <div className="mt-2 flex gap-3 items-end">
                  <label className="block">
                    <span className="block text-[10px] font-medium text-neutral-500 mb-0.5">lat</span>
                    <input
                      type="number"
                      step="any"
                      value={lat}
                      onChange={(e) => setLat(e.target.value)}
                      placeholder="45.5275"
                      className="w-32 px-2 py-1 text-xs border border-neutral-300 rounded font-mono"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[10px] font-medium text-neutral-500 mb-0.5">lng</span>
                    <input
                      type="number"
                      step="any"
                      value={lng}
                      onChange={(e) => setLng(e.target.value)}
                      placeholder="-122.6850"
                      className="w-32 px-2 py-1 text-xs border border-neutral-300 rounded font-mono"
                    />
                  </label>
                  {geocoding && <span className="text-xs text-neutral-500">geocoding…</span>}
                  {!geocoding && coordsChangedSinceGeocode && lat && lng && (
                    <span className="text-xs text-neutral-500">geocode pending…</span>
                  )}
                </div>
              )}
            </div>

            {/* CANONICAL structured fields — read-only, server-derived */}
            <div className="mt-3 p-3 bg-neutral-50 border border-neutral-200 rounded">
              <p className="text-xs font-semibold text-neutral-700 mb-2">
                Canonical (from geocoder — auto-updated when lat/lng change)
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-neutral-500">city:</span> <span className="font-mono">{city || '—'}</span></div>
                <div><span className="text-neutral-500">state:</span> <span className="font-mono">{stateCode || '—'}</span></div>
                <div><span className="text-neutral-500">neighborhood:</span> <span className="font-mono">{neighborhood || '—'}</span></div>
                <div><span className="text-neutral-500">zip:</span> <span className="font-mono">{zip || '—'}</span></div>
                <div><span className="text-neutral-500">country:</span> <span className="font-mono">{country || '—'}</span></div>
              </div>
            </div>
          </fieldset>

          <fieldset className="mb-4">
            <legend className="text-sm font-semibold text-neutral-900 mb-2">Contact</legend>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-medium text-neutral-700 mb-1">Phone</span>
                <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-2 py-1 text-sm border border-neutral-300 rounded" />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-neutral-700 mb-1">Website</span>
                <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} className="w-full px-2 py-1 text-sm border border-neutral-300 rounded" />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-neutral-700 mb-1">Type</span>
                <input type="text" value={venueType} onChange={(e) => setVenueType(e.target.value)} placeholder="bar, restaurant…" className="w-full px-2 py-1 text-sm border border-neutral-300 rounded" />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-neutral-700 mb-1">Opening time (HH:MM 24h)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={openingMin}
                  onChange={(e) => setOpeningMin(e.target.value)}
                  placeholder="14:00"
                  className="w-full px-2 py-1 text-sm border border-neutral-300 rounded"
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="mb-4">
            <legend className="text-sm font-semibold text-neutral-900 mb-2">Happy hour</legend>

            <label className="block mb-3">
              <span className="block text-xs font-medium text-neutral-700 mb-1">HH summary (one-liner shown to users)</span>
              <input type="text" value={hhSummary} onChange={(e) => setHhSummary(e.target.value)} placeholder="$5 wells, $4 drafts, 14:00–18:00" className="w-full px-2 py-1 text-sm border border-neutral-300 rounded" />
            </label>

            <HhWindow index={1} type={w1Type} days={w1Days} excludeDays={w1Exclude} start={w1Start} end={w1End}
              onChange={(p) => {
                if (p.type !== undefined) setW1Type(p.type)
                if (p.days) setW1Days(p.days)
                if (p.excludeDays) setW1Exclude(p.excludeDays)
                if (p.start !== undefined) setW1Start(p.start)
                if (p.end !== undefined) setW1End(p.end)
              }} />
            <HhWindow index={2} type={w2Type} days={w2Days} excludeDays={w2Exclude} start={w2Start} end={w2End}
              onChange={(p) => {
                if (p.type !== undefined) setW2Type(p.type)
                if (p.days) setW2Days(p.days)
                if (p.excludeDays) setW2Exclude(p.excludeDays)
                if (p.start !== undefined) setW2Start(p.start)
                if (p.end !== undefined) setW2End(p.end)
              }} />
            <HhWindow index={3} type={w3Type} days={w3Days} excludeDays={w3Exclude} start={w3Start} end={w3End}
              onChange={(p) => {
                if (p.type !== undefined) setW3Type(p.type)
                if (p.days) setW3Days(p.days)
                if (p.excludeDays) setW3Exclude(p.excludeDays)
                if (p.start !== undefined) setW3Start(p.start)
                if (p.end !== undefined) setW3End(p.end)
              }} />

            <label className="block mt-3">
              <span className="block text-xs font-medium text-neutral-700 mb-1">
                Legacy hh_time (free text — leave empty if structured fields filled)
              </span>
              <input type="text" value={hhTime} onChange={(e) => setHhTime(e.target.value)} className="w-full px-2 py-1 text-sm border border-neutral-300 rounded" />
            </label>

            <label className="block mt-3">
              <span className="block text-xs font-medium text-neutral-700 mb-1">Menu text (legacy OCR result)</span>
              <textarea
                value={menuText}
                onChange={(e) => setMenuText(e.target.value)}
                rows={3}
                className="w-full px-2 py-1 text-sm border border-neutral-300 rounded font-mono"
              />
            </label>
          </fieldset>

          <fieldset className="mb-4">
            <legend className="text-sm font-semibold text-neutral-900 mb-2">Photos (optional)</legend>
            <label className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-amber-600 rounded hover:bg-amber-700 cursor-pointer focus-within:ring-2 focus-within:ring-amber-500 focus-within:ring-offset-2">
              <span>Choose photos</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                multiple
                onChange={(e) => setPhotos(Array.from(e.target.files ?? []))}
                className="sr-only"
              />
            </label>
            {photos.length > 0 && (
              <p className="mt-2 text-xs text-neutral-700">
                {photos.length} file{photos.length === 1 ? '' : 's'} queued. Extensions + contentType derive from each file&apos;s actual type.
              </p>
            )}
            {loaded?.latest_menu_image_url && (
              <div className="mt-2">
                <p className="text-xs text-neutral-600 mb-1">Current latest:</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={loaded.latest_menu_image_url} alt="latest menu" className="max-h-32 rounded border border-neutral-200" />
              </div>
            )}
          </fieldset>

          <div className="flex items-center justify-between gap-3">
            <button
              type="submit"
              disabled={submitting || !name || !lat || !lng || !address}
              className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded hover:bg-amber-700 disabled:bg-neutral-300 disabled:cursor-not-allowed"
            >
              {submitting ? 'Saving…' : (mode === 'new' ? 'Create venue' : mode === 'graduate' ? 'Graduate seed → verified' : 'Save changes')}
            </button>
            {mode === 'edit' && loaded?.status === 'closed' && (
              <span className="text-xs text-amber-700">⚠ This will resurrect a closed venue.</span>
            )}
          </div>

          {result && (
            <p className={`mt-3 text-xs ${result.ok ? 'text-green-700' : 'text-red-700'}`}>
              {result.message}
            </p>
          )}
        </form>

        {/* Danger zone — graduate-only destructive actions */}
        {mode === 'graduate' && loaded && (
          <div className="mt-4 border border-red-200 rounded p-4 bg-red-50">
            <p className="text-xs font-semibold text-red-700 mb-3">Danger zone</p>
            {pendingAction === null ? (
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setPendingAction('close')}
                  className="text-xs px-3 py-1.5 border border-red-300 text-red-700 rounded hover:bg-red-100 disabled:opacity-40"
                >
                  Close venue
                </button>
                <button
                  type="button"
                  onClick={() => setPendingAction('delete')}
                  className="text-xs px-3 py-1.5 border border-red-300 text-red-700 rounded hover:bg-red-100 disabled:opacity-40"
                >
                  Delete permanently
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-xs text-red-700">
                  {pendingAction === 'close'
                    ? 'Close this venue? It will no longer appear on the map.'
                    : 'Delete this venue permanently from the database? This cannot be undone.'}
                </span>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleDestructiveAction(pendingAction)}
                  className="text-xs px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-40"
                >
                  {submitting ? '…' : 'Confirm'}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setPendingAction(null)}
                  className="text-xs px-3 py-1.5 border border-red-300 text-red-700 rounded hover:bg-red-100 disabled:opacity-40"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}