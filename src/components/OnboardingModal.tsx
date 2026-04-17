'use client'

import { useState, useEffect } from 'react'
import { trackEvent } from '@/lib/analytics'
import { getDeviceHash } from '@/lib/device'

interface OnboardingModalProps {
  onClose: () => void
}

const STEPS = [
  {
    emoji: '📍',
    title: 'Find happy hour venues',
    body: 'Browse the map or list to discover bars and restaurants with active happy hour deals near you.',
  },
  {
    emoji: '📷',
    title: 'Scan a menu',
    body: 'Tap "Scan Menu" to photograph a menu. The app reads the text and finds the venue automatically.',
  },
  {
    emoji: '💾',
    title: 'It saves instantly',
    body: 'Menu text is stored permanently. No account needed — your device is your identity.',
  },
]

export default function OnboardingModal({ onClose }: OnboardingModalProps) {
  const [step, setStep] = useState(0)

  function handleNext() {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1)
    } else {
      try { localStorage.setItem('pourlist_onboarding_seen', '1') } catch {}
      trackEvent('onboarding_complete', { deviceHash: getDeviceHash() })
      onClose()
    }
  }

  function handleSkip() {
    try { localStorage.setItem('pourlist_onboarding_seen', '1') } catch {}
    trackEvent('onboarding_skip', { deviceHash: getDeviceHash() })
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden">
        {/* Top accent bar */}
        <div className="h-1.5 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600" />

        <div className="p-6">
          {/* Step indicator */}
          <div className="flex items-center justify-center gap-1.5 mb-6">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === step
                    ? 'w-6 bg-amber-500'
                    : i < step
                    ? 'w-1.5 bg-amber-300'
                    : 'w-1.5 bg-gray-200'
                }`}
              />
            ))}
          </div>

          {/* Content */}
          <div className="text-center mb-6">
            <div className="text-5xl mb-4">{STEPS[step].emoji}</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">{STEPS[step].title}</h2>
            <p className="text-sm text-gray-600 leading-relaxed">{STEPS[step].body}</p>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            {step > 0 && (
              <button
                onClick={() => setStep(s => s - 1)}
                className="flex-1 py-3 px-4 rounded-xl text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                Back
              </button>
            )}
            <button
              onClick={handleNext}
              className="flex-1 py-3 px-4 rounded-xl text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 transition-colors"
            >
              {step < STEPS.length - 1 ? 'Next →' : 'Got it!'}
            </button>
          </div>

          {/* Skip */}
          <button
            onClick={handleSkip}
            className="w-full text-xs text-gray-400 hover:text-gray-600 mt-3 py-1"
          >
            Skip tour
          </button>
        </div>
      </div>
    </div>
  )
}

// Hook: returns true the first time, then false (reads from localStorage)
export function useOnboarding(): boolean {
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem('pourlist_onboarding_seen')) {
        setSeen(true)
      }
    } catch {
      setSeen(true) // default to showing if localStorage fails
    }
  }, [])

  return seen
}