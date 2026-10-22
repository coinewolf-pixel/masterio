import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { api } from '../api';
import { useSession } from '../auth/Session';
import { useCatalog } from '../catalog';
import { count, date, dateTime, money } from '../format';
import { Empty, ErrorNote, Field, LoadMore, Loading, OrderStatusLabel, PageHead, Section, Status, UserStatusLabel } from '../ui';
import { BlockButtons, BlockDialog } from './BlockDialog';
import { PEOPLE_STATUSES, useDebounced } from './Workers';

/** Клиенты: поиск по имени и телефону, статус (предупреждение, предоплата, блокировка по отменам). */
export function ClientsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const status = params.get('status') ?? '';
  const q = useDebounced(search.trim());
  const query = { q: q || undefined, status: status || undefined, limit: 50 };
  const clients = useInfiniteQuery({
    queryKey: ['clients', query],
    queryFn: ({ pageParam }) => api.clients({ ...query, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = clients.data?.pages.flatMap((p) => p.items) ?? [];
  const total = clients.data?.pages[0]?.total;

  return (
    <>
      <PageHead title={t('clients.title')} sub={total !== undefined ? t('clients.found', { formatted: count(total) }) : undefined} />
      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label={t('common.filters')}>
        <Field label={t('people.search')}>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('people.searchHint')} />
        </Field>
        <Field label={t('people.status')}>
          <select
            value={status}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set('status', e.target.value);
              else next.delete('status');
              setParams(next, { replace: true });
            }}
          >
            <option value="">{t('common.all')}</option>
            {PEOPLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`userStatus.${s}`)}
              </option>
            ))}
          </select>
        </Field>
      </form>

      <Section flush>
        {clients.isLoading ? <Loading /> : null}
        <ErrorNote error={clients.error} />
        {clients.data && rows.length === 0 ? <Empty>{t('clients.empty')}</Empty> : null}
        {rows.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('people.name')}</th>
                  <th>{t('people.status')}</th>
                  <th className="num">{t('clients.completed')}</th>
                  <th className="num">{t('clients.cancels30d')}</th>
                  <th>{t('people.country')}</th>
                  <th>{t('people.since')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    data-clickable="true"
                    tabIndex={0}
                    onClick={() => navigate(`/clients/${c.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') navigate(`/clients/${c.id}`);
                    }}
                  >
                    <td>
                      {c.name ?? t('common.noName')}
                      <div className="faint">{c.phone}</div>
                    </td>
                    <td>
                      <UserStatusLabel status={c.status} />
                    </td>
                    <td className="num">{c.completedOrders}</td>
                    <td className="num">{c.cancelCount30d}</td>
                    <td>{c.countryCode}</td>
                    <td>{date(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <LoadMore hasMore={clients.hasNextPage} loading={clients.isFetchingNextPage} onClick={() => void clients.fetchNextPage()} />
      </Section>
    </>
  );
}

/** Карточка клиента: история заказов, отмены со штрафами, споры, отметки, чёрный список мастеров, блокировка. */
export function ClientCardPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const { can } = useSession();
  const catalog = useCatalog();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['client', id], queryFn: () => api.client(id) });
  const [block, setBlock] = useState<'block' | 'unblock' | null>(null);

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorNote error={q.error} />;
  const c = q.data;

  return (
    <>
      <PageHead title={c.name ?? t('common.noName')} sub={`${c.phone ?? ''} · ${c.countryCode} · ${t('people.sinceDate', { date: date(c.createdAt) })}`}>
        <UserStatusLabel status={c.status} />
        {can('blockUsers') ? <BlockButtons status={c.status} onPick={setBlock} /> : null}
      </PageHead>

      <div className="figures" style={{ marginBottom: 20 }}>
        <div className="figure">
          <div className="value">{c.stats.total}</div>
          <div className="label">{t('clients.orders')}</div>
        </div>
        <div className="figure">
          <div className="value">{c.stats.completed}</div>
          <div className="label">{t('clients.completed')}</div>
        </div>
        <div className="figure" data-tone={c.stats.cancelledByClient > 0 ? 'warn' : undefined}>
          <div className="value">{c.stats.cancelledByClient}</div>
          <div className="label">{t('clients.cancelled')}</div>
          <div className="faint">{t('clients.cancels30dCount', { count: c.cancelCount30d })}</div>
        </div>
        <div className="figure" data-tone={c.stats.disputed > 0 ? 'warn' : undefined}>
          <div className="value">{c.stats.disputed}</div>
          <div className="label">{t('workers.disputes')}</div>
        </div>
      </div>

      <div className="grid-2">
        <Section
          title={t('clients.orders')}
          actions={
            <Link to={`/orders?clientId=${c.id}`} className="quiet">
              {t('common.all')}
            </Link>
          }
          flush
        >
          {c.orders.length === 0 ? <Empty>{t('workers.noOrders')}</Empty> : null}
          {c.orders.length > 0 ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('orders.numberLabel')}</th>
                    <th>{t('orders.created')}</th>
                    <th>{t('orders.status')}</th>
                    <th>{t('orders.category')}</th>
                    <th className="num">{t('orders.amount')}</th>
                    <th>{t('clients.cancellation')}</th>
                  </tr>
                </thead>
                <tbody>
                  {c.orders.map((o) => (
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
                      <td>
                        {o.cancellation ? (
                          <>
                            {o.cancellation.actor === 'CLIENT' ? t(`cancel.client.${o.cancellation.reasonCode}`, { defaultValue: o.cancellation.reasonCode }) : t(`orderCard.actor.${o.cancellation.actor}`)}
                            {o.cancellation.penaltyCents > 0 ? <div className="faint num">{t('clients.penalty', { amount: money(o.cancellation.penaltyCents, o.currency) })}</div> : null}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Section>

        <div className="stack">
          <Section title={t('orderCard.disputes')}>
            {c.disputes.length === 0 ? <p className="faint">{t('clients.noDisputes')}</p> : null}
            <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>
              {c.disputes.map((d) => (
                <li key={d.id}>
                  <Link to={`/orders/${d.orderId}`}>{t(`dispute.reason.${d.reason}`, { defaultValue: d.reason })}</Link> · <Status tone={d.status === 'OPEN' ? 'warn' : 'none'}>{t(`dispute.status.${d.status}`, { defaultValue: d.status })}</Status>
                  <div className="faint">{dateTime(d.createdAt)}</div>
                </li>
              ))}
            </ul>
          </Section>

          <Section title={t('clients.blacklist')}>
            {c.blacklist.length === 0 ? <p className="faint">{t('clients.blacklistEmpty')}</p> : null}
            <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>
              {c.blacklist.map((b) => (
                <li key={b.workerId}>
                  <Link to={`/workers/${b.workerId}`}>{t('clients.worker')}</Link> <span className="faint">· {date(b.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Section>

          {c.flags.length > 0 ? (
            <Section title={t('fraud.title')}>
              <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>
                {c.flags.map((fl) => (
                  <li key={fl.id}>
                    {t(`fraud.type.${fl.type}`, { defaultValue: fl.type })} · {dateTime(fl.createdAt)}
                    {fl.resolvedAt ? <span className="faint"> · {t('fraud.resolved')}</span> : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      </div>

      <BlockDialog userId={c.id} mode={block} onClose={() => setBlock(null)} onDone={() => void queryClient.invalidateQueries({ queryKey: ['client', id] })} />
    </>
  );
}
