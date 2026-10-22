import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import type { IneligibleReason } from '../../src/api/types';
import { money } from '../../src/format';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../src/api';
import { isTeamMember, useSession } from '../../src/session/SessionProvider';
import { MemberHome } from '../../src/team/MemberHome';
import { Banner, Button, Card, ErrorText, Screen, T } from '../../src/ui/components';
import { radius, space, useColors } from '../../src/ui/theme';
import { useWork } from '../../src/work/WorkProvider';

/** Главный экран: участник команды видит назначенные заказы, мастер — линию, причины и активные заказы. */
export default function WorkScreen() {
  const { me } = useSession();
  return isTeamMember(me) ? <MemberHome /> : <OwnerWork />;
}

/** Онлайн/офлайн, почему заказы не приходят (с кнопкой исправить), активные заказы (у команды их может быть несколько). */
function OwnerWork() {
  const { t } = useTranslation();
  const c = useColors();
  const { me } = useSession();
  const { eligibility, goOnline, goOffline, permission, refresh, loading } = useWork();
  const team = me?.team?.mode === 'owner';
  // заказы команды, которые сейчас ведут участники (свой заказ показан отдельной карточкой)
  const teamOrders = useQuery({
    queryKey: ['orders', 'team-active', eligibility?.activeOrderIds.join(',') ?? ''],
    queryFn: api.orders.list,
    enabled: team && (eligibility?.activeOrderIds.length ?? 0) > 0,
  });
  const delegated = (teamOrders.data ?? []).filter((o) => (eligibility?.activeOrderIds ?? []).includes(o.id) && o.id !== eligibility?.activeOrderId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const online = eligibility?.isOnline ?? false;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      await (online ? goOffline() : goOnline());
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const action = (reason: IneligibleReason): { title: string; onPress: () => void } | null => {
    switch (reason) {
      case 'balance':
      case 'debt':
        return { title: t('pro.work.topUp'), onPress: () => router.push('/topup') };
      case 'kyc':
        return { title: t('pro.work.uploadDocuments'), onPress: () => router.push('/documents') };
      case 'no_categories':
      case 'no_cities':
        return { title: t('pro.work.editProfile'), onPress: () => router.push({ pathname: '/onboarding', params: { mode: 'edit' } }) };
      case 'active_order':
        return eligibility?.activeOrderId ? { title: t('pro.work.openOrder'), onPress: () => router.push(`/order/${eligibility.activeOrderId}`) } : null;
      default:
        return null;
    }
  };

  const reasons = (eligibility?.reasons ?? []).filter((r) => r !== 'offline');

  return (
    <Screen refreshing={loading} onRefresh={() => void refresh()}>
      <T variant="title">{t('pro.work.hello', { name: me?.firstName ?? '' })}</T>

      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: online, busy }}
        disabled={busy}
        onPress={() => void toggle()}
        style={[styles.toggle, { backgroundColor: online ? c.online : c.surface, borderColor: online ? c.online : c.border, opacity: busy ? 0.6 : 1 }]}
      >
        <View style={[styles.dot, { backgroundColor: online ? '#FFFFFF' : c.offline }]} />
        <View style={{ flex: 1 }}>
          <T variant="h2" style={{ color: online ? '#FFFFFF' : c.text }}>{online ? t('pro.work.online') : t('pro.work.offline')}</T>
          <T variant="small" style={{ color: online ? '#F0FFF8' : c.textMuted }}>{online ? t('pro.work.onlineHint') : t('pro.work.offlineHint')}</T>
        </View>
      </Pressable>
      <ErrorText error={error} />

      {permission === 'denied' ? (
        <Card>
          <Banner tone="danger" text={t('pro.work.locationDenied')} />
          <Button title={t('pro.work.openSettings')} variant="secondary" onPress={() => void Linking.openSettings()} />
        </Card>
      ) : null}
      {permission === 'foreground_only' ? <Banner tone="warning" text={t('pro.work.backgroundDenied')} /> : null}

      {eligibility?.activeOrderId ? (
        <Card onPress={() => router.push(`/order/${eligibility.activeOrderId}`)}>
          <T variant="h2">{t('pro.work.activeOrder')}</T>
          <T variant="muted">{t('pro.work.activeOrderHint')}</T>
        </Card>
      ) : null}

      {delegated.length > 0 ? (
        <Card>
          <T variant="h2">{t('pro.team.teamOrders', { count: delegated.length, capacity: eligibility?.capacity ?? 1 })}</T>
          {delegated.map((o) => (
            <Button key={o.id} title={`${t('pro.order.number', { number: o.number })} · ${t(`order.status.${o.status}`)}`} variant="secondary" onPress={() => router.push(`/order/${o.id}`)} />
          ))}
        </Card>
      ) : null}

      {reasons.length > 0 ? (
        <Card>
          <T variant="h2">{t('pro.work.whyNoOrders')}</T>
          {reasons.map((r) => {
            const a = action(r);
            return (
              <View key={r} style={{ gap: space.sm, marginTop: space.sm }}>
                <Banner tone={r === 'blocked' || r === 'debt' ? 'danger' : 'warning'} text={t(`worker.ineligible.${r}`)} />
                {a ? <Button title={a.title} variant="secondary" onPress={a.onPress} /> : null}
              </View>
            );
          })}
        </Card>
      ) : online && !eligibility?.activeOrderId ? (
        <Card>
          <T variant="h2">{t('pro.work.waiting')}</T>
          <T variant="muted">{t('pro.work.waitingHint')}</T>
        </Card>
      ) : null}

      {eligibility ? (
        <Card onPress={() => router.push('/(tabs)/wallet')}>
          <T variant="small">{t('pro.work.accessBalance')}</T>
          <T variant="money">{money(eligibility.accessBalanceCents, eligibility.currency)}</T>
          <T variant="small">{t('pro.work.threshold', { amount: money(eligibility.thresholdCents, eligibility.currency) })}</T>
          {eligibility.debtCents > 0 ? (
            <T variant="small" style={{ color: c.danger }}>{t('pro.work.debt', { amount: money(eligibility.debtCents, eligibility.currency) })}</T>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.lg, padding: space.xl, borderRadius: radius.lg, borderWidth: 2 },
  dot: { width: 18, height: 18, borderRadius: 9 },
});
