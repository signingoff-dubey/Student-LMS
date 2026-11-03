import { useState } from 'react';
import { FolderKanban, Pencil, Plus, Trash2 } from 'lucide-react';
import { deleteProject, listClasses, listProjects, listStudents, listUsers, safe, saveProject, useLoad } from '../lib/api';
import { cap, num, splitList } from '../lib/stats';
import { toast } from '../lib/toast';
import { ConfirmDialog, Empty, ErrorBanner, Field, FormError, Loading, Modal, StatusChip } from '../components/ui';

const STATUSES = ['proposed', 'in_progress', 'submitted', 'completed'];

function ProjectForm({ initial, isAdmin, onSaved, onCancel }) {
  const { data: opts } = useLoad(
    () =>
      Promise.all([safe(listStudents(), []), safe(listClasses(), []), isAdmin ? safe(listUsers(), []) : []]).then(([students, classes, users]) => ({
        students,
        classes: classes.map((c) => c.name),
        teachers: users.filter((u) => u.role === 'teacher'),
      })),
    [isAdmin],
  );
  const [form, setForm] = useState(() => ({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    class_name: initial?.class_name ?? '',
    guide: initial?.guide ?? '',
    status: initial?.status ?? 'proposed',
    score: initial?.score == null ? '' : String(initial.score),
    members: (initial?.members ?? []).map((m) => m.student_id),
  }));
  const [filter, setFilter] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggle = (id) => setForm((f) => ({ ...f, members: f.members.includes(id) ? f.members.filter((m) => m !== id) : [...f.members, id] }));

  const pool = (opts?.students ?? []).filter(
    (s) => (!form.class_name || splitList(s.classes).includes(form.class_name) || form.members.includes(s.student_id)) && `${s.student_id} ${s.name}`.toLowerCase().includes(filter.toLowerCase()),
  );

  const submit = async (e) => {
    e.preventDefault();
    const found = {};
    if (!form.title.trim()) found.title = 'Required.';
    if (!form.class_name.trim()) found.class_name = 'Required.';
    const score = form.score === '' ? null : Number(form.score);
    if (score != null && (Number.isNaN(score) || score < 0 || score > 100)) found.score = 'Enter 0 to 100, or leave blank.';
    if (!form.members.length) found.members = 'Pick at least one student.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    setServerError(null);
    try {
      const body = { title: form.title.trim(), description: form.description.trim(), class_name: form.class_name.trim(), status: form.status, score, members: form.members };
      if (isAdmin && form.guide) body.guide = form.guide;
      await saveProject(initial?.id, body);
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
        <Field id="p-title" className="sm:col-span-2" label="Title" value={form.title} onChange={set('title')} error={errors.title} />
        <Field id="p-desc" className="sm:col-span-2" label="Description" as="textarea" rows={3} value={form.description} onChange={set('description')} />
        <Field id="p-class" label="Class" value={form.class_name} onChange={set('class_name')} error={errors.class_name} list="dl-p-classes" autoComplete="off" />
        <Field id="p-status" label="Status" as="select" value={form.status} onChange={set('status')}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {cap(s)}
            </option>
          ))}
        </Field>
        <Field id="p-score" label="Score (/100)" type="number" min={0} max={100} value={form.score} onChange={set('score')} error={errors.score} hint="Leave blank until graded." />
        {isAdmin && (
          <Field id="p-guide" label="Guide" as="select" value={form.guide} onChange={set('guide')}>
            <option value="">Choose a teacher</option>
            {(opts?.teachers ?? []).map((t) => (
              <option key={t.username} value={t.username}>
                {t.name || t.username}
              </option>
            ))}
          </Field>
        )}
      </div>
      <datalist id="dl-p-classes">
        {(opts?.classes ?? []).map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <fieldset aria-describedby={errors.members ? 'p-members-err' : undefined}>
        <legend className="mb-1 text-sm font-medium">Members ({form.members.length} selected)</legend>
        <label htmlFor="p-filter" className="sr-only">
          Filter students
        </label>
        <input id="p-filter" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={form.class_name ? `Students in ${form.class_name}` : 'Filter students'} className="field mb-2" />
        <div className={`max-h-48 overflow-y-auto rounded-xl border bg-white p-2 ${errors.members ? 'border-bad' : 'border-line'}`}>
          {!opts ? (
            <p className="p-2 text-sm text-ink/60">Loading students...</p>
          ) : pool.length === 0 ? (
            <p className="p-2 text-sm text-ink/60">No students match.</p>
          ) : (
            pool.map((s) => (
              <label key={s.student_id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-ink/5">
                <input type="checkbox" checked={form.members.includes(s.student_id)} onChange={() => toggle(s.student_id)} className="size-4 accent-[#f26b1d]" />
                <span className="font-medium">{s.name}</span> <span className="text-xs text-ink/60">{s.student_id}</span>
              </label>
            ))
          )}
        </div>
        {errors.members && (
          <p id="p-members-err" className="mt-1 text-xs font-medium text-bad">
            {errors.members}
          </p>
        )}
      </fieldset>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-ghost">
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Saving...' : initial?.id ? 'Save changes' : 'Create project'}
        </button>
      </div>
    </form>
  );
}

export default function Projects({ user }) {
  const staff = user.role !== 'student';
  const isAdmin = user.role === 'admin';
  const { data: projects, error, reload } = useLoad(listProjects, []);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [removeError, setRemoveError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  if (error && !projects) return <ErrorBanner error={error} onRetry={reload} />;
  if (!projects) return <Loading label="Loading projects" />;

  const confirmDelete = async () => {
    setDeleting(true);
    setRemoveError(null);
    try {
      await deleteProject(removing.id);
      toast('Project deleted.');
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
      {staff && (
        <div className="flex justify-end">
          <button type="button" onClick={() => setEditing({})} className="btn-primary">
            <Plus size={16} aria-hidden="true" /> New project
          </button>
        </div>
      )}
      {projects.length === 0 ? (
        <div className="card">
          <Empty icon={FolderKanban} title="No projects yet" hint={staff ? 'Create a project and add its student members.' : 'Projects you are part of will show up here.'} />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
          {STATUSES.map((status) => {
            const items = projects.filter((p) => p.status === status);
            return (
              <section key={status} aria-labelledby={`col-${status}`} className="glass-chip rounded-2xl p-3">
                <h2 id={`col-${status}`} className="mb-3 flex items-center justify-between px-1 text-sm font-semibold">
                  {cap(status)} <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs tabular">{items.length}</span>
                </h2>
                <ul className="grid gap-3">
                  {items.length === 0 && <li className="rounded-xl border border-dashed border-white/15 px-3 py-6 text-center text-xs text-white/55">Nothing here</li>}
                  {items.map((p) => (
                    <li key={p.id} className="card !p-4">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold">{p.title}</h3>
                        <StatusChip status={p.status} />
                      </div>
                      {p.description && <p className="mt-1 line-clamp-3 text-sm text-ink/75">{p.description}</p>}
                      <p className="mt-2 text-xs text-ink/60">
                        {p.class_name} · Guide {p.guide_name || p.guide || '-'}
                        {p.score != null && (
                          <>
                            {' '}
                            · Score <strong className="tabular text-ink">{num(p.score)}</strong>/100
                          </>
                        )}
                      </p>
                      <ul className="mt-2 flex flex-wrap gap-1" aria-label="Members">
                        {(p.members ?? []).map((m) => (
                          <li key={m.student_id} className="rounded-full bg-ink/5 px-2 py-0.5 text-xs" title={m.student_id}>
                            {m.name}
                          </li>
                        ))}
                      </ul>
                      {staff && (
                        <div className="mt-3 flex gap-1 border-t border-line/50 pt-2">
                          <button type="button" onClick={() => setEditing(p)} className="btn-ghost h-8 px-3 text-xs" aria-label={`Edit ${p.title}`}>
                            <Pencil size={14} aria-hidden="true" /> Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRemoveError(null);
                              setRemoving(p);
                            }}
                            className="btn h-8 px-3 text-xs text-bad hover:bg-bad/10"
                            aria-label={`Delete ${p.title}`}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit project' : 'New project'} wide>
        {editing && (
          <ProjectForm
            initial={editing.id ? editing : null}
            isAdmin={isAdmin}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              toast(editing.id ? 'Project updated.' : 'Project created.');
              setEditing(null);
              reload();
            }}
          />
        )}
      </Modal>
      <ConfirmDialog open={!!removing} title="Delete project?" busy={deleting} error={removeError} onConfirm={confirmDelete} onCancel={() => setRemoving(null)}>
        {removing && (
          <p>
            Delete <strong>{removing.title}</strong>? This cannot be undone.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
