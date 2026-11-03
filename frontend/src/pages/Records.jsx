import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Pencil, Plus, Search, Table2, Trash2 } from 'lucide-react';
import { createRecord, deleteRecord, listRecords, updateRecord, useLoad, useScheme } from '../lib/api';
import { COMPONENTS, attOf, attendancePct, num, pctText } from '../lib/stats';
import { toast } from '../lib/toast';
import { ConfirmDialog, Empty, ErrorBanner, Field, FormError, GradeBadge, Modal, ResultWithReasons, SkeletonRows } from '../components/ui';

const CIE_KEYS = ['cie1', 'cie2', 'cie3'];

const IDENTITY = [
  { key: 'student_id', label: 'Student ID', placeholder: 'e.g. RVU2024001' },
  { key: 'name', label: 'Name', placeholder: 'Full name' },
  { key: 'department', label: 'Department', placeholder: 'e.g. CSE', list: 'departments' },
  { key: 'class_name', label: 'Class', placeholder: 'e.g. CSE-3A', list: 'classes' },
  { key: 'semester', label: 'Semester', type: 'number', min: 1, step: 1, inputMode: 'numeric' },
  { key: 'subject', label: 'Subject', placeholder: 'Same as the course name', list: 'subjects' },
];
const KEYS = [...IDENTITY.map((f) => f.key), ...COMPONENTS.map(([k]) => k), 'attended', 'total'];
const EMPTY = Object.fromEntries(KEYS.map((k) => [k, '']));
const isWhole = (v, min) => Number.isInteger(Number(v)) && Number(v) >= min;

function validate(f, scheme) {
  const errors = {};
  for (const k of ['student_id', 'name', 'department', 'class_name', 'subject']) if (!String(f[k]).trim()) errors[k] = 'Required.';
  if (f.semester === '' || !isWhole(f.semester, 1)) errors.semester = 'Enter a whole number, 1 or more.';
  for (const [k] of COMPONENTS) {
    if (f[k] === '') continue; // not assessed yet
    const max = scheme?.components?.[k] ?? 100;
    const v = Number(f[k]);
    if (Number.isNaN(v) || v < 0 || v > max) errors[k] = `Enter 0 to ${max}, or leave blank.`;
  }
  if (f.attended !== '' && !isWhole(f.attended, 0)) errors.attended = 'Enter a whole number, 0 or more.';
  if (f.total !== '' && !isWhole(f.total, 0)) errors.total = 'Enter a whole number, 0 or more.';
  if (!errors.attended && !errors.total && Number(f.attended || 0) > Number(f.total || 0)) errors.attended = 'Cannot be more than classes held.';
  return errors;
}

function RecordForm({ initial, onSaved, onCancel, suggestions, scheme }) {
  const [form, setForm] = useState(() => (initial ? Object.fromEntries(KEYS.map((k) => [k, initial[k] == null ? '' : String(initial[k])])) : EMPTY));
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const rules = scheme?.rules;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Live hints against the pass rules (allowed values, just flagged).
  const warn = {};
  for (const k of CIE_KEYS) {
    const min = rules?.cie_each_min?.[k];
    if (min != null && form[k] !== '' && Number(form[k]) < min) warn[k] = `Below the pass minimum of ${min}.`;
  }
  if (rules?.see_min != null && form.see !== '' && Number(form.see) < rules.see_min) warn.see = `Below the pass minimum of ${rules.see_min}.`;
  const att = attendancePct(form.attended || 0, form.total || 0);
  const attLow = rules?.attendance_min_pct != null && att != null && att < rules.attendance_min_pct;
  const cieEntered = CIE_KEYS.filter((k) => form[k] !== '');
  const cieTotal = cieEntered.reduce((s, k) => s + (Number(form[k]) || 0), 0);
  const cieMax = scheme ? CIE_KEYS.reduce((s, k) => s + (scheme.components?.[k] ?? 0), 0) : null;
  const cieLow = rules?.cie_total_min != null && cieEntered.length === 3 && cieTotal < rules.cie_total_min;

  const submit = async (e) => {
    e.preventDefault();
    const found = validate(form, scheme);
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementById(`f-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    const body = {
      student_id: form.student_id.trim(),
      name: form.name.trim(),
      department: form.department.trim(),
      class_name: form.class_name.trim(),
      subject: form.subject.trim(),
      semester: Number(form.semester),
      ...Object.fromEntries(COMPONENTS.map(([k]) => [k, form[k] === '' ? null : Number(form[k])])),
      attended: Number(form.attended || 0),
      total: Number(form.total || 0),
    };
    setSaving(true);
    setServerError(null);
    try {
      await (initial ? updateRecord(initial.id, body) : createRecord(body));
      onSaved();
    } catch (err) {
      setServerError(err.status === 409 ? `${err.message} Each student can have one row per subject.` : err.message);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <FormError>{serverError}</FormError>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink/70">Student and subject</legend>
        {IDENTITY.map(({ key, label, list, ...input }) => (
          <Field key={key} id={`f-${key}`} label={label} error={errors[key]} value={form[key]} onChange={set(key)} list={list ? `dl-${list}` : undefined} autoComplete="off" required {...input} />
        ))}
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-2 text-sm font-semibold text-ink/70">Scores (leave blank if not assessed yet)</legend>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {COMPONENTS.map(([k, label]) => {
            const max = scheme?.components?.[k];
            return (
              <Field
                key={k}
                id={`f-${k}`}
                label={max != null ? `${label} (/${max})` : label}
                type="number"
                min={0}
                max={max}
                step="any"
                inputMode="decimal"
                value={form[k]}
                onChange={set(k)}
                error={errors[k]}
                warn={warn[k]}
              />
            );
          })}
        </div>
        <p className={`text-sm ${cieLow ? 'font-semibold text-bad' : 'text-ink/70'}`} aria-live="polite">
          CIE total <span className="tabular">{num(cieTotal)}</span>
          {cieMax != null && `/${cieMax}`}
          {rules?.cie_total_min != null && ` (min ${rules.cie_total_min})`}
          {cieLow && ': below the pass minimum.'}
        </p>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink/70">Attendance (optional, defaults to 0)</legend>
        <Field id="f-attended" label="Classes attended" type="number" min={0} step={1} inputMode="numeric" value={form.attended} onChange={set('attended')} error={errors.attended} />
        <Field
          id="f-total"
          label="Classes held"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={form.total}
          onChange={set('total')}
          error={errors.total}
          warn={attLow ? `Attendance ${pctText(att)} is under the required ${rules.attendance_min_pct}%.` : undefined}
        />
      </fieldset>

      {Object.entries(suggestions).map(([name, values]) => (
        <datalist key={name} id={`dl-${name}`}>
          {values.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      ))}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-ghost">
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Saving...' : initial ? 'Save changes' : 'Add record'}
        </button>
      </div>
    </form>
  );
}

const Th = ({ children, right }) => (
  <th scope="col" className={`whitespace-nowrap px-3 py-3 font-semibold first:pl-4 ${right ? 'text-right' : ''}`}>
    {children}
  </th>
);

// Score cells shared by both tables: four components, obtained/out of, grade, result, attendance.
function ScoreCells({ r, scheme }) {
  const rules = scheme?.rules;
  const low = (k) => (k === 'see' ? rules?.see_min : rules?.cie_each_min?.[k]);
  const att = attOf(r);
  const attLow = att != null && att < (rules?.attendance_min_pct ?? 80);
  return (
    <>
      {COMPONENTS.map(([k]) => (
        <td key={k} className={`px-3 py-2.5 text-right tabular ${r[k] != null && low(k) != null && r[k] < low(k) ? 'font-semibold text-bad' : ''}`}>
          {num(r[k])}
        </td>
      ))}
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular">{r.out_of ? `${num(r.obtained)}/${num(r.out_of)}` : '-'}</td>
      <td className="px-3 py-2.5 text-center">
        <GradeBadge grade={r.grade} />
      </td>
      <td className="px-3 py-2.5">
        <ResultWithReasons result={r.result} reasons={r.reasons} />
      </td>
      <td className={`px-3 py-2.5 text-right tabular ${attLow ? 'font-semibold text-bad' : ''}`} title={`${r.attended ?? 0} of ${r.total ?? 0} classes`}>
        {pctText(att)}
      </td>
    </>
  );
}

const ScoreHeads = ({ scheme }) => (
  <>
    {COMPONENTS.map(([k, label]) => (
      <Th key={k} right>
        {label}
        {scheme?.components?.[k] != null && <span className="font-normal normal-case text-ink/50"> /{scheme.components[k]}</span>}
      </Th>
    ))}
    <Th right>Total</Th>
    <Th>Grade</Th>
    <Th>Result</Th>
    <Th right>Attend.</Th>
  </>
);

// Students see their own subjects, read-only.
function MySubjects() {
  const scheme = useScheme();
  const { data: records, error, reload } = useLoad(() => listRecords(), []);
  if (error && !records) return <ErrorBanner error={error} onRetry={reload} />;
  return (
    <section className="card overflow-hidden !p-0" aria-busy={!records}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <caption className="sr-only">My subjects</caption>
          <thead className="border-b border-line/70 text-xs uppercase tracking-wide text-ink/60">
            <tr>
              <Th>Subject</Th>
              <Th>Class</Th>
              <ScoreHeads scheme={scheme} />
            </tr>
          </thead>
          <tbody>
            {!records ? (
              <SkeletonRows cols={10} />
            ) : records.length === 0 ? (
              <tr>
                <td colSpan={10}>
                  <Empty icon={BookOpen} title="No marks yet" hint="Your teachers have not entered any marks for you. Check back after your first assessment." />
                </td>
              </tr>
            ) : (
              records.map((r) => (
                <tr key={r.id} className="border-b border-line/40 align-top last:border-0">
                  <th scope="row" className="px-3 py-2.5 pl-4 text-left font-medium">
                    {r.subject}
                  </th>
                  <td className="px-3 py-2.5">{r.class_name}</td>
                  <ScoreCells r={r} scheme={scheme} />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ManageRecords() {
  const scheme = useScheme();
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // null closed, {} new, record when editing
  const [removing, setRemoving] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: records, error, loading, reload } = useLoad(() => listRecords(q), [q]);

  const suggestions = useMemo(() => {
    const uniq = (k) => [...new Set((records ?? []).map((r) => r[k]).filter(Boolean))].sort();
    return { departments: uniq('department'), classes: uniq('class_name'), subjects: uniq('subject') };
  }, [records]);

  const saved = () => {
    toast(editing?.id ? 'Record updated.' : 'Record added.');
    setEditing(null);
    reload();
  };

  const confirmDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteRecord(removing.id);
      setRemoving(null);
      toast('Record deleted.');
      reload();
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <label htmlFor="search" className="sr-only">
            Search records
          </label>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/50" aria-hidden="true" />
          <input id="search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by ID, name, class or subject" className="field pl-9" />
        </div>
        <button type="button" onClick={() => setEditing({})} className="btn-primary">
          <Plus size={16} aria-hidden="true" /> Add record
        </button>
      </div>

      <p role="status" className="sr-only">
        {!loading && records ? `${records.length} record${records.length === 1 ? '' : 's'} shown.` : ''}
      </p>

      {error && <ErrorBanner error={error} onRetry={reload} />}
      {(records || !error) && (
        <section className="card overflow-hidden !p-0" aria-busy={loading}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[68rem] text-left text-sm">
              <caption className="sr-only">Student records{q ? `, filtered by "${q}"` : ''}</caption>
              <thead className="border-b border-line/70 text-xs uppercase tracking-wide text-ink/60">
                <tr>
                  <Th>Student</Th>
                  <Th>Class</Th>
                  <Th>Subject</Th>
                  <ScoreHeads scheme={scheme} />
                  <Th right>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className={loading && records ? 'opacity-60' : ''}>
                {!records ? (
                  <SkeletonRows cols={12} />
                ) : records.length === 0 ? (
                  <tr>
                    <td colSpan={12}>
                      <Empty
                        icon={Table2}
                        title={q ? `No records match "${q}"` : 'No records yet'}
                        hint={q ? 'Try a student ID, a name, a class or a subject.' : 'Add a record, or bring in a whole spreadsheet from Import.'}
                      />
                    </td>
                  </tr>
                ) : (
                  records.map((r) => (
                    <tr key={r.id} className="border-b border-line/40 align-top last:border-0 hover:bg-ink/[0.03]">
                      <th scope="row" className="px-3 py-2.5 pl-4 text-left font-normal">
                        <span className="block font-medium">{r.name}</span>
                        <span className="text-xs text-ink/60 tabular">{r.student_id}</span>
                      </th>
                      <td className="px-3 py-2.5">{r.class_name}</td>
                      <td className="px-3 py-2.5">{r.subject}</td>
                      <ScoreCells r={r} scheme={scheme} />
                      <td className="whitespace-nowrap px-3 py-1.5 text-right">
                        <button type="button" onClick={() => setEditing(r)} aria-label={`Edit ${r.name}, ${r.subject}`} className="inline-grid size-9 place-items-center rounded-full text-ink/70 hover:bg-ink/5 hover:text-ink">
                          <Pencil size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setRemoving(r);
                          }}
                          aria-label={`Delete ${r.name}, ${r.subject}`}
                          className="inline-grid size-9 place-items-center rounded-full text-ink/70 hover:bg-bad/10 hover:text-bad"
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit record' : 'Add record'} wide>
        {editing && <RecordForm initial={editing.id ? editing : null} onSaved={saved} onCancel={() => setEditing(null)} suggestions={suggestions} scheme={scheme} />}
      </Modal>

      <ConfirmDialog open={!!removing} title="Delete record?" busy={deleting} error={deleteError} onConfirm={confirmDelete} onCancel={() => setRemoving(null)}>
        {removing && (
          <p>
            This removes <strong>{removing.name}</strong>&apos;s <strong>{removing.subject}</strong> scores ({removing.student_id}). It cannot be undone.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}

export default function Records({ user }) {
  return user.role === 'student' ? <MySubjects /> : <ManageRecords />;
}
