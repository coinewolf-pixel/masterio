import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { api } from '../api';
import { ORDER_STATUSES } from '../api/types';
import { useCatalog } from '../catalog';
import { count, dateTime, dayRange, localized, money } from '../format';
import { Empty, ErrorNote, Field, LoadMore, Loading, OrderStatusLabel, PageHead, Section } from '../ui';

const FILTERS = ['status', 'cityId', 'categoryId', 'day', 'number', 'workerId', 'clientId'] as const;

/** Заказы с фильтрами (раздел 14). Фильтры живут в адресе страницы — ссылкой можно поделиться с коллегой. */
export function OrdersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const catalog = useCatalog();
  const f = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? ''])) as Record<(typeof FILTERS)[number], string>;
  const range = f.day ? dayRange(f.day) : null;
  const query = {
    status: f.status || undefined,
    cityId: f.cityId || undefined,
    categoryId: f.categoryId || undefined,
    workerId: f.workerId || undefined,
    clientId: f.clientId || undefined,
    number: /^\d+$/.test(f.number) ? Number(f.number) : undefined,
    from: range?.from,
    to: range?.to,
    limit: 50,
  };
  const orders = useInfiniteQuery({
    queryKey: ['orders', query],
    queryFn: ({ pageParam }) => api.orders({ ...query, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const set = (key: (typeof FILTERS)[number], value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const rows = orders.data?.pages.flatMap((p) => p.items) ?? [];
  const total = orders.data?.pages[0]?.total;
  const categories = catalog.data?.groups.flatMap((g) => g.categories) ?? [];

  return (
    <>
      <PageHead title={t('orders.title')} sub={total !== undefined ? t('orders.found', { count: total, formatted: count(total) }) : undefined} />

      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label={t('common.filters')}>
        <Field label={t('orders.numberLabel')}>
          <input inputMode="numeric" value={f.number} onChange={(e) => set('number', e.target.value.replace(/\D/g, ''))} style={{ width: 110 }} />
        </Field>
        <Field label={t('orders.status')}>
          <select value={f.status} onChange={(e) => set('status', e.target.value)}>
            <option value="">{t('common.all')}</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`order.status.${s}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('orders.city')}>
          <select value={f.cityId} onChange={(e) => set('cityId', e.target.value)}>
            <option value="">{t('common.all')}</option>
            {(catalog.data?.cities ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {localized(c.names)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('orders.category')}>
          <select value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">{t('common.all')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {localized(c.names, c.code)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('orders.day')}>
          <input type="date" value={f.day} onChange={(e) => set('day', e.target.value)} />
        </Field>
        {f.workerId || f.clientId ? (
          <button type="button" className="quiet" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            {t('orders.resetPerson')}
          </button>
        ) : null}
      </form>

      <Section flush>
        {orders.isLoading ? <Loading /> : null}
        <ErrorNote error={orders.error} />
        {orders.data && rows.length === 0 ? <Empty>{t('orders.empty')}</Empty> : null}
        {rows.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('orders.numberLabel')}</th>
                  <th>{t('orders.created')}</th>
                  <th>{t('orders.status')}</th>
                  <th>{t('orders.category')}</th>
                  <th>{t('orders.city')}</th>
                  <th>{t('orders.client')}</th>
                  <th>{t('orders.worker')}</th>
                  <th className="num">{t('orders.amount')}</th>
                  <th className="num">{t('orders.commission')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr
                    key={o.id}
                    data-clickable="true"
                    tabIndex={0}
                    onClick={() => navigate(`/orders/${o.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') navigate(`/orders/${o.id}`);
                    }}
                  >
                    <td className="num">#{o.number}</td>
                    <td>{dateTime(o.createdAt)}</td>
                    <td>
                      <OrderStatusLabel status={o.status} />
                    </td>
                    <td>{catalog.categoryName(o.categoryId)}</td>
                    <td>{catalog.cityName(o.cityId)}</td>
                    <td>
                      {o.client.name ?? t('common.noName')}
                      <div className="faint">{o.client.phone}</div>
                    </td>
                    <td>
                      {o.worker ? (
                        <>
                          {o.worker.name ?? t('common.noName')}
                          <div className="faint">{o.worker.phone}</div>
                        </>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                    <td className="num">{money(o.confirmedAmountCents, o.currency)}</td>
                    <td className="num">{money(o.commissionCents, o.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <LoadMore hasMore={orders.hasNextPage} loading={orders.isFetchingNextPage} onClick={() => void orders.fetchNextPage()} />
      </Section>
    </>
  );
}
