"""
Rolling water temperature history — SQLite-backed.

Records buoy readings every time conditions are fetched (~10 min intervals)
and computes multi-day warming/cooling trend.

Why this matters: a bass that has experienced 55°F for two weeks then sees
60°F is far more active than one sitting at 60°F and watching it drop to 59°F.
Temperature trend is one of the strongest triggers for pre-spawn staging and
post-spawn recovery activity. Research (Brownscombe 2024; Suski & Ridgway 2009)
identifies multi-day warming trends as a primary trigger for shallow movement.
"""

import sqlite3
import datetime
from pathlib import Path

_DB_PATH = Path(__file__).parent.parent / "data" / "temp_history.db"


def _conn():
    conn = sqlite3.connect(_DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS temp_readings (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            recorded_at TEXT    NOT NULL,
            temp_f      REAL    NOT NULL
        )
    """)
    conn.commit()
    return conn


def record_temp(water_temp_f: float | None) -> None:
    """Store a temperature reading. Called every time conditions are refreshed."""
    if water_temp_f is None:
        return
    with _conn() as conn:
        conn.execute(
            "INSERT INTO temp_readings (recorded_at, temp_f) VALUES (?, ?)",
            (datetime.datetime.now().isoformat(), water_temp_f),
        )
        # Keep 14 days of history; prune anything older
        cutoff = (datetime.datetime.now() - datetime.timedelta(days=14)).isoformat()
        conn.execute("DELETE FROM temp_readings WHERE recorded_at < ?", (cutoff,))


def get_temp_trend() -> dict:
    """
    Compute warming/cooling trend from stored readings.

    Uses the delta between the most recent reading and the reading closest
    to 7 days ago. Scales to a 7-day equivalent if less history exists.

    Returns:
      modifier:      int   — post-score modifier (-10 to +10)
      label:         str   — human-readable trend description
      delta_7day_f:  float | None — °F change over ~7 days
    """
    try:
        with _conn() as conn:
            rows = conn.execute(
                "SELECT recorded_at, temp_f FROM temp_readings ORDER BY recorded_at ASC"
            ).fetchall()
    except Exception:
        return {"modifier": 0, "label": "unknown", "delta_7day_f": None}

    if len(rows) < 4:
        return {"modifier": 0, "label": "insufficient data", "delta_7day_f": None}

    now         = datetime.datetime.now()
    recent_temp = rows[-1][1]
    target_7d   = now - datetime.timedelta(days=7)
    window      = datetime.timedelta(hours=12)

    candidates = [
        r for r in rows
        if datetime.datetime.fromisoformat(r[0]) <= target_7d + window
    ]

    if candidates:
        ref = min(candidates, key=lambda r: abs(
            (datetime.datetime.fromisoformat(r[0]) - target_7d).total_seconds()
        ))
        delta_7d = recent_temp - ref[1]
    else:
        # Less than 7 days of data — scale delta proportionally
        oldest    = rows[0]
        days_back = (now - datetime.datetime.fromisoformat(oldest[0])).total_seconds() / 86400
        if days_back < 0.25:
            return {"modifier": 0, "label": "insufficient data", "delta_7day_f": None}
        raw_delta = recent_temp - oldest[1]
        delta_7d  = raw_delta * (7 / days_back)

    delta_7d = round(delta_7d, 1)

    if delta_7d >= 5:
        label, modifier = "warming fast",     10
    elif delta_7d >= 2:
        label, modifier = "warming",           6
    elif delta_7d >= 0.5:
        label, modifier = "warming slightly",  3
    elif delta_7d > -0.5:
        label, modifier = "stable",            0
    elif delta_7d > -2:
        label, modifier = "cooling slightly", -3
    elif delta_7d > -5:
        label, modifier = "cooling",          -6
    else:
        label, modifier = "cooling fast",    -10

    return {
        "modifier":     modifier,
        "label":        label,
        "delta_7day_f": delta_7d,
    }
