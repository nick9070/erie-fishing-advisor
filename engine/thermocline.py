"""
Thermocline depth estimation for eastern Lake Erie smallmouth bass targeting.

Uses GLSEA (Great Lakes Surface Environmental Analysis) satellite SST via
NOAA GLERL's free ERDDAP API for accurate surface temperature, then applies
an empirical stratification model calibrated to LEOFS model output and
eastern basin observations.

Eastern basin context:
  - Deepest part of Lake Erie (max ~64m / 210ft)
  - Strong, persistent thermocline forms mid-June, peaks July-August
  - Typical summer thermocline: 18–26ft depth
  - Smallmouth suspend just ABOVE the thermocline or stack on structure
    that rises into that band (Ridgway et al., Brownscombe 2024)
  - Thermocline breaks down September-October as winds mix the water column

GLSEA SST endpoint (free, no key):
  https://apps.glerl.noaa.gov/erddap/griddap/GLSEA_ACSPO_GCS.csv
  Returns daily satellite composite SST in °C for the full Great Lakes.
"""

import requests

_GLSEA_URL = (
    "https://apps.glerl.noaa.gov/erddap/griddap/GLSEA_ACSPO_GCS.csv"
    "?sst[(last):1:(last)][({lat_min:.3f}):1:({lat_max:.3f})][({lon_min:.3f}):1:({lon_max:.3f})]"
)


def get_glsea_sst(lat: float, lon: float) -> float | None:
    """
    Fetch current satellite-derived surface temp from NOAA GLSEA ERDDAP.
    Returns °F or None if unavailable.

    GLSEA composites AVHRR + VIIRS imagery daily, cloud-gap-filled.
    More spatially accurate than a point buoy for broad lake conditions.
    """
    try:
        url = _GLSEA_URL.format(
            lat_min=lat - 0.08, lat_max=lat + 0.08,
            lon_min=lon - 0.08, lon_max=lon + 0.08,
        )
        resp = requests.get(url, timeout=12)
        resp.raise_for_status()
        lines = resp.text.strip().split("\n")
        # Row 0: variable names, row 1: units, row 2+: data
        data_lines = lines[2:]
        temps_c = []
        for line in data_lines:
            parts = line.split(",")
            if len(parts) >= 4:
                try:
                    val = float(parts[3])
                    if -2.0 < val < 35.0:   # sanity bounds in °C
                        temps_c.append(val)
                except (ValueError, IndexError):
                    pass
        if not temps_c:
            return None
        avg_c = sum(temps_c) / len(temps_c)
        return round(avg_c * 9 / 5 + 32, 1)   # °C → °F
    except Exception:
        return None


def get_thermocline(
    water_temp_f: float | None,
    month: int,
    lat: float = 42.75,
    lon: float = -79.80,
) -> dict:
    """
    Estimate thermocline depth for eastern Lake Erie.

    Returns:
      depth_ft:    float | None  — None if water column is fully mixed
      stratified:  bool
      source:      str           — 'glsea' | 'buoy' | 'estimated'
      note:        str           — brief plain-English description
    """
    # Try GLSEA satellite SST for better spatial accuracy
    glsea_temp = get_glsea_sst(lat, lon)
    if glsea_temp is not None:
        surf_temp = glsea_temp
        source    = "glsea"
    elif water_temp_f is not None:
        surf_temp = water_temp_f
        source    = "buoy"
    else:
        surf_temp = _seasonal_temp_estimate(month)
        source    = "estimated"

    # No stratification outside June–September
    if month < 6 or month > 9:
        return {
            "depth_ft":   None,
            "stratified": False,
            "source":     source,
            "note":       "Water column fully mixed",
        }

    # Surface temp below stratification threshold
    if surf_temp < 64:
        return {
            "depth_ft":   None,
            "stratified": False,
            "source":     source,
            "note":       "Too cool for thermal stratification",
        }

    # Empirical thermocline depth calibrated to LEOFS eastern basin output.
    # Depth increases as summer progresses and as surface temp rises.
    # Wind mixing events can temporarily deepen or break the thermocline;
    # this model reflects climatological averages, not event-scale mixing.
    if surf_temp < 68:
        depth_ft = 15.0
        note     = "Early stratification — thermocline ~15ft"
    elif surf_temp < 72:
        depth_ft = 18.0 if month == 6 else 20.0
        note     = f"Moderate stratification — thermocline ~{int(depth_ft)}ft"
    elif surf_temp < 76:
        depth_ft = 22.0 if month in (7, 8) else 20.0
        note     = f"Strong summer stratification — thermocline ~{int(depth_ft)}ft"
    else:
        depth_ft = 25.0
        note     = "Maximum stratification — thermocline ~25ft; bass compress above it"

    return {
        "depth_ft":   depth_ft,
        "stratified": True,
        "source":     source,
        "note":       note,
    }


def _seasonal_temp_estimate(month: int) -> float:
    """Eastern basin surface temp climatology (°F) — fallback when all sources offline."""
    return {
        1: 35, 2: 34, 3: 37, 4: 46, 5: 57,  6: 67,
        7: 74, 8: 75, 9: 70, 10: 61, 11: 50, 12: 40,
    }.get(month, 55)
