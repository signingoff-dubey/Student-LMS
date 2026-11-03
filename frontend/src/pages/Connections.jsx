import { useEffect, useState } from 'react';
import { Link2, RefreshCw, Unplug } from 'lucide-react';
import { addSource, deleteSource, listSources, syncSource, useLoad } from '../lib/api';
import { ago } from '../lib/stats';
import { CardTitle, ConfirmDialog, ErrorBanner, Field, FormError, Notice } from '../components/ui';

const POLL_MS = 15000;

const statusTone = (status = '') =>
  /^error/i.test(status) ? 'bg-bad/10 text-bad ring-bad/30' : /^synced/i.test(status) ? 'bg-good/10 text-[#17663a] ring-good/30' : 'bg-ink/5 text-ink/75 ring-ink/10';

export default function Connections({ user }) {
  const isAdmin = user.role === 'admin';
  const { data: sources, error, loading, reload } = useLoad(listSources, []);
  const [location, setLocation] = useState('');
  const [formError, setFormError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [rowError, setRowError] = useState(null);
  const [notice, setNotice] = useState('');
  const [removing, setRemoving] = useState(null);
  const [removeError, setRemoveError] = useState(null);

  // Poll while the page is open so status changes from the server's 60 s sync show up.
  useEffect(() => {
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async (e) => {
    e.preventDefault();
    const loc = location.trim();
    const isLink = /^https?:\/\//i.test(loc);
    const isPath = /\.(xlsx|csv)$/i.test(loc);
    if (!loc) return setFormError('Paste a share link.');
    if (!isLink && !(isAdmin && isPath)) {
      return setFormError(isAdmin ? 'Enter an https:// share link, or a server file path ending in .xlsx or .csv.' : 'Enter a Google Sheets or OneDrive share link starting with https://.');
    }
    setAdding(true);
    setFormError(null);
    try {
      const r = await addSource(loc);
      setLocation('');
      setNotice(`Connected. ${r?.status ? `Status: ${r.status}.` : ''}`);
      reload();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const syncNow = async (s) => {
    setBusyId(s.id);
    setRowError(null);
    try {
      const r = await syncSource(s.id);
      setNotice(`Synced. ${r?.status ? `Status: ${r.status}.` : ''}`);
      reload();
    } catch (err) {
      setRowError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const disconnect = async () => {
    setBusyId(removing.id);
    setRemoveError(null);
    try {
      await deleteSource(removing.id);
      setRemoving(null);
      setNotice('Disconnected.');
      reload();
    } catch (err) {
      setRemoveError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="grid gap-4">
      <section className="card" aria-labelledby="connect-title">
        <CardTitle id="connect-title" sub="The server checks each connected sheet every 60 seconds, so edits can take up to a minute to appear. Use Sync now to pull straight away.">
          Connect a live sheet
        </CardTitle>
        <form onSubmit={connect} noValidate className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
          <Field
            id="source-location"
            label={isAdmin ? 'Share link or server file path' : 'Share link'}
            placeholder={isAdmin ? 'https://docs.google.com/... or D:\\data\\marks.xlsx' : 'https://docs.google.com/spreadsheets/...'}
            hint='Google Sheets or OneDrive. Set sharing to "Anyone with the link can view". Use the same columns as Import.'
            error={formError}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            autoComplete="off"
          />
          <button type="submit" disabled={adding} className="btn-primary sm:mt-6">
            <Link2 size={16} aria-hidden="true" /> {adding ? 'Connecting...' : 'Connect'}
          </button>
        </form>
      </section>

      <Notice>{notice}</Notice>
      {error && <ErrorBanner error={error} onRetry={reload} />}
      {rowError && <ErrorBanner error={rowError} />}

      {(sources || !error) && (
        <section className="card overflow-hidden !p-0" aria-labelledby="sources-title" aria-busy={loading}>
          <div className="p-4 pb-0 sm:p-5 sm:pb-0">
            <CardTitle id="sources-title" sub="Refreshes every 15 seconds while this page is open.">
              Connected sheets
            </CardTitle>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="border-y border-line/70 text-xs uppercase tracking-wide text-ink/60">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Sheet</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Owner</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Last sync</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {!sources ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-ink/60">
                      Loading connections...
                    </td>
                  </tr>
                ) : sources.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-ink/60">
                      No sheets connected yet.
                    </td>
                  </tr>
                ) : (
                  sources.map((s) => (
                    <tr key={s.id} className="border-b border-line/40 last:border-0">
                      <th scope="row" className="max-w-[22rem] px-4 py-2.5 text-left font-normal">
                        {/^https?:\/\//i.test(s.location) ? (
                          <a href={s.location} target="_blank" rel="noreferrer" className="block truncate font-medium text-accent-deep underline underline-offset-2" title={s.location}>
                            {s.location}
                          </a>
                        ) : (
                          <span className="block truncate font-mono text-xs" title={s.location}>
                            {s.location}
                          </span>
                        )}
                      </th>
                      <td className="px-4 py-2.5">{s.owner}</td>
                      <td className="whitespace-nowrap px-4 py-2.5">{ago(s.last_sync)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block rounded-lg px-2 py-0.5 text-xs font-medium ring-1 ${statusTone(s.status)}`}>{s.status || 'Waiting for first sync'}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-1.5 text-right">
                        <button type="button" onClick={() => syncNow(s)} disabled={busyId === s.id} className="btn-ghost h-8 px-3 text-xs">
                          <RefreshCw size={14} className={busyId === s.id ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden="true" /> Sync now
                        </button>{' '}
                        <button
                          type="button"
                          onClick={() => {
                            setRemoveError(null);
                            setRemoving(s);
                          }}
                          className="btn h-8 px-3 text-xs text-bad hover:bg-bad/10"
                        >
                          <Unplug size={14} aria-hidden="true" /> Disconnect
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

      <ConfirmDialog
        open={!!removing}
        title="Disconnect sheet?"
        confirmLabel="Disconnect"
        busy={busyId === removing?.id}
        error={removeError}
        onConfirm={disconnect}
        onCancel={() => setRemoving(null)}
      >
        <p>The server will stop syncing this sheet.</p>
      </ConfirmDialog>
    </div>
  );
}
