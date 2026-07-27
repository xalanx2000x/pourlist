'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  token: string
  initialVenueId: string | null
}

export default function ClaimRedirectClient({ token, initialVenueId }: Props) {
  const router = useRouter()

  useEffect(() => {
    if (!initialVenueId) {
      // Token invalid — rendered server-side, no client action needed
      return
    }

    // POST to internal verify route: sets cookie server-side then redirects
    fetch('/api/claim/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).then(res => {
      if (res.ok) {
        // Successful redirect to /manage
        router.replace('/manage')
      } else {
        // Something went wrong — show invalid page
        router.replace('/claim/' + token + '?invalid=1')
      }
    }).catch(() => {
      router.replace('/claim/' + token + '?invalid=1')
    })
  }, [initialVenueId, token, router])

  // Server pre-check already determined the token is invalid
  if (!initialVenueId) {
    return <InvalidPage />
  }

  // Loading state while the redirect fetch is in flight
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#fafafa',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: '1.5rem',
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        padding: '2.5rem',
        maxWidth: '420px',
        width: '100%',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🔒</div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111', marginBottom: '0.5rem' }}>
          Verifying your link…
        </h1>
        <p style={{ fontSize: '0.9rem', color: '#6b7280' }}>
          Hang on just a moment.
        </p>
      </div>
    </div>
  )
}

function InvalidPage() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#fafafa',
      fontFamily: 'system-ui, sans-serif',
      padding: '1rem',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: '1.5rem',
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        padding: '2.5rem',
        maxWidth: '420px',
        width: '100%',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🔒</div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111', marginBottom: '0.5rem' }}>
          Link no longer valid
        </h1>
        <p style={{ fontSize: '0.9rem', color: '#6b7280', lineHeight: 1.6 }}>
          This link has expired or been revoked.<br />
          Contact us to request a new one.
        </p>
      </div>
    </div>
  )
}
