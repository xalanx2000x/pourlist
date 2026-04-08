import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://cuzkquenafzebdqbuwfk.supabase.co'
const supabaseAnonKey = 'sb_publishable_3s6JPCTtyHi_W-wgZIDlDQ_EZYja6qn'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Venue = {
  id: string
  name: string
  address: string
  lat: number | null
  lng: number | null
  zip: string | null
  phone: string | null
  website: string | null
  type: string | null
  status: 'unverified' | 'verified' | 'stale' | 'closed'
  contributor_trust: string
  last_verified: string | null
  photo_count: number
  created_at: string
  menu_text: string | null
  menu_text_updated_at: string | null
  latest_menu_image_url: string | null
}

export type Photo = {
  id: string
  venue_id: string
  url: string
  uploader_device_hash: string
  lat: number | null
  lng: number | null
  status: 'pending' | 'approved' | 'rejected'
  flagged_count: number
  moderation_confidence: number | null
  created_at: string
}

export type Flag = {
  id: string
  venue_id: string | null
  photo_id: string | null
  reason: string
  device_hash: string
  created_at: string
}
