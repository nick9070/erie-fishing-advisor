import { useState, useEffect, useCallback } from 'react'

export default function useGeolocation() {
  const [location, setLocation]   = useState(null)   // { lat, lon, accuracy }
  const [error, setError]         = useState(null)
  const [watching, setWatching]   = useState(false)
  const [watchId, setWatchId]     = useState(null)

  const handleSuccess = useCallback((pos) => {
    setLocation({
      lat:      pos.coords.latitude,
      lon:      pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    })
    setError(null)
  }, [])

  const handleError = useCallback((err) => {
    const messages = {
      1: 'Location permission denied. Tap the lock icon in Safari to allow.',
      2: 'Location unavailable.',
      3: 'Location request timed out.',
    }
    setError(messages[err.code] ?? 'Location error.')
    setWatching(false)
  }, [])

  const startWatching = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported by this browser.')
      return
    }
    setWatching(true)
    const id = navigator.geolocation.watchPosition(
      handleSuccess,
      handleError,
      {
        enableHighAccuracy: true,
        timeout:            10000,
        maximumAge:         30000,   // accept cached position up to 30s old
      }
    )
    setWatchId(id)
  }, [handleSuccess, handleError])

  const stopWatching = useCallback(() => {
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId)
      setWatchId(null)
    }
    setWatching(false)
  }, [watchId])

  // Auto-start on mount (browser will prompt for permission)
  useEffect(() => {
    startWatching()
    return () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId)
    }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  return { location, error, watching, startWatching, stopWatching }
}

/** Haversine distance in km between two lat/lon points */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const R    = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a    = Math.sin(dLat/2) ** 2 +
               Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
               Math.sin(dLon/2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
