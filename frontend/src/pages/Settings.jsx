import { useEffect, useState } from 'react';
import { changePassword, getProfile, saveProfile, useLoad } from '../lib/api';
import { toast } from '../lib/toast';
import { CardTitle, Field, FormError } from '../components/ui';

const PROFILE_KEYS = ['name', 'email', 'phone', 'address', 'about'];

function ProfileForm({ user }) {
  const { data, error } = useLoad(getProfile, []);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setForm(Object.fromEntries(PROFILE_KEYS.map((k) => [k, data[k] ?? ''])));
  }, [data]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const found = {};
    if (!form.name.trim()) found.name = 'Required.';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) found.email = 'Enter a valid email address.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    setServerError(null);
    try {
      await saveProfile(Object.fromEntries(PROFILE_KEYS.map((k) => [k, form[k].trim()])));
      toast('Profile saved.');
    } catch (err) {
      setServerError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card" aria-labelledby="profile-title">
      <CardTitle id="profile-title" sub={`Signed in as ${user.username} (${user.role})`}>
        Profile
      </CardTitle>
      {error && !data ? (
        <FormError>{error.message}</FormError>
      ) : !form ? (
        <div role="status" className="grid gap-3">
          <span className="sr-only">Loading profile...</span>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-xl bg-ink/5 motion-reduce:animate-none" />
          ))}
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="grid gap-4">
          <FormError>{serverError}</FormError>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="pr-name" label="Full name" value={form.name} onChange={set('name')} error={errors.name} autoComplete="name" />
            <Field id="pr-email" label="Email" type="email" value={form.email} onChange={set('email')} error={errors.email} autoComplete="email" />
            <Field id="pr-phone" label="Phone" type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" />
            <Field id="pr-address" label="Address" value={form.address} onChange={set('address')} autoComplete="street-address" />
          </div>
          <Field id="pr-about" label="About" as="textarea" rows={3} value={form.about} onChange={set('about')} hint="A line or two your mentor or teachers can read." />
          <div className="flex justify-end">
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : 'Save profile'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

const EMPTY = { old: '', next: '', confirm: '' };

function PasswordForm({ user, onPasswordChanged }) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const found = {};
    if (!form.old) found.old = 'Required.';
    if (form.next.length < 6) found.next = 'Use at least 6 characters.';
    else if (form.next === form.old) found.next = 'Choose a password different from the current one.';
    if (form.confirm !== form.next) found.confirm = 'Passwords do not match.';
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementById(`pw-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      await changePassword(form.old, form.next);
      setForm(EMPTY);
      toast('Password changed.');
      onPasswordChanged?.();
    } catch (err) {
      setServerError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card" aria-labelledby="password-title">
      <CardTitle id="password-title" sub={user.role === 'student' ? 'Your first password is your student ID. Change it to something only you know.' : undefined}>
        Change password
      </CardTitle>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <FormError>{serverError}</FormError>
        <Field id="pw-old" label="Current password" type="password" value={form.old} onChange={set('old')} error={errors.old} autoComplete="current-password" />
        <Field id="pw-next" label="New password" type="password" value={form.next} onChange={set('next')} error={errors.next} hint="At least 6 characters." autoComplete="new-password" />
        <Field id="pw-confirm" label="Confirm new password" type="password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} autoComplete="new-password" />
        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving...' : 'Change password'}
          </button>
        </div>
      </form>
    </section>
  );
}

export default function Settings({ user, onPasswordChanged }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr] xl:items-start">
      <ProfileForm user={user} />
      <PasswordForm user={user} onPasswordChanged={onPasswordChanged} />
    </div>
  );
}
