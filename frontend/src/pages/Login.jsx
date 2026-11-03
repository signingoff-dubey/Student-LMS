import { useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { login } from '../lib/api';
import { Field, FormError } from '../components/ui';

export default function Login({ onSignedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await login(username.trim(), password));
    } catch (err) {
      setError(err.status === 401 ? err.message || 'Wrong username or password.' : err.message);
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <form onSubmit={submit} noValidate className="card grid w-full max-w-sm gap-4" aria-labelledby="login-title">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-accent text-on-accent" aria-hidden="true">
            <GraduationCap size={22} />
          </span>
          <div>
            <h1 id="login-title" className="text-xl font-semibold">
              Student Records
            </h1>
            <p className="text-sm text-ink/60">Sign in to continue</p>
          </div>
        </div>
        <FormError>{error}</FormError>
        <Field id="login-user" label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        <Field
          id="login-pass"
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          hint="Students: first sign-in uses your student ID as both username and password."
          required
        />
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
