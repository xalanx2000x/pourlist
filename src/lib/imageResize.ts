/**
 * Reads a File and returns a base64 data URL.
 * If the image is over maxSizeMB, it will be resized via canvas before encoding.
 */
export async function fileToBase64(file: File, maxSizeMB = 3): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)

      // Check file size — if under the limit, encode directly
      if (file.size <= maxSizeMB * 1024 * 1024) {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
        return
      }

      // Oversized — resize to fit within maxSizeMB at ~85% JPEG quality
      // Estimate: target bytes = maxSizeMB * 1024 * 1024
      // Rough area = target_bytes / 0.4 (JPEG at 85% quality is ~40% of RGB pixel count)
      const targetBytes = maxSizeMB * 1024 * 1024
      const currentPixels = img.naturalWidth * img.naturalHeight
      // jpeg bytes ≈ pixels * 3 * quality_factor (0.4 for 85%)
      // scale = sqrt(target / current)
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

      // Try at 85% first, check size, reduce quality if still too big
      let quality = 0.85
      let dataUrl = canvas.toDataURL('image/jpeg', quality)

      // If still over limit (shouldn't happen after scale, but be safe), reduce quality
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
  })
}
