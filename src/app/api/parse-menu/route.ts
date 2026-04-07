import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

/**
 * POST /api/parse-menu
 * Body: { imageUrl?: string, imageData?: string }
 * imageUrl = public URL to fetch ( Supabase Storage )
 * imageData = base64 encoded image data URL (sent directly from browser )
 * Returns: { text: string } — the extracted menu text
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { imageUrl, imageData } = body

    if (!imageUrl && !imageData) {
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
      // Fetch from URL and convert to base64 for OpenAI
      try {
        const fetchRes = await fetch(imageUrl, {
          headers: {
            // Supabase Storage public URLs
            'Accept': 'image/*'
          }
        })
        if (!fetchRes.ok) {
          return NextResponse.json({ error: `Failed to fetch image: ${fetchRes.status}` }, { status: 400 })
        }
        const buffer = await fetchRes.arrayBuffer()
        const base64 = Buffer.from(buffer).toString('base64')
        // Detect MIME from Content-Type header
        const contentType = fetchRes.headers.get('content-type') || 'image/jpeg'
        content.push({
          type: 'image_url',
          image_url: { url: `data:${contentType};base64,${base64}` }
        })
      } catch (fetchErr) {
        return NextResponse.json({ error: `Failed to fetch image: ${fetchErr}` }, { status: 400 })
      }
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 2048,
      messages: [{ role: 'user', content }]
    })

    const text = completion.choices[0]?.message?.content || ''

    return NextResponse.json({ text })
  } catch (err: unknown) {
    console.error('Menu parse error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
