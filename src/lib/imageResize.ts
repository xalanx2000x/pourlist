import heic2any from 'heic2any'

const HEIC_MIME_TYPES = ['image/heic', 'image/heif', 'image/heif-compressed']

/**
 * Returns true if the given MIME type is a HEIC/HEIF variant.
 */
function isHeic(mime: string): boolean {
  return HEIC_MIME_TYPES.includes(mime.toLowerCase())
}

/**
 * Reads a File and returns a base64 JPEG data URL.
 * Handles HEIC → JPEG conversion via heic2any first.
 * If the image is over maxSizeMB, it will be resized via canvas before encoding.
 */
export async function fileToBase64(file: File, maxSizeMB = 0.5): Promise<string> {
  return new Promise((resolve, reject) => {
    const processFile = (blob: Blob) => {
      const img = new Image()
      const url = URL.createObjectURL(blob)

      img.onload = () => {
        URL.revokeObjectURL(url)

        // Check file size — if under the limit, encode directly
        if (blob.size <= maxSizeMB * 1024 * 1024) {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(img, 0, 0)
          resolve(canvas.toDataURL('image/jpeg', 0.85))
          return
        }

        // Oversized — resize to fit within maxSizeMB at ~85% JPEG quality
        const targetBytes = maxSizeMB * 1024 * 1024
        const currentPixels = img.naturalWidth * img.naturalHeight
        const currentBytes = currentPixels * 3 * 0.4
        let scale = Math.sqrt(targetBytes / currentBytes)

        // Don't upscale
        if (scale > 1) scale = 1

        const newWidth = Math.round(img.naturalWidth * scale)
        const newHeight = Math.round(img.naturalHeight * scale)

        const canvas = document.createElement('canvas')
        canvas.width = newWidth
        canvas.height = newHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, newWidth, newHeight)

        // Try at 85% first, reduce quality if still too big
        let quality = 0.85
        let dataUrl = canvas.toDataURL('image/jpeg', quality)

        while (dataUrl.length > maxSizeMB * 1024 * 1024 * 1.37 && quality > 0.3) {
          quality -= 0.1
          dataUrl = canvas.toDataURL('image/jpeg', quality)
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
      // Convert HEIC → JPEG first
      heic2any({ blob: file, toType: 'image/jpeg' })
        .then((converted) => {
          const jpegBlob = Array.isArray(converted) ? converted[0] : converted
          processFile(jpegBlob as Blob)
        })
        .catch((err: Error) => reject(new Error(`HEIC conversion failed: ${err.message}`)))
    } else {
      processFile(file)
    }
  })
}
