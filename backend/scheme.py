"""Assessment scheme: CIE1 25 + CIE2 20 + CIE3 25 + SEE (semester end exam) 30 = 100, and the pass rules."""
SCHEME = {"cie1": 25, "cie2": 20, "cie3": 25, "see": 30}
BANDS = [(90, "A+"), (80, "A"), (70, "B+"), (60, "B"), (50, "C"), (40, "D")]
CIES = [k for k in SCHEME if k != "see"]
CIE_EACH_MIN_PCT = 40  # each CIE needs 40% of its own maximum
CIE_TOTAL_MIN_PCT = 40  # and the CIE total needs 40% of 70 = 28
SEE_MIN_PCT = 50  # SEE pass mark is 50% of 30 = 15
ATTENDANCE_MIN = 80.0  # mandatory, per subject
RULES = {
    "cie_each_min": {k: SCHEME[k] * CIE_EACH_MIN_PCT / 100 for k in CIES},
    "cie_total_min": sum(SCHEME[k] for k in CIES) * CIE_TOTAL_MIN_PCT / 100,
    "see_min": SCHEME["see"] * SEE_MIN_PCT / 100,
    "attendance_min_pct": ATTENDANCE_MIN,
}


def has(v):
    return v is not None and v == v  # False for None and NaN


def totals(r):
    """(obtained, out_of) over the components that have been assessed so far."""
    got = [(r[k], mx) for k, mx in SCHEME.items() if has(r.get(k))]
    return sum(v for v, _ in got), sum(mx for _, mx in got)


def percent(r):
    """Percentage over assessed components, so a missing SEE does not read as a fail."""
    o, m = totals(r)
    return round(100 * o / m, 2) if m else None


def band(p):
    return next((g for lo, g in BANDS if p >= lo), "F")


def evaluate(r):
    """Apply the pass rules to one subject row.

    result: shortage (attendance < 80%) > fail (any assessed rule broken) > pending (not fully assessed) > pass.
    grade: F for fail/shortage, the percentage band for pass, None while pending.
    """
    reasons = []
    for k in CIES:
        if has(r.get(k)) and r[k] < RULES["cie_each_min"][k]:
            reasons.append(f"{k.upper()} {r[k]:g} is below the minimum {RULES['cie_each_min'][k]:g}")
    cie_done = all(has(r.get(k)) for k in CIES)
    cie_total = sum(r[k] for k in CIES if has(r.get(k)))
    if cie_done and cie_total < RULES["cie_total_min"]:
        reasons.append(f"CIE total {cie_total:g} is below the minimum {RULES['cie_total_min']:g}")
    see_done = has(r.get("see"))
    if see_done and r["see"] < RULES["see_min"]:
        reasons.append(f"SEE {r['see']:g} is below the minimum {RULES['see_min']:g}")
    failed = bool(reasons)
    total = r.get("total") or 0
    att = round(100 * (r.get("attended") or 0) / total, 1) if total else None
    short = att is not None and att < ATTENDANCE_MIN
    if short:
        reasons.insert(0, f"attendance {att:g}% is below the mandatory {ATTENDANCE_MIN:g}%")
    result = "shortage" if short else "fail" if failed else "pass" if cie_done and see_done else "pending"
    p = percent(r)
    grade = "F" if result in ("shortage", "fail") else band(p) if result == "pass" else None
    return {"result": result, "reasons": reasons, "grade": grade, "cie_total": cie_total, "attendance_pct": att}
