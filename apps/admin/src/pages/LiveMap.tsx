import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleMarker, Polyline, Popup, Tooltip } from 'react-leaflet';
import { Link } from 'react-router';
import { RT_EVENTS, type AdminMapPayload } from '@masterio/shared';
import { api } from '../api';
import type { MapWorker } from '../api/types';
import { useCatalog } from '../catalog';
import { time } from '../format';
import { BaseMap, MAP_COLORS } from '../map/BaseMap';
import { useRealtime, useRealtimeEvent } from '../realtime';
import { ErrorNote, Loading, OrderStatusLabel, PageHead, Section } from '../ui';

type LivePoint = { lat: number; lng: number; at: string };

/**
 * Живая карта: мастера на линии (зелёные — свободны, жёлтые — на заказе), заказы (синие — в работе,
 * красные — ищут мастера) и линия от исполнителя к адресу. Позиции двигаются по событиям сокета.
 */
export function LiveMapPage() {
  const { t } = useTranslation();
  const { connected } = useRealtime();
  const { categoryName } = useCatalog();
  const queryClient = useQueryClient();
  const snap = useQuery({ queryKey: ['map'], queryFn: api.map, refetchInterval: 60_000 });
  const [live, setLive] = useState<Record<string, LivePoint>>({});
  const [gone, setGone] = useState<Record<string, true>>({});

  // свежий снимок заменяет накопленные дельты
  useEffect(() => {
    setLive({});
    setGone({});
  }, [snap.dataUpdatedAt]);

  useRealtimeEvent<AdminMapPayload>(RT_EVENTS.adminMap, (p) => {
    if (p.kind === 'offline') {
      setGone((g) => ({ ...g, [p.userId]: true }));
      return;
    }
    const at = p.kind === 'worker' ? p.at : p.recordedAt;
    setLive((l) => ({ ...l, [p.userId]: { lat: p.lat, lng: p.lng, at } }));
    setGone((g) => {
      if (!g[p.userId]) return g;
      const next = { ...g };
      delete next[p.userId];
      return next;
    });
  });
  useRealtimeEvent(RT_EVENTS.orderStatus, () => void queryClient.invalidateQueries({ queryKey: ['map'] }));

  const workers: MapWorker[] = useMemo(() => {
    const base = (snap.data?.workers ?? []).filter((w) => !gone[w.userId]);
    return base.map((w) => {
      const p = live[w.userId];
      return p ? { ...w, lat: p.lat, lng: p.lng, lastLocationAt: p.at } : w;
    });
  }, [snap.data, live, gone]);

  const orders = useMemo(() => snap.data?.orders ?? [], [snap.data]);
  const points = useMemo<Array<[number, number]>>(
    () => [...workers.map((w): [number, number] => [w.lat, w.lng]), ...orders.map((o): [number, number] => [o.location.lat, o.location.lng])],
    [workers, orders],
  );

  if (snap.isLoading) return <Loading />;
  if (!snap.data) return <ErrorNote error={snap.error} />;

  const performerPosition = (workerId: string | null) => {
    if (!workerId) return null;
    const w = workers.find((x) => x.userId === workerId);
    return w ? { lat: w.lat, lng: w.lng } : null;
  };
  const waiting = orders.filter((o) => o.status === 'SEARCHING' || o.status === 'NO_WORKERS');

  return (
    <>
      <PageHead title={t('map.title')} sub={connected ? t('map.live') : t('map.offline')}>
        <div className="map-legend">
          <span className="free">{t('map.free')}</span>
          <span className="busy">{t('map.busy')}</span>
          <span className="order">{t('map.order')}</span>
          <span className="waiting">{t('map.waiting')}</span>
        </div>
      </PageHead>

      <div className="grid-2">
        <BaseMap points={points} tall label={t('map.title')}>
          {orders.map((o) => {
            const performer = performerPosition(o.workerId) ?? o.performer;
            const isWaiting = o.status === 'SEARCHING' || o.status === 'NO_WORKERS';
            return (
              <Fragment key={o.id}>
                {performer ? (
                  <Polyline positions={[[performer.lat, performer.lng], [o.location.lat, o.location.lng]]} pathOptions={{ color: MAP_COLORS.order, weight: 2, dashArray: '6 6' }} />
                ) : null}
                <CircleMarker
                  center={[o.location.lat, o.location.lng]}
                  radius={8}
                  pathOptions={{ color: '#ffffff', weight: 2, fillColor: isWaiting ? MAP_COLORS.waiting : MAP_COLORS.order, fillOpacity: 1 }}
                >
                  <Popup>
                    <div className="stack" style={{ gap: 4 }}>
                      <Link to={`/orders/${o.id}`}>{t('orders.number', { number: o.number })}</Link>
                      <span>{categoryName(o.categoryId)}</span>
                      <OrderStatusLabel status={o.status} />
                      <span className="faint">{o.addressFormatted}</span>
                    </div>
                  </Popup>
                </CircleMarker>
              </Fragment>
            );
          })}
          {workers.map((w) => (
            <CircleMarker
              key={w.userId}
              center={[w.lat, w.lng]}
              radius={7}
              pathOptions={{ color: '#ffffff', weight: 2, fillColor: w.busy ? MAP_COLORS.busy : MAP_COLORS.free, fillOpacity: 1 }}
            >
              <Tooltip>{w.name ?? t('common.noName')}</Tooltip>
              <Popup>
                <div className="stack" style={{ gap: 4 }}>
                  <Link to={`/workers/${w.userId}`}>{w.name ?? t('common.noName')}</Link>
                  <span>{w.busy ? t('map.busy') : t('map.free')}</span>
                  <span className="faint">{t('map.lastPoint', { time: time(w.lastLocationAt) })}</span>
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </BaseMap>

        <div className="stack">
          <Section title={t('map.waitingTitle', { count: waiting.length })} flush>
            {waiting.length === 0 ? (
              <p className="empty">{t('map.noWaiting')}</p>
            ) : (
              <table className="data">
                <tbody>
                  {waiting.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <Link to={`/orders/${o.id}`}>#{o.number}</Link>
                        <div className="faint">{categoryName(o.categoryId)}</div>
                      </td>
                      <td>
                        <OrderStatusLabel status={o.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
          <Section title={t('map.summary')}>
            <dl className="facts num">
              <dt>{t('map.free')}</dt>
              <dd>{workers.filter((w) => !w.busy).length}</dd>
              <dt>{t('map.busy')}</dt>
              <dd>{workers.filter((w) => w.busy).length}</dd>
              <dt>{t('map.performing')}</dt>
              <dd>{orders.length - waiting.length}</dd>
              <dt>{t('map.waiting')}</dt>
              <dd>{waiting.length}</dd>
            </dl>
          </Section>
        </div>
      </div>
    </>
  );
}
