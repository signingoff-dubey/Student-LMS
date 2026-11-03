# Student LMS

A student record management portal: Flask + SQLite backend, React (Vite) frontend. Three roles —
admin, teacher, student — each see only what they're allowed to.

## Features

- **Scoring:** CIE1 (/25), CIE2 (/20), CIE3 (/25), SEE (/30) per subject. Each CIE needs 40% of its
  own maximum, the CIE total needs 28/70, SEE needs 15/30, and attendance needs at least 80% —
  enforced server-side, never recomputed on the client.
- **Spreadsheet import:** upload an `.xlsx`/`.csv`, or connect a live Google Sheets / OneDrive share
  link (re-synced automatically). Handles workbooks with one tab per section/class/batch, messy
  real-world headers (`USN`, `Roll No`, `CIE-1 (50)`, `Sec`, ...), title rows above the header
  (`Subject: Python`, `Section: A`), marks out of other maxima, attendance as counts or a date
  register (P/A per day), and merges partial sheets without wiping out what an earlier upload set.
- **Roles:** admin sees everything; a teacher sees their own classes/students; a student sees their
  own subjects, attendance, and a printable report card with class rank.
- **Courses, timetable** (with clash detection), **announcements**, **projects**.
- **Mentoring:** mentor↔mentee messaging, session booking (busy-time aware), teacher leave
  (apply/balance/approve).

## Run locally

```
# backend
cd backend
pip install -r requirements.txt
python app.py            # http://localhost:5000 — first run prints a one-time admin password

# frontend
cd frontend
npm install
npm run dev               # http://localhost:5173, proxies /api to :5000
```

Students log in with their student ID as both username and first password, then are prompted to
change it. Teacher accounts are created by admin from the Teachers page.

## Backend layout

- `app.py` — auth, roles, records CRUD, scoring, reports, spreadsheet import, connected sources.
- `scheme.py` — the CIE/SEE marks scheme and pass rules, in one place.
- `ingest.py` — pure spreadsheet parsing (header aliases, multi-sheet, context extraction).
- `links.py` — safe fetch of a connected Google Sheets / OneDrive link (host allowlist, redirect
  re-validation).
- `extras.py` — profile, courses, timetable, announcements, students directory, report card.
- `mentoring.py` — mentor assignment, messages, session booking, teacher leave.

## Status

Built incrementally with Claude Code; `backend/test_app.py` predates the CIE/SEE scoring rewrite and
is known stale.
