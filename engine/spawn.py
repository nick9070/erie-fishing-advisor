"""
Spawn phase detection for eastern Lake Erie smallmouth bass.

Eastern basin runs 2-3 weeks LATER than western basin due to cooler,
deeper water. Timing is temperature-driven, not calendar-driven.

Phase sequence and typical eastern basin timing:
  pre_spawn_early   52-57°F   Late April / early May — staging offshore 18-28ft
  pre_spawn         57-62°F   May — moving to rocky/gravel shallows 8-15ft
  spawn             62-70°F   Late May to ~June 15 — on nests 5-12ft
  post_spawn_guard  68-74°F   June 15 – early July — males with fry, not feeding
  post_spawn_recovery 70-76°F July — females feeding up, males scattered
  summer            >65°F     July–September — active season
  fall              <62°F     October–November — aggressive pre-winter feed
  winter            <50°F     December–March — deep holding

Research basis:
  Spawn trigger temp: 62-65°F (Ridgway & Shuter 1996, Brownscombe 2024)
  Male fry-guard duration: 14-21 days post-hatch (Wiegmann & Wiegmann 2005)
  Post-spawn female recovery: 10-14 days (Scott & Crossman 1973)
  Eastern basin lag: 2-3 weeks vs western (DFO Lake Erie thermal monitoring)
"""


def get_spawn_phase(water_temp_f: float | None, month: int) -> dict:
    """
    Determine current spawn phase for eastern Lake Erie smallmouth.

    Returns:
      phase:         str  — machine label
      label:         str  — display label
      score_penalty: int  — post-score penalty applied in scoring.py (0 to -15)
      depth_note:    str  — brief depth guidance for this phase
      cr_warning:    bool — True when nest disturbance risk warrants C&R caution
    """
    temp = water_temp_f if water_temp_f is not None else _seasonal_temp_estimate(month)

    # ── Winter / off-season ────────────────────────────────────────────────
    if month <= 3 or month == 12 or temp < 46:
        return {
            "phase":         "winter",
            "label":         "Winter",
            "score_penalty": 0,
            "depth_note":    "Holding deep on rock ledges 30–45ft",
            "cr_warning":    False,
        }

    # ── Pre-spawn staging (late April – May, 50–57°F) ─────────────────────
    # Fish stage on first offshore structure outside their winter areas,
    # typically 18–28ft on rock/gravel humps. Very catchable — actively
    # feeding before the spawn energy draw.
    if month in (4, 5) and temp < 57:
        return {
            "phase":         "pre_spawn_early",
            "label":         "Pre-Spawn (Staging)",
            "score_penalty": 0,
            "depth_note":    "Staging on offshore rock/gravel 18–28ft",
            "cr_warning":    False,
        }

    # ── Pre-spawn (May, 57–62°F) ──────────────────────────────────────────
    # Fish actively moving toward spawning areas. Aggressive biters.
    # Best fishing of the year — large females actively eating.
    if temp < 62 and month in (4, 5, 6):
        return {
            "phase":         "pre_spawn",
            "label":         "Pre-Spawn",
            "score_penalty": 0,
            "depth_note":    "Moving to shallow rock/gravel 8–15ft, actively feeding",
            "cr_warning":    False,
        }

    # ── Spawn (late May – mid June, 62–70°F) ──────────────────────────────
    # Males on nests in 5–12ft. Females in deeper water post-deposit.
    # Males bite defensively, not for food — scores suppressed.
    # C&R warning: releasing a male far from nest = nest abandoned to gobies.
    if 62 <= temp < 70 and month in (5, 6):
        return {
            "phase":         "spawn",
            "label":         "Spawn",
            "score_penalty": -8,
            "depth_note":    "Males on nests 5–12ft; females 15–20ft post-deposit",
            "cr_warning":    True,
        }

    # ── Post-spawn fry guard (mid June – early July, 68–74°F) ────────────
    # Males aggressively guarding fry balls in very shallow water.
    # Round gobies predate nests heavily — C&R timing critical.
    # Males guarding are NOT feeding. This is the worst bite of the year.
    if 68 <= temp < 78 and month in (6, 7) and _is_fry_guard_window(temp, month):
        return {
            "phase":         "post_spawn_guard",
            "label":         "Post-Spawn (Fry Guard)",
            "score_penalty": -15,
            "depth_note":    "Males 2–6ft guarding fry; females 15–20ft recovering",
            "cr_warning":    True,
        }

    # ── Post-spawn recovery (July, 68–76°F) ──────────────────────────────
    # Both sexes scattered and recovering. Bite improving daily.
    # Females begin feeding first (more energy deficit). Fish mid-depth.
    if month == 7 and temp >= 65:
        return {
            "phase":         "post_spawn_recovery",
            "label":         "Post-Spawn Recovery",
            "score_penalty": -5,
            "depth_note":    "Scattered 10–20ft; females feeding first, improving daily",
            "cr_warning":    False,
        }

    # ── Fall transition (Oct–Nov, cooling below 55°F) ─────────────────────
    if month in (10, 11) and temp < 55:
        return {
            "phase":         "fall_transition",
            "label":         "Fall Transition",
            "score_penalty": 0,
            "depth_note":    "Moving to deep rock ledges 25–40ft for winter",
            "cr_warning":    False,
        }

    # ── Active season (summer feeding / fall feeding) ─────────────────────
    return {
        "phase":         "active",
        "label":         "Active" if month <= 9 else "Fall",
        "score_penalty": 0,
        "depth_note":    "",
        "cr_warning":    False,
    }


def _is_fry_guard_window(temp: float, month: int) -> bool:
    """
    Heuristic: fry guard phase runs roughly June 10 – July 10 in eastern basin.
    We approximate by requiring month == 6 (entire June after spawn) or
    early July when water is still in the 68–74°F range.
    """
    if month == 6 and temp >= 68:
        return True
    if month == 7 and 65 <= temp < 73:
        return True
    return False


def _seasonal_temp_estimate(month: int) -> float:
    """
    Rough eastern Lake Erie surface temp by month (°F) — used when buoy is offline.
    Based on 30-year NDBC/GLERL climatology for eastern basin.
    """
    return {
        1: 35, 2: 34, 3: 37, 4: 46, 5: 57,  6: 67,
        7: 74, 8: 75, 9: 70, 10: 61, 11: 50, 12: 40,
    }.get(month, 55)
