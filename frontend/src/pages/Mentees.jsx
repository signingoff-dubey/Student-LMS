import { useState } from 'react';
import { MessageCircle, Users } from 'lucide-react';
import { listConversations, listMentees, safe, usePoll, useLoad } from '../lib/api';
import { ago } from '../lib/stats';
import { CardTitle, Empty, ErrorBanner, Loading } from '../components/ui';
import { Chat, SessionList, loadSessions } from '../components/Mentoring';

export default function Mentees({ user }) {
  const { data, error, reload } = useLoad(() => Promise.all([listMentees(), safe(listConversations(), [])]), []);
  usePoll(reload, 10000);
  const sessions = useLoad(loadSessions, []);
  const [active, setActive] = useState(null);

  if (error && !data) return <ErrorBanner error={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading mentees" />;

  const [mentees, conversations] = data;
  const byUser = new Map(conversations.map((c) => [c.with, c]));
  // Mentees with a recent conversation first.
  const people = mentees
    .map((m) => ({ ...m, username: m.username || m.student_id, convo: byUser.get(m.username || m.student_id) }))
    .sort((a, b) => (b.convo?.last_at ?? 0) - (a.convo?.last_at ?? 0) || a.name.localeCompare(b.name));
  const current = people.find((p) => p.username === active) ?? null;

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr] lg:items-start">
        <section className="card !p-3" aria-labelledby="mentees-title">
          <div className="px-1">
            <CardTitle id="mentees-title" sub={`${mentees.length} assigned to you`}>
              Mentees
            </CardTitle>
          </div>
          {people.length === 0 ? (
            <Empty icon={Users} title="No mentees yet" hint="The admin assigns mentees on the Mentor assignments page." />
          ) : (
            <ul className="grid gap-1">
              {people.map((p) => (
                <li key={p.username}>
                  <button
                    type="button"
                    onClick={() => setActive(p.username)}
                    aria-current={p.username === active ? 'true' : undefined}
                    className={`flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left transition-colors ${p.username === active ? 'bg-accent/15 ring-1 ring-accent/40' : 'hover:bg-ink/5'}`}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink/10 text-sm font-semibold" aria-hidden="true">
                      {p.name?.[0]?.toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{p.name}</span>
                        {p.convo?.unread > 0 && (
                          <span className="rounded-full bg-accent px-1.5 text-xs font-bold text-on-accent tabular">
                            {p.convo.unread}
                            <span className="sr-only"> unread</span>
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-ink/60">{p.convo ? `${p.convo.last_body} · ${ago(p.convo.last_at)}` : `${p.class_name || ''} ${p.student_id}`}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {current ? (
          <Chat key={current.username} me={user.username} withUser={current.username} withName={current.name} onRead={reload} />
        ) : (
          <div className="card grid place-items-center">
            <Empty icon={MessageCircle} title="Pick a mentee" hint="Choose someone on the left to read and send messages." />
          </div>
        )}
      </div>
      {sessions.error && !sessions.data ? (
        <ErrorBanner error={sessions.error} onRetry={sessions.reload} />
      ) : (
        <SessionList user={user} sessions={sessions.data ?? []} reload={sessions.reload} title="Session requests" />
      )}
    </div>
  );
}
