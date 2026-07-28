'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/* ──────────────────────────────────────────────────────────────────────────
 * Types — match /api/manage/venue GET response
 * ────────────────────────────────────────────────────────────────────────── */

interface PhotoSet {
  id: string
  photoUrls: string[]
  createdAt: string
}

interface VenueReadonly {
  name: string
  address: string | null
  city: string | null
  state: string | null
  claimed_until: string | null
}

interface VenueEditable {
  tagline: string | null
  hh_summary: string | null
  hh_time: string | null
  opening_min: number | null
  phone: string | null
  website: string | null
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
}

type VenueResponse = VenueReadonly & Partial<VenueEditable> & {
  photoSets?: PhotoSet[]
  latestMenuImageUrl?: string | null
}

interface ApiError {
  reason?: string
}

/* ──────────────────────────────────────────────────────────────────────────
 * Day helpers — mirror SeedTool / submit-venue
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
  return DAY_VALUES.filter(d => set.has(d)).join(',')
}

/* ──────────────────────────────────────────────────────────────────────────
 * Time helpers — UI uses HH:MM; DB uses minutes since midnight
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
 * Window editor — models HhWindow from SeedTool.tsx
 * Same props shape; visually clean, Path B palette.
 * ────────────────────────────────────────────────────────────────────────── */

interface WindowDef {
  type: string
  days: Set<number>
  start: string
  end: string
  useCloseTime: boolean
}

interface ManageHhWindowProps {
  index: 1 | 2 | 3
  window: WindowDef
  isPartial?: boolean
  onChange: (index: 1 | 2 | 3, next: Partial<WindowDef>) => void
  disabled?: boolean
}

function ManageHhWindow({ index, window, isPartial, onChange, disabled }: ManageHhWindowProps) {
  const { type, days, start, end, useCloseTime } = window

  function toggleDay(d: number) {
    if (disabled) return
    const next = new Set(days)
    if (next.has(d)) next.delete(d)
    else next.add(d)
    onChange(index, { days: next })
  }

  return (
    <fieldset
      disabled={disabled}
      className={`border rounded-xl p-4 mb-3 transition-colors ${
        isPartial
          ? 'border-amber-400 bg-amber-50'
          : 'border-neutral-200 bg-white'
      } ${disabled ? 'opacity-60' : ''}`}
    >
      <legend className="text-xs font-semibold text-neutral-700 px-1">
        Window {index}
      </legend>

      <div className="flex flex-wrap gap-3 mb-3">
        <label className="text-xs text-neutral-700">
          <span className="block mb-1 font-medium">Type</span>
          <select
            value={type}
            onChange={(e) => onChange(index, { type: e.target.value })}
            className="text-sm border border-neutral-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
          >
            <option value="">(none)</option>
            <option value="typical">typical</option>
            <option value="late_night">late_night</option>
            <option value="all_day">all_day</option>
          </select>
        </label>

        <label className="text-xs text-neutral-700">
          <span className="block mb-1 font-medium">Start</span>
          <input
            type="text"
            inputMode="numeric"
            value={start}
            placeholder="14:00"
            onChange={(e) => onChange(index, { start: e.target.value })}
            className="text-sm border border-neutral-300 rounded-lg px-2 py-1.5 w-28 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
          />
        </label>

        <label className="text-xs text-neutral-700">
          <span className="block mb-1 font-medium">End</span>
          <input
            type="text"
            inputMode="numeric"
            value={end}
            placeholder="18:00"
            disabled={useCloseTime || disabled}
            onChange={(e) => onChange(index, { end: e.target.value })}
            className="text-sm border border-neutral-300 rounded-lg px-2 py-1.5 w-28 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono disabled:bg-neutral-100 disabled:text-neutral-400"
          />
        </label>

        <label className="flex items-end pb-1 gap-2 text-xs text-neutral-700">
          <input
            type="checkbox"
            checked={useCloseTime ?? false}
            onChange={(e) => {
              onChange(index, { useCloseTime: e.target.checked })
              if (e.target.checked) onChange(index, { end: '' })
            }}
            className="accent-amber-600 w-4 h-4"
          />
          <span className="pb-0.5">Until close</span>
        </label>
      </div>

      <div>
        <p className="text-xs text-neutral-500 mb-2 font-medium">Active days</p>
        <div className="flex flex-wrap gap-1.5">
          {DAY_VALUES.map((d, i) => (
            <button
              key={d}
              type="button"
              onClick={() => toggleDay(d)}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                days.has(d)
                  ? 'bg-amber-500 border-amber-600 text-white'
                  : 'bg-white border-neutral-300 text-neutral-700 hover:border-neutral-400'
              } ${disabled ? 'cursor-default' : 'cursor-pointer'}`}
            >
              {DAY_LABELS[i]}
            </button>
          ))}
        </div>
        {isPartial && (
          <p className="mt-2 text-xs text-amber-700 font-medium">
            Fill in all fields or leave this window empty.
          </p>
        )}
      </div>
    </fieldset>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────────── */

function formatExpiry(iso: string | null): string {
  if (!iso) return 'unknown'
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function formatUploadDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function windowsDiffer(
  a: WindowDef,
  b: WindowDef
): boolean {
  return (
    a.type !== b.type ||
    dayCsvFromSet(a.days) !== dayCsvFromSet(b.days) ||
    a.start !== b.start ||
    a.end !== b.end ||
    a.useCloseTime !== b.useCloseTime
  )
}

/* ──────────────────────────────────────────────────────────────────────────
 * Client form
 * ────────────────────────────────────────────────────────────────────────── */

interface ManageClientProps {
  venueId: string
  claimedUntil: string | null
}

export default function ManageClient({ venueId, claimedUntil }: ManageClientProps) {
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(false)
  const [readonly, setReadonly] = useState<VenueReadonly | null>(null)
  const [initialEditable, setInitialEditable] = useState<VenueEditable | null>(null)
  const [photoSets, setPhotoSets] = useState<PhotoSet[]>([])
  const [latestMenuImageUrl, setLatestMenuImageUrl] = useState<string | null>(null)

  // Form state
  const [tagline, setTagline] = useState('')
  const [hhSummary, setHhSummary] = useState('')
  const [phone, setPhone] = useState('')
  const [website, setWebsite] = useState('')

  const [w1, setW1] = useState<WindowDef>({ type: '', days: new Set(), start: '', end: '', useCloseTime: false })
  const [w2, setW2] = useState<WindowDef>({ type: '', days: new Set(), start: '', end: '', useCloseTime: false })
  const [w3, setW3] = useState<WindowDef>({ type: '', days: new Set(), start: '', end: '', useCloseTime: false })

  const [showW2, setShowW2] = useState(false)
  const [showW3, setShowW3] = useState(false)

  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [windowErrors, setWindowErrors] = useState<Record<number, string>>({})

  // Sync photo state from a GET response
  function syncPhotoState(data: VenueResponse) {
    if (data.photoSets) setPhotoSets(data.photoSets)
    if (data.latestMenuImageUrl !== undefined) setLatestMenuImageUrl(data.latestMenuImageUrl ?? null)
  }

  // On mount: fetch current venue state
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setAuthError(false)
      try {
        const res = await fetch('/api/manage/venue')
        if (res.status === 401) {
          if (!cancelled) setAuthError(true)
          return
        }
        const data = await res.json() as VenueResponse
        if (!res.ok) {
          if (!cancelled) setSaveMessage({ ok: false, text: (data as ApiError).reason ?? 'load_failed' })
          return
        }
        if (!cancelled) {
          setReadonly({
            name: data.name ?? '',
            address: data.address ?? null,
            city: data.city ?? null,
            state: data.state ?? null,
            claimed_until: data.claimed_until ?? null,
          })

          syncPhotoState(data)

          const editable: VenueEditable = {
            tagline: data.tagline ?? null,
            hh_summary: data.hh_summary ?? null,
            hh_time: data.hh_time ?? null,
            opening_min: data.opening_min ?? null,
            phone: data.phone ?? null,
            website: data.website ?? null,
            hh_type: data.hh_type ?? null,
            hh_days: data.hh_days ?? null,
            hh_exclude_days: data.hh_exclude_days ?? null,
            hh_start: data.hh_start ?? null,
            hh_end: data.hh_end ?? null,
            hh_type_2: data.hh_type_2 ?? null,
            hh_days_2: data.hh_days_2 ?? null,
            hh_exclude_days_2: data.hh_exclude_days_2 ?? null,
            hh_start_2: data.hh_start_2 ?? null,
            hh_end_2: data.hh_end_2 ?? null,
            hh_type_3: data.hh_type_3 ?? null,
            hh_days_3: data.hh_days_3 ?? null,
            hh_exclude_days_3: data.hh_exclude_days_3 ?? null,
            hh_start_3: data.hh_start_3 ?? null,
            hh_end_3: data.hh_end_3 ?? null,
          }
          setInitialEditable(editable)

          // Populate form
          setTagline(data.tagline ?? '')
          setHhSummary(data.hh_summary ?? '')
          setPhone(data.phone ?? '')
          setWebsite(data.website ?? '')

          const hasW1 = !!(data.hh_type)
          setW1({
            type: data.hh_type ?? '',
            days: hasW1 ? parseDayCsv(data.hh_days) : new Set(),
            start: hasW1 ? minToHHMM(data.hh_start) : '',
            end: hasW1 ? minToHHMM(data.hh_end ?? null) : '',
            useCloseTime: hasW1 ? data.hh_end == null : false,
          })
          setShowW2(!!(data.hh_type_2))
          setShowW3(!!(data.hh_type_3))

          const hasW2 = !!(data.hh_type_2)
          setW2({
            type: data.hh_type_2 ?? '',
            days: hasW2 ? parseDayCsv(data.hh_days_2) : new Set(),
            start: hasW2 ? minToHHMM(data.hh_start_2) : '',
            end: hasW2 ? minToHHMM(data.hh_end_2 ?? null) : '',
            useCloseTime: hasW2 ? data.hh_end_2 == null : false,
          })

          const hasW3 = !!(data.hh_type_3)
          setW3({
            type: data.hh_type_3 ?? '',
            days: hasW3 ? parseDayCsv(data.hh_days_3) : new Set(),
            start: hasW3 ? minToHHMM(data.hh_start_3) : '',
            end: hasW3 ? minToHHMM(data.hh_end_3 ?? null) : '',
            useCloseTime: hasW3 ? data.hh_end_3 == null : false,
          })
        }
      } catch (err) {
        if (!cancelled) {
          setSaveMessage({
            ok: false,
            text: err instanceof Error ? err.message : String(err),
          })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleWindowChange = useCallback((index: 1 | 2 | 3, next: Partial<WindowDef>) => {
    const setters: Record<1 | 2 | 3, React.Dispatch<React.SetStateAction<WindowDef>>> = {
      1: setW1,
      2: setW2,
      3: setW3,
    }
    setters[index](prev => ({ ...prev, ...next }))
    // Clear any error for this window
    setWindowErrors(prev => { const n = { ...prev }; delete n[index]; return n })
  }, [])

  function handlePhotoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, 4)
    setSelectedFiles(files)
    // Reset the input so the same file list can be re-selected if needed
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function clearSelectedPhotos() {
    setSelectedFiles([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (saving || !initialEditable) return
    setSaving(true)
    setSaveMessage(null)
    setWindowErrors({})

    // Build changed-fields object
    const changed: Record<string, unknown> = {}

    if (tagline !== (initialEditable.tagline ?? '')) {
      changed.tagline = tagline || null
    }
    if (hhSummary !== (initialEditable.hh_summary ?? '')) {
      changed.hh_summary = hhSummary || null
    }
    if (phone !== (initialEditable.phone ?? '')) {
      changed.phone = phone || null
    }
    if (website !== (initialEditable.website ?? '')) {
      changed.website = website || null
    }

    // Window 1 — only include if window has at least a type set
    const initW1: WindowDef = {
      type: initialEditable.hh_type ?? '',
      days: parseDayCsv(initialEditable.hh_days),
      start: minToHHMM(initialEditable.hh_start),
      end: minToHHMM(initialEditable.hh_end),
      useCloseTime: initialEditable.hh_end == null,
    }
    if (w1.type || initW1.type) {
      if (windowsDiffer(w1, initW1)) {
        if (w1.type !== initW1.type) changed.hh_type = w1.type || null
        if (dayCsvFromSet(w1.days) !== dayCsvFromSet(initW1.days)) changed.hh_days = dayCsvFromSet(w1.days) || null
        if (w1.start !== initW1.start) changed.hh_start = w1.start ? hhmmToMin(w1.start) : null
        if (w1.useCloseTime !== initW1.useCloseTime || w1.end !== initW1.end) {
          changed.hh_end = w1.useCloseTime ? null : (w1.end ? hhmmToMin(w1.end) : null)
        }
      }
    }

    // Window 2 — only include if window 2 is visible and has type
    if (showW2) {
      const initW2: WindowDef = {
        type: initialEditable.hh_type_2 ?? '',
        days: parseDayCsv(initialEditable.hh_days_2),
        start: minToHHMM(initialEditable.hh_start_2),
        end: minToHHMM(initialEditable.hh_end_2),
        useCloseTime: initialEditable.hh_end_2 == null,
      }
      if (w2.type || initW2.type) {
        if (windowsDiffer(w2, initW2)) {
          if (w2.type !== initW2.type) changed.hh_type_2 = w2.type || null
          if (dayCsvFromSet(w2.days) !== dayCsvFromSet(initW2.days)) changed.hh_days_2 = dayCsvFromSet(w2.days) || null
          if (w2.start !== initW2.start) changed.hh_start_2 = w2.start ? hhmmToMin(w2.start) : null
          if (w2.useCloseTime !== initW2.useCloseTime || w2.end !== initW2.end) {
            changed.hh_end_2 = w2.useCloseTime ? null : (w2.end ? hhmmToMin(w2.end) : null)
          }
        }
      }
    } else if (initialEditable.hh_type_2) {
      // Window 2 was hidden but had data — user removed it, clear it
      changed.hh_type_2 = null
      changed.hh_days_2 = null
      changed.hh_start_2 = null
      changed.hh_end_2 = null
    }

    // Window 3
    if (showW3) {
      const initW3: WindowDef = {
        type: initialEditable.hh_type_3 ?? '',
        days: parseDayCsv(initialEditable.hh_days_3),
        start: minToHHMM(initialEditable.hh_start_3),
        end: minToHHMM(initialEditable.hh_end_3),
        useCloseTime: initialEditable.hh_end_3 == null,
      }
      if (w3.type || initW3.type) {
        if (windowsDiffer(w3, initW3)) {
          if (w3.type !== initW3.type) changed.hh_type_3 = w3.type || null
          if (dayCsvFromSet(w3.days) !== dayCsvFromSet(initW3.days)) changed.hh_days_3 = dayCsvFromSet(w3.days) || null
          if (w3.start !== initW3.start) changed.hh_start_3 = w3.start ? hhmmToMin(w3.start) : null
          if (w3.useCloseTime !== initW3.useCloseTime || w3.end !== initW3.end) {
            changed.hh_end_3 = w3.useCloseTime ? null : (w3.end ? hhmmToMin(w3.end) : null)
          }
        }
      }
    } else if (initialEditable.hh_type_3) {
      changed.hh_type_3 = null
      changed.hh_days_3 = null
      changed.hh_start_3 = null
      changed.hh_end_3 = null
    }

    const hasPhotos = selectedFiles.length > 0
    const hasFields = Object.keys(changed).length > 0

    // Nothing changed
    if (!hasPhotos && !hasFields) {
      setSaveMessage({ ok: true, text: 'No changes to save.' })
      setSaving(false)
      return
    }

    try {
      let res: Response

      if (hasPhotos) {
        // Use FormData — photos + field changes in one request
        const formData = new FormData()
        for (const file of selectedFiles) {
          formData.append('photos', file)
        }
        for (const [key, value] of Object.entries(changed)) {
          formData.append(key, String(value ?? ''))
        }

        res = await fetch('/api/manage/venue', {
          method: 'PATCH',
          body: formData,
        })
      } else {
        // JSON only — no photos
        res = await fetch('/api/manage/venue', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(changed),
        })
      }

      const data = await res.json()

      if (!res.ok) {
        if (data.reason === 'invalid_timeframe') {
          setSaveMessage({ ok: false, text: 'Invalid happy hour window — check that times are possible for your city.' })
        } else {
          setSaveMessage({ ok: false, text: data.reason ?? 'save_failed' })
        }
        return
      }

      // Clear selected photos on success
      clearSelectedPhotos()
      setSaveMessage({ ok: true, text: 'Changes saved.' })

      // Re-fetch to sync form + photo state with server truth
      const getRes = await fetch('/api/manage/venue')
      if (getRes.ok) {
        const fresh = await getRes.json() as VenueResponse
        setInitialEditable({
          tagline: fresh.tagline ?? null,
          hh_summary: fresh.hh_summary ?? null,
          hh_time: fresh.hh_time ?? null,
          opening_min: fresh.opening_min ?? null,
          phone: fresh.phone ?? null,
          website: fresh.website ?? null,
          hh_type: fresh.hh_type ?? null,
          hh_days: fresh.hh_days ?? null,
          hh_exclude_days: fresh.hh_exclude_days ?? null,
          hh_start: fresh.hh_start ?? null,
          hh_end: fresh.hh_end ?? null,
          hh_type_2: fresh.hh_type_2 ?? null,
          hh_days_2: fresh.hh_days_2 ?? null,
          hh_exclude_days_2: fresh.hh_exclude_days_2 ?? null,
          hh_start_2: fresh.hh_start_2 ?? null,
          hh_end_2: fresh.hh_end_2 ?? null,
          hh_type_3: fresh.hh_type_3 ?? null,
          hh_days_3: fresh.hh_days_3 ?? null,
          hh_exclude_days_3: fresh.hh_exclude_days_3 ?? null,
          hh_start_3: fresh.hh_start_3 ?? null,
          hh_end_3: fresh.hh_end_3 ?? null,
        })
        setTagline(fresh.tagline ?? '')
        setHhSummary(fresh.hh_summary ?? '')
        setPhone(fresh.phone ?? '')
        setWebsite(fresh.website ?? '')

        const hasW1 = !!(fresh.hh_type)
        setW1({
          type: fresh.hh_type ?? '',
          days: hasW1 ? parseDayCsv(fresh.hh_days) : new Set(),
          start: hasW1 ? minToHHMM(fresh.hh_start) : '',
          end: hasW1 ? minToHHMM(fresh.hh_end ?? null) : '',
          useCloseTime: hasW1 ? fresh.hh_end == null : false,
        })
        setShowW2(!!(fresh.hh_type_2))
        const hasW2 = !!(fresh.hh_type_2)
        setW2({
          type: fresh.hh_type_2 ?? '',
          days: hasW2 ? parseDayCsv(fresh.hh_days_2) : new Set(),
          start: hasW2 ? minToHHMM(fresh.hh_start_2) : '',
          end: hasW2 ? minToHHMM(fresh.hh_end_2 ?? null) : '',
          useCloseTime: hasW2 ? fresh.hh_end_2 == null : false,
        })
        setShowW3(!!(fresh.hh_type_3))
        const hasW3 = !!(fresh.hh_type_3)
        setW3({
          type: fresh.hh_type_3 ?? '',
          days: hasW3 ? parseDayCsv(fresh.hh_days_3) : new Set(),
          start: hasW3 ? minToHHMM(fresh.hh_start_3) : '',
          end: hasW3 ? minToHHMM(fresh.hh_end_3 ?? null) : '',
          useCloseTime: hasW3 ? fresh.hh_end_3 == null : false,
        })

        syncPhotoState(fresh)
      }
    } catch (err) {
      setSaveMessage({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSaving(false)
    }
  }

  // Auth error state — same recovery message as server component
  if (authError) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-neutral-900 mb-2">
            Your access link has expired or is no longer valid.
          </h1>
          <p className="text-sm text-neutral-500">
            Contact us for a new one.
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-neutral-500">Loading…</p>
        </div>
      </div>
    )
  }

  if (!readonly) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <p className="text-sm text-neutral-500">Failed to load venue.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">

        {/* Header card */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-6 mb-4">
          <h1 className="text-xl font-semibold text-neutral-900">{readonly.name}</h1>
          {readonly.address && (
            <p className="text-sm text-neutral-600 mt-1">
              {[readonly.address, readonly.city, readonly.state].filter(Boolean).join(', ')}
            </p>
          )}
          <div className="mt-2">
            <label htmlFor="tagline" className="block text-xs font-medium text-neutral-500 mb-1">Tagline</label>
            <input
              id="tagline"
              type="text"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              maxLength={24}
              placeholder="Cocktail Bar, Restaurant, etc."
              className="w-full px-3 py-1.5 text-sm border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <div className="flex justify-end mt-0.5">
              <span className={`text-xs ${tagline.length > 20 ? 'text-amber-600' : 'text-neutral-400'}`}>
                {tagline.length}/24
              </span>
            </div>
          </div>
          {claimedUntil && (
            <p className="text-xs text-neutral-400 mt-2">
              Your access expires {formatExpiry(claimedUntil)}
            </p>
          )}
        </div>

        {/* Form card */}
        <form onSubmit={handleSave} className="bg-white rounded-2xl border border-neutral-200 p-6 space-y-6">

          {/* Menu highlights */}
          <fieldset>
            <label htmlFor="hh_summary" className="block text-sm font-medium text-neutral-700 mb-1.5">
              Menu highlights
            </label>
            <textarea
              id="hh_summary"
              value={hhSummary}
              onChange={(e) => setHhSummary(e.target.value)}
              maxLength={120}
              rows={2}
              placeholder="$10 Cocktails, $2 oysters, etc."
              className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
            />
            <div className="flex justify-end mt-1">
              <span className={`text-xs ${hhSummary.length > 108 ? 'text-amber-600' : 'text-neutral-400'}`}>
                {hhSummary.length}/120
              </span>
            </div>
          </fieldset>

          {/* Contact */}
          <fieldset>
            <legend className="text-sm font-medium text-neutral-700 mb-3">Contact</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="phone" className="block text-xs text-neutral-500 mb-1">Phone</label>
                <input
                  id="phone"
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(503) 555-0100"
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label htmlFor="website" className="block text-xs text-neutral-500 mb-1">Website</label>
                <input
                  id="website"
                  type="text"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://example.com"
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>
          </fieldset>

          {/* Happy hour schedule */}
          <fieldset>
            <legend className="text-sm font-medium text-neutral-700 mb-3">Happy hour schedule</legend>

            <ManageHhWindow
              index={1}
              window={w1}
              onChange={handleWindowChange}
              disabled={saving}
            />

            {showW2 && (
              <ManageHhWindow
                index={2}
                window={w2}
                onChange={handleWindowChange}
                disabled={saving}
              />
            )}

            {showW3 && (
              <ManageHhWindow
                index={3}
                window={w3}
                onChange={handleWindowChange}
                disabled={saving}
              />
            )}

            <div className="flex gap-2 mt-1">
              {!showW2 && (
                <button
                  type="button"
                  onClick={() => { setShowW2(true); setW2({ type: '', days: new Set(), start: '', end: '', useCloseTime: false }) }}
                  className="text-xs px-3 py-1.5 border border-neutral-300 rounded-lg text-neutral-600 hover:border-neutral-400 hover:text-neutral-800 transition-colors"
                >
                  + Add window
                </button>
              )}
              {!showW3 && showW2 && (
                <button
                  type="button"
                  onClick={() => { setShowW3(true); setW3({ type: '', days: new Set(), start: '', end: '', useCloseTime: false }) }}
                  className="text-xs px-3 py-1.5 border border-neutral-300 rounded-lg text-neutral-600 hover:border-neutral-400 hover:text-neutral-800 transition-colors"
                >
                  + Add window
                </button>
              )}
              {showW2 && (
                <button
                  type="button"
                  onClick={() => { setShowW2(false); setW2({ type: '', days: new Set(), start: '', end: '', useCloseTime: false }) }}
                  className="text-xs px-3 py-1.5 border border-red-200 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                >
                  Remove window 2
                </button>
              )}
              {showW3 && (
                <button
                  type="button"
                  onClick={() => { setShowW3(false); setW3({ type: '', days: new Set(), start: '', end: '', useCloseTime: false }) }}
                  className="text-xs px-3 py-1.5 border border-red-200 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                >
                  Remove window 3
                </button>
              )}
            </div>
          </fieldset>

          {/* Photo upload */}
          <fieldset>
            <legend className="text-sm font-medium text-neutral-700 mb-3">Menu photos</legend>

            {/* Existing photo sets */}
            {photoSets.length > 0 && (
              <div className="space-y-3 mb-4">
                {photoSets.map((ps) => (
                  <div key={ps.id} className="border border-neutral-200 rounded-xl p-3">
                    <p className="text-xs text-neutral-500 mb-2">
                      Uploaded {formatUploadDate(ps.createdAt)}
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      {ps.photoUrls.map((url, i) => (
                        <div
                          key={i}
                          className="relative w-20 h-20 rounded-lg overflow-hidden border border-neutral-200 bg-neutral-100"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`Menu photo ${i + 1}`}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {photoSets.length === 0 && !selectedFiles.length && (
              <p className="text-xs text-neutral-400 mb-3">No photos uploaded yet.</p>
            )}

            {/* Pending selection */}
            {selectedFiles.length > 0 && (
              <div className="mb-3 border border-amber-300 bg-amber-50 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-amber-800">
                    {selectedFiles.length} photo{selectedFiles.length !== 1 ? 's' : ''} ready to upload
                  </p>
                  <button
                    type="button"
                    onClick={clearSelectedPhotos}
                    className="text-xs text-amber-700 hover:text-amber-900 underline"
                  >
                    Remove
                  </button>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {selectedFiles.map((file, i) => (
                    <div
                      key={i}
                      className="relative w-20 h-20 rounded-lg overflow-hidden border border-amber-300 bg-white"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={URL.createObjectURL(file)}
                        alt={`Selected ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* File input — styled as a button */}
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={handlePhotoFileChange}
                disabled={saving}
                className="hidden"
                id="photo-upload"
              />
              <label
                htmlFor="photo-upload"
                className={`inline-flex items-center gap-2 text-sm px-4 py-2 border border-neutral-300 rounded-xl cursor-pointer hover:border-neutral-400 transition-colors ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <svg className="w-4 h-4 text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-neutral-700">
                  {selectedFiles.length > 0 ? 'Choose different photos' : 'Add menu photos'}
                </span>
              </label>
              <p className="text-xs text-neutral-400 mt-1">JPEG, PNG, or WebP · up to 4 photos per upload</p>
            </div>
          </fieldset>

          {/* Save button */}
          <div className="flex items-center gap-3 pt-2 border-t border-neutral-100">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 text-sm font-medium text-white bg-amber-600 rounded-xl hover:bg-amber-700 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>

            {saveMessage && (
              <span className={`text-sm ${saveMessage.ok ? 'text-green-700' : 'text-red-700'}`}>
                {saveMessage.text}
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
