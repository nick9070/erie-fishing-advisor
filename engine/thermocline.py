"""
Thermocline depth estimation for eastern Lake Erie smallmouth bass targeting.

Primary source: LEOFS (Lake Erie Operational Forecast System) stations.nowcast.nc
via NOAA OPeNDAP ASCII — gives actual temperature profiles at 20 sigma depth layers
for 28 stations across Lake Erie. Parsed with plain requests (no netCDF4 needed).

Fallback chain:
  1. LEOFS depth profile   → thermocline from real dT/dz gradient
  2. GLSEA satellite SST   → empirical model using actual surface temp
  3. Climatological estimate → empirical model with monthly average

Eastern basin context:
  - Deepest part of Lake Erie (max ~64m / 210ft)
  - Strong, persistent thermocline forms mid-June, peaks July-August
  - Typical summer thermocline: 18–26ft depth
  - Smallmouth suspend just ABOVE the thermocline or stack on structure
    that rises into that band (Ridgway et al., Brownscombe 2024)
  - Thermocline breaks down September-October as winds mix the water column
"""

import re
import time
import requests

# ── LEOFS THREDDS catalog ──────────────────────────────────────────────────────

_LEOFS_CATALOG_BASE = (
    "https://opendap.co-ops.nos.noaa.gov/thredds/catalog/NOAA/LEOFS/MODELS"
)
_LEOFS_OPENDAP_BASE = (
    "https://opendap.co-ops.nos.noaa.gov/thredds/dodsC/NOAA/LEOFS/MODELS"
)

# Module-level cache: (timestamp, result_dict)
_leofs_cache: tuple[float, dict] | None = None
_CACHE_TTL_S = 3 * 3600   # re-fetch at most every 3 hours

# ── GLSEA ERDDAP ──────────────────────────────────────────────────────────────

_GLSEA_URL = (
    "https://apps.glerl.noaa.gov/erddap/griddap/GLSEA_ACSPO_GCS.csv"
    "?sst[(last):1:(last)][({lat_min:.3f}):1:({lat_max:.3f})][({lon_min:.3f}):1:({lon_max:.3f})]"
)


# ── Public API ─────────────────────────────────────────────────────────────────

def get_thermocline(
    water_temp_f: float | None,
    month: int,
    lat: float = 42.75,
    lon: float = -79.80,
) -> dict:
    """
    Estimate thermocline depth for eastern Lake Erie.

    Returns:
      depth_ft:    float | None  — None if water column is fully mixed
      stratified:  bool
      source:      str           — 'leofs' | 'glsea' | 'buoy' | 'estimated'
      note:        str           — brief plain-English description
    """
    # Try LEOFS real depth profile first
    leofs = _get_leofs_thermocline(lat, lon)
    if leofs is not None:
        return leofs

    # Fallback: empirical model using GLSEA satellite SST or buoy temp
    glsea_temp = get_glsea_sst(lat, lon)
    if glsea_temp is not None:
        surf_temp = glsea_temp
        source    = "glsea"
    elif water_temp_f is not None:
        surf_temp = water_temp_f
        source    = "buoy"
    else:
        surf_temp = _seasonal_temp_estimate(month)
        source    = "estimated"

    return _empirical_model(surf_temp, month, source)


def get_glsea_sst(lat: float, lon: float) -> float | None:
    """
    Fetch current satellite-derived surface temp from NOAA GLSEA ERDDAP.
    Returns °F or None if unavailable.
    """
    try:
        url = _GLSEA_URL.format(
            lat_min=lat - 0.08, lat_max=lat + 0.08,
            lon_min=lon - 0.08, lon_max=lon + 0.08,
        )
        resp = requests.get(url, timeout=12)
        resp.raise_for_status()
        lines = resp.text.strip().split("\n")
        data_lines = lines[2:]   # skip header and units rows
        temps_c = []
        for line in data_lines:
            parts = line.split(",")
            if len(parts) >= 4:
                try:
                    val = float(parts[3])
                    if -2.0 < val < 35.0:
                        temps_c.append(val)
                except (ValueError, IndexError):
                    pass
        if not temps_c:
            return None
        avg_c = sum(temps_c) / len(temps_c)
        return round(avg_c * 9 / 5 + 32, 1)
    except Exception:
        return None


def get_surface_current(lat: float, lon: float) -> dict:
    """
    Return LEOFS modelled surface current speed at the nearest station.

    Uses the cached LEOFS station data (populated by get_thermocline calls).
    Returns speed in m/s and mph, plus a fishing bonus (0-8).

    Current concentrates baitfish along structure edges and creates feeding
    lanes — especially important at Niagara outflow-influenced spots and
    river mouths (Grand River, Welland Canal).
    """
    global _leofs_cache
    if not _leofs_cache:
        return {"speed_ms": None, "speed_mph": None, "bonus": 0, "label": "no data"}

    data = _leofs_cache[1]
    u_surf = data.get("u_surf", [])
    v_surf = data.get("v_surf", [])
    if not u_surf or not v_surf:
        return {"speed_ms": None, "speed_mph": None, "bonus": 0, "label": "no data"}

    n_sta  = data["n_stations"]
    lats   = data["lats"]
    lons   = data["lons"]
    depths = data["h"]

    # Find closest station (any depth — current is horizontal, valid even in shallow water)
    best_idx  = None
    best_dist = float("inf")
    for i in range(n_sta):
        dist = (lats[i] - lat) ** 2 + (lons[i] - lon) ** 2
        if dist < best_dist:
            best_dist = dist
            best_idx  = i

    if best_idx is None or best_idx >= len(u_surf) or best_idx >= len(v_surf):
        return {"speed_ms": None, "speed_mph": None, "bonus": 0, "label": "no data"}

    u = u_surf[best_idx]
    v = v_surf[best_idx]
    speed_ms  = (u ** 2 + v ** 2) ** 0.5

    # Cap at 0.7 m/s — values above this are FVCOM boundary artifacts near
    # the Niagara River inlet, not physically meaningful open-lake currents.
    # True Lake Erie wind-driven currents rarely exceed 0.5 m/s.
    speed_ms  = round(min(speed_ms, 0.70), 3)
    speed_mph = round(speed_ms * 2.237, 2)

    if speed_ms < 0.05:
        bonus, label = 0, "slack current"
    elif speed_ms < 0.15:
        bonus, label = 2, "light current"
    elif speed_ms < 0.35:
        bonus, label = 6, "moderate current — baitfish concentrating"
    elif speed_ms < 0.55:
        bonus, label = 8, "strong current — active feeding lanes"
    else:
        bonus, label = 4, "very strong current — fish seek eddies"

    return {
        "speed_ms":  speed_ms,
        "speed_mph": speed_mph,
        "bonus":     bonus,
        "label":     label,
    }


# ── LEOFS OPeNDAP implementation ───────────────────────────────────────────────

def _get_leofs_thermocline(lat: float, lon: float) -> dict | None:
    """
    Fetch real LEOFS temperature profile and detect thermocline from dT/dz gradient.
    Returns None on any failure (triggers empirical fallback).
    """
    global _leofs_cache

    now = time.monotonic()
    if _leofs_cache and (now - _leofs_cache[0]) < _CACHE_TTL_S:
        cached = _leofs_cache[1]
    else:
        cached = _fetch_leofs_stations()
        if cached:
            _leofs_cache = (now, cached)

    if not cached:
        return None

    return _compute_thermocline_from_profile(cached, lat, lon)


def _fetch_leofs_stations() -> dict | None:
    """
    Walk the THREDDS catalog to find the latest stations.nowcast.nc, then
    download lat/lon/depth/siglay/temp via OPeNDAP ASCII.

    Returns a dict with keys: lats, lons, h, siglay, temps (all lists).
    """
    import datetime
    try:
        today = datetime.date.today()
        path  = f"{today.year}/{today.month:02d}/{today.day:02d}"

        cat_url = f"{_LEOFS_CATALOG_BASE}/{path}/catalog.xml"
        r = requests.get(cat_url, timeout=10)
        if r.status_code != 200:
            # Try yesterday if today's files aren't up yet
            yesterday = today - datetime.timedelta(days=1)
            path = f"{yesterday.year}/{yesterday.month:02d}/{yesterday.day:02d}"
            r = requests.get(f"{_LEOFS_CATALOG_BASE}/{path}/catalog.xml", timeout=10)
            if r.status_code != 200:
                return None

        # Find stations.nowcast.nc filename (may have varying hour prefix t00z/t06z/etc.)
        match = re.search(r'name="(leofs\.t\d+z\.\d+\.stations\.nowcast\.nc)"', r.text)
        if not match:
            return None
        filename = match.group(1)

        base = f"{_LEOFS_OPENDAP_BASE}/{path}/{filename}.ascii"

        # Fetch lat, lon, h (bathymetric depth) for all 28 stations
        r2 = requests.get(f"{base}?lat,lon,h", timeout=12)
        if r2.status_code != 200:
            return None
        lats, lons, depths = _parse_ascii_1d(r2.text, ["lat", "lon", "h"])
        if not lats:
            return None

        # Convert LEOFS positive-east longitudes (>180) to negative
        lons = [lo - 360 if lo > 180 else lo for lo in lons]

        # Fetch siglay (20 layers × 28 stations) for last time step
        # siglay shape: [siglay=20][station=28]; request all
        r3 = requests.get(f"{base}?siglay[0:19][0:27]", timeout=12)
        if r3.status_code != 200:
            return None
        siglay_flat = _parse_ascii_2d(r3.text, "siglay")  # list of 20×28 = 560 values

        # Fetch temp for last time step (index 60), all siglay layers, all stations
        r4 = requests.get(f"{base}?temp[60:60][0:19][0:27]", timeout=15)
        if r4.status_code != 200:
            return None
        temp_flat = _parse_ascii_2d(r4.text, "temp")  # 20×28 values

        # Fetch surface current (siglay layer 0 only) — u=eastward, v=northward (m/s)
        r5 = requests.get(f"{base}?u[60:60][0:0][0:27],v[60:60][0:0][0:27]", timeout=12)
        u_surf = _parse_ascii_2d(r5.text, "u") if r5.status_code == 200 else []
        v_surf = _parse_ascii_2d(r5.text, "v") if r5.status_code == 200 else []

        return {
            "lats":       lats,
            "lons":       lons,
            "h":          depths,
            "siglay":     siglay_flat,   # [siglay_idx * 28 + station_idx]
            "temps":      temp_flat,
            "u_surf":     u_surf,        # [station_idx] eastward velocity m/s
            "v_surf":     v_surf,        # [station_idx] northward velocity m/s
            "n_stations": len(lats),
            "n_layers":   20,
        }
    except Exception:
        return None


def _parse_ascii_1d(text: str, var_names: list[str]) -> tuple:
    """Parse OPeNDAP ASCII response for multiple 1D variables."""
    results = {v: [] for v in var_names}
    current_var = None
    for line in text.split("\n"):
        line = line.strip()
        for v in var_names:
            if re.match(rf"^{v}\[", line):
                current_var = v
                break
        if current_var and line and not line.startswith(current_var):
            # Parse comma-separated floats
            try:
                vals = [float(x) for x in line.replace("[", "").split(",") if x.strip()]
                results[current_var].extend(vals)
            except ValueError:
                pass
    return tuple(results[v] for v in var_names)


def _parse_ascii_2d(text: str, var_name: str) -> list[float]:
    """
    Parse OPeNDAP ASCII 2D array response.
    Lines look like: [row][col], value  or  [row][col], v1, v2, ...
    Stops reading when the next variable header is encountered so that
    multiple variables in the same response don't bleed into each other.
    Returns flat list of floats in row-major order.
    """
    values  = []
    in_data = False
    for line in text.split("\n"):
        line = line.strip()
        if re.match(rf"^{var_name}\[", line):
            in_data = True
            continue
        if not in_data:
            continue
        # Stop at next variable header (letters followed by '[')
        if re.match(r"^[A-Za-z]\w*\[", line) and not re.match(rf"^{var_name}\[", line):
            break
        if not line or line.startswith("Dataset") or line.startswith("-----"):
            continue
        # Remove index brackets: [0][3], 6.14 → 6.14
        clean = re.sub(r"\[\d+\]", "", line).strip().lstrip(", ")
        if clean:
            try:
                vals = [float(x) for x in clean.split(",") if x.strip()]
                values.extend(vals)
            except ValueError:
                pass
    return values


def _compute_thermocline_from_profile(data: dict, lat: float, lon: float) -> dict | None:
    """
    Find the closest station with adequate depth, then detect thermocline
    from the temperature-depth profile using maximum dT/dz gradient.
    """
    n_sta   = data["n_stations"]
    n_lay   = data["n_layers"]
    lats    = data["lats"]
    lons    = data["lons"]
    depths  = data["h"]
    siglay  = data["siglay"]
    temps   = data["temps"]

    # Find closest station with h > 10m (shallow stations have no real thermocline)
    best_idx  = None
    best_dist = float("inf")
    for i in range(n_sta):
        if depths[i] < 10.0:
            continue
        dist = (lats[i] - lat) ** 2 + (lons[i] - lon) ** 2
        if dist < best_dist:
            best_dist = dist
            best_idx  = i

    if best_idx is None:
        return None

    h_m = depths[best_idx]

    # Extract temp and actual depth (ft) for this station
    profile: list[tuple[float, float]] = []
    for layer in range(n_lay):
        idx  = layer * n_sta + best_idx
        if idx >= len(siglay) or idx >= len(temps):
            continue
        sig  = siglay[idx]          # negative fraction, e.g. -0.025
        temp_c = temps[idx]
        depth_m  = abs(sig) * h_m   # positive depth in meters
        depth_ft = depth_m * 3.281
        temp_f   = temp_c * 9 / 5 + 32
        profile.append((depth_ft, temp_f))

    if len(profile) < 3:
        return None

    # Sort shallow → deep
    profile.sort(key=lambda x: x[0])

    # Find max temperature gradient (°F per ft)
    max_grad  = 0.0
    thermo_ft = None
    for i in range(1, len(profile)):
        dz = profile[i][0] - profile[i - 1][0]
        dt = profile[i - 1][1] - profile[i][1]   # positive = cooling with depth
        if dz <= 0:
            continue
        grad = dt / dz
        if grad > max_grad:
            max_grad  = grad
            thermo_ft = round((profile[i - 1][0] + profile[i][0]) / 2, 1)

    surf_temp_f = profile[0][1]

    # Threshold: only report a thermocline if gradient is meaningful (>0.3°F/ft)
    # and surface temp is warm enough for stratification
    if max_grad < 0.3 or surf_temp_f < 60:
        return {
            "depth_ft":   None,
            "stratified": False,
            "source":     "leofs",
            "note":       "Water column fully mixed (LEOFS profile)",
        }

    return {
        "depth_ft":   thermo_ft,
        "stratified": True,
        "source":     "leofs",
        "note":       f"LEOFS profile: thermocline at ~{thermo_ft:.0f}ft "
                      f"(max gradient {max_grad:.2f}°F/ft near station lat={lats[best_idx]:.2f})",
    }


# ── Empirical fallback ─────────────────────────────────────────────────────────

def _empirical_model(surf_temp_f: float, month: int, source: str) -> dict:
    """Empirical thermocline estimate calibrated to LEOFS eastern basin output."""

    if month < 6 or month > 9:
        return {
            "depth_ft":   None,
            "stratified": False,
            "source":     source,
            "note":       "Water column fully mixed",
        }

    if surf_temp_f < 64:
        return {
            "depth_ft":   None,
            "stratified": False,
            "source":     source,
            "note":       "Too cool for thermal stratification",
        }

    if surf_temp_f < 68:
        depth_ft = 15.0
        note     = "Early stratification — thermocline ~15ft"
    elif surf_temp_f < 72:
        depth_ft = 18.0 if month == 6 else 20.0
        note     = f"Moderate stratification — thermocline ~{int(depth_ft)}ft"
    elif surf_temp_f < 76:
        depth_ft = 22.0 if month in (7, 8) else 20.0
        note     = f"Strong summer stratification — thermocline ~{int(depth_ft)}ft"
    else:
        depth_ft = 25.0
        note     = "Maximum stratification — thermocline ~25ft; bass compress above it"

    return {
        "depth_ft":   depth_ft,
        "stratified": True,
        "source":     source,
        "note":       note,
    }


def _seasonal_temp_estimate(month: int) -> float:
    """Eastern basin surface temp climatology (°F) — fallback when all sources offline."""
    return {
        1: 35, 2: 34, 3: 37, 4: 46, 5: 57,  6: 67,
        7: 74, 8: 75, 9: 70, 10: 61, 11: 50, 12: 40,
    }.get(month, 55)
