import { useState } from 'react';
import { Search, UserRoundCheck } from 'lucide-react';
import { assignMentor, listMentors, listUsers, safe, useLoad } from '../lib/api';
import { toast } from '../lib/toast';
import { CardTitle, Empty, ErrorBanner, Loading } from '../components/ui';
import { SessionList, loadSessions } from '../components/Mentoring';

export default function MentorAssignments({ user }) {
  const { data, error, reload } = useLoad(() => Promise.all([listMentors(), listUsers()]), []);
  const sessions = useLoad(() => safe(loadSessions(), []), []);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(null);

  if (error && !data) return <ErrorBanner error={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading mentor assignments" />;

  const [rows, users] = data;
  const teachers = users.filter((u) => u.role === 'teacher');
  const shown = rows.filter((r) => `${r.student_id} ${r.name} ${r.mentor_name ?? ''}`.toLowerCase().includes(filter.toLowerCase()));
  const unassigned = rows.filter((r) => !r.mentor).length;

  const assign = async (r, teacher) => {
    setSaving(r.student_id);
    try {
      await assignMentor(r.student_id, teacher || null);
      toast(teacher ? `${r.name} now mentored by ${teachers.find((t) => t.username === teacher)?.name || teacher}.` : `${r.name} has no mentor now.`);
      reload();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="grid gap-4">
      <section className="card overflow-hidden !p-0" aria-labelledby="ma-title">
        <div className="flex flex-wrap items-start justify-between gap-3 p-4 pb-3 sm:p-5 sm:pb-3">
          <CardTitle id="ma-title" sub={`${rows.length} students, ${unassigned} without a mentor`}>
            Mentor assignments
          </CardTitle>
          <div className="relative w-full max-w-xs">
            <label htmlFor="ma-filter" className="sr-only">
              Filter students
            </label>
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/50" aria-hidden="true" />
            <input id="ma-filter" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by student or mentor" className="field pl-9" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="border-y border-line/70 text-xs uppercase tracking-wide text-ink/60">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Student</th>
                <th scope="col" className="px-4 py-3 font-semibold">Mentor</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={2}>
                    <Empty icon={UserRoundCheck} title={rows.length ? 'No match' : 'No students yet'} hint={rows.length ? 'Try another name.' : 'Students appear once they have records.'} />
                  </td>
                </tr>
              ) : (
                shown.map((r) => (
                  <tr key={r.student_id} className="border-b border-line/40 last:border-0">
                    <th scope="row" className="px-4 py-2.5 text-left font-normal">
                      <span className="font-medium">{r.name}</span> <span className="text-xs text-ink/60">{r.student_id}</span>
                    </th>
                    <td className="px-4 py-2">
                      <label htmlFor={`m-${r.student_id}`} className="sr-only">
                        Mentor for {r.name}
                      </label>
                      <select id={`m-${r.student_id}`} value={r.mentor ?? ''} onChange={(e) => assign(r, e.target.value)} disabled={saving === r.student_id} className="field max-w-xs">
                        <option value="">No mentor</option>
                        {teachers.map((t) => (
                          <option key={t.username} value={t.username}>
                            {t.name || t.username}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      <SessionList user={user} sessions={sessions.data ?? []} reload={sessions.reload} title="All mentoring sessions" />
    </div>
  );
}
