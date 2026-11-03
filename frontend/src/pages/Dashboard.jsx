import { BadgeCheck, BookOpen, CalendarCheck, Clock, Sigma, TriangleAlert, Trophy, Users } from 'lucide-react';
import { getReports, getScheme, listRecords, listTimetable, safe, useLoad } from '../lib/api';
import { attOf, componentData, fmt, gradeData, greeting, nowMinutes, pctText, resultsText, toMinutes, todayIndex } from '../lib/stats';
import { BarCard, ErrorBanner, Loading, StatCard } from '../components/ui';
import { Feed } from './Announcements';

const MARKS_AND_ATTENDANCE = [
  { key: 'value', label: 'Average %', color: '#f26b1d' },
  { key: 'attendance', label: 'Attendance %', color: '#3d7be0' },
];
const toChart = (rows, key) => rows.map((r) => ({ label: r[key], value: r.average, attendance: r.attendance }));

// Today's lesson in progress, else the next one today.
function nextLesson(slots) {
  const now = nowMinutes();
  const today = slots.filter((s) => s.day === todayIndex()).sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
  const current = today.find((s) => toMinutes(s.start_time) <= now && now < toMinutes(s.end_time));
  if (current) return { slot: current, now: true };
  const next = today.find((s) => toMinutes(s.start_time) > now);
  return next ? { slot: next, now: false } : null;
}

function Greeting({ user, slots }) {
  const first = (user.name || user.username).split(' ')[0];
  const lesson = nextLesson(slots);
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {greeting()}, {first}
        </h1>
        <p className="mt-0.5 text-sm text-white/70">{date}</p>
      </div>
      <a href="#/timetable" className="flex items-center gap-2 rounded-2xl bg-white/10 px-3.5 py-2 text-sm ring-1 ring-white/10 hover:bg-white/15">
        <Clock size={16} className="text-accent" aria-hidden="true" />
        {lesson ? (
          <span>
            {lesson.now ? 'Now' : 'Next'}: <strong>{lesson.slot.course}</strong> {lesson.slot.start_time}-{lesson.slot.end_time}
            {lesson.slot.room ? `, ${lesson.slot.room}` : ''}
            {lesson.slot.class_name && user.role !== 'student' ? ` (${lesson.slot.class_name})` : ''}
          </span>
        ) : (
          <span>No more lessons today</span>
        )}
      </a>
    </div>
  );
}

function AtRisk({ records }) {
  const risky = records.filter((r) => r.result === 'fail' || r.result === 'shortage');
  if (!risky.length) return null;
  return (
    <section role="alert" aria-labelledby="risk-title" className="rounded-2xl bg-bad/20 p-4 text-white ring-1 ring-bad/40">
      <h2 id="risk-title" className="flex items-center gap-2 font-semibold">
        <TriangleAlert size={18} aria-hidden="true" /> {risky.length === 1 ? '1 subject needs' : `${risky.length} subjects need`} your attention
      </h2>
      <ul className="mt-2 grid gap-2 text-sm">
        {risky.map((r) => (
          <li key={r.id}>
            <strong>{r.subject}</strong>: {r.result === 'shortage' ? 'attendance is too low, so you may not be allowed to pass this subject until it improves' : 'not passing yet'}
            {r.reasons?.length ? <span className="text-white/80"> ({r.reasons.join('; ')})</span> : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-white/75">Talk to your subject teacher or mentor about how to catch up.</p>
    </section>
  );
}

function StudentDashboard({ user, report, records, slots }) {
  const decided = (report.results.pass ?? 0) + (report.results.fail ?? 0) + (report.results.shortage ?? 0);
  return (
    <div className="grid gap-4">
      <Greeting user={user} slots={slots} />
      <AtRisk records={records} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="My average" icon={Sigma} iconClass="bg-warn/15 text-warn" value={fmt(report.average)} unit="%" foot="Over the parts assessed so far" />
        <StatCard title="Attendance" icon={CalendarCheck} iconClass="bg-info/12 text-info" value={pctText(report.attendance)} foot="Classes attended overall" />
        <StatCard title="Subjects passed" icon={BadgeCheck} iconClass="bg-good/12 text-good" value={decided ? `${report.results.pass ?? 0}/${decided}` : '-'} foot={resultsText(report.results)} />
        <StatCard title="Subjects" icon={BookOpen} iconClass="bg-rose/12 text-rose" value={records.length} unit="enrolled" foot={records[0] ? `${records[0].class_name} · Semester ${records[0].semester}` : 'No marks yet'} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <BarCard
          title="My subjects"
          sub="Score so far and attendance, as percentages"
          data={records.map((r) => ({ label: r.subject, value: r.marks, attendance: attOf(r) }))}
          series={[
            { key: 'value', label: 'Score %', color: '#f26b1d' },
            { key: 'attendance', label: 'Attendance %', color: '#3d7be0' },
          ]}
          empty="No marks have been entered for you yet."
        />
        <Feed user={user} limit={4} />
      </div>
    </div>
  );
}

function StaffDashboard({ user, report, records, scheme, slots }) {
  const students = new Set(records.map((r) => r.student_id)).size;
  return (
    <div className="grid gap-4">
      <Greeting user={user} slots={slots} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Students" icon={Users} iconClass="bg-info/12 text-info" value={students} foot={`${records.length} subject results, ${report.classes.length} classes`} />
        <StatCard title="Pass rate" icon={BadgeCheck} iconClass="bg-good/12 text-good" value={pctText(report.pass_rate)} foot={resultsText(report.results)} />
        <StatCard title="Attendance" icon={CalendarCheck} iconClass="bg-warn/15 text-warn" value={pctText(report.attendance)} foot={`Average score ${fmt(report.average)}%`} />
        <StatCard
          title="Topper"
          icon={Trophy}
          iconClass="bg-rose/12 text-rose"
          value={report.topper ? `${fmt(report.topper.average)}%` : '-'}
          foot={report.topper ? `${report.topper.name} (${report.topper.student_id})` : 'No records yet'}
        />
      </div>

      {records.length === 0 && (
        <p className="card text-sm">
          No records yet.{' '}
          <a href="#/records" className="font-semibold text-accent-deep underline underline-offset-2">
            Add one
          </a>{' '}
          or{' '}
          <a href="#/import" className="font-semibold text-accent-deep underline underline-offset-2">
            import a spreadsheet
          </a>
          .
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <BarCard title="Assessment averages" sub="Average score in each part, as a percent of its maximum" data={componentData(report.components)} series={[{ key: 'value', label: 'Average % of max', color: '#f26b1d' }]} />
        <BarCard title="Grade distribution" sub="Subject results per grade (pending results not counted)" data={gradeData(report.grades, scheme)} series={[{ key: 'value', label: 'Results', color: '#f26b1d' }]} max={null} />
        <BarCard title="Subject-wise average" sub="Mean score and attendance per subject" data={toChart(report.subjects, 'subject')} series={MARKS_AND_ATTENDANCE} />
        <BarCard title="Class-wise average" sub="Mean score and attendance per class" data={toChart(report.classes, 'class_name')} series={MARKS_AND_ATTENDANCE} />
      </div>
      <Feed user={user} limit={5} />
    </div>
  );
}

export default function Dashboard({ user }) {
  const { data, error, reload } = useLoad(() => Promise.all([getReports(), listRecords(), safe(getScheme(), null), safe(listTimetable(), [])]), []);
  if (error && !data) return <ErrorBanner error={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading dashboard" />;
  const [report, records, scheme, slots] = data;
  return user.role === 'student' ? (
    <StudentDashboard user={user} report={report} records={records} slots={slots} />
  ) : (
    <StaffDashboard user={user} report={report} records={records} scheme={scheme} slots={slots} />
  );
}
