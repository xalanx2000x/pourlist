'use client'

import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Venue } from '@/lib/supabase'

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''

interface MapProps {
  venues: Venue[]
  selectedVenue: Venue | null
  onVenueSelect: (venue: Venue) => void
}

export default function Map({ venues, selectedVenue, onVenueSelect }: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map())
  const [mapLoaded, setMapLoaded] = useState(false)

  useEffect(() => {
    if (!mapContainer.current || map.current) return

    mapboxgl.accessToken = MAPBOX_TOKEN

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-122.6819, 45.5231], // Pearl District, Portland
      zoom: 15
    })

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')

    map.current.on('load', () => {
      setMapLoaded(true)
    })

    return () => {
      markersRef.current.forEach(m => m.remove())
      map.current?.remove()
      map.current = null
    }
  }, [])

  // Update markers when venues or map load status changes
  useEffect(() => {
    if (!map.current || !mapLoaded) return

    // Remove old markers
    markersRef.current.forEach(m => m.remove())
    markersRef.current.clear()

    // Add new markers
    venues.forEach(venue => {
      if (!venue.lat || !venue.lng) return

      const el = document.createElement('div')
      el.className = 'venue-marker'
      el.style.cssText = `
        cursor: pointer;
        width: 36px;
        height: 36px;
        position: relative;
      `

      const inner = document.createElement('div')
      inner.style.cssText = `
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: #f59e0b;
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        font-weight: 700;
        color: white;
        transition: transform 150ms ease, background 150ms ease;
        transform-origin: center center;
      `

      // Show first letter of venue name
      const letter = venue.name.charAt(0).toUpperCase()
      inner.textContent = letter

      if (venue.status === 'unverified') {
        inner.style.background = '#fbbf24'
        inner.style.borderColor = '#fef3c7'
      } else if (venue.status === 'stale') {
        inner.style.background = '#f97316'
        inner.style.borderColor = '#fed7aa'
      }

      el.appendChild(inner)

      // Hover with pointer-events on the inner element only
      el.addEventListener('mouseenter', () => {
        inner.style.transform = 'scale(1.15)'
        el.style.zIndex = '10'
      })

      el.addEventListener('mouseleave', () => {
        inner.style.transform = 'scale(1)'
        el.style.zIndex = '1'
      })

      el.addEventListener('click', () => {
        onVenueSelect(venue)
      })

      // Prevent pointer events on inner from interfering with click
      inner.style.pointerEvents = 'none'

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([venue.lng, venue.lat])
        .addTo(map.current!)

      markersRef.current.set(venue.id, marker)
    })
  }, [venues, mapLoaded, onVenueSelect])

  // Fly to selected venue
  useEffect(() => {
    if (!map.current || !selectedVenue?.lat || !selectedVenue?.lng) return
    map.current.flyTo({
      center: [selectedVenue.lng, selectedVenue.lat],
      zoom: 16,
      duration: 1000
    })
  }, [selectedVenue])

  return (
    <div ref={mapContainer} className="w-full h-full min-h-[300px]" />
  )
}
