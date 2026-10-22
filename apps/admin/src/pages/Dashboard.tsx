import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { RT_EVENTS } from '@masterio/shared';
import { api } from '../api';
import type { CityPulse } from '../api/types';
import { useSession } from '../auth/Session';
import { count, localized, money, time } from '../format';
import { useRealtimeEvent } from '../realtime';
import { ErrorNote, Loading, PageHead, Section } from '../ui';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Дашборд: что происходит сегодня и сейчас, где не хватает мастеров, что ждёт решения. */
export function DashboardPage() {
  const { t } = useTranslation();
  const { canSee } = useSession();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['dashboard', TZ], queryFn: () => api.dashboard(TZ), refetchInterval: 30_000 });
  useRealtimeEvent(RT_EVENTS.orderStatus, () => void queryClient.invalidateQueries({ queryKey: ['dashboard', TZ] }));

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorNote error={q.error} />;
  const d = q.data;
  const low = d.cities.filter((c) => c.lowWorkers);

  return (
    <>
      <PageHead title={t('dashboard.title')} sub={t('dashboard.updated', { time: time(new Date(q.dataUpdatedAt).toISOString()) })} />

      <div className="figures" role="list" aria-label={t('dashboard.now')}>
        <Figure label={t('dashboard.searching')} value={d.now.searching} />
        <Figure label={t('dashboard.noWorkers')} value={d.now.noWorkers} tone={d.now.noWorkers > 0 ? 'alert' : undefined} />
        <Figure label={t('dashboard.performing')} value={d.now.performing} />
        <Figure label={t('dashboard.awaiting')} value={d.now.awaitingConfirmation} />
        <Figure label={t('dashboard.disputed')} value={d.now.disputed} tone={d.now.disputed > 0 ? 'warn' : undefined} />
        <Figure label={t('dashboard.online')} value={d.now.onlineWorkers} />
      </div>

      <div className="grid-2">
        <Section
          title={t('dashboard.cities')}
          actions={low.length > 0 ? <span className="faint">{t('dashboard.lowCount', { count: low.length })}</span> : null}
          flush
        >
          {d.cities.length === 0 ? <p className="empty">{t('dashboard.noCities')}</p> : <CityPulseTable cities={d.cities} />}
        </Section>

        <div className="stack">
          <Section title={t('dashboard.today')}>
            <dl className="facts num">
              <dt>{t('dashboard.created')}</dt>
              <dd>{count(d.today.created)}</dd>
              <dt>{t('dashboard.completed')}</dt>
              <dd>{count(d.today.completed)}</dd>
              <dt>{t('dashboard.cancelled')}</dt>
              <dd>{count(d.today.cancelled)}</dd>
              {d.commissionToday
                ? d.commissionToday.length === 0
                  ? [
                      <dt key="c">{t('dashboard.commission')}</dt>,
                      <dd key="v">—</dd>,
                    ]
                  : d.commissionToday.map((c) => [
                      <dt key={`${c.currency}-t`}>{t('dashboard.commission')}</dt>,
                      <dd key={`${c.currency}-v`}>{money(c.cents, c.currency)}</dd>,
                    ])
                : null}
            </dl>
          </Section>

          <Section title={t('dashboard.queues')}>
            <dl className="facts num">
              {canSee('documents') ? (
                <>
                  <dt>
                    <Link to="/documents">{t('nav.documents')}</Link>
                  </dt>
                  <dd>{count(d.queues.documents)}</dd>
                </>
              ) : null}
              {canSee('grants') ? (
                <>
                  <dt>
                    <Link to="/grants">{t('dashboard.grantsPending')}</Link>
                  </dt>
                  <dd>{count(d.queues.grants)}</dd>
                </>
              ) : null}
              {canSee('fraud') ? (
                <>
                  <dt>
                    <Link to="/fraud">{t('nav.fraud')}</Link>
                  </dt>
                  <dd>{count(d.queues.fraudFlags)}</dd>
                </>
              ) : null}
              {canSee('disputes') ? (
                <>
                  <dt>
                    <Link to="/disputes">{t('dashboard.disputesOpen')}</Link>
                  </dt>
                  <dd>{count(d.queues.disputes)}</dd>
                </>
              ) : null}
              {canSee('support') ? (
                <>
                  <dt>
                    <Link to="/support">{t('dashboard.ticketsOpen')}</Link>
                  </dt>
                  <dd>{count(d.queues.tickets)}</dd>
                  <dt>
                    <Link to="/incidents">{t('dashboard.incidentsWeek')}</Link>
                  </dt>
                  <dd>{count(d.queues.incidents)}</dd>
                </>
              ) : null}
            </dl>
          </Section>
        </div>
      </div>
    </>
  );
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: 'alert' | 'warn' }) {
  return (
    <div className="figure" role="listitem" data-tone={tone}>
      <div className="value">{count(value)}</div>
      <div className="label">{label}</div>
    </div>
  );
}

/**
 * Пульс городов: сколько мастеров на линии против минимума из настроек.
 * Чёрная засечка — минимум; жёлтая полоса — мастеров меньше минимума.
 */
export function CityPulseTable({ cities }: { cities: CityPulse[] }) {
  const { t } = useTranslation();
  const scale = Math.max(4, ...cities.map((c) => Math.max(c.online, c.minimum) * 1.25));
  return (
    <table className="pulse">
      <tbody>
        {cities.map((c) => (
          <tr key={c.cityId}>
            <td className="city">
              <Link to={`/orders?cityId=${c.cityId}`}>{localized(c.names)}</Link>
            </td>
            <td>
              <div
                className="meter"
                data-low={c.lowWorkers}
                role="meter"
                aria-valuemin={0}
                aria-valuemax={Math.round(scale)}
                aria-valuenow={c.online}
                aria-label={t('dashboard.onlineOfMin', { online: c.online, min: c.minimum })}
              >
                <div className="fill" style={{ width: `${Math.min(100, (c.online / scale) * 100)}%` }} />
                <div className="tick" style={{ left: `${Math.min(100, (c.minimum / scale) * 100)}%` }} />
              </div>
              {c.lowWorkers ? <div className="warn-text">{t('dashboard.lowWorkers', { min: c.minimum })}</div> : null}
            </td>
            <td className="num" style={{ whiteSpace: 'nowrap' }}>
              <strong>{c.online}</strong> <span className="faint">{t('dashboard.onlineShort')}</span>
            </td>
            <td className="num faint" style={{ whiteSpace: 'nowrap' }}>
              <div>{t('dashboard.cityOrders', { active: c.active, searching: c.searching })}</div>
              {c.noWorkers > 0 ? <div style={{ color: 'var(--alert)' }}>{t('dashboard.cityNoWorkers', { count: c.noWorkers })}</div> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
