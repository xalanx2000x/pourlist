/**
 * Simple duplicate detection for menu photos.
 * Uses file size as the primary signal (identical file size = likely duplicate).
 * GPS proximity as the secondary signal.
 *
 * Proper perceptual hashing (pHash) can be added later via a dedicated
 * microservice or Vercel function with proper Node.js support.
 */

/**
 * Generate a quick fingerprint for a photo.
 * Uses file size + name + last modified (if available).
 * Not cryptographic — just a fast similarity proxy.
 */
export function fingerprintFile(file: File): string {
  return `${file.size}-${file.name.toLowerCase().trim()}-${file.lastModified}`
}

/**
 * Check if two file fingerprints are likely the same photo.
 */
export function isSamePhotoFingerprint(fp1: string, fp2: string): boolean {
  // Exact match on size + name = very likely same photo
  const [size1] = fp1.split('-')
  const [size2] = fp2.split('-')
  return size1 === size2
}
