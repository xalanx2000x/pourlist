'use client'

import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Venue } from '@/lib/supabase'
import { hasActiveHappyHour } from '@/lib/activeHH'

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''

interface MapProps {
  venues: Venue[]
  selectedVenue: Venue | null
  onVenueSelect: (venue: Venue) => void
  center?: [number, number] // [lng, lat]
  flyToUserLocation?: { lat: number; lng: number } | null
  showUserLocation?: boolean
  onBoundsChange?: (bounds: { north: number; south: number; east: number; west: number }) => void
  /** Incrementing this number triggers a fly-to-user animation */
  zoomToUser?: number
}

// Pre-compute which venues have active HH once
function buildGeoJSON(venues: Venue[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: venues
      .filter(v => v.lat && v.lng)
      .map(venue => ({
        type: 'Feature',
        properties: {
          id: venue.id,
          name: venue.name,
          address: venue.address_backup || '',
          status: venue.status || 'unverified',
          hasHH: hasActiveHappyHour(venue.menu_text)
        },
        geometry: {
          type: 'Point',
          coordinates: [venue.lng!, venue.lat!]
        }
      }))
  }
}

export default function Map({ venues, selectedVenue, onVenueSelect, flyToUserLocation, showUserLocation = false, onBoundsChange, zoomToUser }: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const watchIdRef = useRef<number | null>(null)
  const userLocationRef = useRef<{ lat: number; lng: number } | null>(null)
  const boundsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track and watch user location
  useEffect(() => {
    if (!showUserLocation || !navigator.geolocation) return

    // Get initial position
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        updateUserDot(lat, lng)
        // Watch for movement
        watchIdRef.current = navigator.geolocation.watchPosition(
          (p) => updateUserDot(p.coords.latitude, p.coords.longitude),
          (err) => console.error('User location watch error:', err),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        )
      },
      (err) => console.error('Initial user location error:', err),
      { enableHighAccuracy: true, timeout: 5000 }
    )

    function updateUserDot(lat: number, lng: number) {
      userLocationRef.current = { lat, lng }
      if (!map.current) return
      if (!userMarkerRef.current) {
        // Create the blue dot marker
        const el = document.createElement('div')
        el.style.width = '16px'
        el.style.height = '16px'
        el.style.borderRadius = '50%'
        el.style.backgroundColor = '#3b82f6'
        el.style.border = '3px solid #ffffff'
        el.style.boxShadow = '0 0 0 2px rgba(59, 130, 246, 0.4)'
        el.style.position = 'relative'

        // Accuracy circle
        const accuracyEl = document.createElement('div')
        accuracyEl.style.cssText = `
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: rgba(59, 130, 246, 0.15);
          border: 1px solid rgba(59, 130, 246, 0.3);
          z-index: -1;
        `
        el.appendChild(accuracyEl)

        userMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([lng, lat])
          .addTo(map.current)
      } else {
        userMarkerRef.current.setLngLat([lng, lat])
      }
    }

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      userMarkerRef.current?.remove()
      userMarkerRef.current = null
    }
  }, [showUserLocation])

  useEffect(() => {
    if (!mapContainer.current || map.current) return

    mapboxgl.accessToken = MAPBOX_TOKEN

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-122.6819, 45.5231],
      zoom: 15
    })

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')

    // Emit bounds on map move (debounced via moveend)
    if (onBoundsChange) {
      map.current.on('moveend', () => {
        if (boundsTimerRef.current) clearTimeout(boundsTimerRef.current)
        boundsTimerRef.current = setTimeout(() => {
          const b = map.current!.getBounds()
          if (!b) return
          onBoundsChange({
            north: b.getNorth(),
            south: b.getSouth(),
            east: b.getEast(),
            west: b.getWest()
          })
        }, 150)
      })
    }

    map.current.on('load', () => {
      setMapLoaded(true)
    })

    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  // Re-render venue markers when venues or selected state changes
  useEffect(() => {
    if (!map.current || !mapLoaded) return

    const geojson = buildGeoJSON(venues)

    // Remove existing source/layers if they exist
    if (map.current.getLayer('clusters')) map.current.removeLayer('clusters')
    if (map.current.getLayer('cluster-count')) map.current.removeLayer('cluster-count')
    if (map.current.getLayer('unclustered-point')) map.current.removeLayer('unclustered-point')
    if (map.current.getSource('venues')) map.current.removeSource('venues')

    // Add source with clustering enabled
    map.current.addSource('venues', {
      type: 'geojson',
      data: geojson,
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 50
    })

    // Cluster circles
    map.current.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'venues',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#f59e0b',
        'circle-radius': ['step', ['get', 'point_count'], 20, 10, 25, 50, 30],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff'
      }
    })

    // Cluster count labels
    map.current.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'venues',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 12
      },
      paint: {
        'text-color': '#ffffff'
      }
    })

    // Individual venue dots — purple if HH is active, amber otherwise
    map.current.addLayer({
      id: 'unclustered-point',
      type: 'circle',
      source: 'venues',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': [
          'case',
          ['get', 'hasHH'], '#7c3aed',   // purple for active HH
          ['match', ['get', 'status'],
            'unverified', '#fbbf24',
            'stale', '#f97316',
            '#f59e0b'
          ]
        ],
        'circle-radius': 8,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff'
      }
    })

    // Click on cluster → zoom in
    map.current.on('click', 'clusters', (e) => {
      const features = map.current!.queryRenderedFeatures(e.point, { layers: ['clusters'] })
      if (!features.length) return
      const clusterId = features[0].properties!.cluster_id
      const source = map.current!.getSource('venues') as mapboxgl.GeoJSONSource
      source.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err || !zoom) return
        const geometry = features[0].geometry as GeoJSON.Point
        map.current!.easeTo({ center: geometry.coordinates as [number, number], zoom })
      })
    })

    // Click on individual dot → select venue
    map.current.on('click', 'unclustered-point', (e) => {
      if (!e.features?.length) return
      const props = e.features[0].properties!
      const geometry = e.features[0].geometry as GeoJSON.Point
      const venue = venues.find(v => v.id === props.id)
      if (venue) onVenueSelect(venue)
    })

    // Cursor changes
    map.current.on('mouseenter', 'clusters', () => { map.current!.getCanvas().style.cursor = 'pointer' })
    map.current.on('mouseleave', 'clusters', () => { map.current!.getCanvas().style.cursor = '' })
    map.current.on('mouseenter', 'unclustered-point', () => { map.current!.getCanvas().style.cursor = 'pointer' })
    map.current.on('mouseleave', 'unclustered-point', () => { map.current!.getCanvas().style.cursor = '' })

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

  // Fly to user's location on first load
  useEffect(() => {
    if (!map.current || !mapLoaded || !flyToUserLocation) return
    map.current.flyTo({
      center: [flyToUserLocation.lng, flyToUserLocation.lat],
      zoom: 14,
      duration: 1500
    })
  }, [flyToUserLocation, mapLoaded])

  // Fly to user's current position (zoom-to-user button)
  useEffect(() => {
    if (!map.current || !mapLoaded || !zoomToUser) return
    const loc = userLocationRef.current
    if (!loc) return
    map.current.flyTo({
      center: [loc.lng, loc.lat],
      zoom: 15,
      duration: 1200
    })
  }, [zoomToUser, mapLoaded])

  return (
    <div ref={mapContainer} className="w-full h-full min-h-[300px]" />
  )
}
