import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

/**
 * POST /api/parse-menu
 * Body: { imageUrl?: string, imageData?: string }
 * imageData = base64 data URL sent directly from browser (preferred)
 * imageUrl = public URL to fetch (fallback)
 * Returns: { text: string } — the extracted menu text
 */
export async function POST(req: NextRequest) {
  // 30-second timeout for the whole request
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  try {
    const body = await req.json()
    const { imageUrl, imageData } = body

    if (!imageUrl && !imageData) {
      clearTimeout(timeout)
      return NextResponse.json({ error: 'imageUrl or imageData is required' }, { status: 400 })
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
        const msg = fetchErr instanceof Error ? fetchErr.message : 'Unknown'
        return NextResponse.json({ error: `Failed to fetch image: ${msg}` }, { status: 400 })
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
