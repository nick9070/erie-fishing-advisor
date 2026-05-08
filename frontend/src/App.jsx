import { useState, useEffect, useCallback, Component } from 'react'
import FishingMap from './components/FishingMap'
import ConditionsBar from './components/ConditionsBar'
import ForecastView from './components/ForecastView'
import useGeolocation from './hooks/useGeolocation'
import './App.css'

const API = typeof __API_BASE__ !== 'undefined' ? __API_BASE__ : ''

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e.message || String(e) } }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 20, color: '#fca5a5', background: '#450a0a', borderRadius: 8, margin: 12 }}>
        ⚠ Something went wrong: {this.state.error}
        <button style={{ display: 'block', marginTop: 10, padding: '6px 14px', cursor: 'pointer' }}
          onClick={() => this.setState({ error: null })}>Retry</button>
      </div>
    )
    return this.props.children
  }
}

export default function App() {
  const [spotsData, setSpotsData]       = useState(null)
  const [selectedSpot, setSelectedSpot] = useState(null)
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)
  const [lastUpdated, setLastUpdated]   = useState(null)
  const [mobileTab, setMobileTab]       = useState('forecast') // 'map' | 'forecast'
  const [mapKey, setMapKey]             = useState(0)

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

{spotsData?.conditions_summary?.spawn_cr_warning && (
        <div className="cr-warning-banner">
          🥚 <strong>{spotsData.conditions_summary.spawn_label}:</strong> Bass are on nests or guarding fry.
          Release fish quickly and close to where caught — removing a male from his nest exposes eggs/fry to goby predation.
          {spotsData.conditions_summary.spawn_depth_note && (
            <span> {spotsData.conditions_summary.spawn_depth_note}.</span>
          )}
        </div>
      )}

      {spotsData && (
        <ConditionsBar conditions={spotsData.conditions_summary} season={spotsData.season} />
      )}

      <div className="mobile-tabs">
        <button
          className={`mobile-tab ${mobileTab === 'forecast' ? 'active' : ''}`}
          onClick={() => setMobileTab('forecast')}
        >📋 Spots</button>
        <button
          className={`mobile-tab ${mobileTab === 'map' ? 'active' : ''}`}
          onClick={() => { setMobileTab('map'); setMapKey(k => k + 1) }}
        >🗺 Map</button>
      </div>

      <div className="app-body">
        <div className={`map-panel ${mobileTab === 'map' ? 'mobile-visible' : 'mobile-hidden'}`}>
          <ErrorBoundary>
            {spotsData ? (
              <FishingMap
                key={mapKey}
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
          </ErrorBoundary>
        </div>

        <div className={`forecast-panel ${mobileTab === 'forecast' ? 'mobile-visible' : 'mobile-hidden'}`}>
          <ErrorBoundary>
            <ForecastView apiBase={API} spotsData={spotsData} userLocation={location} />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  )
}
