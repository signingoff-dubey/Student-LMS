import { ArrowLeft, FileText, GraduationCap, Printer } from 'lucide-react';
import { getReportCard, getScheme, safe, useLoad } from '../lib/api';
import { COMPONENTS, attOf, fmt, num, pctText } from '../lib/stats';
import { Empty, ErrorBanner, GradeBadge, Loading, ResultChip, StatusChip } from '../components/ui';

const OVERALL = {
  pass: { label: 'Pass', cls: 'bg-good/15 text-[#17663a]' },
  fail: { label: 'Not passed', cls: 'bg-bad/15 text-bad' },
  shortage: { label: 'Not passed (low attendance)', cls: 'bg-warn/20 text-[#7a4b00]' },
  pending: { label: 'Results pending', cls: 'bg-ink/10 text-ink/70' },
};

// Overall result: the server's verdict when given; otherwise a pass only when every subject passes.
function overall(subjects, serverResult) {
  if (OVERALL[serverResult]) return OVERALL[serverResult];
  if (!subjects.length) return { label: 'No results yet', cls: 'bg-ink/10 text-ink/70' };
  if (subjects.every((s) => s.result === 'pass')) return { label: 'Pass', cls: 'bg-good/15 text-[#17663a]' };
  if (subjects.some((s) => s.result === 'fail' || s.result === 'shortage')) return { label: 'Not passed', cls: 'bg-bad/15 text-bad' };
  return { label: 'Results pending', cls: 'bg-ink/10 text-ink/70' };
}

const Info = ({ label, children }) => (
  <div>
    <dt className="text-xs uppercase tracking-wide text-ink/55">{label}</dt>
    <dd className="font-semibold">{children}</dd>
  </div>
);

export default function ReportCard({ user, param }) {
  const studentId = user.role === 'student' ? undefined : param;
  const { data, error, reload } = useLoad(() => (user.role !== 'student' && !studentId ? Promise.resolve(null) : Promise.all([getReportCard(studentId), safe(getScheme(), null)])), [studentId]);

  if (user.role !== 'student' && !studentId) {
    return (
      <div className="card">
        <Empty icon={FileText} title="Pick a student" hint="Open a student from the Students page to see their report card." action={<a href="#/students" className="btn-primary mt-2">Go to Students</a>} />
      </div>
    );
  }
  if (error && !data) return <ErrorBanner error={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading report card" />;

  const [card, scheme] = data;
  const subjects = card.subjects ?? [];
  const rules = scheme?.rules;
  const cieMax = scheme ? ['cie1', 'cie2', 'cie3'].reduce((s, k) => s + (scheme.components?.[k] ?? 0), 0) : null;
  const result = overall(subjects, card.overall_result);
  const flagged = subjects.filter((s) => s.reasons?.length);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        {user.role !== 'student' ? (
          <a href="#/students" className="btn-glass">
            <ArrowLeft size={16} aria-hidden="true" /> Students
          </a>
        ) : (
          <span />
        )}
        <button type="button" onClick={() => window.print()} className="btn-primary">
          <Printer size={16} aria-hidden="true" /> Print
        </button>
      </div>

      <article className="card report-sheet grid gap-6 !p-6 sm:!p-8" aria-labelledby="rc-title">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line/70 pb-5">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-accent text-on-accent print:border print:border-ink" aria-hidden="true">
              <GraduationCap size={22} />
            </span>
            <div>
              <h2 id="rc-title" className="text-xl font-bold">
                Report card
              </h2>
              <p className="text-sm text-ink/60">Semester {card.semester} · issued {new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            </div>
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-bold ${result.cls}`}>Overall: {result.label}</span>
        </header>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Info label="Name">{card.name}</Info>
          <Info label="Student ID">{card.student_id}</Info>
          <Info label="Department">{card.department}</Info>
          <Info label="Class">{card.class_name || '-'}</Info>
          <Info label="Overall score">{card.overall_percent == null ? '-' : `${fmt(card.overall_percent)}%`}</Info>
          <Info label="Overall grade">
            <GradeBadge grade={card.overall_grade} />
          </Info>
          <Info label="Attendance">{pctText(card.attendance)}</Info>
          <Info label="Class rank">{card.class_rank ? `${card.class_rank} of ${card.class_size}` : '-'}</Info>
        </dl>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <caption className="mb-2 text-left font-semibold">Subjects</caption>
            <thead className="border-y border-line/70 text-xs uppercase tracking-wide text-ink/60">
              <tr>
                <th scope="col" className="py-2 pr-3 font-semibold">Subject</th>
                {COMPONENTS.map(([k, label]) => (
                  <th key={k} scope="col" className="px-2 py-2 text-right font-semibold">
                    {label}
                    {scheme?.components?.[k] != null && <span className="font-normal normal-case text-ink/50"> /{scheme.components[k]}</span>}
                  </th>
                ))}
                <th scope="col" className="px-2 py-2 text-right font-semibold">CIE total</th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">Total</th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">Attend.</th>
                <th scope="col" className="px-2 py-2 font-semibold">Grade</th>
                <th scope="col" className="py-2 pl-2 font-semibold">Result</th>
              </tr>
            </thead>
            <tbody>
              {subjects.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-ink/60">
                    No subjects recorded yet.
                  </td>
                </tr>
              ) : (
                subjects.map((s) => {
                  const cieLow = rules?.cie_total_min != null && s.cie_total != null && ['cie1', 'cie2', 'cie3'].every((k) => s[k] != null) && s.cie_total < rules.cie_total_min;
                  const att = attOf(s);
                  return (
                    <tr key={s.id ?? s.subject} className="border-b border-line/40 last:border-0">
                      <th scope="row" className="py-2 pr-3 text-left font-medium">
                        {s.subject}
                      </th>
                      {COMPONENTS.map(([k]) => {
                        const min = k === 'see' ? rules?.see_min : rules?.cie_each_min?.[k];
                        return (
                          <td key={k} className={`px-2 py-2 text-right tabular ${s[k] != null && min != null && s[k] < min ? 'font-semibold text-bad' : ''}`}>
                            {num(s[k])}
                          </td>
                        );
                      })}
                      <td className={`whitespace-nowrap px-2 py-2 text-right tabular ${cieLow ? 'font-semibold text-bad' : ''}`}>
                        {num(s.cie_total)}
                        {cieMax != null && `/${cieMax}`}
                        {rules?.cie_total_min != null && <span className="block text-[11px] font-normal text-ink/50">min {rules.cie_total_min}</span>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular">{s.out_of ? `${num(s.obtained)}/${num(s.out_of)}` : '-'}</td>
                      <td className={`px-2 py-2 text-right tabular ${att != null && att < (rules?.attendance_min_pct ?? 80) ? 'font-semibold text-bad' : ''}`}>{pctText(att)}</td>
                      <td className="px-2 py-2">
                        <GradeBadge grade={s.grade} />
                      </td>
                      <td className="py-2 pl-2">
                        <ResultChip result={s.result} reasons={s.reasons} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {flagged.length > 0 && (
          <section aria-labelledby="rc-notes" className="rounded-xl bg-bad/5 p-4 ring-1 ring-bad/20">
            <h3 id="rc-notes" className="font-semibold">
              Notes
            </h3>
            <ul className="mt-2 grid gap-1 text-sm">
              {flagged.map((s) => (
                <li key={s.id ?? s.subject}>
                  <strong>{s.subject}</strong>: {s.reasons.join('; ')}
                </li>
              ))}
            </ul>
          </section>
        )}

        {rules && (
          <p className="text-xs text-ink/60">
            To pass a subject: at least {Object.entries(rules.cie_each_min ?? {}).map(([k, v]) => `${v} in ${k.toUpperCase()}`).join(', ')}; a CIE total of {rules.cie_total_min}
            {cieMax != null && ` out of ${cieMax}`}; at least {rules.see_min} in the SEE; and {rules.attendance_min_pct}% attendance.
          </p>
        )}

        {card.projects?.length > 0 && (
          <section aria-labelledby="rc-projects">
            <h3 id="rc-projects" className="mb-2 font-semibold">
              Projects
            </h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {card.projects.map((p) => (
                <li key={p.id} className="rounded-xl p-3 ring-1 ring-line/60">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{p.title}</p>
                    <StatusChip status={p.status} />
                  </div>
                  <p className="mt-1 text-xs text-ink/60">
                    Guide: {p.guide_name || p.guide || '-'}
                    {p.score != null && ` · Score ${num(p.score)}/100`}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </div>
  );
}
