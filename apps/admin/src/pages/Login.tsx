import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../auth/Session';
import { ErrorNote, Field } from '../ui';

/** Вход: e-mail, пароль и 6-значный код из приложения-аутентификатора (TOTP). */
export function LoginPage() {
  const { t } = useTranslation();
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password, totp);
    } catch (err) {
      setError(err);
      setTotp('');
    } finally {
      setBusy(false);
    }
  };

  const ready = email.includes('@') && password.length >= 8 && /^\d{6}$/.test(totp);

  return (
    <div className="login">
      <div className="login-side">
        <div className="brand">
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="#1F4E79" />
            <path d="M9 23V10l7 8 7-8v13" fill="none" stroke="#FFC43D" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Masterio CRM
        </div>
        <h1>{t('login.headline')}</h1>
        <p>{t('login.note')}</p>
      </div>
      <form className="login-form" onSubmit={(e) => void submit(e)}>
        <h2>{t('login.title')}</h2>
        <Field label={t('login.email')}>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label={t('login.password')}>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Field label={t('login.totp')}>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={totp}
            onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
            required
          />
        </Field>
        <ErrorNote error={error} />
        <button type="submit" className="primary" disabled={!ready || busy}>
          {busy ? t('common.loading') : t('login.submit')}
        </button>
        <p className="faint">{t('login.lost')}</p>
      </form>
    </div>
  );
}
