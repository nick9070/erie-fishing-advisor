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

const FACTOR_WEIGHTS = {
  water_temp: 0.27, pressure: 0.20, wind: 0.13, monthly_qual: 0.18,
  time_of_day: 0.08, solunar: 0.06, cloud_cover: 0.05, habitat_quality: 0.03,
}
const FACTOR_LABELS = {
  water_temp: 'Water Temp', pressure: 'Pressure', wind: 'Wind', solunar: 'Solunar',
  monthly_qual: 'Monthly Quality', time_of_day: 'Time of Day',
  cloud_cover: 'Cloud Cover', habitat_quality: 'Habitat Quality',
}

function getFactorDetail(key, score, conditions, solunar) {
  const hour = new Date().getHours()
  switch (key) {
    case 'water_temp': {
      const temp = conditions?.water_temp_f
      if (temp == null) return { rawValue: 'Buoy offline', explanation: 'Water temperature unavailable — nearest NDBC buoy may be offline. Score defaulted to 50.' }
      let explanation
      if (temp >= 63 && temp <= 75)      explanation = `${temp}°F is within the peak activity range (63–75°F). Aerobic scope is at or near maximum — fish are metabolically primed to feed aggressively.`
      else if (temp >= 52 && temp < 63)  explanation = `${temp}°F is cool but usable. Smallmouth are active, but metabolism is below peak. Expect slower, more deliberate bites.`
      else if (temp > 75 && temp <= 82)  explanation = `${temp}°F is warm. Eastern basin fish can retreat to the cooler metalimnion to regulate — less suppressive than in shallower water.`
      else if (temp > 82)                explanation = `${temp}°F is above the comfortable range. Fish are likely heat-stressed and holding deep in the coolest available water.`
      else                               explanation = `${temp}°F is below the usable threshold. Smallmouth metabolism slows sharply below 52°F. Fish are lethargic and feeding infrequently.`
      return { rawValue: `${temp}°F water temperature`, explanation }
    }
    case 'pressure': {
      const pres = conditions?.pressure_hpa
      const trend = conditions?.pressure_trend || 'stable'
      const trendLabel = { stable: 'stable', rising: 'rising', rising_fast: 'rising fast', falling: 'falling', falling_fast: 'falling fast' }[trend] || trend
      const rawValue = pres != null ? `${pres} hPa — ${trendLabel}` : 'No buoy data'
      const explanation = {
        stable:       'Stable pressure is the best fishing condition. Fish are unstressed by barometric change and feed on their normal schedule.',
        rising:       'Rising pressure signals a cold front has passed. Fish typically suppress feeding for 24–48 hours post-front. Expect a slow, finicky bite.',
        rising_fast:  'Rapidly rising pressure — a hard cold front just moved through. Worst bite condition. Fish may not feed for 1–2 days.',
        falling:      'Falling pressure signals an approaching front. Often a pre-front feeding window as fish sense the change and feed aggressively before shutting down.',
        falling_fast: 'Pressure dropping fast — a front is arriving. Fish may feed briefly but conditions will deteriorate quickly.',
      }[trend] || 'Pressure is within normal range.'
      return { rawValue, explanation }
    }
    case 'wind': {
      const speed = conditions?.wind_speed_mph
      const dir   = conditions?.wind_dir_label
      const rawValue = speed != null ? `${speed} mph ${dir || ''}`.trim() : 'No wind data'
      let explanation
      if (score >= 85)      explanation = `${speed} mph ${dir} — optimal. Wind pushes water onto this spot's structure, stacking baitfish on the windward face. Research shows >2× catch rates with 10–20 mph favorable wind.`
      else if (score >= 70) explanation = `${speed} mph ${dir} — decent conditions. Wind speed or direction is slightly off, but fish are still actively using the structure.`
      else if (speed > 25)  explanation = `${speed} mph — too rough. Boat control is dangerous above 25 mph and fish scatter in heavy chop.`
      else if (speed < 5)   explanation = `${speed} mph — near calm. Without wind, forage doesn't concentrate on structure. Fish are scattered and less actively feeding.`
      else                  explanation = `${speed} mph ${dir || ''} — wind direction doesn't push water onto this spot's structure, limiting the forage concentration effect.`
      return { rawValue, explanation }
    }
    case 'solunar': {
      const period   = solunar?.active_period || 'inactive'
      const phase    = solunar?.moon_phase_pct
      const nextMajor = solunar?.next_major_in_min
      const phaseStr  = phase != null ? ` — Moon ${phase}%` : ''
      const rawValue  = period === 'inactive' ? `No active period${phaseStr}` : `${period}${phaseStr}`
      let explanation
      if (period.includes('MAJOR'))       explanation = 'Currently in a major solunar period (moon overhead or underfoot). These 2-hour windows are associated with peak feeding bursts.'
      else if (period.includes('minor'))  explanation = 'Currently in a minor solunar period (moonrise or moonset). A shorter 1-hour feeding window — less intense than a major period.'
      else {
        const majorStr = nextMajor != null ? `${Math.floor(nextMajor / 60)}h ${nextMajor % 60}m` : 'unknown'
        explanation = `No active solunar period. Next major in ~${majorStr}. Note: solunar tables are weighted low (6%) — peer review (Stuart 2023) found limited correlation with actual catch rates on Lake Erie.`
      }
      return { rawValue, explanation }
    }
    case 'monthly_qual': {
      const month = new Date().toLocaleString('default', { month: 'long' })
      let explanation
      if (score >= 80)      explanation = `This spot rates ${score}/100 for ${month} — one of its prime months. Habitat, depth, and structure align well with current seasonal fish behaviour.`
      else if (score >= 60) explanation = `${score}/100 for ${month} — solid but not peak. Fish are present but may still be transitioning or not fully concentrated here.`
      else if (score >= 40) explanation = `${score}/100 for ${month} — fair. The spot is fishable but this season's patterns don't favour its structure type as strongly.`
      else                  explanation = `${score}/100 for ${month} — below average. Fish are likely using different structure or depth ranges than this spot offers right now.`
      return { rawValue: `${month} quality: ${score}/100`, explanation }
    }
    case 'time_of_day': {
      const ampm    = hour >= 12 ? 'PM' : 'AM'
      const display = `${hour % 12 || 12}:00 ${ampm}`
      let explanation
      if (hour >= 5 && hour <= 8)          explanation = 'Dawn feeding window (5–8 AM). Smallmouth move to <2m depth at first light to ambush prey (Suski & Ridgway 2009). Best shallow bite of the day.'
      else if (hour >= 17 && hour <= 20)   explanation = 'Dusk feeding window (5–8 PM). Second major feeding window as light fades. Fish move shallow and become aggressive — similar opportunity to dawn.'
      else if (hour >= 9 && hour <= 11)    explanation = 'Post-dawn (9–11 AM). Fish are transitioning to mid-depth structure. Bite is slowing but still productive if you follow them down.'
      else if (hour >= 21 || hour <= 4)    explanation = 'Night hours. Bite is generally slower, though summer nights can produce on topwater presentations.'
      else                                 explanation = 'Mid-day (noon–4 PM). Smallmouth have moved to deeper structure to escape light and heat. Target thermocline depth and shaded rocky edges.'
      return { rawValue: display, explanation }
    }
    default:
      return { rawValue: null, explanation: 'No detail available.' }
  }
}

function getOverallScoreExplanation(spot) {
  const { score, breakdown, bonuses, spawn } = spot
  const factors = Object.entries(breakdown || {})
    .map(([key, val]) => ({ key, label: FACTOR_LABELS[key] || key, value: val, weight: FACTOR_WEIGHTS[key] || 0 }))
    .sort((a, b) => b.value - a.value)
  const top3    = factors.slice(0, 3)
  const weakest = factors[factors.length - 1]
  const modifierDefs = [
    { key: 'spawn_penalty',    label: spawn?.label ? `${spawn.label} phase` : 'Spawn phase' },
    { key: 'front_penalty',    label: 'Post-front suppression' },
    { key: 'goby_bonus',       label: 'Goby forage' },
    { key: 'catch_log',        label: 'Your catch history' },
    { key: 'odnr_seasonal',    label: 'ODNR seasonal' },
    { key: 'temp_trend',       label: 'Temp trend' },
    { key: 'wind_persistence', label: 'Wind persistence' },
    { key: 'current',          label: 'Surface current' },
  ]
  const activeModifiers = modifierDefs
    .map(d => ({ label: d.label, value: bonuses?.[d.key] ?? 0 }))
    .filter(m => m.value !== 0)
  let summary
  if (score >= 80)      summary = 'Conditions are stacked in your favour — this is a high-confidence spot right now.'
  else if (score >= 65) summary = 'Solid overall. A few factors are holding the score back, but this spot is worth fishing.'
  else if (score >= 50) summary = "Fair conditions. Fish are catchable here but don't expect lights-out action."
  else if (score >= 35) summary = 'Below average. Conditions or timing are working against this spot today.'
  else                  summary = 'Tough conditions. This spot is unlikely to produce well right now.'
  return { top3, weakest, activeModifiers, summary }
}

function ScorePopup({ data, onClose }) {
  const { label, score, rawValue, explanation } = data
  const color = score >= 70 ? '#4ade80' : score >= 50 ? '#facc15' : '#f87171'
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={e => e.stopPropagation()}>
        <div style={popupHeaderStyle}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.6px' }}>{label}</span>
          <button style={closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ color, fontSize: 48, fontWeight: 800, lineHeight: 1 }}>{score}</span>
          <span style={{ color: '#475569', fontSize: 15, alignSelf: 'flex-end', marginBottom: 5 }}>/100</span>
        </div>
        {rawValue && <div style={rawValueStyle}>{rawValue}</div>}
        <p style={explanationStyle}>{explanation}</p>
      </div>
    </div>
  )
}

function OverallScorePopup({ spot, onClose }) {
  const color = getScoreColor(spot.score)
  const { top3, weakest, activeModifiers, summary } = getOverallScoreExplanation(spot)
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={e => e.stopPropagation()}>
        <div style={popupHeaderStyle}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.5px', maxWidth: 220, lineHeight: 1.3 }}>{spot.spot_name}</span>
          <button style={closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
          <span style={{ color, fontSize: 52, fontWeight: 800, lineHeight: 1 }}>{spot.score}</span>
          <span style={{ color, fontSize: 14, fontWeight: 700 }}>{spot.rating}</span>
        </div>
        <div style={sectionStyle}>
          <div style={sectionLabel}>Top factors</div>
          {top3.map(f => (
            <div key={f.key} style={explainRow}>
              <span style={{ color: '#94a3b8', fontSize: 13 }}>{f.label}</span>
              <span style={{ fontWeight: 700, fontSize: 14, color: f.value >= 70 ? '#4ade80' : f.value >= 50 ? '#facc15' : '#f87171' }}>{f.value}</span>
            </div>
          ))}
        </div>
        <div style={sectionStyle}>
          <div style={sectionLabel}>Holding it back</div>
          <div style={explainRow}>
            <span style={{ color: '#94a3b8', fontSize: 13 }}>{weakest.label}</span>
            <span style={{ fontWeight: 700, fontSize: 14, color: '#f87171' }}>{weakest.value}</span>
          </div>
        </div>
        {activeModifiers.length > 0 && (
          <div style={sectionStyle}>
            <div style={sectionLabel}>Score modifiers</div>
            {activeModifiers.map((m, i) => (
              <div key={i} style={explainRow}>
                <span style={{ color: '#94a3b8', fontSize: 13 }}>{m.label}</span>
                <span style={{ fontWeight: 700, fontSize: 14, color: m.value > 0 ? '#4ade80' : '#f87171' }}>{m.value > 0 ? '+' : ''}{m.value}</span>
              </div>
            ))}
          </div>
        )}
        <p style={{ ...explanationStyle, marginTop: 4 }}>{summary}</p>
      </div>
    </div>
  )
}

const overlayStyle    = { position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }
const cardStyle       = { background: '#0d1f2d', border: '1px solid #1e3a4a', borderRadius: 14, width: '100%', maxWidth: 320, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }
const popupHeaderStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
const closeBtn        = { background: 'none', border: '1px solid #1e3a4a', borderRadius: 6, color: '#64748b', fontSize: 13, width: 30, height: 30, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }
const rawValueStyle   = { background: '#071520', border: '1px solid #1e3a4a', borderRadius: 6, padding: '8px 12px', fontSize: 13, fontWeight: 600, color: '#e2e8f0' }
const explanationStyle = { fontSize: 13, color: '#94a3b8', lineHeight: 1.6, margin: 0 }
const sectionStyle    = { display: 'flex', flexDirection: 'column', gap: 6 }
const sectionLabel    = { fontSize: 9, fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }
const explainRow      = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }

function FactorPill({ label, value, onTap }) {
  const color = value >= 70 ? '#4ade80' : value >= 50 ? '#facc15' : '#f87171'
  return (
    <div
      onClick={e => { e.stopPropagation(); onTap?.() }}
      style={{ background: '#0a1f2e', border: '1px solid #1e3a4a', borderRadius: 6, padding: '6px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer' }}
    >
      <span style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 700, color }}>{value}</span>
      <span style={{ fontSize: 9, color: '#334d66' }}>ⓘ</span>
    </div>
  )
}

function ForecastSpotRow({ spot, apiBase, conditions, userLocation, date, hour, onNewChat }) {
  const [expanded,        setExpanded]        = useState(false)
  const [aiText,          setAiText]          = useState(null)
  const [aiLoad,          setAiLoad]          = useState(false)
  const [aiError,         setAiError]         = useState(null)
  const [catchModalOpen,  setCatchModalOpen]  = useState(false)
  const [justLogged,      setJustLogged]      = useState(false)
  const [activePopup,     setActivePopup]     = useState(null)
  const [scoreExplainOpen, setScoreExplainOpen] = useState(false)

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

        {/* Score explanation button — always visible below score bar */}
        <div style={{ padding: '0 16px 8px' }}>
          <button
            onClick={e => { e.stopPropagation(); setScoreExplainOpen(true) }}
            style={{ width: '100%', background: 'transparent', border: '1px solid #1e5a7a', borderRadius: 6, color: '#38bdf8', fontSize: 11, fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase', padding: '6px 0', cursor: 'pointer' }}
          >
            Score Explanation
          </button>
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
              {[
                { key: 'water_temp',   label: 'Water Temp', value: bd.water_temp },
                { key: 'pressure',     label: 'Pressure',   value: bd.pressure },
                { key: 'wind',         label: 'Wind',       value: bd.wind },
                { key: 'solunar',      label: 'Solunar',    value: bd.solunar },
                { key: 'monthly_qual', label: 'Monthly',    value: bd.monthly_qual },
                { key: 'time_of_day',  label: 'Time',       value: bd.time_of_day },
              ].map(({ key, label, value }) => (
                <FactorPill
                  key={key}
                  label={label}
                  value={value}
                  onTap={() => {
                    const detail = getFactorDetail(key, value, conditions, sol)
                    setActivePopup({ label, score: value, ...detail })
                  }}
                />
              ))}
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

      {activePopup     && <ScorePopup data={activePopup} onClose={() => setActivePopup(null)} />}
      {scoreExplainOpen && <OverallScorePopup spot={spot} onClose={() => setScoreExplainOpen(false)} />}
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
