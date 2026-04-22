import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Venue = {
  id: string
  name: string
  // address removed - see address_backup (Preserved for display, phased out of submission flow)
  address_backup: string | null
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
  hh_time: string | null
  hh_type: string | null        // 'all_day' | 'open_through' | 'typical' | 'late_night'
  hh_days: string | null        // comma-separated ISO weekdays, e.g. "1,2,3,4,5" (Window 1)
  hh_exclude_days: string | null // comma-separated ISO weekdays to exclude from Window 1
  hh_start: number | null       // minutes since midnight; null = "open"
  hh_end: number | null         // minutes since midnight; null = "close"
  hh_type_2: string | null     // second HH window
  hh_days_2: string | null
  hh_exclude_days_2: string | null
  hh_start_2: number | null
  hh_end_2: number | null
  hh_type_3: string | null     // third HH window
  hh_days_3: string | null
  hh_exclude_days_3: string | null
  hh_start_3: number | null
  hh_end_3: number | null
  opening_min: number | null    // minutes since midnight venue opens (e.g. 840 = 2pm)
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
