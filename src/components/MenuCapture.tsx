'use client'

import { useState, useRef, useCallback } from 'react'
import { extractGpsFromPhoto, getBrowserLocation } from '@/lib/gps'

interface MenuCaptureProps {
  onCapture: (files: File[], gps: { lat: number; lng: number } | null) => void
  onClose: () => void
}

const MAX_PHOTOS = 4

export default function MenuCapture({ onCapture, onClose }: MenuCaptureProps) {
  const [files, setFiles] = useState<File[]>([])
  const [previewUrls, setPreviewUrls] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback(async (newFiles: File[]) => {
    const allFiles = [...files, ...newFiles]
    if (allFiles.length > MAX_PHOTOS) {
      setError(`Maximum ${MAX_PHOTOS} photos allowed.`)
      return
    }

    // Validate
    for (const f of allFiles) {
      const type = f.type.toLowerCase()
      const isImage = type.startsWith('image/')
      const isHeic = type === 'image/heic' || type === 'image/heif' || type === 'image/heif-compressed'
      if (!isImage && !isHeic) {
        setError('All files must be images.')
        return
      }
      if (f.size > 10 * 1024 * 1024) {
        setError('One or more photos is too large. Please use smaller files.')
        return
      }
    }

    const totalSize = allFiles.reduce((sum, f) => sum + f.size, 0)
    if (totalSize > 15 * 1024 * 1024) {
      setError('Total size of all photos is too large. Please select fewer photos.')
      return
    }

    setError('')
    setLoading(true)

    try {
      // Create preview URLs for new files only
      const existingUrls = previewUrls
      const newUrls = newFiles.map(f => URL.createObjectURL(f))
      setPreviewUrls([...existingUrls, ...newUrls])
      setFiles(allFiles)
    } finally {
      setLoading(false)
    }
  }, [files, previewUrls])

  function removeFile(index: number) {
    URL.revokeObjectURL(previewUrls[index])
    setFiles(prev => prev.filter((_, i) => i !== index))
    setPreviewUrls(prev => prev.filter((_, i) => i !== index))
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files
    if (selected?.length) {
      addFiles(Array.from(selected))
    }
    // Reset so same file can be re-selected
    e.target.value = ''
  }

  async function handleDone() {
    if (files.length === 0) return

    setLoading(true)
    setError('')

    try {
      // Try EXIF GPS from first photo first
      let gps: { lat: number; lng: number } | null = null
      try {
        gps = await extractGpsFromPhoto(files[0])
      } catch {
        // No EXIF GPS
      }

      // Fallback to browser location
      if (!gps) {
        try {
          gps = await getBrowserLocation()
        } catch {
          // Location unavailable
        }
      }

      onCapture(files, gps)
    } catch {
      setError('Could not read photos. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center">
      <div className="bg-white w-full max-w-md rounded-t-3xl p-5 pb-8 max-h-[90vh] flex flex-col overflow-hidden">
        {/* Handle */}
        <div className="flex justify-center mb-4 shrink-0">
          <div className="w-12 h-1 bg-gray-300 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex justify-between items-center mb-4 shrink-0">
          <h2 className="text-lg font-bold text-gray-900">Scan Menu</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center text-gray-500 text-lg leading-none"
          >
            ←
          </button>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg mb-3 shrink-0">{error}</p>
        )}

        {/* Instructions */}
        {files.length === 0 && (
          <p className="text-sm text-gray-500 mb-4 shrink-0">
            Take a photo of the happy hour menu. You can add up to 4 photos.
          </p>
        )}

        {/* Hidden camera input — opens camera directly on mobile (no file picker) */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*,image/heic,image/heif,image/heif-compressed"
          capture="environment"
          onChange={onFileInput}
          className="hidden"
        />

        {/* Photo strip — shown once at least 1 photo is added */}
        {files.length > 0 && (
          <div className="shrink-0 mb-4">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {previewUrls.map((url, i) => (
                <div key={i} className="relative shrink-0 group">
                  <img
                    src={url}
                    alt={`Menu page ${i + 1}`}
                    className="h-24 w-auto object-contain rounded-xl bg-gray-100"
                  />
                  <button
                    onClick={() => removeFile(i)}
                    className="absolute top-1 right-1 w-6 h-6 bg-black/60 hover:bg-red-600 text-white rounded-full flex items-center justify-center text-xs leading-none"
                  >
                    ✕
                  </button>
                  <span className="absolute bottom-1 left-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                    {i + 1}
                  </span>
                </div>
              ))}

              {/* "Add another" slot — also uses camera */}
              {files.length < MAX_PHOTOS && (
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={loading}
                  className="h-24 w-16 shrink-0 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-amber-500 hover:text-amber-500 transition-colors disabled:opacity-50"
                >
                  <span className="text-xl leading-none">+</span>
                  <span className="text-xs">Add</span>
                </button>
              )}
            </div>

            <p className="text-xs text-gray-400 mt-2 text-center">
              {files.length} of {MAX_PHOTOS} photos
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-auto space-y-3 shrink-0">
          {files.length === 0 ? (
            <>
              {/* Camera — opens directly on mobile, no file picker */}
              <button
                onClick={() => cameraInputRef.current?.click()}
                disabled={loading}
                className="w-full bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white py-4 px-6 rounded-xl font-semibold text-base flex items-center justify-center gap-3 transition-colors disabled:opacity-50"
              >
                <span className="text-xl">📷</span>
                Take a Photo
              </button>
            </>
          ) : (
            <>
              {/* Done button */}
              <button
                onClick={handleDone}
                disabled={loading || files.length === 0}
                className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white py-3.5 px-6 rounded-xl font-semibold text-base flex items-center justify-center gap-2 transition-colors"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Getting location...
                  </>
                ) : (
                  <>✓ Done — {files.length} photo{files.length > 1 ? 's' : ''}</>
                )}
              </button>

              {/* Retake */}
              <button
                onClick={onClose}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 px-4 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-colors"
              >
                Cancel
              </button>
            </>
          )}


        </div>
      </div>
    </div>
  )
}
