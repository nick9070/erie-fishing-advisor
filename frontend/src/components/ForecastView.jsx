import { useState, useEffect, useRef } from 'react'

function getScoreColor(score) {
  if (score >= 80) return '#22c55e'
  if (score >= 65) return '#84cc16'
  if (score >= 50) return '#eab308'
  if (score >= 35) return '#f97316'
  return '#ef4444'
}

function formatHour(h) {
  if (h === 0)  return '12am'
  if (h < 12)  return `${h}am`
  if (h === 12) return '12pm'
  return `${h - 12}pm`
}

function getDateStr(offset) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().split('T')[0]
}

function getDayLabels(dateStr) {
  const today = new Date(); today.setHours(0,0,0,0)
  const d     = new Date(dateStr + 'T00:00:00'); d.setHours(0,0,0,0)
  const diff  = Math.round((d - today) / 86400000)
  const sub   = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (diff === 0) return { main: 'Today',     sub }
  if (diff === 1) return { main: 'Tomorrow',  sub }
  return { main: d.toLocaleDateString('en-US', { weekday: 'short' }), sub }
}

const TREND_ICON  = { rising_fast: '↑↑', rising: '↑', stable: '→', falling: '↓', falling_fast: '↓↓' }
const TREND_COLOR = { rising_fast: '#f87171', rising: '#fb923c', stable: '#4ade80', falling: '#facc15', falling_fast: '#f87171' }

export default function ForecastView({ apiBase }) {
  const [selectedDate, setSelectedDate] = useState(() => getDateStr(0))
  const [forecast,     setForecast]     = useState(null)
  const [selectedHour, setSelectedHour] = useState(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const selectedHourRef                 = useRef(null)
  const dates = [0,1,2,3,4,5,6].map(getDateStr)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setForecast(null)
    setSelectedHour(null)
    fetch(`${apiBase}/api/forecast?date=${selectedDate}`)
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.detail || 'Failed to load forecast')))
      .then(data => { if (!cancelled) setForecast(data) })
      .catch(e  => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedDate, apiBase])

  useEffect(() => {
    if (forecast) setSelectedHour(forecast.best_hour)
  }, [forecast])

  useEffect(() => {
    selectedHourRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [selectedHour])

  const hourObj = forecast?.hours?.find(h => h.hour === selectedHour)

  return (
    <div style={S.wrap}>

      {/* ── Date picker ── */}
      <div style={S.datePicker}>
        {dates.map(dateStr => {
          const { main, sub } = getDayLabels(dateStr)
          const active = dateStr === selectedDate
          return (
            <button
              key={dateStr}
              style={{ ...S.dateTab, ...(active ? S.dateTabActive : {}) }}
              onClick={() => setSelectedDate(dateStr)}
            >
              <span style={{ fontWeight: 700, fontSize: 12 }}>{main}</span>
              <span style={{ fontSize: 10, color: active ? '#7dd3fc' : '#475569', marginTop: 2 }}>{sub}</span>
            </button>
          )
        })}
      </div>

      {loading && (
        <div style={S.loading}>
          <div className="spinner" />
          <p style={{ color: '#64748b', marginTop: 12, fontSize: 13 }}>Computing 24-hour forecast...</p>
        </div>
      )}

      {error && <div style={S.error}>⚠ {error}</div>}

      {forecast && !loading && (
        <>
          {/* ── Daily summary ── */}
          <div style={S.summary}>
            <span style={{ color: '#64748b', fontSize: 11 }}>Best window</span>
            <span style={{ color: getScoreColor(forecast.best_score), fontWeight: 700, fontSize: 14, margin: '0 8px' }}>
              {formatHour(forecast.best_hour).toUpperCase()}
            </span>
            <span style={{ color: '#e2e8f0', fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {forecast.best_spot_name}
            </span>
            <span style={{ color: getScoreColor(forecast.best_score), fontWeight: 800, fontSize: 22, marginLeft: 12 }}>
              {forecast.best_score}
            </span>
            {forecast.water_temp_f && (
              <span style={{ color: '#64748b', fontSize: 11, marginLeft: 10 }}>
                💧{forecast.water_temp_f}°F
              </span>
            )}
          </div>

          {/* ── Hour strip ── */}
          <div style={S.hourStrip}>
            {forecast.hours.map(h => {
              const active = h.hour === selectedHour
              const color  = getScoreColor(h.top_score)
              const isDawn = h.hour >= 5 && h.hour <= 9
              const isDusk = h.hour >= 18 && h.hour <= 21
              return (
                <button
                  key={h.hour}
                  ref={active ? selectedHourRef : null}
                  style={{
                    ...S.hourBlock,
                    background: active
                      ? 'rgba(56,189,248,0.15)'
                      : (isDawn || isDusk ? 'rgba(250,204,21,0.04)' : 'transparent'),
                    border: active ? '2px solid #38bdf8' : '2px solid transparent',
                  }}
                  onClick={() => setSelectedHour(h.hour)}
                >
                  <span style={{ fontSize: 9, color: '#475569', marginBottom: 2 }}>
                    {formatHour(h.hour)}
                  </span>
                  <span style={{ fontSize: 17, fontWeight: 800, color, lineHeight: 1 }}>
                    {h.top_score}
                  </span>
                  <span style={{ fontSize: 8, height: 10 }}>
                    {isDawn ? '🌅' : isDusk ? '🌇' : ''}
                  </span>
                </button>
              )
            })}
          </div>

          {/* ── Hour detail ── */}
          {hourObj && (
            <div style={S.detail}>

              {/* Conditions row for this hour */}
              <div style={S.hourHeader}>
                <div style={S.hourTitleRow}>
                  <span style={S.hourTitle}>{formatHour(selectedHour).toUpperCase()}</span>
                  <span style={{ fontSize: 12, color: '#64748b' }}>{hourObj.conditions.conditions}</span>
                </div>
                <div style={S.condGrid}>
                  <CondPill icon="🌡" value={`${hourObj.conditions.temp_f?.toFixed(0)}°F`} />
                  <CondPill
                    icon="🔵"
                    value={`${hourObj.conditions.pressure_hpa?.toFixed(0)} hPa`}
                    extra={
                      <span style={{ color: TREND_COLOR[hourObj.conditions.pressure_trend] ?? '#94a3b8', fontWeight: 700 }}>
                        {TREND_ICON[hourObj.conditions.pressure_trend] ?? '→'}
                      </span>
                    }
                  />
                  <CondPill
                    icon="💨"
                    value={`${hourObj.conditions.wind_speed_mph?.toFixed(0)} mph ${hourObj.conditions.wind_dir_label}`}
                  />
                  <CondPill icon="☁" value={`${hourObj.conditions.cloud_cover_pct}%`} />
                  {hourObj.conditions.precipitation > 0 && (
                    <CondPill icon="🌧" value={`${hourObj.conditions.precipitation.toFixed(1)}mm`} />
                  )}
                </div>
              </div>

              {/* Spot rankings */}
              <div style={S.spotListHeader}>
                SPOT RANKINGS — {formatHour(selectedHour).toUpperCase()}
              </div>
              {hourObj.spots.map(spot => (
                <div key={spot.spot_id} style={{ ...S.spotRow, borderLeft: `3px solid ${getScoreColor(spot.score)}` }}>
                  <span style={{ ...S.rank, color: getScoreColor(spot.score) }}>{spot.rank}</span>
                  <span style={S.spotName}>{spot.spot_name}</span>
                  <span style={{ ...S.score, color: getScoreColor(spot.score) }}>{spot.score}</span>
                  <span style={{ ...S.rating, color: getScoreColor(spot.score) }}>{spot.rating}</span>
                </div>
              ))}

            </div>
          )}
        </>
      )}
    </div>
  )
}

function CondPill({ icon, value, extra }) {
  return (
    <div style={S.condPill}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <span style={{ fontSize: 11, color: '#cbd5e1' }}>{value}</span>
      {extra}
    </div>
  )
}

const S = {
  wrap: {
    display: 'flex', flexDirection: 'column', height: '100%',
    background: '#0d1f2d', overflowY: 'auto',
  },
  datePicker: {
    display: 'flex', overflowX: 'auto', background: '#0a1a2a',
    borderBottom: '1px solid #1e3a4a', flexShrink: 0, padding: '0 4px',
  },
  dateTab: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '10px 14px', background: 'none', border: 'none',
    borderBottom: '2px solid transparent', color: '#64748b',
    cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
  },
  dateTabActive: { color: '#38bdf8', borderBottomColor: '#38bdf8' },
  loading: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', flex: 1, gap: 8,
  },
  error: {
    background: '#450a0a', color: '#fca5a5',
    padding: '10px 20px', fontSize: 13, margin: 12, borderRadius: 6,
  },
  summary: {
    display: 'flex', alignItems: 'center', padding: '10px 16px',
    background: '#0a1f2e', borderBottom: '1px solid #1e3a4a', flexShrink: 0,
  },
  hourStrip: {
    display: 'flex', overflowX: 'auto', background: '#0a1a2a',
    borderBottom: '1px solid #1e3a4a', padding: '6px 4px', gap: 2, flexShrink: 0,
  },
  hourBlock: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '5px 6px', borderRadius: 6, cursor: 'pointer', minWidth: 50, gap: 1,
  },
  detail: { flex: 1 },
  hourHeader: {
    padding: '12px 16px', borderBottom: '1px solid #1e3a4a', background: '#0a1f2e',
  },
  hourTitleRow: {
    display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8,
  },
  hourTitle: { fontSize: 14, fontWeight: 700, color: '#38bdf8' },
  condGrid: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  condPill: {
    display: 'flex', alignItems: 'center', gap: 4,
    background: '#0c2a3e', border: '1px solid #1e3a4a',
    borderRadius: 6, padding: '4px 8px',
  },
  spotListHeader: {
    padding: '7px 16px', fontSize: 10, fontWeight: 700,
    color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px',
    borderBottom: '1px solid #142030', background: '#0d1f2d',
    position: 'sticky', top: 0,
  },
  spotRow: {
    display: 'flex', alignItems: 'center', padding: '10px 16px',
    borderBottom: '1px solid #142030', gap: 12,
  },
  rank: { fontSize: 18, fontWeight: 800, width: 22, textAlign: 'center', flexShrink: 0 },
  spotName: {
    flex: 1, fontSize: 13, fontWeight: 600, color: '#e2e8f0',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  score:  { fontSize: 20, fontWeight: 800, flexShrink: 0 },
  rating: { fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', flexShrink: 0, width: 54, textAlign: 'right' },
}
