import { useEffect, useRef, useState } from 'react';
import { MotionConfig, motion } from 'framer-motion';
import {
  BookMarked,
  BookOpen,
  CalendarDays,
  CalendarOff,
  FileBarChart,
  FileText,
  FileUp,
  FolderKanban,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  Link2,
  LogOut,
  Megaphone,
  MessagesSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  School,
  Table2,
  UserRoundCheck,
  Users,
  UsersRound,
  X,
} from 'lucide-react';
import { LOGOUT_EVENT, getMe, getToken, listConversations, safe, setToken } from './lib/api';
import { Loading, Toaster } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ReportCard from './pages/ReportCard';
import Reports from './pages/Reports';
import Announcements from './pages/Announcements';
import Records from './pages/Records';
import Students from './pages/Students';
import Courses from './pages/Courses';
import Timetable from './pages/Timetable';
import Projects from './pages/Projects';
import Import from './pages/Import';
import Connections from './pages/Connections';
import Mentor from './pages/Mentor';
import Mentees from './pages/Mentees';
import MentorAssignments from './pages/MentorAssignments';
import Leave from './pages/Leave';
import Teachers from './pages/Teachers';
import Classes from './pages/Classes';
import Settings from './pages/Settings';

const ALL = ['admin', 'teacher', 'student'];
const STAFF = ['admin', 'teacher'];

// `roles` may open the page; `nav` (default: roles) see it in the menu. The backend enforces the same rules.
const PAGES = [
  { slug: 'dashboard', section: 'Overview', label: 'Dashboard', icon: LayoutDashboard, roles: ALL, Page: Dashboard, description: '' },
  { slug: 'report-card', section: 'Overview', label: 'Report card', icon: FileText, roles: ALL, nav: ['student'], Page: ReportCard, description: 'Scores, grades and results for the semester.' },
  { slug: 'reports', section: 'Overview', label: 'Reports', icon: FileBarChart, roles: STAFF, Page: Reports, description: 'Pass rates, grades, rankings and class performance, with CSV export.' },
  { slug: 'announcements', section: 'Overview', label: 'Announcements', icon: Megaphone, roles: ALL, Page: Announcements, description: 'Notices for your classes.' },
  { slug: 'subjects', section: 'Academics', label: 'My subjects', icon: BookOpen, roles: ['student'], Page: Records, description: 'Your scores, grades and attendance in each subject.' },
  { slug: 'students', section: 'Academics', label: 'Students', icon: UsersRound, roles: STAFF, Page: Students, description: 'Find a student, see their subjects and open their report card.' },
  { slug: 'records', section: 'Academics', label: 'Records', icon: Table2, roles: STAFF, Page: Records, description: 'Enter CIE and SEE scores and attendance.' },
  { slug: 'courses', section: 'Academics', label: 'Courses', icon: BookMarked, roles: ALL, Page: Courses, description: 'Courses, credits and who teaches them.' },
  { slug: 'timetable', section: 'Academics', label: 'Timetable', icon: CalendarDays, roles: ALL, Page: Timetable, description: 'The weekly lesson plan.' },
  { slug: 'projects', section: 'Academics', label: 'Projects', icon: FolderKanban, roles: ALL, Page: Projects, description: 'Student projects by stage.' },
  { slug: 'import', section: 'Data', label: 'Import', icon: FileUp, roles: STAFF, Page: Import, description: 'Upload scores from an Excel or CSV file.' },
  { slug: 'connections', section: 'Data', label: 'Connections', icon: Link2, roles: STAFF, Page: Connections, description: 'Keep scores in sync with a live spreadsheet.' },
  { slug: 'mentor', section: 'People', label: 'Mentor', icon: MessagesSquare, roles: ['student'], Page: Mentor, description: 'Message your mentor and book a session.', badge: 'unread' },
  { slug: 'mentees', section: 'People', label: 'Mentees', icon: MessagesSquare, roles: ['teacher'], Page: Mentees, description: 'Messages and session requests from your mentees.', badge: 'unread' },
  { slug: 'mentors', section: 'People', label: 'Mentor assignments', icon: UserRoundCheck, roles: ['admin'], Page: MentorAssignments, description: 'Give every student a mentor.' },
  { slug: 'leave', section: 'People', label: { admin: 'Leave approvals', teacher: 'Leave' }, icon: CalendarOff, roles: STAFF, Page: Leave, description: { admin: 'Approve or reject teachers’ leave.', teacher: 'Your balance, requests and history.' } },
  { slug: 'teachers', section: 'People', label: 'Teachers', icon: Users, roles: ['admin'], Page: Teachers, description: 'Create and remove teacher accounts.' },
  { slug: 'classes', section: 'People', label: 'Classes', icon: School, roles: ['admin'], Page: Classes, description: 'Class teachers, sizes and averages.' },
  { slug: 'settings', section: 'Account', label: 'Profile & settings', icon: KeyRound, roles: ALL, Page: Settings, description: 'Your details and password.' },
];
const BOTTOM = { student: ['dashboard', 'timetable', 'mentor', 'report-card'], teacher: ['dashboard', 'records', 'timetable', 'mentees'], admin: ['dashboard', 'records', 'students', 'leave'] };

const byRole = (v, role) => (typeof v === 'object' ? v[role] : v);
const nudgeKey = (user) => `sr-pw-nudge-dismissed:${user.username}`;
const parseHash = (h) => {
  const [slug = '', ...rest] = h.replace(/^#\/?/, '').split('/');
  return { slug, param: rest.length ? decodeURIComponent(rest.join('/')) : undefined };
};

// Labels fade instead of unmounting, so the link keeps its accessible name while the rail is collapsed.
const fade = (shown) => `transition-opacity ${shown ? 'opacity-100 duration-200 delay-100' : 'opacity-0 duration-100'}`;

const Badge = ({ n, dot }) =>
  n > 0 ? (
    dot ? (
      <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent ring-2 ring-[#1c1815]" aria-hidden="true" />
    ) : (
      <span className="ml-auto rounded-md bg-accent/25 px-1.5 text-xs font-semibold text-white tabular" aria-hidden="true">
        {n}
      </span>
    )
  ) : null;

function NavLink({ page, role, active, expanded = true, badge = 0, pillId, onNavigate }) {
  const Icon = page.icon;
  const label = byRole(page.label, role);
  return (
    <a
      href={`#/${page.slug}`}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      aria-label={badge ? `${label}, ${badge} unread` : undefined}
      title={expanded ? undefined : label}
      className={`relative flex h-10 shrink-0 items-center gap-3 rounded-xl px-[11px] text-sm font-medium transition-colors ${active ? 'text-on-accent' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
    >
      {active && <motion.span layoutId={pillId} className="absolute inset-0 rounded-xl bg-accent shadow-[0_8px_22px_-10px_var(--color-accent)]" transition={{ type: 'spring', stiffness: 500, damping: 40 }} aria-hidden="true" />}
      <Icon size={18} className="relative shrink-0" aria-hidden="true" />
      <span className={`relative min-w-0 flex-1 truncate whitespace-nowrap ${fade(expanded)}`}>{label}</span>
      {expanded ? <Badge n={badge} /> : <Badge n={badge} dot />}
    </a>
  );
}

// Menu grouped by section.
function NavSections({ pages, role, current, expanded, badges, pillId, onNavigate }) {
  const sections = [...new Set(pages.map((p) => p.section))];
  return sections.map((s) => (
    <div key={s} className="flex flex-col gap-1">
      <p className={`mt-3 h-4 truncate px-[11px] text-[11px] font-semibold uppercase tracking-wider text-white/45 first:mt-0 ${fade(expanded)}`} aria-hidden={!expanded}>
        {expanded ? s : ''}
      </p>
      {!expanded && <span className="-mt-3 mx-3 mb-1 h-px bg-white/10" aria-hidden="true" />}
      {pages
        .filter((p) => p.section === s)
        .map((p) => (
          <NavLink key={p.slug} page={p} role={role} active={p === current} expanded={expanded} badge={badges[p.badge] ?? 0} pillId={pillId} onNavigate={onNavigate} />
        ))}
    </div>
  ));
}

// Phone menu: a sheet with every page, opened from the bottom bar.
function MoreSheet({ open, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-label="All pages" className="glass-panel mb-0 mt-auto max-h-[85dvh] w-full max-w-none rounded-t-[28px] p-3 pb-6 text-white backdrop:bg-black/50 backdrop:backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-between px-2">
        <p className="font-semibold">All pages</p>
        <button type="button" onClick={onClose} aria-label="Close menu" className="grid size-10 place-items-center rounded-xl text-white/70 hover:bg-white/10 hover:text-white">
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      {open && <nav aria-label="All pages">{children}</nav>}
    </dialog>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(() => !!getToken());
  const [hash, setHash] = useState(window.location.hash);
  const [expanded, setExpanded] = useState(() => localStorage.getItem('rail') !== 'closed');
  const [nudge, setNudge] = useState(false);
  const [unread, setUnread] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);

  // Restore the session from a stored token.
  useEffect(() => {
    if (!getToken()) return;
    getMe()
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    const onHash = () => {
      setHash(window.location.hash);
      setMoreOpen(false);
      document.getElementById('main')?.scrollTo({ top: 0 });
    };
    const onLogout = () => setUser(null);
    window.addEventListener('hashchange', onHash);
    window.addEventListener(LOGOUT_EVENT, onLogout);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener(LOGOUT_EVENT, onLogout);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('rail', expanded ? 'open' : 'closed');
  }, [expanded]);

  // Students start with their student ID as password: nudge them until they change it or dismiss the banner.
  useEffect(() => {
    setNudge(user?.role === 'student' && !localStorage.getItem(nudgeKey(user)));
  }, [user]);

  // Unread messages badge (mentor chat). Re-checked on navigation and every 30 s.
  useEffect(() => {
    if (!user || user.role === 'admin') return undefined;
    let live = true;
    const check = () => safe(listConversations(), []).then((cs) => live && setUnread(cs.reduce((n, c) => n + (Number(c.unread) || 0), 0)));
    check();
    const t = setInterval(check, 30000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [user, hash]);

  const role = user?.role;
  const allowed = user ? PAGES.filter((p) => p.roles.includes(role)) : [];
  const navPages = allowed.filter((p) => (p.nav ?? p.roles).includes(role));
  const { slug, param } = parseHash(hash);
  const page = allowed.find((p) => p.slug === slug) ?? allowed[0];
  const label = page ? byRole(page.label, role) : '';

  useEffect(() => {
    document.title = page ? `${label} - Student Records` : 'Sign in - Student Records';
  }, [page, label]);

  const dismissNudge = () => {
    localStorage.setItem(nudgeKey(user), '1');
    setNudge(false);
  };
  const signIn = ({ token, ...me }) => {
    setToken(token);
    setUser(me);
  };
  const signOut = () => {
    setToken(null);
    setUser(null);
  };

  if (checking || !user) {
    return (
      <MotionConfig reducedMotion="user">
        <div className="app-backdrop" aria-hidden="true" />
        {checking ? (
          <main className="mx-auto grid min-h-dvh max-w-3xl place-items-center p-6">
            <div className="w-full">
              <Loading label="Checking your session" />
            </div>
          </main>
        ) : (
          <Login onSignedIn={signIn} />
        )}
        <Toaster />
      </MotionConfig>
    );
  }

  const { Page } = page;
  const badges = { unread };
  const bottom = BOTTOM[role].map((s) => navPages.find((p) => p.slug === s)).filter(Boolean);
  const roleLabel = role[0].toUpperCase() + role.slice(1);

  return (
    <MotionConfig reducedMotion="user">
      <button type="button" onClick={() => document.getElementById('main')?.focus()} className="btn-primary sr-only fixed left-4 top-4 z-50 focus:not-sr-only print:hidden">
        Skip to content
      </button>
      <div className="app-backdrop" aria-hidden="true" />
      <div className="flex h-dvh gap-3 p-2 sm:p-3 print:block print:h-auto print:p-0">
        <aside className={`glass-panel hidden shrink-0 flex-col rounded-[28px] px-[11px] py-3 transition-[width] duration-300 lg:flex print:hidden ${expanded ? 'w-64' : 'w-16'}`}>
          <div className="flex h-10 shrink-0 items-center gap-3 overflow-hidden px-[7px]">
            <span className="grid size-[26px] shrink-0 place-items-center rounded-lg bg-accent text-on-accent" aria-hidden="true">
              <GraduationCap size={16} />
            </span>
            <span className={`whitespace-nowrap font-semibold ${fade(expanded)}`}>Student Records</span>
          </div>
          <nav aria-label="Main" className="-mx-1 mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <NavSections pages={navPages} role={role} current={page} expanded={expanded} badges={badges} pillId="rail-pill" />
          </nav>
          <div className="mt-2 flex shrink-0 flex-col gap-1 border-t border-white/10 pt-2">
            <button
              type="button"
              onClick={signOut}
              title={expanded ? undefined : 'Sign out'}
              className="flex h-10 items-center gap-3 overflow-hidden rounded-xl px-[11px] text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white"
            >
              <LogOut size={18} className="shrink-0" aria-hidden="true" />
              <span className={`whitespace-nowrap ${fade(expanded)}`}>Sign out</span>
            </button>
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
              title={expanded ? undefined : 'Expand sidebar'}
              className="flex h-10 items-center gap-3 overflow-hidden rounded-xl px-[11px] text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white"
            >
              {expanded ? <PanelLeftClose size={18} className="shrink-0" aria-hidden="true" /> : <PanelLeftOpen size={18} className="shrink-0" aria-hidden="true" />}
              <span className={`whitespace-nowrap ${fade(expanded)}`}>Collapse</span>
            </button>
          </div>
        </aside>

        <main
          id="main"
          tabIndex={-1}
          className="glass-panel min-w-0 flex-1 overflow-y-auto rounded-[28px] p-4 pb-28 focus:outline-none sm:p-6 sm:pb-28 lg:pb-6 print:overflow-visible print:rounded-none print:p-0 print:text-ink"
        >
          <header className={`mb-5 flex flex-wrap items-start justify-between gap-3 print:hidden ${page.slug === 'dashboard' ? 'lg:justify-end' : ''}`}>
            <div className={page.slug === 'dashboard' ? 'flex items-center gap-2 lg:hidden' : ''}>
              {page.slug === 'dashboard' ? (
                <>
                  <span className="grid size-[26px] place-items-center rounded-lg bg-accent text-on-accent" aria-hidden="true">
                    <GraduationCap size={16} />
                  </span>
                  <span className="font-semibold">Student Records</span>
                </>
              ) : (
                <>
                  <h1 className="text-2xl font-semibold tracking-tight">{label}</h1>
                  <p className="mt-0.5 text-sm text-white/70">{byRole(page.description, role)}</p>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <a href="#/settings" className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm hover:bg-white/10">
                <span className="grid size-8 place-items-center rounded-full bg-white/15 font-semibold" aria-hidden="true">
                  {(user.name || user.username)[0]?.toUpperCase()}
                </span>
                <span className="leading-tight">
                  <span className="block max-w-[10rem] truncate font-medium">{user.name || user.username}</span>
                  <span className="block text-xs text-white/60">{roleLabel}</span>
                </span>
              </a>
              <button type="button" onClick={signOut} aria-label="Sign out" title="Sign out" className="grid size-9 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white lg:hidden">
                <LogOut size={17} aria-hidden="true" />
              </button>
            </div>
          </header>

          {nudge && (
            <div role="status" className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl bg-warn/20 px-4 py-3 text-sm text-white ring-1 ring-warn/40 print:hidden">
              <KeyRound size={18} className="shrink-0" aria-hidden="true" />
              <p className="min-w-0 flex-1">
                You are still using your first password (your student ID). Please{' '}
                <a href="#/settings" className="font-semibold underline underline-offset-2">
                  change it in Profile &amp; settings
                </a>
                .
              </p>
              <button type="button" onClick={dismissNudge} aria-label="Dismiss password reminder" className="grid size-8 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )}

          <motion.div key={`${page.slug}/${param ?? ''}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}>
            <Page user={user} param={param} onPasswordChanged={dismissNudge} />
          </motion.div>
        </main>
      </div>

      {/* Phone bottom bar: four main pages and a sheet with the rest. */}
      <nav aria-label="Quick" className="glass-chip fixed inset-x-3 bottom-3 z-40 flex items-center justify-around gap-1 rounded-[22px] p-1.5 lg:hidden print:hidden">
        {bottom.map((p) => {
          const Icon = p.icon;
          const active = p === page;
          const n = p.badge ? badges[p.badge] : 0;
          return (
            <a
              key={p.slug}
              href={`#/${p.slug}`}
              aria-current={active ? 'page' : undefined}
              aria-label={n ? `${byRole(p.label, role)}, ${n} unread` : undefined}
              className={`relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-2xl px-1 py-1.5 text-[11px] font-medium ${active ? 'text-on-accent' : 'text-white/70'}`}
            >
              {active && <motion.span layoutId="bottom-pill" className="absolute inset-0 rounded-2xl bg-accent" transition={{ type: 'spring', stiffness: 500, damping: 40 }} aria-hidden="true" />}
              <Icon size={19} className="relative" aria-hidden="true" />
              <span className="relative max-w-full truncate">{byRole(p.label, role).split(' ')[0]}</span>
              <Badge n={n} dot />
            </a>
          );
        })}
        <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" className="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-2xl px-1 py-1.5 text-[11px] font-medium text-white/70">
          <MoreHorizontal size={19} aria-hidden="true" />
          More
        </button>
      </nav>
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)}>
        <NavSections pages={navPages} role={role} current={page} expanded badges={badges} pillId="sheet-pill" onNavigate={() => setMoreOpen(false)} />
      </MoreSheet>
      <Toaster />
    </MotionConfig>
  );
}
