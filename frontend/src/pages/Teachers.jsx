import { useState } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import { createTeacher, deleteUser, listUsers, useLoad } from '../lib/api';
import { CardTitle, ConfirmDialog, ErrorBanner, Field, FormError, Notice } from '../components/ui';

const EMPTY = { username: '', name: '', password: '' };

export default function Teachers({ user }) {
  const { data: users, error, loading, reload } = useLoad(listUsers, []);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [removing, setRemoving] = useState(null);
  const [removeError, setRemoveError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const found = {};
    if (!form.username.trim()) found.username = 'Required.';
    if (!form.name.trim()) found.name = 'Required.';
    if (form.password.length < 6) found.password = 'Use at least 6 characters.';
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementById(`t-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      await createTeacher({ username: form.username.trim(), name: form.name.trim(), password: form.password });
      setNotice(`Teacher ${form.username.trim()} created.`);
      setForm(EMPTY);
      reload();
    } catch (err) {
      setServerError(err.status === 409 ? `${err.message || 'That username is taken.'}` : err.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    setRemoveError(null);
    try {
      await deleteUser(removing.username);
      setNotice(`${removing.username} removed.`);
      setRemoving(null);
      reload();
    } catch (err) {
      setRemoveError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[22rem_1fr] xl:items-start">
      <section className="card" aria-labelledby="new-teacher">
        <CardTitle id="new-teacher" sub="Assign their classes on the Classes page.">
          Add a teacher
        </CardTitle>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <FormError>{serverError}</FormError>
          <Field id="t-username" label="Username" value={form.username} onChange={set('username')} error={errors.username} autoComplete="off" required />
          <Field id="t-name" label="Full name" value={form.name} onChange={set('name')} error={errors.name} autoComplete="off" required />
          <Field
            id="t-password"
            label="Temporary password"
            type="password"
            value={form.password}
            onChange={set('password')}
            error={errors.password}
            hint="At least 6 characters. Ask them to change it after signing in."
            autoComplete="new-password"
            required
          />
          <button type="submit" disabled={saving} className="btn-primary">
            <UserPlus size={16} aria-hidden="true" /> {saving ? 'Creating...' : 'Create teacher'}
          </button>
        </form>
      </section>

      <div className="grid gap-4">
        <Notice>{notice}</Notice>
        {error && <ErrorBanner error={error} onRetry={reload} />}
        {(users || !error) && (
          <section className="card overflow-hidden !p-0" aria-labelledby="staff-title" aria-busy={loading}>
            <div className="p-4 pb-0 sm:p-5 sm:pb-0">
              <CardTitle id="staff-title">Staff accounts</CardTitle>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] text-left text-sm">
                <thead className="border-y border-line/70 text-xs uppercase tracking-wide text-ink/60">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">Username</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Name</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Role</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {!users ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-ink/60">
                        Loading staff...
                      </td>
                    </tr>
                  ) : users.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-ink/60">
                        No staff accounts yet.
                      </td>
                    </tr>
                  ) : (
                    users.map((u) => (
                      <tr key={u.username} className="border-b border-line/40 last:border-0">
                        <th scope="row" className="px-4 py-2.5 text-left font-medium">
                          {u.username}
                        </th>
                        <td className="px-4 py-2.5">{u.name}</td>
                        <td className="px-4 py-2.5 capitalize">{u.role}</td>
                        <td className="px-4 py-1.5 text-right">
                          {u.role === 'teacher' && u.username !== user.username && (
                            <button
                              type="button"
                              onClick={() => {
                                setRemoveError(null);
                                setRemoving(u);
                              }}
                              aria-label={`Remove ${u.name || u.username}`}
                              className="inline-grid size-9 place-items-center rounded-full text-ink/70 hover:bg-bad/10 hover:text-bad"
                            >
                              <Trash2 size={16} aria-hidden="true" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      <ConfirmDialog open={!!removing} title="Remove teacher?" confirmLabel="Remove" busy={deleting} error={removeError} onConfirm={confirmDelete} onCancel={() => setRemoving(null)}>
        {removing && (
          <p>
            <strong>{removing.name || removing.username}</strong> will no longer be able to sign in.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
