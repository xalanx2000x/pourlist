'use client'

import { useState, useEffect } from 'react'
import { HHWindow, parseHHSchedule, parseOneClause } from '@/lib/parse-hh'

interface HHScheduleInputProps {
  /** Pre-populated value for box 1 (from AI-parsed menu text, can be blank) */
  initialBox1?: string | null
  /** Called whenever the parsed result changes — use this to keep parent in sync */
  onChange?: (windows: [HHWindow | null, HHWindow | null, HHWindow | null]) => void
  /** Called when user clicks "Confirm Happy Hour" — passes both windows and the raw user input text */
  onCommit: (windows: [HHWindow | null, HHWindow | null, HHWindow | null], hhSummary: string) => void
}

interface ParseResult {
  windows: [HHWindow | null, HHWindow | null, HHWindow | null]
  rawText: string
}

/**
 * Parse late-night text: always type=late_night.
 */
function parseLateNight(text: string): HHWindow | null {
  const result = parseOneClause(text)
  if (!result) return null
  return { ...result, type: 'late_night' }
}

/**
 * Preview component: shows parsed windows as human-readable text.
 */
function WindowsPreview({ windows }: { windows: HHWindow[] }) {
  const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  function fmtTime(startMin: number | null, endMin: number | null): string {
    const fmt = (m: number | null) => {
      if (m === null) return '—'
      const h = Math.floor(m / 60)
      const min = m % 60
      const period = h < 12 ? 'AM' : 'PM'
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
      return `${h12}:${min.toString().padStart(2, '0')} ${period}`
    }
    if (startMin === null && endMin === null) return 'All day'
    if (startMin === null) return `Until ${fmt(endMin)}`
    if (endMin === null) return `From ${fmt(startMin)} → close`
    return `${fmt(startMin)} – ${fmt(endMin)}`
  }

  function fmtDays(days: number[]): string {
    if (days.length === 0) return 'All days'
    if (days.length === 7) return 'Every day'
    if (days.length === 5 && days.join(',') === '1,2,3,4,5') return 'Weekdays'
    if (days.length === 2 && days.join(',') === '6,7') return 'Weekends'
    return days.map(d => DAY_SHORT[d - 1]).join(', ')
  }

  function typeLabel(type: string | null): string {
    if (type === 'all_day') return '💍 All day'
    if (type === 'open_through') return '🕐 Open through'
    if (type === 'late_night') return '🌙 Late night'
    if (type === 'typical') return '⏰ Happy hour'
    return '—'
  }

  if (windows.length === 0) return null

  return (
    <div className="space-y-1.5">
      {windows.map((w, i) => (
        <div key={i} className="flex items-start gap-2 text-sm">
          <span className="text-gray-400 mt-0.5">{typeLabel(w.type)}</span>
          <div>
            <span className="text-gray-700 font-medium">{fmtDays(w.days)}</span>
            <span className="text-gray-500 ml-2">{fmtTime(w.startMin, w.endMin)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function HHScheduleInput({ initialBox1, onChange, onCommit }: HHScheduleInputProps) {
  // Box 1 starts blank — don't pre-populate from initialBox1 (AI text can be wrong)
  const [box1, setBox1] = useState('')
  const [box2, setBox2] = useState('')
  const [hasLateNight, setHasLateNight] = useState(false)
  const [box1Error, setBox1Error] = useState('')
  const [box2Error, setBox2Error] = useState('')

  // Live preview: parse box1 on every keystroke for immediate feedback
  const result1: ParseResult = (() => {
    if (!box1.trim()) return { windows: [null, null, null], rawText: '' }
    try {
      return parseHHSchedule(box1)
    } catch {
      return { windows: [null, null, null], rawText: box1 }
    }
  })()

  const w2: HHWindow | null = hasLateNight && box2.trim()
    ? (() => {
        try { return parseLateNight(box2) } catch { return null }
      })()
    : null

  // Build the merged windows for preview and for commit
  function buildWindows(): [HHWindow | null, HHWindow | null, HHWindow | null] {
    const w1 = result1.windows[0]
    const w2from1 = result1.windows[1]
    const w3from1 = result1.windows[2]

    const final: [HHWindow | null, HHWindow | null, HHWindow | null] = [null, null, null]

    // Box 1 windows first
    if (w1) final[0] = w1
    if (w2from1) final[1] = w2from1
    if (w3from1) final[2] = w3from1

    // Box 2 late night: inject into first available slot
    if (w2) {
      if (!final[0]) final[0] = w2
      else if (!final[1]) final[1] = w2
      else final[2] = w2
    }

    return final
  }

  // Compute preview once (after buildWindows is defined)
  const previewFinal = buildWindows()
  const previewWindows = previewFinal.filter(w => w !== null) as HHWindow[]

  // Live error: fires on every keystroke when box1 has text but parser returns nothing
  useEffect(() => {
    if (box1.trim() && !result1.windows.some(w => w !== null)) {
      setBox1Error("Couldn't understand — try 'M-F 4-6' or '4-7pm'")
    } else {
      setBox1Error('')
    }
  }, [box1, result1])

  function buildHhSummary(): string {
    const parts: string[] = []
    if (box1.trim()) parts.push(box1.trim())
    if (hasLateNight && box2.trim()) parts.push(box2.trim())
    return parts.join(' · ')
  }

  // Manual commit trigger (used by parent Save button flow via hhWindows state)
  function handleCommit() {
    setBox1Error('')
    setBox2Error('')

    if (box1.trim() && !result1.windows.some(w => w !== null)) {
      setBox1Error('No valid happy hour found in the text above.')
      return
    }

    if (hasLateNight && box2.trim() && w2 === null) {
      setBox2Error('Could not parse. Try "10pm-close" or "10-close".')
      return
    }

    onCommit(buildWindows(), buildHhSummary())
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-gray-800">When is Happy Hour?</h3>
      </div>

      {/* Box 1: Typical HH */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Typical Happy Hour
        </label>
        <input
          type="text"
          value={box1}
          onChange={e => { setBox1(e.target.value); setBox1Error('') }}
          placeholder='e.g. M-F 4-6, W all day'
          className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none ${
            box1Error ? 'border-red-400' : 'border-gray-300'
          }`}
        />
        {box1Error ? (
          <p className="text-xs text-red-500 mt-1">{box1Error}</p>
        ) : (
          <p className="text-xs text-gray-400 mt-1">
            Examples: &ldquo;M-F 4-6&rdquo;, &ldquo;Daily 2-5pm, Sat all day&rdquo;, &ldquo;4-7pm&rdquo;
          </p>
        )}
      </div>

      {/* Preview: shown only when there's parsed output */}
      {previewWindows.length > 0 && (
        <div className="bg-gray-50 rounded-xl px-3 py-2.5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Preview</p>
          <WindowsPreview windows={previewWindows} />
        </div>
      )}

      {/* Late night toggle */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={hasLateNight}
            onChange={e => setHasLateNight(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-500"
          />
          <span className="text-sm text-gray-700">This venue has a late night happy hour</span>
        </label>
      </div>

      {/* Box 2: Late Night */}
      {hasLateNight && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Late Night Happy Hour
          </label>
          <input
            type="text"
            value={box2}
            onChange={e => { setBox2(e.target.value); setBox2Error('') }}
            placeholder='e.g. 10pm-close, 9-close'
            className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none ${
              box2Error ? 'border-red-400' : 'border-gray-300'
            }`}
          />
          {box2Error ? (
            <p className="text-xs text-red-500 mt-1">{box2Error}</p>
          ) : (
            <p className="text-xs text-gray-400 mt-1">
              Examples: &ldquo;10pm-close&rdquo;, &ldquo;10-1am&rdquo;, &ldquo;9-close&rdquo;
            </p>
          )}
        </div>
      )}



      </div>
  )
}
