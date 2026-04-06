'use client'

import { useState, useRef } from 'react'
import { extractGpsFromPhoto, getBrowserLocation } from '@/lib/gps'

interface MenuCaptureProps {
  onCapture: (file: File, gps: { lat: number; lng: number } | null) => void
  onClose: () => void
}

export default function MenuCapture({ onCapture, onClose }: MenuCaptureProps) {
  const [step, setStep] = useState<'choose' | 'camera' | 'preview'>('choose')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Photo is too large. Please use a smaller file.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const url = URL.createObjectURL(file)
      setPreviewUrl(url)
      setFile(file)

      // Try to extract GPS from EXIF
      const gps = await extractGpsFromPhoto(file).catch(() => null)

      // If no GPS in EXIF, try browser location
      const location = gps || await getBrowserLocation().catch(() => null)

      setStep('preview')
      onCapture(file, location)
    } catch (err) {
      setError('Could not read photo. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }

  function onCameraCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center">
      <div className="bg-white w-full max-w-md rounded-t-3xl p-5 pb-8">
        {/* Handle */}
        <div className="flex justify-center mb-4">
          <div className="w-12 h-1 bg-gray-300 rounded-full" />
        </div>

        <div className="flex justify-between items-center mb-5">
          <h2 className="text-lg font-bold text-gray-900">Scan a Menu</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-200"
          >
            ✕
          </button>
        </div>

        {step === 'choose' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500 mb-4">
              Take a clear photo of the happy hour menu or select one from your gallery.
            </p>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
            )}

            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onCameraCapture}
              className="hidden"
            />

            <button
              onClick={() => cameraRef.current?.click()}
              disabled={loading}
              className="w-full bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white py-4 px-6 rounded-xl font-semibold text-base flex items-center justify-center gap-3 transition-colors"
            >
              <span className="text-xl">📷</span>
              Take Photo
            </button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400">or</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={onFileInput}
              className="hidden"
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="w-full bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-700 py-3.5 px-6 rounded-xl font-medium text-base flex items-center justify-center gap-3 transition-colors"
            >
              <span className="text-xl">🖼️</span>
              Choose from Gallery
            </button>
          </div>
        )}

        {step === 'preview' && file && (
          <div>
            <p className="text-sm text-green-600 font-medium mb-2">✓ Photo ready</p>
            <img
              src={previewUrl}
              alt="Menu preview"
              className="w-full max-h-64 object-contain rounded-xl bg-gray-100 mb-3"
            />
            <p className="text-xs text-gray-400 text-center">
              Menu text will be extracted and shown for confirmation
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
