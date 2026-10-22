import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../api';
import { dateTime } from '../format';
import { Empty, ErrorNote, Field, Json, LoadMore, Loading, PageHead, Section } from '../ui';
import { useDebounced } from './Workers';

const ENTITY_TYPES = ['User', 'WorkerProfile', 'Order', 'Setting', 'WalletGrant', 'Document', 'FraudFlag', 'Category', 'CategoryGroup', 'City', 'Ledger'];

/** Куда ведёт запись журнала: заказ, мастер или клиент открываются в CRM. */
function entityLink(type: string, id: string): string | null {
  if (type === 'Order') return `/orders/${id}`;
  if (type === 'WorkerProfile') return `/workers/${id}`;
  return null;
}

/** Журнал действий админов (раздел 14): кто, что, когда, до и после, с какого IP. Только superadmin. */
export function AuditPage() {
  const { t } = useTranslation();
  const admins = useQuery({ queryKey: ['admins'], queryFn: api.admins });
  const [adminId, setAdminId] = useState('');
  const [entityType, setEntityType] = useState('');
  const [entityIdInput, setEntityIdInput] = useState('');
  const entityId = useDebounced(entityIdInput.trim());
  const query = { adminId: adminId || undefined, entityType: entityType || undefined, entityId: entityId || undefined, limit: 50 };
  const log = useInfiniteQuery({
    queryKey: ['audit', query],
    queryFn: ({ pageParam }) => api.audit({ ...query, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = log.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHead title={t('audit.title')} sub={t('audit.sub')} />
      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label={t('common.filters')}>
        <Field label={t('audit.admin')}>
          <select value={adminId} onChange={(e) => setAdminId(e.target.value)}>
            <option value="">{t('common.all')}</option>
            {(admins.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.email}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('audit.entityType')}>
          <select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            <option value="">{t('common.all')}</option>
            {ENTITY_TYPES.map((e) => (
              <option key={e} value={e}>
                {t(`audit.entity.${e}`, { defaultValue: e })}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('audit.entityId')}>
          <input value={entityIdInput} onChange={(e) => setEntityIdInput(e.target.value)} placeholder="uuid" />
        </Field>
      </form>

      <Section flush>
        {log.isLoading ? <Loading /> : null}
        <ErrorNote error={log.error} />
        {log.data && rows.length === 0 ? <Empty>{t('audit.empty')}</Empty> : null}
        {rows.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('audit.when')}</th>
                  <th>{t('audit.admin')}</th>
                  <th>{t('audit.action')}</th>
                  <th>{t('audit.object')}</th>
                  <th>{t('audit.before')}</th>
                  <th>{t('audit.after')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const link = entityLink(r.entityType, r.entityId);
                  return (
                    <tr key={r.id}>
                      <td>
                        {dateTime(r.createdAt)}
                        {r.ip ? <div className="faint">{r.ip}</div> : null}
                      </td>
                      <td>{r.adminEmail ?? r.adminId.slice(0, 8)}</td>
                      <td>{t(`audit.actions.${r.action.replace(/\./g, '_')}`, { defaultValue: r.action })}</td>
                      <td>
                        {t(`audit.entity.${r.entityType}`, { defaultValue: r.entityType })}
                        <div className="faint">{link ? <Link to={link}>{r.entityId.slice(0, 8)}</Link> : r.entityId}</div>
                      </td>
                      <td>
                        <Json value={r.before} />
                      </td>
                      <td>
                        <Json value={r.after} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        <LoadMore hasMore={log.hasNextPage} loading={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()} />
      </Section>
    </>
  );
}
