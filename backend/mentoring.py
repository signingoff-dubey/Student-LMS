"""Mentor messaging, mentor session booking and teacher leave.

A student's mentor is the explicit assignment in `mentors`, else the teacher of their class.
"""
import re
import time
from datetime import date, datetime, timedelta

from flask import g, jsonify, request

HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
QUOTA = {"casual": 12, "sick": 10, "earned": 15, "other": None}  # days per calendar year; other = unlimited
ACTIVE_LEAVE = ("pending", "approved")


def register(app, db, auth):
    with db() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS mentors (student_id TEXT PRIMARY KEY, teacher TEXT NOT NULL REFERENCES users(username));
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT NOT NULL, recipient TEXT NOT NULL,
                body TEXT NOT NULL, created REAL NOT NULL, read INTEGER NOT NULL DEFAULT 0);
            CREATE INDEX IF NOT EXISTS messages_pair ON messages (recipient, sender);
            CREATE TABLE IF NOT EXISTS mentor_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL, mentor TEXT NOT NULL REFERENCES users(username),
                session_date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, duration INTEGER NOT NULL,
                topic TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'requested'
                    CHECK (status IN ('requested','confirmed','declined','cancelled','completed')));
            CREATE TABLE IF NOT EXISTS leaves (
                id INTEGER PRIMARY KEY AUTOINCREMENT, teacher TEXT NOT NULL REFERENCES users(username),
                type TEXT NOT NULL CHECK (type IN ('casual','sick','earned','other')),
                from_date TEXT NOT NULL, to_date TEXT NOT NULL, days INTEGER NOT NULL, reason TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
                decided_note TEXT NOT NULL DEFAULT '', created REAL NOT NULL);
            """
        )

    def rows(sql, params=()):
        return [dict(r) for r in db().execute(sql, params).fetchall()]

    def body():
        return request.get_json(silent=True) or {}

    def bad(msg, status=400):
        return jsonify(error=msg), status

    def text(d, key, maxlen, required=False):
        v = str(d.get(key) or "").strip()
        if len(v) > maxlen:
            raise ValueError(f"{key} is too long (max {maxlen})")
        if required and not v:
            raise ValueError(f"{key} is required")
        return v

    def day(d, key):
        try:
            return datetime.strptime(str(d.get(key)), "%Y-%m-%d").date()
        except ValueError:
            raise ValueError(f"{key} must be a date like 2026-11-30")

    def overlap(a0, a1, b0, b1):
        return a0 < b1 and a1 > b0  # "HH:MM" strings compare correctly

    # ---------- mentors ----------
    def mentor_of(con, sid):
        r = con.execute("SELECT teacher FROM mentors WHERE student_id=?", (sid,)).fetchone()
        if r:
            return r["teacher"]
        r = con.execute("SELECT c.teacher FROM records r JOIN classes c ON c.name=r.class_name WHERE r.student_id=? AND c.teacher IS NOT NULL LIMIT 1", (sid,)).fetchone()
        return r["teacher"] if r else None

    MENTEES = """SELECT r.student_id, MIN(r.name) AS name, MIN(r.class_name) AS class_name, r.student_id AS username
        FROM records r LEFT JOIN mentors m ON m.student_id=r.student_id LEFT JOIN classes c ON c.name=r.class_name
        WHERE COALESCE(m.teacher, c.teacher)=? GROUP BY r.student_id ORDER BY name"""

    @app.get("/api/mentor")
    @auth("student")
    def my_mentor():
        t = mentor_of(db(), g.user["username"])
        row = t and db().execute(
            "SELECT u.username, u.name, COALESCE(p.email,'') AS email FROM users u LEFT JOIN profiles p ON p.username=u.username WHERE u.username=?", (t,)
        ).fetchone()
        return jsonify(dict(row)) if row else bad("no mentor assigned yet", 404)

    @app.get("/api/mentees")
    @auth("teacher")
    def mentees():
        return jsonify(rows(MENTEES, (g.user["username"],)))

    @app.get("/api/mentors")
    @auth("admin")
    def mentor_assignments():
        return jsonify(
            rows(
                """SELECT r.student_id, MIN(r.name) AS name, COALESCE(m.teacher, c.teacher) AS mentor,
                   u.name AS mentor_name, m.teacher IS NOT NULL AS explicit
                   FROM records r LEFT JOIN mentors m ON m.student_id=r.student_id LEFT JOIN classes c ON c.name=r.class_name
                   LEFT JOIN users u ON u.username=COALESCE(m.teacher, c.teacher)
                   GROUP BY r.student_id ORDER BY name"""
            )
        )

    @app.put("/api/mentors/<sid>")
    @auth("admin")
    def assign_mentor(sid):
        teacher = body().get("teacher") or None
        with db() as con:
            if not con.execute("SELECT 1 FROM records WHERE student_id=?", (sid,)).fetchone():
                return bad("no such student", 404)
            if teacher is None:
                con.execute("DELETE FROM mentors WHERE student_id=?", (sid,))
            elif not con.execute("SELECT 1 FROM users WHERE username=? AND role='teacher'", (teacher,)).fetchone():
                return bad("no such teacher")
            else:
                con.execute("INSERT INTO mentors VALUES (?,?) ON CONFLICT(student_id) DO UPDATE SET teacher=excluded.teacher", (sid, teacher))
        return jsonify(ok=True)

    # ---------- messages (mentor <-> mentee only) ----------
    def peer_ok(con, me, other):
        if me["role"] == "student":
            return mentor_of(con, me["username"]) == other
        if me["role"] == "teacher":
            return mentor_of(con, other) == me["username"]
        return False

    @app.post("/api/messages")
    @auth("student", "teacher")
    def send_message():
        d = body()
        try:
            to, msg = text(d, "to", 40, True), text(d, "body", 2000, True)
        except ValueError as e:
            return bad(str(e))
        with db() as con:
            if not peer_ok(con, g.user, to):
                return bad("you can only message your mentor or your mentees", 403)
            con.execute("INSERT INTO messages (sender,recipient,body,created) VALUES (?,?,?,?)", (g.user["username"], to, msg, time.time()))
        return jsonify(ok=True)

    @app.get("/api/messages")
    @auth("student", "teacher")
    def thread():
        other, me = request.args.get("with", ""), g.user["username"]
        with db() as con:
            if not peer_ok(con, g.user, other):
                return bad("you can only message your mentor or your mentees", 403)
            con.execute("UPDATE messages SET read=1 WHERE recipient=? AND sender=?", (me, other))
        return jsonify(
            rows(
                "SELECT id, sender, recipient, body, created FROM messages WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?) ORDER BY id",
                (me, other, other, me),
            )
        )

    @app.get("/api/conversations")
    @auth("student", "teacher")
    def conversations():
        me = g.user["username"]
        if g.user["role"] == "student":
            m = db().execute("SELECT username, name FROM users WHERE username=?", (mentor_of(db(), me),)).fetchone()
            peers = [{"username": m["username"], "name": m["name"]}] if m else []
        else:
            peers = [{"username": r["student_id"], "name": r["name"]} for r in rows(MENTEES, (me,))]
        out = []
        for p in peers:
            last = db().execute(
                "SELECT body, created FROM messages WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?) ORDER BY id DESC LIMIT 1",
                (me, p["username"], p["username"], me),
            ).fetchone()
            unread = db().execute("SELECT COUNT(*) FROM messages WHERE recipient=? AND sender=? AND read=0", (me, p["username"])).fetchone()[0]
            out.append({"with": p["username"], "name": p["name"], "last_body": last and last["body"], "last_at": last and last["created"], "unread": unread})
        out.sort(key=lambda c: c["last_at"] or 0, reverse=True)
        return jsonify(out)

    # ---------- mentor sessions ----------
    SESS_SQL = """SELECT s.id, s.student_id, (SELECT MIN(name) FROM records r WHERE r.student_id=s.student_id) AS student_name,
        s.mentor, u.name AS mentor_name, s.session_date AS date, s.start_time, s.end_time, s.duration, s.topic, s.status, s.note, s.created
        FROM mentor_sessions s JOIN users u ON u.username=s.mentor"""

    def busy_blocks(con, mentor, d, exclude=0):
        """Everything that makes the mentor unavailable on date d, as (start, end, kind)."""
        lessons = con.execute("SELECT start_time, end_time FROM slots WHERE teacher=? AND day=?", (mentor, d.weekday())).fetchall()
        sess = con.execute(
            "SELECT start_time, end_time FROM mentor_sessions WHERE mentor=? AND session_date=? AND status='confirmed' AND id!=?", (mentor, d.isoformat(), exclude)
        ).fetchall()
        return [(r[0], r[1], "lesson") for r in lessons] + [(r[0], r[1], "session") for r in sess]

    def on_leave(con, teacher, d):
        return bool(
            con.execute("SELECT 1 FROM leaves WHERE teacher=? AND status='approved' AND from_date<=? AND to_date>=?", (teacher, d.isoformat(), d.isoformat())).fetchone()
        )

    def conflict(con, mentor, d, start, end, exclude=0):
        if on_leave(con, mentor, d):
            return "your mentor is on leave that day"
        for b0, b1, kind in busy_blocks(con, mentor, d, exclude):
            if overlap(start, end, b0, b1):
                return "your mentor is teaching then" if kind == "lesson" else "that time is already booked"
        return None

    @app.get("/api/sessions")
    @auth()
    def sessions():
        u = g.user
        if u["role"] == "admin":
            where, params = "1=1", []
        elif u["role"] == "teacher":
            where, params = "s.mentor=?", [u["username"]]
        else:
            where, params = "s.student_id=?", [u["username"]]
        return jsonify(rows(f"{SESS_SQL} WHERE {where} ORDER BY s.session_date DESC, s.start_time DESC", params))

    @app.get("/api/sessions/busy")
    @auth("student")
    def busy():
        try:
            d = day(request.args, "date")
        except ValueError as e:
            return bad(str(e))
        with db() as con:
            mentor = mentor_of(con, g.user["username"])
            if not mentor:
                return bad("no mentor assigned yet", 404)
            return jsonify(
                mentor_on_leave=on_leave(con, mentor, d),
                busy=[{"start_time": a, "end_time": b, "kind": k} for a, b, k in sorted(busy_blocks(con, mentor, d))],
            )

    @app.post("/api/sessions")
    @auth("student")
    def book_session():
        dta = body()
        try:
            d, start, topic = day(dta, "date"), text(dta, "start_time", 5, True), text(dta, "topic", 200, True)
            duration = int(dta.get("duration"))
            if duration not in (30, 45, 60) or not HHMM.match(start):
                raise ValueError("start_time must be HH:MM and duration 30, 45 or 60")
        except (ValueError, TypeError) as e:
            return bad(str(e) if isinstance(e, ValueError) else "duration must be 30, 45 or 60")
        begin = datetime.combine(d, datetime.strptime(start, "%H:%M").time())
        if begin <= datetime.now():
            return bad("choose a time in the future")
        end = (begin + timedelta(minutes=duration)).strftime("%H:%M")
        if end <= start:
            return bad("a session cannot run past midnight")
        me = g.user["username"]
        with db() as con:
            mentor = mentor_of(con, me)
            if not mentor:
                return bad("no mentor assigned yet", 409)
            msg = conflict(con, mentor, d, start, end)
            if msg:
                return bad(msg, 409)
            mine = con.execute("SELECT start_time, end_time FROM mentor_sessions WHERE student_id=? AND session_date=? AND status IN ('requested','confirmed')", (me, d.isoformat())).fetchall()
            if any(overlap(start, end, r[0], r[1]) for r in mine):
                return bad("you already have a session at that time", 409)
            sid = con.execute(
                "INSERT INTO mentor_sessions (student_id,mentor,session_date,start_time,end_time,duration,topic,created) VALUES (?,?,?,?,?,?,?,?)",
                (me, mentor, d.isoformat(), start, end, duration, topic, time.time()),
            ).lastrowid
        return jsonify(ok=True, id=sid)

    @app.put("/api/sessions/<int:sid>")
    @auth()
    def update_session(sid):
        dta, u = body(), g.user
        status = str(dta.get("status") or "")
        try:
            note = text(dta, "note", 500)
        except ValueError as e:
            return bad(str(e))
        with db() as con:
            s = con.execute("SELECT * FROM mentor_sessions WHERE id=?", (sid,)).fetchone()
            mine = s and (u["role"] == "admin" or s["mentor"] == u["username"] or s["student_id"] == u["username"])
            if not mine:
                return bad("session not found", 404)
            is_mentor = u["role"] == "admin" or s["mentor"] == u["username"]
            if is_mentor:
                ok = {"requested": ("confirmed", "declined", "cancelled"), "confirmed": ("completed", "cancelled")}.get(s["status"], ())
            else:  # the student
                ok = ("cancelled",) if s["status"] in ("requested", "confirmed") else ()
            if status not in ok:
                return bad(f"a {s['status']} session cannot become {status or 'that'}", 409)
            if status == "confirmed":
                msg = conflict(con, s["mentor"], datetime.strptime(s["session_date"], "%Y-%m-%d").date(), s["start_time"], s["end_time"], sid)
                if msg:
                    return bad(msg, 409)
            con.execute("UPDATE mentor_sessions SET status=?, note=? WHERE id=?", (status, note or s["note"], sid))
        return jsonify(ok=True)

    # ---------- teacher leave ----------
    def count_days(a, b):
        return (b - a).days + 1

    def used_days(con, teacher, kind, year, exclude=0):
        r = con.execute(
            "SELECT COALESCE(SUM(days),0) FROM leaves WHERE teacher=? AND type=? AND status IN ('pending','approved') AND substr(from_date,1,4)=? AND id!=?",
            (teacher, kind, str(year), exclude),
        ).fetchone()
        return r[0]

    @app.get("/api/leaves")
    @auth("admin", "teacher")
    def leaves():
        sql = "SELECT l.*, u.name AS teacher_name FROM leaves l JOIN users u ON u.username=l.teacher"
        if g.user["role"] == "admin":
            return jsonify(rows(sql + " ORDER BY (l.status='pending') DESC, l.from_date DESC"))
        return jsonify(rows(sql + " WHERE l.teacher=? ORDER BY l.from_date DESC", (g.user["username"],)))

    @app.get("/api/leaves/balance")
    @auth("teacher")
    def leave_balance():
        year = date.today().year
        out = []
        with db() as con:
            for kind, quota in QUOTA.items():
                used = used_days(con, g.user["username"], kind, year)
                out.append({"type": kind, "quota": quota, "used": used, "remaining": None if quota is None else quota - used})
        return jsonify(out)

    @app.post("/api/leaves")
    @auth("teacher")
    def apply_leave():
        d = body()
        try:
            kind, reason = text(d, "type", 10, True), text(d, "reason", 500, True)
            a, b = day(d, "from_date"), day(d, "to_date")
            if kind not in QUOTA:
                raise ValueError("type must be casual, sick, earned or other")
            if b < a:
                raise ValueError("to_date cannot be before from_date")
            if count_days(a, b) > 60:
                raise ValueError("a single request can cover at most 60 days")
        except ValueError as e:
            return bad(str(e))
        n, me = count_days(a, b), g.user["username"]
        with db() as con:
            if con.execute("SELECT 1 FROM leaves WHERE teacher=? AND status IN ('pending','approved') AND from_date<=? AND to_date>=?", (me, b.isoformat(), a.isoformat())).fetchone():
                return bad("you already have leave overlapping those dates", 409)
            quota = QUOTA[kind]
            if quota is not None and used_days(con, me, kind, a.year) + n > quota:
                return bad(f"exceeds your {kind} leave balance ({quota - used_days(con, me, kind, a.year)} days left this year)", 409)
            lid = con.execute(
                "INSERT INTO leaves (teacher,type,from_date,to_date,days,reason,created) VALUES (?,?,?,?,?,?,?)",
                (me, kind, a.isoformat(), b.isoformat(), n, reason, time.time()),
            ).lastrowid
        return jsonify(ok=True, id=lid)

    @app.put("/api/leaves/<int:lid>")
    @auth("admin", "teacher")
    def decide_leave(lid):
        d, u = body(), g.user
        status = str(d.get("status") or "")
        try:
            note = text(d, "note", 300)
        except ValueError as e:
            return bad(str(e))
        with db() as con:
            l = con.execute("SELECT * FROM leaves WHERE id=?", (lid,)).fetchone()
            if not l or (u["role"] == "teacher" and l["teacher"] != u["username"]):
                return bad("leave not found", 404)
            if u["role"] == "admin":
                if status not in ("approved", "rejected") or l["status"] != "pending":
                    return bad("admin can approve or reject pending requests only", 409)
            else:
                if status != "cancelled" or l["status"] not in ACTIVE_LEAVE or l["to_date"] < date.today().isoformat():
                    return bad("you can only cancel a pending or upcoming leave", 409)
            con.execute("UPDATE leaves SET status=?, decided_note=? WHERE id=?", (status, note or l["decided_note"], lid))
        return jsonify(ok=True)
