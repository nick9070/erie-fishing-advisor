#!/usr/bin/env python3
"""
Erie Smallmouth Bass Fishing Advisor
CLI entry point — run with: python main.py
"""

import json
import os
import sys
import datetime
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from engine.weather import get_weather, get_pressure_trend
from engine.water_temp import get_water_temp
from engine.scoring import rank_spots


def load_spots() -> list:
    spots_path = Path(__file__).parent / "data" / "spots.json"
    with open(spots_path) as f:
        return json.load(f)


def get_conditions(api_key: str, center_lat=41.65, center_lon=-82.75) -> dict:
    """Fetch all real-time conditions using Lake Erie central point."""
    print("  Fetching weather...")
    weather = get_weather(center_lat, center_lon, api_key)

    print("  Fetching pressure trend...")
    trend = get_pressure_trend(center_lat, center_lon, api_key)

    print("  Fetching water temperature from NOAA buoy...")
    water = get_water_temp(center_lat, center_lon)

    return {**weather, **water, "pressure_trend": trend}


def print_conditions(conditions: dict):
    wt = conditions.get("water_temp_f")
    wt_str = f"{wt}°F" if wt else "unavailable"

    print(f"""
┌─────────────────────────────────────────────┐
│           Current Lake Erie Conditions       │
├─────────────────────────────────────────────┤
│  Water Temp:    {wt_str:<28}│
│  Air Temp:      {conditions.get('temp_f', '?'):<27.1f}°F │
│  Pressure:      {conditions.get('pressure_hpa', '?'):<23.1f} hPa │
│  Pressure Trend:{conditions.get('pressure_trend', '?'):<28}│
│  Wind:          {conditions.get('wind_speed_mph', 0):<5.1f} mph {conditions.get('wind_dir_label', '?'):<19}│
│  Sky:           {conditions.get('conditions', '?'):<28}│
│  Buoy:          {conditions.get('buoy_name', '?'):<28}│
└─────────────────────────────────────────────┘""")


def print_results(ranked: list):
    print(f"\n{'═'*60}")
    print(f"  TOP SMALLMOUTH SPOTS FOR TODAY")
    print(f"{'═'*60}\n")

    for i, result in enumerate(ranked[:5], 1):
        score = result["score"]
        rating = result["rating"]
        name = result["spot_name"]
        season = result["season"].replace("_", "-")
        solunar = result["solunar"]

        # Score bar
        filled = round(score / 5)
        bar = "█" * filled + "░" * (20 - filled)

        print(f"  #{i}  {name}")
        print(f"       Score: {score}/100  [{bar}]  {rating}")
        print(f"       Season mode: {season.upper()}")

        # Breakdown
        bd = result["breakdown"]
        print(f"       Factors: temp={bd['water_temp']} | pressure={bd['pressure']} | "
              f"wind={bd['wind']} | solunar={bd['solunar']} | season={bd['season_match']} | time={bd['time_of_day']}")

        # Solunar info
        if solunar.get("active_period") and solunar["active_period"] != "inactive":
            print(f"       ★ Solunar: {solunar['active_period']}")
        if solunar.get("moon_phase_pct") is not None:
            print(f"       Moon: {solunar['moon_phase_pct']}% illuminated")

        if result["notes"]:
            print(f"       Note: {result['notes']}")

        print()


def main():
    api_key = os.environ.get("OPENWEATHER_API_KEY")
    if not api_key:
        print("\nERROR: OPENWEATHER_API_KEY environment variable not set.")
        print("Get a free key at: https://openweathermap.org/api")
        print("Then run: export OPENWEATHER_API_KEY=your_key_here\n")
        sys.exit(1)

    now = datetime.datetime.now()
    print(f"\nErie Smallmouth Advisor — {now.strftime('%A, %B %d %Y  %I:%M %p')}")
    print("Fetching conditions...\n")

    try:
        spots = load_spots()
        conditions = get_conditions(api_key)
        print_conditions(conditions)

        ranked = rank_spots(spots, conditions, now)
        print_results(ranked)

    except Exception as e:
        print(f"\nError: {e}")
        raise


if __name__ == "__main__":
    main()
