'use client'

import { useState, useEffect } from 'react'
import { HHWindow, HHType, DAY_NAMES, formatHHTime, validateHHWindow } from '@/lib/parse-hh'

interface HHScheduleEditorProps {
  /**
   * Initial schedule from the parser.
   * null = no HH detected yet.
   */
  initialWindows: [HHWindow | null, HHWindow | null]
  /** Called when user confirms a valid schedule */
  onConfirm: (windows: [HHWindow | null, HHWindow | null]) => void
  /** "Looks good" was pressed — short-circuit re-validation */
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

function WindowEditor({
  window,
  index,
  onChange,
}: {
  window: HHWindow
  index: number
  onChange: (w: HHWindow) => void
}) {
  const toggleDay = (day: number) => {
    const days = window.days.includes(day)
      ? window.days.filter(d => d !== day)
      : [...window.days, day].sort((a, b) => a - b)
    onChange({ ...window, days })
  }

  const handleStartChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    onChange({ ...window, startMin: val === '' ? null : parseInt(val) })
  }

  const handleEndChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    onChange({ ...window, endMin: val === '' ? null : parseInt(val) })
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-3">
      {/* Type selector */}
      <div>
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          Window {index === 0 ? '1' : '2'}
        </label>
        <div className="flex flex-wrap gap-2 mt-1.5">
          {TYPE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ ...window, type: opt.value })}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                window.type === opt.value
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
          {[1, 2, 3, 4, 5, 6, 7].map(day => (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              className={`w-10 h-10 rounded-full text-sm font-medium border transition-colors ${
                window.days.includes(day)
                  ? 'bg-amber-500 border-amber-500 text-white'
                  : 'bg-white border-gray-200 text-gray-500 hover:border-amber-300'
              }`}
            >
              {DAY_NAMES[day - 1]}
            </button>
          ))}
        </div>
      </div>

      {/* Time selectors */}
      {window.type !== 'all_day' && (
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              {window.type === 'open_through' ? 'Opens at' : window.type === 'late_night' ? 'Starts at' : 'Start'}
            </label>
            <select
              value={window.startMin ?? ''}
              onChange={handleStartChange}
              className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
            >
              <option value="">—</option>
              {Array.from({ length: 48 }, (_, i) => {
                const min = i * 30
                const h = Math.floor(min / 60)
                const m = min % 60
                const period = h < 12 ? 'AM' : 'PM'
                const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h
                const label = `${hour12}:${m.toString().padStart(2, '0')} ${period}`
                return (
                  <option key={min} value={min}>{label}</option>
                )
              })}
            </select>
          </div>

          <span className="text-gray-400 mt-5">→</span>

          <div className="flex-1">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              {window.type === 'open_through' ? 'Until' : window.type === 'late_night' ? 'Closes at' : 'End'}
            </label>
            <select
              value={window.endMin ?? ''}
              onChange={handleEndChange}
              className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
            >
              <option value="">—</option>
              {Array.from({ length: 48 }, (_, i) => {
                const min = i * 30
                const h = Math.floor(min / 60)
                const m = min % 60
                const period = h < 12 ? 'AM' : 'PM'
                const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h
                const label = `${hour12}:${m.toString().padStart(2, '0')} ${period}`
                return (
                  <option key={min} value={min}>{label}</option>
                )
              })}
            </select>
          </div>
        </div>
      )}

      {/* Validation error */}
      {window.type && (
        <p className="text-xs text-red-500">
          {validateHHWindow(window)}
        </p>
      )}
    </div>
  )
}

export default function HHScheduleEditor({
  initialWindows,
  onConfirm,
  onAgreed,
}: HHScheduleEditorProps) {
  const [windows, setWindows] = useState<[HHWindow | null, HHWindow | null]>(
    initialWindows
  )
  const [agreed, setAgreed] = useState(false)
  const [touched, setTouched] = useState(false)

  // Check if editor has been touched
  const hasWindow = windows[0] !== null || windows[1] !== null

  function handleWindow1Change(w: HHWindow) {
    setWindows([w, windows[1]])
    setTouched(true)
    setAgreed(false)
  }

  function handleWindow2Change(w: HHWindow) {
    setWindows([windows[0], w])
    setTouched(true)
    setAgreed(false)
  }

  function addWindow2() {
    setWindows([windows[0], { type: 'typical', days: [], startMin: null, endMin: null }])
    setTouched(true)
  }

  function removeWindow2() {
    setWindows([windows[0], null])
    setTouched(true)
  }

  function handleConfirm() {
    // Validate
    const err1 = validateHHWindow(windows[0])
    const err2 = validateHHWindow(windows[1])
    if (err1 || err2) return
    onConfirm(windows)
  }

  // User has seen and agreed
  function handleAgree() {
    setAgreed(true)
    onAgreed()
  }

  // Total validation
  const err1 = validateHHWindow(windows[0])
  const err2 = validateHHWindow(windows[1])
  const hasError = !!err1 || !!err2

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
          <button
            type="button"
            onClick={handleAgree}
            className="text-xs text-amber-600 font-medium hover:text-amber-700"
          >
            ✓ Looks right
          </button>
        )}
        {agreed && (
          <span className="text-xs text-green-600 font-medium">✓ Confirmed</span>
        )}
      </div>

      {/* Window 1 */}
      {windows[0] !== null ? (
        <WindowEditor
          window={windows[0]}
          index={0}
          onChange={handleWindow1Change}
        />
      ) : (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center">
          <p className="text-sm text-gray-400">No happy hour detected in this menu.</p>
          <button
            type="button"
            onClick={() =>
              setWindows([{ type: 'typical', days: [], startMin: null, endMin: null }, null])
            }
            className="mt-2 text-sm text-amber-600 font-medium hover:text-amber-700"
          >
            + Add happy hour
          </button>
        </div>
      )}

      {/* Window 2 */}
      {windows[1] !== null && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Second Window</span>
            <button
              type="button"
              onClick={removeWindow2}
              className="text-xs text-gray-400 hover:text-red-500"
            >
              ✕ Remove
            </button>
          </div>
          <WindowEditor
            window={windows[1]}
            index={1}
            onChange={handleWindow2Change}
          />
        </div>
      )}

      {/* Add second window */}
      {windows[0] !== null && windows[1] === null && (
        <button
          type="button"
          onClick={addWindow2}
          className="w-full border-2 border-dashed border-gray-200 rounded-xl py-2.5 text-sm text-gray-500 hover:border-amber-300 hover:text-amber-600 transition-colors"
        >
          + Add second happy hour window
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
