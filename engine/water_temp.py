"""
Water temperature and on-lake meteorological data from NOAA NDBC buoys.
No API key required — NOAA data is public.

Lake Erie buoy stations:
  45005 — Lake Erie Central (near Put-in-Bay area)
  45142 — Lake Erie East (near Long Point)
  45143 — Lake Erie West
  45170 — Lake Erie (Cleveland area)
  45132 — Lake Erie Eastern Basin  ← primary for Ontario eastern basin fishing

NDBC buoys report actual measured on-lake conditions — more accurate for
pressure and wind than land-based model interpolation (OWM/NWS).
"""

import math
import requests


NDBC_BASE = "https://www.ndbc.noaa.gov/data/realtime2"

LAKE_ERIE_BUOYS = {
    "45005": {"lat": 41.68, "lon": -82.40, "name": "Lake Erie Central"},
    "45142": {"lat": 42.02, "lon": -80.55, "name": "Lake Erie East (Long Point)"},
    "45143": {"lat": 41.82, "lon": -83.19, "name": "Lake Erie West"},
    "45170": {"lat": 41.73, "lon": -81.64, "name": "Lake Erie (Cleveland)"},
    "45132": {"lat": 42.60, "lon": -79.27, "name": "Lake Erie Eastern Basin"},
}

# NDBC codes for missing/invalid data
_MISSING = {"MM", "999", "99", "9999", "99.0", "99.00", "999.0", "9999.0"}


def get_buoy_conditions(lat: float, lon: float) -> dict:
    """
    Get all available meteorological data from the nearest NDBC buoy:
    water temp, barometric pressure, wind speed/dir/gust, air temp.

    Tries nearest buoy first, falls back to next nearest if offline.
    NDBC wind is in m/s — converted to mph here.
    NDBC temp is in °C — converted to °F here.
    """
    buoys_by_dist = sorted(
        LAKE_ERIE_BUOYS.keys(),
        key=lambda sid: _haversine(lat, lon,
                                   LAKE_ERIE_BUOYS[sid]["lat"],
                                   LAKE_ERIE_BUOYS[sid]["lon"])
    )

    for station_id in buoys_by_dist:
        info = LAKE_ERIE_BUOYS[station_id]
        raw  = _fetch_buoy_data(station_id)
        if raw is None:
            continue

        result = {"buoy_id": station_id, "buoy_name": info["name"]}

        # Water temperature
        wtmp = raw.get("WTMP")
        result["water_temp_f"] = round((wtmp * 9/5) + 32, 1) if wtmp is not None else None
        result["water_temp_c"] = round(wtmp, 1)               if wtmp is not None else None

        # Barometric pressure (hPa — same unit, no conversion needed)
        pres = raw.get("PRES")
        result["pressure_hpa"] = round(pres, 1) if pres is not None else None

        # Wind speed and gust (m/s → mph)
        wspd = raw.get("WSPD")
        gst  = raw.get("GST")
        wdir = raw.get("WDIR")
        result["wind_speed_mph"] = round(wspd * 2.23694, 1) if wspd is not None else None
        result["wind_gust_mph"]  = round(gst  * 2.23694, 1) if gst  is not None else None
        result["wind_dir_deg"]   = wdir
        result["wind_dir_label"] = _deg_to_compass(wdir)     if wdir is not None else None

        # Air temperature
        atmp = raw.get("ATMP")
        result["air_temp_f"] = round((atmp * 9/5) + 32, 1) if atmp is not None else None

        # Accept this buoy if it has at least water temp or pressure
        if result.get("water_temp_f") is not None or result.get("pressure_hpa") is not None:
            return result

    return {"buoy_id": None, "buoy_name": None, "error": "All buoys offline"}


def get_water_temp(lat: float, lon: float) -> dict:
    """Backwards-compatible wrapper returning just water temp fields."""
    cond = get_buoy_conditions(lat, lon)
    return {
        "water_temp_f": cond.get("water_temp_f"),
        "water_temp_c": cond.get("water_temp_c"),
        "buoy_id":      cond.get("buoy_id"),
        "buoy_name":    cond.get("buoy_name"),
    }


def _fetch_buoy_data(station_id: str) -> dict | None:
    """
    Download and parse the NDBC standard meteorological data file.
    Returns a dict of available fields in native NDBC units:
      WDIR (deg), WSPD (m/s), GST (m/s), PRES (hPa), ATMP (°C), WTMP (°C)
    Returns None if the file can't be fetched or parsed.
    """
    url = f"{NDBC_BASE}/{station_id}.txt"
    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        lines = resp.text.strip().split("\n")
        if len(lines) < 3:
            return None

        # Line 0: "#YY MM DD hh mm WDIR WSPD ..." — strip leading #
        headers = lines[0].lstrip("#").split()
        values  = lines[2].split()  # most recent observation (newest first)

        result = {}
        for field in ("WDIR", "WSPD", "GST", "PRES", "ATMP", "WTMP"):
            if field in headers:
                idx = headers.index(field)
                raw = values[idx] if idx < len(values) else "MM"
                result[field] = float(raw) if raw not in _MISSING else None
            else:
                result[field] = None

        return result
    except Exception:
        return None


def _haversine(lat1, lon1, lat2, lon2):
    R    = 3959
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a    = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _nearest_buoy(lat: float, lon: float) -> str:
    return min(LAKE_ERIE_BUOYS.keys(),
               key=lambda sid: _haversine(lat, lon,
                                          LAKE_ERIE_BUOYS[sid]["lat"],
                                          LAKE_ERIE_BUOYS[sid]["lon"]))


def _deg_to_compass(deg: float) -> str:
    dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE",
            "S","SSW","SW","WSW","W","WNW","NW","NNW"]
    return dirs[round(deg / 22.5) % 16]


# ── Scoring functions ────────────────────────────────────────────────────────

def score_water_temp(temp_f: float | None, season: str) -> int:
    """
    Score water temperature for smallmouth bass activity.
    Based on Brownscombe et al. (2024): physiological optimum 17-24°C (63-75°F).
    Eastern basin fish use deeper, cooler water — ranges slightly wider.
    """
    if temp_f is None:
        return 50

    optimal = {
        "pre_spawn":  (50, 63, 45, 68),   # (low_ideal, high_ideal, low_ok, high_ok)
        "spawn":      (55, 68, 52, 72),
        "post_spawn": (64, 74, 58, 78),
        "summer":     (64, 76, 58, 80),
        "fall":       (50, 68, 46, 72),
        "winter":     (38, 48, 34, 52),
    }

    lo_ideal, hi_ideal, lo_ok, hi_ok = optimal.get(season, (58, 72, 50, 78))

    if lo_ideal <= temp_f <= hi_ideal:
        return 95
    elif lo_ok <= temp_f <= hi_ok:
        if temp_f < lo_ideal:
            score = 50 + 45 * (temp_f - lo_ok) / (lo_ideal - lo_ok)
        else:
            score = 50 + 45 * (hi_ok - temp_f) / (hi_ok - hi_ideal)
        return round(score)
    else:
        return 10


def get_season(month: int) -> str:
    """
    Map calendar month to bass fishing season.
    Calibrated for eastern basin of Lake Erie (Ontario side):
    spawn runs 2-3 weeks later than the western basin.
    """
    if month in (4, 5):
        return "pre_spawn"
    elif month == 6:
        return "spawn"
    elif month == 7:
        return "post_spawn"
    elif month in (8, 9):
        return "summer"
    elif month in (10, 11):
        return "fall"
    else:
        return "winter"
