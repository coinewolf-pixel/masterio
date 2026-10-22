import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { api } from '../api';
import type { VerificationStatus } from '../api/types';
import { useSession } from '../auth/Session';
import { useCatalog } from '../catalog';
import { date, dateTime, distance, money, percent } from '../format';
import { Dialog, Empty, ErrorNote, Field, Loading, Note, OrderStatusLabel, PageHead, Section, Status, UserStatusLabel, VerificationLabel } from '../ui';
import { BlockButtons, BlockDialog } from './BlockDialog';
import { GrantDialog } from './Grants';
import { TeamSection } from './TeamSection';

/** Карточка мастера: профиль, допуск к заказам, документы, кошелёк по карманам, начисления, отметки, блокировка. */
export function WorkerCardPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const { can } = useSession();
  const catalog = useCatalog();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['worker', id], queryFn: () => api.worker(id) });
  const wallet = useQuery({ queryKey: ['worker', id, 'wallet'], queryFn: () => api.workerWallet(id), enabled: can('viewWallet') });
  const [block, setBlock] = useState<'block' | 'unblock' | null>(null);
  const [kycOpen, setKycOpen] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);
  const [viewError, setViewError] = useState<unknown>(null);

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorNote error={q.error} />;
  const w = q.data;
  const e = w.eligibility;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['worker', id] });

  const view = async (docId: string) => {
    setViewError(null);
    const win = window.open('about:blank', '_blank');
    try {
      const { url } = await api.documentUrl(docId);
      if (win) {
        win.opener = null;
        win.location.href = url;
      }
    } catch (err) {
      win?.close();
      setViewError(err);
    }
  };

  return (
    <>
      <PageHead
        title={w.name ?? t('common.noName')}
        sub={
          <>
            {w.phone} · {w.type === 'COMPANY' ? `${t('workers.company')}: ${w.companyName ?? '—'}` : t('workers.independent')} · {t('people.sinceDate', { date: date(w.createdAt) })}
          </>
        }
      >
        <UserStatusLabel status={w.status} />
        <VerificationLabel status={w.kycStatus} />
        {can('setKyc') ? (
          <button type="button" onClick={() => setKycOpen(true)}>
            {t('workers.setKyc')}
          </button>
        ) : null}
        {can('createGrant') ? (
          <button type="button" onClick={() => setGrantOpen(true)}>
            {t('grants.create')}
          </button>
        ) : null}
        {can('blockUsers') ? <BlockButtons status={w.status} onPick={setBlock} /> : null}
      </PageHead>

      {e.eligible ? (
        <Note tone="ok">{t('workers.eligible')}</Note>
      ) : (
        <Note tone="warn">
          {t('workers.notEligible')}: {e.reasons.map((r) => t(`eligibility.${r}`, { defaultValue: r })).join('; ')}
        </Note>
      )}

      <div className="figures" style={{ marginBottom: 20 }}>
        <Figure label={t('workers.rating')} value={w.ratingCount > 0 ? `${w.ratingAvg.toFixed(2)}` : '—'} hint={t('workers.ratingCount', { count: w.ratingCount })} />
        <Figure label={t('workers.completed')} value={String(w.stats.completed)} hint={t('workers.ofTotal', { total: w.stats.total })} />
        <Figure label={t('workers.acceptRate')} value={percent(w.acceptRate)} />
        <Figure label={t('workers.cancelRate')} value={percent(w.cancelRate)} tone={w.cancelRate > 0.1 ? 'warn' : undefined} hint={t('workers.cancels30d', { count: w.cancelCount30d })} />
        <Figure label={t('workers.disputes')} value={String(w.stats.disputes)} tone={w.stats.disputes > 0 ? 'warn' : undefined} />
      </div>

      <div className="grid-2">
        <div className="stack">
          <Section
            title={t('workers.recentOrders')}
            actions={
              <Link to={`/orders?workerId=${w.id}`} className="quiet">
                {t('common.all')}
              </Link>
            }
            flush
          >
            {w.recentOrders.length === 0 ? <Empty>{t('workers.noOrders')}</Empty> : null}
            {w.recentOrders.length > 0 ? (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('orders.numberLabel')}</th>
                      <th>{t('orders.created')}</th>
                      <th>{t('orders.status')}</th>
                      <th>{t('orders.category')}</th>
                      <th className="num">{t('orders.amount')}</th>
                      <th className="num">{t('orders.commission')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {w.recentOrders.map((o) => (
                      <tr key={o.id}>
                        <td className="num">
                          <Link to={`/orders/${o.id}`}>#{o.number}</Link>
                        </td>
                        <td>{dateTime(o.createdAt)}</td>
                        <td>
                          <OrderStatusLabel status={o.status} />
                        </td>
                        <td>{catalog.categoryName(o.categoryId)}</td>
                        <td className="num">{money(o.confirmedAmountCents, o.currency)}</td>
                        <td className="num">{money(o.commissionCents, o.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Section>

          <Section title={t('workers.documents')} flush>
            <ErrorNote error={viewError} />
            {w.documents.length === 0 ? <Empty>{t('workers.noDocuments')}</Empty> : null}
            {w.documents.length > 0 ? (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('documents.kind')}</th>
                      <th>{t('documents.details')}</th>
                      <th>{t('orders.status')}</th>
                      <th>{t('documents.uploaded')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {w.documents.map((d) => (
                      <tr key={d.id}>
                        <td>{t(`documents.kinds.${d.kind}`, { defaultValue: d.kind })}</td>
                        <td>
                          {d.license ? <div>{catalog.categoryName(d.license.categoryId)}</div> : null}
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
                        <td>{dateTime(d.createdAt)}</td>
                        <td>
                          <button type="button" onClick={() => void view(d.id)}>
                            {t('documents.open')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Section>

          <TeamSection workerId={w.id} />

          {w.grants.length > 0 ? (
            <Section title={t('grants.title')} flush>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('grants.created')}</th>
                      <th className="num">{t('grants.amount')}</th>
                      <th>{t('grants.reason')}</th>
                      <th>{t('grants.expires')}</th>
                      <th>{t('orders.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {w.grants.map((g) => (
                      <tr key={g.id}>
                        <td>{dateTime(g.createdAt)}</td>
                        <td className="num">{money(g.amountCents, e.currency)}</td>
                        <td>{g.isAutoWelcome ? t('grants.auto') : g.reason}</td>
                        <td>{date(g.expiresAt)}</td>
                        <td>
                          <Status tone={g.status === 'APPROVED' ? 'ok' : g.status === 'REJECTED' ? 'none' : 'warn'}>{t(`grants.status.${g.status}`)}</Status>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          ) : null}

          {w.flags.length > 0 ? (
            <Section title={t('fraud.title')}>
              <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>
                {w.flags.map((fl) => (
                  <li key={fl.id}>
                    {t(`fraud.type.${fl.type}`, { defaultValue: fl.type })} · {dateTime(fl.createdAt)}
                    {fl.resolvedAt ? <span className="faint"> · {t('fraud.resolved')}</span> : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>

        <div className="stack">
          <Section title={t('workers.access')}>
            <dl className="facts num">
              <dt>{t('workers.accessBalance')}</dt>
              <dd>{money(e.accessBalanceCents, e.currency)}</dd>
              <dt>{t('workers.threshold')}</dt>
              <dd>{money(e.thresholdCents, e.currency)}</dd>
              <dt>{t('workers.debt')}</dt>
              <dd>{money(e.debtCents, e.currency)}</dd>
              <dt>{t('workers.debtLimit')}</dt>
              <dd>{money(e.debtLimitCents, e.currency)}</dd>
              <dt>{t('workers.activeOrder')}</dt>
              <dd>{e.activeOrderId ? <Link to={`/orders/${e.activeOrderId}`}>{t('common.open')}</Link> : '—'}</dd>
            </dl>
          </Section>

          {can('viewWallet') ? (
            <Section title={t('workers.wallet')}>
              {wallet.isLoading ? <Loading /> : null}
              <ErrorNote error={wallet.error} />
              {wallet.data ? (
                <dl className="facts num">
                  <dt>{t('pockets.topup')}</dt>
                  <dd>{money(wallet.data.topupCents, wallet.data.currency)}</dd>
                  <dt>{t('pockets.promo')}</dt>
                  <dd>{money(wallet.data.promoCents, wallet.data.currency)}</dd>
                  <dt>{t('pockets.bonus')}</dt>
                  <dd>{money(wallet.data.bonusCents, wallet.data.currency)}</dd>
                  <dt>{t('pockets.earnings')}</dt>
                  <dd>{money(wallet.data.earningsCents, wallet.data.currency)}</dd>
                  <dt>{t('pockets.pending')}</dt>
                  <dd>{money(wallet.data.pendingCents, wallet.data.currency)}</dd>
                  <dt>{t('pockets.debt')}</dt>
                  <dd>{money(wallet.data.debtCents, wallet.data.currency)}</dd>
                </dl>
              ) : null}
              <p className="faint">{t('workers.noWithdrawal')}</p>
            </Section>
          ) : null}

          <Section title={t('workers.profile')}>
            <dl className="facts">
              <dt>{t('workers.online')}</dt>
              <dd>{w.isOnline ? <Status tone="live">{t('workers.onlineYes')}</Status> : t('workers.onlineNo')}</dd>
              <dt>{t('workers.lastLocation')}</dt>
              <dd>{dateTime(w.lastLocationAt)}</dd>
              <dt>{t('workers.cities')}</dt>
              <dd>{w.cityIds.map((c) => catalog.cityName(c)).join(', ') || '—'}</dd>
              <dt>{t('workers.categories')}</dt>
              <dd>{w.categoryIds.map((c) => catalog.categoryName(c)).join(', ') || '—'}</dd>
              <dt>{t('workers.radius')}</dt>
              <dd>{w.preferredRadiusM ? distance(w.preferredRadiusM) : t('workers.radiusDefault')}</dd>
              {w.companyRegNumber ? (
                <>
                  <dt>{t('workers.regNumber')}</dt>
                  <dd>{w.companyRegNumber}</dd>
                </>
              ) : null}
              <dt>{t('people.language')}</dt>
              <dd>{w.locale}</dd>
              <dt>{t('people.country')}</dt>
              <dd>{w.countryCode}</dd>
            </dl>
          </Section>
        </div>
      </div>

      <BlockDialog userId={w.id} mode={block} onClose={() => setBlock(null)} onDone={refresh} />
      <KycDialog workerId={w.id} open={kycOpen} onClose={() => setKycOpen(false)} onDone={refresh} />
      <GrantDialog open={grantOpen} workerId={w.id} workerLabel={w.name ?? w.phone ?? w.id} onClose={() => setGrantOpen(false)} onDone={refresh} />
    </>
  );
}

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'warn' | 'alert' }) {
  return (
    <div className="figure" data-tone={tone}>
      <div className="value">{value}</div>
      <div className="label">{label}</div>
      {hint ? <div className="faint">{hint}</div> : null}
    </div>
  );
}

/** Решение по KYC вручную (обычно KYC подтверждается автоматически, когда одобрены удостоверение и селфи). */
function KycDialog({ workerId, open, onClose, onDone }: { workerId: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<VerificationStatus>('VERIFIED');
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api.setKyc(workerId, status, reason.trim() || undefined),
    onSuccess: () => {
      setReason('');
      onDone();
      onClose();
    },
  });
  const needsReason = status === 'REJECTED';
  return (
    <Dialog open={open} onClose={onClose} title={t('workers.setKyc')}>
      <Field label={t('orders.status')}>
        <select value={status} onChange={(e) => setStatus(e.target.value as VerificationStatus)}>
          {(['VERIFIED', 'REJECTED', 'NOT_VERIFIED'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`verification.${s}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('documents.reason')}>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Field>
      <ErrorNote error={m.error} />
      <div className="actions">
        <button type="button" onClick={onClose}>
          {t('common.close')}
        </button>
        <button type="button" className="primary" disabled={m.isPending || (needsReason && reason.trim().length < 3)} onClick={() => m.mutate()}>
          {t('common.save')}
        </button>
      </div>
    </Dialog>
  );
}
