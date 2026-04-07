import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

/**
 * POST /api/parse-menu
 * Body: { imageUrl: string } — public URL to the image in Supabase Storage
 * Returns: { text: string } — the extracted menu text
 */
export async function POST(req: NextRequest) {
  try {
    const { imageUrl } = await req.json()

    if (!imageUrl) {
      return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 })
    }

    // Fetch the image and convert to base64 so OpenAI can process it
    // (Passing a URL doesn't work reliably since OpenAI's servers may not be able to reach Supabase Storage)
    let imageData: ArrayBuffer | null = null
    let fetchFailed = false
    try {
      console.log('[parse-menu] Fetching image from:', imageUrl)
      const fetchRes = await fetch(imageUrl)
      console.log('[parse-menu] Fetch status:', fetchRes.status, fetchRes.statusText)
      if (fetchRes.ok) {
        imageData = await fetchRes.arrayBuffer()
        console.log('[parse-menu] Image data size:', imageData.byteLength)
      } else {
        fetchFailed = true
        console.log('[parse-menu] Fetch failed with status:', fetchRes.status)
      }
    } catch (err) {
      fetchFailed = true
      console.log('[parse-menu] Fetch threw:', err)
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
      const base64 = Buffer.from(imageData).toString('base64')
      // Determine MIME type from URL path
      const pathPart = imageUrl.split('?')[0].toLowerCase()
      const ext = pathPart.split('.').pop() || 'jpg'
      const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'heic' ? 'image/heic' : 'image/jpeg'
      console.log('[parse-menu] MIME type:', mimeType, 'from URL:', pathPart)
      content.push({
        type: 'image_url',
        image_url: { url: `data:${mimeType};base64,${base64}` }
      })
    } else {
      content.push({
        type: 'image_url',
        image_url: { url: imageUrl }
      })
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 2048,
      messages: [{ role: 'user', content }]
    })

    const text = completion.choices[0]?.message?.content || ''
    console.log('[parse-menu] OpenAI response, text length:', text.length, 'first 200 chars:', text.slice(0, 200))

    return NextResponse.json({ text })
  } catch (err: unknown) {
    console.error('Menu parse error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
