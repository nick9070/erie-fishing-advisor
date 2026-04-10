const TREND_ICON  = { rising_fast: '↑↑', rising: '↑', stable: '→', falling: '↓', falling_fast: '↓↓' }
const TREND_COLOR = { rising_fast: '#f87171', rising: '#fb923c', stable: '#4ade80', falling: '#facc15', falling_fast: '#f87171' }
const TREND_LABEL = { rising_fast: 'rising fast', rising: 'rising', stable: 'stable', falling: 'falling', falling_fast: 'falling fast' }

const SPAWN_COLOR = {
  winter:               '#64748b',
  pre_spawn_early:      '#38bdf8',
  pre_spawn:            '#4ade80',
  spawn:                '#facc15',
  post_spawn_guard:     '#f97316',
  post_spawn_recovery:  '#fb923c',
  active:               '#4ade80',
  fall:                 '#f97316',
  fall_transition:      '#f97316',
}

export default function ConditionsBar({ conditions, season }) {
  const {
    water_temp_f,
    pressure_hpa,
    pressure_trend,
    pressure_rate_mb_hr,
    wind_speed_mph,
    wind_gust_mph,
    wind_dir_label,
    cloud_cover_pct,
    conditions: sky,
    buoy_name,
    thermocline_depth_ft,
    thermocline_stratified,
    thermocline_note,
    spawn_phase,
    spawn_label,
    clarity_label,
    clarity_kd490,
    temp_trend_label,
    temp_trend_delta_f,
  } = conditions

  const trendIcon  = TREND_ICON[pressure_trend]  ?? '→'
  const trendColor = TREND_COLOR[pressure_trend] ?? '#94a3b8'
  const trendLabel = TREND_LABEL[pressure_trend] ?? pressure_trend
  const hour = new Date().getHours()
  const month = new Date().getMonth() + 1

  const shallowBite = getShallowBiteStatus(cloud_cover_pct ?? 50, hour, month)

  return (
    <div className="conditions-wrap">
      <div className="conditions-bar">
        <Stat
          label="Water Temp"
          value={water_temp_f ? `${water_temp_f}°F` : 'N/A'}
          icon="🌡"
          color={getTempColor(water_temp_f)}
        />
        <Stat
          label="Pressure"
          value={`${pressure_hpa?.toFixed(0)} hPa`}
          icon="🔵"
          suffix={
            <span style={{ color: trendColor, fontWeight: 700 }}>
              {trendIcon} {trendLabel}
              {pressure_rate_mb_hr != null && Math.abs(pressure_rate_mb_hr) >= 0.3
                ? ` (${pressure_rate_mb_hr > 0 ? '+' : ''}${pressure_rate_mb_hr.toFixed(1)}/hr)`
                : ''}
            </span>
          }
        />
        <Stat
          label="Wind"
          value={`${wind_speed_mph?.toFixed(0)} mph ${wind_dir_label ?? ''}`}
          icon="💨"
          color={getWindColor(wind_speed_mph)}
          suffix={wind_gust_mph > wind_speed_mph + 3
            ? <span style={{ color: '#94a3b8', fontSize: 11 }}>gusts {wind_gust_mph?.toFixed(0)}</span>
            : null}
        />
        <Stat
          label="Sky"
          value={sky}
          icon={getSkyIcon(cloud_cover_pct)}
          color={getSkyColor(cloud_cover_pct)}
        />
        {cloud_cover_pct != null && (
          <Stat
            label="Cloud Cover"
            value={`${cloud_cover_pct}%`}
            icon="☁"
            color={getSkyColor(cloud_cover_pct)}
          />
        )}
        {spawn_label && (
          <Stat
            label="Spawn Phase"
            value={spawn_label}
            icon="🐟"
            color={SPAWN_COLOR[spawn_phase] ?? '#94a3b8'}
          />
        )}
        {thermocline_stratified && thermocline_depth_ft && (
          <Stat
            label="Thermocline"
            value={`${thermocline_depth_ft}ft`}
            icon="🌊"
            color="#38bdf8"
            suffix={<span style={{ color: '#64748b', fontSize: 11 }}>target above</span>}
          />
        )}
        {clarity_label && clarity_label !== 'unknown' && (
          <Stat
            label="Clarity"
            value={clarity_label}
            icon="👁"
            color={getClarityColor(clarity_label)}
            suffix={clarity_kd490 != null
              ? <span style={{ color: '#64748b', fontSize: 11 }}>Kd490 {clarity_kd490.toFixed(2)}</span>
              : null}
          />
        )}
        {temp_trend_label && temp_trend_label !== 'insufficient data' && temp_trend_label !== 'unknown' && (
          <Stat
            label="7-Day Trend"
            value={temp_trend_label}
            icon="📈"
            color={getTrendColor(temp_trend_label)}
            suffix={temp_trend_delta_f != null
              ? <span style={{ color: '#64748b', fontSize: 11 }}>{temp_trend_delta_f > 0 ? '+' : ''}{temp_trend_delta_f}°F</span>
              : null}
          />
        )}
      </div>

      {buoy_name && (
        <div className="data-source-bar">
          📡 On-lake data: NOAA NDBC {buoy_name} · Sky: Open-Meteo (ECMWF)
          {thermocline_stratified && thermocline_note ? ` · ${thermocline_note}` : ''}
        </div>
      )}

      {shallowBite.active && (
        <div className={`shallow-bite-banner ${shallowBite.strength}`}>
          <span className="shallow-bite-icon">🌅</span>
          <div>
            <span className="shallow-bite-title">
              {shallowBite.strength === 'strong' ? 'Prime Shallow Bite Window' : 'Shallow Bite Active'}
            </span>
            <span className="shallow-bite-reason"> — {shallowBite.reason}</span>
          </div>
        </div>
      )}

      <style>{styles}</style>
    </div>
  )
}

function Stat({ label, value, icon, color, suffix }) {
  return (
    <div className="stat">
      <span className="stat-icon">{icon}</span>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value" style={color ? { color } : {}}>
          {value} {suffix}
        </div>
      </div>
    </div>
  )
}

// Mirror of backend logic so UI shows the same result without an extra API call
function getShallowBiteStatus(cloudPct, hour, month) {
  const isDawn      = hour >= 5  && hour <= 9
  const isDusk      = hour >= 18 && hour <= 21
  const isOvercast  = cloudPct >= 70
  const isPartly    = cloudPct >= 40 && cloudPct < 70
  const inSeason    = month >= 5 && month <= 11

  if (!inSeason) return { active: false }

  if (isDawn && isOvercast)
    return { active: true, strength: 'strong',   reason: 'Dawn + overcast — prime shallow window' }
  if (isDawn)
    return { active: true, strength: 'moderate', reason: 'Dawn feeding window — work shallow first' }
  if (isOvercast)
    return { active: true, strength: 'moderate', reason: 'Overcast sky — shallow bite extended past dawn' }
  if (isDusk)
    return { active: true, strength: 'moderate', reason: 'Dusk feeding window — fish move shallow' }
  if (isPartly && (isDawn || isDusk))
    return { active: true, strength: 'light',    reason: 'Partly cloudy during feeding window' }

  return { active: false }
}

function getTempColor(temp) {
  if (!temp) return '#94a3b8'
  if (temp >= 58 && temp <= 76) return '#4ade80'
  if (temp >= 50 && temp <= 80) return '#facc15'
  return '#f87171'
}

function getWindColor(mph) {
  if (!mph) return '#94a3b8'
  if (mph >= 10 && mph <= 20) return '#4ade80'  // research: >2x catch rate in this range
  if (mph < 10) return '#facc15'                 // calm — decent but fish less concentrated
  if (mph <= 25) return '#fb923c'                // rough but fishable
  return '#f87171'                               // too rough
}

function getSkyIcon(pct) {
  if (pct == null) return '☁'
  if (pct >= 70) return '☁'
  if (pct >= 30) return '⛅'
  return '☀'
}

function getSkyColor(pct) {
  if (pct == null) return '#94a3b8'
  if (pct >= 70) return '#4ade80'   // overcast = good
  if (pct >= 40) return '#facc15'   // partly cloudy = decent
  return '#94a3b8'                  // clear = neutral (not bad, just different)
}

function getTrendColor(label) {
  if (!label) return '#94a3b8'
  if (label.includes('warming fast')) return '#4ade80'
  if (label.includes('warming'))      return '#86efac'
  if (label.includes('stable'))       return '#94a3b8'
  if (label.includes('cooling fast')) return '#f87171'
  if (label.includes('cooling'))      return '#fca5a5'
  return '#94a3b8'
}

function getClarityColor(label) {
  if (label === 'crystal clear') return '#facc15'  // fish spooky — caution yellow
  if (label === 'clear')         return '#4ade80'  // eastern basin ideal
  if (label === 'moderate')      return '#4ade80'  // decent
  if (label === 'turbid')        return '#fb923c'  // murky — notable
  return '#94a3b8'
}

const styles = `
.conditions-wrap {
  flex-shrink: 0;
}

.conditions-bar {
  display: flex;
  background: #0a1a2a;
  border-bottom: 1px solid #1e3a4a;
  overflow-x: auto;
}

.stat {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
  border-right: 1px solid #1e3a4a;
  white-space: nowrap;
}
.stat-icon { font-size: 18px; }
.stat-label {
  font-size: 10px;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}
.stat-value {
  font-size: 14px;
  font-weight: 600;
  color: #e2e8f0;
  margin-top: 1px;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Shallow bite banner */
.shallow-bite-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 20px;
  border-bottom: 1px solid;
  font-size: 12px;
}
.shallow-bite-banner.strong {
  background: rgba(34,197,94,0.12);
  border-color: rgba(34,197,94,0.3);
  color: #4ade80;
}
.shallow-bite-banner.moderate {
  background: rgba(250,204,21,0.08);
  border-color: rgba(250,204,21,0.25);
  color: #fde68a;
}
.shallow-bite-banner.light {
  background: rgba(148,163,184,0.07);
  border-color: rgba(148,163,184,0.2);
  color: #94a3b8;
}
.shallow-bite-icon { font-size: 16px; }
.shallow-bite-title { font-weight: 700; }
.shallow-bite-reason { opacity: 0.85; }

.data-source-bar {
  padding: 4px 20px;
  font-size: 10px;
  color: #475569;
  background: #0a1a2a;
  border-bottom: 1px solid #1e3a4a;
  letter-spacing: 0.2px;
}
`
