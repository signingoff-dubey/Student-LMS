import { useEffect, useState } from 'react';
import { CalendarDays, Plus } from 'lucide-react';
import { deleteSlot, listClasses, listCourses, listTimetable, listUsers, safe, saveSlot, useLoad } from '../lib/api';
import { DAYS, nowMinutes, toMinutes, todayIndex } from '../lib/stats';
import { toast } from '../lib/toast';
import { Empty, ErrorBanner, Field, FormError, Loading, Modal } from '../components/ui';

const PX_PER_MIN = 1.1;
const EMPTY = { class_name: '', day: '0', start_time: '09:00', end_time: '10:00', course: '', room: '', teacher: '' };

function SlotForm({ initial, isAdmin, options, onDone, onCancel }) {
  const [form, setForm] = useState(() => (initial?.id ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, initial[k] == null ? '' : String(initial[k])])) : { ...EMPTY, ...initial }));
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const found = {};
    for (const k of ['class_name', 'course', 'start_time', 'end_time']) if (!form[k].trim()) found[k] = 'Required.';
    if (!found.end_time && !found.start_time && toMinutes(form.end_time) <= toMinutes(form.start_time)) found.end_time = 'Must be after the start time.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setServerError(null);
    try {
      const body = { class_name: form.class_name.trim(), day: Number(form.day), start_time: form.start_time, end_time: form.end_time, course: form.course.trim(), room: form.room.trim() };
      if (isAdmin) body.teacher = form.teacher || null;
      await saveSlot(initial?.id, body);
      toast(initial?.id ? 'Lesson updated.' : 'Lesson added.');
      onDone();
    } catch (err) {
      setServerError(err.message);
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteSlot(initial.id);
      toast('Lesson removed.');
      onDone();
    } catch (err) {
      setServerError(err.message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <FormError>{serverError}</FormError>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="s-course" label="Course" value={form.course} onChange={set('course')} error={errors.course} list="dl-courses" autoComplete="off" />
        <Field id="s-class" label="Class" value={form.class_name} onChange={set('class_name')} error={errors.class_name} list="dl-tt-classes" autoComplete="off" />
        <Field id="s-day" label="Day" as="select" value={form.day} onChange={set('day')}>
          {DAYS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </Field>
        <Field id="s-room" label="Room" value={form.room} onChange={set('room')} placeholder="e.g. B-204" />
        <Field id="s-start" label="Starts" type="time" value={form.start_time} onChange={set('start_time')} error={errors.start_time} />
        <Field id="s-end" label="Ends" type="time" value={form.end_time} onChange={set('end_time')} error={errors.end_time} />
        {isAdmin && (
          <Field id="s-teacher" label="Teacher" as="select" value={form.teacher} onChange={set('teacher')}>
            <option value="">Class teacher / none</option>
            {options.teachers.map((t) => (
              <option key={t.username} value={t.username}>
                {t.name || t.username}
              </option>
            ))}
          </Field>
        )}
      </div>
      <datalist id="dl-courses">
        {options.courses.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="dl-tt-classes">
        {options.classes.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="flex flex-wrap justify-between gap-2">
        {initial?.id ? (
          <button type="button" onClick={remove} disabled={busy} className="btn text-bad hover:bg-bad/10">
            Remove lesson
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </form>
  );
}

// Re-render every minute so "now" stays current.
function useMinute() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60000);
    return () => clearInterval(t);
  }, []);
}

async function loadOptions(isAdmin) {
  const [courses, classes, users] = await Promise.all([safe(listCourses(), []), safe(listClasses(), []), isAdmin ? safe(listUsers(), []) : []]);
  return { courses: courses.map((c) => c.name), classes: classes.map((c) => c.name), teachers: users.filter((u) => u.role === 'teacher') };
}

export default function Timetable({ user }) {
  useMinute();
  const staff = user.role !== 'student';
  const isAdmin = user.role === 'admin';
  const { data: slots, error, reload } = useLoad(listTimetable, []);
  const { data: options } = useLoad(() => (staff ? loadOptions(isAdmin) : Promise.resolve(null)), [staff, isAdmin]);
  const [editing, setEditing] = useState(null);

  if (error && !slots) return <ErrorBanner error={error} onRetry={reload} />;
  if (!slots) return <Loading label="Loading timetable" />;

  const today = todayIndex();
  const now = nowMinutes();
  const days = slots.some((s) => s.day === 6) ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4, 5];
  const starts = slots.map((s) => toMinutes(s.start_time));
  const ends = slots.map((s) => toMinutes(s.end_time));
  const from = Math.min(9 * 60, ...starts.map((m) => Math.floor(m / 60) * 60));
  const to = Math.max(17 * 60, ...ends.map((m) => Math.ceil(m / 60) * 60));
  const height = (to - from) * PX_PER_MIN;
  const hours = Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from + i * 60);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-white/70">{staff ? 'Select a lesson to edit it. Clashes for a class, teacher or room are refused.' : 'Your weekly lessons. Today is highlighted.'}</p>
        {staff && (
          <button type="button" onClick={() => setEditing({ day: String(Math.min(today, 5)) })} className="btn-primary">
            <Plus size={16} aria-hidden="true" /> Add lesson
          </button>
        )}
      </div>

      {slots.length === 0 ? (
        <div className="card">
          <Empty icon={CalendarDays} title="No lessons scheduled" hint={staff ? 'Add the first lesson with the button above.' : 'Your timetable will appear here once lessons are scheduled.'} />
        </div>
      ) : (
        <section className="card overflow-x-auto !p-3 sm:!p-4" aria-label="Weekly timetable">
          <div className="grid min-w-[52rem] gap-x-2" style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(0, 1fr))` }}>
            <div />
            {days.map((d) => (
              <div key={d} className={`mb-2 rounded-xl px-2 py-1.5 text-center text-sm font-semibold ${d === today ? 'bg-accent text-on-accent' : 'text-ink/70'}`} aria-hidden="true">
                {DAYS[d].slice(0, 3)}
              </div>
            ))}

            <div className="relative" style={{ height }} aria-hidden="true">
              {hours.map((m) => (
                <span key={m} className="absolute right-1 -translate-y-1/2 text-[11px] text-ink/50 tabular" style={{ top: (m - from) * PX_PER_MIN }}>
                  {String(m / 60).padStart(2, '0')}:00
                </span>
              ))}
            </div>

            {days.map((d) => {
              const lessons = slots.filter((s) => s.day === d).sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
              const isToday = d === today;
              return (
                <section
                  key={d}
                  aria-label={`${DAYS[d]}${isToday ? ', today' : ''}: ${lessons.length} lesson${lessons.length === 1 ? '' : 's'}`}
                  className={`relative rounded-xl ${isToday ? 'bg-accent/8 ring-1 ring-accent/30' : 'bg-ink/[0.025]'}`}
                  style={{ height, backgroundImage: `repeating-linear-gradient(to bottom, rgb(31 26 20 / 0.08) 0 1px, transparent 1px ${60 * PX_PER_MIN}px)` }}
                >
                  {isToday && now >= from && now <= to && <span className="absolute inset-x-0 z-10 h-0.5 bg-bad" style={{ top: (now - from) * PX_PER_MIN }} aria-hidden="true" />}
                  <ol>
                    {lessons.map((s) => {
                      const start = toMinutes(s.start_time);
                      const end = toMinutes(s.end_time);
                      const current = isToday && start <= now && now < end;
                      const label = `${s.course}, ${s.start_time} to ${s.end_time}${s.room ? `, room ${s.room}` : ''}${s.class_name ? `, ${s.class_name}` : ''}${s.teacher_name ? `, ${s.teacher_name}` : ''}${current ? ', happening now' : ''}`;
                      const body = (
                        <>
                          <span className="block truncate text-xs font-semibold">{s.course}</span>
                          <span className="block truncate text-[11px] opacity-80 tabular">
                            {s.start_time}-{s.end_time}
                            {s.room ? ` · ${s.room}` : ''}
                          </span>
                          {(end - start) * PX_PER_MIN > 52 && <span className="block truncate text-[11px] opacity-80">{staff ? s.class_name : s.teacher_name || s.teacher}</span>}
                        </>
                      );
                      const cls = `absolute inset-x-1 overflow-hidden rounded-lg px-2 py-1 text-left ${current ? 'bg-accent text-on-accent shadow-lg ring-2 ring-accent-deep' : 'bg-white text-ink shadow-sm ring-1 ring-line/70'}`;
                      const style = { top: (start - from) * PX_PER_MIN + 1, height: Math.max(26, (end - start) * PX_PER_MIN - 2) };
                      return (
                        <li key={s.id}>
                          {staff ? (
                            <button type="button" onClick={() => setEditing(s)} aria-label={`Edit ${label}`} className={`${cls} hover:ring-accent`} style={style}>
                              {body}
                            </button>
                          ) : (
                            <div className={cls} style={style} aria-label={label} role="group">
                              {body}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </section>
              );
            })}
          </div>
        </section>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit lesson' : 'Add lesson'}>
        {editing && (
          <SlotForm
            initial={editing}
            isAdmin={isAdmin}
            options={options ?? { courses: [], classes: [], teachers: [] }}
            onCancel={() => setEditing(null)}
            onDone={() => {
              setEditing(null);
              reload();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
