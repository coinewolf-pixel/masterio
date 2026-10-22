import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Image, Linking, Pressable, StyleSheet, View } from 'react-native';
import { CLIENT_CANCEL_REASONS, RT_EVENTS, type ClientCancelReason } from '@masterio/shared';
import { api } from '../../src/api';
import type { OrderDetails, OrderStatus } from '../../src/api/types';
import { dateTime, distance, localized, money, parseAmount } from '../../src/format';
import { LiveMap } from '../../src/order/LiveMap';
import { useLiveWorker } from '../../src/order/useLiveWorker';
import { useRealtimeEvent } from '../../src/realtime/RealtimeProvider';
import { Banner, Button, Card, Chip, ErrorText, Field, Loading, Row, Screen, T } from '../../src/ui/components';
import { accent, radius, space, useColors } from '../../src/ui/theme';

const TRACKED: OrderStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED'];
const WITH_PERFORMER: OrderStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED_BY_WORKER'];
const CANCELLABLE: OrderStatus[] = ['SEARCHING', 'NO_WORKERS', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED'];
const FINISHED: OrderStatus[] = ['CONFIRMED', 'AUTO_CONFIRMED', 'CLOSED'];

/** Карточка заказа клиента: поиск мастера, живая карта, смета, подтверждение оплаты, отзыв, отмена. */
export default function OrderScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const order = useQuery({ queryKey: ['order', id], queryFn: () => api.orders.get(id), refetchInterval: 20_000 });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.catalog.categories(), staleTime: 3_600_000 });
  const config = useQuery({
    queryKey: ['app-config', order.data?.cityId ?? null],
    queryFn: () => api.catalog.config(order.data?.cityId),
    enabled: Boolean(order.data),
    staleTime: 300_000,
  });
  const data = order.data;
  const live = useLiveWorker(id, Boolean(data && TRACKED.includes(data.status)));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const refetch = () => {
    void queryClient.invalidateQueries({ queryKey: ['order', id] });
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
  };
  useRealtimeEvent<{ orderId: string }>(RT_EVENTS.orderStatus, (p) => p.orderId === id && refetch());
  useRealtimeEvent<{ orderId: string }>(RT_EVENTS.orderEstimate, (p) => p.orderId === id && refetch());
  useRealtimeEvent<{ orderId: string }>(RT_EVENTS.orderAssignment, (p) => p.orderId === id && refetch());
  useRealtimeEvent<{ orderId: string }>(RT_EVENTS.dispatchNoWorkers, (p) => p.orderId === id && refetch());

  if (order.isLoading || !data) return order.error ? <Screen><ErrorText error={order.error} /></Screen> : <Loading />;

  const category = categories.data?.flatMap((g) => g.categories).find((x) => x.id === data.categoryId);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const emergency = config.data?.emergencyNumber;

  return (
    <Screen refreshing={order.isRefetching} onRefresh={() => void order.refetch()}>
      <T variant="small">{t('client.order.number', { number: data.number })}</T>
      <T variant="title">{localized(category?.names)}</T>
      <Banner tone={data.status.startsWith('CANCELLED') ? 'danger' : data.status === 'DISPUTED' ? 'warning' : FINISHED.includes(data.status) ? 'success' : 'info'} text={t(`order.status.${data.status}`)} />

      {data.status === 'SEARCHING' ? <Searching radiusM={data.searchRadiusM} /> : null}
      {data.status === 'NO_WORKERS' ? (
        <NoWorkers
          order={data}
          maxRadiusM={config.data?.maxSearchRadiusM ?? null}
          busy={busy}
          onExpand={(r) => void run('expand', () => api.orders.restartSearch(id, r))}
          onWait={() => void run('wait', () => api.orders.restartSearch(id))}
        />
      ) : null}

      {data.pendingPerformerChange ? <PerformerChangeCard order={data} busy={busy} run={run} /> : null}
      {data.performer && WITH_PERFORMER.includes(data.status) ? <PerformerCard order={data} /> : null}

      {TRACKED.includes(data.status) && data.location ? <LiveMap address={data.location} live={live} /> : null}
      {data.status === 'ARRIVED' ? <Banner tone="success" text={t('client.order.arrived')} /> : null}
      {data.status === 'IN_PROGRESS' ? <Banner tone="info" text={t('client.order.inProgress')} /> : null}

      <EstimateCard order={data} busy={busy} run={run} />
      {data.status === 'COMPLETED_BY_WORKER' ? <ConfirmPayment order={data} busy={busy} run={run} /> : null}
      {data.status === 'DISPUTED' ? <Banner tone="warning" text={t('client.order.disputed')} /> : null}
      {FINISHED.includes(data.status) && data.workerId && !data.reviewedByMe ? <ReviewCard order={data} busy={busy} run={run} /> : null}
      {FINISHED.includes(data.status) && data.reviewedByMe ? <T variant="small">{t('client.review.thanks')}</T> : null}
      {FINISHED.includes(data.status) && data.workerId ? <BlockWorker workerId={data.workerId} /> : null}

      <Card>
        <T variant="small">{t('client.order.address')}</T>
        <T variant="h2">{data.addressFormatted}</T>
        {data.addressDetails ? <T variant="muted">{data.addressDetails}</T> : null}
        {data.timing === 'SCHEDULED' ? <Row label={t('client.order.scheduled')} value={dateTime(data.scheduledAt)} /> : null}
        <Row label={t('client.order.payment')} value={t(data.paymentMethod === 'CASH' ? 'client.newOrder.cash' : 'client.newOrder.card')} />
        <T>{data.description}</T>
        {data.photos.length > 0 ? (
          <View style={styles.photos}>
            {data.photos.map((p) => (
              <Pressable key={p.id} onPress={() => void Linking.openURL(p.url)} accessibilityRole="imagebutton">
                <Image source={{ uri: p.url }} style={[styles.photo, { borderColor: c.border }]} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </Card>

      <ErrorText error={error} />
      {CANCELLABLE.includes(data.status) ? <CancelBlock order={data} onDone={refetch} /> : null}
      {['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'].includes(data.status) ? <MismatchBlock order={data} onDone={refetch} /> : null}
      <CaseButtons order={data} emergency={emergency ?? null} />
      {emergency && WITH_PERFORMER.includes(data.status) ? (
        <Button title={t('client.order.emergency', { number: emergency })} variant="ghost" onPress={() => void Linking.openURL(`tel:${emergency}`)} />
      ) : null}
      <T variant="small" center>{t('client.order.platformNote')}</T>
    </Screen>
  );
}

/** Спор и несчастный случай (разделы 18.5, 19.4): доступны, когда у заказа есть исполнитель. */
const DISPUTABLE: OrderStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED_BY_WORKER', 'CONFIRMED', 'AUTO_CONFIRMED', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_WORKER', 'DISPUTED', 'CLOSED'];
const INCIDENT: OrderStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED_BY_WORKER', 'CONFIRMED', 'AUTO_CONFIRMED', 'DISPUTED'];

function CaseButtons({ order, emergency }: { order: OrderDetails; emergency: string | null }) {
  const { t } = useTranslation();
  const open = order.dispute && !['SETTLED', 'UNRESOLVED_REFERRED', 'CLOSED'].includes(order.dispute.status);
  return (
    <>
      {order.dispute ? (
        <Button
          title={t('case.dispute.view', { status: t(`case.status.${order.dispute.status}`) })}
          variant={open ? 'primary' : 'secondary'}
          onPress={() => router.push({ pathname: '/dispute/[id]', params: { id: order.dispute?.id ?? '' } })}
        />
      ) : null}
      {order.workerId && DISPUTABLE.includes(order.status) && !open ? (
        <Button title={t('case.dispute.open')} variant="secondary" onPress={() => router.push({ pathname: '/dispute/new', params: { orderId: order.id } })} />
      ) : null}
      {order.workerId && INCIDENT.includes(order.status) ? (
        <Button title={t('case.incident.report')} variant="ghost" onPress={() => router.push({ pathname: '/incident', params: { orderId: order.id, emergency: emergency ?? '' } })} />
      ) : null}
    </>
  );
}

function Searching({ radiusM }: { radiusM: number }) {
  const { t } = useTranslation();
  return (
    <Card>
      <Loading />
      <T variant="h2" center>{t('client.order.searchingTitle')}</T>
      <T variant="muted" center>{t('client.order.searchingText', { distance: distance(radiusM, { m: t('units.m'), km: t('units.km') }) })}</T>
    </Card>
  );
}

function NoWorkers({ order, maxRadiusM, busy, onExpand, onWait }: { order: OrderDetails; maxRadiusM: number | null; busy: string | null; onExpand: (r: number) => void; onWait: () => void }) {
  const { t } = useTranslation();
  const units = { m: t('units.m'), km: t('units.km') };
  const canExpand = maxRadiusM !== null && maxRadiusM > order.searchRadiusM;
  return (
    <Card>
      <T variant="h2">{t('client.order.noWorkersTitle')}</T>
      <T variant="muted">{t('client.order.noWorkersText')}</T>
      {canExpand ? (
        <Button title={t('client.order.expandRadius', { distance: distance(maxRadiusM, units) })} loading={busy === 'expand'} onPress={() => onExpand(maxRadiusM)} />
      ) : null}
      <Button title={t('client.order.searchAgain')} variant="secondary" loading={busy === 'wait'} onPress={onWait} />
      <T variant="small">{t('client.order.noWorkersCancelFree')}</T>
    </Card>
  );
}

function PerformerCard({ order }: { order: OrderDetails }) {
  const { t } = useTranslation();
  const c = useColors();
  const p = order.performer;
  if (!p) return null;
  const phone = order.contacts?.workerPhone ?? null;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={[styles.avatar, { backgroundColor: c.primary }]}>
          <T variant="h2" style={{ color: accent }}>{(p.name ?? '?').slice(0, 1).toUpperCase()}</T>
        </View>
        <View style={{ flex: 1 }}>
          <T variant="h2">{p.name ?? t('client.order.performer')}</T>
          {p.role !== 'MASTER' ? <T variant="small">{t(`case.team.role.${p.role}`, { defaultValue: '' })}</T> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="star" size={14} color={accent} />
            <T variant="small">{p.ratingAvg !== null ? p.ratingAvg.toFixed(2) : t('client.order.newWorker')}</T>
          </View>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Badge ok text={t('client.order.badgeVerified')} />
        {p.badges.licenseVerified ? <Badge ok text={t('client.order.badgeLicense')} /> : null}
        {p.badges.insured ? <Badge ok text={t('client.order.badgeInsured')} /> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {phone ? <Button title={t('client.order.call')} style={{ flex: 1 }} onPress={() => void Linking.openURL(`tel:${phone}`)} /> : null}
        <Button title={t('client.order.chat')} variant="secondary" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/order/chat', params: { id: order.id } })} />
      </View>
    </Card>
  );
}

/** Мастер хочет заменить исполнителя: клиент соглашается или оставляет прежнего (экран 19). */
function PerformerChangeCard({ order, busy, run }: { order: OrderDetails; busy: string | null; run: Run }) {
  const { t } = useTranslation();
  const p = order.pendingPerformerChange;
  if (!p) return null;
  return (
    <Card>
      <T variant="h2">{t('case.team.changeTitle')}</T>
      <T>{t('case.team.changeText', { name: p.name ?? '—', role: t(`case.team.role.${p.role}`, { defaultValue: '' }) })}</T>
      {p.reason ? <T variant="muted">{t('case.team.changeReason', { reason: p.reason })}</T> : null}
      <T variant="small">{t('case.team.changeHint')}</T>
      <Button title={t('case.team.approve')} loading={busy === 'change-yes'} disabled={busy !== null} onPress={() => void run('change-yes', () => api.orders.decidePerformerChange(order.id, true))} />
      <Button title={t('case.team.decline')} variant="secondary" loading={busy === 'change-no'} disabled={busy !== null} onPress={() => void run('change-no', () => api.orders.decidePerformerChange(order.id, false))} />
    </Card>
  );
}

/** «Пришёл другой человек»: событие и автоматический спор (раздел 19.2). */
function MismatchBlock({ order, onDone }: { order: OrderDetails; onDone: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const send = () =>
    Alert.alert(t('case.team.mismatchTitle'), t('case.team.mismatchConfirm'), [
      { text: t('case.common.cancel'), style: 'cancel' },
      {
        text: t('case.team.mismatchSend'),
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          setError(null);
          api.orders
            .performerMismatch(order.id, text.trim() || undefined)
            .then(() => {
              setOpen(false);
              onDone();
            })
            .catch(setError)
            .finally(() => setBusy(false));
        },
      },
    ]);
  if (!open) return <Button title={t('case.team.mismatch')} variant="ghost" onPress={() => setOpen(true)} />;
  return (
    <Card>
      <T variant="h2">{t('case.team.mismatchTitle')}</T>
      <T variant="muted">{t('case.team.mismatchHint', { name: order.performer?.name ?? '—' })}</T>
      <Field label={t('case.team.mismatchDescription')} value={text} onChangeText={setText} multiline maxLength={2_000} />
      <ErrorText error={error} />
      <Button title={t('case.team.mismatchSend')} variant="danger" loading={busy} onPress={send} />
      <Button title={t('case.common.cancel')} variant="ghost" onPress={() => setOpen(false)} />
    </Card>
  );
}

function Badge({ text, ok }: { text: string; ok: boolean }) {
  const c = useColors();
  return (
    <View style={[styles.badge, { borderColor: ok ? c.success : c.border }]}>
      <Ionicons name="checkmark-circle" size={14} color={ok ? c.success : c.textMuted} />
      <T variant="small">{text}</T>
    </View>
  );
}

type Run = (key: string, fn: () => Promise<unknown>) => Promise<void>;

function EstimateCard({ order, busy, run }: { order: OrderDetails; busy: string | null; run: Run }) {
  const { t } = useTranslation();
  const proposed = order.estimates.find((e) => e.status === 'PROPOSED');
  const approved = order.estimates.find((e) => e.status === 'APPROVED');
  const shown = proposed ?? approved;
  if (!shown) return null;
  return (
    <Card>
      <T variant="h2">{proposed ? t('client.estimate.proposed') : t('client.estimate.approved')}</T>
      {shown.items.map((it, i) => (
        <Row key={`${shown.id}-${i}`} label={`${it.title}${it.quantity !== 1 ? ` × ${it.quantity}` : ''}`} value={money(it.totalCents, order.currency)} />
      ))}
      <Row label={t('client.estimate.total')} value={money(shown.totalCents, order.currency)} strong />
      {shown.note ? <T variant="muted">{shown.note}</T> : null}
      {proposed && approved ? <T variant="small">{t('client.estimate.replaces', { amount: money(approved.totalCents, order.currency) })}</T> : null}
      {proposed ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button title={t('client.estimate.approve')} style={{ flex: 1 }} loading={busy === 'approve'} onPress={() => void run('approve', () => api.orders.approveEstimate(order.id, proposed.version))} />
          <Button title={t('client.estimate.reject')} variant="secondary" style={{ flex: 1 }} loading={busy === 'reject'} onPress={() => void run('reject', () => api.orders.rejectEstimate(order.id, proposed.version))} />
        </View>
      ) : null}
      {proposed ? <T variant="small">{t('client.estimate.hint')}</T> : null}
    </Card>
  );
}

function ConfirmPayment({ order, busy, run }: { order: OrderDetails; busy: string | null; run: Run }) {
  const { t } = useTranslation();
  const c = useColors();
  const reported = order.cashReportedByWorkerCents;
  const [amount, setAmount] = useState(reported !== null ? (reported / 100).toFixed(2) : '');
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (reported !== null) setAmount((reported / 100).toFixed(2));
  }, [reported]);

  const confirm = () => {
    const cents = parseAmount(amount);
    if (cents === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const mismatch = reported !== null && cents !== reported;
    Alert.alert(
      t('client.payment.confirmTitle'),
      mismatch ? t('client.payment.mismatchBody', { amount: money(cents, order.currency), reported: money(reported, order.currency) }) : t('client.payment.confirmBody', { amount: money(cents, order.currency) }),
      [
        { text: t('client.common.cancel'), style: 'cancel' },
        { text: t('client.common.confirm'), onPress: () => void run('confirm', () => api.orders.confirmPayment(order.id, cents)) },
      ],
    );
  };

  return (
    <Card>
      <T variant="h2">{t('client.payment.title')}</T>
      {reported !== null ? <Row label={t('client.payment.reported')} value={money(reported, order.currency)} strong /> : null}
      <Field label={t('client.payment.paid', { currency: order.currency })} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      {invalid ? <T variant="small" style={{ color: c.danger }}>{t('client.payment.invalid')}</T> : null}
      <Button title={t('client.payment.confirm')} loading={busy === 'confirm'} onPress={confirm} />
      <T variant="small">{t('client.payment.hint')}</T>
    </Card>
  );
}

function ReviewCard({ order, busy, run }: { order: OrderDetails; busy: string | null; run: Run }) {
  const { t } = useTranslation();
  const c = useColors();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  return (
    <Card>
      <T variant="h2">{t('client.review.title')}</T>
      <View style={{ flexDirection: 'row', gap: space.sm }} accessibilityRole="adjustable" accessibilityValue={{ min: 0, max: 5, now: rating }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => setRating(n)} accessibilityRole="button" accessibilityLabel={t('client.review.stars', { count: n })} hitSlop={6}>
            <Ionicons name={n <= rating ? 'star' : 'star-outline'} size={34} color={n <= rating ? accent : c.textMuted} />
          </Pressable>
        ))}
      </View>
      <Field label={t('client.review.text')} value={text} onChangeText={setText} multiline maxLength={1_000} style={{ minHeight: 80, textAlignVertical: 'top', paddingTop: space.sm }} />
      <Button title={t('client.review.send')} disabled={rating === 0} loading={busy === 'review'} onPress={() => void run('review', () => api.orders.review(order.id, rating, text.trim() || undefined))} />
    </Card>
  );
}

function BlockWorker({ workerId }: { workerId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['blacklist'], queryFn: api.me.blacklist });
  const blocked = (list.data ?? []).some((b) => b.workerId === workerId);
  const [error, setError] = useState<unknown>(null);
  const toggle = () => {
    setError(null);
    (blocked ? api.me.unblock(workerId) : api.me.block(workerId))
      .then(() => queryClient.invalidateQueries({ queryKey: ['blacklist'] }))
      .catch(setError);
  };
  if (list.isLoading) return null;
  return (
    <>
      <Button title={blocked ? t('client.blacklist.unblock') : t('client.blacklist.block')} variant="ghost" onPress={toggle} />
      {blocked ? <T variant="small" center>{t('client.blacklist.blockedHint')}</T> : null}
      <ErrorText error={error} />
    </>
  );
}

function CancelBlock({ order, onDone }: { order: OrderDetails; onDone: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ClientCancelReason | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const preview = useQuery({
    queryKey: ['cancel-preview', order.id, reason, order.status],
    queryFn: () => api.orders.cancelPreview(order.id, reason ?? 'other'),
    enabled: open && reason !== null,
    retry: false,
  });

  if (!open) return <Button title={t('client.cancel.open')} variant="ghost" onPress={() => setOpen(true)} />;

  const fee = preview.data;
  const submit = async () => {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await api.orders.cancel(order.id, reason, comment.trim() || undefined);
      setOpen(false);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <T variant="h2">{t('client.cancel.title')}</T>
      <View style={styles.chips}>
        {CLIENT_CANCEL_REASONS.map((r) => (
          <Chip key={r} label={t(`cancel.client.${r}`)} selected={reason === r} onPress={() => setReason(r)} />
        ))}
      </View>
      {reason === 'other' || reason === 'off_platform_payment' || reason === 'worker_asked_to_cancel' ? (
        <Field label={t('client.cancel.comment')} value={comment} onChangeText={setComment} multiline maxLength={1_000} />
      ) : null}
      {fee ? (
        fee.penaltyCents > 0 ? (
          <Banner tone="warning" text={t('client.cancel.fee', { amount: money(fee.penaltyCents, order.currency) })} />
        ) : (
          <Banner tone="success" text={t('client.cancel.free')} />
        )
      ) : null}
      {reason === 'off_platform_payment' || reason === 'worker_asked_to_cancel' ? <T variant="small">{t('client.cancel.reportHint')}</T> : null}
      <ErrorText error={error ?? preview.error} />
      <Button title={t('client.cancel.confirm')} variant="danger" disabled={!reason || preview.isLoading} loading={busy} onPress={() => void submit()} />
      <Button title={t('client.cancel.keep')} variant="ghost" onPress={() => setOpen(false)} />
    </Card>
  );
}

const styles = StyleSheet.create({
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  photo: { width: 84, height: 84, borderRadius: radius.md, borderWidth: 1 },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
