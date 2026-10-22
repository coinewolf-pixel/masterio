import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { DISPUTE_RESOLUTIONS, DISPUTE_STATUSES, RT_EVENTS, type AdminDisputeAction } from '@masterio/shared';
import { api } from '../api';
import type { DisputeCard, DisputeStatus } from '../api/types';
import { useSession } from '../auth/Session';
import { useCatalog } from '../catalog';
import { dateTime, money, parseAmount } from '../format';
import { useRealtimeEvent } from '../realtime';
import { Empty, ErrorNote, Field, Json, LoadMore, Loading, Note, OrderStatusLabel, PageHead, Section, Status } from '../ui';

const FINAL: DisputeStatus[] = ['SETTLED', 'UNRESOLVED_REFERRED', 'CLOSED'];
type Tone = 'none' | 'live' | 'active' | 'ok' | 'warn' | 'alert';
export function disputeTone(s: DisputeStatus): Tone {
  if (s === 'ESCALATED') return 'alert';
  if (s === 'AWAITING_RESPONSE' || s === 'OPEN') return 'warn';
  if (s === 'UNDER_REVIEW') return 'active';
  if (s === 'SETTLED') return 'ok';
  return 'none';
}

/** Очередь споров (раздел 18.5): по статусу, назначенные мне, просроченные ответы сторон. */
export function DisputesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const mine = params.get('mine') === 'true';
  const query = { status: status || undefined, mine: mine ? 'true' : undefined, limit: 50 };
  const list = useInfiniteQuery({
    queryKey: ['disputes', query],
    queryFn: ({ pageParam }) => api.disputes({ ...query, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  useRealtimeEvent(RT_EVENTS.disputeUpdated, () => void queryClient.invalidateQueries({ queryKey: ['disputes'] }));
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const counts = list.data?.pages[0]?.counts ?? {};
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHead title={t('disputes.title')} sub={t('disputes.sub')} />
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={!status} onClick={() => set('status', '')}>
          {t('disputes.active')}
        </button>
        {DISPUTE_STATUSES.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => set('status', s)}>
            {t(`dispute.status.${s}`)} {counts[s] ? <span className="faint num">{counts[s]}</span> : null}
          </button>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={mine} onChange={(e) => set('mine', e.target.checked ? 'true' : '')} />
        {t('disputes.mine')}
      </label>

      <Section flush>
        {list.isLoading ? <Loading /> : null}
        <ErrorNote error={list.error} />
        {list.data && rows.length === 0 ? <Empty>{t('disputes.empty')}</Empty> : null}
        {rows.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('disputes.opened')}</th>
                  <th>{t('orders.numberLabel')}</th>
                  <th>{t('disputes.reason')}</th>
                  <th>{t('orders.status')}</th>
                  <th>{t('orders.category')}</th>
                  <th>{t('disputes.responseDue')}</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((d) => status || !FINAL.includes(d.status))
                  .map((d) => (
                    <tr
                      key={d.id}
                      data-clickable="true"
                      tabIndex={0}
                      onClick={() => navigate(`/disputes/${d.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') navigate(`/disputes/${d.id}`);
                      }}
                    >
                      <td>{dateTime(d.createdAt)}</td>
                      <td className="num">#{d.orderNumber}</td>
                      <td>
                        {t(`dispute.reason.${d.reason}`, { defaultValue: d.reason })}
                        {d.isAutomatic ? <div className="faint">{t('orderCard.automatic')}</div> : null}
                        {d.isSuspicious ? <div style={{ color: 'var(--alert)' }}>{t('disputes.suspicious')}</div> : null}
                      </td>
                      <td>
                        <Status tone={disputeTone(d.status)}>{t(`dispute.status.${d.status}`)}</Status>
                      </td>
                      <td>
                        {catalog.categoryName(d.categoryId)}
                        <div className="faint">{catalog.cityName(d.cityId)}</div>
                      </td>
                      <td style={{ color: d.overdue ? 'var(--alert)' : undefined }}>{d.responseDueAt ? dateTime(d.responseDueAt) : '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />
      </Section>
    </>
  );
}

/** Карточка спора: материалы сторон и снимки заказа, ход разбора, действия поддержки, итог. */
export function DisputeCardPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['dispute', id], queryFn: () => api.dispute(id) });
  useRealtimeEvent<{ disputeId: string }>(RT_EVENTS.disputeUpdated, (p) => {
    if (p.disputeId === id) void queryClient.invalidateQueries({ queryKey: ['dispute', id] });
  });

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorNote error={q.error} />;
  const d = q.data;
  const side = (uid: string | null) => (uid === d.order.clientId ? t('orders.client') : uid === d.order.workerId ? t('orders.worker') : uid ? t('disputes.support') : t('disputes.system'));
  const statements = d.evidence.filter((e) => e.kind === 'text');
  const photos = d.evidence.filter((e) => e.kind === 'photo' && e.url);
  const snapshots = d.evidence.filter((e) => !['text', 'photo'].includes(e.kind));
  const final = FINAL.includes(d.status);

  return (
    <>
      <PageHead
        title={`${t(`dispute.reason.${d.reason}`, { defaultValue: d.reason })}`}
        sub={
          <>
            <Link to={`/orders/${d.order.id}`}>{t('orders.number', { number: d.order.number })}</Link> · {t('disputes.openedBy', { who: d.isAutomatic ? t('disputes.system') : side(d.openedById), time: dateTime(d.createdAt) })}
          </>
        }
      >
        <OrderStatusLabel status={d.order.status} />
        <Status tone={disputeTone(d.status)}>{t(`dispute.status.${d.status}`)}</Status>
      </PageHead>
      {d.isSuspicious ? <Note tone="alert">{t('disputes.suspiciousHint')}</Note> : null}
      <Note>{t('disputes.notCourt')}</Note>

      <div className="grid-2">
        <div className="stack">
          <Section title={t('disputes.statements')}>
            {statements.length === 0 ? <p className="faint">{t('disputes.noStatements')}</p> : null}
            <ol className="timeline">
              {statements.map((e) => (
                <li key={e.id}>
                  <span className="faint">
                    {dateTime(e.createdAt)} · {side(e.submittedById)}
                  </span>
                  <div>{(e.content as { text?: string } | null)?.text}</div>
                </li>
              ))}
            </ol>
            {d.isAutomatic ? <p className="muted">{d.description}</p> : null}
          </Section>

          {photos.length > 0 ? (
            <Section title={t('orderCard.photos')} actions={<span className="faint">{t('orderCard.photosNote')}</span>}>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {photos.map((p) => (
                  <a key={p.id} href={p.url ?? '#'} target="_blank" rel="noreferrer noopener" title={side(p.submittedById)}>
                    <img src={p.url ?? ''} alt={side(p.submittedById)} width={120} height={120} style={{ objectFit: 'cover', borderRadius: 6 }} />
                  </a>
                ))}
              </div>
            </Section>
          ) : null}

          <Section title={t('disputes.progress')}>
            <ol className="timeline">
              {d.events.map((e) => (
                <li key={e.id}>
                  <span className="faint">
                    {dateTime(e.createdAt)} · {side(e.actorId)}
                  </span>
                  <div>
                    {t(`disputes.event.${e.type}`, { defaultValue: e.type })}
                    {e.type === 'note' ? <span className="faint"> ({t('disputes.internal')})</span> : null}
                  </div>
                  <EventText payload={e.payload} />
                </li>
              ))}
            </ol>
          </Section>

          <Section title={t('disputes.snapshots')} actions={<span className="faint">{t('disputes.snapshotsHint')}</span>}>
            {snapshots.map((s) => (
              <details key={s.id}>
                <summary>
                  {t(`disputes.snapshot.${s.kind}`, { defaultValue: s.kind })} <span className="faint">· {t('disputes.keepUntil', { date: dateTime(s.retentionUntil) })}</span>
                </summary>
                <Json value={s.content} />
              </details>
            ))}
          </Section>
        </div>

        <div className="stack">
          <Section title={t('orderCard.money')}>
            <dl className="facts num">
              <dt>{t('orderCard.approved')}</dt>
              <dd>{money(d.order.confirmedAmountCents, d.order.currency)}</dd>
              <dt>{t('orderCard.cashWorker')}</dt>
              <dd>{money(d.order.cashReportedByWorkerCents, d.order.currency)}</dd>
              <dt>{t('orderCard.cashClient')}</dt>
              <dd>{money(d.order.cashReportedByClientCents, d.order.currency)}</dd>
              <dt>{t('disputes.commissionCharged')}</dt>
              <dd>{money(d.order.commissionChargedCents, d.order.currency)}</dd>
              <dt>{t('disputes.commissionRefunded')}</dt>
              <dd>{money(d.order.commissionRefundedCents, d.order.currency)}</dd>
            </dl>
            <p className="faint">{t('disputes.cashNote')}</p>
          </Section>

          {d.outcome ? (
            <Section title={t('disputes.outcome')}>
              <dl className="facts">
                <dt>{t('disputes.resolutionLabel')}</dt>
                <dd>{t(`disputes.resolution.${d.outcome.resolution ?? 'referred'}`, { defaultValue: d.outcome.resolution })}</dd>
                <dt>{t('disputes.summary')}</dt>
                <dd>{d.outcome.summary}</dd>
                {d.outcome.agreedAmountCents ? (
                  <>
                    <dt>{t('disputes.agreed')}</dt>
                    <dd className="num">{money(d.outcome.agreedAmountCents, d.order.currency)}</dd>
                  </>
                ) : null}
                {d.outcome.commissionRefundCents ? (
                  <>
                    <dt>{t('disputes.refund')}</dt>
                    <dd className="num">{money(d.outcome.commissionRefundCents, d.order.currency)}</dd>
                  </>
                ) : null}
              </dl>
            </Section>
          ) : null}

          {!final ? <Actions card={d} /> : null}

          <Section title={t('disputes.links')}>
            <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                <Link to={`/clients/${d.order.clientId}`}>{t('orders.client')}</Link>
              </li>
              {d.order.workerId ? (
                <li>
                  <Link to={`/workers/${d.order.workerId}`}>{t('orders.worker')}</Link>
                </li>
              ) : null}
              {d.ticket ? (
                <li>
                  <Link to={`/support/${d.ticket.id}`}>{t('disputes.ticket')}</Link> <span className="faint">({t(`support.status.${d.ticket.status}`)})</span>
                </li>
              ) : null}
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}

function EventText({ payload }: { payload: unknown }) {
  const p = (payload ?? {}) as { text?: string; note?: string; summary?: string };
  const text = p.text ?? p.note ?? p.summary;
  return text ? <div className="muted">{text}</div> : null;
}

function Actions({ card }: { card: DisputeCard }) {
  const { t } = useTranslation();
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<AdminDisputeAction['action']>('proposal');
  const [text, setText] = useState('');
  const [resolution, setResolution] = useState<(typeof DISPUTE_RESOLUTIONS)[number]>('agreement');
  const [agreed, setAgreed] = useState('');
  const [refund, setRefund] = useState('');
  const m = useMutation({
    mutationFn: (body: AdminDisputeAction) => api.disputeAction(card.id, body),
    onSuccess: async () => {
      setText('');
      setAgreed('');
      setRefund('');
      await queryClient.invalidateQueries({ queryKey: ['dispute', card.id] });
      await queryClient.invalidateQueries({ queryKey: ['disputes'] });
    },
  });
  const support = can('actOnDisputes');
  const finance = can('refundCommission');
  const kinds: Array<AdminDisputeAction['action']> = support ? ['proposal', 'request_response', 'note', 'escalate', 'settle', 'refer'] : ['settle'];
  const available = card.order.commissionChargedCents - card.order.commissionRefundedCents;
  const refundCents = refund ? parseAmount(refund) : 0;
  const agreedCents = agreed ? parseAmount(agreed) : undefined;
  const textOk = text.trim().length >= 3;

  const submit = () => {
    if (kind === 'settle') {
      m.mutate({
        action: 'settle',
        resolution,
        summary: text.trim(),
        ...(agreedCents ? { agreedAmountCents: agreedCents } : {}),
        ...(refundCents ? { commissionRefundCents: refundCents } : {}),
      });
    } else if (kind === 'escalate' || kind === 'request_response') m.mutate({ action: kind, note: text.trim() });
    else if (kind === 'refer') m.mutate({ action: 'refer', summary: text.trim() });
    else if (kind === 'proposal' || kind === 'note') m.mutate({ action: kind, text: text.trim() });
  };
  const invalid = !textOk || (kind === 'settle' && (refundCents === null || agreedCents === null || (refundCents ?? 0) > available || (!finance && (refundCents ?? 0) > 0) || (!support && !(refundCents ?? 0))));

  return (
    <Section title={t('disputes.actions')}>
      {support ? (
        <Field label={t('disputes.assignee')}>
          <select value={card.assigneeId ?? ''} onChange={(e) => m.mutate({ action: 'assign', assigneeId: e.target.value || null })}>
            <option value="">—</option>
            {card.assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field label={t('disputes.action')}>
        <select value={kind} onChange={(e) => setKind(e.target.value as AdminDisputeAction['action'])}>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {t(`disputes.do.${k}`)}
            </option>
          ))}
        </select>
      </Field>
      <p className="faint">{t(`disputes.doHint.${kind}`)}</p>
      {kind === 'settle' ? (
        <>
          <Field label={t('disputes.resolutionLabel')}>
            <select value={resolution} onChange={(e) => setResolution(e.target.value as (typeof DISPUTE_RESOLUTIONS)[number])}>
              {DISPUTE_RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {t(`disputes.resolution.${r}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('disputes.agreedLabel', { currency: card.order.currency })} error={agreedCents === null ? t('common.amountInvalid') : null}>
            <input inputMode="decimal" value={agreed} onChange={(e) => setAgreed(e.target.value)} />
          </Field>
          {finance ? (
            <Field
              label={t('disputes.refundLabel', { max: money(available, card.order.currency) })}
              error={refundCents === null ? t('common.amountInvalid') : (refundCents ?? 0) > available ? t('disputes.refundTooBig') : null}
            >
              <input inputMode="decimal" value={refund} onChange={(e) => setRefund(e.target.value)} />
            </Field>
          ) : (
            <p className="faint">{t('disputes.refundFinanceOnly')}</p>
          )}
        </>
      ) : null}
      <Field label={kind === 'settle' || kind === 'refer' ? t('disputes.summary') : t('disputes.text')}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2_000} />
      </Field>
      <ErrorNote error={m.error} />
      <div className="actions">
        <button type="button" className={kind === 'settle' || kind === 'refer' ? 'primary' : undefined} disabled={invalid || m.isPending} onClick={submit}>
          {t(`disputes.do.${kind}`)}
        </button>
      </div>
    </Section>
  );
}
