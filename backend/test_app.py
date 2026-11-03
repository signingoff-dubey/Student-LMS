import io
import os
import tempfile

tmp = tempfile.mkdtemp()
os.environ["STUDENTS_DB"] = os.path.join(tmp, "t.db")
os.environ["ADMIN_PASSWORD"] = "adminpw"
import app  # noqa: E402

c = app.app.test_client()


def login(u, p):
    r = c.post("/api/login", json={"username": u, "password": p})
    return {"Authorization": "Bearer " + r.json["token"]} if r.status_code == 200 else r.status_code


CSV = (
    "student_id,name,department,semester,class,subject,marks,attended,total\n"
    "S1,Asha,CSE,3,CSE-3A,Math,80,18,20\n"
    "S1,Asha,CSE,3,CSE-3A,Phy,100,10,20\n"
    "S2,Ravi,CSE,3,CSE-3B,Math,60,15,20\n"
    "S3,Bad,CSE,3,CSE-3A,Math,150,1,2\n"
    "S4,BadAtt,CSE,3,CSE-3A,Math,50,5,2\n"
)


def upload(h, text=CSV):
    return c.post("/api/import", headers=h, data={"file": (io.BytesIO(text.encode()), "s.csv")}, content_type="multipart/form-data")


# --- auth ---
assert c.get("/api/records").status_code == 401
assert login("admin", "wrong") == 401
admin = login("admin", "adminpw")
assert c.post("/api/users", headers=admin, json={"username": "t1", "name": "Teacher One", "password": "secret1"}).status_code == 200
assert c.post("/api/users", headers=admin, json={"username": "t2", "name": "Teacher Two", "password": "secret2"}).status_code == 200
t1, t2 = login("t1", "secret1"), login("t2", "secret2")
assert c.post("/api/users", headers=t1, json={"username": "x", "name": "x", "password": "secret1"}).status_code == 403

# --- import: t1 claims CSE-3A, CSE-3B is pre-assigned to t2 ---
assert c.put("/api/classes/CSE-3B", headers=admin, json={"teacher": "t2"}).status_code == 200
r = upload(t1).json
assert r["saved"] == 2 and r["rejected_count"] == 3, r  # S2 (other teacher's class), S3 (marks), S4 (attendance)
assert upload(t1).json["saved"] == 2  # re-upload is an idempotent upsert
assert upload(t2).json["saved"] == 1
assert c.post("/api/import", headers=t1, data={}, content_type="multipart/form-data").status_code == 400
assert upload(t1, "a,b\n1,2\n").status_code == 400  # missing columns

# --- scoping ---
assert len(c.get("/api/records", headers=admin).json) == 3
assert {x["student_id"] for x in c.get("/api/records", headers=t1).json} == {"S1"}
assert {x["student_id"] for x in c.get("/api/records", headers=t2).json} == {"S2"}

# t2 cannot edit or delete t1's row, nor steal it by upload
rid = c.get("/api/records?q=Phy", headers=t1).json[0]["id"]
row = {"student_id": "S1", "name": "Asha", "department": "CSE", "semester": 3, "class_name": "CSE-3A", "subject": "Phy", "marks": 1, "attended": 1, "total": 2}
assert c.put(f"/api/records/{rid}", headers=t2, json=row).status_code == 404
c.delete(f"/api/records/{rid}", headers=t2)
assert len(c.get("/api/records", headers=t1).json) == 2
assert upload(t2, CSV.split("\n")[0] + "\nS1,Asha,CSE,3,CSE-3B,Math,1,1,2\n").json["saved"] == 0  # would overwrite t1's row
# manual add: duplicate -> 409, bad class owner -> 403, ok edit
assert c.post("/api/records", headers=t1, json=row | {"subject": "Math"}).status_code == 409
assert c.post("/api/records", headers=t1, json=row | {"subject": "Chem", "class_name": "CSE-3B"}).status_code == 403
assert c.put(f"/api/records/{rid}", headers=t1, json=row | {"marks": 95}).status_code == 200

# --- students: lazy account, own data only ---
assert login("S9", "S9") == 401  # no such student
s1 = login("S1", "S1")
assert {x["subject"] for x in c.get("/api/records", headers=s1).json} == {"Math", "Phy"}
assert c.post("/api/records", headers=s1, json=row).status_code == 403
rep = c.get("/api/reports", headers=s1).json
assert rep["topper"] is None and rep["attendance"] == 86.4  # (18+1)/(20+2)
assert c.post("/api/password", headers=s1, json={"old": "S1", "new": "abc"}).status_code == 400
assert c.post("/api/password", headers=s1, json={"old": "S1", "new": "newpass1"}).status_code == 200
assert login("S1", "S1") == 401 and login("S1", "newpass1") != 401

# --- reports for staff ---
rep = c.get("/api/reports", headers=admin).json
assert rep["topper"]["student_id"] == "S1" and len(rep["classes"]) == 2

# --- connected source (admin local path) re-syncs on change ---
path = os.path.join(tmp, "sheet.csv")
open(path, "w").write(CSV.split("\n")[0] + "\nS5,Meera,ECE,1,ECE-1A,Math,70,9,10\n")
assert c.post("/api/sources", headers=t1, json={"location": path}).status_code == 403  # teachers: share links only
assert c.post("/api/sources", headers=t1, json={"location": "https://evil.example/x.csv"}).json["status"].startswith("error")
sid = c.post("/api/sources", headers=admin, json={"location": path}).json["id"]
assert c.post(f"/api/sources/{sid}/sync", headers=admin).json["status"] == "unchanged"
open(path, "w").write(CSV.split("\n")[0] + "\nS5,Meera,ECE,1,ECE-1A,Math,75,9,10\n")
assert c.post(f"/api/sources/{sid}/sync", headers=admin).json["status"].startswith("synced 1")
assert c.get("/api/records?q=Meera", headers=admin).json[0]["marks"] == 75
assert c.post(f"/api/sources/{sid}/sync", headers=t1).status_code == 404
s1 = login("S1", "newpass1")

# --- profile ---
assert c.put("/api/profile", headers=s1, json={"email": "nope"}).status_code == 400
assert c.put("/api/profile", headers=s1, json={"email": "a@b.co", "phone": "123", "about": "hi"}).json["email"] == "a@b.co"
assert c.get("/api/profile", headers=s1).json["about"] == "hi"

# --- students directory ---
assert [s["student_id"] for s in c.get("/api/students", headers=t1).json] == ["S1"]
assert len(c.get("/api/students", headers=admin).json) == 3
assert c.get("/api/students", headers=s1).status_code == 403
d = c.get("/api/students/S1", headers=t1).json
assert len(d["records"]) == 2 and d["profile"]["email"] == "a@b.co"
assert c.get("/api/students/S1", headers=t2).status_code == 404

# --- courses ---
math = {"code": "MA101", "name": "Math", "credits": 4, "department": "CSE", "semester": 3, "teacher": "t1"}
assert c.post("/api/courses", headers=t1, json=math).status_code == 403
assert c.post("/api/courses", headers=admin, json=math).status_code == 200
assert c.post("/api/courses", headers=admin, json=math).status_code == 409
assert c.post("/api/courses", headers=admin, json=math | {"code": "X", "name": "Y", "credits": 99}).status_code == 400
assert c.post("/api/courses", headers=admin, json=math | {"code": "X", "name": "Y", "teacher": "ghost"}).status_code == 400
cid = c.get("/api/courses", headers=admin).json[0]["id"]
assert c.get("/api/courses", headers=admin).json[0]["students"] == 3
assert len(c.get("/api/courses", headers=t1).json) == 1 and c.get("/api/courses", headers=t2).json == []
assert [x["name"] for x in c.get("/api/courses", headers=s1).json] == ["Math"]
assert len(c.get(f"/api/courses/{cid}", headers=t1).json["roster"]) == 1
assert c.get(f"/api/courses/{cid}", headers=t2).status_code == 404

# --- timetable (with clash detection) ---
slot = {"class_name": "CSE-3A", "day": 0, "start_time": "09:00", "end_time": "10:00", "course": "Math", "room": "R1"}
assert c.post("/api/timetable", headers=t1, json=slot).status_code == 200
assert c.post("/api/timetable", headers=t1, json=slot | {"room": "R2"}).status_code == 409  # same class, same time
assert c.post("/api/timetable", headers=t1, json=slot | {"class_name": "CSE-3B"}).status_code == 403
assert c.post("/api/timetable", headers=admin, json=slot | {"class_name": "CSE-3B", "teacher": "t2"}).status_code == 409  # room R1 taken
assert c.post("/api/timetable", headers=admin, json=slot | {"class_name": "CSE-3B", "teacher": "t2", "room": "R2"}).status_code == 200
assert c.post("/api/timetable", headers=admin, json=slot | {"class_name": "ECE-1A", "teacher": "t2", "room": "R9", "start_time": "09:30", "end_time": "10:30"}).status_code == 409  # t2 busy
assert c.post("/api/timetable", headers=admin, json=slot | {"start_time": "10:00", "end_time": "09:00"}).status_code == 400
assert c.post("/api/timetable", headers=admin, json=slot | {"start_time": "9am"}).status_code == 400
assert c.post("/api/timetable", headers=admin, json=slot | {"start_time": "10:00", "end_time": "11:00"}).status_code == 200  # back-to-back is fine
assert len(c.get("/api/timetable", headers=s1).json) == 2  # only CSE-3A
assert {x["class_name"] for x in c.get("/api/timetable", headers=t2).json} == {"CSE-3B"}
assert c.post("/api/timetable", headers=s1, json=slot).status_code == 403
sid = c.get("/api/timetable", headers=t2).json[0]["id"]
c.delete(f"/api/timetable/{sid}", headers=t1)  # not t1's class: no effect
assert len(c.get("/api/timetable", headers=t2).json) == 1

# --- announcements ---
assert c.post("/api/announcements", headers=t1, json={"title": "Quiz", "body": "Monday", "class_name": "CSE-3A"}).status_code == 200
assert c.post("/api/announcements", headers=t1, json={"title": "All", "body": "x"}).status_code == 403
assert c.post("/api/announcements", headers=t1, json={"title": "Q", "body": "x", "class_name": "CSE-3B"}).status_code == 403
assert c.post("/api/announcements", headers=admin, json={"title": "Holiday", "body": "Friday"}).status_code == 200
assert c.post("/api/announcements", headers=s1, json={"title": "x", "body": "x"}).status_code == 403
assert len(c.get("/api/announcements", headers=s1).json) == 2
assert [a["title"] for a in c.get("/api/announcements", headers=t2).json] == ["Holiday"]

# --- classes ---
cl = {x["name"]: x for x in c.get("/api/classes", headers=admin).json}
assert cl["CSE-3A"]["students"] == 1 and cl["CSE-3A"]["teacher_name"] == "Teacher One"
assert c.delete("/api/classes/CSE-3A", headers=admin).status_code == 409
assert c.delete("/api/users/t1", headers=admin).status_code == 200  # cascades cleanly
assert c.get("/api/courses", headers=admin).json[0]["teacher"] is None
print("ok")
