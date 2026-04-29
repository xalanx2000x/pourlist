'use client'
import { useEffect } from 'react'
import { getDeviceHash } from '@/lib/device'

const LAST_PING_KEY = 'lastPingTs'
const PING_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

export function usePresence() {
  useEffect(() => {
    const now = Date.now()
    const lastPing = localStorage.getItem(LAST_PING_KEY)
    if (lastPing && now - parseInt(lastPing) < PING_INTERVAL_MS) return

    const sessionId = sessionStorage.getItem('presenceSessionId')
      ?? (() => {
          const id = crypto.randomUUID()
          sessionStorage.setItem('presenceSessionId', id)
          return id
        })()

    navigator.sendBeacon('/api/presence', JSON.stringify({
      deviceHash: getDeviceHash(),
      sessionId,
    }))
    localStorage.setItem(LAST_PING_KEY, String(now))
  }, [])
}