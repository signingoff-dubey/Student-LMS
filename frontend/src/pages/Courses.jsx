import { useState } from 'react';
import { BookMarked, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { deleteCourse, getCourse, listCourses, listUsers, safe, saveCourse, useLoad } from '../lib/api';
import { attendancePct, fmt, pctText } from '../lib/stats';
import { toast } from '../lib/toast';
import { ConfirmDialog, Empty, ErrorBanner, Field, FormError, Loading, Modal } from '../components/ui';

const EMPTY = { code: '', name: '', credits: '', department: '', semester: '', teacher: '' };

function CourseForm({ initial, teachers, onSaved, onCancel }) {
  const [form, setForm] = useState(() => (initial ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, initial[k] == null ? '' : String(initial[k])])) : EMPTY));
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const found = {};
    for (const k of ['code', 'name', 'department']) if (!form[k].trim()) found[k] = 'Required.';
    const credits = Number(form.credits);
    if (!Number.isInteger(credits) || credits < 1 || credits > 10) found.credits = 'Whole number from 1 to 10.';
    const sem = Number(form.semester);
    if (!Number.isInteger(sem) || sem < 1 || sem > 12) found.semester = 'Whole number from 1 to 12.';
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementById(`c-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      await saveCourse(initial?.id, { code: form.code.trim(), name: form.name.trim(), credits, department: form.department.trim(), semester: sem, teacher: form.teacher || null });
      onSaved();
    } catch (err) {
      setServerError(err.message);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <FormError>{serverError}</FormError>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="c-code" label="Code" value={form.code} onChange={set('code')} error={errors.code} placeholder="e.g. CS301" />
        <Field id="c-name" label="Name" value={form.name} onChange={set('name')} error={errors.name} hint="Must match the subject name used in records." />
        <Field id="c-credits" label="Credits (1-10)" type="number" min={1} max={10} value={form.credits} onChange={set('credits')} error={errors.credits} />
        <Field id="c-semester" label="Semester (1-12)" type="number" min={1} max={12} value={form.semester} onChange={set('semester')} error={errors.semester} />
        <Field id="c-department" label="Department" value={form.department} onChange={set('department')} error={errors.department} />
        <Field id="c-teacher" label="Teacher" as="select" value={form.teacher} onChange={set('teacher')}>
          <option value="">Unassigned</option>
          {teachers.map((t) => (
            <option key={t.username} value={t.username}>
              {t.name || t.username}
            </option>
          ))}
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-ghost">
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Saving...' : initial ? 'Save changes' : 'Add course'}
        </button>
      </div>
    </form>
  );
}

function Roster({ id }) {
  const { data, error } = useLoad(() => getCourse(id), [id]);
  if (error) return <FormError>{error.message}</FormError>;
  if (!data) return <p role="status" className="py-6 text-sm text-ink/60">Loading roster...</p>;
  const roster = data.roster ?? [];
  if (!roster.length) return <Empty icon={Users} title="No students yet" hint={`Students appear when they have a record for the subject "${data.name}".`} />;
  return (
    <div className="max-h-[60vh] overflow-auto">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 border-b border-line/70 bg-card text-xs uppercase tracking-wide text-ink/60">
          <tr>
            <th scope="col" className="py-2 pr-3 font-semibold">Student</th>
            <th scope="col" className="px-2 py-2 font-semibold">Class</th>
            <th scope="col" className="px-2 py-2 text-right font-semibold">Score</th>
            <th scope="col" className="py-2 pl-2 text-right font-semibold">Attend.</th>
          </tr>
        </thead>
        <tbody>
          {roster.map((s) => (
            <tr key={s.student_id} className="border-b border-line/40 last:border-0">
              <th scope="row" className="py-2 pr-3 text-left font-normal">
                <span className="font-medium">{s.name}</span> <span className="text-xs text-ink/60">{s.student_id}</span>
              </th>
              <td className="px-2 py-2">{s.class_name}</td>
              <td className="px-2 py-2 text-right tabular">{s.marks == null ? '-' : `${fmt(s.marks)}%`}</td>
              <td className="py-2 pl-2 text-right tabular">{pctText(attendancePct(s.attended, s.total))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Courses({ user }) {
  const isAdmin = user.role === 'admin';
  const { data, error, reload } = useLoad(() => Promise.all([listCourses(), isAdmin ? safe(listUsers(), []) : Promise.resolve([])]), [isAdmin]);
  const [editing, setEditing] = useState(null);
  const [roster, setRoster] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [removeError, setRemoveError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  if (error && !data) return <ErrorBanner error={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading courses" />;
  const [courses, users] = data;
  const teachers = users.filter((u) => u.role === 'teacher');

  const confirmDelete = async () => {
    setDeleting(true);
    setRemoveError(null);
    try {
      await deleteCourse(removing.id);
      toast(`${removing.code} deleted.`);
      setRemoving(null);
      reload();
    } catch (err) {
      setRemoveError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="grid gap-4">
      {isAdmin && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-white/70">A course name must match the subject name used in records, so marks and rosters line up.</p>
          <button type="button" onClick={() => setEditing({})} className="btn-primary">
            <Plus size={16} aria-hidden="true" /> Add course
          </button>
        </div>
      )}
      {courses.length === 0 ? (
        <div className="card">
          <Empty icon={BookMarked} title="No courses yet" hint={isAdmin ? 'Add a course for each subject taught.' : 'Courses you take or teach will be listed here.'} />
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {courses.map((c) => (
            <li key={c.id} className="card flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-accent-deep">{c.code}</p>
                  <h2 className="truncate text-lg font-semibold">{c.name}</h2>
                </div>
                <span className="shrink-0 rounded-full bg-ink/5 px-2.5 py-1 text-xs font-semibold tabular">{c.credits} credits</span>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-ink/55">Department</dt>
                  <dd>{c.department}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink/55">Semester</dt>
                  <dd>{c.semester}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink/55">Teacher</dt>
                  <dd>{c.teacher_name || c.teacher || 'Unassigned'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink/55">Students</dt>
                  <dd className="tabular">{c.students ?? '-'}</dd>
                </div>
              </dl>
              {user.role !== 'student' && (
                <div className="mt-auto flex flex-wrap gap-2 border-t border-line/50 pt-3">
                  <button type="button" onClick={() => setRoster(c)} className="btn-ghost h-8 px-3 text-xs">
                    <Users size={14} aria-hidden="true" /> Roster
                  </button>
                  {isAdmin && (
                    <>
                      <button type="button" onClick={() => setEditing(c)} className="btn-ghost h-8 px-3 text-xs" aria-label={`Edit ${c.code}`}>
                        <Pencil size={14} aria-hidden="true" /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRemoveError(null);
                          setRemoving(c);
                        }}
                        className="btn h-8 px-3 text-xs text-bad hover:bg-bad/10"
                        aria-label={`Delete ${c.code}`}
                      >
                        <Trash2 size={14} aria-hidden="true" /> Delete
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Edit ${editing.code}` : 'Add course'}>
        {editing && (
          <CourseForm
            initial={editing.id ? editing : null}
            teachers={teachers}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              toast(editing.id ? 'Course updated.' : 'Course added.');
              setEditing(null);
              reload();
            }}
          />
        )}
      </Modal>
      <Modal open={!!roster} onClose={() => setRoster(null)} title={roster ? `${roster.code} ${roster.name}: roster` : ''}>
        {roster && <Roster id={roster.id} />}
      </Modal>
      <ConfirmDialog open={!!removing} title="Delete course?" busy={deleting} error={removeError} onConfirm={confirmDelete} onCancel={() => setRemoving(null)}>
        {removing && (
          <p>
            Delete <strong>{removing.code} {removing.name}</strong>? This cannot be undone.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
