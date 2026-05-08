import { useState, useRef, useEffect } from 'react'
import CatchLogModal from './CatchLogModal'
import { distanceKm } from '../hooks/useGeolocation'

function getScoreColor(score) {
  if (score >= 80) return '#22c55e'
  if (score >= 65) return '#84cc16'
  if (score >= 50) return '#eab308'
  if (score >= 35) return '#f97316'
  return '#ef4444'
}

function ScoreBar({ score }) {
  const color = getScoreColor(score)
  return (
    <div className="score-bar-track">
      <div className="score-bar-fill" style={{ width: `${score}%`, background: color }} />
    </div>
  )
}

function FactorPill({ label, value }) {
  const color = value >= 70 ? '#4ade80' : value >= 50 ? '#facc15' : '#f87171'
  return (
    <div className="factor-pill">
      <span className="factor-label">{label}</span>
      <span className="factor-value" style={{ color }}>{value}</span>
    </div>
  )
}

function AiExplain({ spot, conditions, apiBase }) {
  const [text, setText] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${apiBase}/api/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spot_name: spot.spot_name,
        score: spot.score,
        rating: spot.rating,
        season: spot.season,
        breakdown: spot.breakdown,
        bonuses: spot.bonuses ?? null,
        solunar: spot.solunar,
        conditions,
        depth_info: spot.depth_info ?? null,
        techniques: spot.techniques ?? null,
        forage: spot.forage ?? null,
        spawn: spot.spawn ?? null,
        notes: spot.notes ?? null,
      }),
    })
      .then(r => r.json())
      .then(data => { if (!cancelled) setText(data.sections ?? null) })
      .catch(() => { if (!cancelled) setError('Could not load AI explanation.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="ai-box">
      <div className="ai-label">🤖 AI Guide</div>
      {loading && <p className="ai-text" style={{ color: '#64748b' }}>⟳ Analyzing conditions...</p>}
      {error   && <p className="ai-text" style={{ color: '#f87171', fontSize: 11 }}>{error}</p>}
      {text    && text.map((sec, i) => (
        <div key={i} style={{ marginBottom: i < text.length - 1 ? 10 : 0 }}>
          <div className="ai-section-title">{sec.title}</div>
          <p className="ai-text" style={{ margin: 0 }}>{sec.body}</p>
        </div>
      ))}
    </div>
  )
}

export default function SpotList({ spots, selectedSpot, onSelectSpot, conditions, userLocation, apiBase }) {
  const [catchModalSpot, setCatchModalSpot] = useState(null)
  const [catchSavedSpot, setCatchSavedSpot] = useState(null)
  const selectedRef = useRef(null)

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [selectedSpot])

  return (
    <div className="spot-list">
      <div className="spot-list-header">
        <span>Best Spots Today</span>
        <span className="spot-count">{spots.length} locations</span>
      </div>

      {spots.map((spot, i) => {
        const isSelected = selectedSpot?.spot_id === spot.spot_id
        const color = getScoreColor(spot.score)
        const dist = userLocation
          ? distanceKm(userLocation.lat, userLocation.lon, spot.coords.lat, spot.coords.lon)
          : null
        const bd = spot.breakdown
        const sol = spot.solunar
        const depth = spot.depth_info
        const justLogged = catchSavedSpot === spot.spot_id

        return (
          <div
            key={spot.spot_id}
            ref={isSelected ? selectedRef : null}
            className={`spot-card ${isSelected ? 'selected' : ''}`}
            onClick={() => onSelectSpot(isSelected ? null : spot)}
          >
            <div className="spot-card-top">
              <div className="spot-rank" style={{ color }}>{i + 1}</div>
              <div className="spot-main">
                <div className="spot-name">{spot.spot_name}</div>
                <ScoreBar score={spot.score} />
              </div>
              <div className="spot-score-block">
                <span className="spot-score" style={{ color }}>{spot.score}</span>
                <span className="spot-rating" style={{ color }}>{spot.rating}</span>
                {dist != null && (
                  <span className="spot-dist">{dist < 1 ? `${Math.round(dist*1000)}m` : `${dist.toFixed(1)}km`}</span>
                )}
              </div>
            </div>

            {/* Depth badge — adjusts for shallow bite / thermocline / standard */}
            {depth?.target_depth_ft && (
              <div className={`depth-badge ${depth.mode === 'shallow_bite' ? 'shallow' : depth.mode === 'thermocline' ? 'thermocline' : ''}`}>
                {depth.mode === 'shallow_bite' ? '🌅' : depth.mode === 'thermocline' ? '🌊' : '🎯'}
                {' '}Target {depth.target_depth_ft[0]}–{depth.target_depth_ft[1]} ft
                {depth.mode === 'shallow_bite' && (
                  <span className="shallow-tag">SHALLOW BITE</span>
                )}
                {depth.mode === 'thermocline' && (
                  <span className="thermocline-tag">ABOVE THERMOCLINE {depth.thermocline_ft}ft</span>
                )}
                {depth.also_check_ft && (
                  <span className="also-check">also {depth.also_check_ft[0]}–{depth.also_check_ft[1]}ft</span>
                )}
                {depth.mode === 'standard' && (
                  <span className="season-tag">{spot.season?.replace('_', ' ')}</span>
                )}
              </div>
            )}

            {/* Solunar badge */}
            {sol?.active_period && sol.active_period !== 'inactive' && (
              <div className="solunar-badge">
                ★ Solunar {sol.active_period}
                {sol.moon_phase_pct != null && ` — Moon ${sol.moon_phase_pct}%`}
              </div>
            )}

            {isSelected && (
              <div className="spot-detail">
                {/* Techniques */}
                {spot.techniques?.length > 0 && (
                  <div className="techniques-row">
                    <span className="detail-label">Techniques</span>
                    <div className="technique-pills">
                      {spot.techniques.map(t => (
                        <span key={t} className="technique-pill">{t}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Forage */}
                {spot.forage && (
                  <div className="forage-row">
                    <span className="detail-label">Primary forage</span>
                    <span className="forage-value">{spot.forage.replace('_', ' ')}</span>
                  </div>
                )}

                {/* Factor breakdown */}
                {bd && (
                  <div className="factors-grid">
                    <FactorPill label="Water Temp" value={bd.water_temp} />
                    <FactorPill label="Pressure" value={bd.pressure} />
                    <FactorPill label="Wind" value={bd.wind} />
                    <FactorPill label="Solunar" value={bd.solunar} />
                    <FactorPill label="Monthly" value={bd.monthly_qual} />
                    <FactorPill label="Time" value={bd.time_of_day} />
                  </div>
                )}

                {/* Score modifiers */}
                {spot.bonuses && (
                  spot.bonuses.catch_log !== 0 || spot.bonuses.odnr_seasonal !== 0 ||
                  spot.bonuses.front_penalty !== 0 || spot.bonuses.spawn_penalty !== 0 ||
                  spot.bonuses.goby_bonus !== 0
                ) && (
                  <div className="bonuses-row">
                    {spot.bonuses.spawn_penalty !== 0 && (
                      <span className="bonus-chip negative">
                        🐟 {spot.spawn?.label} {spot.bonuses.spawn_penalty}
                      </span>
                    )}
                    {spot.bonuses.goby_bonus !== 0 && (
                      <span className={`bonus-chip ${spot.bonuses.goby_bonus > 0 ? 'positive' : 'negative'}`}>
                        🦈 Goby {spot.bonuses.goby_bonus > 0 ? '+' : ''}{spot.bonuses.goby_bonus}
                      </span>
                    )}
                    {spot.bonuses.front_penalty !== 0 && (
                      <span className="bonus-chip negative">
                        🌬 Post-front {spot.bonuses.front_penalty}
                      </span>
                    )}
                    {spot.bonuses.catch_log !== 0 && (
                      <span className={`bonus-chip ${spot.bonuses.catch_log > 0 ? 'positive' : 'negative'}`}>
                        📔 Catch log {spot.bonuses.catch_log > 0 ? '+' : ''}{spot.bonuses.catch_log}
                      </span>
                    )}
                    {spot.bonuses.odnr_seasonal !== 0 && (
                      <span className={`bonus-chip ${spot.bonuses.odnr_seasonal > 0 ? 'positive' : 'negative'}`}>
                        📊 ODNR {spot.bonuses.odnr_seasonal > 0 ? '+' : ''}{spot.bonuses.odnr_seasonal}
                      </span>
                    )}
                  </div>
                )}

                {spot.notes && <div className="spot-notes">📍 {spot.notes}</div>}

                <div className="action-row">
                  <button
                    className="catch-btn"
                    onClick={e => { e.stopPropagation(); setCatchModalSpot(spot) }}
                  >
                    {justLogged ? '✓ Logged!' : '🎣 Log a Catch'}
                  </button>
                </div>
                <AiExplain spot={spot} conditions={conditions} apiBase={apiBase} />
              </div>
            )}
          </div>
        )
      })}

      {catchModalSpot && (
        <CatchLogModal
          spot={catchModalSpot}
          conditions={conditions}
          apiBase={apiBase}
          onClose={() => setCatchModalSpot(null)}
          onSaved={() => {
            setCatchSavedSpot(catchModalSpot.spot_id)
            setTimeout(() => setCatchSavedSpot(null), 3000)
          }}
        />
      )}

      <style>{styles}</style>
    </div>
  )
}

const styles = `
.spot-list { display: flex; flex-direction: column; }

.spot-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  font-size: 12px;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid #1e3a4a;
  position: sticky;
  top: 0;
  background: #0d1f2d;
  z-index: 10;
}
.spot-count { font-weight: 400; color: #475569; }

.spot-card {
  padding: 12px 16px;
  border-bottom: 1px solid #142030;
  cursor: pointer;
  transition: background 0.12s;
}
.spot-card:hover { background: #0f2535; }
.spot-card.selected { background: #0f2d42; border-left: 3px solid #38bdf8; }

.spot-card-top { display: flex; align-items: center; gap: 12px; }
.spot-rank { font-size: 20px; font-weight: 800; width: 24px; text-align: center; flex-shrink: 0; }
.spot-main { flex: 1; min-width: 0; }
.spot-name {
  font-size: 13px; font-weight: 600; color: #e2e8f0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 5px;
}
.score-bar-track { height: 4px; background: #1e3a4a; border-radius: 2px; overflow: hidden; }
.score-bar-fill { height: 100%; border-radius: 2px; transition: width 0.3s ease; }
.spot-score-block { display: flex; flex-direction: column; align-items: flex-end; flex-shrink: 0; }
.spot-score { font-size: 20px; font-weight: 800; line-height: 1; }
.spot-rating { font-size: 9px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; margin-top: 2px; }
.spot-dist { font-size: 10px; color: #3b82f6; margin-top: 2px; font-weight: 600; }

.depth-badge {
  margin-top: 5px;
  font-size: 11px;
  color: #94a3b8;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.depth-badge.shallow {
  color: #fde68a;
}
.season-tag {
  background: #1e3a4a;
  color: #38bdf8;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 10px;
  text-transform: uppercase;
}
.shallow-tag {
  background: rgba(250,204,21,0.12);
  color: #fde68a;
  border: 1px solid rgba(250,204,21,0.3);
  font-size: 10px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.depth-badge.thermocline { color: #38bdf8; }
.thermocline-tag {
  background: rgba(56,189,248,0.12);
  color: #38bdf8;
  border: 1px solid rgba(56,189,248,0.3);
  font-size: 10px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.also-check {
  font-size: 10px;
  color: #64748b;
  font-style: italic;
}

.solunar-badge {
  margin-top: 4px;
  font-size: 11px;
  color: #facc15;
  background: rgba(250,204,21,0.08);
  border: 1px solid rgba(250,204,21,0.2);
  border-radius: 4px;
  padding: 3px 8px;
  display: inline-block;
}

.spot-detail {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #1e3a4a;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.detail-label {
  font-size: 10px; font-weight: 700; color: #64748b;
  text-transform: uppercase; letter-spacing: 0.4px; margin-right: 8px;
}

.techniques-row, .forage-row { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.technique-pills { display: flex; gap: 4px; flex-wrap: wrap; }
.technique-pill {
  background: #0c2a3e; border: 1px solid #1e5a7a;
  color: #7dd3fc; font-size: 11px; padding: 2px 8px; border-radius: 10px;
}
.forage-value { font-size: 12px; color: #94a3b8; }

.factors-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.factor-pill {
  background: #0a1f2e; border: 1px solid #1e3a4a; border-radius: 6px;
  padding: 6px 8px; display: flex; flex-direction: column; align-items: center; gap: 2px;
}
.factor-label { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: 0.4px; }
.factor-value { font-size: 16px; font-weight: 700; }

.bonuses-row { display: flex; gap: 6px; flex-wrap: wrap; }
.bonus-chip {
  font-size: 11px; padding: 3px 8px; border-radius: 10px; font-weight: 600;
}
.bonus-chip.positive { background: rgba(74,222,128,0.1); color: #4ade80; border: 1px solid rgba(74,222,128,0.2); }
.bonus-chip.negative { background: rgba(248,113,113,0.1); color: #f87171; border: 1px solid rgba(248,113,113,0.2); }

.spot-notes { font-size: 12px; color: #94a3b8; line-height: 1.5; }

.action-row { display: flex; gap: 8px; }

.catch-btn {
  flex: 1;
  background: #071a2a;
  border: 1px solid #1e5a7a;
  color: #38bdf8;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition: all 0.15s;
}
.catch-btn:hover { background: #0c2a3e; }

.ai-btn {
  flex: 1;
  background: #0c2a3e;
  border: 1px dashed #1e5a7a;
  color: #38bdf8;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition: all 0.15s;
}
.ai-btn:hover:not(:disabled) { background: #0f3550; border-style: solid; }
.ai-btn:disabled { opacity: 0.5; cursor: default; }

.ai-box {
  background: #071520;
  border: 1px solid #1e3a4a;
  border-radius: 6px;
  padding: 10px 12px;
}
.ai-label { font-size: 10px; font-weight: 700; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
.ai-section-title { font-size: 10px; font-weight: 700; color: #7dd3fc; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 3px; }
.ai-text { font-size: 12px; color: #cbd5e1; line-height: 1.6; }
`
