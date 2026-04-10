"""
Core scoring engine — combines all factors into a per-spot score (0-100).

Weights (must sum to 1.0):
  water_temp      0.27  — most critical biological driver (Brownscombe 2024: peak 17-24°C)
  pressure        0.20  — barometric pressure + rate of change (Manns obs. data; Lang 2023)
  wind            0.13  — speed + direction vs spot (>2x catch rate at 10-20 mph)
  solunar         0.06  — lunar feeding periods (Stuart 2023: tables don't predict CPUE)
  monthly_qual    0.18  — spot-specific monthly quality (research-backed, May-Nov focused)
  time_of_day     0.08  — dawn/dusk bonus (Suski & Ridgway 2009: fish <2m at dawn)
  cloud_cover     0.05  — overcast extends shallow bite window
  habitat_quality 0.03  — rocky/gravel structure quality, goby habitat suitability (0-100)

Post-score modifiers (applied after weighted sum, clamped 0-100):
  post_front:      -15 to -5   — cold front suppression (Lang 2023; Brandt 1987)
  spawn_penalty:   -15 to -5   — spawn/fry-guard phase suppression (Brownscombe 2024)
  goby_bonus:      -5 to +12   — round goby seasonal forage availability
  catch_bonus:     ±20         — personal catch history at this spot this month
  odnr_modifier:   ±10         — lake-wide ODNR seasonal activity modifier

Weight changes vs. prior version:
  solunar    0.12 → 0.06  (peer-reviewed: not a reliable predictor)
  water_temp 0.24 → 0.27  (strongest biological signal)
  pressure   0.17 → 0.20  (rate-of-change now tracked; higher confidence signal)
"""

import json
import datetime
from pathlib import Path

from engine.weather import score_pressure, score_wind, score_cloud_cover, get_shallow_bite_status, score_wind_persistence
from engine.water_temp import score_water_temp, get_season
from engine.solunar import get_solunar_score
from engine.spawn import get_spawn_phase
from engine.thermocline import get_surface_current

try:
    from engine.temp_history import get_temp_trend
    TEMP_HISTORY_AVAILABLE = True
except Exception:
    TEMP_HISTORY_AVAILABLE = False

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
    "water_temp":      0.27,   # up from 0.24 — strongest biological signal
    "pressure":        0.20,   # up from 0.17 — rate-of-change now tracked properly
    "wind":            0.13,
    "solunar":         0.06,   # down from 0.12 — Stuart (2023): tables don't predict CPUE
    "monthly_qual":    0.18,
    "time_of_day":     0.08,
    "cloud_cover":     0.05,
    "habitat_quality": 0.03,   # replaces GBIF density — actual structure quality per spot
}


def score_goby_forage(spot: dict, water_temp_f: float | None, month: int) -> int:
    """
    Score based on round goby forage availability for this spot and season.

    Research (Steinhart et al. 2004; Brownscombe 2024):
    - Since goby colonisation, 73% of eastern basin smallmouth diets are gobies
    - Gobies concentrate in nearshore rocky/cobble habitat <15m from May–Oct
    - October: begin moving offshore >20m; largely unavailable to nearshore bass by Nov
    - Winter: >30m depth — bass must seek them at depth (changes optimal spot selection)

    Spots with primary_forage == 'round_goby' get seasonal modifiers.
    Crayfish-primary spots are unaffected (crayfish available year-round in rocky habitat).
    """
    if spot.get("primary_forage") != "round_goby":
        return 0

    temp = water_temp_f or 0

    # Gobies offshore/unavailable in winter and early spring
    if month <= 4 or month >= 11:
        return -5   # bass must follow gobies deep — nearshore spots less productive

    # Early May: gobies moving inshore but not concentrated yet
    if month == 5 and temp < 55:
        return 2

    # Peak goby availability: late May through September, shallow rocky habitat
    if (month == 5 and temp >= 55) or (6 <= month <= 9):
        return 12   # gobies abundant and accessible — rocky spots highly productive

    # October: gobies beginning offshore migration; still some available nearshore
    if month == 10 and temp >= 50:
        return 5
    if month == 10:
        return -3   # gobies mostly gone shallow

    return 0


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
                                  spot.get("best_wind_dirs", []),
                                  spot.get("wind_fetch", "medium"))
    solunar_data     = get_solunar_score(spot["coords"]["lat"], spot["coords"]["lon"], now)
    solunar_score    = solunar_data["score"]
    monthly_score    = spot.get("monthly_quality", {}).get(str(month), 50)
    time_score       = _score_time_of_day(hour)
    cloud_score      = score_cloud_cover(cloud_pct)
    habitat_score    = spot.get("habitat_quality", 50)

    breakdown = {
        "water_temp":      water_temp_score,
        "pressure":        pressure_score,
        "wind":            wind_score,
        "solunar":         solunar_score,
        "monthly_qual":    monthly_score,
        "time_of_day":     time_score,
        "cloud_cover":     cloud_score,
        "habitat_quality": habitat_score,
    }

    total = sum(breakdown[k] * WEIGHTS[k] for k in WEIGHTS)

    # --- Post-score modifiers ---

    # Post-front suppression (Lang 2023; Brandt 1987)
    pressure_trend = conditions.get("pressure_trend", "stable")
    front_penalty = {
        "rising_fast": -15,
        "rising":       -5,
    }.get(pressure_trend, 0)

    # Spawn phase suppression (Brownscombe 2024; Wiegmann & Wiegmann 2005)
    # Males on nests / guarding fry are not actively feeding.
    # Post-spawn females need recovery time before resuming normal activity.
    water_temp_f  = conditions.get("water_temp_f")
    spawn_data    = get_spawn_phase(water_temp_f, month)
    spawn_penalty = spawn_data["score_penalty"]

    # Round goby forage availability — seasonal nearshore/offshore migration
    goby_bonus = score_goby_forage(spot, water_temp_f, month)

    catch_bonus = 0
    if CATCH_LOG_AVAILABLE:
        catch_bonus = get_catch_bonus(spot["id"], month)

    odnr_modifier = 0
    odnr = _get_odnr()
    if odnr:
        raw = odnr.get("lake_wide_monthly_modifier", {}).get(str(month), 0)
        odnr_modifier = round(raw * 0.4)

    # Temperature trend (multi-day warming/cooling)
    temp_trend = get_temp_trend() if TEMP_HISTORY_AVAILABLE else {"modifier": 0, "label": "unknown", "delta_7day_f": None}
    temp_trend_modifier = temp_trend["modifier"]

    # Wind persistence (24h of consistent favorable wind = forage stacked on structure)
    wind_history = conditions.get("wind_history", [])
    wind_persist = score_wind_persistence(wind_history, spot.get("best_wind_dirs", []))
    wind_persist_bonus = wind_persist["bonus"]

    # LEOFS surface current (per-spot, using nearest station from cached LEOFS data)
    current = get_surface_current(spot["coords"]["lat"], spot["coords"]["lon"])
    current_bonus = current["bonus"]
    # River/fetch-sensitive spots get amplified current bonus
    if spot.get("wind_fetch") == "river":
        current_bonus = min(12, round(current_bonus * 1.5))

    total = max(0, min(100, round(
        total + front_penalty + spawn_penalty + goby_bonus + catch_bonus
        + odnr_modifier + temp_trend_modifier + wind_persist_bonus + current_bonus
    )))

    # --- Shallow bite window ---
    shallow_bite = get_shallow_bite_status(cloud_pct, hour, month)

    # Thermocline depth and water clarity (passed through from api.py)
    thermocline_ft  = conditions.get("thermocline_depth_ft")
    clarity_offset  = conditions.get("clarity_depth_offset_ft", 0) or 0
    recommended_depth = _get_depth_info(spot, season, shallow_bite, thermocline_ft, clarity_offset)

    # Techniques from ODNR data
    techniques = odnr.get("presentation_by_season", {}).get(season, []) if odnr else []

    return {
        "spot_id":      spot["id"],
        "spot_name":    spot["name"],
        "score":        total,
        "rating":       _rating_label(total),
        "breakdown":    breakdown,
        "bonuses": {
            "catch_log":        catch_bonus,
            "odnr_seasonal":    odnr_modifier,
            "front_penalty":    front_penalty,
            "spawn_penalty":    spawn_penalty,
            "goby_bonus":       goby_bonus,
            "temp_trend":       temp_trend_modifier,
            "wind_persistence": wind_persist_bonus,
            "current":          current_bonus,
        },
        "spawn":        spawn_data,
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


def _get_depth_info(spot: dict, season: str, shallow_bite: dict,
                    thermocline_ft: float | None = None,
                    clarity_offset: int = 0) -> dict:
    """
    Return recommended fishing depth, adjusted for shallow bite window and thermocline.

    Priority:
      1. Shallow bite window (dawn/dusk/overcast) → always use shallow structure first
      2. Thermocline present (summer) → target just above the thermocline
      3. Standard seasonal depth from spot data
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

    # Priority 1: shallow bite window
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

    # Priority 2: thermocline adjustment (summer only)
    # Bass suspend just above the thermocline or on structure rising into that band.
    # Brownscombe (2024): eastern basin fish use metalimnion to avoid warm surface water.
    if (
        thermocline_ft is not None
        and season in ("summer", "post_spawn")
        and max(standard_depth) > thermocline_ft - 4
    ):
        # Target the 8-ft band just above the thermocline
        thermo_target = [
            round(max(8, thermocline_ft - 9)),
            round(thermocline_ft - 2),
        ]
        return {
            "target_depth_ft":  thermo_target,
            "also_check_ft":    standard_depth,
            "mode":             "thermocline",
            "thermocline_ft":   thermocline_ft,
            "season":           season,
        }

    # Apply water clarity offset in standard (non-shallow-bite, non-thermocline) mode.
    # Clear water → fish go deeper midday; turbid water → fish stay shallower.
    if clarity_offset != 0:
        adj = [round(d + clarity_offset) for d in standard_depth]
        adj = [max(4, d) for d in adj]   # floor at 4ft
        return {
            "target_depth_ft": adj,
            "mode":            "clarity_adjusted",
            "clarity_offset":  clarity_offset,
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
