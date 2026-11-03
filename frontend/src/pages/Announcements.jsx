import { useId, useState } from 'react';
import { Megaphone, Send, Trash2 } from 'lucide-react';
import { deleteAnnouncement, listAnnouncements, listClasses, listRecords, postAnnouncement, safe, useLoad } from '../lib/api';
import { ago } from '../lib/stats';
import { toast } from '../lib/toast';
import { CardTitle, Empty, Field, FormError } from '../components/ui';

// Class names the user can post to: admin sees all classes, a teacher their own (falls back to classes in their records).
async function classOptions() {
  const classes = (await safe(listClasses(), [])).map((c) => c.name);
  if (classes.length) return classes;
  return [...new Set((await safe(listRecords(), [])).map((r) => r.class_name).filter(Boolean))].sort();
}

function Compose({ user, onPosted }) {
  const isAdmin = user.role === 'admin';
  const { data: classes } = useLoad(classOptions, []);
  const [form, setForm] = useState({ title: '', body: '', class_name: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const found = {};
    if (!form.title.trim()) found.title = 'Required.';
    if (!form.body.trim()) found.body = 'Required.';
    if (!isAdmin && !form.class_name) found.class_name = 'Choose one of your classes.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setServerError(null);
    try {
      await postAnnouncement({ title: form.title.trim(), body: form.body.trim(), class_name: form.class_name || null });
      setForm({ title: '', body: '', class_name: form.class_name });
      toast('Announcement posted.');
      onPosted();
    } catch (err) {
      setServerError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-3 border-b border-line/60 pb-4">
      <FormError>{serverError}</FormError>
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <Field id="ann-title" label="Title" value={form.title} onChange={set('title')} error={errors.title} maxLength={120} />
        <Field id="ann-class" label="Audience" as="select" value={form.class_name} onChange={set('class_name')} error={errors.class_name}>
          {isAdmin ? <option value="">Everyone</option> : <option value="">Choose a class</option>}
          {(classes ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Field>
      </div>
      <Field id="ann-body" label="Message" as="textarea" rows={3} value={form.body} onChange={set('body')} error={errors.body} />
      <div className="flex justify-end">
        <button type="submit" disabled={busy} className="btn-primary">
          <Send size={16} aria-hidden="true" /> {busy ? 'Posting...' : 'Post'}
        </button>
      </div>
    </form>
  );
}

// Feed of announcements; staff get a compose form. `limit` trims it for the dashboard.
export function Feed({ user, limit }) {
  const titleId = useId();
  const staff = user.role !== 'student';
  const { data, error, reload } = useLoad(listAnnouncements, []);
  const items = limit ? (data ?? []).slice(0, limit) : (data ?? []);

  const remove = async (a) => {
    try {
      await deleteAnnouncement(a.id);
      toast('Announcement deleted.');
      reload();
    } catch (err) {
      toast(err.message, 'bad');
    }
  };

  return (
    <section className="card" aria-labelledby={titleId}>
      <CardTitle id={titleId} sub="Notices for your classes" action={limit && data?.length > limit ? <a href="#/announcements" className="text-sm font-semibold text-accent-deep underline underline-offset-2">See all</a> : null}>
        Announcements
      </CardTitle>
      <div className="grid gap-4">
        {staff && <Compose user={user} onPosted={reload} />}
        {error && !data ? (
          <p role="alert" className="text-sm text-bad">
            {error.message}
          </p>
        ) : !data ? (
          <div className="grid gap-3" aria-hidden="true">
            {[0, 1].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-ink/5 motion-reduce:animate-none" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <Empty icon={Megaphone} title="Nothing posted yet" hint={staff ? 'Post a notice above; it shows on every audience member’s dashboard.' : 'Notices from your teachers will appear here.'} />
        ) : (
          <ul className="grid gap-3">
            {items.map((a) => (
              <li key={a.id} className="rounded-xl bg-white/70 p-3 ring-1 ring-line/50">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{a.title}</p>
                    <p className="text-xs text-ink/60">
                      {a.author_name || a.author} · {a.class_name || 'Everyone'} · {ago(a.created)}
                    </p>
                  </div>
                  {(user.role === 'admin' || a.author === user.username) && (
                    <button type="button" onClick={() => remove(a)} aria-label={`Delete announcement ${a.title}`} className="grid size-8 shrink-0 place-items-center rounded-full text-ink/60 hover:bg-bad/10 hover:text-bad">
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  )}
                </div>
                <p className="mt-1.5 whitespace-pre-line text-sm text-ink/85">{a.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default function Announcements({ user }) {
  return <Feed user={user} />;
}
