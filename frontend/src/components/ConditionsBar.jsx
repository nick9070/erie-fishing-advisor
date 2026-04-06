const TREND_ICON  = { rising: '↑', falling: '↓', stable: '→' }
const TREND_COLOR = { rising: '#4ade80', falling: '#f87171', stable: '#94a3b8' }

export default function ConditionsBar({ conditions, season }) {
  const {
    water_temp_f,
    pressure_hpa,
    pressure_trend,
    wind_speed_mph,
    wind_dir_label,
    cloud_cover_pct,
    conditions: sky,
  } = conditions

  const trendIcon  = TREND_ICON[pressure_trend]  ?? '→'
  const trendColor = TREND_COLOR[pressure_trend] ?? '#94a3b8'
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
          suffix={<span style={{ color: trendColor, fontWeight: 700 }}>{trendIcon} {pressure_trend}</span>}
        />
        <Stat
          label="Wind"
          value={`${wind_speed_mph?.toFixed(0)} mph ${wind_dir_label ?? ''}`}
          icon="💨"
          color={getWindColor(wind_speed_mph)}
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
      </div>

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
  if (mph <= 15) return '#4ade80'
  if (mph <= 20) return '#facc15'
  return '#f87171'
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
`
