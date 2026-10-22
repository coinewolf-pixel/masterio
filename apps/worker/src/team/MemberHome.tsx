import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';
import { api } from '../api';
import type { OrderStatus } from '../api/types';
import { localized } from '../format';
import { useSession } from '../session/SessionProvider';
import { Banner, Button, Card, Screen, T } from '../ui/components';
import { useWork } from '../work/WorkProvider';

const ACTIVE: OrderStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];

/** Главный экран участника команды: назначенные руководителем заказы, проверка документов, геопозиция. */
export function MemberHome() {
  const { t } = useTranslation();
  const { me } = useSession();
  const { eligibility, permission, refresh, loading } = useWork();
  const orders = useQuery({ queryKey: ['orders'], queryFn: api.orders.list, refetchInterval: 30_000 });
  const kycOk = me?.worker?.kycStatus === 'VERIFIED';
  const list = orders.data ?? [];
  const active = list.filter((o) => ACTIVE.includes(o.status));
  const past = list.filter((o) => !ACTIVE.includes(o.status)).slice(0, 10);

  return (
    <Screen refreshing={loading || orders.isRefetching} onRefresh={() => void Promise.all([refresh(), orders.refetch()])}>
      <T variant="title">{t('pro.work.hello', { name: me?.firstName ?? '' })}</T>
      <T variant="muted">{t('pro.team.memberHome', { team: me?.team?.name ?? '', role: t(`pro.team.role.${me?.team?.role ?? 'HELPER'}`) })}</T>

      {!kycOk ? (
        <Card>
          <Banner tone="warning" text={t('pro.team.memberKyc')} />
          <Button title={t('pro.work.uploadDocuments')} variant="secondary" onPress={() => router.push('/documents')} />
        </Card>
      ) : null}
      {permission === 'denied' ? (
        <Card>
          <Banner tone="danger" text={t('pro.work.locationDenied')} />
          <Button title={t('pro.work.openSettings')} variant="secondary" onPress={() => void Linking.openSettings()} />
        </Card>
      ) : null}
      {permission === 'foreground_only' ? <Banner tone="warning" text={t('pro.work.backgroundDenied')} /> : null}

      {eligibility?.activeOrderId ? (
        <Card onPress={() => router.push(`/order/${eligibility.activeOrderId ?? ''}`)}>
          <T variant="h2">{t('pro.work.activeOrder')}</T>
          <T variant="muted">{t('pro.team.memberActiveHint')}</T>
        </Card>
      ) : (
        <Card>
          <T variant="h2">{t('pro.team.noAssignments')}</T>
          <T variant="muted">{t('pro.team.noAssignmentsHint')}</T>
        </Card>
      )}

      {active.filter((o) => o.id !== eligibility?.activeOrderId).map((o) => (
        <Card key={o.id} onPress={() => router.push(`/order/${o.id}`)}>
          <T variant="body" style={{ fontWeight: '600' }}>{localized(o.category.names, o.category.code)}</T>
          <T variant="small">{`${t('pro.order.number', { number: o.number })} · ${t(`order.status.${o.status}`)}`}</T>
        </Card>
      ))}

      {past.length > 0 ? <T variant="h2">{t('pro.team.pastAssignments')}</T> : null}
      {past.map((o) => (
        <Card key={o.id} onPress={() => router.push(`/order/${o.id}`)}>
          <T variant="body">{localized(o.category.names, o.category.code)}</T>
          <T variant="small">{`${t('pro.order.number', { number: o.number })} · ${t(`order.status.${o.status}`)}`}</T>
        </Card>
      ))}
    </Screen>
  );
}
