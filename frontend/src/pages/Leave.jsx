import { useState } from 'react';
import { CalendarOff, Check, Plane, X } from 'lucide-react';
import { applyLeave, getLeaveBalance, listLeaves, safe, updateLeave, useLoad } from '../lib/api';
import { cap, fmtDate, isoDate } from '../lib/stats';
import { toast } from '../lib/toast';
import { CardTitle, Empty, ErrorBanner, Field, FormError, Loading, Modal, SkeletonRows, StatusChip } from '../components/ui';

const TYPES = ['casual', 'sick', 'earned', 'other'];

function LeaveTable({ leaves, admin, onAct, caption }) {
  const today = isoDate();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-y border-line/70 text-xs uppercase tracking-wide text-ink/60">
          <tr>
            {admin && <th scope="col" className="px-4 py-3 font-semibold">Teacher</th>}
            <th scope="col" className="px-4 py-3 font-semibold">Type</th>
            <th scope="col" className="px-4 py-3 font-semibold">Dates</th>
            <th scope="col" className="px-3 py-3 text-right font-semibold">Days</th>
            <th scope="col" className="px-4 py-3 font-semibold">Reason</th>
            <th scope="col" className="px-4 py-3 font-semibold">Status</th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {leaves.map((l) => {
            const canCancel = !admin && ['pending', 'approved'].includes(l.status) && l.to_date >= today;
            return (
              <tr key={l.id} className="border-b border-line/40 align-top last:border-0">
                {admin && (
                  <th scope="row" className="px-4 py-2.5 text-left font-medium">
                    {l.teacher_name || l.teacher}
                  </th>
                )}
                <td className="px-4 py-2.5">{cap(l.type)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 tabular">
                  {fmtDate(l.from_date)}
                  {l.to_date !== l.from_date && ` - ${fmtDate(l.to_date)}`}
                </td>
                <td className="px-3 py-2.5 text-right tabular">{l.days}</td>
                <td className="max-w-[16rem] px-4 py-2.5">
                  {l.reason}
                  {l.decided_note && <span className="mt-0.5 block text-xs text-ink/60">Note: {l.decided_note}</span>}
                </td>
                <td className="px-4 py-2.5">
                  <StatusChip status={l.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-1.5 text-right">
                  {admin && l.status === 'pending' && (
                    <>
                      <button type="button" onClick={() => onAct(l, 'approved')} className="btn h-8 bg-good px-3 text-xs text-white hover:bg-good/85">
                        <Check size={14} aria-hidden="true" /> Approve
                      </button>{' '}
                      <button type="button" onClick={() => onAct(l, 'rejected')} className="btn h-8 bg-ink/5 px-3 text-xs text-bad hover:bg-bad/10">
                        <X size={14} aria-hidden="true" /> Reject
                      </button>
                    </>
                  )}
                  {canCancel && (
                    <button type="button" onClick={() => onAct(l, 'cancelled')} className="btn-ghost h-8 px-3 text-xs">
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Approve / reject (admin, with note) or cancel (teacher).
function ActDialog({ acting, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  if (!acting) return null;
  const { leave, status } = acting;
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await updateLeave(leave.id, status === 'cancelled' ? { status } : { status, note: note.trim() });
      toast(`Leave ${status}.`);
      onDone();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };
  const verb = status === 'approved' ? 'Approve' : status === 'rejected' ? 'Reject' : 'Cancel';
  return (
    <Modal open onClose={onClose} title={`${verb} leave?`}>
      <div className="grid gap-4">
        <p className="text-sm text-ink/80">
          {leave.teacher_name || leave.teacher}: {cap(leave.type)} leave, {fmtDate(leave.from_date)}
          {leave.to_date !== leave.from_date && ` to ${fmtDate(leave.to_date)}`} ({leave.days} day{leave.days === 1 ? '' : 's'}).
        </p>
        <FormError>{err}</FormError>
        {status !== 'cancelled' && <Field id="leave-note" label="Note to the teacher (optional)" as="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Back
          </button>
          <button type="button" onClick={submit} disabled={busy} className={status === 'approved' ? 'btn bg-good text-white hover:bg-good/85' : status === 'rejected' ? 'btn bg-bad text-white hover:bg-bad/85' : 'btn-dark'}>
            {busy ? 'Saving...' : verb}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ApplyForm({ onApplied }) {
  const [form, setForm] = useState({ type: 'casual', from_date: '', to_date: '', reason: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const found = {};
    if (!form.from_date) found.from_date = 'Required.';
    if (!form.to_date) found.to_date = 'Required.';
    else if (form.from_date && form.to_date < form.from_date) found.to_date = 'Must be on or after the start date.';
    if (!form.reason.trim()) found.reason = 'Required.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setServerError(null);
    try {
      await applyLeave({ ...form, reason: form.reason.trim() });
      toast('Leave request sent.');
      setForm({ type: form.type, from_date: '', to_date: '', reason: '' });
      onApplied();
    } catch (err) {
      setServerError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="apply-title">
      <CardTitle id="apply-title" sub="The admin approves or rejects each request.">
        Apply for leave
      </CardTitle>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <FormError>{serverError}</FormError>
        <Field id="lv-type" label="Type" as="select" value={form.type} onChange={set('type')}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {cap(t)}
            </option>
          ))}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="lv-from" label="From" type="date" value={form.from_date} onChange={set('from_date')} error={errors.from_date} />
          <Field id="lv-to" label="To" type="date" min={form.from_date || undefined} value={form.to_date} onChange={set('to_date')} error={errors.to_date} />
        </div>
        <Field id="lv-reason" label="Reason" as="textarea" rows={2} value={form.reason} onChange={set('reason')} error={errors.reason} />
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className="btn-primary">
            <Plane size={16} aria-hidden="true" /> {busy ? 'Sending...' : 'Send request'}
          </button>
        </div>
      </form>
    </section>
  );
}

function TeacherLeave() {
  const { data, error, reload } = useLoad(() => Promise.all([listLeaves(), safe(getLeaveBalance(), [])]), []);
  const [acting, setActing] = useState(null);
  if (error && !data) return <ErrorBanner error={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading leave" />;
  const [leaves, balance] = data;
  return (
    <div className="grid gap-4">
      {balance.length > 0 && (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {balance.map((b) => (
            <article key={b.type} className="rounded-2xl bg-white p-4 text-ink shadow-[0_14px_34px_-20px_rgb(0_0_0/0.6)]">
              <h2 className="text-sm font-semibold">{cap(b.type)} leave</h2>
              <p className="mt-2">
                <span className="text-2xl font-bold tabular">{b.quota == null ? b.used : b.remaining}</span>{' '}
                <span className="text-xs text-ink/60">{b.quota == null ? 'days used' : `of ${b.quota} days left`}</span>
              </p>
              {b.quota != null && (
                <span className="mt-2 block h-1.5 rounded-full bg-ink/10" aria-hidden="true">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (b.remaining / Math.max(1, b.quota)) * 100)}%` }} />
                </span>
              )}
            </article>
          ))}
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[22rem_1fr] xl:items-start">
        <ApplyForm onApplied={reload} />
        <section className="card overflow-hidden !p-0" aria-labelledby="hist-title">
          <div className="p-4 pb-3 sm:p-5 sm:pb-3">
            <CardTitle id="hist-title">My leave history</CardTitle>
          </div>
          {leaves.length === 0 ? <Empty icon={CalendarOff} title="No leave taken yet" hint="Requests you send appear here with their status." /> : <LeaveTable leaves={leaves} onAct={(leave, status) => setActing({ leave, status })} caption="My leave history" />}
        </section>
      </div>
      <ActDialog
        key={acting?.leave.id}
        acting={acting}
        onClose={() => setActing(null)}
        onDone={() => {
          setActing(null);
          reload();
        }}
      />
    </div>
  );
}

function AdminLeave() {
  const { data: leaves, error, reload } = useLoad(listLeaves, []);
  const [acting, setActing] = useState(null);
  if (error && !leaves) return <ErrorBanner error={error} onRetry={reload} />;
  const today = isoDate();
  const pending = (leaves ?? []).filter((l) => l.status === 'pending');
  const rest = (leaves ?? []).filter((l) => l.status !== 'pending');
  const away = (leaves ?? []).filter((l) => l.status === 'approved' && l.from_date <= today && today <= l.to_date);

  return (
    <div className="grid gap-4">
      <section aria-labelledby="away-title" className="glass-chip flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3">
        <h2 id="away-title" className="mr-2 text-sm font-semibold">
          On leave today
        </h2>
        {!leaves ? (
          <span className="text-sm text-white/60">Loading...</span>
        ) : away.length === 0 ? (
          <span className="text-sm text-white/70">Everyone is in.</span>
        ) : (
          away.map((l) => (
            <span key={l.id} className="rounded-full bg-white/10 px-3 py-1 text-sm ring-1 ring-white/15">
              {l.teacher_name || l.teacher} <span className="text-white/60">until {fmtDate(l.to_date)}</span>
            </span>
          ))
        )}
      </section>

      <section className="card overflow-hidden !p-0" aria-labelledby="pending-title">
        <div className="p-4 pb-3 sm:p-5 sm:pb-3">
          <CardTitle id="pending-title" sub="Oldest requests at the bottom">
            Pending requests {leaves && `(${pending.length})`}
          </CardTitle>
        </div>
        {!leaves ? (
          <table className="w-full">
            <tbody>
              <SkeletonRows cols={6} rows={3} />
            </tbody>
          </table>
        ) : pending.length === 0 ? (
          <Empty icon={Check} title="All caught up" hint="New leave requests from teachers will appear here." />
        ) : (
          <LeaveTable leaves={pending} admin onAct={(leave, status) => setActing({ leave, status })} caption="Pending leave requests" />
        )}
      </section>

      {rest.length > 0 && (
        <section className="card overflow-hidden !p-0" aria-labelledby="decided-title">
          <div className="p-4 pb-3 sm:p-5 sm:pb-3">
            <CardTitle id="decided-title">History</CardTitle>
          </div>
          <LeaveTable leaves={rest} admin onAct={() => {}} caption="Leave history" />
        </section>
      )}
      <ActDialog
        key={acting?.leave.id}
        acting={acting}
        onClose={() => setActing(null)}
        onDone={() => {
          setActing(null);
          reload();
        }}
      />
    </div>
  );
}

export default function Leave({ user }) {
  return user.role === 'admin' ? <AdminLeave /> : <TeacherLeave />;
}
