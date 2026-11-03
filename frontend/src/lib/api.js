import { useEffect, useRef, useState } from 'react';

// All calls to the Flask backend. Vite proxies /api to http://localhost:5000 in dev.
const TOKEN_KEY = 'sr-token';
export const LOGOUT_EVENT = 'sr-logout';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => (token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY));

async function request(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) });
  } catch {
    throw new Error('Cannot reach the server. Is the backend running on port 5000?');
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && path !== '/api/login') {
    // Session expired or token revoked: drop it and let App show the login page.
    setToken(null);
    window.dispatchEvent(new Event(LOGOUT_EVENT));
  }
  if (!res.ok) {
    const fallback =
      res.status === 404 && !data
        ? 'This feature is not available on the server yet.'
        : res.status >= 500
          ? 'The server is not responding. Is the backend running on port 5000?'
          : `Request failed (${res.status}).`;
    const e = data?.error ? String(data.error) : '';
    const err = new Error(e ? `${e[0].toUpperCase()}${e.slice(1)}${/[.!?]$/.test(e) ? '' : '.'}` : fallback);
    err.status = res.status;
    throw err;
  }
  return data;
}

const list = (r) => (Array.isArray(r) ? r : []);
const enc = encodeURIComponent;
const qs = (q) => (q ? `?q=${enc(q)}` : '');
// For optional widgets: a missing or failing endpoint yields a fallback instead of breaking the page.
export const safe = (promise, fallback) => promise.catch(() => fallback);

// Auth and profile
export const login = (username, password) => request('/api/login', { method: 'POST', body: { username, password } });
export const getMe = () => request('/api/me');
export const changePassword = (oldPassword, newPassword) => request('/api/password', { method: 'POST', body: { old: oldPassword, new: newPassword } });
export const getProfile = () => request('/api/profile');
export const saveProfile = (p) => request('/api/profile', { method: 'PUT', body: p });

// Assessment scheme (maxima per component, grade bands). Fetched once per page load.
let schemePromise;
export const getScheme = () => {
  schemePromise ??= request('/api/scheme').catch((e) => {
    schemePromise = undefined;
    throw e;
  });
  return schemePromise;
};

// Scheme for components that need maxima and pass rules; null until loaded (or if the server lacks it).
export function useScheme() {
  const [scheme, setScheme] = useState(null);
  useEffect(() => {
    let live = true;
    getScheme().then((s) => live && setScheme(s), () => {});
    return () => {
      live = false;
    };
  }, []);
  return scheme;
}

// Records and reports
export const listRecords = (q = '') => request(`/api/records${qs(q)}`).then(list);
export const createRecord = (record) => request('/api/records', { method: 'POST', body: record });
export const updateRecord = (id, record) => request(`/api/records/${id}`, { method: 'PUT', body: record });
export const deleteRecord = (id) => request(`/api/records/${id}`, { method: 'DELETE' });
export const getReports = () =>
  request('/api/reports').then((r) => ({
    average: r?.average ?? null,
    attendance: r?.attendance ?? null,
    pass_rate: r?.pass_rate ?? null,
    grades: r?.grades ?? {},
    results: r?.results ?? {},
    components: list(r?.components),
    topper: r?.topper ?? null,
    subjects: list(r?.subjects),
    departments: list(r?.departments),
    classes: list(r?.classes),
  }));
export const getReportCard = (studentId) => request(studentId ? `/api/report-card/${enc(studentId)}` : '/api/report-card');

export function importFile(file) {
  const form = new FormData();
  form.append('file', file);
  return request('/api/import', { method: 'POST', form });
}

// Live sheets
export const listSources = () => request('/api/sources').then(list);
export const addSource = (location) => request('/api/sources', { method: 'POST', body: { location } });
export const syncSource = (id) => request(`/api/sources/${id}/sync`, { method: 'POST' });
export const deleteSource = (id) => request(`/api/sources/${id}`, { method: 'DELETE' });

// People and classes
export const listUsers = () => request('/api/users').then(list);
export const createTeacher = (user) => request('/api/users', { method: 'POST', body: user });
export const deleteUser = (username) => request(`/api/users/${enc(username)}`, { method: 'DELETE' });
export const listClasses = () => request('/api/classes').then(list);
export const assignClass = (name, teacher) => request(`/api/classes/${enc(name)}`, { method: 'PUT', body: { teacher } });
export const deleteClass = (name) => request(`/api/classes/${enc(name)}`, { method: 'DELETE' });
export const listStudents = (q = '') => request(`/api/students${qs(q)}`).then(list);
export const getStudent = (id) => request(`/api/students/${enc(id)}`);

// Courses, timetable, announcements, projects
export const listCourses = () => request('/api/courses').then(list);
export const getCourse = (id) => request(`/api/courses/${id}`);
export const saveCourse = (id, c) => request(id ? `/api/courses/${id}` : '/api/courses', { method: id ? 'PUT' : 'POST', body: c });
export const deleteCourse = (id) => request(`/api/courses/${id}`, { method: 'DELETE' });
export const listTimetable = () => request('/api/timetable').then(list);
export const saveSlot = (id, s) => request(id ? `/api/timetable/${id}` : '/api/timetable', { method: id ? 'PUT' : 'POST', body: s });
export const deleteSlot = (id) => request(`/api/timetable/${id}`, { method: 'DELETE' });
export const listAnnouncements = () => request('/api/announcements').then(list);
export const postAnnouncement = (a) => request('/api/announcements', { method: 'POST', body: a });
export const deleteAnnouncement = (id) => request(`/api/announcements/${id}`, { method: 'DELETE' });
export const listProjects = () => request('/api/projects').then(list);
export const saveProject = (id, p) => request(id ? `/api/projects/${id}` : '/api/projects', { method: id ? 'PUT' : 'POST', body: p });
export const deleteProject = (id) => request(`/api/projects/${id}`, { method: 'DELETE' });

// Mentoring
export const getMentor = () => request('/api/mentor');
export const listMentees = () => request('/api/mentees').then(list);
export const listMentors = () => request('/api/mentors').then(list);
export const assignMentor = (studentId, teacher) => request(`/api/mentors/${enc(studentId)}`, { method: 'PUT', body: { teacher } });
export const listConversations = () => request('/api/conversations').then(list);
export const listMessages = (withUser) => request(`/api/messages?with=${enc(withUser)}`).then(list);
export const sendMessage = (to, body) => request('/api/messages', { method: 'POST', body: { to, body } });
export const listSessions = () => request('/api/sessions').then(list);
export const getBusy = (date) => request(`/api/sessions/busy?date=${enc(date)}`);
export const bookSession = (s) => request('/api/sessions', { method: 'POST', body: s });
export const updateSession = (id, s) => request(`/api/sessions/${id}`, { method: 'PUT', body: s });

// Leave
export const listLeaves = () => request('/api/leaves').then(list);
export const getLeaveBalance = () => request('/api/leaves/balance').then(list);
export const applyLeave = (l) => request('/api/leaves', { method: 'POST', body: l });
export const updateLeave = (id, l) => request(`/api/leaves/${id}`, { method: 'PUT', body: l });

// Runs `load` whenever deps change. Keeps the last data while reloading (and after a failed reload) so views do not flash.
export function useLoad(load, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    load().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (error) => live && setState((s) => ({ data: s.data, error, loading: false })),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

// Re-run `fn` every `ms` while mounted and the tab is visible.
export function usePoll(fn, ms) {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && latest.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}
