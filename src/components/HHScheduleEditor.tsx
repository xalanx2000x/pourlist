'use client'

import { useState } from 'react'
import { HHWindow, HHType, DAY_NAMES, formatHHTime, validateHHWindow } from '@/lib/parse-hh'

interface HHScheduleEditorProps {
  initialWindows: [HHWindow | null, HHWindow | null, HHWindow | null]
  onConfirm: (windows: [HHWindow | null, HHWindow | null, HHWindow | null]) => void
  onAgreed: () => void
}

const TYPE_LABELS: Record<string, string> = {
  all_day: '💍 All Day',
  open_through: '🕐 Open Through',
  typical: '⏰ Typical',
  late_night: '🌙 Late Night',
}

const TYPE_OPTIONS: { value: HHType; label: string }[] = [
  { value: 'typical', label: TYPE_LABELS.typical },
  { value: 'all_day', label: TYPE_LABELS.all_day },
  { value: 'open_through', label: TYPE_LABELS.open_through },
  { value: 'late_night', label: TYPE_LABELS.late_night },
]

const TIMES = Array.from({ length: 48 }, (_, i) => {
  const min = i * 30
  const h = Math.floor(min / 60)
  const m = min % 60
  const period = h < 12 ? 'AM' : 'PM'
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  const label = `${hour12}:${m.toString().padStart(2, '0')} ${period}`
  return { value: min, label }
})

function WindowEditor({
  window: w,
  index,
  onChange,
}: {
  window: HHWindow
  index: number
  onChange: (w: HHWindow) => void
}) {
  const toggleDay = (day: number) => {
    const days = w.days.includes(day)
      ? w.days.filter(d => d !== day)
      : [...w.days, day].sort((a, b) => a - b)
    onChange({ ...w, days })
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-3">
      {/* Type selector */}
      <div>
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          Window {index + 1}
        </label>
        <div className="flex flex-wrap gap-2 mt-1.5">
          {TYPE_OPTIONS.map(opt => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => onChange({ ...w, type: opt.value })}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                w.type === opt.value
                  ? 'bg-amber-100 border-amber-400 text-amber-800'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Day selector */}
      <div>
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Days</label>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {DAY_NAMES.map((name, i) => {
            const day = i + 1
            const excluded = w.excludeDays?.includes(day)
            return (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className={`w-10 h-10 rounded-full text-sm font-medium border transition-colors ${
                  w.days.includes(day)
                    ? 'bg-amber-500 border-amber-500 text-white'
                    : excluded
                      ? 'bg-gray-100 border-gray-300 text-gray-400 line-through'
                      : 'bg-white border-gray-200 text-gray-500 hover:border-amber-300'
                }`}
              >
                {name}
              </button>
            )
          })}
        </div>
        {w.days.length === 0 && (
          <p className="text-xs text-gray-400 mt-1">All days — tap above to select specific days</p>
        )}
      </div>

      {/* Time selectors */}
      {w.type !== 'all_day' && (
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              {w.type === 'open_through' ? 'Opens at' : w.type === 'late_night' ? 'Starts at' : 'Start'}
            </label>
            <select
              value={w.startMin ?? ''}
              onChange={e => onChange({ ...w, startMin: e.target.value === '' ? null : parseInt(e.target.value) })}
              className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
            >
              <option value="">—</option>
              {TIMES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <span className="text-gray-400 mt-5">→</span>

          <div className="flex-1">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              {w.type === 'open_through' ? 'Until' : w.type === 'late_night' ? 'Closes at' : 'End'}
            </label>
            <select
              value={w.endMin ?? ''}
              onChange={e => onChange({ ...w, endMin: e.target.value === '' ? null : parseInt(e.target.value) })}
              className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
            >
              <option value="">—</option>
              {TIMES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Validation error */}
      {w.type && (
        <p className="text-xs text-red-500">{validateHHWindow(w)}</p>
      )}
    </div>
  )
}

function makeEmptyWindow(): HHWindow {
  return { type: 'typical', days: [], excludeDays: [], startMin: null, endMin: null }
}

export default function HHScheduleEditor({
  initialWindows,
  onConfirm,
  onAgreed,
}: HHScheduleEditorProps) {
  const [windows, setWindows] = useState(initialWindows)
  const [agreed, setAgreed] = useState(false)
  const [touched, setTouched] = useState(false)

  const activeWindows = windows.filter(w => w !== null)
  const hasWindow = activeWindows.length > 0

  function setWindow(index: number, w: HHWindow | null) {
    const next = [...windows] as [HHWindow | null, HHWindow | null, HHWindow | null]
    next[index] = w
    setWindows(next)
    setTouched(true)
    setAgreed(false)
  }

  function addWindow() {
    // Find first null slot
    const idx = windows.findIndex(w => w === null)
    if (idx !== -1) setWindow(idx, makeEmptyWindow())
    setTouched(true)
  }

  function removeWindow(index: number) {
    setWindow(index, null)
    setTouched(true)
  }

  function handleConfirm() {
    const errors = windows.map(w => w ? validateHHWindow(w) : null)
    if (errors.some(e => e !== null)) return
    onConfirm(windows)
  }

  function handleAgree() {
    setAgreed(true)
    onAgreed()
  }

  const errors = windows.map(w => w ? validateHHWindow(w) : null)
  const hasError = errors.some(e => e !== null)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-800">Happy Hour Schedule</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {hasWindow
              ? 'Edit if the parser got it wrong'
              : 'No happy hour detected — add one below if applicable'}
          </p>
        </div>
        {!agreed && hasWindow && !touched && (
          <button type="button" onClick={handleAgree} className="text-xs text-amber-600 font-medium hover:text-amber-700">
            ✓ Looks right
          </button>
        )}
        {agreed && <span className="text-xs text-green-600 font-medium">✓ Confirmed</span>}
      </div>

      {/* Window editors (up to 3) */}
      {windows.map((w, i) => (
        w !== null && (
          <div key={i} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                Window {i + 1} {i === 0 ? '(Primary)' : i === 1 ? '(Second)' : '(Third)'}
              </span>
              <button
                type="button"
                onClick={() => removeWindow(i)}
                className="text-xs text-gray-400 hover:text-red-500"
              >
                ✕ Remove
              </button>
            </div>
            <WindowEditor
              window={w}
              index={i}
              onChange={newW => setWindow(i, newW)}
            />
          </div>
        )
      ))}

      {/* Add window button — shown when there are fewer than 3 active windows */}
      {windows.filter(w => w !== null).length < 3 && (
        <button
          type="button"
          onClick={addWindow}
          className="w-full border-2 border-dashed border-gray-200 rounded-xl py-2.5 text-sm text-gray-500 hover:border-amber-300 hover:text-amber-600 transition-colors"
        >
          + Add happy hour window
        </button>
      )}

      {/* Confirm button */}
      {touched && windows[0] !== null && (
        <button
          type="button"
          onClick={handleConfirm}
          disabled={hasError}
          className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-gray-200 disabled:text-gray-400 text-white py-2.5 rounded-xl font-semibold text-sm transition-colors"
        >
          {hasError ? 'Fix errors above' : '✓ Confirm happy hour'}
        </button>
      )}
    </div>
  )
}