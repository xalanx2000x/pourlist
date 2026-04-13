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
          address: venue.address || '',
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

export default function Map({ venues, selectedVenue, onVenueSelect }: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const [mapLoaded, setMapLoaded] = useState(false)

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

  return (
    <div ref={mapContainer} className="w-full h-full min-h-[300px]" />
  )
}
