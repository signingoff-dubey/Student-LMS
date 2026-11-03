import hashlib
import os
import secrets
import sqlite3
import threading
import time
from collections import Counter
from functools import wraps
from pathlib import Path

import pandas as pd
from flask import Flask, g, jsonify, request
from itsdangerous import BadSignature, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

import ingest
import links
from scheme import BANDS, RULES, SCHEME, evaluate, percent, totals

DB = Path(os.environ.get("STUDENTS_DB") or Path(__file__).with_name("students.db"))
TOKEN_AGE = 12 * 3600
SYNC_EVERY = int(os.environ.get("SYNC_INTERVAL", "60"))
MAX_BYTES = 10 * 1024 * 1024
# Teachers may only connect share links on these hosts (SSRF guard). Extend via env, comma-separated.
HOSTS = {"docs.google.com", "onedrive.live.com", "1drv.ms"} | set(filter(None, os.environ.get("ALLOWED_SOURCE_HOSTS", "").split(",")))
REQUIRED = ["student_id", "name", "department", "semester", "class_name", "subject"]
SCORES = list(SCHEME)  # cie1, cie2, cie3, see
COLS = REQUIRED + SCORES + ["marks", "attended", "total"]

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_BYTES


def db():
    con = sqlite3.connect(DB, timeout=10)
    con.row_factory = sqlite3.Row
    return con


def secret():
    if os.environ.get("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    p = DB.with_name("secret.key")
    if not p.exists():
        p.write_text(secrets.token_hex(32))
    return p.read_text()


def init_db():
    with db() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY, pw_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('admin','teacher','student')), name TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS classes (
                name TEXT PRIMARY KEY, teacher TEXT REFERENCES users(username));
            -- One row per student per subject: marks and attendance live together.
            CREATE TABLE IF NOT EXISTS records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id TEXT NOT NULL, name TEXT NOT NULL, department TEXT NOT NULL,
                semester INTEGER NOT NULL, class_name TEXT NOT NULL REFERENCES classes(name),
                subject TEXT NOT NULL,
                -- Component maxima mirror scheme.py. NULL = not assessed yet.
                cie1 REAL CHECK (cie1 BETWEEN 0 AND 25), cie2 REAL CHECK (cie2 BETWEEN 0 AND 20),
                cie3 REAL CHECK (cie3 BETWEEN 0 AND 25), see REAL CHECK (see BETWEEN 0 AND 30),
                marks REAL CHECK (marks BETWEEN 0 AND 100),  -- percent over assessed components (scheme.percent)
                attended INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
                CHECK (attended BETWEEN 0 AND total),
                UNIQUE (student_id, subject));
            CREATE TABLE IF NOT EXISTS sources (
                id INTEGER PRIMARY KEY AUTOINCREMENT, location TEXT NOT NULL,
                owner TEXT NOT NULL REFERENCES users(username),
                last_hash TEXT, last_sync REAL, status TEXT NOT NULL DEFAULT 'never synced');
            """
        )
        cols = {r["name"] for r in con.execute("PRAGMA table_info(records)")}
        if "batch" not in cols:  # added after the first release; migrate in place
            con.execute("ALTER TABLE records ADD COLUMN batch TEXT NOT NULL DEFAULT ''")
        if not con.execute("SELECT 1 FROM users WHERE role='admin'").fetchone():
            pw = os.environ.get("ADMIN_PASSWORD") or secrets.token_urlsafe(9)
            con.execute("INSERT INTO users VALUES ('admin', ?, 'admin', 'Administrator')", (generate_password_hash(pw),))
            if not os.environ.get("ADMIN_PASSWORD"):
                print(f"*** First run: admin login is admin / {pw}  (shown once) ***", flush=True)


init_db()
SER = URLSafeTimedSerializer(secret())


# ---------- auth ----------
def auth(*roles):
    def deco(f):
        @wraps(f)
        def wrapper(*a, **k):
            try:
                name = SER.loads(request.headers.get("Authorization", "").removeprefix("Bearer "), max_age=TOKEN_AGE)
            except BadSignature:
                return jsonify(error="login required"), 401
            row = db().execute("SELECT * FROM users WHERE username=?", (name,)).fetchone()
            if not row:
                return jsonify(error="login required"), 401
            if roles and row["role"] not in roles:
                return jsonify(error="not allowed"), 403
            g.user = dict(row)
            return f(*a, **k)

        return wrapper

    return deco


@app.post("/api/login")
def login():
    d = request.get_json(silent=True) or {}
    user, pw = str(d.get("username", "")).strip(), str(d.get("password", ""))
    with db() as con:
        row = con.execute("SELECT * FROM users WHERE username=?", (user,)).fetchone()
        if not row:
            # Student accounts are created lazily: first login with student_id as password.
            rec = con.execute("SELECT name FROM records WHERE student_id=?", (user,)).fetchone()
            if rec and pw == user:
                con.execute("INSERT INTO users VALUES (?,?, 'student', ?)", (user, generate_password_hash(pw), rec["name"]))
                row = con.execute("SELECT * FROM users WHERE username=?", (user,)).fetchone()
    if not row or not check_password_hash(row["pw_hash"], pw):
        return jsonify(error="wrong username or password"), 401
    return jsonify(token=SER.dumps(row["username"]), username=row["username"], role=row["role"], name=row["name"])


@app.get("/api/me")
@auth()
def me():
    u = g.user
    return jsonify(username=u["username"], role=u["role"], name=u["name"])


@app.post("/api/password")
@auth()
def change_password():
    d = request.get_json(silent=True) or {}
    new = str(d.get("new", ""))
    if not check_password_hash(g.user["pw_hash"], str(d.get("old", ""))):
        return jsonify(error="current password is wrong"), 400
    if len(new) < 6:
        return jsonify(error="new password needs 6+ characters"), 400
    with db() as con:
        con.execute("UPDATE users SET pw_hash=? WHERE username=?", (generate_password_hash(new), g.user["username"]))
    return jsonify(ok=True)


# ---------- access scope ----------
def scope(user):
    """SQL WHERE fragment limiting records to what this role may see."""
    if user["role"] == "admin":
        return "1=1", []
    if user["role"] == "teacher":
        return "class_name IN (SELECT name FROM classes WHERE teacher=?)", [user["username"]]
    return "student_id=?", [user["username"]]


class Reject(Exception):
    def __init__(self, msg, status=400):
        super().__init__(msg)
        self.msg, self.status = msg, status


def claim_class(con, user, name):
    """Create the class (owned by a teacher uploader) or verify the teacher owns it."""
    row = con.execute("SELECT teacher FROM classes WHERE name=?", (name,)).fetchone()
    if row is None:
        con.execute("INSERT INTO classes VALUES (?,?)", (name, user["username"] if user["role"] == "teacher" else None))
    elif user["role"] == "teacher" and row["teacher"] != user["username"]:
        raise Reject(f"class {name} belongs to another teacher", 403)


def parse(d):
    """Validate one row at the trust boundary; returns (row, error)."""
    try:
        r = {f: str(d[f]).strip() for f in REQUIRED}
        if not all(r.values()):
            raise ValueError("all fields required")
        r["semester"] = int(float(r["semester"]))
        for k, mx in SCHEME.items():
            v = d.get(k)
            r[k] = None if v is None or str(v).strip() == "" else float(v)
            if r[k] is not None and not 0 <= r[k] <= mx:
                raise ValueError(f"{k} must be 0-{mx}")
        r["marks"] = percent(r)
        r["attended"] = int(float(d.get("attended") or 0))
        r["total"] = int(float(d.get("total") or 0))
        if not 0 <= r["attended"] <= r["total"]:
            raise ValueError("attended must be between 0 and total")
        return r, None
    except (KeyError, ValueError, TypeError) as e:
        return None, f"invalid row: {e}"


def save(con, user, r, rid=None, upsert=False, cols=COLS):
    """Insert/update one record, enforcing the teacher's class ownership."""
    staff = con.execute("SELECT 1 FROM users WHERE username=? AND role!='student'", (r["student_id"],)).fetchone()
    if staff:
        raise Reject("student_id clashes with a staff username")
    claim_class(con, user, r["class_name"])
    old = con.execute("SELECT id, class_name FROM records WHERE student_id=? AND subject=?", (r["student_id"], r["subject"])).fetchone()
    if old and old["id"] != rid:
        if not upsert:
            raise Reject("duplicate student_id + subject", 409)
        claim_class(con, user, old["class_name"])  # may not overwrite another teacher's row
    if rid is not None:
        sets = ",".join(f"{c}=?" for c in COLS)
        con.execute(f"UPDATE records SET {sets} WHERE id=?", [r[c] for c in COLS] + [rid])
    else:
        # An import only touches the columns its sheet carries (e.g. no attendance columns -> attendance kept).
        upd = ",".join(f"{c}=excluded.{c}" for c in cols if c not in ("student_id", "subject"))
        con.execute(
            f"INSERT INTO records ({','.join(cols)}) VALUES ({','.join('?' * len(cols))}) "
            f"ON CONFLICT(student_id, subject) DO UPDATE SET {upd}",
            [r[c] for c in cols],
        )


# ---------- records ----------
@app.get("/api/records")
@auth()
def list_records():
    where, params = scope(g.user)
    q = f"%{request.args.get('q', '')}%"
    rows = db().execute(
        f"SELECT * FROM records WHERE ({where}) AND (student_id LIKE ? OR name LIKE ? OR department LIKE ? OR subject LIKE ? OR class_name LIKE ?) ORDER BY id DESC",
        params + [q] * 5,
    ).fetchall()
    return jsonify([decorate(dict(r)) for r in rows])


def decorate(r):
    """Add derived score fields so clients never recompute the scheme."""
    r["obtained"], r["out_of"] = totals(r)
    r.update(evaluate(r))  # result, reasons, grade, cie_total, attendance_pct
    return r


@app.get("/api/scheme")
def scheme():
    return jsonify(components=SCHEME, bands=[{"min": lo, "grade": g_} for lo, g_ in BANDS], rules=RULES)


def write_record(rid=None):
    r, err = parse(request.get_json(silent=True) or {})
    if err:
        return jsonify(error=err), 400
    try:
        with db() as con:
            if rid is not None:
                where, params = scope(g.user)
                if not con.execute(f"SELECT 1 FROM records WHERE id=? AND ({where})", [rid] + params).fetchone():
                    return jsonify(error="record not found"), 404
            save(con, g.user, r, rid)
    except Reject as e:
        return jsonify(error=e.msg), e.status
    except sqlite3.IntegrityError:
        return jsonify(error="duplicate student_id + subject"), 409
    return jsonify(ok=True)


@app.post("/api/records")
@auth("admin", "teacher")
def add():
    return write_record()


@app.put("/api/records/<int:rid>")
@auth("admin", "teacher")
def update(rid):
    return write_record(rid)


@app.delete("/api/records/<int:rid>")
@auth("admin", "teacher")
def delete(rid):
    where, params = scope(g.user)
    with db() as con:
        con.execute(f"DELETE FROM records WHERE id=? AND ({where})", [rid] + params)
    return jsonify(ok=True)


@app.get("/api/reports")
@auth()
def reports():
    where, params = scope(g.user)
    df = pd.read_sql(f"SELECT * FROM records WHERE {where}", db(), params=params)
    if df.empty:
        return jsonify(average=None, attendance=None, topper=None, pass_rate=None, grades={}, components=[], subjects=[], departments=[], classes=[])

    def att(d):
        t = d.total.sum()
        return round(100 * d.attended.sum() / t, 1) if t else None

    def avg(s):  # NaN is not valid JSON, so unscored groups give None
        return round(float(s.mean()), 2) if s.notna().any() else None

    def by(col):
        return [{col: k, "average": avg(d.marks), "attendance": att(d)} for k, d in df.groupby(col)]

    topper = None
    ps = df.groupby(["student_id", "name"], as_index=False).marks.mean().dropna()
    if g.user["role"] != "student" and not ps.empty:
        t = ps.loc[ps.marks.idxmax()]
        topper = {"student_id": t.student_id, "name": t["name"], "average": round(float(t.marks), 2)}
    evs = [evaluate(rec) for rec in df.to_dict("records")]
    decided = [e["result"] for e in evs if e["result"] != "pending"]
    comps = [{"key": k, "label": k.upper(), "max": mx, "average": avg(df[k])} for k, mx in SCHEME.items()]
    for c_ in comps:
        c_["percent"] = None if c_["average"] is None else round(100 * c_["average"] / c_["max"], 1)
    return jsonify(
        average=avg(df.marks),
        attendance=att(df),
        topper=topper,
        pass_rate=round(100 * decided.count("pass") / len(decided), 1) if decided else None,
        results=dict(Counter(e["result"] for e in evs)),
        grades=dict(Counter(e["grade"] for e in evs if e["grade"])),
        components=comps,
        subjects=by("subject"),
        departments=by("department"),
        classes=by("class_name"),
    )


# ---------- admin: teachers and classes ----------
@app.get("/api/users")
@auth("admin")
def list_users():
    rows = db().execute("SELECT username, role, name FROM users WHERE role!='student' ORDER BY role, username").fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/users")
@auth("admin")
def add_teacher():
    d = request.get_json(silent=True) or {}
    user, name, pw = (str(d.get(k, "")).strip() for k in ("username", "name", "password"))
    if not (user and name and len(pw) >= 6):
        return jsonify(error="username, name and a 6+ character password are required"), 400
    try:
        with db() as con:
            con.execute("INSERT INTO users VALUES (?,?, 'teacher', ?)", (user, generate_password_hash(pw), name))
    except sqlite3.IntegrityError:
        return jsonify(error="username already exists"), 409
    return jsonify(ok=True)


@app.delete("/api/users/<username>")
@auth("admin")
def delete_teacher(username):
    with db() as con:
        if con.execute("DELETE FROM users WHERE username=? AND role='teacher'", (username,)).rowcount:
            for t in ("classes", "courses", "slots"):
                con.execute(f"UPDATE {t} SET teacher=NULL WHERE teacher=?", (username,))
            con.execute("DELETE FROM sources WHERE owner=?", (username,))
            con.execute("DELETE FROM announcements WHERE author=?", (username,))
            con.execute("DELETE FROM profiles WHERE username=?", (username,))
    return jsonify(ok=True)


@app.get("/api/classes")
@auth("admin", "teacher")
def list_classes():
    sql = """SELECT c.name, c.teacher, u.name AS teacher_name,
        (SELECT COUNT(DISTINCT student_id) FROM records r WHERE r.class_name=c.name) AS students,
        (SELECT ROUND(AVG(marks),2) FROM records r WHERE r.class_name=c.name) AS average
        FROM classes c LEFT JOIN users u ON u.username=c.teacher"""
    if g.user["role"] == "admin":
        rows = db().execute(sql + " ORDER BY c.name").fetchall()
    else:
        rows = db().execute(sql + " WHERE c.teacher=? ORDER BY c.name", (g.user["username"],)).fetchall()
    return jsonify([dict(r) for r in rows])


@app.delete("/api/classes/<name>")
@auth("admin")
def delete_class(name):
    with db() as con:
        if con.execute("SELECT 1 FROM records WHERE class_name=?", (name,)).fetchone():
            return jsonify(error="class still has records; delete or move them first"), 409
        con.execute("DELETE FROM slots WHERE class_name=?", (name,))
        con.execute("DELETE FROM announcements WHERE class_name=?", (name,))
        con.execute("DELETE FROM classes WHERE name=?", (name,))
    return jsonify(ok=True)


@app.put("/api/classes/<name>")
@auth("admin")
def assign_class(name):
    teacher = (request.get_json(silent=True) or {}).get("teacher") or None
    with db() as con:
        if teacher and not con.execute("SELECT 1 FROM users WHERE username=? AND role='teacher'", (teacher,)).fetchone():
            return jsonify(error="no such teacher"), 400
        con.execute("INSERT INTO classes VALUES (?,?) ON CONFLICT(name) DO UPDATE SET teacher=excluded.teacher", (name, teacher))
    return jsonify(ok=True)


# ---------- excel / csv import ----------
# A sheet rarely carries every field on every row (one sheet has this week's CIE1, another the
# attendance register, a "master" sheet has name/department/class). build_row fills in anything
# the current sheet omits from the student's existing record, so partial sheets merge instead of
# wiping out what an earlier upload already set.
def build_row(con, item):
    r = {k: v for k, v in item.items() if not k.startswith("_")}
    has = item.get("_has", set())
    same_subject = con.execute("SELECT * FROM records WHERE student_id=? AND subject=?", (r["student_id"], r.get("subject"))).fetchone() if r.get("subject") else None
    # A different subject's row, preferred over same_subject here: if same_subject's own class_name
    # was itself a thin guess, falling back to it would just repeat the mistake instead of fixing it.
    other_subject = con.execute("SELECT * FROM records WHERE student_id=? AND subject!=? ORDER BY id LIMIT 1", (r["student_id"], r.get("subject") or "")).fetchone()
    any_subject = other_subject or same_subject
    for f in ("name", "department", "semester", "class_name"):
        # Identity fields are set once per student+subject and then locked: a later, partial sheet
        # (e.g. an attendance register that only knows the section) must not downgrade them. class_name
        # is stricter still: a bare section letter (not in `has`) never outranks the student's known class,
        # since in practice one student sits in one section across every subject of a semester.
        thin = f == "class_name" and f not in has
        if same_subject and same_subject[f] not in (None, "") and not thin:
            r[f] = same_subject[f]
        elif (r.get(f) in (None, "") or thin) and any_subject and any_subject[f] not in (None, ""):
            r[f] = any_subject[f]
    missing = [f for f in REQUIRED if r.get(f) in (None, "")]
    if missing:
        raise Reject(f"missing {', '.join(missing)} (not in the sheet, and no earlier record for {r['student_id']} to copy it from)")
    r["semester"] = int(r["semester"])
    for k in SCHEME:
        if k not in has:
            r[k] = same_subject[k] if same_subject else None
    r["marks"] = percent(r)
    if "attended" in has:
        pass
    elif item.get("_days"):
        r["attended"], r["total"] = sum(v for _, v in item["_days"]), len(item["_days"])
    elif same_subject:
        r["attended"], r["total"] = same_subject["attended"], same_subject["total"]
    else:
        r["attended"], r["total"] = 0, 0
    r["attended"], r["total"] = int(r["attended"]), int(r["total"])
    if not 0 <= r["attended"] <= r["total"]:
        raise Reject("attended must be between 0 and total")
    return r


def import_data(user, data):
    """Parse every sheet/tab in the workbook and upsert each valid row; report rejects per sheet+row."""
    try:
        items, sheet_reports = ingest.parse_workbook(data)
    except ValueError as e:
        raise Reject(str(e))
    saved, rejected = 0, []
    with db() as con:
        for item in items:
            loc = f"{item['_sheet']} / row {item['_row']}"
            if item.get("_error"):
                rejected.append({"row": loc, "reason": item["_error"]})
                continue
            try:
                r = build_row(con, item)
                save(con, user, r, upsert=True)
                if item.get("batch"):
                    con.execute("UPDATE records SET batch=? WHERE student_id=? AND subject=?", (item["batch"], r["student_id"], r["subject"]))
            except Reject as e:
                rejected.append({"row": loc, "reason": e.msg})
                continue
            saved += 1
    return {"saved": saved, "rejected_count": len(rejected), "rejected": rejected[:50], "sheets": sheet_reports}


@app.post("/api/import")
@auth("admin", "teacher")
def import_file():
    f = request.files.get("file")
    if not f:
        return jsonify(error="attach a file field named 'file'"), 400
    try:
        return jsonify(import_data(g.user, f.read()))
    except Reject as e:
        return jsonify(error=e.msg), e.status


# ---------- connected sheets (re-synced in the background) ----------
def fetch(location):
    try:
        return links.fetch(location, HOSTS, MAX_BYTES)
    except links.LinkError as e:
        raise Reject(str(e))


def sync_source(sid):
    with db() as con:
        src = con.execute("SELECT * FROM sources WHERE id=?", (sid,)).fetchone()
        owner = src and con.execute("SELECT * FROM users WHERE username=?", (src["owner"],)).fetchone()
    if not owner:
        return {"status": "source or owner missing"}
    try:
        data = fetch(src["location"])
        digest = hashlib.sha256(data).hexdigest()
        if digest == src["last_hash"]:
            status, result = "unchanged", {}
        else:
            result = import_data(dict(owner), data)
            status = f"synced {result['saved']} rows, {result['rejected_count']} rejected"
        new_hash = digest
    except Reject as e:
        status, result, new_hash = f"error: {e.msg}", {}, src["last_hash"]
    except Exception as e:  # network, file missing, etc. The poller must never die
        status, result, new_hash = f"error: {type(e).__name__}", {}, src["last_hash"]
    with db() as con:
        con.execute("UPDATE sources SET last_hash=?, last_sync=?, status=? WHERE id=?", (new_hash, time.time(), status, sid))
    return {"status": status, **result}


def poller():
    while True:
        time.sleep(SYNC_EVERY)
        for r in db().execute("SELECT id FROM sources").fetchall():
            sync_source(r["id"])


@app.get("/api/sources")
@auth("admin", "teacher")
def list_sources():
    q, p = ("SELECT * FROM sources", []) if g.user["role"] == "admin" else ("SELECT * FROM sources WHERE owner=?", [g.user["username"]])
    return jsonify([{k: v for k, v in dict(r).items() if k != "last_hash"} for r in db().execute(q, p).fetchall()])


@app.post("/api/sources")
@auth("admin", "teacher")
def add_source():
    loc = str((request.get_json(silent=True) or {}).get("location", "")).strip()
    if not loc:
        return jsonify(error="location required"), 400
    is_url = re.match(r"https?://", loc)
    if not is_url and (g.user["role"] != "admin" or not loc.lower().endswith((".xlsx", ".csv"))):
        return jsonify(error="only admin may connect a server file path (.xlsx/.csv); teachers use a share link"), 403
    with db() as con:
        sid = con.execute("INSERT INTO sources (location, owner) VALUES (?,?)", (loc, g.user["username"])).lastrowid
    return jsonify(id=sid, **sync_source(sid))


def own_source(sid):
    row = db().execute("SELECT owner FROM sources WHERE id=?", (sid,)).fetchone()
    return row and (g.user["role"] == "admin" or row["owner"] == g.user["username"])


@app.post("/api/sources/<int:sid>/sync")
@auth("admin", "teacher")
def sync_now(sid):
    if not own_source(sid):
        return jsonify(error="not found"), 404
    return jsonify(sync_source(sid))


@app.delete("/api/sources/<int:sid>")
@auth("admin", "teacher")
def delete_source(sid):
    if not own_source(sid):
        return jsonify(error="not found"), 404
    with db() as con:
        con.execute("DELETE FROM sources WHERE id=?", (sid,))
    return jsonify(ok=True)


import extras  # noqa: E402

import mentoring  # noqa: E402

extras.register(app, db, auth, scope, decorate)
mentoring.register(app, db, auth)

if __name__ == "__main__":
    threading.Thread(target=poller, daemon=True).start()
    app.run(port=5000)  # no reloader: it would start the poller twice
