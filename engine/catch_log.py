"""
Catch logging — SQLite-backed storage for your personal catch records.
Every catch you log becomes training data to validate and tune the scoring engine.
"""

import sqlite3
import datetime
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "catches.db"


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create the catches table if it doesn't exist."""
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS catches (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at      TEXT NOT NULL,
                spot_id         TEXT NOT NULL,
                spot_name       TEXT NOT NULL,
                fish_date       TEXT NOT NULL,
                fish_time       TEXT,
                fish_count      INTEGER NOT NULL DEFAULT 1,
                avg_length_in   REAL,
                avg_weight_lb   REAL,
                best_length_in  REAL,
                lure            TEXT,
                technique       TEXT,
                depth_ft        REAL,
                water_temp_f    REAL,
                air_temp_f      REAL,
                pressure_hpa    REAL,
                pressure_trend  TEXT,
                wind_speed_mph  REAL,
                wind_dir        TEXT,
                conditions      TEXT,
                score_at_time   INTEGER,
                notes           TEXT
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_catches_spot ON catches(spot_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_catches_date ON catches(fish_date)")


def log_catch(data: dict) -> dict:
    """Insert a catch record. Returns the saved record with its id."""
    now = datetime.datetime.utcnow().isoformat()
    fields = [
        "created_at", "spot_id", "spot_name", "fish_date", "fish_time",
        "fish_count", "avg_length_in", "avg_weight_lb", "best_length_in",
        "lure", "technique", "depth_ft", "water_temp_f", "air_temp_f",
        "pressure_hpa", "pressure_trend", "wind_speed_mph", "wind_dir",
        "conditions", "score_at_time", "notes"
    ]
    values = {
        "created_at": now,
        "spot_id": data["spot_id"],
        "spot_name": data["spot_name"],
        "fish_date": data["fish_date"],
        "fish_time": data.get("fish_time"),
        "fish_count": data.get("fish_count", 1),
        "avg_length_in": data.get("avg_length_in"),
        "avg_weight_lb": data.get("avg_weight_lb"),
        "best_length_in": data.get("best_length_in"),
        "lure": data.get("lure"),
        "technique": data.get("technique"),
        "depth_ft": data.get("depth_ft"),
        "water_temp_f": data.get("water_temp_f"),
        "air_temp_f": data.get("air_temp_f"),
        "pressure_hpa": data.get("pressure_hpa"),
        "pressure_trend": data.get("pressure_trend"),
        "wind_speed_mph": data.get("wind_speed_mph"),
        "wind_dir": data.get("wind_dir"),
        "conditions": data.get("conditions"),
        "score_at_time": data.get("score_at_time"),
        "notes": data.get("notes"),
    }
    placeholders = ", ".join(f":{f}" for f in fields)
    cols = ", ".join(fields)
    with get_conn() as conn:
        cur = conn.execute(f"INSERT INTO catches ({cols}) VALUES ({placeholders})", values)
        values["id"] = cur.lastrowid
    return values


def get_catches(spot_id: str | None = None, limit: int = 100) -> list[dict]:
    """Fetch catch records, optionally filtered by spot."""
    with get_conn() as conn:
        if spot_id:
            rows = conn.execute(
                "SELECT * FROM catches WHERE spot_id = ? ORDER BY fish_date DESC, fish_time DESC LIMIT ?",
                (spot_id, limit)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM catches ORDER BY fish_date DESC, fish_time DESC LIMIT ?",
                (limit,)
            ).fetchall()
    return [dict(r) for r in rows]


def get_spot_stats(spot_id: str) -> dict:
    """Aggregate stats for a spot — used to boost/penalize its score over time."""
    with get_conn() as conn:
        row = conn.execute("""
            SELECT
                COUNT(*)              AS total_sessions,
                SUM(fish_count)       AS total_fish,
                AVG(fish_count)       AS avg_fish_per_session,
                AVG(avg_length_in)    AS avg_length,
                MAX(best_length_in)   AS personal_best,
                AVG(score_at_time)    AS avg_predicted_score
            FROM catches
            WHERE spot_id = ?
        """, (spot_id,)).fetchone()

        # Monthly breakdown — which months produce at this spot
        monthly = conn.execute("""
            SELECT
                CAST(strftime('%m', fish_date) AS INTEGER) AS month,
                COUNT(*) AS sessions,
                SUM(fish_count) AS fish,
                AVG(fish_count) AS avg_fish
            FROM catches
            WHERE spot_id = ?
            GROUP BY month
            ORDER BY month
        """, (spot_id,)).fetchall()

    return {
        **dict(row),
        "monthly": [dict(m) for m in monthly]
    }


def get_catch_bonus(spot_id: str, month: int) -> int:
    """
    Returns a score adjustment (-20 to +20) based on your personal catch history.
    Positive = you catch well here this time of year.
    Negative = you've fished here this month and come up empty.
    """
    with get_conn() as conn:
        row = conn.execute("""
            SELECT
                COUNT(*) AS sessions,
                AVG(fish_count) AS avg_fish
            FROM catches
            WHERE spot_id = ?
              AND CAST(strftime('%m', fish_date) AS INTEGER) = ?
        """, (spot_id, month)).fetchone()

    sessions = row["sessions"] or 0
    avg_fish = row["avg_fish"] or 0

    if sessions == 0:
        return 0  # no data yet
    if avg_fish >= 5:
        return 20
    if avg_fish >= 3:
        return 12
    if avg_fish >= 1:
        return 5
    return -10  # been here this month, caught nothing
