"""
Core scoring engine — combines all factors into a per-spot score (0-100).

Weights (must sum to 1.0):
  water_temp    0.24  — most critical biological driver
  pressure      0.17  — barometric pressure + trend
  wind          0.13  — speed + direction vs spot
  solunar       0.12  — moon-based feeding periods
  monthly_qual  0.18  — spot-specific monthly quality (research-backed, May-Nov focused)
  time_of_day   0.08  — dawn/dusk bonus
  cloud_cover   0.05  — overcast extends shallow bite, sunny pushes fish deep
  gbif_density  0.03  — historical occurrence signal

Post-score bonuses (applied after weighted sum, clamped 0-100):
  catch_bonus:     ±20  — your personal catch history at this spot this month
  odnr_modifier:   ±10  — lake-wide ODNR seasonal activity modifier
"""

import json
import datetime
from pathlib import Path

from engine.weather import score_pressure, score_wind, score_cloud_cover, get_shallow_bite_status
from engine.water_temp import score_water_temp, get_season
from engine.solunar import get_solunar_score

try:
    from engine.gbif import get_nearby_gbif_density
    GBIF_AVAILABLE = True
except Exception:
    GBIF_AVAILABLE = False

try:
    from engine.catch_log import get_catch_bonus, init_db
    init_db()
    CATCH_LOG_AVAILABLE = True
except Exception:
    CATCH_LOG_AVAILABLE = False

_ODNR_PATH = Path(__file__).parent.parent / "data" / "odnr_seasonal.json"
_odnr_data = None


def _get_odnr() -> dict:
    global _odnr_data
    if _odnr_data is None and _ODNR_PATH.exists():
        with open(_ODNR_PATH) as f:
            _odnr_data = json.load(f)
    return _odnr_data or {}


WEIGHTS = {
    "water_temp":   0.24,
    "pressure":     0.17,
    "wind":         0.13,
    "solunar":      0.12,
    "monthly_qual": 0.18,
    "time_of_day":  0.08,
    "cloud_cover":  0.05,
    "gbif_density": 0.03,
}


def score_spot(spot: dict, conditions: dict, now: datetime.datetime) -> dict:
    season = get_season(now.month)
    month  = now.month
    hour   = now.hour

    cloud_pct = conditions.get("cloud_cover_pct", 50)

    # --- Factor scores ---
    water_temp_score = score_water_temp(conditions.get("water_temp_f"), season)
    pressure_score   = score_pressure(conditions.get("pressure_hpa", 1013),
                                      conditions.get("pressure_trend", "stable"))
    wind_score       = score_wind(conditions.get("wind_speed_mph", 10),
                                  conditions.get("wind_dir_label", "W"),
                                  spot.get("best_wind_dirs", []))
    solunar_data     = get_solunar_score(spot["coords"]["lat"], spot["coords"]["lon"], now)
    solunar_score    = solunar_data["score"]
    monthly_score    = spot.get("monthly_quality", {}).get(str(month), 50)
    time_score       = _score_time_of_day(hour)
    cloud_score      = score_cloud_cover(cloud_pct)

    if GBIF_AVAILABLE:
        density    = get_nearby_gbif_density(spot["coords"]["lat"], spot["coords"]["lon"], month)
        gbif_score = min(100, 40 + density * 5)
    else:
        gbif_score = 50

    breakdown = {
        "water_temp":   water_temp_score,
        "pressure":     pressure_score,
        "wind":         wind_score,
        "solunar":      solunar_score,
        "monthly_qual": monthly_score,
        "time_of_day":  time_score,
        "cloud_cover":  cloud_score,
        "gbif_density": gbif_score,
    }

    total = sum(breakdown[k] * WEIGHTS[k] for k in WEIGHTS)

    # --- Post-score bonuses ---
    catch_bonus = 0
    if CATCH_LOG_AVAILABLE:
        catch_bonus = get_catch_bonus(spot["id"], month)

    odnr_modifier = 0
    odnr = _get_odnr()
    if odnr:
        raw = odnr.get("lake_wide_monthly_modifier", {}).get(str(month), 0)
        odnr_modifier = round(raw * 0.4)

    total = max(0, min(100, round(total + catch_bonus + odnr_modifier)))

    # --- Shallow bite window ---
    shallow_bite = get_shallow_bite_status(cloud_pct, hour, month)
    recommended_depth = _get_depth_info(spot, season, shallow_bite)

    # Techniques from ODNR data
    techniques = odnr.get("presentation_by_season", {}).get(season, []) if odnr else []

    return {
        "spot_id":      spot["id"],
        "spot_name":    spot["name"],
        "score":        total,
        "rating":       _rating_label(total),
        "breakdown":    breakdown,
        "bonuses":      {"catch_log": catch_bonus, "odnr_seasonal": odnr_modifier},
        "season":       season,
        "month":        month,
        "solunar":      solunar_data,
        "shallow_bite": shallow_bite,
        "depth_info":   recommended_depth,
        "coords":       spot["coords"],
        "techniques":   techniques[:3],
        "forage":       spot.get("primary_forage", ""),
        "notes":        spot.get("notes", ""),
    }


def rank_spots(spots: list, conditions: dict, now: datetime.datetime) -> list:
    scored = [score_spot(s, conditions, now) for s in spots]
    return sorted(scored, key=lambda x: x["score"], reverse=True)


def _get_depth_info(spot: dict, season: str, shallow_bite: dict) -> dict:
    """
    Return the recommended fishing depth range, adjusted for shallow bite window.
    If shallow bite is active and the spot has a shallow_summer_depth_ft, use that.
    """
    season_depth_key = {
        "pre_spawn":  "spawn_depth_ft",
        "spawn":      "spawn_depth_ft",
        "post_spawn": "summer_depth_ft",
        "summer":     "summer_depth_ft",
        "fall":       "fall_depth_ft",
        "winter":     "fall_depth_ft",
    }
    standard_key   = season_depth_key.get(season, "summer_depth_ft")
    standard_depth = spot.get(standard_key, spot.get("depth_range", [10, 25]))
    shallow_depth  = spot.get("shallow_summer_depth_ft")

    # Use shallow range if bite is active, spot has shallow structure, and it's prime season
    use_shallow = (
        shallow_bite.get("active")
        and shallow_depth is not None
        and season in ("post_spawn", "summer", "fall", "spawn", "pre_spawn")
    )

    if use_shallow:
        return {
            "target_depth_ft": shallow_depth,
            "also_check_ft":   standard_depth,
            "mode":            "shallow_bite",
            "season":          season,
        }

    return {
        "target_depth_ft": standard_depth,
        "mode":            "standard",
        "season":          season,
    }


def _score_time_of_day(hour: int) -> int:
    if 5 <= hour <= 8:
        return 95   # prime dawn window
    elif 17 <= hour <= 20:
        return 88   # dusk
    elif 9 <= hour <= 11:
        return 65   # post-dawn, still decent
    elif 21 <= hour <= 23 or 0 <= hour <= 4:
        return 48   # night — summer can be ok
    else:
        return 38   # midday — fish go deep


def _rating_label(score: float) -> str:
    if score >= 80:   return "EXCELLENT"
    elif score >= 65: return "GOOD"
    elif score >= 50: return "FAIR"
    elif score >= 35: return "POOR"
    return "VERY POOR"
