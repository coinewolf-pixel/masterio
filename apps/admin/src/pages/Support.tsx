import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { RT_EVENTS, TICKET_STATUSES } from '@masterio/shared';
import { api } from '../api';
import type { TicketStatus } from '../api/types';
import { useSession } from '../auth/Session';
import { useCatalog } from '../catalog';
import { dateTime } from '../format';
import { CircleMarker } from 'react-leaflet';
import { BaseMap, MAP_COLORS } from '../map/BaseMap';
import { useRealtimeEvent } from '../realtime';
import { Empty, ErrorNote, Field, LoadMore, Loading, Note, PageHead, Section, Status } from '../ui';

const TONE: Record<TicketStatus, 'warn' | 'active' | 'ok' | 'none'> = { OPEN: 'warn', PENDING_USER: 'active', RESOLVED: 'ok', CLOSED: 'none' };

/** Тикеты поддержки: обращения из приложений, споры и инциденты. Сначала те, где ждут ответа поддержки. */
export function SupportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'OPEN';
  const kind = params.get('kind') ?? '';
  const mine = params.get('mine') === 'true';
  const query = { status: status === 'ALL' ? undefined : status, kind: kind || undefined, mine: mine ? 'true' : undefined, limit: 50 };
  const list = useInfiniteQuery({
    queryKey: ['tickets', query],
    queryFn: ({ pageParam }) => api.tickets({ ...query, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  useRealtimeEvent(RT_EVENTS.ticketMessage, () => void queryClient.invalidateQueries({ queryKey: ['tickets'] }));
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHead title={t('support.title')} sub={t('support.sub')} />
      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label={t('common.filters')}>
        <Field label={t('orders.status')}>
          <select value={status} onChange={(e) => set('status', e.target.value)}>
            <option value="ALL">{t('common.all')}</option>
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`support.status.${s}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('support.kind')}>
          <select value={kind} onChange={(e) => set('kind', e.target.value)}>
            <option value="">{t('common.all')}</option>
            {(['general', 'dispute', 'incident'] as const).map((k) => (
              <option key={k} value={k}>
                {t(`support.kinds.${k}`)}
              </option>
            ))}
          </select>
        </Field>
        <label className="check">
          <input type="checkbox" checked={mine} onChange={(e) => set('mine', e.target.checked ? 'true' : '')} />
          {t('disputes.mine')}
        </label>
      </form>
      <Section flush>
        {list.isLoading ? <Loading /> : null}
        <ErrorNote error={list.error} />
        {list.data && rows.length === 0 ? <Empty>{t('support.empty')}</Empty> : null}
        {rows.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('support.updated')}</th>
                  <th>{t('support.subject')}</th>
                  <th>{t('support.from')}</th>
                  <th>{t('orders.status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    data-clickable="true"
                    tabIndex={0}
                    onClick={() => navigate(`/support/${r.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') navigate(`/support/${r.id}`);
                    }}
                  >
                    <td>{dateTime(r.updatedAt)}</td>
                    <td>
                      {r.waitingSupport ? <strong>{r.subject}</strong> : r.subject}
                      {r.disputeId ? <div className="faint">{t('support.kinds.dispute')}</div> : null}
                    </td>
                    <td>
                      {t(`fraud.role.${r.userRole ?? 'CLIENT'}`, { defaultValue: r.userRole ?? '' })}
                      <div className="faint">{r.userPhone ?? t('support.deletedUser')}</div>
                    </td>
                    <td>
                      <Status tone={TONE[r.status]}>{t(`support.status.${r.status}`)}</Status>
                    </td>
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

/** Переписка с пользователем. Внутренние заметки пользователь не видит. */
export function TicketPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const { me } = useSession();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['ticket', id], queryFn: () => api.ticket(id) });
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  useRealtimeEvent<{ ticketId: string }>(RT_EVENTS.ticketMessage, (p) => {
    if (p.ticketId === id) void queryClient.invalidateQueries({ queryKey: ['ticket', id] });
  });
  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ['ticket', id] });
    await queryClient.invalidateQueries({ queryKey: ['tickets'] });
  };
  const post = useMutation({
    mutationFn: () => api.ticketPost(id, body.trim(), internal),
    onSuccess: async () => {
      setBody('');
      await done();
    },
  });
  const update = useMutation({ mutationFn: (patch: { status?: string; assigneeId?: string | null }) => api.ticketUpdate(id, patch), onSuccess: done });

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorNote error={q.error} />;
  const tk = q.data;

  return (
    <>
      <PageHead title={tk.subject} sub={dateTime(tk.createdAt)}>
        <Status tone={TONE[tk.status]}>{t(`support.status.${tk.status}`)}</Status>
        {tk.assigneeId !== me?.id ? (
          <button type="button" onClick={() => update.mutate({ assigneeId: me?.id ?? null })}>
            {t('support.takeIt')}
          </button>
        ) : null}
        <select value={tk.status} onChange={(e) => update.mutate({ status: e.target.value })} aria-label={t('orders.status')}>
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`support.status.${s}`)}
            </option>
          ))}
        </select>
      </PageHead>
      <ErrorNote error={update.error} />
      <div className="grid-2">
        <Section title={t('support.conversation')}>
          <div className="chat">
            {tk.messages.map((m) => (
              <div key={m.id} className="bubble" data-side={m.fromSupport ? 'worker' : 'client'} data-filtered={m.isInternal ? 'true' : undefined}>
                <div className="faint">
                  {m.fromSupport ? (m.senderEmail ?? t('disputes.support')) : t('support.user')} · {dateTime(m.createdAt)}
                  {m.isInternal ? ` · ${t('disputes.internal')}` : ''}
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
              </div>
            ))}
          </div>
          <Field label={internal ? t('support.noteLabel') : t('support.replyLabel')}>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={4_000} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
            {t('support.internalCheck')}
          </label>
          <p className="faint">{t('support.replyHint')}</p>
          <ErrorNote error={post.error} />
          <div className="actions">
            <button type="button" className="primary" disabled={body.trim().length === 0 || post.isPending} onClick={() => post.mutate()}>
              {internal ? t('support.addNote') : t('support.send')}
            </button>
          </div>
        </Section>
        <Section title={t('orderCard.details')}>
          <dl className="facts">
            <dt>{t('support.from')}</dt>
            <dd>
              {tk.user ? (
                <Link to={tk.user.role === 'WORKER' ? `/workers/${tk.user.id}` : `/clients/${tk.user.id}`}>{tk.user.phone ?? t('support.deletedUser')}</Link>
              ) : (
                '—'
              )}
            </dd>
            <dt>{t('people.language')}</dt>
            <dd>{tk.user?.locale ?? '—'}</dd>
            {tk.orderId ? (
              <>
                <dt>{t('finance.order')}</dt>
                <dd>
                  <Link to={`/orders/${tk.orderId}`}>{t('common.open')}</Link>
                </dd>
              </>
            ) : null}
            {tk.disputeId ? (
              <>
                <dt>{t('support.kinds.dispute')}</dt>
                <dd>
                  <Link to={`/disputes/${tk.disputeId}`}>{t('common.open')}</Link>
                </dd>
              </>
            ) : null}
            {tk.incidentId ? (
              <>
                <dt>{t('support.kinds.incident')}</dt>
                <dd>
                  <Link to={`/incidents/${tk.incidentId}`}>{t('common.open')}</Link>
                </dd>
              </>
            ) : null}
          </dl>
          <p className="faint">{t('support.languageHint')}</p>
        </Section>
      </div>
    </>
  );
}

/** Несчастные случаи и повреждения имущества (раздел 19.4). */
export function IncidentsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const list = useInfiniteQuery({
    queryKey: ['incidents'],
    queryFn: ({ pageParam }) => api.incidents({ limit: 50, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageHead title={t('incidents.title')} sub={t('incidents.sub')} />
      <Section flush>
        {list.isLoading ? <Loading /> : null}
        <ErrorNote error={list.error} />
        {list.data && rows.length === 0 ? <Empty>{t('incidents.empty')}</Empty> : null}
        {rows.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('incidents.when')}</th>
                  <th>{t('incidents.type')}</th>
                  <th>{t('orders.numberLabel')}</th>
                  <th>{t('orders.city')}</th>
                  <th>{t('incidents.reporter')}</th>
                  <th>{t('incidents.emergency')}</th>
                  <th className="num">{t('orderCard.photos')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    data-clickable="true"
                    tabIndex={0}
                    onClick={() => navigate(`/incidents/${r.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') navigate(`/incidents/${r.id}`);
                    }}
                  >
                    <td>{dateTime(r.createdAt)}</td>
                    <td>
                      <Status tone={r.type === 'INJURY' || r.type === 'ACCIDENT' ? 'alert' : 'warn'}>{t(`incidents.types.${r.type}`)}</Status>
                    </td>
                    <td className="num">#{r.orderNumber}</td>
                    <td>{catalog.cityName(r.cityId)}</td>
                    <td>{t(`incidents.reporters.${r.reporterRole}`)}</td>
                    <td>{r.emergencyCalled ? t('incidents.called') : t('incidents.notCalled')}</td>
                    <td className="num">{r.photos}</td>
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

export function IncidentPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['incident', id], queryFn: () => api.incident(id) });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorNote error={q.error} />;
  const i = q.data;
  return (
    <>
      <PageHead title={t(`incidents.types.${i.type}`)} sub={`${t('orders.number', { number: i.order.number })} · ${dateTime(i.createdAt)}`}>
        {i.ticketId ? (
          <Link to={`/support/${i.ticketId}`} className="quiet">
            {t('disputes.ticket')}
          </Link>
        ) : null}
      </PageHead>
      <Note tone="warn">{t('incidents.noPromises')}</Note>
      <div className="grid-2">
        <div className="stack">
          <Section title={t('incidents.description')}>
            <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{i.description}</p>
          </Section>
          {i.photos.length > 0 ? (
            <Section title={t('orderCard.photos')} actions={<span className="faint">{t('orderCard.photosNote')}</span>}>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {i.photos.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer noopener">
                    <img src={url} alt="" width={140} height={140} style={{ objectFit: 'cover', borderRadius: 6 }} />
                  </a>
                ))}
              </div>
            </Section>
          ) : null}
          {i.location ? (
            <Section title={t('incidents.place')} flush>
              <BaseMap points={[[i.location.lat, i.location.lng]]} label={t('incidents.place')}>
                <CircleMarker center={[i.location.lat, i.location.lng]} radius={9} pathOptions={{ color: MAP_COLORS.waiting, fillColor: MAP_COLORS.waiting, fillOpacity: 0.9 }} />
              </BaseMap>
            </Section>
          ) : null}
        </div>
        <Section title={t('orderCard.details')}>
          <dl className="facts">
            <dt>{t('incidents.reporter')}</dt>
            <dd>{t(`incidents.reporters.${i.reporterRole}`)}</dd>
            <dt>{t('incidents.emergency')}</dt>
            <dd>{i.emergencyCalled ? t('incidents.called') : t('incidents.notCalled')}</dd>
            <dt>{t('finance.order')}</dt>
            <dd>
              <Link to={`/orders/${i.orderId}`}>{t('common.open')}</Link>
            </dd>
          </dl>
        </Section>
      </div>
    </>
  );
}

