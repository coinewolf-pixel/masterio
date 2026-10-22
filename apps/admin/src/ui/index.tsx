import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@masterio/shared';
import type { OrderStatus } from '../api/types';

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      <div className="spacer" />
      {children}
    </div>
  );
}

export function Section({ title, actions, children, flush }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="section">
      {title || actions ? (
        <header>
          {title ? <h2>{title}</h2> : null}
          <div className="spacer" />
          {actions}
        </header>
      ) : null}
      <div className={flush ? 'body flush' : 'body'}>{children}</div>
    </section>
  );
}

/** Сообщение об ошибке API по ключу перевода. */
export function ErrorNote({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  let text = t('errors.INTERNAL');
  if (error instanceof ApiError) {
    text = error.code === 'NETWORK' ? t('common.network') : t(error.messageKey, { defaultValue: t('errors.INTERNAL') });
    if (error.code === 'VALIDATION_FAILED' && Array.isArray(error.details)) {
      const fields = (error.details as Array<{ path?: string; message?: string }>).map((d) => [d.path, d.message].filter(Boolean).join(': ')).filter(Boolean);
      if (fields.length > 0) text = `${text} ${fields.join('; ')}`;
    }
  }
  return (
    <p className="note" data-tone="alert" role="alert">
      {text}
    </p>
  );
}

export function Note({ children, tone }: { children: ReactNode; tone?: 'ok' | 'warn' | 'alert' }) {
  return (
    <p className="note" data-tone={tone}>
      {children}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Loading() {
  const { t } = useTranslation();
  return (
    <div className="empty" aria-busy="true">
      {t('common.loading')}
    </div>
  );
}

const ORDER_TONE: Record<OrderStatus, Tone> = {
  DRAFT: 'none',
  SEARCHING: 'live',
  NO_WORKERS: 'warn',
  ACCEPTED: 'active',
  EN_ROUTE: 'active',
  ARRIVED: 'active',
  IN_PROGRESS: 'active',
  COMPLETED_BY_WORKER: 'warn',
  CONFIRMED: 'ok',
  AUTO_CONFIRMED: 'ok',
  CLOSED: 'ok',
  DISPUTED: 'alert',
  CANCELLED_BY_CLIENT: 'none',
  CANCELLED_BY_WORKER: 'none',
  CANCELLED_BY_ADMIN: 'none',
};

type Tone = 'none' | 'live' | 'active' | 'ok' | 'warn' | 'alert';

export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="status" data-tone={tone}>
      {children}
    </span>
  );
}

export function OrderStatusLabel({ status }: { status: OrderStatus }) {
  const { t } = useTranslation();
  return <Status tone={ORDER_TONE[status]}>{t(`order.status.${status}`)}</Status>;
}

export function UserStatusLabel({ status }: { status: string }) {
  const { t } = useTranslation();
  const tone: Tone = status === 'ACTIVE' ? 'ok' : status === 'BLOCKED' || status === 'SUSPENDED' ? 'alert' : status === 'DELETED' ? 'none' : 'warn';
  return <Status tone={tone}>{t(`userStatus.${status}`)}</Status>;
}

export function VerificationLabel({ status }: { status: string }) {
  const { t } = useTranslation();
  const tone: Tone = status === 'VERIFIED' ? 'ok' : status === 'REJECTED' ? 'alert' : status === 'EXPIRED' ? 'warn' : 'live';
  return <Status tone={tone}>{t(`verification.${status}`)}</Status>;
}

/** Модальное окно на нативном <dialog>: фокус внутри, Esc закрывает. */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-label={title}>
      {open ? (
        <div>
          <h2>{title}</h2>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

export function Field({ label, children, error }: { label: string; children: ReactNode; error?: string | null }) {
  return (
    <label className="field">
      {label}
      {children}
      {error ? <span className="field-error">{error}</span> : null}
    </label>
  );
}

export function LoadMore({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  if (!hasMore) return null;
  return (
    <div className="row" style={{ justifyContent: 'center', padding: 12 }}>
      <button type="button" onClick={onClick} disabled={loading}>
        {loading ? t('common.loading') : t('common.loadMore')}
      </button>
    </div>
  );
}

export function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="faint">—</span>;
  return <code className="json">{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</code>;
}
