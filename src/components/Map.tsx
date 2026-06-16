'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Venue } from '@/lib/supabase'
import { hasActiveHappyHour } from '@/lib/activeHH'
import { getHHState, getHHColor } from '@/lib/hh-state'

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''

/**
 * Great-circle distance in meters between two lat/lng points (Haversine formula).
 */
function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6_371_000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const c = 2 * Math.asin(Math.sqrt(sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng))
  return R * c
}

interface MapProps {
  venues: Venue[]
  selectedVenue: Venue | null
  onVenueSelect: (venue: Venue) => void
  center?: [number, number] // [lng, lat]
  flyToUserLocation?: { lat: number; lng: number } | null
  showUserLocation?: boolean
  onBoundsChange?: (bounds: { north: number; south: number; east: number; west: number }) => void
  /** Fires when the map center moves beyond the threshold distance from the last center. */
  onMapCenterChange?: (center: { lat: number; lng: number }) => void
  /** Minimum meters between last confirmed center and current center before onMapCenterChange fires. */
  centerShiftThreshold?: number
  /** Called once when the map is ready with the map instance — used by page.tsx for "Search here". */
  onMapReady?: (getCenter: () => { lat: number; lng: number } | undefined) => void
  /** Fires after any zoom interaction ends (debounced 600ms — fires once per zoom gesture, not during). */
  onZoomChange?: () => void
  /** Fires on the first user-initiated map move (drag, pinch, scroll-zoom, etc.).
   *  Does NOT fire for programmatic moves (flyTo, fitBounds). Uses mapbox's
   *  `e.originalEvent` to distinguish user input from animation. */
  onUserPan?: () => void
  /** Incrementing this number triggers a fly-to-user animation */
  zoomToUser?: number
  /** Flying to a search location center */
  flyToCenter?: { lat: number; lng: number } | null
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
          hasHH: hasActiveHappyHour(venue),
          hhState: getHHState(venue)
        },
        geometry: {
          type: 'Point',
          coordinates: [venue.lng!, venue.lat!]
        }
      }))
  }
}

export default function Map({ venues, selectedVenue, onVenueSelect, flyToUserLocation, showUserLocation = false, onBoundsChange, onMapCenterChange, centerShiftThreshold = 3000, onMapReady, zoomToUser, onZoomChange, flyToCenter, onUserPan }: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const watchIdRef = useRef<number | null>(null)
  const userLocationRef = useRef<{ lat: number; lng: number } | null>(null)
  const boundsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Last center used for the last venue load — used to detect when user has
  // panned far enough to warrant a "search this area" suggestion.
  const lastConfirmedCenterRef = useRef<{ lat: number; lng: number } | null>(null)
  const centerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

    // Emit center shift when map has been panned far enough from the last
    // confirmed venue-load center. Fires once per significant pan.
    if (onMapCenterChange) {
      map.current.on('moveend', () => {
        if (centerTimerRef.current) clearTimeout(centerTimerRef.current)
        centerTimerRef.current = setTimeout(() => {
          const c = map.current!.getCenter()
          const current = { lat: c.lat, lng: c.lng }
          if (!lastConfirmedCenterRef.current) {
            lastConfirmedCenterRef.current = current
            return
          }
          const dist = haversineMeters(lastConfirmedCenterRef.current, current)
          if (dist >= centerShiftThreshold) {
            lastConfirmedCenterRef.current = current
            onMapCenterChange(current)
          }
        }, 400)
      })
    }

    // Let the parent (page.tsx) grab a getCenter function so "Search this area"
    // can read the current map center without needing a ref to the map instance.
    if (onMapReady) {
      onMapReady(() => {
        if (!map.current) return undefined
        const c = map.current.getCenter()
        return { lat: c.lat, lng: c.lng }
      })
    }

    // Emit zoom change (debounced — fires once per zoom gesture, not during scroll)
    // Used by page.tsx to show the "search from user location" button after zoom.
    if (onZoomChange) {
      let zoomTimer: ReturnType<typeof setTimeout> | null = null
      map.current.on('zoomend', () => {
        if (zoomTimer) clearTimeout(zoomTimer)
        zoomTimer = setTimeout(() => {
          onZoomChange()
        }, 600)
      })
    }

    // Detect user-initiated map moves (drag, pinch, scroll-zoom, double-click
    // zoom, rotation, etc.). `e.originalEvent` is set by mapbox when the
    // move was triggered by user input — programmatic moves (flyTo, fitBounds,
    // jumpTo) don't set it. Used by page.tsx to detect when the user has
    // engaged with the map during a deep-link session.
    if (onUserPan) {
      map.current.on('movestart', (e) => {
        if (e.originalEvent) onUserPan()
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

  const markerRebuildTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Rebuild all marker layers from current venues state.
  // Called debounced — see the useEffect below.
  const rebuildMarkers = useCallback(() => {
    if (!map.current || !mapLoaded) return
    const geojson = buildGeoJSON(venues)

    if (map.current.getLayer('clusters')) map.current.removeLayer('clusters')
    if (map.current.getLayer('cluster-count')) map.current.removeLayer('cluster-count')
    if (map.current.getLayer('unclustered-point')) map.current.removeLayer('unclustered-point')
    if (map.current.getLayer('unclustered-point-inner-sm')) map.current.removeLayer('unclustered-point-inner-sm')
    if (map.current.getLayer('unclustered-point-inner-lg')) map.current.removeLayer('unclustered-point-inner-lg')
    if (map.current.getLayer('unclustered-point-glow')) map.current.removeLayer('unclustered-point-glow')
    if (map.current.getSource('venues')) map.current.removeSource('venues')

    map.current.addSource('venues', {
      type: 'geojson',
      data: geojson,
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 50
    })

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
      paint: { 'text-color': '#ffffff' }
    })

    map.current.addLayer({
      id: 'unclustered-point',
      type: 'circle',
      source: 'venues',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': [
          'case',
          ['==', ['get', 'hhState'], 'active'],  getHHColor('active'),
          ['==', ['get', 'hhState'], 'hh_soon'], getHHColor('active'),
          getHHColor('default')
        ],
        'circle-radius': 8,
        'circle-stroke-width': 2,
        'circle-stroke-color': [
          'case',
          ['==', ['get', 'hhState'], 'active'],  getHHColor('active'),  // purple ring (all-purple active dot)
          ['==', ['get', 'hhState'], 'hh_soon'], getHHColor('default'), // orange ring (soon = purple with hint of orange)
          '#ffffff'                                                          // default: white ring
        ]
      }
    })

    map.current.addLayer({
      id: 'unclustered-point-inner-sm',
      type: 'circle',
      source: 'venues',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': getHHColor('active'),
        'circle-radius': 1.6,
        'circle-opacity': [
          'case',
          ['==', ['get', 'hhState'], 'hh_today'], 1,
          0
        ]
      }
    })

    map.current.addLayer({
      id: 'unclustered-point-inner-lg',
      type: 'circle',
      source: 'venues',
      filter: ['!', ['has', 'point_count']],
      paint: {
        // Slightly darker purple core for soon — gives the "purple with hint of orange ring" look
        // a touch of depth without changing the dominant purple.
        'circle-color': '#7e22ce',
        'circle-radius': 6.4,
        'circle-opacity': [
          'case',
          ['==', ['get', 'hhState'], 'hh_soon'], 1,
          0
        ]
      }
    })

    // Glow halo: larger blurred purple ring — only visible when HH is active right now
    map.current.addLayer({
      id: 'unclustered-point-glow',
      type: 'circle',
      source: 'venues',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': getHHColor('active'),
        'circle-radius': 20,
        'circle-opacity': [
          'case',
          ['==', ['get', 'hhState'], 'active'], 0.25,
          0
        ],
        'circle-blur': 0.85
      }
    })

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

    map.current.on('click', 'unclustered-point', (e) => {
      if (!e.features?.length) return
      const props = e.features[0].properties!
      const venue = venues.find(v => v.id === props.id)
      if (venue) onVenueSelect(venue)
    })

    map.current.on('mouseenter', 'clusters', () => { map.current!.getCanvas().style.cursor = 'pointer' })
    map.current.on('mouseleave', 'clusters', () => { map.current!.getCanvas().style.cursor = '' })
    map.current.on('mouseenter', 'unclustered-point', () => { map.current!.getCanvas().style.cursor = 'pointer' })
    map.current.on('mouseleave', 'unclustered-point', () => { map.current!.getCanvas().style.cursor = '' })
  }, [venues, mapLoaded, onVenueSelect])

  // Debounced marker rebuild — 300ms delay collapses rapid successive venue
  // changes (e.g. the double-setVenues in handleVenueSelect) into a single
  // layer rebuild, eliminating visible marker flicker on venue selection.
  useEffect(() => {
    if (!map.current || !mapLoaded) return
    if (markerRebuildTimerRef.current) clearTimeout(markerRebuildTimerRef.current)
    markerRebuildTimerRef.current = setTimeout(rebuildMarkers, 300)
    return () => {
      if (markerRebuildTimerRef.current) clearTimeout(markerRebuildTimerRef.current)
    }
  }, [venues, mapLoaded, rebuildMarkers])

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

  // Fly to a search location center (Search this area)
  useEffect(() => {
    if (!map.current || !mapLoaded || !flyToCenter) return
    const center = flyToCenter
    map.current.flyTo({
      center: [center.lng, center.lat],
      zoom: 13,
      duration: 1500
    })
    // Reset after flying so the same location can be re-triggered later
    onZoomChange?.() // signal parent to load venues at new center
  }, [flyToCenter, mapLoaded])

  return (
    <div ref={mapContainer} className="w-full h-full min-h-[300px]" />
  )
}
