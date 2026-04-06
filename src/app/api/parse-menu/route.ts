import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

/**
 * POST /api/parse-menu
 * Body: { imageUrl: string }
 * Returns: { text: string } — the extracted menu text
 */
export async function POST(req: NextRequest) {
  try {
    const { imageUrl } = await req.json()

    if (!imageUrl) {
      return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 })
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
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
            },
            {
              type: 'image_url',
              image_url: { url: imageUrl }
            }
          ]
        }
      ]
    })

    const text = completion.choices[0]?.message?.content || ''

    return NextResponse.json({ text })
  } catch (err: unknown) {
    console.error('Menu parse error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
