const STORAGE_KEY = 'pourlist_favorites'

function readStore(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('not an array')
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([]))
    } catch {
      // ignore
    }
    return []
  }
}

function writeStore(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // ignore
  }
}

export function getFavorites(): string[] {
  return readStore()
}

export function isFavorite(venueId: string): boolean {
  return readStore().includes(venueId)
}

export function addFavorite(venueId: string): void {
  const store = readStore()
  if (!store.includes(venueId)) {
    writeStore([...store, venueId])
  }
}

export function removeFavorite(venueId: string): void {
  writeStore(readStore().filter(id => id !== venueId))
}

export function toggleFavorite(venueId: string): boolean {
  const store = readStore()
  const isFav = store.includes(venueId)
  if (isFav) {
    writeStore(store.filter(id => id !== venueId))
  } else {
    writeStore([...store, venueId])
  }
  return !isFav
}

export function getFavoriteCount(): number {
  return readStore().length
}
