import { useState, useEffect } from 'react'
import FishingMap from './components/FishingMap'
import SpotList from './components/SpotList'
import ConditionsBar from './components/ConditionsBar'
import useGeolocation from './hooks/useGeolocation'
import './App.css'

const API = typeof __API_BASE__ !== 'undefined' ? __API_BASE__ : ''

export default function App() {
  const [spotsData, setSpotsData]       = useState(null)
  const [selectedSpot, setSelectedSpot] = useState(null)
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)
  const [lastUpdated, setLastUpdated]   = useState(null)

  const { location, error: geoError } = useGeolocation()

  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`${API}/api/spots`)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to fetch data')
      }
      const data = await res.json()
      setSpotsData(data)
      setLastUpdated(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 10 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  const seasonLabel = spotsData?.season?.replace('_', ' ').toUpperCase() ?? ''

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <span className="app-icon">🎣</span>
          <div>
            <h1>Erie Smallmouth Advisor</h1>
            {lastUpdated && (
              <span className="last-updated">Updated {lastUpdated.toLocaleTimeString()}</span>
            )}
          </div>
        </div>
        <div className="header-right">
          {location && (
            <span className="gps-badge" title={`±${Math.round(location.accuracy)}m`}>
              📍 GPS
            </span>
          )}
          {spotsData && <span className="season-badge">{seasonLabel}</span>}
          <button className="refresh-btn" onClick={fetchData} disabled={loading}>
            {loading ? '⟳' : '⟳ Refresh'}
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          ⚠ {error}
          {error.includes('OPENWEATHER') && (
            <span> — Set <code>OPENWEATHER_API_KEY</code> in your <code>.env</code> and restart</span>
          )}
        </div>
      )}

      {geoError && (
        <div className="geo-banner">⚠ {geoError}</div>
      )}

      {spotsData?.population_outlook?.east_basin === 'reduced' && (
        <div className="outlook-banner">
          ⚠ <strong>2025 ODNR:</strong> Reduced adult populations in eastern basin (poor 2022-23 year-class). Fewer fish, larger average size. Stay on proven spots.
        </div>
      )}

      {spotsData && (
        <ConditionsBar conditions={spotsData.conditions_summary} season={spotsData.season} />
      )}

      <div className="app-body">
        <div className="map-panel">
          {spotsData ? (
            <FishingMap
              spots={spotsData.spots}
              selectedSpot={selectedSpot}
              onSelectSpot={setSelectedSpot}
              userLocation={location}
            />
          ) : loading ? (
            <div className="map-loading">
              <div className="spinner" />
              <p>Fetching Lake Erie conditions...</p>
            </div>
          ) : null}
        </div>

        <div className="list-panel">
          {spotsData && (
            <SpotList
              spots={spotsData.spots}
              selectedSpot={selectedSpot}
              onSelectSpot={setSelectedSpot}
              conditions={spotsData.conditions_summary}
              userLocation={location}
              apiBase={API}
            />
          )}
        </div>
      </div>
    </div>
  )
}
