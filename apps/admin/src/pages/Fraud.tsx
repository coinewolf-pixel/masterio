import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../api';
import type { FraudFlag } from '../api/types';
import { useSession } from '../auth/Session';
import { dateTime } from '../format';
import { Dialog, Empty, ErrorNote, Field, Json, Loading, PageHead, Section, Status } from '../ui';

/** Типы, при которых возможен прямой ущерб платформе или клиенту — выделяются красным. */
const SEVERE = ['OFF_PLATFORM_ATTEMPT', 'CASH_HIDDEN_ORDER', 'MULTI_ACCOUNT', 'REFUND_SPIKE', 'SUSPICIOUS_PAIR'];

/**
 * Подозрительные действия (разделы 14, 20.6): частые отмены, споры, расхождения GPS, подозрительные пары,
 * попытки увести оплату, мультиаккаунты, скрытые наличные заказы. Решение по отметке — с комментарием в журнал.
 */
export function FraudPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [resolved, setResolved] = useState(false);
  const [resolving, setResolving] = useState<FraudFlag | null>(null);
  const [note, setNote] = useState('');
  const flags = useQuery({ queryKey: ['fraud', resolved], queryFn: () => api.fraudFlags(resolved) });
  const m = useMutation({
    mutationFn: () => api.resolveFlag(resolving?.id ?? '', note.trim()),
    onSuccess: async () => {
      setResolving(null);
      setNote('');
      await queryClient.invalidateQueries({ queryKey: ['fraud'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const person = (u: FraudFlag['user']) =>
    u ? (
      <Link to={u.role === 'WORKER' ? `/workers/${u.id}` : `/clients/${u.id}`}>
        {u.name ?? u.phone ?? u.id.slice(0, 8)} <span className="faint">({t(`fraud.role.${u.role}`, { defaultValue: u.role })})</span>
      </Link>
    ) : null;

  return (
    <>
      <PageHead title={t('fraud.title')} sub={t('fraud.sub')} />
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={!resolved} onClick={() => setResolved(false)}>
          {t('fraud.open')}
        </button>
        <button type="button" role="tab" aria-selected={resolved} onClick={() => setResolved(true)}>
          {t('fraud.resolved')}
        </button>
      </div>
      <Section flush>
        {flags.isLoading ? <Loading /> : null}
        <ErrorNote error={flags.error} />
        {flags.data && flags.data.length === 0 ? <Empty>{resolved ? t('fraud.emptyResolved') : t('fraud.empty')}</Empty> : null}
        {flags.data && flags.data.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('fraud.when')}</th>
                  <th>{t('fraud.typeLabel')}</th>
                  <th>{t('fraud.who')}</th>
                  <th>{t('fraud.details')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {flags.data.map((f) => (
                  <tr key={f.id}>
                    <td>{dateTime(f.createdAt)}</td>
                    <td>
                      <Status tone={SEVERE.includes(f.type) ? 'alert' : 'warn'}>{t(`fraud.type.${f.type}`, { defaultValue: f.type })}</Status>
                      <div className="faint">{t(`fraud.explain.${f.type}`, { defaultValue: '' })}</div>
                    </td>
                    <td>
                      {person(f.user)}
                      {f.pairUser ? <div>↔ {person(f.pairUser)}</div> : null}
                      {f.orderId ? (
                        <div>
                          <Link to={`/orders/${f.orderId}`}>{t('finance.order')}</Link>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <Json value={f.details} />
                    </td>
                    <td>
                      {!f.resolvedAt && can('resolveFlags') ? (
                        <button type="button" onClick={() => setResolving(f)}>
                          {t('fraud.resolve')}
                        </button>
                      ) : f.resolvedAt ? (
                        <span className="faint">{dateTime(f.resolvedAt)}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>

      <Dialog open={resolving !== null} onClose={() => setResolving(null)} title={t('fraud.resolveTitle')}>
        <p className="muted">{t('fraud.resolveHint')}</p>
        <Field label={t('fraud.note')}>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1_000} autoFocus />
        </Field>
        <ErrorNote error={m.error} />
        <div className="actions">
          <button type="button" onClick={() => setResolving(null)}>
            {t('common.close')}
          </button>
          <button type="button" className="primary" disabled={note.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
            {t('fraud.resolve')}
          </button>
        </div>
      </Dialog>
    </>
  );
}
