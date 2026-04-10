"""
Water clarity scoring using VIIRS satellite KD490 (diffuse attenuation coefficient).

Dataset: LE_KD490_VIIRS_Monthly_Avg — NOAA CoastWatch Great Lakes Node
URL: https://apps.glerl.noaa.gov/erddap/griddap/LE_KD490_VIIRS_Monthly_Avg
Provides monthly-averaged KD490 for Lake Erie from 2018-present.

KD490 (m^-1) — light attenuation at 490nm. Higher = more turbid.
Eastern basin typical values:
  Summer (Jun-Sep): 0.10-0.20 m^-1   (relatively clear, Secchi ~3-5m)
  Spring (Apr-May): 0.20-0.40 m^-1   (runoff/mixing, more turbid)

Fishing interpretation (Kd490 → bass behavior):
  < 0.15  "crystal clear"  — fish spook easily in daylight; first-light window is critical;
                             lighter line (8lb fluoro), smaller lures; fish go deeper midday
  0.15-0.25 "clear"        — standard eastern basin conditions; normal depth targets
  0.25-0.40 "moderate"     — some turbidity; fish less light-sensitive; bite extends longer
  > 0.40  "turbid"         — fish less spooky; brighter lures; consistent bite through day;
                             fish shallower than normal

Results are cached for 24h to avoid unnecessary ERDDAP calls (monthly data changes slowly).
"""

import time
import requests

_ERDDAP_URL = (
    "https://apps.glerl.noaa.gov/erddap/griddap/LE_KD490_VIIRS_Monthly_Avg.csv"
    "?KD490[(last):1:(last)][({lat_min:.3f}):1:({lat_max:.3f})][({lon_min:.3f}):1:({lon_max:.3f})]"
)

# Module-level cache: (timestamp, result_dict)
_cache: dict[tuple, tuple[float, dict]] = {}
_CACHE_TTL_S = 24 * 3600


def get_kd490(lat: float, lon: float) -> dict:
    """
    Fetch monthly-average KD490 for a given location.

    Returns:
      kd490:          float | None    — KD490 in m^-1
      clarity_label:  str             — "crystal clear" | "clear" | "moderate" | "turbid"
      depth_offset_ft: int            — +ft to add to recommended depth in bright conditions
                                        (0 in turbid water, up to +3 in crystal clear)
      technique_note: str             — lure/presentation guidance
      source:         str
    """
    key = (round(lat, 2), round(lon, 2))
    now = time.monotonic()
    if key in _cache and (now - _cache[key][0]) < _CACHE_TTL_S:
        return _cache[key][1]

    result = _fetch_kd490(lat, lon)
    _cache[key] = (now, result)
    return result


def _fetch_kd490(lat: float, lon: float) -> dict:
    try:
        url = _ERDDAP_URL.format(
            lat_min=lat - 0.12, lat_max=lat + 0.12,
            lon_min=lon - 0.12, lon_max=lon + 0.12,
        )
        resp = requests.get(url, timeout=12)
        resp.raise_for_status()
        lines = resp.text.strip().split("\n")
        vals = []
        for line in lines[2:]:
            parts = line.split(",")
            if len(parts) >= 4 and parts[3].strip() != "NaN":
                try:
                    vals.append(float(parts[3]))
                except (ValueError, IndexError):
                    pass
        if not vals:
            return _from_kd490(None)
        kd490 = round(sum(vals) / len(vals), 3)
        return _from_kd490(kd490)
    except Exception:
        return _from_kd490(None)


def _from_kd490(kd490: float | None) -> dict:
    if kd490 is None:
        return {
            "kd490":           None,
            "clarity_label":   "unknown",
            "depth_offset_ft": 0,
            "technique_note":  "",
            "source":          "unavailable",
        }

    if kd490 < 0.15:
        label      = "crystal clear"
        depth_off  = 3
        technique  = "light line (8lb fluoro), finesse plastics; dawn bite window critical"
    elif kd490 < 0.25:
        label      = "clear"
        depth_off  = 1
        technique  = "standard light line; drop-shot/tube jigs"
    elif kd490 < 0.40:
        label      = "moderate"
        depth_off  = 0
        technique  = "standard tackle; diving crankbaits and swimbaits work well"
    else:
        label      = "turbid"
        depth_off  = -2   # fish shallower when water is murky
        technique  = "brighter lures (chartreuse/white); heavier line ok; bite extends all day"

    return {
        "kd490":           kd490,
        "clarity_label":   label,
        "depth_offset_ft": depth_off,
        "technique_note":  technique,
        "source":          "glerl_viirs_monthly",
    }
