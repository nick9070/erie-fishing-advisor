"""
Water temperature data from NOAA NDBC buoys on Lake Erie.
No API key required — NOAA data is public.

Lake Erie buoy stations:
  45005 — Lake Erie Central (near Put-in-Bay area)
  45142 — Lake Erie East
  45143 — Lake Erie West
  45170 — Lake Erie (Cleveland area)
"""

import math
import requests
from functools import lru_cache


NDBC_BASE = "https://www.ndbc.noaa.gov/data/realtime2"

# Known Lake Erie NDBC stations with coords
# Eastern basin stations prioritized for Ontario-side fishing
LAKE_ERIE_BUOYS = {
    "45005": {"lat": 41.68, "lon": -82.40, "name": "Lake Erie Central"},
    "45142": {"lat": 42.02, "lon": -80.55, "name": "Lake Erie East (near Long Point)"},
    "45143": {"lat": 41.82, "lon": -83.19, "name": "Lake Erie West"},
    "45170": {"lat": 41.73, "lon": -81.64, "name": "Lake Erie (Cleveland)"},
    "45132": {"lat": 42.60, "lon": -79.27, "name": "Lake Erie Eastern Basin"},
}


def get_water_temp(lat: float, lon: float) -> dict:
    """
    Get water temperature from the nearest Lake Erie NDBC buoy.
    Returns temp in °F and the buoy used.
    """
    nearest_id = _nearest_buoy(lat, lon)
    buoy_info = LAKE_ERIE_BUOYS[nearest_id]

    temp_c = _fetch_buoy_temp(nearest_id)
    if temp_c is None:
        return {
            "water_temp_f": None,
            "buoy_id": nearest_id,
            "buoy_name": buoy_info["name"],
            "error": "Could not retrieve buoy data"
        }

    temp_f = round((temp_c * 9 / 5) + 32, 1)
    return {
        "water_temp_f": temp_f,
        "water_temp_c": round(temp_c, 1),
        "buoy_id": nearest_id,
        "buoy_name": buoy_info["name"],
    }


def _fetch_buoy_temp(station_id: str) -> float | None:
    """Parse the NDBC standard meteorological data file for water temp (WTMP)."""
    url = f"{NDBC_BASE}/{station_id}.txt"
    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        lines = resp.text.strip().split("\n")

        # Line 0: header names, Line 1: units, Line 2+: data (most recent first)
        if len(lines) < 3:
            return None

        headers = lines[0].split()
        if "WTMP" not in headers:
            return None

        wtmp_idx = headers.index("WTMP")
        # Most recent reading is line 2
        values = lines[2].split()
        temp_str = values[wtmp_idx]

        if temp_str in ("MM", "999", "99"):  # NOAA missing data codes
            return None

        return float(temp_str)
    except Exception:
        return None


def _nearest_buoy(lat: float, lon: float) -> str:
    """Return the station ID of the nearest buoy to given coordinates."""
    def haversine(lat1, lon1, lat2, lon2):
        R = 3959  # miles
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlam = math.radians(lon2 - lon1)
        a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return min(
        LAKE_ERIE_BUOYS.keys(),
        key=lambda sid: haversine(lat, lon,
                                   LAKE_ERIE_BUOYS[sid]["lat"],
                                   LAKE_ERIE_BUOYS[sid]["lon"])
    )


def score_water_temp(temp_f: float | None, season: str) -> int:
    """
    Score water temperature for smallmouth bass activity.
    Smallmouth are cold-blooded — temperature drives everything.

    Optimal ranges by season:
      pre_spawn:  48-62°F (staging, aggressive)
      spawn:      62-68°F (on beds)
      post_spawn: 65-72°F (recovery, then active)
      summer:     65-76°F (deep structure)
      fall:       55-68°F (aggressive feed-up)
    """
    if temp_f is None:
        return 50  # neutral if no data

    # Eastern basin ranges — slightly wider due to fish using deeper, cooler water
    optimal = {
        "pre_spawn":  (50, 63, 45, 68),   # (low_ideal, high_ideal, low_ok, high_ok)
        "spawn":      (55, 68, 52, 72),   # spawn trigger 55-65°F, peaks early-mid June
        "post_spawn": (64, 74, 58, 78),
        "summer":     (64, 76, 58, 80),   # fish go deep when surface >76
        "fall":       (50, 68, 46, 72),
        "winter":     (38, 48, 34, 52),
    }

    lo_ideal, hi_ideal, lo_ok, hi_ok = optimal.get(season, (58, 72, 50, 78))

    if lo_ideal <= temp_f <= hi_ideal:
        return 95
    elif lo_ok <= temp_f <= hi_ok:
        # Linear interpolation toward edges
        if temp_f < lo_ideal:
            score = 50 + 45 * (temp_f - lo_ok) / (lo_ideal - lo_ok)
        else:
            score = 50 + 45 * (hi_ok - temp_f) / (hi_ok - hi_ideal)
        return round(score)
    else:
        return 10  # outside acceptable range


def get_season(month: int) -> str:
    """
    Map calendar month to bass fishing season.
    Calibrated for eastern basin of Lake Erie (Ontario side):
    spawn runs ~2-3 weeks later than the western basin.
    """
    if month in (4, 5):
        return "pre_spawn"
    elif month == 6:
        return "spawn"       # Eastern basin spawn peaks early-mid June
    elif month == 7:
        return "post_spawn"
    elif month in (8, 9):
        return "summer"
    elif month in (10, 11):
        return "fall"
    else:
        return "winter"  # Dec-Mar: fish 35-50ft, largely inactive
