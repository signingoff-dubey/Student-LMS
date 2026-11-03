import { useEffect, useId, useRef, useState } from 'react';
import { CalendarClock, MessageCircle, Send } from 'lucide-react';
import { listMessages, listSessions, sendMessage, updateSession, usePoll, useLoad } from '../lib/api';
import { fmtDate, fmtUnix, isoDate } from '../lib/stats';
import { toast } from '../lib/toast';
import { CardTitle, Empty, Field, FormError, Modal, StatusChip } from './ui';

// Message thread with one person. Polls every 10 s while open; loading it marks incoming messages read.
export function Chat({ me, withUser, withName, onRead }) {
  const titleId = useId();
  const { data: messages, error, reload } = useLoad(() => listMessages(withUser), [withUser]);
  usePoll(reload, 10000);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const end = useRef(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
    if (messages) onRead?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages?.length]);

  const send = async (e) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSending(true);
    setSendError(null);
    try {
      await sendMessage(withUser, text);
      setBody('');
      reload();
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="card flex min-h-[26rem] flex-col !p-0" aria-labelledby={titleId}>
      <div className="border-b border-line/60 px-4 py-3">
        <h2 id={titleId} className="font-semibold">
          {withName || withUser}
        </h2>
        <p className="text-xs text-ink/60">Messages refresh every 10 seconds.</p>
      </div>
      <ol role="log" aria-live="polite" aria-label={`Messages with ${withName || withUser}`} className="flex max-h-[28rem] min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
        {error && !messages && (
          <li role="alert" className="text-sm text-bad">
            {error.message}
          </li>
        )}
        {messages?.length === 0 && (
          <li className="m-auto">
            <Empty icon={MessageCircle} title="No messages yet" hint="Say hello, or ask about anything you need help with." />
          </li>
        )}
        {messages?.map((m) => {
          const mine = m.sender === me;
          return (
            <li key={m.id} className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? 'self-end rounded-br-md bg-accent text-on-accent' : 'self-start rounded-bl-md bg-white ring-1 ring-line/60'}`}>
              <span className="sr-only">{mine ? 'You' : withName || withUser}: </span>
              <p className="whitespace-pre-line break-words">{m.body}</p>
              <p className={`mt-0.5 text-[11px] ${mine ? 'text-on-accent/70' : 'text-ink/50'}`}>{fmtUnix(m.created)}</p>
            </li>
          );
        })}
        <li ref={end} aria-hidden="true" />
      </ol>
      <form onSubmit={send} className="grid gap-2 border-t border-line/60 p-3">
        <FormError>{sendError}</FormError>
        <div className="flex items-end gap-2">
          <label htmlFor={`${titleId}-msg`} className="sr-only">
            Message
          </label>
          <textarea
            id={`${titleId}-msg`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) send(e);
            }}
            maxLength={2000}
            rows={1}
            placeholder="Write a message (Enter to send, Shift+Enter for a new line)"
            className="field h-auto min-h-10 flex-1 resize-y py-2"
          />
          <button type="submit" disabled={sending || !body.trim()} className="btn-primary size-10 shrink-0 !px-0" aria-label="Send">
            <Send size={16} aria-hidden="true" />
          </button>
        </div>
      </form>
    </section>
  );
}

// Session list. Mentors confirm, decline or complete; students cancel their own; admin reads.
export function SessionList({ user, sessions, reload, title = 'Sessions' }) {
  const titleId = useId();
  const [acting, setActing] = useState(null); // { session, status }
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const isStudent = user.role === 'student';
  const today = isoDate();

  const actionsFor = (s) => {
    if (isStudent) return ['requested', 'confirmed'].includes(s.status) && s.date >= today ? [['cancelled', 'Cancel']] : [];
    if (s.mentor !== user.username) return [];
    if (s.status === 'requested') return [['confirmed', 'Confirm'], ['declined', 'Decline']];
    if (s.status === 'confirmed') return [['completed', 'Mark done'], ['declined', 'Decline']];
    return [];
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await updateSession(acting.session.id, { status: acting.status, note: note.trim() });
      toast(`Session ${acting.status}.`);
      setActing(null);
      reload();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby={titleId}>
      <CardTitle id={titleId}>{title}</CardTitle>
      {sessions.length === 0 ? (
        <Empty icon={CalendarClock} title="No sessions yet" hint={isStudent ? 'Book a slot with your mentor using the form.' : 'Requests from mentees will appear here.'} />
      ) : (
        <ul className="grid gap-2">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-white/70 p-3 ring-1 ring-line/50">
              <div className="min-w-0">
                <p className="font-medium">{s.topic || 'Mentoring session'}</p>
                <p className="text-xs text-ink/60 tabular">
                  {fmtDate(s.date)} · {s.start_time}
                  {s.end_time ? `-${s.end_time}` : ''} · {s.duration} min · {isStudent ? s.mentor_name || s.mentor : s.student_name || s.student_id}
                  {user.role === 'admin' && ` with ${s.mentor_name || s.mentor}`}
                </p>
                {s.note && <p className="mt-1 text-xs text-ink/75">Note: {s.note}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={s.status} />
                {actionsFor(s).map(([status, label]) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => {
                      setNote('');
                      setErr(null);
                      setActing({ session: s, status });
                    }}
                    className={`btn h-8 px-3 text-xs ${status === 'confirmed' || status === 'completed' ? 'bg-ink text-white hover:bg-ink/85' : 'bg-ink/5 text-ink hover:bg-ink/10'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!acting} onClose={() => setActing(null)} title={acting ? `${acting.status === 'cancelled' ? 'Cancel' : acting.status === 'confirmed' ? 'Confirm' : acting.status === 'completed' ? 'Complete' : 'Decline'} session` : ''}>
        {acting && (
          <div className="grid gap-4">
            <p className="text-sm text-ink/80">
              {acting.session.topic || 'Mentoring session'} on {fmtDate(acting.session.date)} at {acting.session.start_time}.
            </p>
            <FormError>{err}</FormError>
            <Field id="sess-note" label="Note (optional)" as="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setActing(null)} className="btn-ghost">
                Back
              </button>
              <button type="button" onClick={submit} disabled={busy} className="btn-primary">
                {busy ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

export const loadSessions = () => listSessions().then((xs) => [...xs].sort((a, b) => `${b.date} ${b.start_time}`.localeCompare(`${a.date} ${a.start_time}`)));
