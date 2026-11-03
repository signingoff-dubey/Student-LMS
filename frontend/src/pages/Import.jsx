import { useState } from 'react';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { importFile, useScheme } from '../lib/api';
import { toast } from '../lib/toast';
import { CardTitle, FormError, Notice } from '../components/ui';

const REQUIRED = ['student_id', 'name', 'department', 'semester', 'class', 'subject', 'cie1', 'cie2', 'cie3', 'see'];
const OPTIONAL = ['attended', 'total'];
const ACCEPT = '.xlsx,.csv';

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([`${[...REQUIRED, ...OPTIONAL].join(',')}\r\n`], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'student-records-template.csv' });
  a.click();
  URL.revokeObjectURL(url);
}

const okType = (file) => /\.(xlsx|csv)$/i.test(file.name);

export default function Import() {
  const scheme = useScheme();
  const maxima = scheme?.components ? ` (out of ${['cie1', 'cie2', 'cie3', 'see'].map((k) => scheme.components[k]).join(', ')})` : '';
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const pick = (f) => {
    setResult(null);
    if (!f) return;
    if (!okType(f)) {
      setFile(null);
      setError('Choose an .xlsx or .csv file.');
      return;
    }
    setError(null);
    setFile(f);
  };

  const upload = async (e) => {
    e.preventDefault();
    if (!file) {
      setError('Choose a file first.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await importFile(file);
      setResult({ saved: r?.saved ?? 0, rejected: Array.isArray(r?.rejected) ? r.rejected : [], rejectedCount: r?.rejected_count ?? r?.rejected?.length ?? 0 });
      toast(`Imported ${r?.saved ?? 0} row${r?.saved === 1 ? '' : 's'}.`);
      setFile(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
      <section className="card" aria-labelledby="upload-title">
        <CardTitle id="upload-title" sub="Each row holds one student's marks in one subject.">
          Upload a spreadsheet
        </CardTitle>
        <form onSubmit={upload} className="grid gap-4">
          <label
            htmlFor="import-file"
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pick(e.dataTransfer.files?.[0]);
            }}
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-10 text-center transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
              dragging ? 'border-accent bg-accent/10' : 'border-line hover:bg-ink/[0.03]'
            }`}
          >
            <FileSpreadsheet size={32} className="text-accent-deep" aria-hidden="true" />
            <span className="font-semibold">{file ? file.name : 'Drop a file here, or click to choose'}</span>
            <span className="text-xs text-ink/60">Excel (.xlsx) or CSV, first row is the header</span>
            <input id="import-file" type="file" accept={ACCEPT} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          <FormError>{error}</FormError>
          <div className="flex justify-end">
            <button type="submit" disabled={busy || !file} className="btn-primary">
              <Upload size={16} aria-hidden="true" /> {busy ? 'Importing...' : 'Import'}
            </button>
          </div>
        </form>

        <div className="mt-4 grid gap-4">
          <Notice>
            {result &&
              `Saved ${result.saved} row${result.saved === 1 ? '' : 's'}. ${result.rejectedCount} rejected. Dashboard, Records and Reports show the new data when you open them.`}
          </Notice>
          {result?.rejected.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-line/70">
              <table className="w-full text-left text-sm">
                <caption className="px-4 py-2 text-left font-semibold">Rejected rows</caption>
                <thead className="border-y border-line/70 text-xs uppercase tracking-wide text-ink/60">
                  <tr>
                    <th scope="col" className="w-24 px-4 py-2 text-right font-semibold">Row</th>
                    <th scope="col" className="px-4 py-2 font-semibold">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rejected.map((r, i) => (
                    <tr key={`${r.row}-${i}`} className="border-b border-line/40 last:border-0">
                      <td className="px-4 py-2 text-right tabular">{r.row}</td>
                      <td className="px-4 py-2">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-4 py-2 text-xs text-ink/60">Row numbers match the spreadsheet, counting the header as row 1.</p>
            </div>
          )}
        </div>
      </section>

      <section className="card h-fit" aria-labelledby="cols-title">
        <CardTitle id="cols-title" sub="One row per student per subject.">
          Columns
        </CardTitle>
        <p className="mb-2 text-sm font-medium">Required</p>
        <ul className="mb-4 flex flex-wrap gap-1.5">
          {REQUIRED.map((c) => (
            <li key={c} className="rounded-md bg-ink/5 px-2 py-0.5 font-mono text-xs">
              {c}
            </li>
          ))}
        </ul>
        <p className="mb-2 text-sm font-medium">Optional</p>
        <ul className="mb-4 flex flex-wrap gap-1.5">
          {OPTIONAL.map((c) => (
            <li key={c} className="rounded-md bg-ink/5 px-2 py-0.5 font-mono text-xs">
              {c}
            </li>
          ))}
        </ul>
        <p className="mb-4 text-xs text-ink/60">cie1, cie2, cie3 and see are the scores{maxima}; leave a cell empty if that part is not assessed yet. attended and total are class counts and default to 0. A new class name creates the class.</p>
        <button type="button" onClick={downloadTemplate} className="btn-dark w-full">
          <Download size={16} aria-hidden="true" /> Download template CSV
        </button>
      </section>
    </div>
  );
}
