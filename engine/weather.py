"""
Weather data via OpenWeatherMap API.
Free tier: https://openweathermap.org/api
Provides: temp, pressure + trend, wind speed/dir, cloud cover, conditions.
"""

import os
import requests
from datetime import datetime


OWM_BASE = "https://api.openweathermap.org/data/2.5"


def get_weather(lat: float, lon: float, api_key: str) -> dict:
    """Fetch current weather conditions for a lat/lon."""
    url = f"{OWM_BASE}/weather"
    params = {
        "lat": lat,
        "lon": lon,
        "appid": api_key,
        "units": "imperial",  # °F, mph
    }
    resp = requests.get(url, params=params, timeout=10)
    resp.raise_for_status()
    data = resp.json()

    wind_deg = data.get("wind", {}).get("deg", 0)
    return {
        "temp_f": data["main"]["temp"],
        "feels_like_f": data["main"]["feels_like"],
        "pressure_hpa": data["main"]["pressure"],
        "humidity_pct": data["main"]["humidity"],
        "wind_speed_mph": data.get("wind", {}).get("speed", 0),
        "wind_gust_mph": data.get("wind", {}).get("gust", 0),
        "wind_dir_deg": wind_deg,
        "wind_dir_label": _deg_to_compass(wind_deg),
        "cloud_cover_pct": data.get("clouds", {}).get("all", 0),
        "conditions": data["weather"][0]["description"],
        "visibility_miles": data.get("visibility", 10000) / 1609.34,
    }


def get_pressure_trend(lat: float, lon: float, api_key: str) -> str:
    """
    Fetch 5-day/3-hour forecast and compare pressure now vs 3 hrs ago.
    Returns: 'rising', 'falling', or 'stable'
    """
    url = f"{OWM_BASE}/forecast"
    params = {
        "lat": lat,
        "lon": lon,
        "appid": api_key,
        "units": "imperial",
        "cnt": 4,  # just need a few data points
    }
    resp = requests.get(url, params=params, timeout=10)
    resp.raise_for_status()
    items = resp.json()["list"]

    if len(items) < 2:
        return "stable"

    p_now = items[0]["main"]["pressure"]
    p_prev = items[1]["main"]["pressure"]  # 3 hours earlier
    diff = p_now - p_prev

    if diff > 1.5:
        return "rising"
    elif diff < -1.5:
        return "falling"
    return "stable"


def _deg_to_compass(deg: float) -> str:
    dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
            "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    idx = round(deg / 22.5) % 16
    return dirs[idx]


def score_pressure(pressure_hpa: float, trend: str) -> int:
    """
    Score barometric pressure for bass fishing.
    Bass are most active on stable-to-rising pressure (1010-1030 hPa range).
    """
    # Base score from absolute pressure
    if 1013 <= pressure_hpa <= 1025:
        base = 70
    elif 1008 <= pressure_hpa < 1013:
        base = 50
    elif pressure_hpa > 1025:
        base = 60
    else:
        base = 30  # low pressure = inactive fish

    # Trend adjustment
    trend_bonus = {"rising": 25, "stable": 10, "falling": -20}
    score = base + trend_bonus.get(trend, 0)
    return max(0, min(100, score))


def score_cloud_cover(cloud_pct: float) -> int:
    """
    Score cloud cover for bass fishing.

    Overcast is generally better — fish feel less exposed and feed more
    aggressively, including in shallow water throughout the day.
    Clear sunny skies push fish deep and tighten bite windows to dawn/dusk.
    """
    if cloud_pct >= 75:
        return 88   # overcast — fish shallower all day, active feed
    elif cloud_pct >= 50:
        return 72   # partly cloudy — good conditions
    elif cloud_pct >= 25:
        return 55   # mostly clear — standard conditions
    else:
        return 35   # bluebird — fish go deep, tight bite windows


def get_shallow_bite_status(cloud_pct: float, hour: int, month: int) -> dict:
    """
    Determine whether the shallow bite window is currently active.

    The shallow bite fires when:
      - Early morning (5-9am) — fish push shallow to feed regardless of sky
      - Overcast (70%+ cloud) — low light all day pulls fish up
      - Both — best possible shallow conditions

    Most relevant May-November (prime season).
    """
    is_dawn = 5 <= hour <= 9
    is_dusk = 18 <= hour <= 21
    is_overcast = cloud_pct >= 70
    is_partly_cloudy = 40 <= cloud_pct < 70
    in_season = 5 <= month <= 11

    if not in_season:
        return {"active": False, "strength": "none", "reason": "off-season"}

    if is_dawn and is_overcast:
        return {
            "active": True,
            "strength": "strong",
            "reason": "Dawn + overcast — prime shallow window",
            "target_depth_modifier": -6,   # fish shallower than typical
        }
    elif is_dawn:
        return {
            "active": True,
            "strength": "moderate",
            "reason": "Dawn feeding window — work shallow first",
            "target_depth_modifier": -4,
        }
    elif is_overcast:
        return {
            "active": True,
            "strength": "moderate",
            "reason": "Overcast sky — shallow bite extended past dawn",
            "target_depth_modifier": -3,
        }
    elif is_dusk:
        return {
            "active": True,
            "strength": "moderate",
            "reason": "Dusk feeding window — fish move shallow",
            "target_depth_modifier": -3,
        }
    elif is_partly_cloudy and (is_dawn or is_dusk):
        return {
            "active": True,
            "strength": "light",
            "reason": "Partly cloudy during feeding window",
            "target_depth_modifier": -2,
        }
    else:
        return {
            "active": False,
            "strength": "none",
            "reason": "Clear sky mid-day — fish deeper structure",
            "target_depth_modifier": 0,
        }


def score_wind(speed_mph: float, wind_dir: str, spot_best_winds: list) -> int:
    """
    Light-to-moderate wind onto structure is ideal.
    Strong wind or wind off structure = worse.
    """
    # Speed score
    if 5 <= speed_mph <= 15:
        speed_score = 90
    elif speed_mph < 5:
        speed_score = 60  # calm can still be good, just different
    elif 15 < speed_mph <= 20:
        speed_score = 50
    elif 20 < speed_mph <= 25:
        speed_score = 25
    else:
        speed_score = 5  # too rough to fish comfortably

    # Direction score — does wind match this spot's preferred directions?
    dir_score = 80 if wind_dir in spot_best_winds else 40

    return round((speed_score * 0.6) + (dir_score * 0.4))
