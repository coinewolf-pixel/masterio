import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../api';
import type { QueueDocument, VerificationStatus } from '../api/types';
import { useSession } from '../auth/Session';
import { useCatalog } from '../catalog';
import { date, dateTime } from '../format';
import { Dialog, Empty, ErrorNote, Field, Loading, PageHead, Section, Status, VerificationLabel } from '../ui';

const TABS: VerificationStatus[] = ['NOT_VERIFIED', 'REJECTED', 'VERIFIED', 'EXPIRED'];

/**
 * Очередь проверки документов (разделы 14, 19.5): удостоверения, селфи, лицензии, страховки.
 * Файл открывается временной ссылкой на 5 минут, каждый просмотр пишется в журнал доступа.
 */
export function DocumentsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const { categoryName } = useCatalog();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<VerificationStatus>('NOT_VERIFIED');
  const [rejecting, setRejecting] = useState<QueueDocument | null>(null);
  const [reason, setReason] = useState('');
  const [viewError, setViewError] = useState<unknown>(null);
  const docs = useQuery({ queryKey: ['documents', tab], queryFn: () => api.documents(tab) });

  const review = useMutation({
    mutationFn: (v: { id: string; decision: 'approve' | 'reject'; reason?: string }) => api.reviewDocument(v.id, v.decision, v.reason),
    onSuccess: async () => {
      setRejecting(null);
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['documents'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const view = async (id: string) => {
    setViewError(null);
    // окно открывается сразу (по клику), иначе браузер заблокирует всплывающее окно после запроса
    const win = window.open('about:blank', '_blank');
    try {
      const { url } = await api.documentUrl(id);
      if (win) {
        win.opener = null;
        win.location.href = url;
      }
    } catch (e) {
      win?.close();
      setViewError(e);
    }
  };

  return (
    <>
      <PageHead title={t('documents.title')} sub={t('documents.sub')} />
      <div className="tabs" role="tablist">
        {TABS.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={tab === s} onClick={() => setTab(s)}>
            {t(`documents.tab.${s}`)}
          </button>
        ))}
      </div>
      <ErrorNote error={viewError ?? review.error} />
      <Section flush>
        {docs.isLoading ? <Loading /> : null}
        <ErrorNote error={docs.error} />
        {docs.data && docs.data.length === 0 ? <Empty>{tab === 'NOT_VERIFIED' ? t('documents.emptyQueue') : t('documents.empty')}</Empty> : null}
        {docs.data && docs.data.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('documents.uploaded')}</th>
                  <th>{t('documents.owner')}</th>
                  <th>{t('documents.kind')}</th>
                  <th>{t('documents.details')}</th>
                  <th>{t('orders.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {docs.data.map((d) => (
                  <tr key={d.id}>
                    <td className="num">{dateTime(d.createdAt)}</td>
                    <td>
                      <Link to={`/workers/${d.owner.id}`}>{d.owner.name ?? t('common.noName')}</Link>
                      <div className="faint">{d.owner.phone}</div>
                      {d.team ? (
                        <div>
                          <Status tone="none">{t('teams.memberBadge', { role: t(`teams.role.${d.team.role}`) })}</Status>{' '}
                          <Link to={`/workers/${d.team.ownerId}`}>{d.team.name}</Link>
                        </div>
                      ) : null}
                    </td>
                    <td>{t(`documents.kinds.${d.kind}`, { defaultValue: d.kind })}</td>
                    <td>
                      {d.license ? (
                        <div>
                          {categoryName(d.license.categoryId)}
                          {d.license.number ? `, ${d.license.number}` : ''}
                        </div>
                      ) : null}
                      {d.insurance ? (
                        <div>
                          {d.insurance.insurerName}, {d.insurance.policyNumber}
                        </div>
                      ) : null}
                      {d.validUntil ? <div className="faint">{t('documents.validUntil', { date: date(d.validUntil) })}</div> : null}
                      {d.rejectReason ? <div className="faint">{t('documents.rejectedBecause', { reason: d.rejectReason })}</div> : null}
                    </td>
                    <td>
                      <VerificationLabel status={d.status} />
                    </td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button type="button" onClick={() => void view(d.id)}>
                          {t('documents.open')}
                        </button>
                        {can('reviewDocuments') && d.status === 'NOT_VERIFIED' ? (
                          <>
                            <button type="button" className="primary" disabled={review.isPending} onClick={() => review.mutate({ id: d.id, decision: 'approve' })}>
                              {t('documents.approve')}
                            </button>
                            <button type="button" className="danger" onClick={() => setRejecting(d)}>
                              {t('documents.reject')}
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>

      <Dialog open={rejecting !== null} onClose={() => setRejecting(null)} title={t('documents.rejectTitle')}>
        <p className="muted">{t('documents.rejectHint')}</p>
        <Field label={t('documents.reason')}>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
        </Field>
        <ErrorNote error={review.error} />
        <div className="actions">
          <button type="button" onClick={() => setRejecting(null)}>
            {t('common.close')}
          </button>
          <button
            type="button"
            className="danger"
            disabled={reason.trim().length < 3 || review.isPending}
            onClick={() => rejecting && review.mutate({ id: rejecting.id, decision: 'reject', reason: reason.trim() })}
          >
            {t('documents.reject')}
          </button>
        </div>
      </Dialog>
    </>
  );
}
