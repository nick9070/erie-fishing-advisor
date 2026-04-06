"""
Solunar calculations for fish feeding activity.
Based on John Alden Knight's solunar theory:
  - Major periods: moon overhead / underfoot (~2hrs each)
  - Minor periods: moonrise / moonset (~1hr each)
No external API needed — pure math using ephem.
"""

import datetime
import math
try:
    import ephem
    EPHEM_AVAILABLE = True
except ImportError:
    EPHEM_AVAILABLE = False


def get_solunar_score(lat: float, lon: float, dt: datetime.datetime) -> dict:
    """
    Returns a solunar score (0-100) and period info for a given location/time.
    """
    if not EPHEM_AVAILABLE:
        return _fallback_score(dt)

    observer = ephem.Observer()
    observer.lat = str(lat)
    observer.lon = str(lon)
    observer.date = dt.strftime('%Y/%m/%d %H:%M:%S')
    observer.pressure = 0  # ignore atmospheric refraction for simplicity

    moon = ephem.Moon(observer)

    # Get moon transit (overhead) and anti-transit (underfoot) times
    try:
        transit = observer.next_transit(moon, start=observer.date)
        antitransit = observer.next_antitransit(moon, start=observer.date)
        moonrise = observer.next_rising(moon, start=observer.date)
        moonset = observer.next_setting(moon, start=observer.date)
    except Exception:
        return _fallback_score(dt)

    # Convert ephem dates to Python datetimes
    def ephem_to_dt(ed):
        return ephem.Date(ed).datetime()

    transit_dt = ephem_to_dt(transit)
    antitransit_dt = ephem_to_dt(antitransit)
    moonrise_dt = ephem_to_dt(moonrise)
    moonset_dt = ephem_to_dt(moonset)

    # Score based on how close current time is to a major/minor period
    now = dt.replace(tzinfo=None)

    def minutes_away(target_dt):
        diff = abs((target_dt - now).total_seconds() / 60)
        # Handle wrap-around (if next occurrence is > 12hrs away, check previous)
        if diff > 720:
            diff = 1440 - diff
        return diff

    major_windows = [transit_dt, antitransit_dt]
    minor_windows = [moonrise_dt, moonset_dt]

    major_mins = min(minutes_away(t) for t in major_windows)
    minor_mins = min(minutes_away(t) for t in minor_windows)

    # Major period: peak within 60 min window, minor within 30 min
    major_score = max(0, 100 - (major_mins / 60) * 100) if major_mins <= 60 else 0
    minor_score = max(0, 60 - (minor_mins / 30) * 60) if minor_mins <= 30 else 0

    score = max(major_score, minor_score)

    # Moon phase bonus — new/full moon = more active fish
    moon_phase = moon.phase  # 0-100, 100=full
    phase_bonus = 0
    if moon_phase >= 95 or moon_phase <= 5:
        phase_bonus = 15  # full or new moon
    elif moon_phase >= 45 and moon_phase <= 55:
        phase_bonus = 5   # quarter moon

    score = min(100, score + phase_bonus)

    # Determine active period label
    active_period = "inactive"
    if major_mins <= 60:
        active_period = f"MAJOR (moon {'overhead' if minutes_away(transit_dt) < minutes_away(antitransit_dt) else 'underfoot'})"
    elif minor_mins <= 30:
        active_period = f"minor (moon{'rise' if minutes_away(moonrise_dt) < minutes_away(moonset_dt) else 'set'})"

    return {
        "score": round(score),
        "active_period": active_period,
        "moon_phase_pct": round(moon_phase),
        "next_major_in_min": round(major_mins),
        "next_minor_in_min": round(minor_mins),
    }


def _fallback_score(dt: datetime.datetime) -> dict:
    """Simple time-of-day fallback if ephem is not installed."""
    hour = dt.hour
    # Bass are generally more active dawn/dusk
    if 5 <= hour <= 8 or 17 <= hour <= 20:
        score = 65
        period = "dawn/dusk feeding window"
    elif 9 <= hour <= 11:
        score = 45
        period = "mid-morning"
    else:
        score = 25
        period = "inactive period"
    return {
        "score": score,
        "active_period": period,
        "moon_phase_pct": None,
        "next_major_in_min": None,
        "next_minor_in_min": None,
        "note": "Install ephem for accurate solunar data: pip install ephem"
    }
