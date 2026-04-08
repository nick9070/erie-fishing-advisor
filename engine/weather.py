"""
Weather data from Open-Meteo (free, no API key required).
https://open-meteo.com — uses ECMWF model, higher resolution than OWM free tier.

Pressure and wind are pulled from NDBC buoys (actual on-lake measurements)
in water_temp.py. Open-Meteo is used here for cloud cover, sky conditions,
and as a fallback when buoys are offline.
"""

import requests

OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast"

# WMO weather interpretation codes → human-readable description
WMO_CODES = {
    0:  "clear sky",
    1:  "mainly clear",   2:  "partly cloudy",    3:  "overcast",
    45: "foggy",          48: "icy fog",
    51: "light drizzle",  53: "drizzle",           55: "heavy drizzle",
    61: "light rain",     63: "rain",              65: "heavy rain",
    71: "light snow",     73: "snow",              75: "heavy snow",
    77: "snow grains",
    80: "light showers",  81: "showers",           82: "heavy showers",
    85: "snow showers",   86: "heavy snow showers",
    95: "thunderstorm",   96: "thunderstorm/hail", 99: "severe thunderstorm",
}


def _deg_to_compass(deg: float) -> str:
    dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE",
            "S","SSW","SW","WSW","W","WNW","NW","NNW"]
    return dirs[round(deg / 22.5) % 16]


def get_open_meteo(lat: float, lon: float) -> dict:
    """
    Fetch current sky/atmospheric conditions from Open-Meteo.
    Also returns wind and pressure as fallback if NDBC buoy is offline.
    """
    params = {
        "latitude":  lat,
        "longitude": lon,
        "current": ",".join([
            "temperature_2m",
            "cloud_cover",
            "weather_code",
            "precipitation",
            "surface_pressure",
            "wind_speed_10m",
            "wind_direction_10m",
            "wind_gusts_10m",
        ]),
        "temperature_unit":   "fahrenheit",
        "wind_speed_unit":    "mph",
        "precipitation_unit": "mm",
        "timezone":           "auto",
    }
    try:
        resp = requests.get(OPEN_METEO_BASE, params=params, timeout=10)
        resp.raise_for_status()
        curr  = resp.json()["current"]
        wcode = curr.get("weather_code", 0)
        return {
            "temp_f":          round(curr.get("temperature_2m", 60), 1),
            "cloud_cover_pct": curr.get("cloud_cover", 0),
            "conditions":      WMO_CODES.get(wcode, "unknown"),
            "precipitation":   curr.get("precipitation", 0),
            # Fallback pressure/wind if buoy is offline
            "pressure_hpa":    round(curr.get("surface_pressure", 1013), 1),
            "wind_speed_mph":  round(curr.get("wind_speed_10m", 0), 1),
            "wind_gust_mph":   round(curr.get("wind_gusts_10m", 0), 1),
            "wind_dir_deg":    curr.get("wind_direction_10m", 0),
        }
    except Exception:
        return {
            "temp_f":          None,
            "cloud_cover_pct": 0,
            "conditions":      "unknown",
            "precipitation":   0,
            "pressure_hpa":    None,
            "wind_speed_mph":  None,
            "wind_gust_mph":   None,
            "wind_dir_deg":    None,
        }


def get_open_meteo_hourly(lat: float, lon: float, date_str: str) -> list:
    """
    Fetch 24 hourly forecast conditions from Open-Meteo for a specific date.
    Returns a list of 24 dicts (hours 0-23, local Eastern time).
    Pressure rate-of-change is computed from consecutive hourly values.
    """
    params = {
        "latitude":  lat,
        "longitude": lon,
        "hourly": ",".join([
            "temperature_2m",
            "cloud_cover",
            "weather_code",
            "precipitation",
            "surface_pressure",
            "wind_speed_10m",
            "wind_direction_10m",
            "wind_gusts_10m",
        ]),
        "temperature_unit":   "fahrenheit",
        "wind_speed_unit":    "mph",
        "precipitation_unit": "mm",
        "timezone":           "America/Toronto",
        "start_date":         date_str,
        "end_date":           date_str,
    }
    resp = requests.get(OPEN_METEO_BASE, params=params, timeout=15)
    resp.raise_for_status()
    data      = resp.json()["hourly"]
    pressures = data["surface_pressure"]

    hours = []
    for i in range(24):
        pres      = pressures[i]
        prev_pres = pressures[i - 1] if i > 0 else pres
        rate      = round(pres - prev_pres, 2)

        if rate > 2.0:    trend = "rising_fast"
        elif rate > 0.5:  trend = "rising"
        elif rate < -2.0: trend = "falling_fast"
        elif rate < -0.5: trend = "falling"
        else:             trend = "stable"

        wcode = data["weather_code"][i]
        wdir  = data["wind_direction_10m"][i]

        hours.append({
            "temp_f":              data["temperature_2m"][i],
            "cloud_cover_pct":     data["cloud_cover"][i],
            "conditions":          WMO_CODES.get(wcode, "unknown"),
            "pressure_hpa":        round(pres, 1),
            "pressure_trend":      trend,
            "pressure_rate_mb_hr": rate,
            "wind_speed_mph":      data["wind_speed_10m"][i],
            "wind_gust_mph":       data["wind_gusts_10m"][i],
            "wind_dir_deg":        wdir,
            "wind_dir_label":      _deg_to_compass(wdir),
            "precipitation":       data["precipitation"][i],
        })

    return hours


def score_pressure(pressure_hpa: float, trend: str) -> int:
    """
    Score barometric pressure for bass fishing.

    trend values: 'rising_fast', 'rising', 'stable', 'falling', 'falling_fast'

    Based on Manns observational data and Lang (2023) cold front research:
    - Stable pressure → reliable, consistent bite
    - Falling → pre-front activity window, but deteriorating
    - Rapidly rising → hard post-front suppression (worst)
    - Rapidly falling → front imminent, erratic bite

    Rate-of-change thresholds:
      >+2.0 mb/hr = rising_fast   <-2.0 mb/hr = falling_fast
      +0.5 to +2.0 = rising       -0.5 to -2.0 = falling
      ±0.5 = stable
    """
    if pressure_hpa is None:
        pressure_hpa = 1013

    # Absolute pressure base score
    if 1010 <= pressure_hpa <= 1025:
        base = 72
    elif 1005 <= pressure_hpa < 1010:
        base = 55
    elif pressure_hpa > 1025:
        base = 65
    else:
        base = 30  # <1005 hPa — active low pressure system, poor fishing

    # Rate-of-change adjustment
    trend_bonus = {
        "stable":       15,   # reliable — best overall
        "falling":       5,   # pre-front window, still decent
        "falling_fast": -8,   # front arriving — fish may feed briefly, then shut down
        "rising":      -12,   # post-front, 24-48hr suppression (Lang 2023)
        "rising_fast": -28,   # hard front just passed — worst bite conditions
    }
    return max(0, min(100, base + trend_bonus.get(trend, 0)))


def score_cloud_cover(cloud_pct: float) -> int:
    """
    Score cloud cover for bass fishing.
    Overcast conditions extend the shallow feeding window throughout the day.
    Bluebird sky compresses feeding to dawn/dusk and pushes fish deep.
    """
    if cloud_pct >= 75:
        return 88   # overcast — feeding window extended, fish shallower all day
    elif cloud_pct >= 50:
        return 72   # partly cloudy — good conditions
    elif cloud_pct >= 25:
        return 55   # mostly clear — standard
    else:
        return 35   # bluebird — fish deep, tight bite windows


def score_wind(speed_mph: float, wind_dir: str, spot_best_winds: list) -> int:
    """
    Score wind for bass fishing.

    Research (High Percentage Fishing database, 40k+ catches):
    Winds >15 mph correlated with >2x normal catch rates due to forage
    concentration on windward structure. Reward moderate-strong wind;
    only penalize when too rough for safe boat operation (>25 mph).
    """
    if speed_mph is None:
        speed_mph = 8

    if 10 <= speed_mph <= 20:
        speed_score = 90   # forage concentrates on windward structure
    elif 5 <= speed_mph < 10:
        speed_score = 75   # light wind — decent but less concentration effect
    elif speed_mph < 5:
        speed_score = 55   # calm — fish scattered, less actively feeding
    elif 20 < speed_mph <= 25:
        speed_score = 45   # rough — fish still bite but boat control is challenging
    else:
        speed_score = 10   # >25 mph — too rough to fish effectively

    # Direction bonus — does wind push water onto this spot's structure?
    dir_score = 80 if wind_dir in spot_best_winds else 40
    return round((speed_score * 0.6) + (dir_score * 0.4))


def get_shallow_bite_status(cloud_pct: float, hour: int, month: int) -> dict:
    """
    Determine whether the shallow bite window is currently active.
    Fires at dawn (5-9am), dusk (6-9pm), and/or overcast conditions.
    Research (Suski & Ridgway 2009): smallmouth move to <2m at night/dawn,
    descend to 3-5m mid-day. Overcast extends the shallow window.
    """
    is_dawn     = 5 <= hour <= 9
    is_dusk     = 18 <= hour <= 21
    is_overcast = cloud_pct >= 70
    in_season   = 5 <= month <= 11

    if not in_season:
        return {"active": False, "strength": "none", "reason": "off-season"}

    if is_dawn and is_overcast:
        return {
            "active": True, "strength": "strong",
            "reason": "Dawn + overcast — prime shallow window",
            "target_depth_modifier": -6,
        }
    elif is_dawn:
        return {
            "active": True, "strength": "moderate",
            "reason": "Dawn feeding window — work shallow first",
            "target_depth_modifier": -4,
        }
    elif is_overcast:
        return {
            "active": True, "strength": "moderate",
            "reason": "Overcast sky — shallow bite extended past dawn",
            "target_depth_modifier": -3,
        }
    elif is_dusk:
        return {
            "active": True, "strength": "moderate",
            "reason": "Dusk feeding window — fish move shallow",
            "target_depth_modifier": -3,
        }
    else:
        return {
            "active": False, "strength": "none",
            "reason": "Clear sky mid-day — fish deeper structure",
            "target_depth_modifier": 0,
        }
