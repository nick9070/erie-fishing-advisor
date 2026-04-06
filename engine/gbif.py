"""
GBIF occurrence data fetcher for Lake Erie smallmouth bass.
GBIF API is free, no key required.

Micropterus dolomieu (smallmouth bass) taxon key: 2352091
Lake Erie bounding box: lat 41.5–43.0, lon -84.0–78.5

Run standalone to refresh the cache:
    python -m engine.gbif
"""

import json
import math
import datetime
import requests
from pathlib import Path
from collections import defaultdict


GBIF_TAXON_KEY = 5211250  # Micropterus dolomieu (verified primary key)

# Eastern basin focus (user fishes from Canadian side, eastern basin)
# Full lake: lat 41.5-43.0, lon -84.0 to -78.5
LAKE_ERIE_BBOX = {
    "decimalLatitudeMin": 41.5,
    "decimalLatitudeMax": 43.0,
    "decimalLongitudeMin": -84.0,
    "decimalLongitudeMax": -78.5,
}

CACHE_PATH = Path(__file__).parent.parent / "data" / "gbif_cache.json"
GBIF_BASE = "https://api.gbif.org/v1"


def fetch_occurrences(limit_total: int = 1000) -> list[dict]:
    """
    Fetch Lake Erie smallmouth bass occurrences from GBIF.
    Paginates automatically up to limit_total records.
    """
    records = []
    offset = 0
    page_size = 300

    print(f"Fetching GBIF occurrences for Lake Erie smallmouth bass...")

    while len(records) < limit_total:
        params = {
            "taxonKey": GBIF_TAXON_KEY,
            "decimalLatitude": f"{LAKE_ERIE_BBOX['decimalLatitudeMin']},{LAKE_ERIE_BBOX['decimalLatitudeMax']}",
            "decimalLongitude": f"{LAKE_ERIE_BBOX['decimalLongitudeMin']},{LAKE_ERIE_BBOX['decimalLongitudeMax']}",
            "hasCoordinate": "true",
            "hasGeospatialIssue": "false",
            "occurrenceStatus": "PRESENT",
            "limit": min(page_size, limit_total - len(records)),
            "offset": offset,
        }

        resp = requests.get(f"{GBIF_BASE}/occurrence/search", params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        results = data.get("results", [])
        if not results:
            break

        records.extend(results)
        print(f"  fetched {len(records)} / {data.get('count', '?')} total")

        if data.get("endOfRecords", True):
            break
        offset += page_size

    print(f"Done. {len(records)} records fetched.")
    return records


def process_occurrences(records: list[dict]) -> dict:
    """
    Distill raw GBIF records into useful structures for the scoring engine:
    - monthly_heatmap: {month: [{lat, lon, count}]}
    - hotspot_grid: 0.1° grid cells ranked by record density
    - seasonal_summary: which months have the most records (proxy for activity)
    """
    monthly_grid = defaultdict(lambda: defaultdict(int))  # month -> cell -> count
    monthly_counts = defaultdict(int)

    for rec in records:
        lat = rec.get("decimalLatitude")
        lon = rec.get("decimalLongitude")
        month_str = rec.get("month")

        if lat is None or lon is None:
            continue

        # Snap to 0.1° grid cell
        cell_lat = round(math.floor(lat * 10) / 10, 1)
        cell_lon = round(math.floor(lon * 10) / 10, 1)
        cell = f"{cell_lat},{cell_lon}"

        if month_str:
            month = int(month_str)
            monthly_grid[month][cell] += 1
            monthly_counts[month] += 1

    # Build monthly heatmap — top cells per month
    monthly_heatmap = {}
    for month, cells in monthly_grid.items():
        top_cells = sorted(cells.items(), key=lambda x: x[1], reverse=True)[:20]
        monthly_heatmap[str(month)] = [
            {
                "lat": float(cell.split(",")[0]),
                "lon": float(cell.split(",")[1]),
                "count": count,
            }
            for cell, count in top_cells
        ]

    # Overall seasonal summary (normalized 0-100)
    max_count = max(monthly_counts.values()) if monthly_counts else 1
    seasonal_index = {
        str(m): round((monthly_counts.get(m, 0) / max_count) * 100)
        for m in range(1, 13)
    }

    return {
        "fetched_at": datetime.datetime.utcnow().isoformat(),
        "total_records": len(records),
        "seasonal_index": seasonal_index,
        "monthly_heatmap": monthly_heatmap,
    }


def get_gbif_season_boost(month: int) -> int:
    """
    Returns a score modifier (-10 to +10) based on GBIF seasonal activity index.
    Reflects historically when smallmouth have been observed/caught on Lake Erie.
    """
    cache = _load_cache()
    if not cache:
        return 0
    index = cache.get("seasonal_index", {})
    val = index.get(str(month), 50)
    # Map 0-100 index to -10 to +10 modifier
    return round((val - 50) / 5)


def get_nearby_gbif_density(lat: float, lon: float, month: int, radius_deg: float = 0.2) -> int:
    """
    Returns GBIF record count near a spot for a given month.
    Used to give spots with historically documented catches a small boost.
    """
    cache = _load_cache()
    if not cache:
        return 0

    heatmap = cache.get("monthly_heatmap", {}).get(str(month), [])
    nearby = sum(
        cell["count"]
        for cell in heatmap
        if abs(cell["lat"] - lat) <= radius_deg and abs(cell["lon"] - lon) <= radius_deg
    )
    return nearby


def refresh_cache():
    """Fetch fresh GBIF data and save to cache file."""
    records = fetch_occurrences(limit_total=1000)
    processed = process_occurrences(records)
    CACHE_PATH.parent.mkdir(exist_ok=True)
    with open(CACHE_PATH, "w") as f:
        json.dump(processed, f, indent=2)
    print(f"Cache saved to {CACHE_PATH}")
    return processed


def _load_cache() -> dict | None:
    if not CACHE_PATH.exists():
        return None
    with open(CACHE_PATH) as f:
        return json.load(f)


if __name__ == "__main__":
    data = refresh_cache()
    print("\nSeasonal activity index (GBIF records by month):")
    months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
    for m in range(1, 13):
        val = data["seasonal_index"].get(str(m), 0)
        bar = "█" * (val // 5)
        print(f"  {months[m-1]:>3}  {bar:<20} {val}")
