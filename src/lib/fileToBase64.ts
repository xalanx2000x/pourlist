'use client'

// Module-level cache so the dynamic import only fires once per page load
let _heic2any: typeof import('heic2any').default | null = null
let _importFailed = false

/** Lazy-load heic2any on first use. Throws 'chunk_load_failed' if the chunk
 *  cannot be fetched (e.g. offline). The tag lets callers identify this failure. */
async function lazyHeic2any() {
  if (_importFailed) throw new Error('chunk_load_failed')
  if (_heic2any) return _heic2any

  try {
    const mod = await import('heic2any' as string)
    _heic2any = mod.default ?? mod
    return _heic2any
  } catch {
    _importFailed = true
    throw new Error('chunk_load_failed')
  }
}

const HEIC_MIME_TYPES = ['image/heic', 'image/heif', 'image/heif-compressed']

function isHeic(mime: string): boolean {
  return HEIC_MIME_TYPES.includes(mime.toLowerCase())
}

/**
 * Reads a File and returns a base64 JPEG data URL.
 * ALL images are re-encoded as JPEG via canvas — normalizes HEIC/WebP etc.
 * Images exceeding maxSizeMB are resized before encoding.
 * Falls back with 'chunk_load_failed' if heic2any cannot be loaded (offline).
 */
export async function fileToBase64(file: File, maxSizeMB = 1.5): Promise<string> {
  return new Promise((resolve, reject) => {
    const processFile = (blob: Blob) => {
      const img = new Image()
      const url = URL.createObjectURL(blob)

      img.onload = () => {
        URL.revokeObjectURL(url)

        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)

        const encode = (quality: number) =>
          canvas.toDataURL('image/jpeg', quality)

        if (blob.size <= maxSizeMB * 1024 * 1024) {
          resolve(encode(0.85))
          return
        }

        const targetBytes = maxSizeMB * 1024 * 1024
        const currentPixels = img.naturalWidth * img.naturalHeight
        const currentBytes = currentPixels * 3 * 0.4
        let scale = Math.sqrt(targetBytes / currentBytes)
        if (scale > 1) scale = 1

        canvas.width = Math.round(img.naturalWidth * scale)
        canvas.height = Math.round(img.naturalHeight * scale)
        ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, canvas.width, canvas.height)

        let quality = 0.85
        let dataUrl = encode(quality)
        while (dataUrl.length > maxSizeMB * 1024 * 1024 * 1.37 && quality > 0.3) {
          quality -= 0.1
          dataUrl = encode(quality)
        }

        resolve(dataUrl)
      }

      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('Failed to load image'))
      }

      img.src = url
    }

    if (isHeic(file.type)) {
      lazyHeic2any()
        .then((heic2any) => {
          return (heic2any as NonNullable<typeof heic2any>)({ blob: file, toType: 'image/jpeg' })
        })
        .then((converted) => {
          const jpegBlob = Array.isArray(converted) ? converted[0] : converted
          processFile(jpegBlob as Blob)
        })
        .catch((err: Error) => {
          const msg = err.message === 'chunk_load_failed'
            ? 'chunk_load_failed'
            : `HEIC conversion failed: ${err.message}`
          reject(new Error(msg))
        })
    } else {
      processFile(file)
    }
  })
}
