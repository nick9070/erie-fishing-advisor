import { useState, useEffect, Component } from 'react'
import FishingMap from './components/FishingMap'
import ConditionsBar from './components/ConditionsBar'
import ForecastView from './components/ForecastView'
import ChatsTab from './components/ChatsTab'
import ChatModal from './components/ChatModal'
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
  const [spotsData,     setSpotsData]     = useState(null)
  const [selectedSpot,  setSelectedSpot]  = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(null)
  const [lastUpdated,   setLastUpdated]   = useState(null)
  const [mobileTab,     setMobileTab]     = useState('forecast')   // 'map' | 'forecast' | 'chats'
  const [rightContent,  setRightContent]  = useState('forecast')   // 'forecast' | 'chats'  — controls desktop right panel AND mobile right panel content
  const [mapKey,        setMapKey]        = useState(0)

  // ── Chat state ────────────────────────────────────────────────────────────
  const [chats,      setChats]      = useState(() => {
    try { return JSON.parse(localStorage.getItem('erie_chats') || '[]') }
    catch { return [] }
  })
  const [activeChat, setActiveChat] = useState(null)

  useEffect(() => {
    localStorage.setItem('erie_chats', JSON.stringify(chats))
  }, [chats])

  const handleNewChat = (context) => {
    const thread = {
      id: Date.now().toString(),
      apiBase: API,
      ...context,
      messages: [],
      created_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
    }
    setChats(prev => [thread, ...prev].slice(0, 50))
    setActiveChat(thread)
  }

  const handleUpdateChat = (updated) => {
    setActiveChat(updated)
    setChats(prev => prev.map(t => t.id === updated.id ? updated : t))
  }

  const handleOpenChat  = (thread) => setActiveChat(thread)
  const handleCloseChat = ()       => setActiveChat(null)
  const handleDeleteChat = (id) => {
    setChats(prev => prev.filter(t => t.id !== id))
    if (activeChat?.id === id) setActiveChat(null)
  }

  // ── Spots data ────────────────────────────────────────────────────────────
  const { location, error: geoError } = useGeolocation()

  const fetchData = async () => {
    try {
      setLoading(true); setError(null)
      const res = await fetch(`${API}/api/spots`)
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Failed to fetch data') }
      const data = await res.json()
      setSpotsData(data)
      setLastUpdated(new Date())
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    fetchData()
    const iv = setInterval(fetchData, 10 * 60 * 1000)
    return () => clearInterval(iv)
  }, [])

  const seasonLabel  = spotsData?.season?.replace('_', ' ').toUpperCase() ?? ''
  const chatCount    = chats.length
  const rightIsChats = rightContent === 'chats'

  return (
    <div className="app">
{error && (
        <div className="error-banner">
          ⚠ {error}
          {error.includes('OPENWEATHER') && (
            <span> — Set <code>OPENWEATHER_API_KEY</code> in your <code>.env</code> and restart</span>
          )}
        </div>
      )}
      {geoError && <div className="geo-banner">⚠ {geoError}</div>}
      {spotsData?.conditions_summary?.spawn_cr_warning && (
        <div className="cr-warning-banner">
          🥚 <strong>{spotsData.conditions_summary.spawn_label}:</strong> Bass are on nests or guarding fry.
          Release fish quickly and close to where caught — removing a male from his nest exposes eggs/fry to goby predation.
          {spotsData.conditions_summary.spawn_depth_note && <span> {spotsData.conditions_summary.spawn_depth_note}.</span>}
        </div>
      )}
      {spotsData && <ConditionsBar conditions={spotsData.conditions_summary} season={spotsData.season} />}

      {/* Mobile tabs */}
      <div className="mobile-tabs">
        <button
          className={`mobile-tab ${mobileTab === 'forecast' ? 'active' : ''}`}
          onClick={() => { setMobileTab('forecast'); setRightContent('forecast') }}
        >📋 Spots</button>
        <button
          className={`mobile-tab ${mobileTab === 'map' ? 'active' : ''}`}
          onClick={() => { setMobileTab('map'); setMapKey(k => k + 1) }}
        >🗺 Map</button>
        <button
          className={`mobile-tab ${mobileTab === 'chats' ? 'active' : ''}`}
          onClick={() => { setMobileTab('chats'); setRightContent('chats') }}
        >💬 Chats{chatCount > 0 ? ` (${chatCount})` : ''}</button>
      </div>

      <div className="app-body">
        {/* Map */}
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
              <div className="map-loading"><div className="spinner" /><p>Fetching Lake Erie conditions...</p></div>
            ) : null}
          </ErrorBoundary>
        </div>

        {/* Right panel (forecast + chats) */}
        <div className={`forecast-panel ${(mobileTab === 'forecast' || mobileTab === 'chats') ? 'mobile-visible' : 'mobile-hidden'}`}>

          {/* Desktop toggle — hidden on mobile via CSS */}
          <div className="panel-toggle">
            <button
              className={`panel-toggle-btn ${!rightIsChats ? 'active' : ''}`}
              onClick={() => setRightContent('forecast')}
            >📅 Forecast</button>
            <button
              className={`panel-toggle-btn ${rightIsChats ? 'active' : ''}`}
              onClick={() => setRightContent('chats')}
            >💬 Chats{chatCount > 0 ? ` (${chatCount})` : ''}</button>
          </div>

          <ErrorBoundary>
            {rightIsChats ? (
              <ChatsTab
                chats={chats}
                onOpenChat={handleOpenChat}
                onDeleteChat={handleDeleteChat}
              />
            ) : (
              <ForecastView
                apiBase={API}
                spotsData={spotsData}
                userLocation={location}
                onNewChat={handleNewChat}
              />
            )}
          </ErrorBoundary>
        </div>
      </div>

      {/* Single global chat modal */}
      {activeChat && (
        <ChatModal
          thread={activeChat}
          onUpdate={handleUpdateChat}
          onClose={handleCloseChat}
        />
      )}
    </div>
  )
}
