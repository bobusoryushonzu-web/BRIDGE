/** 店員ログイン (BK-13) */
import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ErrorBanner, Field, Spinner, inputClass } from '../components/ui';

export default function Login() {
  const { loading, session, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <Spinner label="確認しています" />;
  if (session) return <Navigate to="/" replace />;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ログインできませんでした');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-3xl font-black tracking-widest">BRIDGE</p>
          <p className="mt-2 text-sm text-stone-500">従業員操作用 管理パネル</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-6 shadow-sm">
          {error && <ErrorBanner message={error} />}

          <div className="space-y-4">
            <Field label="メールアドレス">
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label="パスワード">
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          <div className="mt-6">
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-stone-800 py-3 font-bold text-white transition hover:bg-stone-700 disabled:bg-stone-300"
            >
              {submitting ? 'ログインしています…' : 'ログイン'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
