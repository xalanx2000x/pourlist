import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createHash } from 'crypto'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

export const runtime = 'nodejs'
export const maxBodySize = 2 * 1024 * 1024 // 2MB

/**
 * POST /api/parse-menu
 * Body: { imageUrl?: string, imageData?: string, deviceHash?: string }
 * imageData = base64 data URL sent directly from browser (preferred)
 * imageUrl = public URL to fetch (fallback)
 * deviceHash = client-provided device fingerprint (optional, used for rate limiting)
 * Returns: { text: string } — the extracted menu text
 */
export async function POST(req: NextRequest) {
  // 30-second timeout for the whole request
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  try {
    const body = await req.json()
    const { imageUrl, imageData, deviceHash } = body

    if (!imageUrl && !imageData) {
      clearTimeout(timeout)
      return NextResponse.json({ error: 'imageUrl or imageData is required' }, { status: 400 })
    }

    // Derive a device hash: use provided deviceHash, or hash the imageUrl/data as fallback
    const effectiveHash =
      deviceHash ||
      (imageUrl ? createHash('sha256').update(imageUrl).digest('hex') : null) ||
      (imageData ? createHash('sha256').update(imageData.slice(0, 200)).digest('hex') : null)

    // Server-side rate limit check (fail-open)
    if (effectiveHash) {
      try {
        const rateLimitRes = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL}/api/rate-limit-check`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'parse-menu', deviceHash: effectiveHash })
          }
        )
        if (rateLimitRes.ok) {
          const { allowed } = await rateLimitRes.json() as { allowed: boolean }
          if (!allowed) {
            clearTimeout(timeout)
            return NextResponse.json(
              { error: 'Too many requests. Please wait a moment before trying again.' },
              { status: 429 }
            )
          }
        }
      } catch {
        // Fail open — don't block parsing if rate-limit service is unreachable
      }
    }

    const content: (OpenAI.Chat.ChatCompletionContentPartText | OpenAI.Chat.ChatCompletionContentPartImage)[] = [
      {
        type: 'text',
        text: `You are a menu extraction assistant. The user has uploaded a photo of a happy hour menu. 
Extract ALL text from this menu exactly as it appears. Preserve:
- Drink names and prices
- Food items and prices  
- Happy hour times and days
- Any fine print or conditions

Format the output as clean text. If something is illegible, mark it as [illegible]. 
Do NOT add, interpret, or correct anything. Just extract what's there.`
      }
    ]

    if (imageData) {
      // base64 data URL sent directly from browser — use as-is
      content.push({
        type: 'image_url',
        image_url: { url: imageData }
      })
    } else if (imageUrl) {
      // Fallback: fetch from URL
      try {
        const fetchRes = await fetch(imageUrl, {
          headers: { 'Accept': 'image/*' },
          signal: controller.signal
        })
        if (!fetchRes.ok) {
          clearTimeout(timeout)
          return NextResponse.json({ error: `Failed to fetch image: ${fetchRes.status}` }, { status: 400 })
        }
        const buffer = await fetchRes.arrayBuffer()
        clearTimeout(timeout)
        const base64 = Buffer.from(buffer).toString('base64')
        const contentType = fetchRes.headers.get('content-type') || 'image/jpeg'
        content.push({
          type: 'image_url',
          image_url: { url: `data:${contentType};base64,${base64}` }
        })
      } catch (fetchErr: unknown) {
        clearTimeout(timeout)
        console.error('Failed to fetch image:', fetchErr)
        return NextResponse.json({ error: 'Failed to fetch image' }, { status: 400 })
      }
    }

    const completion = await openai.chat.completions.create(
      {
        model: 'gpt-4o-mini',
        max_tokens: 2048,
        messages: [{ role: 'user', content }]
      },
      { signal: controller.signal }
    )

    clearTimeout(timeout)
    const text = completion.choices[0]?.message?.content || ''
    return NextResponse.json({ text })
  } catch (err: unknown) {
    clearTimeout(timeout)
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Menu parse error:', err)
    if (message.includes('aborted')) {
      return NextResponse.json({ error: 'Request timed out. Please try again.' }, { status: 504 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
