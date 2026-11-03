import { useId } from 'react';
import { BadgeCheck, CalendarX, CircleX, Download, Hourglass, Trophy } from 'lucide-react';
import { getReports, getScheme, listRecords, safe, useLoad } from '../lib/api';
import { componentData, downloadCsv, fmt, gradeData, pctText, rankStudents } from '../lib/stats';
import { BarCard, CardTitle, ErrorBanner, Loading, Meter, StatCard } from '../components/ui';

function PerformanceCard({ title, rows, labelKey }) {
  const id = useId();
  const sorted = [...rows].sort((a, b) => b.average - a.average);
  return (
    <section className="card" aria-labelledby={id}>
      <CardTitle id={id} sub="Average marks (bar) and attendance, highest marks first">
        {title}
      </CardTitle>
      {sorted.length ? (
        <ul className="grid gap-3">
          {sorted.map((r) => (
            <li key={r[labelKey]} className="grid grid-cols-[minmax(0,7rem)_1fr_3rem_3.5rem] items-center gap-3 text-sm">
              <span className="truncate font-medium">{r[labelKey]}</span>
              <Meter value={r.average} />
              <span className="text-right font-semibold tabular">
                <span className="sr-only">average </span>
                {fmt(r.average)}
              </span>
              <span className="text-right text-ink/70 tabular">
                <span className="sr-only">attendance </span>
                {pctText(r.attendance)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink/60">No data yet.</p>
      )}
    </section>
  );
}

export default function Reports() {
  const { data, error, reload } = useLoad(() => Promise.all([getReports(), listRecords(), safe(getScheme(), null)]), []);
  const rankingId = useId();
  if (error && !data) return <ErrorBanner error={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading reports" />;

  const [report, records, scheme] = data;
  const ranking = rankStudents(records);
  const topper = report.topper;
  const topperRows = topper ? records.filter((r) => r.student_id === topper.student_id) : [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-white/70">
          {records.length} records from {ranking.length} students · overall average {fmt(report.average)} · attendance {pctText(report.attendance)}
        </p>
        <button type="button" onClick={() => downloadCsv(records, `student-records-${new Date().toISOString().slice(0, 10)}.csv`)} disabled={!records.length} className="btn-primary">
          <Download size={16} aria-hidden="true" /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Pass rate" icon={BadgeCheck} iconClass="bg-good/12 text-good" value={pctText(report.pass_rate)} foot="Of subjects with a final result" />
        <StatCard title="Failed" icon={CircleX} iconClass="bg-bad/12 text-bad" value={report.results.fail ?? 0} unit="subject results" foot="Below a pass minimum" />
        <StatCard title="Low attendance" icon={CalendarX} iconClass="bg-warn/15 text-warn" value={report.results.shortage ?? 0} unit="subject results" foot={scheme?.rules ? `Under ${scheme.rules.attendance_min_pct}% attendance` : 'Attendance too low'} />
        <StatCard title="Pending" icon={Hourglass} iconClass="bg-info/12 text-info" value={report.results.pending ?? 0} unit="subject results" foot="Not every part assessed yet" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <BarCard title="Assessment averages" sub="Average score in each part, as a percent of its maximum" data={componentData(report.components)} series={[{ key: 'value', label: 'Average % of max', color: '#f26b1d' }]} />
        <BarCard title="Grade distribution" sub="Subject results per grade (pending not counted)" data={gradeData(report.grades, scheme)} series={[{ key: 'value', label: 'Results', color: '#f26b1d' }]} max={null} />
      </div>

      <section className="card" aria-labelledby="topper-title">
        <CardTitle id="topper-title" sub="Highest average across all subjects">
          Topper
        </CardTitle>
        {topper ? (
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-full bg-accent text-on-accent" aria-hidden="true">
                <Trophy size={22} />
              </span>
              <div>
                <p className="text-lg font-semibold">{topper.name}</p>
                <p className="text-sm text-ink/60">
                  {topper.student_id}
                  {topperRows[0] ? ` · ${topperRows[0].class_name || topperRows[0].department} · Semester ${topperRows[0].semester}` : ''}
                </p>
              </div>
              <p className="ml-4">
                <span className="text-3xl font-bold tabular">{fmt(topper.average)}</span> <span className="text-xs text-ink/60">avg</span>
              </p>
            </div>
            {topperRows.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Topper's marks by subject">
                {topperRows.map((r) => (
                  <li key={r.id} className="rounded-full bg-ink/5 px-3 py-1 text-sm">
                    {r.subject} <span className="font-semibold tabular">{fmt(r.marks, 0)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink/60">No records yet.</p>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <PerformanceCard title="Class performance" rows={report.classes} labelKey="class_name" />
        <PerformanceCard title="Subject performance" rows={report.subjects} labelKey="subject" />
        <PerformanceCard title="Department performance" rows={report.departments} labelKey="department" />
      </div>

      <section className="card overflow-hidden !p-0" aria-labelledby={rankingId}>
        <div className="p-4 pb-0 sm:p-5 sm:pb-0">
          <CardTitle id={rankingId} sub="Students ranked by average marks across their subjects">
            Ranking
          </CardTitle>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-y border-line/70 text-xs uppercase tracking-wide text-ink/60">
              <tr>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Rank</th>
                <th scope="col" className="px-4 py-3 font-semibold">Student</th>
                <th scope="col" className="px-4 py-3 font-semibold">Class</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Subjects</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Attendance</th>
                <th scope="col" className="px-4 py-3 font-semibold">Average</th>
              </tr>
            </thead>
            <tbody>
              {ranking.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-ink/60">No records yet.</td>
                </tr>
              ) : (
                ranking.map((s) => (
                  <tr key={s.student_id} className="border-b border-line/40 last:border-0">
                    <td className="px-4 py-2.5 text-right font-semibold tabular">{s.rank}</td>
                    <th scope="row" className="px-4 py-2.5 text-left font-normal">
                      <span className="font-medium">{s.name}</span> <span className="text-ink/60">{s.student_id}</span>
                    </th>
                    <td className="px-4 py-2.5">{s.class_name || s.department}</td>
                    <td className="px-4 py-2.5 text-right tabular">{s.subjects}</td>
                    <td className="px-4 py-2.5 text-right tabular">{pctText(s.attendance)}</td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-3">
                        <span className="w-10 text-right font-semibold tabular">{fmt(s.average)}</span>
                        <Meter value={s.average} />
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
