#!/usr/bin/env python3
"""
FastAPI backend for Erie Smallmouth Fishing Advisor.

Data sources (all free, no OWM key required):
  - NOAA NDBC buoys   — pressure, wind, water/air temp (actual on-lake measurements)
  - Open-Meteo        — cloud cover, sky conditions (ECMWF model, no key)
  - Pressure history  — in-memory rolling 4-hour log for rate-of-change calculation

Run with: uvicorn api:app --reload --port 8000
"""

import json
import os
import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from engine.weather import get_open_meteo, get_open_meteo_hourly, score_pressure
from engine.water_temp import get_buoy_conditions, get_season
from engine.scoring import rank_spots
from engine.catch_log import init_db, log_catch, get_catches, get_spot_stats

init_db()

app = FastAPI(title="Erie Fishing Advisor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Cache ────────────────────────────────────────────────────────────────────

_cache: dict = {}
CACHE_TTL_SECONDS = 600

_forecast_cache: dict = {}
FORECAST_CACHE_TTL = 1800   # 30 minutes

# Eastern basin center — Long Point / Fort Erie corridor
LAKE_CENTER_LAT = 42.75
LAKE_CENTER_LON = -79.80

# ── Pressure history (in-memory rolling log) ─────────────────────────────────
# Stores actual buoy readings to compute rate-of-change over the last 3 hours.
# Resets on server restart — trend defaults to "stable" until history builds up
# (takes ~30 min of 10-min cache refreshes to get a meaningful window).

_pressure_history: list = []   # [{"time": datetime, "pressure_hpa": float}, ...]


def _compute_pressure_trend(current_hpa: float) -> tuple[float, str]:
    """
    Record a pressure reading and compute the rate of change vs ~3 hours ago.
    Returns (rate_mb_per_hr, trend_label).

    Thresholds (mb/hr):
      > +2.0 → rising_fast   (post-front suppression)
      +0.5 to +2.0 → rising
      ±0.5 → stable
      -0.5 to -2.0 → falling
      < -2.0 → falling_fast  (front imminent)
    """
    global _pressure_history
    now = datetime.datetime.now()

    _pressure_history.append({"time": now, "pressure_hpa": current_hpa})

    # Prune readings older than 4 hours
    cutoff = now - datetime.timedelta(hours=4)
    _pressure_history = [r for r in _pressure_history if r["time"] > cutoff]

    # Need at least 2 readings to compute a trend
    if len(_pressure_history) < 2:
        return 0.0, "stable"

    # Find the reading closest to 3 hours ago (within a 30-min window)
    target   = now - datetime.timedelta(hours=3)
    window   = datetime.timedelta(minutes=30)
    old_candidates = [r for r in _pressure_history if r["time"] <= target + window]

    if old_candidates:
        ref = min(old_candidates, key=lambda r: abs((r["time"] - target).total_seconds()))
    else:
        # Not enough history yet — use oldest available reading
        ref = _pressure_history[0]

    elapsed_hrs = max((now - ref["time"]).total_seconds() / 3600, 0.1)
    rate        = (current_hpa - ref["pressure_hpa"]) / elapsed_hrs

    if rate > 2.0:
        label = "rising_fast"
    elif rate > 0.5:
        label = "rising"
    elif rate < -2.0:
        label = "falling_fast"
    elif rate < -0.5:
        label = "falling"
    else:
        label = "stable"

    return round(rate, 2), label


def _deg_to_compass(deg: float) -> str:
    dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE",
            "S","SSW","SW","WSW","W","WNW","NW","NNW"]
    return dirs[round(deg / 22.5) % 16]


# ── Conditions fetch ──────────────────────────────────────────────────────────

def _fetch_conditions() -> dict:
    """
    Merge NDBC buoy data (pressure, wind, water/air temp) with
    Open-Meteo sky data (cloud cover, conditions description).

    Buoy data is prioritised for pressure and wind — it's actual
    measured on-lake data rather than interpolated model output.
    Open-Meteo values are used as fallback if the buoy is offline.
    """
    global _cache
    now = datetime.datetime.now()
    if _cache.get("expires") and now < _cache["expires"]:
        return _cache["data"]

    buoy = get_buoy_conditions(LAKE_CENTER_LAT, LAKE_CENTER_LON)
    sky  = get_open_meteo(LAKE_CENTER_LAT, LAKE_CENTER_LON)

    # Pressure: use buoy reading, fall back to Open-Meteo model
    pressure_hpa = buoy.get("pressure_hpa") or sky.get("pressure_hpa")
    pressure_rate, pressure_trend = _compute_pressure_trend(pressure_hpa) \
        if pressure_hpa else (0.0, "stable")

    # Wind: buoy (on-lake) > Open-Meteo model
    wind_speed = buoy.get("wind_speed_mph") or sky.get("wind_speed_mph")
    wind_gust  = buoy.get("wind_gust_mph")  or sky.get("wind_gust_mph")
    wind_deg   = buoy.get("wind_dir_deg")   or sky.get("wind_dir_deg")
    wind_label = buoy.get("wind_dir_label") or (
        _deg_to_compass(wind_deg) if wind_deg is not None else "N"
    )

    # Air temp: buoy > Open-Meteo
    air_temp_f = buoy.get("air_temp_f") or sky.get("temp_f")

    data = {
        # Water (buoy only)
        "water_temp_f":       buoy.get("water_temp_f"),
        "water_temp_c":       buoy.get("water_temp_c"),
        "buoy_id":            buoy.get("buoy_id"),
        "buoy_name":          buoy.get("buoy_name"),
        # Pressure
        "pressure_hpa":       pressure_hpa,
        "pressure_trend":     pressure_trend,
        "pressure_rate_mb_hr": pressure_rate,
        # Wind
        "wind_speed_mph":     wind_speed,
        "wind_gust_mph":      wind_gust,
        "wind_dir_deg":       wind_deg,
        "wind_dir_label":     wind_label,
        # Sky (Open-Meteo)
        "temp_f":             air_temp_f,
        "cloud_cover_pct":    sky.get("cloud_cover_pct", 0),
        "conditions":         sky.get("conditions", "unknown"),
        "precipitation":      sky.get("precipitation", 0),
    }

    _cache = {
        "data":    data,
        "expires": now + datetime.timedelta(seconds=CACHE_TTL_SECONDS),
    }
    return data


def _load_spots() -> list:
    spots_path = Path(__file__).parent / "data" / "spots.json"
    with open(spots_path) as f:
        return json.load(f)


def _load_odnr() -> dict:
    path = Path(__file__).parent / "data" / "odnr_seasonal.json"
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return {}


# ── API endpoints ─────────────────────────────────────────────────────────────

@app.get("/api/conditions")
def get_conditions():
    conditions = _fetch_conditions()
    now = datetime.datetime.now()
    return {
        "timestamp": now.isoformat(),
        "season":    get_season(now.month),
        **conditions,
    }


@app.get("/api/spots")
def get_spots():
    spots      = _load_spots()
    conditions = _fetch_conditions()
    now        = datetime.datetime.now()
    ranked     = rank_spots(spots, conditions, now)
    odnr       = _load_odnr()
    return {
        "timestamp":          now.isoformat(),
        "season":             get_season(now.month),
        "population_outlook": odnr.get("population_outlook_2025"),
        "conditions_summary": {
            "water_temp_f":         conditions.get("water_temp_f"),
            "pressure_hpa":         conditions.get("pressure_hpa"),
            "pressure_trend":       conditions.get("pressure_trend"),
            "pressure_rate_mb_hr":  conditions.get("pressure_rate_mb_hr"),
            "wind_speed_mph":       conditions.get("wind_speed_mph"),
            "wind_gust_mph":        conditions.get("wind_gust_mph"),
            "wind_dir_label":       conditions.get("wind_dir_label"),
            "conditions":           conditions.get("conditions"),
            "temp_f":               conditions.get("temp_f"),
            "cloud_cover_pct":      conditions.get("cloud_cover_pct"),
            "buoy_id":              conditions.get("buoy_id"),
            "buoy_name":            conditions.get("buoy_name"),
        },
        "spots": ranked,
    }


# ── Catch Log ─────────────────────────────────────────────────────────────────

class CatchEntry(BaseModel):
    spot_id:         str
    spot_name:       str
    fish_date:       str
    fish_time:       Optional[str]   = None
    fish_count:      int             = 1
    avg_length_in:   Optional[float] = None
    avg_weight_lb:   Optional[float] = None
    best_length_in:  Optional[float] = None
    lure:            Optional[str]   = None
    technique:       Optional[str]   = None
    depth_ft:        Optional[float] = None
    water_temp_f:    Optional[float] = None
    air_temp_f:      Optional[float] = None
    pressure_hpa:    Optional[float] = None
    pressure_trend:  Optional[str]   = None
    wind_speed_mph:  Optional[float] = None
    wind_dir:        Optional[str]   = None
    conditions:      Optional[str]   = None
    score_at_time:   Optional[int]   = None
    notes:           Optional[str]   = None


@app.post("/api/catches")
def create_catch(entry: CatchEntry):
    """Log a catch. Conditions auto-filled from live data if not provided."""
    data = entry.model_dump()
    if not entry.water_temp_f:
        try:
            cond = _fetch_conditions()
            data.setdefault("water_temp_f",   cond.get("water_temp_f"))
            data.setdefault("air_temp_f",     cond.get("temp_f"))
            data.setdefault("pressure_hpa",   cond.get("pressure_hpa"))
            data.setdefault("pressure_trend", cond.get("pressure_trend"))
            data.setdefault("wind_speed_mph", cond.get("wind_speed_mph"))
            data.setdefault("wind_dir",       cond.get("wind_dir_label"))
            data.setdefault("conditions",     cond.get("conditions"))
        except Exception:
            pass
    saved = log_catch(data)
    return {"success": True, "catch": saved}


@app.get("/api/catches")
def list_catches(spot_id: Optional[str] = None, limit: int = 100):
    return {"catches": get_catches(spot_id=spot_id, limit=limit)}


@app.get("/api/catches/stats/{spot_id}")
def spot_catch_stats(spot_id: str):
    return get_spot_stats(spot_id)


# ── AI Explain ────────────────────────────────────────────────────────────────

class ExplainRequest(BaseModel):
    spot_name:  str
    score:      int
    rating:     str
    season:     str
    breakdown:  dict
    solunar:    dict
    conditions: dict
    depth_info: Optional[dict] = None
    techniques: Optional[list] = None
    forage:     Optional[str]  = None


@app.post("/api/explain")
def explain_spot(req: ExplainRequest):
    """Use Claude to generate a natural-language fishing recommendation."""
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if not anthropic_key:
        return {"explanation": "Add ANTHROPIC_API_KEY to Render environment variables to enable AI explanations."}

    import anthropic
    client = anthropic.Anthropic(api_key=anthropic_key)

    bd         = req.breakdown
    sol        = req.solunar
    cond       = req.conditions
    depth      = req.depth_info or {}
    techniques = req.techniques or []
    forage     = req.forage or "round goby"

    rate = cond.get("pressure_rate_mb_hr", 0)
    rate_str = f"{rate:+.1f} mb/hr" if rate else ""

    prompt = f"""You are an expert Lake Erie smallmouth bass fishing guide specializing in the Ontario / Canadian side of the eastern basin.
Give a concise, practical fishing recommendation (4-5 sentences) for right now.

Spot: {req.spot_name}
Score: {req.score}/100 ({req.rating}) | Season: {req.season.replace('_', ' ')}
Target depth: {depth.get('target_depth_ft', 'unknown')} ft | Primary forage: {forage.replace('_', ' ')}
Techniques: {', '.join(techniques) if techniques else 'tube jig, drop-shot'}

Current conditions:
- Water: {cond.get('water_temp_f', '?')}°F | Air: {cond.get('temp_f', '?')}°F
- Pressure: {cond.get('pressure_hpa', '?')} hPa ({cond.get('pressure_trend', '?')} {rate_str})
- Wind: {cond.get('wind_speed_mph', '?')} mph {cond.get('wind_dir_label', '')}
- Sky: {cond.get('conditions', '?')} | Cloud: {cond.get('cloud_cover_pct', '?')}%

Factor scores: water_temp={bd.get('water_temp')} | pressure={bd.get('pressure')} | wind={bd.get('wind')} | solunar={bd.get('solunar')} ({sol.get('active_period','inactive')}) | monthly={bd.get('monthly_qual')}

Tell me: what are the fish doing right now at this spot, exactly where and how deep to target, and your top 1-2 lure/technique suggestions for these specific conditions. Eastern basin context: clear water, goby-heavy diet, fish run deeper than western basin. Be direct and specific."""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=350,
        messages=[{"role": "user", "content": prompt}]
    )
    return {"explanation": message.content[0].text}


@app.get("/api/forecast")
def get_forecast(date: str):
    """
    Return hourly scoring for all spots for a given date (up to 7 days ahead).
    Fetches Open-Meteo hourly forecast and runs the scoring engine for each hour.
    Results cached 30 minutes per date.
    """
    # Validate date
    try:
        req_date = datetime.date.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date — use YYYY-MM-DD")

    today      = datetime.date.today()
    days_ahead = (req_date - today).days
    if days_ahead < 0:
        raise HTTPException(status_code=400, detail="Cannot forecast past dates")
    if days_ahead > 6:
        raise HTTPException(status_code=400, detail="Forecast only available up to 7 days ahead")

    # Check cache
    now    = datetime.datetime.now()
    cached = _forecast_cache.get(date)
    if cached and now < cached["expires"]:
        return cached["data"]

    # Prune stale entries (dates more than 2 days old)
    cutoff = (today - datetime.timedelta(days=2)).isoformat()
    for k in list(_forecast_cache.keys()):
        if k < cutoff:
            del _forecast_cache[k]

    # Fetch data sources
    buoy         = get_buoy_conditions(LAKE_CENTER_LAT, LAKE_CENTER_LON)
    water_temp_f = buoy.get("water_temp_f")
    hourly_wx    = get_open_meteo_hourly(LAKE_CENTER_LAT, LAKE_CENTER_LON, date)
    spots        = _load_spots()

    hours_output = []
    for h_idx, hw in enumerate(hourly_wx):
        hour_dt = datetime.datetime(req_date.year, req_date.month, req_date.day, hour=h_idx)

        conditions = {
            "water_temp_f":    water_temp_f,
            "pressure_hpa":    hw["pressure_hpa"],
            "pressure_trend":  hw["pressure_trend"],
            "wind_speed_mph":  hw["wind_speed_mph"],
            "wind_dir_label":  hw["wind_dir_label"],
            "cloud_cover_pct": hw["cloud_cover_pct"],
            "conditions":      hw["conditions"],
            "temp_f":          hw["temp_f"],
        }

        ranked = rank_spots(spots, conditions, hour_dt)

        compact_spots = [
            {
                "rank":        i + 1,
                "spot_id":     s["spot_id"],
                "spot_name":   s["spot_name"],
                "score":       s["score"],
                "rating":      s["rating"],
                "breakdown":   s["breakdown"],
                "bonuses":     s["bonuses"],
                "depth_info":  s["depth_info"],
                "shallow_bite": s["shallow_bite"],
                "solunar":     s["solunar"],
                "techniques":  s["techniques"],
                "forage":      s["forage"],
                "notes":       s["notes"],
            }
            for i, s in enumerate(ranked)
        ]

        top = compact_spots[0] if compact_spots else {}
        hours_output.append({
            "hour":          h_idx,
            "top_score":     top.get("score", 0),
            "top_spot_name": top.get("spot_name", ""),
            "conditions": {
                "temp_f":              hw["temp_f"],
                "cloud_cover_pct":     hw["cloud_cover_pct"],
                "conditions":          hw["conditions"],
                "pressure_hpa":        hw["pressure_hpa"],
                "pressure_trend":      hw["pressure_trend"],
                "pressure_rate_mb_hr": hw["pressure_rate_mb_hr"],
                "wind_speed_mph":      hw["wind_speed_mph"],
                "wind_gust_mph":       hw["wind_gust_mph"],
                "wind_dir_label":      hw["wind_dir_label"],
                "precipitation":       hw["precipitation"],
            },
            "spots": compact_spots,
        })

    best = max(hours_output, key=lambda h: h["top_score"])

    result = {
        "date":           date,
        "fetched_at":     now.isoformat(),
        "water_temp_f":   water_temp_f,
        "buoy_name":      buoy.get("buoy_name"),
        "best_hour":      best["hour"],
        "best_score":     best["top_score"],
        "best_spot_name": best["top_spot_name"],
        "hours":          hours_output,
    }

    _forecast_cache[date] = {"data": result, "expires": now + datetime.timedelta(seconds=FORECAST_CACHE_TTL)}
    return result


@app.get("/api/health")
def health():
    return {"status": "ok", "time": datetime.datetime.now().isoformat()}
