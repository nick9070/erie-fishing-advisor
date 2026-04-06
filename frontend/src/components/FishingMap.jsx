import { useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

const MAP_CENTER = [42.80, -79.80]
const MAP_ZOOM   = 9

function getScoreColor(score) {
  if (score >= 80) return '#22c55e'
  if (score >= 65) return '#84cc16'
  if (score >= 50) return '#eab308'
  if (score >= 35) return '#f97316'
  return '#ef4444'
}

function getRadius(score) {
  return 8 + (score / 100) * 10
}

function MapFlyTo({ selectedSpot }) {
  const map = useMap()
  useEffect(() => {
    if (selectedSpot) {
      map.flyTo([selectedSpot.coords.lat, selectedSpot.coords.lon], 12, { duration: 1 })
    }
  }, [selectedSpot, map])
  return null
}

function LocateMeButton({ userLocation }) {
  const map = useMap()
  const handleClick = () => {
    if (userLocation) {
      map.flyTo([userLocation.lat, userLocation.lon], 13, { duration: 1 })
    }
  }
  if (!userLocation) return null
  return (
    <div style={locateBtnStyle} onClick={handleClick} title="Go to my location">
      📍
    </div>
  )
}

export default function FishingMap({ spots, selectedSpot, onSelectSpot, userLocation }) {
  return (
    <MapContainer
      center={MAP_CENTER}
      zoom={MAP_ZOOM}
      style={{ width: '100%', height: '100%' }}
      zoomControl={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {/* Fishing spots */}
      {spots.map(spot => {
        const color      = getScoreColor(spot.score)
        const isSelected = selectedSpot?.spot_id === spot.spot_id
        const shallow    = spot.shallow_bite?.active
        return (
          <CircleMarker
            key={spot.spot_id}
            center={[spot.coords.lat, spot.coords.lon]}
            radius={isSelected ? getRadius(spot.score) + 4 : getRadius(spot.score)}
            pathOptions={{
              color:       isSelected ? '#fff' : color,
              fillColor:   color,
              fillOpacity: 0.85,
              weight:      isSelected ? 3 : 1.5,
            }}
            eventHandlers={{ click: () => onSelectSpot(spot) }}
          >
            <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
              <div style={{ minWidth: 170 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{spot.spot_name}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ color }}>{spot.rating}</span>
                  <span style={{ fontWeight: 700 }}>{spot.score}/100</span>
                </div>
                {spot.depth_info?.target_depth_ft && (
                  <div style={{ fontSize: 11, color: shallow ? '#fde68a' : '#94a3b8', marginTop: 3 }}>
                    {shallow ? '🌅' : '🎯'} {spot.depth_info.target_depth_ft[0]}–{spot.depth_info.target_depth_ft[1]} ft
                  </div>
                )}
                {spot.solunar?.active_period && spot.solunar.active_period !== 'inactive' && (
                  <div style={{ color: '#facc15', marginTop: 3, fontSize: 11 }}>
                    ★ {spot.solunar.active_period}
                  </div>
                )}
              </div>
            </Tooltip>
          </CircleMarker>
        )
      })}

      {/* User location dot */}
      {userLocation && (
        <CircleMarker
          center={[userLocation.lat, userLocation.lon]}
          radius={10}
          pathOptions={{
            color:       '#fff',
            fillColor:   '#3b82f6',
            fillOpacity: 1,
            weight:      2.5,
          }}
        >
          <Tooltip direction="top" permanent={false}>
            <span>📍 You are here</span>
          </Tooltip>
        </CircleMarker>
      )}

      <MapFlyTo selectedSpot={selectedSpot} />
      <LocateMeButton userLocation={userLocation} />

      {/* Legend */}
      <div style={legendStyle}>
        <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 11, color: '#94a3b8' }}>SCORE</div>
        {[
          ['80+', '#22c55e', 'Excellent'],
          ['65+', '#84cc16', 'Good'],
          ['50+', '#eab308', 'Fair'],
          ['35+', '#f97316', 'Poor'],
          ['<35', '#ef4444', 'Very Poor'],
        ].map(([range, color, label]) => (
          <div key={range} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: '#cbd5e1' }}>{range} — {label}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 4 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#3b82f6', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: '#cbd5e1' }}>You</span>
        </div>
      </div>
    </MapContainer>
  )
}

const legendStyle = {
  position:      'absolute',
  bottom:        30,
  right:         10,
  zIndex:        1000,
  background:    'rgba(13, 31, 45, 0.92)',
  border:        '1px solid #1e3a4a',
  borderRadius:  8,
  padding:       '10px 12px',
  backdropFilter:'blur(4px)',
}

const locateBtnStyle = {
  position:      'absolute',
  bottom:        110,
  right:         10,
  zIndex:        1000,
  background:    'rgba(13, 31, 45, 0.92)',
  border:        '1px solid #1e3a4a',
  borderRadius:  8,
  padding:       '8px 10px',
  fontSize:      20,
  cursor:        'pointer',
  backdropFilter:'blur(4px)',
}
