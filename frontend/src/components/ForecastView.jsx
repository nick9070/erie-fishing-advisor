import { useState, useEffect, useRef } from 'react'
import CatchLogModal from './CatchLogModal'
import { distanceKm } from '../hooks/useGeolocation'

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

function ScoreBar({ score }) {
  return (
    <div style={{ height: 4, background: '#1e3a4a', borderRadius: 2, overflow: 'hidden', marginTop: 5 }}>
      <div style={{ width: `${score}%`, height: '100%', background: getScoreColor(score), borderRadius: 2 }} />
    </div>
  )
}

function FactorPill({ label, value }) {
  const color = value >= 70 ? '#4ade80' : value >= 50 ? '#facc15' : '#f87171'
  return (
    <div style={{ background: '#0a1f2e', border: '1px solid #1e3a4a', borderRadius: 6, padding: '6px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <span style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 700, color }}>{value}</span>
    </div>
  )
}

function ForecastSpotRow({ spot, apiBase, conditions, userLocation, date, hour, onNewChat }) {
  const [expanded,       setExpanded]       = useState(false)
  const [aiText,         setAiText]         = useState(null)
  const [aiLoad,         setAiLoad]         = useState(false)
  const [aiError,        setAiError]        = useState(null)
  const [catchModalOpen, setCatchModalOpen] = useState(false)
  const [justLogged,     setJustLogged]     = useState(false)

  const color = getScoreColor(spot.score)
  const bd    = spot.breakdown
  const sol   = spot.solunar
  const depth = spot.depth_info

  const dist = userLocation && spot.coords
    ? distanceKm(userLocation.lat, userLocation.lon, spot.coords.lat, spot.coords.lon)
    : null

  useEffect(() => {
    if (!expanded || aiText || aiLoad) return
    let cancelled = false
    setAiLoad(true)
    fetch(`${apiBase}/api/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spot_name:  spot.spot_name,
        score:      spot.score,
        rating:     spot.rating,
        season:     spot.season ?? 'unknown',
        breakdown:  bd,
        bonuses:    spot.bonuses ?? null,
        solunar:    sol,
        conditions: conditions ?? {},
        depth_info: depth ?? null,
        techniques: spot.techniques ?? null,
        forage:     spot.forage ?? null,
        spawn:      spot.spawn ?? null,
        notes:      spot.notes ?? null,
      }),
    })
      .then(r => r.json())
      .then(data => { if (!cancelled) setAiText(data.sections ?? null) })
      .catch(() => { if (!cancelled) setAiError('Could not load AI explanation.') })
      .finally(() => { if (!cancelled) setAiLoad(false) })
    return () => { cancelled = true }
  }, [expanded])

  return (
    <>
      <div style={{ borderLeft: `3px solid ${color}`, borderBottom: '1px solid #142030' }}>

        {/* Clickable header row */}
        <div
          style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', gap: 12, cursor: 'pointer', background: expanded ? '#0f2d42' : 'transparent' }}
          onClick={() => setExpanded(e => !e)}
        >
          <span style={{ fontSize: 18, fontWeight: 800, width: 22, textAlign: 'center', flexShrink: 0, color }}>{spot.rank}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {spot.spot_name}
            </div>
            <ScoreBar score={spot.score} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
            <span style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1 }}>{spot.score}</span>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color, marginTop: 2 }}>{spot.rating}</span>
            {dist != null && (
              <span style={{ fontSize: 10, color: '#3b82f6', fontWeight: 600, marginTop: 2 }}>
                {dist < 1 ? `${Math.round(dist * 1000)}m` : `${dist.toFixed(1)}km`}
              </span>
            )}
          </div>
          <span style={{ color: '#475569', fontSize: 12, flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
        </div>

        {/* Expanded detail — not click-to-collapse */}
        {expanded && (
          <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid #1e3a4a', background: '#0f2d42' }}>

            {/* Depth badge */}
            {depth?.target_depth_ft && (
              <div style={{ marginTop: 10, fontSize: 11, color: depth.mode === 'shallow_bite' ? '#fde68a' : depth.mode === 'thermocline' ? '#38bdf8' : '#94a3b8', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {depth.mode === 'shallow_bite' ? '🌅' : depth.mode === 'thermocline' ? '🌊' : '🎯'}
                {' '}Target {depth.target_depth_ft[0]}–{depth.target_depth_ft[1]} ft
                {depth.mode === 'shallow_bite' && (
                  <span style={{ background: 'rgba(250,204,21,0.12)', color: '#fde68a', border: '1px solid rgba(250,204,21,0.3)', fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, textTransform: 'uppercase' }}>
                    SHALLOW BITE
                  </span>
                )}
                {depth.mode === 'thermocline' && (
                  <span style={{ background: 'rgba(56,189,248,0.12)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.3)', fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, textTransform: 'uppercase' }}>
                    ABOVE THERMOCLINE {depth.thermocline_ft}ft
                  </span>
                )}
                {depth.also_check_ft && (
                  <span style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic' }}>
                    also {depth.also_check_ft[0]}–{depth.also_check_ft[1]}ft mid-day
                  </span>
                )}
              </div>
            )}

            {/* Solunar badge */}
            {sol?.active_period && sol.active_period !== 'inactive' && (
              <div style={{ fontSize: 11, color: '#facc15', background: 'rgba(250,204,21,0.08)', border: '1px solid rgba(250,204,21,0.2)', borderRadius: 4, padding: '3px 8px', display: 'inline-block' }}>
                ★ Solunar {sol.active_period}{sol.moon_phase_pct != null ? ` — Moon ${sol.moon_phase_pct}%` : ''}
              </div>
            )}

            {/* Techniques */}
            {spot.techniques?.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px', marginRight: 4 }}>Techniques</span>
                {spot.techniques.map(t => (
                  <span key={t} style={{ background: '#0c2a3e', border: '1px solid #1e5a7a', color: '#7dd3fc', fontSize: 11, padding: '2px 8px', borderRadius: 10 }}>{t}</span>
                ))}
              </div>
            )}

            {/* Forage */}
            {spot.forage && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Primary forage</span>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>{spot.forage.replace('_', ' ')}</span>
              </div>
            )}

            {/* Factor breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              <FactorPill label="Water Temp" value={bd.water_temp} />
              <FactorPill label="Pressure"   value={bd.pressure} />
              <FactorPill label="Wind"       value={bd.wind} />
              <FactorPill label="Solunar"    value={bd.solunar} />
              <FactorPill label="Monthly"    value={bd.monthly_qual} />
              <FactorPill label="Time"       value={bd.time_of_day} />
            </div>

            {/* Bonuses */}
            {spot.bonuses && (
              spot.bonuses.catch_log !== 0 || spot.bonuses.odnr_seasonal !== 0 ||
              spot.bonuses.front_penalty !== 0 || spot.bonuses.spawn_penalty !== 0 ||
              spot.bonuses.goby_bonus !== 0
            ) && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {spot.bonuses.spawn_penalty !== 0 && (
                  <span style={bonusChip('negative')}>
                    🐟 {spot.spawn?.label} {spot.bonuses.spawn_penalty}
                  </span>
                )}
                {spot.bonuses.goby_bonus !== 0 && (
                  <span style={bonusChip(spot.bonuses.goby_bonus > 0 ? 'positive' : 'negative')}>
                    🦈 Goby {spot.bonuses.goby_bonus > 0 ? '+' : ''}{spot.bonuses.goby_bonus}
                  </span>
                )}
                {spot.bonuses.front_penalty !== 0 && (
                  <span style={bonusChip('negative')}>
                    🌬 Post-front {spot.bonuses.front_penalty}
                  </span>
                )}
                {spot.bonuses.catch_log !== 0 && (
                  <span style={bonusChip(spot.bonuses.catch_log > 0 ? 'positive' : 'negative')}>
                    📔 Catch log {spot.bonuses.catch_log > 0 ? '+' : ''}{spot.bonuses.catch_log}
                  </span>
                )}
                {spot.bonuses.odnr_seasonal !== 0 && (
                  <span style={bonusChip(spot.bonuses.odnr_seasonal > 0 ? 'positive' : 'negative')}>
                    📊 ODNR {spot.bonuses.odnr_seasonal > 0 ? '+' : ''}{spot.bonuses.odnr_seasonal}
                  </span>
                )}
              </div>
            )}

            {/* Notes */}
            {spot.notes && (
              <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>📍 {spot.notes}</div>
            )}

            {/* Catch Log */}
            <button
              style={{ background: '#071a2a', border: '1px solid #1e5a7a', color: '#38bdf8', padding: '8px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, width: '100%' }}
              onClick={e => { e.stopPropagation(); setCatchModalOpen(true) }}
            >
              {justLogged ? '✓ Logged!' : '🎣 Log a Catch'}
            </button>

            {/* AI Guide */}
            <div style={{ background: '#071520', border: '1px solid #1e3a4a', borderRadius: 6, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>🤖 AI Guide</div>
              {aiLoad  && <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>⟳ Analyzing conditions...</p>}
              {aiError && <p style={{ fontSize: 11, color: '#f87171', margin: 0 }}>{aiError}</p>}
              {aiText  && aiText.map((sec, i) => (
                <div key={i} style={{ marginBottom: i < aiText.length - 1 ? 10 : 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#7dd3fc', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 3 }}>{sec.title}</div>
                  <p style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.6, margin: 0 }}>{sec.body}</p>
                </div>
              ))}
              {aiText && (
                <button
                  style={{ marginTop: 10, width: '100%', background: '#0c2a3e', border: '1px solid #38bdf8', color: '#38bdf8', borderRadius: 6, padding: '8px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                  onClick={e => {
                    e.stopPropagation()
                    onNewChat({
                      spot_name:  spot.spot_name,
                      score:      spot.score,
                      rating:     spot.rating,
                      season:     spot.season ?? 'unknown',
                      date,
                      hour,
                      conditions: conditions ?? {},
                      breakdown:  spot.breakdown,
                      bonuses:    spot.bonuses ?? null,
                      depth_info: spot.depth_info ?? null,
                      techniques: spot.techniques ?? null,
                      forage:     spot.forage ?? null,
                      spawn:      spot.spawn ?? null,
                      sections:   aiText,
                    })
                  }}
                >
                  💬 Chat with AI Guide
                </button>
              )}
            </div>

          </div>
        )}
      </div>

      {catchModalOpen && (
        <CatchLogModal
          spot={spot}
          conditions={conditions}
          apiBase={apiBase}
          onClose={() => setCatchModalOpen(false)}
          onSaved={() => {
            setJustLogged(true)
            setTimeout(() => setJustLogged(false), 3000)
          }}
        />
      )}
    </>
  )
}

function bonusChip(type) {
  const pos = type === 'positive'
  return {
    fontSize: 11, padding: '3px 8px', borderRadius: 10, fontWeight: 600,
    background: pos ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
    color:      pos ? '#4ade80' : '#f87171',
    border:     `1px solid ${pos ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}`,
  }
}

export default function ForecastView({ apiBase, spotsData, userLocation, onNewChat }) {
  const [nowMode,      setNowMode]      = useState(true)
  const [selectedDate, setSelectedDate] = useState(() => getDateStr(0))
  const [forecast,     setForecast]     = useState(null)
  const [selectedHour, setSelectedHour] = useState(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const selectedHourRef                 = useRef(null)
  const dates = [0,1,2,3,4,5,6].map(getDateStr)

  useEffect(() => {
    if (nowMode) return
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
  }, [selectedDate, nowMode, apiBase])

  useEffect(() => {
    if (forecast) setSelectedHour(forecast.best_hour)
  }, [forecast])

  useEffect(() => {
    selectedHourRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [selectedHour])

  const hourObj = forecast?.hours?.find(h => h.hour === selectedHour)

  // Now mode — live ranked spots from /api/spots
  const nowSpots = spotsData?.spots
    ? spotsData.spots.map((s, i) => ({ ...s, rank: i + 1 }))
    : null
  const nowConditions = spotsData?.conditions_summary ?? {}

  return (
    <div style={S.wrap}>

      {/* ── Date / Now picker ── */}
      <div style={S.datePicker}>
        {/* Now button */}
        <button
          style={{ ...S.dateTab, ...(nowMode ? S.dateTabActive : {}), borderRight: '1px solid #1e3a4a' }}
          onClick={() => setNowMode(true)}
        >
          <span style={{ fontWeight: 700, fontSize: 12 }}>Now</span>
          <span style={{ fontSize: 9, color: nowMode ? '#7dd3fc' : '#475569', marginTop: 2 }}>LIVE</span>
        </button>

        {/* Date tabs */}
        {dates.map(dateStr => {
          const { main, sub } = getDayLabels(dateStr)
          const active = !nowMode && dateStr === selectedDate
          return (
            <button
              key={dateStr}
              style={{ ...S.dateTab, ...(active ? S.dateTabActive : {}) }}
              onClick={() => { setNowMode(false); setSelectedDate(dateStr) }}
            >
              <span style={{ fontWeight: 700, fontSize: 12 }}>{main}</span>
              <span style={{ fontSize: 10, color: active ? '#7dd3fc' : '#475569', marginTop: 2 }}>{sub}</span>
            </button>
          )
        })}
      </div>

      {/* ── Now mode ── */}
      {nowMode && (
        <>
          {!nowSpots && (
            <div style={S.loading}>
              <div className="spinner" />
              <p style={{ color: '#64748b', marginTop: 12, fontSize: 13 }}>Fetching live conditions...</p>
            </div>
          )}

          {nowSpots && (
            <>
              {/* Live summary bar */}
              <div style={S.summary}>
                <span style={{ background: '#1e3a4a', color: '#22c55e', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, border: '1px solid #16a34a', marginRight: 10 }}>● LIVE</span>
                <span style={{ color: '#e2e8f0', fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {nowSpots[0]?.spot_name}
                </span>
                <span style={{ color: getScoreColor(nowSpots[0]?.score), fontWeight: 800, fontSize: 22, marginLeft: 12 }}>
                  {nowSpots[0]?.score}
                </span>
                {spotsData?.conditions_summary?.water_temp_f && (
                  <span style={{ color: '#64748b', fontSize: 11, marginLeft: 10 }}>
                    💧{spotsData.conditions_summary.water_temp_f}°F
                  </span>
                )}
              </div>

              <div style={{ padding: '7px 16px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #142030', background: '#0d1f2d', position: 'sticky', top: 0 }}>
                LIVE RANKINGS — tap to expand
              </div>
              {nowSpots.map(spot => (
                <ForecastSpotRow
                  key={spot.spot_id}
                  spot={spot}
                  apiBase={apiBase}
                  conditions={nowConditions}
                  userLocation={userLocation}
                  date={new Date().toISOString().split('T')[0]}
                  hour={null}
                  onNewChat={onNewChat}
                />
              ))}
            </>
          )}
        </>
      )}

      {/* ── Forecast mode ── */}
      {!nowMode && (
        <>
          {loading && (
            <div style={S.loading}>
              <div className="spinner" />
              <p style={{ color: '#64748b', marginTop: 12, fontSize: 13 }}>Computing 24-hour forecast...</p>
            </div>
          )}

          {error && <div style={S.error}>⚠ {error}</div>}

          {forecast && !loading && (
            <>
              {/* Daily summary */}
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

              {/* Hour strip */}
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

              {/* Hour detail */}
              {hourObj && (
                <div style={S.detail}>
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

                  <div style={S.spotListHeader}>
                    SPOT RANKINGS — {formatHour(selectedHour).toUpperCase()} · tap to expand
                  </div>
                  {hourObj.spots.map(spot => (
                    <ForecastSpotRow
                      key={spot.spot_id}
                      spot={spot}
                      apiBase={apiBase}
                      conditions={hourObj.conditions}
                      userLocation={userLocation}
                      date={selectedDate}
                      hour={selectedHour}
                      onNewChat={onNewChat}
                    />
                  ))}
                </div>
              )}
            </>
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
}
