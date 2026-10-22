import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../api';
import type { FinanceCurrency } from '../api/types';
import { count, dateTime, money, periodFromDates, toInputDate } from '../format';
import { Empty, ErrorNote, Field, LoadMore, Loading, Note, PageHead, Section } from '../ui';

const TX_KINDS = ['TOPUP', 'COMMISSION', 'BONUS_ACCRUAL', 'BONUS_EXPIRY', 'PROMO_GRANT', 'PROMO_EXPIRY', 'PENALTY', 'COMPENSATION', 'REFUND', 'CHARGEBACK', 'CARD_CAPTURE', 'PAYOUT', 'TOPUP_REFUND', 'REVERSAL'] as const;

function monthStart(): string {
  const d = new Date();
  return toInputDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

/**
 * Финансы (раздел 14, только finance и superadmin): обороты и комиссии по валютам, откуда списана комиссия,
 * пополнения, приветственные кредиты и бонусы, обязательства перед мастерами, сверка журнала, операции и CSV.
 */
export function FinancePage() {
  const { t } = useTranslation();
  const [fromDay, setFromDay] = useState(monthStart());
  const [toDay, setToDay] = useState(toInputDate(new Date()));
  const [kind, setKind] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const validPeriod = Boolean(fromDay && toDay && fromDay <= toDay);
  const period = validPeriod ? periodFromDates(fromDay, toDay) : null;

  const summary = useQuery({ queryKey: ['finance', period], queryFn: () => api.finance(period?.from ?? '', period?.to ?? ''), enabled: period !== null });
  const integrity = useQuery({ queryKey: ['finance', 'integrity'], queryFn: api.integrity });
  const txQuery = { from: period?.from, to: period?.to, kind: kind || undefined, limit: 50 };
  const txs = useInfiniteQuery({
    queryKey: ['finance', 'tx', txQuery],
    queryFn: ({ pageParam }) => api.transactions({ ...txQuery, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: period !== null,
  });

  const download = async () => {
    if (!period) return;
    setExporting(true);
    setExportError(null);
    try {
      const csv = await api.exportCsv(period.from, period.to);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `masterio-ledger-${fromDay}_${toDay}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e);
    } finally {
      setExporting(false);
    }
  };

  const rows = txs.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHead title={t('finance.title')} sub={t('finance.sub')}>
        <button type="button" onClick={() => void download()} disabled={!period || exporting}>
          {exporting ? t('common.loading') : t('finance.export')}
        </button>
      </PageHead>

      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label={t('common.filters')}>
        <Field label={t('finance.from')}>
          <input type="date" value={fromDay} max={toDay} onChange={(e) => setFromDay(e.target.value)} />
        </Field>
        <Field label={t('finance.to')}>
          <input type="date" value={toDay} min={fromDay} onChange={(e) => setToDay(e.target.value)} />
        </Field>
      </form>
      {!validPeriod ? <Note tone="warn">{t('finance.badPeriod')}</Note> : null}
      <ErrorNote error={exportError} />

      {integrity.data ? (
        integrity.data.totalCents === 0 && integrity.data.mismatchedAccounts === 0 ? (
          <Note tone="ok">{t('finance.integrityOk')}</Note>
        ) : (
          <Note tone="alert">{t('finance.integrityBad', { total: integrity.data.totalCents, accounts: integrity.data.mismatchedAccounts })}</Note>
        )
      ) : null}
      <ErrorNote error={integrity.error} />

      {summary.isLoading ? <Loading /> : null}
      <ErrorNote error={summary.error} />
      {summary.data && summary.data.currencies.length === 0 ? <Empty>{t('finance.noData')}</Empty> : null}
      <div className="stack">
        {(summary.data?.currencies ?? []).map((c) => (
          <CurrencyBlock key={c.currency} c={c} />
        ))}
      </div>

      <Section
        title={t('finance.transactions')}
        actions={
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t('finance.kind')}>
            <option value="">{t('common.all')}</option>
            {TX_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`finance.kinds.${k}`)}
              </option>
            ))}
          </select>
        }
        flush
      >
        {txs.isLoading ? <Loading /> : null}
        <ErrorNote error={txs.error} />
        {txs.data && rows.length === 0 ? <Empty>{t('finance.noTx')}</Empty> : null}
        {rows.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('finance.time')}</th>
                  <th>{t('finance.kind')}</th>
                  <th>{t('finance.entries')}</th>
                  <th>{t('finance.link')}</th>
                  <th>{t('finance.memo')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((tx) => (
                  <tr key={tx.id}>
                    <td>{dateTime(tx.createdAt)}</td>
                    <td>{t(`finance.kinds.${tx.kind}`, { defaultValue: tx.kind })}</td>
                    <td>
                      {tx.entries.map((e, i) => (
                        <div key={i} className="num">
                          <span className="faint">{t(`finance.accounts.${e.account}`, { defaultValue: e.account })}</span>{' '}
                          {e.ownerId && e.account.startsWith('WORKER_') ? (
                            <Link to={`/workers/${e.ownerId}`} className="faint">
                              ({e.ownerId.slice(0, 8)})
                            </Link>
                          ) : null}{' '}
                          <span style={{ color: e.amountCents < 0 ? 'var(--alert)' : undefined }}>{money(e.amountCents, e.currency)}</span>
                        </div>
                      ))}
                    </td>
                    <td>{tx.orderId ? <Link to={`/orders/${tx.orderId}`}>{t('finance.order')}</Link> : tx.grantId ? t('finance.grant') : '—'}</td>
                    <td>{tx.memo ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <LoadMore hasMore={txs.hasNextPage} loading={txs.isFetchingNextPage} onClick={() => void txs.fetchNextPage()} />
      </Section>
    </>
  );
}

function CurrencyBlock({ c }: { c: FinanceCurrency }) {
  const { t } = useTranslation();
  const m = (cents: number) => money(cents, c.currency);
  return (
    <Section title={c.currency}>
      <div className="figures" style={{ marginBottom: 16 }}>
        <div className="figure">
          <div className="value">{count(c.ordersCompleted)}</div>
          <div className="label">{t('finance.orders')}</div>
        </div>
        <div className="figure">
          <div className="value">{m(c.turnoverCents)}</div>
          <div className="label">{t('finance.turnover')}</div>
        </div>
        <div className="figure">
          <div className="value">{m(c.commissionCents)}</div>
          <div className="label">{t('finance.commission')}</div>
        </div>
        <div className="figure">
          <div className="value">{m(c.topupsCents)}</div>
          <div className="label">{t('finance.topups', { count: c.topupsCount })}</div>
        </div>
      </div>
      <div className="grid-cols">
        <dl className="facts num">
          <dt>{t('finance.commissionFrom')}</dt>
          <dd />
          <dt>{t('pockets.bonus')}</dt>
          <dd>{m(c.commissionFromBonusCents)}</dd>
          <dt>{t('pockets.promo')}</dt>
          <dd>{m(c.commissionFromPromoCents)}</dd>
          <dt>{t('pockets.topup')}</dt>
          <dd>{m(c.commissionFromTopupCents)}</dd>
          <dt>{t('pockets.earnings')}</dt>
          <dd>{m(c.commissionFromEarningsCents)}</dd>
          <dt>{t('finance.toDebt')}</dt>
          <dd>{m(c.commissionToDebtCents)}</dd>
        </dl>
        <dl className="facts num">
          <dt>{t('finance.promoGranted')}</dt>
          <dd>{m(c.promoGrantedCents)}</dd>
          <dt>{t('finance.promoExpired')}</dt>
          <dd>{m(c.promoExpiredCents)}</dd>
          <dt>{t('finance.bonusAccrued')}</dt>
          <dd>{m(c.bonusAccruedCents)}</dd>
          <dt>{t('finance.bonusExpired')}</dt>
          <dd>{m(c.bonusExpiredCents)}</dd>
          <dt>{t('finance.chargebacks')}</dt>
          <dd>{m(c.chargebacksCents)}</dd>
        </dl>
        <dl className="facts num">
          <dt>{t('finance.liabilities')}</dt>
          <dd />
          <dt>{t('pockets.topup')}</dt>
          <dd>{m(c.liabilities.topupCents)}</dd>
          <dt>{t('pockets.promo')}</dt>
          <dd>{m(c.liabilities.promoCents)}</dd>
          <dt>{t('pockets.bonus')}</dt>
          <dd>{m(c.liabilities.bonusCents)}</dd>
          <dt>{t('pockets.earnings')}</dt>
          <dd>{m(c.liabilities.earningsCents)}</dd>
          <dt>{t('finance.debts')}</dt>
          <dd>{m(c.liabilities.debtCents)}</dd>
        </dl>
      </div>
    </Section>
  );
}
