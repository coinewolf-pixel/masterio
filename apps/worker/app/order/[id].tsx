import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, View } from 'react-native';
import { WORKER_CANCEL_REASONS, RT_EVENTS } from '@masterio/shared';
import { api } from '../../src/api';
import type { OrderDetails, OrderStatus } from '../../src/api/types';
import { localized, money, parseAmount } from '../../src/format';
import { currentPosition } from '../../src/location/control';
import { useRealtimeEvent } from '../../src/realtime/RealtimeProvider';
import { useSession } from '../../src/session/SessionProvider';
import { AssignCard } from '../../src/team/AssignCard';
import { Banner, Button, Card, Chip, ErrorText, Field, Loading, Row, Screen, T } from '../../src/ui/components';
import { space, useColors } from '../../src/ui/theme';

const NEXT: Partial<Record<OrderStatus, 'EN_ROUTE' | 'ARRIVED' | 'IN_PROGRESS'>> = {
  ACCEPTED: 'EN_ROUTE',
  EN_ROUTE: 'ARRIVED',
  ARRIVED: 'IN_PROGRESS',
};
const ACTIVE: OrderStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];

const DISPUTABLE: OrderStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED_BY_WORKER', 'CONFIRMED', 'AUTO_CONFIRMED', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_WORKER', 'DISPUTED', 'CLOSED'];
const INCIDENT: OrderStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED_BY_WORKER', 'CONFIRMED', 'AUTO_CONFIRMED', 'DISPUTED'];

/** Спор и несчастный случай по заказу (разделы 18.5, 19.4). */
function CaseButtons({ order, emergency }: { order: OrderDetails; emergency: string | null }) {
  const { t } = useTranslation();
  const open = order.dispute && !['SETTLED', 'UNRESOLVED_REFERRED', 'CLOSED'].includes(order.dispute.status);
  // спор ведёт руководитель (сторона заказа); участник сообщает о происшествии и пишет в поддержку
  const party = order.viewer === 'owner';
  return (
    <>
      {order.dispute && party ? (
        <Button
          title={t('case.dispute.view', { status: t(`case.status.${order.dispute.status}`) })}
          variant={open ? 'primary' : 'secondary'}
          onPress={() => router.push({ pathname: '/dispute/[id]', params: { id: order.dispute?.id ?? '' } })}
        />
      ) : null}
      {party && DISPUTABLE.includes(order.status) && !open ? (
        <Button title={t('case.dispute.open')} variant="secondary" onPress={() => router.push({ pathname: '/dispute/new', params: { orderId: order.id } })} />
      ) : null}
      {INCIDENT.includes(order.status) ? (
        <Button title={t('case.incident.report')} variant="ghost" onPress={() => router.push({ pathname: '/incident', params: { orderId: order.id, emergency: emergency ?? '' } })} />
      ) : null}
    </>
  );
}

function KeepAwake() {
  useKeepAwake();
  return null;
}

/** Активный заказ: навигация, «Выехал» → «Прибыл» (только на месте) → «Начал работу», смета, завершение с наличными. */
export default function OrderScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useSession();
  const queryClient = useQueryClient();
  const order = useQuery({ queryKey: ['order', id], queryFn: () => api.orders.get(id), refetchInterval: 20_000 });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.catalog.categories(), staleTime: 3_600_000 });
  const cities = useQuery({ queryKey: ['cities'], queryFn: api.catalog.cities, staleTime: 3_600_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [cash, setCash] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [result, setResult] = useState<{ commissionCents: number; bonusDiscountCents: number; chargedCents: number; toDebtCents: number } | null>(null);

  useRealtimeEvent<{ orderId: string }>(RT_EVENTS.orderEstimate, (p) => {
    if (p.orderId === id) void order.refetch();
  });
  // назначение или замена исполнителя в команде
  useRealtimeEvent<{ orderId: string }>(RT_EVENTS.orderAssignment, (p) => {
    if (p.orderId === id) {
      void order.refetch();
      void queryClient.invalidateQueries({ queryKey: ['eligibility'] });
    }
  });

  const data = order.data;
  const approved = data?.estimates.find((e) => e.status === 'APPROVED') ?? null;
  const proposed = data?.estimates.find((e) => e.status === 'PROPOSED') ?? null;

  useEffect(() => {
    if (approved && cash === '') setCash((approved.totalCents / 100).toFixed(2));
  }, [approved, cash]);

  if (order.isLoading || !data) return <Loading />;

  const category = categories.data?.flatMap((g) => g.categories).find((x) => x.id === data.categoryId);
  const isActive = ACTIVE.includes(data.status);
  const isOwner = data.viewer === 'owner';
  // статусы, смету и завершение подтверждает тот, кто на месте: назначенный участник или сам руководитель
  const performing = !isOwner || !data.team?.current || data.team.current.userId === me?.id;
  const next = performing ? NEXT[data.status] : undefined;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ['order', id] });
      await queryClient.invalidateQueries({ queryKey: ['eligibility'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const navigate = () => {
    if (!data.location) return;
    const { lat, lng } = data.location;
    void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`);
  };

  const complete = () => {
    const cents = parseAmount(cash);
    if (cents === null) {
      setError(new Error('amount'));
      return;
    }
    Alert.alert(t('pro.order.completeConfirmTitle'), t('pro.order.completeConfirmBody', { amount: money(cents, data.currency) }), [
      { text: t('pro.common.cancel'), style: 'cancel' },
      {
        text: t('pro.common.confirm'),
        onPress: () =>
          void run('complete', async () => {
            const res = await api.orders.complete(id, cents, await currentPosition());
            setResult(res.commission);
          }),
      },
    ]);
  };

  return (
    <Screen refreshing={order.isRefetching} onRefresh={() => void order.refetch()}>
      {isActive ? <KeepAwake /> : null}
      <T variant="small">{t('pro.order.number', { number: data.number })}</T>
      <T variant="title">{localized(category?.names, '')}</T>
      <Banner tone={isActive ? 'info' : 'success'} text={t(`order.status.${data.status}`)} />

      <Card>
        <T variant="small">{t('pro.order.address')}</T>
        <T variant="h2">{data.addressFormatted}</T>
        {data.addressDetails ? <T variant="muted">{data.addressDetails}</T> : null}
        <T>{data.description}</T>
        {isActive ? (
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', marginTop: space.sm }}>
            <Button title={t('pro.order.navigate')} onPress={navigate} style={{ flexGrow: 1 }} />
            {data.contacts?.clientPhone ? (
              <Button title={t('pro.order.call')} variant="secondary" onPress={() => void Linking.openURL(`tel:${data.contacts?.clientPhone ?? ''}`)} style={{ flexGrow: 1 }} />
            ) : null}
            <Button title={t('pro.order.chat')} variant="secondary" onPress={() => router.push({ pathname: '/order/chat', params: { id } })} style={{ flexGrow: 1 }} />
          </View>
        ) : null}
      </Card>

      {isOwner && isActive && data.team ? <AssignCard order={data} meId={me?.id ?? ''} /> : null}

      {next ? (
        <Button
          title={t(`pro.order.action.${next}`)}
          loading={busy === 'status'}
          onPress={() => void run('status', async () => api.orders.status(id, next, await currentPosition()))}
        />
      ) : null}
      {data.status === 'EN_ROUTE' ? <T variant="small">{t('pro.order.arriveHint')}</T> : null}

      {performing && (data.status === 'IN_PROGRESS' || (isActive && data.estimates.length > 0)) ? (
        <Card>
          <T variant="h2">{t('pro.order.estimate')}</T>
          {approved ? <Row label={t('pro.order.estimateApproved')} value={money(approved.totalCents, data.currency)} strong /> : null}
          {proposed ? <Row label={t('pro.order.estimateWaiting')} value={money(proposed.totalCents, data.currency)} /> : null}
          {!approved && !proposed ? <T variant="muted">{t('pro.order.estimateNone')}</T> : null}
          <Button
            title={approved || proposed ? t('pro.order.estimateChange') : t('pro.order.estimateCreate')}
            variant="secondary"
            onPress={() => router.push({ pathname: '/order/estimate', params: { id } })}
          />
          {approved && data.status === 'IN_PROGRESS' ? <T variant="small">{t('pro.order.estimateChangeHint')}</T> : null}
        </Card>
      ) : null}

      {performing && data.status === 'IN_PROGRESS' && approved ? (
        <Card>
          <T variant="h2">{t('pro.order.completeTitle')}</T>
          <Field label={t('pro.order.cashReceived', { currency: data.currency })} value={cash} onChangeText={setCash} keyboardType="decimal-pad" />
          <T variant="small">{t('pro.order.commissionNote')}</T>
          <Button title={t('pro.order.complete')} loading={busy === 'complete'} onPress={complete} />
        </Card>
      ) : null}

      {isOwner && (result || data.commissionCents !== null) ? (
        <Card>
          <T variant="h2">{t('pro.order.commissionTitle')}</T>
          <Row label={t('pro.order.amount')} value={money(data.confirmedAmountCents ?? 0, data.currency)} />
          <Row label={t('pro.order.commission')} value={money(result?.commissionCents ?? data.commissionCents ?? 0, data.currency)} />
          <Row label={t('pro.order.bonusDiscount')} value={`−${money(result?.bonusDiscountCents ?? data.bonusDiscountCents ?? 0, data.currency)}`} />
          <Row
            label={t('pro.order.charged')}
            value={money((result?.commissionCents ?? data.commissionCents ?? 0) - (result?.bonusDiscountCents ?? data.bonusDiscountCents ?? 0), data.currency)}
            strong
          />
          {result && result.toDebtCents > 0 ? <Banner tone="warning" text={t('pro.order.debtNote', { amount: money(result.toDebtCents, data.currency) })} /> : null}
          {data.status === 'COMPLETED_BY_WORKER' ? <T variant="muted">{t('pro.order.waitingClient')}</T> : null}
        </Card>
      ) : null}

      {error ? (error instanceof Error && error.message === 'amount' ? <T variant="small" style={{ color: c.danger }}>{t('pro.common.amountInvalid')}</T> : <ErrorText error={error} />) : null}

      {performing && data.status === 'ARRIVED' ? (
        <Button title={t('case.noShow.button')} variant="secondary" onPress={() => router.push({ pathname: '/order/no-show', params: { id } })} />
      ) : null}
      <CaseButtons order={data} emergency={cities.data?.find((x) => x.id === data.cityId)?.emergencyNumber ?? null} />

      {!isOwner && isActive ? <T variant="small">{t('pro.team.memberOrderNote')}</T> : null}
      {isOwner && ['ACCEPTED', 'EN_ROUTE', 'ARRIVED'].includes(data.status) ? (
        cancelOpen ? (
          <Card>
            <T variant="h2">{t('pro.order.cancelTitle')}</T>
            <T variant="small">{t('pro.order.cancelWarning')}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {WORKER_CANCEL_REASONS.map((r) => (
                <Chip key={r} label={t(`cancel.worker.${r}`)} selected={reason === r} onPress={() => setReason(r)} />
              ))}
            </View>
            <Button
              title={t('pro.order.cancelConfirm')}
              variant="danger"
              disabled={!reason}
              loading={busy === 'cancel'}
              onPress={() =>
                void run('cancel', async () => {
                  await api.orders.cancel(id, reason ?? 'other');
                  router.replace('/(tabs)');
                })
              }
            />
            <Button title={t('pro.common.back')} variant="ghost" onPress={() => setCancelOpen(false)} />
          </Card>
        ) : (
          <Button title={t('pro.order.cancel')} variant="ghost" onPress={() => setCancelOpen(true)} />
        )
      ) : null}
    </Screen>
  );
}
