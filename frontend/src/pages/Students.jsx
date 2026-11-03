import { useEffect, useState } from 'react';
import { FileText, Mail, Phone, Search, Users } from 'lucide-react';
import { getStudent, listStudents, useLoad } from '../lib/api';
import { attOf, fmt, num, pctText, splitList } from '../lib/stats';
import { Empty, ErrorBanner, FormError, GradeBadge, Modal, ResultChip, SkeletonRows } from '../components/ui';

function StudentDetail({ id }) {
  const { data, error } = useLoad(() => getStudent(id), [id]);
  if (error) return <FormError>{error.message}</FormError>;
  if (!data)
    return (
      <div role="status" className="grid gap-3">
        <span className="sr-only">Loading student...</span>
        <div className="h-20 animate-pulse rounded-xl bg-ink/5 motion-reduce:animate-none" />
        <div className="h-40 animate-pulse rounded-xl bg-ink/5 motion-reduce:animate-none" />
      </div>
    );
  const p = data.profile ?? {};
  const records = data.records ?? [];
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-ink/55">Student ID</dt>
            <dd className="font-medium">{data.student_id}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink/55">Department</dt>
            <dd className="font-medium">{data.department}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink/55">Semester</dt>
            <dd className="font-medium">{data.semester}</dd>
          </div>
          {p.email && (
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-xs text-ink/55">Email</dt>
              <dd>
                <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 font-medium text-accent-deep underline underline-offset-2">
                  <Mail size={13} aria-hidden="true" />
                  {p.email}
                </a>
              </dd>
            </div>
          )}
          {p.phone && (
            <div>
              <dt className="text-xs text-ink/55">Phone</dt>
              <dd className="inline-flex items-center gap-1 font-medium">
                <Phone size={13} aria-hidden="true" />
                {p.phone}
              </dd>
            </div>
          )}
        </dl>
        <a href={`#/report-card/${encodeURIComponent(data.student_id)}`} className="btn-primary">
          <FileText size={16} aria-hidden="true" /> Report card
        </a>
      </div>
      {p.about && <p className="rounded-xl bg-ink/5 p-3 text-sm">{p.about}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <caption className="mb-2 text-left font-semibold">Subjects</caption>
          <thead className="border-y border-line/70 text-xs uppercase tracking-wide text-ink/60">
            <tr>
              <th scope="col" className="py-2 pr-3 font-semibold">Subject</th>
              <th scope="col" className="px-2 py-2 font-semibold">Class</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Total</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Attend.</th>
              <th scope="col" className="px-2 py-2 font-semibold">Grade</th>
              <th scope="col" className="py-2 pl-2 font-semibold">Result</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} className="border-b border-line/40 last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-medium">
                  {r.subject}
                </th>
                <td className="px-2 py-2">{r.class_name}</td>
                <td className="px-2 py-2 text-right tabular">{r.out_of ? `${num(r.obtained)}/${num(r.out_of)}` : '-'}</td>
                <td className="px-2 py-2 text-right tabular">{pctText(attOf(r))}</td>
                <td className="px-2 py-2">
                  <GradeBadge grade={r.grade} />
                </td>
                <td className="py-2 pl-2">
                  <ResultChip result={r.result} reasons={r.reasons} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Students() {
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  const { data: students, error, loading, reload } = useLoad(() => listStudents(q), [q]);

  return (
    <div className="grid gap-4">
      <div className="relative max-w-sm">
        <label htmlFor="stu-search" className="sr-only">
          Search students
        </label>
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/50" aria-hidden="true" />
        <input id="stu-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by ID, name or department" className="field pl-9" />
      </div>
      <p role="status" className="sr-only">
        {!loading && students ? `${students.length} students shown.` : ''}
      </p>
      {error && <ErrorBanner error={error} onRetry={reload} />}
      {(students || !error) && (
        <section className="card overflow-hidden !p-0" aria-busy={loading}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <caption className="sr-only">Students</caption>
              <thead className="border-b border-line/70 text-xs uppercase tracking-wide text-ink/60">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Student</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Department</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Sem</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Classes</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Subjects</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Average</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Attend.</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className={loading && students ? 'opacity-60' : ''}>
                {!students ? (
                  <SkeletonRows cols={8} />
                ) : students.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <Empty icon={Users} title={q ? `No students match "${q}"` : 'No students yet'} hint={q ? 'Try a student ID or a department.' : 'Students appear once they have a record. Add one on Records or use Import.'} />
                    </td>
                  </tr>
                ) : (
                  students.map((s) => (
                    <tr key={s.student_id} className="border-b border-line/40 last:border-0 hover:bg-ink/[0.03]">
                      <th scope="row" className="px-4 py-2.5 text-left font-normal">
                        <button type="button" onClick={() => setOpen(s)} className="text-left">
                          <span className="block font-medium underline-offset-2 hover:underline">{s.name}</span>
                          <span className="text-xs text-ink/60 tabular">{s.student_id}</span>
                        </button>
                      </th>
                      <td className="px-3 py-2.5">{s.department}</td>
                      <td className="px-3 py-2.5 text-right tabular">{s.semester}</td>
                      <td className="px-3 py-2.5">{splitList(s.classes).join(', ') || '-'}</td>
                      <td className="px-3 py-2.5 text-right tabular">{s.subjects}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular">{s.average == null ? '-' : `${fmt(s.average)}%`}</td>
                      <td className={`px-3 py-2.5 text-right tabular ${s.attendance != null && s.attendance < 80 ? 'font-semibold text-bad' : ''}`}>{pctText(s.attendance)}</td>
                      <td className="whitespace-nowrap px-4 py-1.5 text-right">
                        <a href={`#/report-card/${encodeURIComponent(s.student_id)}`} className="btn-ghost h-8 px-3 text-xs">
                          <FileText size={14} aria-hidden="true" /> Report card
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''} wide>
        {open && <StudentDetail id={open.student_id} />}
      </Modal>
    </div>
  );
}
