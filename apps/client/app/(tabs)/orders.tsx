import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { api } from '../../src/api';
import { useDraft } from '../../src/draft/NewOrderProvider';
import { dateTime, localized, money, monthTitle, shiftMonth, thisMonth } from '../../src/format';
import { Button, Card, ErrorText, Loading, Row, Screen, T } from '../../src/ui/components';
import { space, useColors } from '../../src/ui/theme';

/** Мои заказы за месяц: сколько заказов и сколько потрачено, список с исполнителем и суммой, повтор заказа. */
export default function OrdersScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { reset } = useDraft();
  const [month, setMonth] = useState(thisMonth());
  const history = useQuery({ queryKey: ['client-history', month], queryFn: () => api.orders.history(month) });

  const summary = history.data?.summary;
  const currency = summary?.currency ?? history.data?.items[0]?.currency ?? 'EUR';

  return (
    <Screen refreshing={history.isRefetching} onRefresh={() => void history.refetch()}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Button title="‹" variant="secondary" onPress={() => setMonth((m) => shiftMonth(m, -1))} />
        <T variant="h2">{monthTitle(month)}</T>
        <Button title="›" variant="secondary" disabled={month >= thisMonth()} onPress={() => setMonth((m) => shiftMonth(m, 1))} />
      </View>

      {history.isLoading ? <Loading /> : null}
      <ErrorText error={history.error} />

      {summary ? (
        <Card>
          <Row label={t('client.orders.count')} value={String(summary.ordersCount)} />
          <Row label={t('client.orders.spent')} value={money(summary.spentCents, currency)} strong />
        </Card>
      ) : null}

      {history.data && history.data.items.length === 0 ? <T variant="muted" center>{t('client.orders.empty')}</T> : null}

      {(history.data?.items ?? []).map((o) => (
        <Card key={o.id} onPress={() => router.push(`/order/${o.id}`)}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
            <T variant="h2" style={{ flex: 1 }}>{localized(o.category.names)}</T>
            <T variant="small">#{o.number}</T>
          </View>
          <T variant="small">{dateTime(o.createdAt)}</T>
          <T variant="muted">{o.addressFormatted}</T>
          <T style={{ color: o.status.startsWith('CANCELLED') ? c.danger : c.primary }}>{t(`order.status.${o.status}`)}</T>
          {o.workerName ? <Row label={t('client.orders.worker')} value={o.workerName} /> : null}
          {o.paidCents > 0 ? <Row label={t('client.orders.paid')} value={money(o.paidCents, o.currency)} strong /> : null}
          <Button
            title={t('client.orders.repeat')}
            variant="ghost"
            onPress={() => {
              reset(o.category.id, { description: o.description, paymentMethod: o.paymentMethod });
              router.push('/new-order');
            }}
          />
        </Card>
      ))}
    </Screen>
  );
}
