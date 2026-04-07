'use client'

import { useState, useRef } from 'react'
import { extractGpsFromPhoto, getBrowserLocation } from '@/lib/gps'

interface MenuCaptureProps {
  onCapture: (files: File[], gps: { lat: number; lng: number } | null) => void
  onClose: () => void
}

export default function MenuCapture({ onCapture, onClose }: MenuCaptureProps) {
  const [step, setStep] = useState<'choose' | 'preview'>('choose')
  const [files, setFiles] = useState<File[]>([])
  const [previewUrls, setPreviewUrls] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function processFiles(files: File[]) {
    if (!files.length) return

    // Validate all files
    for (const f of files) {
      const type = f.type.toLowerCase()
      const isImage = type.startsWith('image/')
      const isHeic = type === 'image/heic' || type === 'image/heif' || type === 'image/heif-compressed'
      if (!isImage && !isHeic) {
        setError('All files must be images.')
        return
      }
      // 10MB client-side limit — canvas resize in page.tsx will handle anything over ~3MB
      if (f.size > 10 * 1024 * 1024) {
        setError('One or more photos is too large. Please use smaller files.')
        return
      }
      // Total batch should be under ~15MB to avoid memory issues
      const totalSize = files.reduce((sum, file) => sum + file.size, 0)
      if (totalSize > 15 * 1024 * 1024) {
        setError('Total size of all photos is too large. Please select fewer photos.')
        return
      }
    }

    setLoading(true)
    setError('')

    try {
      // Generate preview URLs
      const urls = files.map(f => URL.createObjectURL(f))
      setPreviewUrls(urls)
      setFiles(files)

      // Try to extract GPS from EXIF of the first photo
      const gps = await extractGpsFromPhoto(files[0]).catch(() => null)

      // If no GPS in EXIF, try browser location
      const location = gps || await getBrowserLocation().catch(() => null)

      setStep('preview')
      onCapture(files, location)
    } catch (err) {
      setError('Could not read photos. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files
    if (selected?.length) {
      processFiles(Array.from(selected))
    }
  }

  function removeFile(index: number) {
    const newFiles = [...files]
    const newUrls = [...previewUrls]
    URL.revokeObjectURL(newUrls[index]) // free memory
    newFiles.splice(index, 1)
    newUrls.splice(index, 1)
    setFiles(newFiles)
    setPreviewUrls(newUrls)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center">
      <div className="bg-white w-full max-w-md rounded-t-3xl p-5 pb-8 max-h-[90vh] overflow-y-auto">
        {/* Handle */}
        <div className="flex justify-center mb-4">
          <div className="w-12 h-1 bg-gray-300 rounded-full" />
        </div>

        <div className="flex justify-between items-center mb-5">
          <h2 className="text-lg font-bold text-gray-900">Scan Menu</h2>
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
              Take photos of the happy hour menu pages, or select them from your gallery. You can add multiple pages at once.
            </p>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
            )}

            {/* Hidden file input — accepts multiple images, no capture attr = shows gallery on mobile */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,image/heic,image/heif,image/heif-compressed"
              multiple
              onChange={onFileInput}
              className="hidden"
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="w-full bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white py-4 px-6 rounded-xl font-semibold text-base flex items-center justify-center gap-3 transition-colors"
            >
              <span className="text-xl">📷</span>
              Take Photos / Choose from Gallery
            </button>

            <p className="text-xs text-gray-400 text-center">
              Select multiple photos to capture both pages of a two-sided menu
            </p>
          </div>
        )}

        {step === 'preview' && files.length > 0 && (
          <div>
            <p className="text-sm text-green-600 font-medium mb-3">
              ✓ {files.length} photo{files.length > 1 ? 's' : ''} ready
            </p>
            <div className="space-y-2 mb-3">
              {previewUrls.map((url, i) => (
                <div key={i} className="relative group">
                  <img
                    src={url}
                    alt={`Menu page ${i + 1}`}
                    className="w-full max-h-40 object-contain rounded-xl bg-gray-100"
                  />
                  <button
                    onClick={() => removeFile(i)}
                    className="absolute top-2 right-2 w-7 h-7 bg-black/60 hover:bg-black/80 text-white rounded-full flex items-center justify-center text-sm opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    ✕
                  </button>
                  {i > 0 && (
                    <span className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
                      Page {i + 1}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 text-center">
              All pages will be combined into one menu
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
