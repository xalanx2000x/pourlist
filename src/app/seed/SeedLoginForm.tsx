'use client'

import { useState } from 'react'

/**
 * Password entry for /seed. Submits to /api/seed/login. On success, the
 * server sets an httpOnly cookie and the parent server component will render
 * the tool on next request. So we just window.location.reload() after a
 * successful login — server re-render reads the cookie.
 */
export default function SeedLoginForm() {
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/seed/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.success) {
        // Cookie is set by server. Reload so the server component sees it.
        window.location.reload()
        return
      }
      const reason: string = data?.reason ?? 'unknown'
      if (reason === 'invalid_password') {
        setError('Wrong password.')
      } else if (reason === 'server_misconfigured') {
        setError('Server is missing SEED_PASSWORD env var. Check Vercel config.')
      } else if (reason === 'missing_password') {
        setError('Enter a password.')
      } else {
        setError(`Login failed: ${reason}`)
      }
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-white border border-neutral-200 rounded-lg p-6 shadow-sm"
      >
        <h1 className="text-lg font-semibold text-neutral-900 mb-1">/seed</h1>
        <p className="text-sm text-neutral-600 mb-4">
          Admin god-mode tool. Password required.
        </p>
        <label htmlFor="seed-pw" className="block text-xs font-medium text-neutral-700 mb-1">
          Password
        </label>
        <input
          id="seed-pw"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          className="w-full px-3 py-2 text-sm border border-neutral-300 rounded focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:bg-neutral-100"
        />
        {error && (
          <p className="mt-2 text-sm text-red-600">{error}</p>
        )}
        <button
          type="submit"
          disabled={submitting || password.length === 0}
          className="mt-4 w-full px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded hover:bg-amber-700 disabled:bg-neutral-300 disabled:cursor-not-allowed"
        >
          {submitting ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  )
}