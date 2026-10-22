import { useEffect, useRef, useState } from 'react';
import { RT_EVENTS, type LatLng, type WorkerLocationPayload } from '@masterio/shared';
import { api } from '../api';
import { useRealtime, useRealtimeEvent } from '../realtime/RealtimeProvider';
import { bearing, easeOutCubic, lerp } from './smooth';

export interface LiveWorker {
  /** позиция для отрисовки (плавно анимируется между точками) */
  position: LatLng | null;
  heading: number;
  distanceM: number | null;
  etaSeconds: number | null;
  /** пройденный путь — для линии на карте */
  path: LatLng[];
  connectionLost: boolean;
  lastUpdate: string | null;
}

const ANIMATION_MS = 1_200;
const MAX_PATH = 300;

/**
 * Живое отслеживание исполнителя (раздел 4): вход в комнату заказа по сокету, начальный трек по HTTP,
 * плавное движение метки между обновлениями (приходят каждые 3–15 с), статус «связь потеряна».
 */
export function useLiveWorker(orderId: string, active: boolean): LiveWorker {
  const { connected, emitWithAck } = useRealtime();
  const [target, setTarget] = useState<LatLng | null>(null);
  const [position, setPosition] = useState<LatLng | null>(null);
  const [heading, setHeading] = useState(0);
  const [distanceM, setDistance] = useState<number | null>(null);
  const [etaSeconds, setEta] = useState<number | null>(null);
  const [path, setPath] = useState<LatLng[]>([]);
  const [connectionLost, setLost] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const positionRef = useRef<LatLng | null>(null);

  // вход в комнату заказа: при подключении и после каждого переподключения сокета
  useEffect(() => {
    if (!active || !connected) return;
    void emitWithAck<{ ok: boolean }>(RT_EVENTS.orderJoin, { orderId });
  }, [active, connected, orderId, emitWithAck]);

  // начальный трек: последние точки, чтобы метка появилась сразу, а не через несколько секунд
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void api.orders
      .track(orderId)
      .then((points) => {
        if (cancelled || points.length === 0) return;
        const ordered = [...points].reverse().map((p) => ({ lat: p.lat, lng: p.lng }));
        setPath(ordered.slice(-MAX_PATH));
        const last = ordered[ordered.length - 1] ?? null;
        positionRef.current = last;
        setPosition(last);
        setTarget(last);
        setLastUpdate(points[0]?.recordedAt ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [active, orderId]);

  useRealtimeEvent<WorkerLocationPayload>(RT_EVENTS.locationWorker, (p) => {
    if (p.orderId !== orderId) return;
    const next = { lat: p.lat, lng: p.lng };
    const from = positionRef.current;
    if (p.heading !== null) setHeading(p.heading);
    else if (from) setHeading(bearing(from, next));
    setTarget(next);
    setDistance(p.distanceM);
    setEta(p.etaSeconds);
    setLost(false);
    setLastUpdate(p.recordedAt);
    setPath((prev) => [...prev, next].slice(-MAX_PATH));
  });
  useRealtimeEvent<{ orderId: string }>(RT_EVENTS.locationLost, (p) => {
    if (p.orderId === orderId) setLost(true);
  });
  useRealtimeEvent<{ orderId: string }>(RT_EVENTS.locationRestored, (p) => {
    if (p.orderId === orderId) setLost(false);
  });

  // плавная анимация метки к новой точке
  useEffect(() => {
    if (!target) return;
    const from = positionRef.current ?? target;
    const start = Date.now();
    let frame = 0;
    const step = () => {
      const t = easeOutCubic((Date.now() - start) / ANIMATION_MS);
      const p = lerp(from, target, t);
      positionRef.current = p;
      setPosition(p);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return { position, heading, distanceM, etaSeconds, path, connectionLost, lastUpdate };
}
