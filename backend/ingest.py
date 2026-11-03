"""Turn an uploaded or linked spreadsheet into rows the app can save. Pure functions: no database access.

Handles real-world sheets: many tabs (one per section / batch / subject), title rows above the header
("Subject: Python", "Section: A"), flexible header names (USN, Roll No, Sec, CIE-1 (25), Student Name),
marks out of other maxima, attendance as counts, as a percentage, or as a date register (P/A per day).
"""
import csv
import io
import re
import warnings
from datetime import date, datetime

import pandas as pd

from scheme import SCHEME

MAX_ROWS, MAX_SHEETS = 5000, 40

_ALIASES = {
    "student_id": "usn universityseatnumber seatno seatnumber regno registrationno registrationnumber rollno rollnumber studentid idno id enrollmentno enrolmentno admissionno".split(),
    "name": "name studentname nameofthestudent candidatename fullname".split(),
    "department": "department dept branch stream program programme".split(),
    "semester": "semester sem term".split(),
    "class_name": "class classname".split(),
    "section": "section sec div division".split(),
    "batch": "batch academicyear admissionyear yearofadmission yearofjoining".split(),
    "subject": "subject subjectname course coursename paper papername".split(),
    "cie1": "cie1 cia1 ia1 internal1 internals1 internalassessment1 test1 ct1 cat1".split(),
    "cie2": "cie2 cia2 ia2 internal2 internals2 internalassessment2 test2 ct2 cat2".split(),
    "cie3": "cie3 cia3 ia3 internal3 internals3 internalassessment3 test3 ct3 cat3".split(),
    "see": "see ese semesterendexam semesterendexamination semendexam endsem endsemester endsemexam endsemesterexam externalmarks external finalexam".split(),
    "attended": "attended classesattended daysattended presentdays noofclassesattended attendedclasses present noofdayspresent".split(),
    "held": "total totalclasses classesheld totaldays workingdays noofclassesheld noofclasses heldclasses classesconducted noofworkingdays".split(),
    "attendance_pct": "attendance attendancepercentage attendancepercent attendancepct att attpercentage".split(),
}
ALIAS = {a: f for f, names in _ALIASES.items() for a in names}
CTX_KEYS = {"subject": "subject", "course": "subject", "section": "section", "sec": "section", "semester": "semester", "sem": "semester",
            "batch": "batch", "academicyear": "batch", "class": "class_name", "department": "department", "dept": "department", "branch": "department"}
_KW = r"subject|course|section|sec|semester|sem|batch|academic\s*year|class|department|dept|branch"
CTX = re.compile(rf"\b({_KW})\b\s*[:=]\s*(.+?)(?=\s{{2,}}|\s+\b(?:{_KW})\b\s*[:=]|[,;|]|$)", re.I)
MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec"
ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8}
PRESENT = {"p", "present", "y", "yes", "1", "true", "✓", "✔", "√"}
ABSENT = {"a", "absent", "n", "no", "0", "false", "✗", "✘", "x"}
SUMMARY = re.compile(r"^\s*(total|average|avg|class average|max|maximum|min|minimum|highest|lowest|pass|fail|signature)\b", re.I)


def compact(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def clean(v):
    """Blank -> None, whole floats -> int (Excel stores 101 as 101.0), strings trimmed."""
    if v is None:
        return None
    if isinstance(v, float):
        return None if v != v else int(v) if v.is_integer() else v
    if isinstance(v, str):
        return v.strip() or None
    return v


def as_date(c):
    """A header cell that is a date (real Excel date or text like 12/09/2026, 12-Sep)."""
    if isinstance(c, datetime):
        return c.date()
    if isinstance(c, date):
        return c
    if not isinstance(c, str):
        return None
    s = c.strip()
    if not (re.fullmatch(r"\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}", s) or re.fullmatch(rf"\d{{1,2}}[ \-/]({MONTHS})[a-z]*([ \-/,]+\d{{2,4}})?", s, re.I)):
        return None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        t = pd.to_datetime(s, dayfirst=not re.match(r"\d{4}", s), errors="coerce")
    return None if pd.isna(t) else t.date()


def norm_header(c):
    return compact(re.sub(r"\(.*?\)", "", str(c)))


def sem_num(v):
    s = str(v).strip().lower()
    m = re.search(r"\d+", s)
    if m:
        return int(m.group())
    m = re.search(r"\b(viii|vii|vi|iv|iii|ii|v|i)\b", s)
    if m:
        return ROMAN[m.group(1)]
    raise ValueError(f"semester '{v}' is not a number")


def number(v, label):
    try:
        return float(str(v).strip().rstrip("%"))
    except ValueError:
        raise ValueError(f"{label} '{v}' is not a number")


def score(v, scale, label):
    """A marks cell. AB/absent = 0, blank/NA = not assessed, '21/25' = 21."""
    if v is None:
        return None
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("-", "--", "na", "n/a", "nil"):
            return None
        if s in ("ab", "abs", "absent", "a"):
            return 0.0
        m = re.fullmatch(r"([\d.]+)\s*(?:/\s*[\d.]+)?", s)
        if not m:
            raise ValueError(f"{label} '{v}' is not a number")
        v = m.group(1)
    return round(number(v, label) * scale, 2)


def token(v):
    if v is None:
        return None
    s = str(v).strip().lower()
    return True if s in PRESENT else False if s in ABSENT else None


def find_header(raw):
    """Row index of the table header: the row (in the first 25) naming the most known columns, and a USN column."""
    best, best_score = None, 0
    for i in range(min(25, len(raw))):
        fields, dates = set(), 0
        for c in raw.iloc[i]:
            c = clean(c)
            if c is None:
                continue
            if as_date(c):
                dates += 1
            elif ALIAS.get(norm_header(c)):
                fields.add(ALIAS[norm_header(c)])
        if "student_id" in fields and (len(fields) >= 2 or dates >= 3) and len(fields) + (dates >= 3) > best_score:
            best, best_score = i, len(fields) + (dates >= 3)
    return best


def guess_dept_sem(s):
    """Best-effort split of a compound class string like 'CSE Sem 3' or 'ECE-3A' into (dept, sem)."""
    if not s:
        return None, None
    m = re.match(r"\s*([A-Za-z]{2,8})\b", s)
    dept = m.group(1).upper() if m and compact(m.group(1)) not in ("sem", "semester", "class", "section", "sec", "batch", "year") else None
    try:
        return dept, sem_num(s)
    except ValueError:
        return dept, None


def compose_class(base, sec, dept, sem):
    if base and sec:
        return base if compact(base).endswith(compact(sec)) else f"{base}-{sec}"
    if base:
        return base
    if sec:
        return f"{dept}-{sem}{sec}" if dept and sem else sec
    return None


def parse_sheet(name, raw):
    rep = {"sheet": name, "header_row": None, "layout": None, "columns": {}, "context": {}, "dates": 0, "rows": 0, "skipped": None}
    h = find_header(raw)
    if h is None:
        rep["skipped"] = "no header row with a USN / Roll No column found"
        return [], rep
    rep["header_row"] = h + 1
    cols, scales, dates = {}, {}, []
    for j, c in enumerate(raw.iloc[h]):
        c = clean(c)
        if c is None:
            continue
        d = as_date(c)
        if d:
            dates.append((j, d))
            continue
        f = ALIAS.get(norm_header(c))
        if f and f not in cols:
            cols[f] = j
            rep["columns"][f] = str(c)
            if f in SCHEME:  # header like "CIE1 (50)": rescale to the real maximum
                m = re.search(r"\(\s*(?:max\.?|out of|/)?\s*(\d+(?:\.\d+)?)\s*(?:marks?)?\s*\)", str(c), re.I)
                if m and float(m.group(1)) > 0 and float(m.group(1)) != SCHEME[f]:
                    scales[f] = SCHEME[f] / float(m.group(1))
    ctx = {}
    for i in range(h):  # title rows above the header
        for c in raw.iloc[i]:
            c = clean(c)
            if isinstance(c, str):
                for m in CTX.finditer(c):
                    ctx.setdefault(CTX_KEYS[compact(m.group(1))], m.group(2).strip())
    rep["context"], rep["dates"] = ctx, len(dates)
    rep["layout"] = "attendance register" if dates else "marks / attendance table"
    label = name.strip()
    usable_label = None if re.fullmatch(r"sheet\s*\d*", label, re.I) else label  # "Sheet1" says nothing

    rows = []
    for i in range(h + 1, len(raw)):
        cells = [clean(c) for c in raw.iloc[i]]
        if not any(v is not None for v in cells):
            continue

        def get(f):
            j = cols.get(f)
            return cells[j] if j is not None and j < len(cells) else None

        sid = get("student_id")
        if sid is not None and SUMMARY.match(str(sid)):
            continue  # a total/average/max-marks row can put its label in the id column
        if sid is None:
            nm = get("name")
            if nm is None or SUMMARY.match(str(nm)):
                continue  # blank id: totals / averages / max-marks rows
            rows.append({"_sheet": name, "_row": i + 1, "_error": "USN / Roll No is missing"})
            continue
        item = {"_sheet": name, "_row": i + 1, "student_id": str(sid), "_has": set()}
        try:
            if get("name") is not None:
                item["name"] = str(get("name"))
            subject = str(get("subject")) if get("subject") is not None else ctx.get("subject")
            sec = str(get("section")) if get("section") is not None else ctx.get("section")
            base = str(get("class_name")) if get("class_name") is not None else ctx.get("class_name")
            if subject and not (base or sec):
                base = usable_label  # the tab is named after the class / section
            # (no guess the other way: a tab alongside a known class/section usually repeats that
            # class's name, not a subject's; a genuinely subject-less sheet is rejected below instead.)
            if subject:
                item["subject"] = subject[:80]

            dept = str(get("department")) if get("department") is not None else ctx.get("department")
            sem_raw = get("semester") if get("semester") is not None else ctx.get("semester")
            sem = sem_num(sem_raw) if sem_raw is not None else None
            if dept is None or sem is None:  # "CSE Sem 3" etc: pull what a compound class string implies
                for s in (base, sec):
                    gd, gs = guess_dept_sem(s)
                    dept, sem = dept or gd, sem if sem is not None else gs
            if dept:
                item["department"] = dept
            if sem is not None:
                item["semester"] = sem
            batch = str(get("batch")) if get("batch") is not None else ctx.get("batch")
            if batch:
                item["batch"] = batch
                item["_has"].add("batch")
            cls = compose_class(base, sec, dept, sem)
            if cls:
                item["class_name"] = cls[:60]
                if base:  # a bare section letter is too thin to trust over an existing record's class
                    item["_has"].add("class_name")
            for k in SCHEME:
                if k in cols:
                    item[k] = score(get(k), scales.get(k, 1), k.upper())
                    item["_has"].add(k)
            if dates:
                days = [(d, token(cells[j])) for j, d in dates if j < len(cells)]
                item["_days"] = [(d, int(t)) for d, t in days if t is not None]
            else:
                a, held, pct = get("attended"), get("held"), get("attendance_pct")
                if a is not None and held is not None:
                    item["attended"], item["total"] = int(round(number(a, "attended"))), int(round(number(held, "total classes")))
                elif pct is not None:
                    m = re.fullmatch(r"(\d+)\s*/\s*(\d+)", str(pct).strip())
                    if m:  # "34/40"
                        item["attended"], item["total"] = int(m.group(1)), int(m.group(2))
                    else:
                        p = number(pct, "attendance")
                        p = p * 100 if p <= 1 else p  # Excel percent cells arrive as 0.85
                        item["attended"], item["total"] = int(round(p)), 100  # percent only: stored out of 100
                if "attended" in item:
                    item["_has"] |= {"attended", "total"}
        except ValueError as e:
            rows.append({"_sheet": name, "_row": i + 1, "_error": str(e)})
            continue
        rows.append(item)
    return rows, rep


def read_sheets(data):
    """{sheet name: DataFrame of raw cells}. Every tab, hidden or not."""
    if data[:2] == b"PK":
        try:
            return pd.read_excel(io.BytesIO(data), sheet_name=None, header=None, dtype=object)
        except Exception:
            raise ValueError("could not read this Excel file; save it again as .xlsx")
    if data[:4] == b"\xd0\xcf\x11\xe0":
        raise ValueError("old .xls files are not supported; save as .xlsx or .csv")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("cp1252")
    if re.match(r"\s*<(!doctype|html)", text[:300], re.I):
        raise ValueError("this is a web page, not a spreadsheet: the link is private, expired or not a file link (share it as 'Anyone with the link can view')")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    table = list(csv.reader(io.StringIO(text), dialect))
    width = max((len(r) for r in table), default=0)
    if not width:
        raise ValueError("the file is empty")
    return {"Sheet1": pd.DataFrame([r + [None] * (width - len(r)) for r in table], dtype=object)}


def parse_workbook(data):
    """(rows, per-sheet reports). Rows carry _sheet/_row and either fields or an _error."""
    sheets = read_sheets(data)
    rows, reports = [], []
    for name, raw in list(sheets.items())[:MAX_SHEETS]:
        r, rep = parse_sheet(str(name), raw)
        rep["rows"] = len(r)
        rows += r
        reports.append(rep)
        if len(rows) > MAX_ROWS:
            raise ValueError(f"more than {MAX_ROWS} rows in one file; split it")
    return rows, reports
