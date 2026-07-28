import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  
  const cookieStore = await cookies()
  const raw = cookieStore.get('venue_access')?.value
  
  if (!raw) {
    return NextResponse.json({ step: 'no_cookie' })
  }
  
  const parts = raw.split('.')
  if (parts.length !== 3) {
    return NextResponse.json({ step: 'bad_cookie_format', parts: parts.length })
  }
  
  const [venueId, expiryStr, sig] = parts
  
  const password = process.env.SEED_PASSWORD
  const hasPassword = !!password
  
  const payload = `${venueId}.${expiryStr}`
  const crypto = require('crypto')
  const expectedSig = crypto.createHmac('sha256', password || '').update(payload).digest('hex')
  
  const sigMatch = sig === expectedSig
  
  // Try a simple DB query
  const { data, error } = await supabase
    .from('venues')
    .select('id')
    .limit(1)
  
  return NextResponse.json({
    step: 'probe',
    hasPassword,
    sigMatch,
    dbData: data,
    dbError: error?.message,
    expiryStr,
    expiryParsed: new Date(expiryStr).toISOString(),
    nowParsed: new Date().toISOString(),
    expiryValid: new Date(expiryStr) > new Date(),
  })
}
