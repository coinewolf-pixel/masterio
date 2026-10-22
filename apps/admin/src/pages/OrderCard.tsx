import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleMarker, Polyline, Tooltip } from 'react-leaflet';
import { Link, useParams } from 'react-router';
import { RT_EVENTS } from '@masterio/shared';
import { api } from '../api';
import type { OrderCard, OrderStatus } from '../api/types';
import { useSession } from '../auth/Session';
import { useCatalog } from '../catalog';
import { dateTime, distance, money, time } from '../format';
import { BaseMap, MAP_COLORS } from '../map/BaseMap';
import { useRealtimeEvent } from '../realtime';
import { Dialog, Empty, ErrorNote, Field, Json, Loading, Note, OrderStatusLabel, PageHead, Section, Status } from '../ui';

const CANCELLABLE: OrderStatus[] = ['DRAFT', 'SEARCHING', 'NO_WORKERS', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];

/** Карточка заказа: всё, что нужно поддержке для разбора, на одной странице. */
export function OrderCardPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const { can } = useSession();
  const catalog = useCatalog();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api.order(id) });
  const [cancelOpen, setCancelOpen] = useState(false);
  useRealtimeEvent<{ orderId: string }>(RT_EVENTS.orderStatus, (p) => {
    if (p.orderId === id) void queryClient.invalidateQueries({ queryKey: ['order', id] });
  });

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorNote error={q.error} />;
  const o = q.data;

  return (
    <>
      <PageHead
        title={t('orders.number', { number: o.number })}
        sub={
          <>
            {catalog.categoryName(o.categoryId)}, {catalog.cityName(o.cityId)}. {t('orderCard.createdAt', { time: dateTime(o.createdAt) })}
          </>
        }
      >
        <OrderStatusLabel status={o.status} />
        {can('cancelOrder') && CANCELLABLE.includes(o.status) ? (
          <button type="button" className="danger" onClick={() => setCancelOpen(true)}>
            {t('orderCard.cancel')}
          </button>
        ) : null}
      </PageHead>

      {o.clientUnconfirmed ? <Note tone="warn">{t('orderCard.clientUnconfirmed')}</Note> : null}

      <div className="grid-2">
        <div className="stack">
          <TrackMap order={o} />
          <Timeline order={o} />
          <DispatchLog order={o} />
          <Estimates order={o} />
          <Chat order={o} />
          <Ledger order={o} />
        </div>
        <div className="stack">
          <Section title={t('orderCard.details')}>
            <dl className="facts">
              <dt>{t('orders.client')}</dt>
              <dd>
                <Link to={`/clients/${o.client.id}`}>{o.client.name ?? t('common.noName')}</Link>
                <div className="faint">{o.client.phone}</div>
              </dd>
              <dt>{t('orders.worker')}</dt>
              <dd>
                {o.worker ? (
                  <>
                    <Link to={`/workers/${o.worker.id}`}>{o.worker.name ?? t('common.noName')}</Link>
                    <div className="faint">{o.worker.phone}</div>
                  </>
                ) : (
                  '—'
                )}
              </dd>
              <dt>{t('orderCard.address')}</dt>
              <dd>
                {o.addressFormatted}
                {o.addressDetails ? <div className="faint">{o.addressDetails}</div> : null}
              </dd>
              <dt>{t('orderCard.when')}</dt>
              <dd>{o.timing === 'ASAP' ? t('orderCard.asap') : dateTime(o.scheduledAt)}</dd>
              <dt>{t('orderCard.payment')}</dt>
              <dd>{t(`orderCard.method.${o.paymentMethod}`)}</dd>
              <dt>{t('orderCard.radius')}</dt>
              <dd className="num">
                {distance(o.searchRadiusM)}, {t('orderCard.round', { round: o.dispatchRound })}
              </dd>
              <dt>{t('orderCard.description')}</dt>
              <dd>{o.description}</dd>
            </dl>
          </Section>

          <Section title={t('orderCard.money')}>
            <dl className="facts num">
              <dt>{t('orderCard.approved')}</dt>
              <dd>{money(o.confirmedAmountCents, o.currency)}</dd>
              <dt>{t('orderCard.cashWorker')}</dt>
              <dd>{money(o.cashReportedByWorkerCents, o.currency)}</dd>
              <dt>{t('orderCard.cashClient')}</dt>
              <dd>{money(o.cashReportedByClientCents, o.currency)}</dd>
              <dt>{t('orders.commission')}</dt>
              <dd>{money(o.commissionCents, o.currency)}</dd>
              <dt>{t('orderCard.bonusDiscount')}</dt>
              <dd>{money(o.bonusDiscountCents, o.currency)}</dd>
            </dl>
          </Section>

          {o.assignments.length > 0 ? (
            <Section title={t('teams.performers')}>
              <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>
                {o.assignments.map((a) => (
                  <li key={a.id}>
                    <Link to={`/workers/${a.memberUserId}`}>{a.memberName ?? a.memberUserId.slice(0, 8)}</Link> · {t(`teams.role.${a.memberRole}`)} ·{' '}
                    <Status tone={a.state === 'ACTIVE' ? 'ok' : a.state === 'PENDING_CONSENT' ? 'warn' : 'none'}>{t(`teams.state.${a.state}`)}</Status>
                    <div className="faint">
                      {dateTime(a.createdAt)}
                      {a.endedAt ? ` — ${dateTime(a.endedAt)}` : ''}
                      {a.automatic ? ` · ${t('teams.automatic')}` : ''}
                      {a.clientConsentAt ? ` · ${t('teams.clientConsented', { date: dateTime(a.clientConsentAt) })}` : ''}
                      {a.reason && a.reason !== 'timeout' ? ` · ${a.reason}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {o.cancellation ? (
            <Section title={t('orderCard.cancellation')}>
              <dl className="facts">
                <dt>{t('orderCard.cancelledBy')}</dt>
                <dd>{t(`orderCard.actor.${o.cancellation.actor}`)}</dd>
                <dt>{t('orderCard.reason')}</dt>
                <dd>
                  {o.cancellation.actor === 'CLIENT' ? t(`cancel.client.${o.cancellation.reasonCode}`, { defaultValue: o.cancellation.reasonCode }) : o.cancellation.reasonCode}
                  {o.cancellation.comment ? <div className="faint">{o.cancellation.comment}</div> : null}
                </dd>
                <dt>{t('orderCard.statusAtCancel')}</dt>
                <dd>{t(`order.status.${o.cancellation.statusAtCancel}`)}</dd>
                <dt>{t('orderCard.penalty')}</dt>
                <dd className="num">{money(o.cancellation.penaltyCents, o.currency)}</dd>
                <dt>{t('orderCard.compensation')}</dt>
                <dd className="num">{money(o.cancellation.compensationCents, o.currency)}</dd>
              </dl>
            </Section>
          ) : null}

          {o.disputes.length > 0 ? (
            <Section title={t('orderCard.disputes')}>
              <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>
                {o.disputes.map((d) => (
                  <li key={d.id}>
                    {t(`dispute.reason.${d.reason}`, { defaultValue: d.reason })}: {t(`dispute.status.${d.status}`, { defaultValue: d.status })}
                    <div className="faint">
                      {dateTime(d.createdAt)}
                      {d.isAutomatic ? `, ${t('orderCard.automatic')}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {o.reviews.length > 0 ? (
            <Section title={t('orderCard.reviews')}>
              <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>
                {o.reviews.map((r) => (
                  <li key={r.id}>
                    <strong className="num">{'★'.repeat(r.rating)}</strong>{' '}
                    <span className="faint">{r.authorId === o.client.id ? t('orderCard.fromClient') : t('orderCard.fromWorker')}</span>
                    {r.text ? <div>{r.text}</div> : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {o.photos.length > 0 ? (
            <Section title={t('orderCard.photos')}>
              <div className="row">
                {o.photos.map((p) => (
                  <a key={p.id} href={p.url} target="_blank" rel="noreferrer noopener">
                    <img src={p.url} alt={t(`orderCard.photoPurpose.${p.purpose}`, { defaultValue: p.purpose })} width={96} height={96} style={{ objectFit: 'cover', borderRadius: 6 }} />
                  </a>
                ))}
              </div>
              <p className="faint" style={{ marginTop: 8 }}>
                {t('orderCard.photosNote')}
              </p>
            </Section>
          ) : null}
        </div>
      </div>

      <CancelDialog order={o} open={cancelOpen} onClose={() => setCancelOpen(false)} />
    </>
  );
}

function TrackMap({ order }: { order: OrderCard }) {
  const { t } = useTranslation();
  const line = useMemo(() => order.track.map((p): [number, number] => [p.lat, p.lng]), [order.track]);
  const points = useMemo(() => [...line, ...(order.location ? [[order.location.lat, order.location.lng] as [number, number]] : [])], [line, order.location]);
  const last = order.track[order.track.length - 1];
  return (
    <Section title={t('orderCard.track')} actions={<span className="faint">{t('orderCard.trackPoints', { count: order.track.length })}</span>} flush>
      <BaseMap points={points} label={t('orderCard.track')}>
        {line.length > 1 ? <Polyline positions={line} pathOptions={{ color: MAP_COLORS.track, weight: 4 }} /> : null}
        {order.location ? (
          <CircleMarker center={[order.location.lat, order.location.lng]} radius={9} pathOptions={{ color: '#ffffff', weight: 2, fillColor: MAP_COLORS.waiting, fillOpacity: 1 }}>
            <Tooltip>{order.addressFormatted}</Tooltip>
          </CircleMarker>
        ) : null}
        {last ? (
          <CircleMarker center={[last.lat, last.lng]} radius={7} pathOptions={{ color: '#ffffff', weight: 2, fillColor: MAP_COLORS.busy, fillOpacity: 1 }}>
            <Tooltip>{t('orderCard.lastPoint', { time: time(last.recordedAt) })}</Tooltip>
          </CircleMarker>
        ) : null}
      </BaseMap>
    </Section>
  );
}

function Timeline({ order }: { order: OrderCard }) {
  const { t } = useTranslation();
  return (
    <Section title={t('orderCard.timeline')}>
      {order.events.length === 0 ? (
        <Empty>{t('orderCard.noEvents')}</Empty>
      ) : (
        <ol className="timeline">
          {order.events.map((e) => (
            <li key={e.id}>
              <span className="num faint">{time(e.createdAt)}</span>
              <div>
                {t(`orderCard.event.${e.type}`, { defaultValue: e.type })}
                {e.payload && typeof e.payload === 'object' && Object.keys(e.payload).length > 0 ? (
                  <details>
                    <summary className="faint">{t('orderCard.eventDetails')}</summary>
                    <Json value={e.payload} />
                  </details>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function DispatchLog({ order }: { order: OrderCard }) {
  const { t } = useTranslation();
  return (
    <Section title={t('orderCard.dispatch')} flush>
      {order.offers.length === 0 ? (
        <Empty>{t('orderCard.noOffers')}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('orderCard.roundShort')}</th>
                <th>{t('orders.worker')}</th>
                <th className="num">{t('orderCard.distance')}</th>
                <th className="num">{t('orderCard.score')}</th>
                <th>{t('orderCard.sent')}</th>
                <th>{t('orderCard.outcome')}</th>
              </tr>
            </thead>
            <tbody>
              {order.offers.map((x) => (
                <tr key={x.id}>
                  <td className="num">
                    {x.round}.{x.position}
                  </td>
                  <td>
                    <Link to={`/workers/${x.workerId}`}>{x.workerName ?? x.workerId.slice(0, 8)}</Link>
                  </td>
                  <td className="num">{distance(x.distanceM)}</td>
                  <td className="num">{x.score.toFixed(3)}</td>
                  <td className="num">{time(x.sentAt)}</td>
                  <td>
                    {t(`orderCard.offer.${x.status}`, { defaultValue: x.status })}
                    {x.respondedAt ? <span className="faint"> {time(x.respondedAt)}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function Estimates({ order }: { order: OrderCard }) {
  const { t } = useTranslation();
  if (order.estimates.length === 0) return null;
  return (
    <Section title={t('orderCard.estimates')} flush>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{t('orderCard.version')}</th>
              <th>{t('orderCard.items')}</th>
              <th className="num">{t('orderCard.total')}</th>
              <th>{t('orders.status')}</th>
            </tr>
          </thead>
          <tbody>
            {order.estimates.map((e) => (
              <tr key={e.id}>
                <td className="num">v{e.version}</td>
                <td>
                  {e.items.map((it) => (
                    <div key={it.id}>
                      {it.title} <span className="faint num">{it.quantity} × {money(it.unitCents, order.currency)}</span>
                    </div>
                  ))}
                  {e.note ? <div className="faint">{e.note}</div> : null}
                </td>
                <td className="num">{money(e.totalCents, order.currency)}</td>
                <td>{t(`orderCard.estimateStatus.${e.status}`, { defaultValue: e.status })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Chat({ order }: { order: OrderCard }) {
  const { t } = useTranslation();
  return (
    <Section title={t('orderCard.chat')} actions={<span className="faint">{t('orderCard.chatNote')}</span>}>
      {order.messages.length === 0 ? (
        <Empty>{t('orderCard.noMessages')}</Empty>
      ) : (
        <div className="chat">
          {order.messages.map((m) => {
            const fromClient = m.senderId === order.client.id;
            return (
              <div key={m.id} className="bubble" data-side={fromClient ? 'client' : 'worker'} data-filtered={m.filtered}>
                <div className="meta">
                  {fromClient ? t('orders.client') : t('orders.worker')}, {time(m.createdAt)}
                  {m.filtered ? `. ${t('orderCard.filtered', { hits: m.filterHits.map((h) => t(`orderCard.filterHit.${h}`, { defaultValue: h })).join(', ') })}` : ''}
                </div>
                {m.body}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function Ledger({ order }: { order: OrderCard }) {
  const { t } = useTranslation();
  if (order.ledger.length === 0) return null;
  return (
    <Section title={t('orderCard.ledger')} flush>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{t('finance.when')}</th>
              <th>{t('finance.kind')}</th>
              <th>{t('finance.account')}</th>
              <th className="num">{t('finance.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {order.ledger.flatMap((tx) =>
              tx.entries
                .filter((e) => e.amountCents !== 0)
                .map((e, i) => (
                  <tr key={`${tx.id}-${i}`}>
                    <td className="num">{i === 0 ? dateTime(tx.createdAt) : ''}</td>
                    <td>{i === 0 ? t(`finance.kinds.${tx.kind}`, { defaultValue: tx.kind }) : ''}</td>
                    <td>{t(`finance.accounts.${e.account}`, { defaultValue: e.account })}</td>
                    <td className="num">{money(e.amountCents, e.currency)}</td>
                  </tr>
                )),
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function CancelDialog({ order, open, onClose }: { order: OrderCard; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api.cancelOrder(order.id, reason.trim()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      setReason('');
      onClose();
    },
  });
  return (
    <Dialog open={open} onClose={onClose} title={t('orderCard.cancelTitle', { number: order.number })}>
      <p className="muted">{t('orderCard.cancelHint')}</p>
      <Field label={t('orderCard.cancelReason')}>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
      </Field>
      <ErrorNote error={m.error} />
      <div className="actions">
        <button type="button" onClick={onClose}>
          {t('common.close')}
        </button>
        <button type="button" className="danger" disabled={reason.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
          {t('orderCard.cancelConfirm')}
        </button>
      </div>
    </Dialog>
  );
}
