import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../api';
import { dateTime } from '../format';
import { Empty, ErrorNote, Loading, Note, PageHead, Section, Status } from '../ui';

/** Запросы пользователей на выгрузку и удаление данных (GDPR) и что сохранено по закону. */
export function PrivacyPage() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['dataRequests'], queryFn: api.dataRequests });
  return (
    <>
      <PageHead title={t('privacy.title')} sub={t('privacy.sub')} />
      <Note>{t('privacy.how')}</Note>
      <Section flush>
        {q.isLoading ? <Loading /> : null}
        <ErrorNote error={q.error} />
        {q.data && q.data.length === 0 ? <Empty>{t('privacy.empty')}</Empty> : null}
        {q.data && q.data.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('privacy.when')}</th>
                  <th>{t('privacy.type')}</th>
                  <th>{t('orders.status')}</th>
                  <th>{t('privacy.retained')}</th>
                  <th>{t('privacy.user')}</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((r) => (
                  <tr key={r.id}>
                    <td>{dateTime(r.createdAt)}</td>
                    <td>{t(`privacy.types.${r.type}`)}</td>
                    <td>
                      <Status tone={r.status === 'done' ? 'ok' : r.status === 'partially_retained' ? 'warn' : 'live'}>{t(`privacy.status.${r.status}`, { defaultValue: r.status })}</Status>
                    </td>
                    <td>
                      {(r.retainedReason ?? '')
                        .split('|')[0]
                        ?.split(',')
                        .filter(Boolean)
                        .map((x) => t(`privacy.kept.${x.trim()}`, { defaultValue: x.trim() }))
                        .join(', ') || '—'}
                    </td>
                    <td>
                      <Link to={r.userRole === 'WORKER' ? `/workers/${r.userId}` : `/clients/${r.userId}`} className="faint">
                        {r.userId.slice(0, 8)}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>
    </>
  );
}
