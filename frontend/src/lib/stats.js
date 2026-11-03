export const fmt = (n, digits = 1) => (n == null || n === '' || Number.isNaN(Number(n)) ? '-' : Number(n).toFixed(digits));
// Whole numbers without decimals, others with one.
export const num = (n) => (n == null || n === '' ? '-' : fmt(n, Number.isInteger(Number(n)) ? 0 : 1));

// Attendance as a percentage, or null when no classes were held.
export const attendancePct = (attended, total) => (Number(total) > 0 ? (Number(attended) / Number(total)) * 100 : null);
export const pctText = (p) => (p == null ? '-' : `${fmt(p, 0)}%`);

// Assessment components in display order; maxima come from /api/scheme.
export const COMPONENTS = [
  ['cie1', 'CIE 1'],
  ['cie2', 'CIE 2'],
  ['cie3', 'CIE 3'],
  ['see', 'SEE'],
];
// Attendance percent from the server when present, else from the counts.
export const attOf = (r) => r.attendance_pct ?? attendancePct(r.attended, r.total);

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// One row per student with their average percent across subjects, best first. Equal averages share a rank.
// Uses the server-derived `marks` percent; subjects not assessed yet (marks null) are skipped.
export function rankStudents(records) {
  const byStudent = new Map();
  for (const r of records) {
    const s = byStudent.get(r.student_id) ?? { student_id: r.student_id, name: r.name, department: r.department, class_name: r.class_name, marks: [], subjects: 0, attended: 0, total: 0 };
    if (r.marks != null) s.marks.push(Number(r.marks));
    s.subjects += 1;
    s.attended += Number(r.attended) || 0;
    s.total += Number(r.total) || 0;
    byStudent.set(r.student_id, s);
  }
  const rows = [...byStudent.values()]
    .map((s) => ({ ...s, average: mean(s.marks), attendance: attendancePct(s.attended, s.total) }))
    .sort((a, b) => (b.average ?? -1) - (a.average ?? -1));
  rows.forEach((row, i) => {
    row.rank = i > 0 && row.average === rows[i - 1].average ? rows[i - 1].rank : i + 1;
  });
  return rows;
}

const BANDS = [
  { label: '0-39', min: 0, max: 40 },
  { label: '40-59', min: 40, max: 60 },
  { label: '60-74', min: 60, max: 75 },
  { label: '75-89', min: 75, max: 90 },
  { label: '90-100', min: 90, max: Infinity },
];

export const distribution = (records) =>
  BANDS.map((b) => ({ label: b.label, value: records.filter((r) => r.marks != null && Number(r.marks) >= b.min && Number(r.marks) < b.max).length }));

// Grade order comes from the server scheme; F is everything below the pass mark.
export const gradeOrder = (scheme) => [...(scheme?.bands ?? []).map((b) => b.grade), 'F'];

const GRADE_COLOR = { 'A+': '#1f9d55', A: '#1f9d55', 'B+': '#3d7be0', B: '#3d7be0', C: '#c77c02', D: '#c77c02', F: '#c22f2f' };
// Bars for a {grade: count} map, in scheme order when known.
export function gradeData(grades = {}, scheme) {
  const order = scheme ? gradeOrder(scheme) : Object.keys(grades);
  const keys = [...order, ...Object.keys(grades).filter((g) => !order.includes(g))];
  return Object.keys(grades).length ? keys.map((g) => ({ label: g, value: grades[g] ?? 0, color: GRADE_COLOR[g] })) : [];
}
// Bars for report.components: average as a percent of each component's max.
export const componentData = (components = []) => components.map((c) => ({ label: c.label ? `${c.label} /${c.max}` : c.key, value: c.percent }));

// "12 passed, 3 failed, 1 low attendance, 4 pending"
export function resultsText(results = {}) {
  const parts = [
    [results.pass, 'passed'],
    [results.fail, 'failed'],
    [results.shortage, 'low attendance'],
    [results.pending, 'pending'],
  ].filter(([n]) => n);
  return parts.length ? parts.map(([n, w]) => `${n} ${w}`).join(', ') : 'No results yet';
}

// CSV header names match the import columns, so an export can be re-imported.
export const CSV_COLUMNS = [
  ['student_id', 'student_id'],
  ['name', 'name'],
  ['department', 'department'],
  ['semester', 'semester'],
  ['class', 'class_name'],
  ['subject', 'subject'],
  ['cie1', 'cie1'],
  ['cie2', 'cie2'],
  ['cie3', 'cie3'],
  ['see', 'see'],
  ['attended', 'attended'],
  ['total', 'total'],
];

function cell(v) {
  let s = String(v ?? '');
  if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`; // keep spreadsheets from running it as a formula
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function saveFile(text, filename, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadCsv(records, filename) {
  saveFile([CSV_COLUMNS.map(([h]) => h).join(','), ...records.map((r) => CSV_COLUMNS.map(([, k]) => cell(r[k])).join(','))].join('\r\n'), filename);
}

// ---------- dates and times ----------
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const todayIndex = () => (new Date().getDay() + 6) % 7; // 0 = Monday, like the API
export const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return h * 60 + (m || 0);
};
export const fromMinutes = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
export const nowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};
export const isoDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fmtDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
export const fmtUnix = (s) => (s ? new Date(s * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');

export function ago(unixSeconds) {
  if (!unixSeconds) return 'Never';
  const s = Math.round(Date.now() / 1000 - unixSeconds);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

// The server sends some lists as comma-joined strings (GROUP_CONCAT).
export const splitList = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean));
export const cap = (s) => (s ? `${s[0].toUpperCase()}${s.slice(1).replace(/_/g, ' ')}` : '');
