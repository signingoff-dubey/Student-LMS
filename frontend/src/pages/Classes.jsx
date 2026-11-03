import { useState } from 'react';
import { School, Trash2 } from 'lucide-react';
import { assignClass, deleteClass, listClasses, listUsers, useLoad } from '../lib/api';
import { fmt } from '../lib/stats';
import { toast } from '../lib/toast';
import { CardTitle, ConfirmDialog, Empty, ErrorBanner, Loading } from '../components/ui';

export default function Classes() {
  const { data, error, reload } = useLoad(() => Promise.all([listClasses(), listUsers()]), []);
  const [saving, setSaving] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [removeError, setRemoveError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  if (error && !data) return <ErrorBanner error={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading classes" />;

  const [classes, users] = data;
  const teachers = users.filter((u) => u.role === 'teacher');

  const assign = async (cls, teacher) => {
    setSaving(cls.name);
    try {
      await assignClass(cls.name, teacher || null);
      const t = teachers.find((u) => u.username === teacher);
      toast(teacher ? `${cls.name} assigned to ${t?.name || teacher}.` : `${cls.name} is now unassigned.`);
      reload();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setSaving(null);
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    setRemoveError(null);
    try {
      await deleteClass(removing.name);
      toast(`${removing.name} deleted.`);
      setRemoving(null);
      reload();
    } catch (err) {
      setRemoveError(err.status === 409 ? `${err.message} Move or delete its records first.` : err.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="grid gap-4">
      <section className="card overflow-hidden !p-0" aria-labelledby="classes-title">
        <div className="p-4 pb-0 sm:p-5 sm:pb-0">
          <CardTitle id="classes-title" sub="Classes appear automatically when an upload or record mentions a new class name. A teacher sees only their classes.">
            Classes
          </CardTitle>
        </div>
        {teachers.length === 0 && classes.length > 0 && (
          <p className="px-4 pb-3 text-sm text-ink/70 sm:px-5">
            No teachers yet.{' '}
            <a href="#/teachers" className="font-semibold text-accent-deep underline underline-offset-2">
              Add a teacher
            </a>{' '}
            to assign classes.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-y border-line/70 text-xs uppercase tracking-wide text-ink/60">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Class</th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">Students</th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">Average</th>
                <th scope="col" className="px-3 py-3 font-semibold">Teacher</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {classes.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <Empty icon={School} title="No classes yet" hint="Import a spreadsheet or add a record with a class name and it shows up here." />
                  </td>
                </tr>
              ) : (
                classes.map((c) => (
                  <tr key={c.name} className="border-b border-line/40 last:border-0">
                    <th scope="row" className="px-4 py-2.5 text-left font-medium">
                      {c.name}
                    </th>
                    <td className="px-3 py-2.5 text-right tabular">{c.students ?? '-'}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular">{c.average == null ? '-' : `${fmt(c.average)}%`}</td>
                    <td className="px-3 py-2">
                      <label htmlFor={`cls-${c.name}`} className="sr-only">
                        Teacher for {c.name}
                      </label>
                      <select id={`cls-${c.name}`} value={c.teacher ?? ''} onChange={(e) => assign(c, e.target.value)} disabled={saving === c.name} className="field max-w-xs">
                        <option value="">Unassigned</option>
                        {teachers.map((t) => (
                          <option key={t.username} value={t.username}>
                            {t.name ? `${t.name} (${t.username})` : t.username}
                          </option>
                        ))}
                        {c.teacher && !teachers.some((t) => t.username === c.teacher) && <option value={c.teacher}>{c.teacher_name || c.teacher}</option>}
                      </select>
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setRemoveError(null);
                          setRemoving(c);
                        }}
                        aria-label={`Delete class ${c.name}`}
                        className="inline-grid size-9 place-items-center rounded-full text-ink/70 hover:bg-bad/10 hover:text-bad"
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      <ConfirmDialog open={!!removing} title="Delete class?" busy={deleting} error={removeError} onConfirm={confirmDelete} onCancel={() => setRemoving(null)}>
        {removing && (
          <p>
            Delete <strong>{removing.name}</strong>? A class that still has records cannot be deleted.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
