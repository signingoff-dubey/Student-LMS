"""Profile, courses, timetable, announcements and the students directory.

Registered from app.py so it shares the same db(), auth() and scope() helpers.
"""
import re
import sqlite3
import time

from flask import g, jsonify, request

from scheme import band

HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def register(app, db, auth, scope, decorate):
    with db() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS profiles (
                username TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
                address TEXT NOT NULL DEFAULT '', about TEXT NOT NULL DEFAULT '');
            -- A course's name must equal records.subject: that is how students are matched to courses.
            CREATE TABLE IF NOT EXISTS courses (
                id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL UNIQUE,
                credits INTEGER NOT NULL, department TEXT NOT NULL DEFAULT '', semester INTEGER NOT NULL,
                teacher TEXT REFERENCES users(username));
            CREATE TABLE IF NOT EXISTS slots (
                id INTEGER PRIMARY KEY AUTOINCREMENT, class_name TEXT NOT NULL REFERENCES classes(name),
                day INTEGER NOT NULL CHECK (day BETWEEN 0 AND 6),
                start_time TEXT NOT NULL, end_time TEXT NOT NULL, course TEXT NOT NULL,
                room TEXT NOT NULL DEFAULT '', teacher TEXT REFERENCES users(username));
            CREATE TABLE IF NOT EXISTS announcements (
                id INTEGER PRIMARY KEY AUTOINCREMENT, author TEXT NOT NULL REFERENCES users(username),
                title TEXT NOT NULL, body TEXT NOT NULL, class_name TEXT, created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
                class_name TEXT NOT NULL REFERENCES classes(name), guide TEXT REFERENCES users(username),
                status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','in_progress','submitted','completed')),
                score REAL CHECK (score BETWEEN 0 AND 100), created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS project_members (
                project_id INTEGER NOT NULL REFERENCES projects(id), student_id TEXT NOT NULL,
                PRIMARY KEY (project_id, student_id));
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

    def num(d, key, lo, hi):
        try:
            v = int(float(d.get(key)))
        except (TypeError, ValueError):
            raise ValueError(f"{key} must be a whole number {lo}-{hi}")
        if not lo <= v <= hi:
            raise ValueError(f"{key} must be a whole number {lo}-{hi}")
        return v

    def is_teacher(con, username):
        return username is None or con.execute("SELECT 1 FROM users WHERE username=? AND role='teacher'", (username,)).fetchone()

    def owns_class(con, user, class_name):
        if user["role"] == "admin":
            return True
        return bool(con.execute("SELECT 1 FROM classes WHERE name=? AND teacher=?", (class_name, user["username"])).fetchone())

    # ---------- profile ----------
    def profile_of(username):
        u = db().execute("SELECT username, role, name FROM users WHERE username=?", (username,)).fetchone()
        if not u:
            return None
        p = db().execute("SELECT email, phone, address, about FROM profiles WHERE username=?", (username,)).fetchone()
        return {**dict(u), **(dict(p) if p else dict(email="", phone="", address="", about=""))}

    @app.get("/api/profile")
    @auth()
    def my_profile():
        return jsonify(profile_of(g.user["username"]))

    @app.put("/api/profile")
    @auth()
    def update_profile():
        d = body()
        try:
            email = text(d, "email", 120)
            if email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
                raise ValueError("email looks invalid")
            vals = [email, text(d, "phone", 30), text(d, "address", 300), text(d, "about", 500)]
            name = text(d, "name", 80)
        except ValueError as e:
            return bad(str(e))
        with db() as con:
            con.execute(
                "INSERT INTO profiles VALUES (?,?,?,?,?) ON CONFLICT(username) DO UPDATE SET "
                "email=excluded.email, phone=excluded.phone, address=excluded.address, about=excluded.about",
                [g.user["username"]] + vals,
            )
            if name:
                con.execute("UPDATE users SET name=? WHERE username=?", (name, g.user["username"]))
        return jsonify(profile_of(g.user["username"]))

    # ---------- students directory ----------
    ATT = "CASE WHEN SUM(total)>0 THEN ROUND(100.0*SUM(attended)/SUM(total),1) END"

    @app.get("/api/students")
    @auth("admin", "teacher")
    def students():
        where, params = scope(g.user)
        like = f"%{request.args.get('q', '')}%"
        return jsonify(
            rows(
                f"""SELECT student_id, MIN(name) AS name, MIN(department) AS department, MIN(semester) AS semester,
                    GROUP_CONCAT(DISTINCT class_name) AS classes, COUNT(*) AS subjects,
                    ROUND(AVG(marks),2) AS average, {ATT} AS attendance
                    FROM records WHERE ({where}) AND (student_id LIKE ? OR name LIKE ? OR department LIKE ?)
                    GROUP BY student_id ORDER BY name""",
                params + [like] * 3,
            )
        )

    @app.get("/api/students/<sid>")
    @auth("admin", "teacher")
    def student_detail(sid):
        where, params = scope(g.user)
        recs = rows(f"SELECT * FROM records WHERE ({where}) AND student_id=? ORDER BY subject", params + [sid])
        if not recs:
            return bad("student not found", 404)
        profile = profile_of(sid) or dict(username=sid, role="student", name=recs[0]["name"], email="", phone="", address="", about="")
        return jsonify(student_id=sid, name=recs[0]["name"], department=recs[0]["department"], semester=recs[0]["semester"], records=recs, profile=profile)

    # ---------- courses ----------
    COURSE_SQL = """SELECT c.*, u.name AS teacher_name,
        (SELECT COUNT(DISTINCT student_id) FROM records r WHERE r.subject=c.name) AS students
        FROM courses c LEFT JOIN users u ON u.username=c.teacher"""

    def course_fields(d):
        return dict(
            code=text(d, "code", 20, True),
            name=text(d, "name", 80, True),
            credits=num(d, "credits", 1, 10),
            department=text(d, "department", 60),
            semester=num(d, "semester", 1, 12),
            teacher=text(d, "teacher", 40) or None,
        )

    @app.get("/api/courses")
    @auth()
    def list_courses():
        u = g.user
        if u["role"] == "admin":
            return jsonify(rows(COURSE_SQL + " ORDER BY c.semester, c.code"))
        if u["role"] == "teacher":
            return jsonify(rows(COURSE_SQL + " WHERE c.teacher=? ORDER BY c.semester, c.code", (u["username"],)))
        return jsonify(rows(COURSE_SQL + " WHERE c.name IN (SELECT subject FROM records WHERE student_id=?) ORDER BY c.code", (u["username"],)))

    @app.get("/api/courses/<int:cid>")
    @auth("admin", "teacher")
    def course_detail(cid):
        c = rows(COURSE_SQL + " WHERE c.id=?", (cid,))
        if not c or (g.user["role"] == "teacher" and c[0]["teacher"] != g.user["username"]):
            return bad("course not found", 404)
        where, params = scope(g.user)
        roster = rows(f"SELECT student_id, name, class_name, marks, attended, total FROM records WHERE ({where}) AND subject=? ORDER BY name", params + [c[0]["name"]])
        return jsonify(**c[0], roster=roster)

    def save_course(cid=None):
        try:
            f = course_fields(body())
        except ValueError as e:
            return bad(str(e))
        try:
            with db() as con:
                if not is_teacher(con, f["teacher"]):
                    return bad("no such teacher")
                if cid is None:
                    con.execute("INSERT INTO courses (code,name,credits,department,semester,teacher) VALUES (?,?,?,?,?,?)", list(f.values()))
                else:
                    sets = ",".join(f"{k}=?" for k in f)
                    if not con.execute(f"UPDATE courses SET {sets} WHERE id=?", list(f.values()) + [cid]).rowcount:
                        return bad("course not found", 404)
        except sqlite3.IntegrityError:
            return bad("course code or name already exists", 409)
        return jsonify(ok=True)

    @app.post("/api/courses")
    @auth("admin")
    def add_course():
        return save_course()

    @app.put("/api/courses/<int:cid>")
    @auth("admin")
    def edit_course(cid):
        return save_course(cid)

    @app.delete("/api/courses/<int:cid>")
    @auth("admin")
    def delete_course(cid):
        with db() as con:
            con.execute("DELETE FROM courses WHERE id=?", (cid,))
        return jsonify(ok=True)

    # ---------- timetable ----------
    SLOT_SQL = "SELECT s.*, u.name AS teacher_name FROM slots s LEFT JOIN users u ON u.username=s.teacher"

    def slot_scope(user):
        if user["role"] == "admin":
            return "1=1", []
        if user["role"] == "teacher":
            return "(s.class_name IN (SELECT name FROM classes WHERE teacher=?) OR s.teacher=?)", [user["username"]] * 2
        return "s.class_name IN (SELECT DISTINCT class_name FROM records WHERE student_id=?)", [user["username"]]

    @app.get("/api/timetable")
    @auth()
    def timetable():
        where, params = slot_scope(g.user)
        return jsonify(rows(f"{SLOT_SQL} WHERE {where} ORDER BY s.day, s.start_time", params))

    def slot_fields(d):
        f = dict(
            class_name=text(d, "class_name", 60, True),
            day=num(d, "day", 0, 6),
            start_time=text(d, "start_time", 5, True),
            end_time=text(d, "end_time", 5, True),
            course=text(d, "course", 80, True),
            room=text(d, "room", 30),
            teacher=text(d, "teacher", 40) or None,
        )
        if not (HHMM.match(f["start_time"]) and HHMM.match(f["end_time"])):
            raise ValueError("times must be HH:MM (24-hour)")
        if f["start_time"] >= f["end_time"]:
            raise ValueError("end_time must be after start_time")
        return f

    def clash(con, f, sid):
        r = con.execute(
            """SELECT class_name, teacher, room FROM slots WHERE day=? AND start_time<? AND end_time>? AND id!=?
               AND (class_name=? OR (teacher IS NOT NULL AND teacher=?) OR (?!='' AND room=?))""",
            (f["day"], f["end_time"], f["start_time"], sid, f["class_name"], f["teacher"], f["room"], f["room"]),
        ).fetchone()
        if not r:
            return None
        if r["class_name"] == f["class_name"]:
            return "this class already has a lesson in that time"
        return "the teacher is busy in that time" if f["teacher"] and r["teacher"] == f["teacher"] else "the room is taken in that time"

    def save_slot(sid=None):
        try:
            f = slot_fields(body())
        except ValueError as e:
            return bad(str(e))
        with db() as con:
            if not con.execute("SELECT 1 FROM classes WHERE name=?", (f["class_name"],)).fetchone():
                return bad("no such class")
            if not owns_class(con, g.user, f["class_name"]):
                return bad("not your class", 403)
            if sid is not None:
                old = con.execute("SELECT class_name FROM slots WHERE id=?", (sid,)).fetchone()
                if not old or not owns_class(con, g.user, old["class_name"]):
                    return bad("lesson not found", 404)
            if g.user["role"] == "teacher":
                f["teacher"] = g.user["username"]
            elif not is_teacher(con, f["teacher"]):
                return bad("no such teacher")
            msg = clash(con, f, sid or 0)
            if msg:
                return bad(f"Clash: {msg}", 409)
            if sid is None:
                con.execute(f"INSERT INTO slots ({','.join(f)}) VALUES ({','.join('?' * len(f))})", list(f.values()))
            else:
                con.execute(f"UPDATE slots SET {','.join(k + '=?' for k in f)} WHERE id=?", list(f.values()) + [sid])
        return jsonify(ok=True)

    @app.post("/api/timetable")
    @auth("admin", "teacher")
    def add_slot():
        return save_slot()

    @app.put("/api/timetable/<int:sid>")
    @auth("admin", "teacher")
    def edit_slot(sid):
        return save_slot(sid)

    @app.delete("/api/timetable/<int:sid>")
    @auth("admin", "teacher")
    def delete_slot(sid):
        with db() as con:
            old = con.execute("SELECT class_name FROM slots WHERE id=?", (sid,)).fetchone()
            if old and owns_class(con, g.user, old["class_name"]):
                con.execute("DELETE FROM slots WHERE id=?", (sid,))
        return jsonify(ok=True)

    # ---------- announcements (class_name null = everyone) ----------
    NEWS_SQL = "SELECT a.*, u.name AS author_name FROM announcements a JOIN users u ON u.username=a.author"

    @app.get("/api/announcements")
    @auth()
    def announcements():
        u = g.user
        if u["role"] == "admin":
            where, params = "1=1", []
        elif u["role"] == "teacher":
            where, params = "(a.class_name IS NULL OR a.author=? OR a.class_name IN (SELECT name FROM classes WHERE teacher=?))", [u["username"]] * 2
        else:
            where, params = "(a.class_name IS NULL OR a.class_name IN (SELECT DISTINCT class_name FROM records WHERE student_id=?))", [u["username"]]
        return jsonify(rows(f"{NEWS_SQL} WHERE {where} ORDER BY a.created DESC LIMIT 50", params))

    @app.post("/api/announcements")
    @auth("admin", "teacher")
    def add_announcement():
        d = body()
        try:
            title, msg, cls = text(d, "title", 120, True), text(d, "body", 2000, True), text(d, "class_name", 60) or None
        except ValueError as e:
            return bad(str(e))
        with db() as con:
            if g.user["role"] == "teacher" and not (cls and owns_class(con, g.user, cls)):
                return bad("teachers post to one of their own classes", 403)
            if cls and not con.execute("SELECT 1 FROM classes WHERE name=?", (cls,)).fetchone():
                return bad("no such class")
            con.execute("INSERT INTO announcements (author,title,body,class_name,created) VALUES (?,?,?,?,?)", (g.user["username"], title, msg, cls, time.time()))
        return jsonify(ok=True)

    @app.delete("/api/announcements/<int:aid>")
    @auth("admin", "teacher")
    def delete_announcement(aid):
        with db() as con:
            if g.user["role"] == "admin":
                con.execute("DELETE FROM announcements WHERE id=?", (aid,))
            else:
                con.execute("DELETE FROM announcements WHERE id=? AND author=?", (aid, g.user["username"]))
        return jsonify(ok=True)

    # ---------- projects ----------
    STATUSES = ("proposed", "in_progress", "submitted", "completed")

    def project_scope(user):
        if user["role"] == "admin":
            return "1=1", []
        if user["role"] == "teacher":
            return "(p.class_name IN (SELECT name FROM classes WHERE teacher=?) OR p.guide=?)", [user["username"]] * 2
        return "p.id IN (SELECT project_id FROM project_members WHERE student_id=?)", [user["username"]]

    def project_list(where, params):
        ps = rows(
            f"SELECT p.*, u.name AS guide_name FROM projects p LEFT JOIN users u ON u.username=p.guide WHERE {where} ORDER BY p.created DESC",
            params,
        )
        for p in ps:
            p["members"] = rows(
                "SELECT m.student_id, (SELECT MIN(name) FROM records r WHERE r.student_id=m.student_id) AS name "
                "FROM project_members m WHERE m.project_id=? ORDER BY m.student_id",
                (p["id"],),
            )
        return ps

    @app.get("/api/projects")
    @auth()
    def projects():
        where, params = project_scope(g.user)
        return jsonify(project_list(where, params))

    def save_project(pid=None):
        d = body()
        try:
            title, desc, cls = text(d, "title", 120, True), text(d, "description", 2000), text(d, "class_name", 60, True)
            status = text(d, "status", 20) or "proposed"
            if status not in STATUSES:
                raise ValueError("invalid status")
            score = d.get("score")
            score = None if score in (None, "") else float(score)
            if score is not None and not 0 <= score <= 100:
                raise ValueError("score must be 0-100")
            members = d.get("members") or []
            if not isinstance(members, list) or len(set(members)) > 6:
                raise ValueError("members must be a list of up to 6 student ids")
            members = sorted({str(m).strip() for m in members if str(m).strip()})
            guide = text(d, "guide", 40) or None
        except (ValueError, TypeError) as e:
            return bad(str(e))
        with db() as con:
            klass = con.execute("SELECT teacher FROM classes WHERE name=?", (cls,)).fetchone()
            if not klass:
                return bad("no such class")
            if not owns_class(con, g.user, cls):
                return bad("not your class", 403)
            if pid is not None:
                old = con.execute("SELECT class_name FROM projects WHERE id=?", (pid,)).fetchone()
                if not old or not owns_class(con, g.user, old["class_name"]):
                    return bad("project not found", 404)
            guide = g.user["username"] if g.user["role"] == "teacher" else (guide or klass["teacher"])
            if not is_teacher(con, guide):
                return bad("no such teacher")
            for m in members:
                if not con.execute("SELECT 1 FROM records WHERE student_id=? AND class_name=?", (m, cls)).fetchone():
                    return bad(f"{m} is not a student of {cls}")
            if pid is None:
                pid = con.execute(
                    "INSERT INTO projects (title,description,class_name,guide,status,score,created) VALUES (?,?,?,?,?,?,?)",
                    (title, desc, cls, guide, status, score, time.time()),
                ).lastrowid
            else:
                con.execute("UPDATE projects SET title=?, description=?, class_name=?, guide=?, status=?, score=? WHERE id=?", (title, desc, cls, guide, status, score, pid))
                con.execute("DELETE FROM project_members WHERE project_id=?", (pid,))
            con.executemany("INSERT INTO project_members VALUES (?,?)", [(pid, m) for m in members])
        return jsonify(ok=True, id=pid)

    @app.post("/api/projects")
    @auth("admin", "teacher")
    def add_project():
        return save_project()

    @app.put("/api/projects/<int:pid>")
    @auth("admin", "teacher")
    def edit_project(pid):
        return save_project(pid)

    @app.delete("/api/projects/<int:pid>")
    @auth("admin", "teacher")
    def delete_project(pid):
        with db() as con:
            old = con.execute("SELECT class_name FROM projects WHERE id=?", (pid,)).fetchone()
            if old and owns_class(con, g.user, old["class_name"]):
                con.execute("DELETE FROM project_members WHERE project_id=?", (pid,))
                con.execute("DELETE FROM projects WHERE id=?", (pid,))
        return jsonify(ok=True)

    # ---------- report card ----------
    @app.get("/api/report-card")
    @app.get("/api/report-card/<sid>")
    @auth()
    def report_card(sid=None):
        u = g.user
        if u["role"] == "student":
            if sid not in (None, u["username"]):
                return bad("not allowed", 403)
            sid = u["username"]
        elif sid is None:
            return bad("student id required")
        where, params = scope(u)
        subjects = [decorate(r) for r in rows(f"SELECT * FROM records WHERE ({where}) AND student_id=? ORDER BY subject", params + [sid])]
        if not subjects:
            return bad("student not found", 404)
        pcts = [s["marks"] for s in subjects if s["marks"] is not None]
        raw = sum(pcts) / len(pcts) if pcts else None  # rank on the unrounded value so we match the class averages
        overall = None if raw is None else round(raw, 2)
        results = {s["result"] for s in subjects}
        result = "fail" if results & {"fail", "shortage"} else "pending" if "pending" in results else "pass"
        tot = sum(s["total"] for s in subjects)
        att = round(100 * sum(s["attended"] for s in subjects) / tot, 1) if tot else None
        cls = subjects[0]["class_name"]
        # Rank is computed over the whole class, not just what the caller may see.
        avgs = [x["a"] for x in rows("SELECT AVG(marks) AS a FROM records WHERE class_name=? GROUP BY student_id", (cls,)) if x["a"] is not None]
        return jsonify(
            student_id=sid, name=subjects[0]["name"], department=subjects[0]["department"], semester=subjects[0]["semester"],
            class_name=cls, subjects=subjects, overall_percent=overall, overall_result=result,
            overall_grade=("F" if result == "fail" else band(overall) if result == "pass" and overall is not None else None),
            attendance=att,
            class_rank=None if raw is None else 1 + sum(a > raw + 1e-9 for a in avgs), class_size=len(avgs),
            projects=project_list("p.id IN (SELECT project_id FROM project_members WHERE student_id=?)", [sid]),
        )
