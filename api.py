#!/usr/bin/env python3
"""
FastAPI backend for Erie Smallmouth Fishing Advisor.
Run with: uvicorn api:app --reload --port 8000
"""

import json
import os
import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from engine.weather import get_weather, get_pressure_trend
from engine.water_temp import get_water_temp, get_season
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

# Cache conditions for 10 minutes
_cache: dict = {}
CACHE_TTL_SECONDS = 600

# Eastern basin center — Long Point / Fort Erie corridor
LAKE_CENTER_LAT = 42.75
LAKE_CENTER_LON = -79.80


def _load_spots() -> list:
    spots_path = Path(__file__).parent / "data" / "spots.json"
    with open(spots_path) as f:
        return json.load(f)


def _get_api_key() -> str:
    key = os.environ.get("OPENWEATHER_API_KEY")
    if not key:
        raise HTTPException(
            status_code=500,
            detail="OPENWEATHER_API_KEY not configured on server"
        )
    return key


def _fetch_conditions(api_key: str) -> dict:
    global _cache
    now = datetime.datetime.now()
    if _cache.get("expires") and now < _cache["expires"]:
        return _cache["data"]

    weather = get_weather(LAKE_CENTER_LAT, LAKE_CENTER_LON, api_key)
    trend = get_pressure_trend(LAKE_CENTER_LAT, LAKE_CENTER_LON, api_key)
    water = get_water_temp(LAKE_CENTER_LAT, LAKE_CENTER_LON)

    data = {**weather, **water, "pressure_trend": trend}
    _cache = {
        "data": data,
        "expires": now + datetime.timedelta(seconds=CACHE_TTL_SECONDS),
    }
    return data


@app.get("/api/conditions")
def get_conditions():
    api_key = _get_api_key()
    conditions = _fetch_conditions(api_key)
    now = datetime.datetime.now()
    return {
        "timestamp": now.isoformat(),
        "season": get_season(now.month),
        **conditions,
    }


def _load_odnr() -> dict:
    path = Path(__file__).parent / "data" / "odnr_seasonal.json"
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return {}


@app.get("/api/spots")
def get_spots():
    api_key = _get_api_key()
    spots = _load_spots()
    conditions = _fetch_conditions(api_key)
    now = datetime.datetime.now()
    ranked = rank_spots(spots, conditions, now)
    odnr = _load_odnr()
    return {
        "timestamp": now.isoformat(),
        "season": get_season(now.month),
        "population_outlook": odnr.get("population_outlook_2025"),
        "conditions_summary": {
            "water_temp_f":    conditions.get("water_temp_f"),
            "pressure_hpa":    conditions.get("pressure_hpa"),
            "pressure_trend":  conditions.get("pressure_trend"),
            "wind_speed_mph":  conditions.get("wind_speed_mph"),
            "wind_dir_label":  conditions.get("wind_dir_label"),
            "conditions":      conditions.get("conditions"),
            "temp_f":          conditions.get("temp_f"),
            "cloud_cover_pct": conditions.get("cloud_cover_pct"),
        },
        "spots": ranked,
    }


# ── Catch Log Endpoints ──────────────────────────────────────────────────────

class CatchEntry(BaseModel):
    spot_id: str
    spot_name: str
    fish_date: str              # YYYY-MM-DD
    fish_time: Optional[str] = None   # HH:MM
    fish_count: int = 1
    avg_length_in: Optional[float] = None
    avg_weight_lb: Optional[float] = None
    best_length_in: Optional[float] = None
    lure: Optional[str] = None
    technique: Optional[str] = None
    depth_ft: Optional[float] = None
    # Conditions auto-filled from current if not provided
    water_temp_f: Optional[float] = None
    air_temp_f: Optional[float] = None
    pressure_hpa: Optional[float] = None
    pressure_trend: Optional[str] = None
    wind_speed_mph: Optional[float] = None
    wind_dir: Optional[str] = None
    conditions: Optional[str] = None
    score_at_time: Optional[int] = None
    notes: Optional[str] = None


@app.post("/api/catches")
def create_catch(entry: CatchEntry):
    """Log a catch. Conditions auto-filled from current weather if not provided."""
    data = entry.model_dump()

    # Auto-fill conditions from live data if not supplied
    api_key = os.environ.get("OPENWEATHER_API_KEY")
    if api_key and not entry.water_temp_f:
        try:
            cond = _fetch_conditions(api_key)
            data.setdefault("water_temp_f", cond.get("water_temp_f"))
            data.setdefault("air_temp_f", cond.get("temp_f"))
            data.setdefault("pressure_hpa", cond.get("pressure_hpa"))
            data.setdefault("pressure_trend", cond.get("pressure_trend"))
            data.setdefault("wind_speed_mph", cond.get("wind_speed_mph"))
            data.setdefault("wind_dir", cond.get("wind_dir_label"))
            data.setdefault("conditions", cond.get("conditions"))
        except Exception:
            pass

    saved = log_catch(data)
    return {"success": True, "catch": saved}


@app.get("/api/catches")
def list_catches(spot_id: Optional[str] = None, limit: int = 100):
    """List catch log entries, optionally filtered by spot."""
    return {"catches": get_catches(spot_id=spot_id, limit=limit)}


@app.get("/api/catches/stats/{spot_id}")
def spot_catch_stats(spot_id: str):
    """Aggregate catch stats for a spot."""
    return get_spot_stats(spot_id)


# ── AI Explain ───────────────────────────────────────────────────────────────

class ExplainRequest(BaseModel):
    spot_name: str
    score: int
    rating: str
    season: str
    breakdown: dict
    solunar: dict
    conditions: dict
    depth_info: Optional[dict] = None
    techniques: Optional[list] = None
    forage: Optional[str] = None


@app.post("/api/explain")
def explain_spot(req: ExplainRequest):
    """Use Claude to generate a natural-language fishing recommendation."""
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if not anthropic_key:
        return {"explanation": "Add ANTHROPIC_API_KEY to your .env to enable AI explanations."}

    import anthropic
    client = anthropic.Anthropic(api_key=anthropic_key)

    bd = req.breakdown
    sol = req.solunar
    cond = req.conditions
    depth = req.depth_info or {}
    techniques = req.techniques or []
    forage = req.forage or "round goby"

    prompt = f"""You are an expert Lake Erie smallmouth bass fishing guide specializing in the Ontario / Canadian side of the eastern basin.
Give a concise, practical fishing recommendation (4-5 sentences) for right now.

Spot: {req.spot_name}
Score: {req.score}/100 ({req.rating}) | Season: {req.season.replace('_', ' ')}
Target depth this season: {depth.get('target_depth_ft', 'unknown')} ft
Primary forage: {forage.replace('_', ' ')}
Research-suggested techniques: {', '.join(techniques) if techniques else 'tube jig, drop-shot'}

Current conditions:
- Water: {cond.get('water_temp_f', '?')}°F surface | Air: {cond.get('temp_f', '?')}°F
- Pressure: {cond.get('pressure_hpa', '?')} hPa ({cond.get('pressure_trend', '?')})
- Wind: {cond.get('wind_speed_mph', '?')} mph {cond.get('wind_dir_label', '')}
- Sky: {cond.get('conditions', '?')}

Factor scores: water_temp={bd.get('water_temp')} | pressure={bd.get('pressure')} | wind={bd.get('wind')} | solunar={bd.get('solunar')} ({sol.get('active_period','inactive')}) | monthly={bd.get('monthly_qual')}

Tell me: what are the fish likely doing right now at this specific spot, exactly where and how deep to target, and your top 1-2 technique/lure suggestions for these specific conditions. Eastern basin context — clear water, goby-heavy diet, fish run deeper than western basin. Be direct."""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=350,
        messages=[{"role": "user", "content": prompt}]
    )

    return {"explanation": message.content[0].text}


@app.get("/api/health")
def health():
    return {"status": "ok", "time": datetime.datetime.now().isoformat()}
