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
  const markersRef = useRef<mapboxgl.Marker[]>([])
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

  // Update markers when venues change
  useEffect(() => {
    if (!map.current || !mapLoaded) return

    // Clear existing markers
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    // Add new markers
    venues.forEach(venue => {
      if (!venue.lat || !venue.lng) return

      const el = document.createElement('div')
      el.className = 'venue-marker'
      el.innerHTML = `
        <div class="marker-pin ${venue.status === 'unverified' ? 'unverified' : ''}">
          <span>${venue.name.charAt(0)}</span>
        </div>
      `

      el.style.cssText = `
        cursor: pointer;
        transition: transform 0.2s;
      `

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([venue.lng, venue.lat])
        .addTo(map.current!)

      el.addEventListener('click', () => {
        onVenueSelect(venue)
      })

      el.addEventListener('mouseenter', () => {
        el.style.transform = 'scale(1.2)'
      })

      el.addEventListener('mouseleave', () => {
        el.style.transform = 'scale(1)'
      })

      markersRef.current.push(marker)
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
