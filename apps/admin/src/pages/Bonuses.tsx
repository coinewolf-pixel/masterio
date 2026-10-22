import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { bonusRuleSchema } from '@masterio/shared';
import { api } from '../api';
import type { BonusRule } from '../api/types';
import { dateTime, money, percent } from '../format';
import { Dialog, Empty, ErrorNote, Field, Loading, Note, PageHead, Section, Status } from '../ui';

function lastMonth(): string {
  const d = new Date();
  const p = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}`;
}

const RUN_TONE = { DRAFT: 'warn', APPROVED: 'active', APPLIED: 'ok', CANCELLED: 'none' } as const;

/**
 * Ежемесячные бонусы (раздел 20.4): ступени и условия, черновик расчёта за месяц (кому, сколько, по какому
 * правилу, какие заказы исключены), бюджет и одобрение finance. Бонус — скидка на комиссию, не деньги.
 */
export function BonusesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const rules = useQuery({ queryKey: ['bonusRules'], queryFn: api.bonusRules });
  const runs = useQuery({ queryKey: ['bonusRuns'], queryFn: api.bonusRuns });
  const [period, setPeriod] = useState(lastMonth());
  const [editing, setEditing] = useState<BonusRule | 'new' | null>(null);
  const calc = useMutation({
    mutationFn: () => api.calculateBonus(period),
    onSuccess: async (run) => {
      await queryClient.invalidateQueries({ queryKey: ['bonusRuns'] });
      navigate(`/bonuses/${run.id}`);
    },
  });

  return (
    <>
      <PageHead title={t('bonuses.title')} sub={t('bonuses.sub')} />
      <Note>{t('bonuses.how')}</Note>
      <div className="grid-2">
        <Section title={t('bonuses.runs')} flush>
          <form
            className="filters"
            style={{ padding: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              calc.mutate();
            }}
          >
            <Field label={t('bonuses.period')}>
              <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
            </Field>
            <button type="submit" className="primary" disabled={!/^\d{4}-\d{2}$/.test(period) || calc.isPending}>
              {t('bonuses.calculate')}
            </button>
          </form>
          <ErrorNote error={calc.error} />
          {runs.isLoading ? <Loading /> : null}
          {runs.data && runs.data.length === 0 ? <Empty>{t('bonuses.noRuns')}</Empty> : null}
          {runs.data && runs.data.length > 0 ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('bonuses.period')}</th>
                    <th>{t('orders.status')}</th>
                    <th className="num">{t('bonuses.workers')}</th>
                    <th>{t('bonuses.calculated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.data.map((r) => (
                    <tr key={r.id} data-clickable="true" tabIndex={0} onClick={() => navigate(`/bonuses/${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/bonuses/${r.id}`)}>
                      <td className="num">{r.period}</td>
                      <td>
                        <Status tone={RUN_TONE[r.status]}>{t(`bonuses.status.${r.status}`)}</Status>
                      </td>
                      <td className="num">{r._count.awards}</td>
                      <td>{dateTime(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Section>

        <Section
          title={t('bonuses.rules')}
          actions={
            <button type="button" className="quiet" onClick={() => setEditing('new')}>
              {t('bonuses.addRule')}
            </button>
          }
          flush
        >
          {rules.isLoading ? <Loading /> : null}
          <ErrorNote error={rules.error} />
          {(rules.data ?? []).length === 0 && rules.data ? <Empty>{t('bonuses.noRules')}</Empty> : null}
          {(rules.data ?? []).length > 0 ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('bonuses.tier')}</th>
                    <th className="num">{t('bonuses.orders')}</th>
                    <th className="num">{t('bonuses.percent')}</th>
                    <th>{t('bonuses.conditions')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(rules.data ?? []).map((r) => (
                    <tr key={r.id} style={{ opacity: r.isActive ? 1 : 0.55 }}>
                      <td>
                        {r.name}
                        {!r.isActive ? <div className="faint">{t('catalog.inactive')}</div> : null}
                      </td>
                      <td className="num">
                        {r.minOrders}–{r.maxOrders ?? '∞'}
                      </td>
                      <td className="num">{percent(r.percentBp / 10_000)}</td>
                      <td className="faint">{t('bonuses.conditionsText', { rating: Number(r.minRating).toFixed(2), cancel: percent(r.maxCancelRateBp / 10_000), disputes: r.maxLostDisputes })}</td>
                      <td>
                        <button type="button" className="quiet" onClick={() => setEditing(r)}>
                          {t('common.change')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Section>
      </div>
      {editing ? <RuleDialog rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function RuleDialog({ rule, onClose }: { rule: BonusRule | null; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [f, setF] = useState({
    name: rule?.name ?? '',
    minOrders: String(rule?.minOrders ?? 10),
    maxOrders: rule?.maxOrders === null || rule?.maxOrders === undefined ? '' : String(rule.maxOrders),
    percent: String((rule?.percentBp ?? 300) / 100),
    minRating: String(rule ? Number(rule.minRating) : 4.7),
    maxCancel: String((rule?.maxCancelRateBp ?? 500) / 100),
    maxLost: String(rule?.maxLostDisputes ?? 0),
    isActive: rule?.isActive ?? true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const num = (s: string) => Number(s.replace(',', '.'));
  const parsed = bonusRuleSchema.safeParse({
    name: f.name,
    minOrders: num(f.minOrders),
    maxOrders: f.maxOrders.trim() === '' ? null : num(f.maxOrders),
    percentBp: Math.round(num(f.percent) * 100),
    minRating: num(f.minRating),
    maxCancelRateBp: Math.round(num(f.maxCancel) * 100),
    maxLostDisputes: num(f.maxLost),
    isActive: f.isActive,
  });
  const m = useMutation({
    mutationFn: () => {
      if (!parsed.success) throw new Error('invalid');
      return api.saveBonusRule(parsed.data, rule?.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['bonusRules'] });
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title={rule ? t('bonuses.editRule') : t('bonuses.addRule')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Field label={t('bonuses.tier')}>
            <input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="silver" style={{ width: 140 }} />
          </Field>
          <Field label={t('bonuses.minOrders')}>
            <input inputMode="numeric" value={f.minOrders} onChange={(e) => set('minOrders', e.target.value)} style={{ width: 90 }} />
          </Field>
          <Field label={t('bonuses.maxOrders')}>
            <input inputMode="numeric" value={f.maxOrders} onChange={(e) => set('maxOrders', e.target.value)} style={{ width: 90 }} placeholder="∞" />
          </Field>
          <Field label={t('bonuses.percentOfCommission')}>
            <input inputMode="decimal" value={f.percent} onChange={(e) => set('percent', e.target.value)} style={{ width: 90 }} />
          </Field>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Field label={t('bonuses.minRating')}>
            <input inputMode="decimal" value={f.minRating} onChange={(e) => set('minRating', e.target.value)} style={{ width: 90 }} />
          </Field>
          <Field label={t('bonuses.maxCancel')}>
            <input inputMode="decimal" value={f.maxCancel} onChange={(e) => set('maxCancel', e.target.value)} style={{ width: 90 }} />
          </Field>
          <Field label={t('bonuses.maxLost')}>
            <input inputMode="numeric" value={f.maxLost} onChange={(e) => set('maxLost', e.target.value)} style={{ width: 90 }} />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={f.isActive} onChange={(e) => set('isActive', e.target.checked)} />
          {t('catalog.active')}
        </label>
        <ErrorNote error={m.error} />
        <div className="actions">
          <button type="button" onClick={onClose}>
            {t('common.close')}
          </button>
          <button type="submit" className="primary" disabled={!parsed.success || m.isPending}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Черновик или итог расчёта за месяц: по каждому мастеру — ступень, база, сумма до и после бюджета, причина отказа. */
export function BonusRunPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['bonusRun', id], queryFn: () => api.bonusRun(id) });
  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ['bonusRun', id] });
    await queryClient.invalidateQueries({ queryKey: ['bonusRuns'] });
  };
  const approve = useMutation({ mutationFn: () => api.approveBonus(id), onSuccess: done });
  const cancel = useMutation({ mutationFn: () => api.cancelBonus(id), onSuccess: done });
  const recalc = useMutation({ mutationFn: () => api.calculateBonus(q.data?.period ?? ''), onSuccess: done });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorNote error={q.error} />;
  const run = q.data;
  const pending = run.awards.reduce((s, a) => s + a.breakdown.pendingWindow, 0);

  return (
    <>
      <PageHead title={t('bonuses.runTitle', { period: run.period })} sub={t('bonuses.runSub', { time: dateTime(run.createdAt) })}>
        <Status tone={RUN_TONE[run.status]}>{t(`bonuses.status.${run.status}`)}</Status>
        {run.status === 'DRAFT' || run.status === 'CANCELLED' ? (
          <button type="button" disabled={recalc.isPending} onClick={() => recalc.mutate()}>
            {t('bonuses.recalculate')}
          </button>
        ) : null}
        {run.status === 'DRAFT' ? (
          <>
            <button type="button" className="danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              {t('bonuses.cancel')}
            </button>
            <button
              type="button"
              className="primary"
              disabled={approve.isPending}
              onClick={() => {
                if (window.confirm(t('bonuses.approveConfirm', { period: run.period }))) approve.mutate();
              }}
            >
              {t('bonuses.approve')}
            </button>
          </>
        ) : null}
      </PageHead>
      <ErrorNote error={approve.error ?? cancel.error ?? recalc.error} />
      {pending > 0 && run.status === 'DRAFT' ? <Note tone="warn">{t('bonuses.pendingWindow', { count: pending })}</Note> : null}
      {run.scaleFactor < 1 ? <Note tone="warn">{t('bonuses.capped', { share: percent(run.scaleFactor) })}</Note> : null}

      <div className="figures" style={{ marginBottom: 20 }}>
        {run.totals.map((x) => (
          <div className="figure" key={x.currency}>
            <div className="value">{money(x.finalCents, x.currency)}</div>
            <div className="label">{t('bonuses.total', { count: x.workers, currency: x.currency })}</div>
            {x.rawCents !== x.finalCents ? <div className="faint">{t('bonuses.beforeCap', { amount: money(x.rawCents, x.currency) })}</div> : null}
          </div>
        ))}
      </div>

      <Section flush>
        {run.awards.length === 0 ? <Empty>{t('bonuses.noAwards')}</Empty> : null}
        {run.awards.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('orders.worker')}</th>
                  <th className="num">{t('bonuses.orders')}</th>
                  <th className="num">{t('bonuses.commissionPaid')}</th>
                  <th>{t('bonuses.tier')}</th>
                  <th className="num">{t('bonuses.raw')}</th>
                  <th className="num">{t('bonuses.final')}</th>
                  <th>{t('bonuses.why')}</th>
                </tr>
              </thead>
              <tbody>
                {run.awards.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link to={`/workers/${a.workerId}`}>{a.workerPhone ?? a.workerId.slice(0, 8)}</Link>
                    </td>
                    <td className="num">
                      {a.ordersCount}
                      {a.excludedOrders.length > 0 ? <div className="faint">{t('bonuses.excluded', { count: a.excludedOrders.length })}</div> : null}
                      {a.breakdown.pendingWindow > 0 ? <div className="faint">{t('bonuses.pendingShort', { count: a.breakdown.pendingWindow })}</div> : null}
                    </td>
                    <td className="num">{money(a.commissionPaidCents, a.breakdown.currency)}</td>
                    <td>{a.breakdown.tier ? `${a.breakdown.tier} · ${percent(a.breakdown.percentBp / 10_000)}` : '—'}</td>
                    <td className="num">{money(a.rawCents, a.breakdown.currency)}</td>
                    <td className="num">
                      <strong>{money(a.finalCents, a.breakdown.currency)}</strong>
                    </td>
                    <td className="faint">
                      {t(`bonuses.reason.${a.breakdown.reason}`)}
                      <div>{t('bonuses.facts', { rating: (a.breakdown.ratingX100 / 100).toFixed(2), cancel: percent(a.breakdown.cancelRateBp / 10_000), lost: a.breakdown.lostDisputes })}</div>
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
