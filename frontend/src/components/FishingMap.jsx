import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, WMSTileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

const MAP_CENTER = [42.80, -79.80]
const MAP_ZOOM   = 9

const BOAT_LAUNCHES = [
  { name: 'Port Dover',              lat: 42.786, lon: -80.202 },
  { name: 'Nanticoke',               lat: 42.818, lon: -80.062 },
  { name: 'Selkirk',                 lat: 42.847, lon: -79.882 },
  { name: 'Peacock Point',           lat: 42.834, lon: -79.827 },
  { name: 'Rock Point Prov. Park',   lat: 42.843, lon: -79.668 },
  { name: 'Port Maitland',           lat: 42.869, lon: -79.576 },
  { name: 'Dunnville (Stromness)',   lat: 42.868, lon: -79.620 },
  { name: 'Port Colborne',           lat: 42.883, lon: -79.250 },
  { name: 'Crystal Beach',           lat: 42.873, lon: -79.060 },
  { name: 'Fort Erie (Niagara)',     lat: 42.900, lon: -78.928 },
  { name: 'Turkey Point Prov. Park', lat: 42.694, lon: -80.330 },
]

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

function LayerControls({ baseLayer, setBaseLayer, showCHS, setShowCHS, showSeamarks, setShowSeamarks }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={layerControlStyle}>
      <div
        style={{ ...layerBtnStyle, background: open ? '#1e3a4a' : 'rgba(13,31,45,0.92)' }}
        onClick={() => setOpen(o => !o)}
        title="Map layers"
      >
        🗂
      </div>
      {open && (
        <div style={layerPanelStyle}>
          <div style={layerSectionStyle}>BASE</div>
          <LayerOption
            label="Street (OSM)"
            active={baseLayer === 'osm'}
            onClick={() => setBaseLayer('osm')}
          />
          <LayerOption
            label="Ocean / Depth"
            active={baseLayer === 'esri'}
            onClick={() => setBaseLayer('esri')}
          />
          <div style={{ ...layerSectionStyle, marginTop: 8 }}>OVERLAYS</div>
          <LayerOption
            label="CHS Nautical"
            active={showCHS}
            onClick={() => setShowCHS(v => !v)}
            toggle
          />
          <LayerOption
            label="Seamarks"
            active={showSeamarks}
            onClick={() => setShowSeamarks(v => !v)}
            toggle
          />
        </div>
      )}
    </div>
  )
}

function LayerOption({ label, active, onClick, toggle }) {
  return (
    <div onClick={onClick} style={layerOptionStyle(active, toggle)}>
      <span style={{ marginRight: 7 }}>{toggle ? (active ? '☑' : '☐') : (active ? '●' : '○')}</span>
      {label}
    </div>
  )
}

export default function FishingMap({ spots, selectedSpot, onSelectSpot, userLocation }) {
  const [baseLayer,    setBaseLayer]    = useState('osm')
  const [showCHS,      setShowCHS]      = useState(false)
  const [showSeamarks, setShowSeamarks] = useState(false)

  return (
    <MapContainer
      center={MAP_CENTER}
      zoom={MAP_ZOOM}
      style={{ width: '100%', height: '100%' }}
      zoomControl={true}
    >
      {baseLayer === 'osm' && (
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
      )}
      {baseLayer === 'esri' && (
        <TileLayer
          attribution='&copy; <a href="https://www.esri.com">Esri</a>, DeLorme, GEBCO, NOAA NGDC'
          url="https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}"
          maxZoom={13}
        />
      )}
      {showCHS && (
        <WMSTileLayer
          url="https://egisp.dfo-mpo.gc.ca/arcgis/rest/services/chs/ENC_MaritimeChartService/MapServer/exts/MaritimeChartService/WMSServer"
          layers="ENC"
          format="image/png"
          transparent={true}
          version="1.3.0"
          attribution='&copy; <a href="https://www.charts.gc.ca">CHS</a>'
          opacity={0.75}
        />
      )}
      {showSeamarks && (
        <TileLayer
          url="https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openseamap.org">OpenSeaMap</a>'
          opacity={0.9}
        />
      )}

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

      {/* Boat launches */}
      {BOAT_LAUNCHES.map(launch => (
        <CircleMarker
          key={launch.name}
          center={[launch.lat, launch.lon]}
          radius={7}
          pathOptions={{
            color:       '#38bdf8',
            fillColor:   '#0d1f2d',
            fillOpacity: 0.9,
            weight:      2,
          }}
        >
          <Tooltip direction="top" offset={[0, -6]} opacity={0.95}>
            <div style={{ minWidth: 130 }}>
              <div style={{ fontWeight: 700 }}>⚓ {launch.name}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Boat Launch</div>
            </div>
          </Tooltip>
        </CircleMarker>
      ))}

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
      <LayerControls
        baseLayer={baseLayer}    setBaseLayer={setBaseLayer}
        showCHS={showCHS}        setShowCHS={setShowCHS}
        showSeamarks={showSeamarks} setShowSeamarks={setShowSeamarks}
      />

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 3 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#0d1f2d', border: '2px solid #38bdf8', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: '#cbd5e1' }}>Boat Launch</span>
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

const layerControlStyle = {
  position:   'absolute',
  top:        10,
  right:      10,
  zIndex:     1000,
}

const layerBtnStyle = {
  border:        '1px solid #1e3a4a',
  borderRadius:  8,
  padding:       '7px 10px',
  fontSize:      18,
  cursor:        'pointer',
  backdropFilter:'blur(4px)',
  userSelect:    'none',
}

const layerPanelStyle = {
  marginTop:     6,
  background:    'rgba(13, 31, 45, 0.96)',
  border:        '1px solid #1e3a4a',
  borderRadius:  8,
  padding:       '10px 12px',
  backdropFilter:'blur(4px)',
  minWidth:      140,
}

const layerSectionStyle = {
  fontSize:     10,
  fontWeight:   700,
  color:        '#64748b',
  letterSpacing:'0.6px',
  marginBottom: 5,
}

const layerOptionStyle = (active, toggle) => ({
  fontSize:    12,
  color:       active ? (toggle ? '#38bdf8' : '#e2e8f0') : '#94a3b8',
  fontWeight:  active ? 600 : 400,
  padding:     '4px 0',
  cursor:      'pointer',
  display:     'flex',
  alignItems:  'center',
})
