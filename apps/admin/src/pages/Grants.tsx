import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../api';
import type { Grant } from '../api/types';
import { useSession } from '../auth/Session';
import { amount, date, dateTime, money, parseAmount } from '../format';
import { Dialog, Empty, ErrorNote, Field, Loading, Note, PageHead, Section, Status } from '../ui';
import { useDebounced } from './Workers';

type GrantStatus = Grant['status'];
const TABS: Array<GrantStatus | 'ALL'> = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ALL'];

/**
 * Стартовый баланс мастерам (раздел 21.6): быстрые суммы из WELCOME_PRESETS, своя сумма, причина, срок.
 * Выше порога начисление ждёт второго админа (superadmin, не создатель). Вывести эти деньги нельзя.
 */
export function GrantsPage() {
  const { t } = useTranslation();
  const { me, can } = useSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<GrantStatus | 'ALL'>('PENDING_APPROVAL');
  const [createOpen, setCreateOpen] = useState(false);
  const grants = useQuery({ queryKey: ['grants', tab], queryFn: () => api.grants(tab === 'ALL' ? {} : { status: tab }) });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });
  const decide = useMutation({
    mutationFn: (v: { id: string; approve: boolean }) => (v.approve ? api.approveGrant(v.id) : api.rejectGrant(v.id)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['grants'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  const eff = settings.data?.effective;
  const fmt = (cents: unknown) => (typeof cents === 'number' ? amount(cents) : '—');

  return (
    <>
      <PageHead title={t('grants.title')} sub={t('grants.sub')}>
        {can('createGrant') ? (
          <button type="button" className="primary" onClick={() => setCreateOpen(true)}>
            {t('grants.create')}
          </button>
        ) : null}
      </PageHead>

      {eff ? (
        <Note>
          {t('grants.limits', {
            perWorker: fmt(eff.GRANT_MAX_PER_WORKER),
            second: fmt(eff.GRANT_SECOND_APPROVAL_ABOVE),
            daily: fmt(eff.GRANT_FINANCE_DAILY_LIMIT),
            days: String(eff.PROMO_EXPIRES_DAYS ?? '—'),
          })}
        </Note>
      ) : null}

      <div className="tabs" role="tablist">
        {TABS.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={tab === s} onClick={() => setTab(s)}>
            {s === 'ALL' ? t('common.all') : t(`grants.status.${s}`)}
          </button>
        ))}
      </div>
      <ErrorNote error={decide.error} />

      <Section flush>
        {grants.isLoading ? <Loading /> : null}
        <ErrorNote error={grants.error} />
        {grants.data && grants.data.length === 0 ? <Empty>{tab === 'PENDING_APPROVAL' ? t('grants.emptyQueue') : t('grants.empty')}</Empty> : null}
        {grants.data && grants.data.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('grants.created')}</th>
                  <th>{t('grants.worker')}</th>
                  <th className="num">{t('grants.amount')}</th>
                  <th>{t('grants.reason')}</th>
                  <th>{t('grants.expires')}</th>
                  <th>{t('grants.by')}</th>
                  <th>{t('orders.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {grants.data.map((g) => (
                  <tr key={g.id}>
                    <td>{dateTime(g.createdAt)}</td>
                    <td>
                      <Link to={`/workers/${g.workerId}`}>{g.workerLabel ?? g.workerId}</Link>
                    </td>
                    <td className="num">{g.currency ? money(g.amountCents, g.currency) : amount(g.amountCents)}</td>
                    <td>{g.isAutoWelcome ? t('grants.auto') : g.reason}</td>
                    <td>{date(g.expiresAt)}</td>
                    <td>
                      {g.createdByLabel}
                      {g.approvedByLabel ? <div className="faint">{t('grants.approvedBy', { who: g.approvedByLabel })}</div> : null}
                    </td>
                    <td>
                      <Status tone={g.status === 'APPROVED' ? 'ok' : g.status === 'REJECTED' ? 'none' : 'warn'}>{t(`grants.status.${g.status}`)}</Status>
                    </td>
                    <td>
                      {g.status === 'PENDING_APPROVAL' && can('approveGrant') ? (
                        g.createdById === me?.id ? (
                          <span className="faint">{t('grants.ownGrant')}</span>
                        ) : (
                          <div className="row" style={{ justifyContent: 'flex-end' }}>
                            <button type="button" className="primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: g.id, approve: true })}>
                              {t('grants.approve')}
                            </button>
                            <button type="button" className="danger" disabled={decide.isPending} onClick={() => decide.mutate({ id: g.id, approve: false })}>
                              {t('grants.reject')}
                            </button>
                          </div>
                        )
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>

      <GrantDialog open={createOpen} onClose={() => setCreateOpen(false)} onDone={() => void queryClient.invalidateQueries({ queryKey: ['grants'] })} />
    </>
  );
}

/** Окно начисления: из карточки мастера (мастер уже выбран) или со страницы начислений (поиск мастера). */
export function GrantDialog({
  open,
  workerId,
  workerLabel,
  onClose,
  onDone,
}: {
  open: boolean;
  workerId?: string;
  workerLabel?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [preset, setPreset] = useState<number | 'custom'>(0);
  const [amountInput, setAmountInput] = useState('');
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('');
  const [result, setResult] = useState<Grant | null>(null);
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000, enabled: open });
  const target = workerId ? { id: workerId, label: workerLabel ?? workerId } : picked;
  const found = useQuery({ queryKey: ['workers', 'pick', q], queryFn: () => api.workers({ q, limit: 8 }), enabled: open && !workerId && q.length >= 2 });
  const wallet = useQuery({ queryKey: ['worker', target?.id, 'wallet'], queryFn: () => api.workerWallet(target?.id ?? ''), enabled: open && Boolean(target) });
  const presets = (settings.data?.effective.WELCOME_PRESETS as number[] | undefined) ?? [];
  const currency = wallet.data?.currency ?? 'EUR';
  const customCents = parseAmount(amountInput);
  const daysNum = days ? Number(days) : undefined;

  const reset = () => {
    setPicked(null);
    setSearch('');
    setPreset(0);
    setAmountInput('');
    setReason('');
    setDays('');
    setResult(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const m = useMutation({
    mutationFn: () =>
      api.createGrant({
        workerId: target?.id ?? '',
        reason: reason.trim(),
        ...(preset === 'custom' ? { amountCents: customCents ?? 0 } : { presetIndex: preset }),
        ...(daysNum ? { expiresInDays: daysNum } : {}),
      }),
    onSuccess: (g) => {
      setResult(g);
      onDone();
    },
  });

  const valid =
    Boolean(target) &&
    reason.trim().length >= 3 &&
    (preset === 'custom' ? customCents !== null && customCents > 0 : presets[preset] !== undefined) &&
    (daysNum === undefined || (Number.isInteger(daysNum) && daysNum > 0 && daysNum <= 3_650));

  return (
    <Dialog open={open} onClose={close} title={t('grants.create')}>
      {result ? (
        <>
          <Note tone={result.status === 'APPROVED' ? 'ok' : 'warn'}>
            {result.status === 'APPROVED' ? t('grants.doneApproved', { amount: money(result.amountCents, currency) }) : t('grants.donePending', { amount: money(result.amountCents, currency) })}
          </Note>
          <div className="actions">
            <button type="button" className="primary" onClick={close}>
              {t('common.close')}
            </button>
          </div>
        </>
      ) : (
        <>
          {target ? (
            <p>
              {t('grants.worker')}: <strong>{target.label}</strong>
              {!workerId ? (
                <button type="button" className="quiet" onClick={() => setPicked(null)}>
                  {t('common.change')}
                </button>
              ) : null}
            </p>
          ) : (
            <>
              <Field label={t('grants.findWorker')}>
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('people.searchHint')} autoFocus />
              </Field>
              <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {(found.data?.items ?? []).map((w) => (
                  <li key={w.id}>
                    <button type="button" className="quiet" onClick={() => setPicked({ id: w.id, label: `${w.name ?? t('common.noName')} · ${w.phone ?? ''}` })}>
                      {w.name ?? t('common.noName')} · {w.phone}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <fieldset className="row" style={{ border: 0, padding: 0, margin: '8px 0', flexWrap: 'wrap' }}>
            <legend className="muted">{t('grants.amount')}</legend>
            {presets.map((p, i) => (
              <label key={p} className="check">
                <input type="radio" name="preset" checked={preset === i} onChange={() => setPreset(i)} />
                {money(p, currency)}
              </label>
            ))}
            <label className="check">
              <input type="radio" name="preset" checked={preset === 'custom'} onChange={() => setPreset('custom')} />
              {t('grants.custom')}
            </label>
          </fieldset>
          {preset === 'custom' ? (
            <Field label={t('grants.customAmount', { currency })} error={amountInput && customCents === null ? t('common.amountInvalid') : null}>
              <input inputMode="decimal" value={amountInput} onChange={(e) => setAmountInput(e.target.value)} />
            </Field>
          ) : null}
          <Field label={t('grants.reason')}>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder={t('grants.reasonHint')} />
          </Field>
          <Field label={t('grants.days', { days: String(settings.data?.effective.PROMO_EXPIRES_DAYS ?? '—') })}>
            <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} style={{ width: 120 }} />
          </Field>
          <p className="faint">{t('grants.rules')}</p>
          <ErrorNote error={m.error} />
          <div className="actions">
            <button type="button" onClick={close}>
              {t('common.close')}
            </button>
            <button type="button" className="primary" disabled={!valid || m.isPending} onClick={() => m.mutate()}>
              {t('grants.submit')}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
