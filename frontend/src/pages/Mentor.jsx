import { useEffect, useState } from 'react';
import { CalendarPlus, Mail, UserRound } from 'lucide-react';
import { bookSession, getBusy, getMentor, useLoad } from '../lib/api';
import { fromMinutes, isoDate, toMinutes } from '../lib/stats';
import { toast } from '../lib/toast';
import { CardTitle, Empty, ErrorBanner, Field, FormError, Loading } from '../components/ui';
import { Chat, SessionList, loadSessions } from '../components/Mentoring';

const DAY_START = 8 * 60;
const DAY_END = 18 * 60;
const SLOTS = Array.from({ length: (DAY_END - DAY_START) / 30 }, (_, i) => DAY_START + i * 30);

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return isoDate(d);
}

function BookForm({ onBooked }) {
  const [date, setDate] = useState(tomorrow);
  const [duration, setDuration] = useState('30');
  const [start, setStart] = useState('');
  const [topic, setTopic] = useState('');
  const [busyInfo, setBusyInfo] = useState(null); // {mentor_on_leave, busy} | 'error'
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!date) return undefined;
    let live = true;
    setBusyInfo(null);
    getBusy(date).then(
      (b) => live && setBusyInfo({ mentor_on_leave: !!b?.mentor_on_leave, busy: b?.busy ?? [] }),
      () => live && setBusyInfo('error'),
    );
    return () => {
      live = false;
    };
  }, [date]);

  const dur = Number(duration);
  const taken = (m) =>
    busyInfo && busyInfo !== 'error' && (busyInfo.mentor_on_leave || busyInfo.busy.some((b) => m < toMinutes(b.end_time) && m + dur > toMinutes(b.start_time)));

  useEffect(() => {
    if (start && taken(toMinutes(start))) setStart('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busyInfo, duration]);

  const submit = async (e) => {
    e.preventDefault();
    const found = {};
    if (!date || date <= isoDate()) found.date = 'Pick a date after today.';
    if (!start) found.start = 'Pick a free time.';
    if (!topic.trim()) found.topic = 'Say briefly what you want to talk about.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    setServerError(null);
    try {
      await bookSession({ date, start_time: start, duration: dur, topic: topic.trim() });
      toast('Session requested. Your mentor will confirm it.');
      setStart('');
      setTopic('');
      onBooked();
    } catch (err) {
      setServerError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card" aria-labelledby="book-title">
      <CardTitle id="book-title" sub="Greyed-out times clash with your mentor's lessons or other sessions.">
        Book a session
      </CardTitle>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <FormError>{serverError}</FormError>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="b-date" label="Date" type="date" min={tomorrow()} value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} />
          <Field id="b-dur" label="Length" as="select" value={duration} onChange={(e) => setDuration(e.target.value)}>
            <option value="30">30 minutes</option>
            <option value="45">45 minutes</option>
            <option value="60">60 minutes</option>
          </Field>
        </div>
        <fieldset aria-describedby={errors.start ? 'b-start-err' : 'b-start-help'}>
          <legend className="mb-1 text-sm font-medium">Start time</legend>
          <p id="b-start-help" role="status" className="mb-2 text-xs text-ink/60">
            {!busyInfo
              ? 'Checking your mentor’s day...'
              : busyInfo === 'error'
                ? 'Could not check your mentor’s day; any time can be requested.'
                : busyInfo.mentor_on_leave
                  ? 'Your mentor is on leave that day. Pick another date.'
                  : `${busyInfo.busy.length} busy period${busyInfo.busy.length === 1 ? '' : 's'} that day.`}
          </p>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
            {SLOTS.map((m) => {
              const t = fromMinutes(m);
              const off = taken(m) || m + dur > DAY_END;
              const on = start === t;
              return (
                <button
                  key={m}
                  type="button"
                  disabled={off}
                  aria-pressed={on}
                  onClick={() => setStart(t)}
                  className={`h-9 rounded-lg text-sm tabular transition-colors ${
                    on ? 'bg-accent font-semibold text-on-accent' : off ? 'cursor-not-allowed bg-ink/5 text-ink/30 line-through' : 'bg-white ring-1 ring-line hover:ring-accent'
                  }`}
                >
                  {t}
                  {off && <span className="sr-only"> (busy)</span>}
                </button>
              );
            })}
          </div>
          {errors.start && (
            <p id="b-start-err" className="mt-1 text-xs font-medium text-bad">
              {errors.start}
            </p>
          )}
        </fieldset>
        <Field id="b-topic" label="Topic" value={topic} onChange={(e) => setTopic(e.target.value)} error={errors.topic} placeholder="e.g. Help with CIE 2 revision" maxLength={200} />
        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="btn-primary">
            <CalendarPlus size={16} aria-hidden="true" /> {saving ? 'Requesting...' : 'Request session'}
          </button>
        </div>
      </form>
    </section>
  );
}

export default function Mentor({ user }) {
  const { data: mentor, error, reload } = useLoad(getMentor, []);
  const sessions = useLoad(loadSessions, []);

  if (error && !mentor) {
    if (error.status === 404)
      return (
        <div className="card">
          <Empty icon={UserRound} title="No mentor assigned yet" hint="Your department assigns each student a mentor. Check back soon, or ask the office." />
        </div>
      );
    return <ErrorBanner error={error} onRetry={reload} />;
  }
  if (!mentor) return <Loading label="Loading your mentor" />;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr] xl:items-start">
      <div className="grid gap-4">
        <section className="card flex items-center gap-4" aria-label="Your mentor">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-accent text-lg font-bold text-on-accent" aria-hidden="true">
            {(mentor.name || mentor.username)[0]?.toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-ink/55">Your mentor</p>
            <p className="truncate text-lg font-semibold">{mentor.name || mentor.username}</p>
            {mentor.email && (
              <a href={`mailto:${mentor.email}`} className="inline-flex items-center gap-1 text-sm text-accent-deep underline underline-offset-2">
                <Mail size={13} aria-hidden="true" /> {mentor.email}
              </a>
            )}
          </div>
        </section>
        <Chat me={user.username} withUser={mentor.username} withName={mentor.name} />
      </div>
      <div className="grid gap-4">
        <BookForm onBooked={sessions.reload} />
        {sessions.error && !sessions.data ? <ErrorBanner error={sessions.error} onRetry={sessions.reload} /> : <SessionList user={user} sessions={sessions.data ?? []} reload={sessions.reload} title="My sessions" />}
      </div>
    </div>
  );
}
