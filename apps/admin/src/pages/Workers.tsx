import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { useCatalog } from '../catalog';
import { api } from '../api';
import { count, date, localized, percent } from '../format';
import { Empty, ErrorNote, Field, LoadMore, Loading, PageHead, Section, Status, UserStatusLabel, VerificationLabel } from '../ui';

const FILTERS = ['q', 'status', 'kyc', 'online', 'cityId'] as const;
type Filter = (typeof FILTERS)[number];
export const PEOPLE_STATUSES = ['ACTIVE', 'WARNED', 'PREPAY_REQUIRED', 'SUSPENDED', 'BLOCKED'] as const;
const KYC = ['NOT_VERIFIED', 'VERIFIED', 'REJECTED', 'EXPIRED'] as const;

/** Поиск по имени и телефону с задержкой, чтобы не слать запрос на каждую букву. */
export function useDebounced(value: string, ms = 350): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Мастера: поиск, фильтры по статусу, KYC, онлайну и городу (раздел 14). */
export function WorkersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const [params, setParams] = useSearchParams();
  const f = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? ''])) as Record<Filter, string>;
  const [search, setSearch] = useState(f.q);
  const q = useDebounced(search.trim());
  const query = { q: q || undefined, status: f.status || undefined, kyc: f.kyc || undefined, online: f.online || undefined, cityId: f.cityId || undefined, limit: 50 };
  const workers = useInfiniteQuery({
    queryKey: ['workers', query],
    queryFn: ({ pageParam }) => api.workers({ ...query, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const set = (key: Filter, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const rows = workers.data?.pages.flatMap((p) => p.items) ?? [];
  const total = workers.data?.pages[0]?.total;

  return (
    <>
      <PageHead title={t('workers.title')} sub={total !== undefined ? t('workers.found', { formatted: count(total) }) : undefined} />
      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label={t('common.filters')}>
        <Field label={t('people.search')}>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('people.searchHint')} />
        </Field>
        <Field label={t('people.status')}>
          <select value={f.status} onChange={(e) => set('status', e.target.value)}>
            <option value="">{t('common.all')}</option>
            {PEOPLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`userStatus.${s}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('workers.kyc')}>
          <select value={f.kyc} onChange={(e) => set('kyc', e.target.value)}>
            <option value="">{t('common.all')}</option>
            {KYC.map((s) => (
              <option key={s} value={s}>
                {t(`verification.${s}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('workers.online')}>
          <select value={f.online} onChange={(e) => set('online', e.target.value)}>
            <option value="">{t('common.all')}</option>
            <option value="true">{t('workers.onlineYes')}</option>
            <option value="false">{t('workers.onlineNo')}</option>
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
      </form>

      <Section flush>
        {workers.isLoading ? <Loading /> : null}
        <ErrorNote error={workers.error} />
        {workers.data && rows.length === 0 ? <Empty>{t('workers.empty')}</Empty> : null}
        {rows.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('people.name')}</th>
                  <th>{t('people.status')}</th>
                  <th>{t('workers.kyc')}</th>
                  <th>{t('workers.online')}</th>
                  <th>{t('workers.cities')}</th>
                  <th className="num">{t('workers.rating')}</th>
                  <th className="num">{t('workers.acceptRate')}</th>
                  <th className="num">{t('workers.cancelRate')}</th>
                  <th>{t('people.since')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr
                    key={w.id}
                    data-clickable="true"
                    tabIndex={0}
                    onClick={() => navigate(`/workers/${w.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') navigate(`/workers/${w.id}`);
                    }}
                  >
                    <td>
                      {w.name ?? t('common.noName')}
                      {w.type === 'COMPANY' && w.companyName ? <div className="faint">{w.companyName}</div> : null}
                      <div className="faint">{w.phone}</div>
                    </td>
                    <td>
                      <UserStatusLabel status={w.status} />
                    </td>
                    <td>
                      <VerificationLabel status={w.kycStatus} />
                    </td>
                    <td>{w.isOnline ? <Status tone="live">{t('workers.onlineYes')}</Status> : <span className="faint">{t('workers.onlineNo')}</span>}</td>
                    <td>{w.cityIds.map((id) => catalog.cityName(id)).join(', ') || '—'}</td>
                    <td className="num">{w.ratingCount > 0 ? `${w.ratingAvg.toFixed(2)} (${w.ratingCount})` : '—'}</td>
                    <td className="num">{percent(w.acceptRate)}</td>
                    <td className="num">{percent(w.cancelRate)}</td>
                    <td>{date(w.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <LoadMore hasMore={workers.hasNextPage} loading={workers.isFetchingNextPage} onClick={() => void workers.fetchNextPage()} />
      </Section>
    </>
  );
}
