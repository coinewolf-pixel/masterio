import { useQuery } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { api, client } from '../../src/api';

interface BonusAwardItem {
  period: string;
  currency: string;
  ordersCount: number;
  commissionPaidCents: number;
  finalCents: number;
  expiresAt: string;
}
import { date, localized, money, monthTitle, shiftMonth, thisMonth } from '../../src/format';
import { Button, Card, ErrorText, Loading, Row, Screen, T } from '../../src/ui/components';
import { space, useColors } from '../../src/ui/theme';

/** История и заработок за месяц (раздел 21.5): сводка, сравнение с прошлым месяцем, прогресс бонуса, экспорт CSV. */
export default function HistoryScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const [month, setMonth] = useState(thisMonth());
  const [exportError, setExportError] = useState<unknown>(null);
  const [exporting, setExporting] = useState(false);
  const stats = useQuery({ queryKey: ['stats', month], queryFn: () => api.worker.stats(month) });
  const orders = useQuery({ queryKey: ['history', month], queryFn: () => api.worker.history(month) });
  const awards = useQuery({ queryKey: ['bonusAwards'], queryFn: () => client.request<BonusAwardItem[]>('GET', '/worker/bonuses') });

  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const csv = await api.worker.exportCsv(month);
      const path = `${FileSystem.cacheDirectory ?? ''}masterio-${month}.csv`;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: t('pro.history.export') });
    } catch (e) {
      setExportError(e);
    } finally {
      setExporting(false);
    }
  };

  const s = stats.data?.current;
  const p = stats.data?.previous;
  const currency = s?.currency ?? orders.data?.[0]?.currency ?? 'EUR';
  const delta = s && p ? s.netCents - p.netCents : 0;

  return (
    <Screen refreshing={stats.isRefetching} onRefresh={() => void Promise.all([stats.refetch(), orders.refetch()])}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Button title="‹" variant="secondary" onPress={() => setMonth((m) => shiftMonth(m, -1))} />
        <T variant="h2">{monthTitle(month)}</T>
        <Button title="›" variant="secondary" disabled={month >= thisMonth()} onPress={() => setMonth((m) => shiftMonth(m, 1))} />
      </View>

      {stats.isLoading ? <Loading /> : null}
      {s ? (
        <Card>
          <Row label={t('pro.history.orders')} value={String(s.ordersCount)} />
          <Row label={t('pro.history.gross')} value={money(s.grossCents, currency)} />
          <Row label={t('pro.history.commission')} value={money(s.commissionCents, currency)} />
          <Row label={t('pro.history.bonusUsed')} value={money(s.bonusUsedCents, currency)} />
          <Row label={t('pro.history.net')} value={money(s.netCents, currency)} strong />
          <Row label={t('pro.history.rating')} value={s.avgRating === null ? '—' : s.avgRating.toFixed(2)} />
          <Row label={t('pro.history.cancelRate')} value={`${(s.cancelRateBp / 100).toFixed(1)}%`} />
          {p ? (
            <T variant="small" style={{ color: delta >= 0 ? c.success : c.danger }}>
              {t('pro.history.vsPrevious', { amount: `${delta >= 0 ? '+' : '−'}${money(Math.abs(delta), currency)}` })}
            </T>
          ) : null}
        </Card>
      ) : null}

      {stats.data?.bonus ? (
        <Card>
          <T variant="h2">{t('pro.history.bonusTitle')}</T>
          <T variant="muted">
            {stats.data.bonus.currentTier
              ? t('pro.history.currentTier', { tier: t(`pro.bonus.tier.${stats.data.bonus.currentTier.name}`, { defaultValue: stats.data.bonus.currentTier.name }), percent: stats.data.bonus.currentTier.percentBp / 100 })
              : t('pro.history.noTier')}
          </T>
          {stats.data.bonus.nextTier ? (
            <T variant="muted">
              {t('pro.history.toNextTier', {
                count: stats.data.bonus.ordersToNext,
                tier: t(`pro.bonus.tier.${stats.data.bonus.nextTier.name}`, { defaultValue: stats.data.bonus.nextTier.name }),
                percent: stats.data.bonus.nextTier.percentBp / 100,
              })}
            </T>
          ) : null}
          <T variant="small">
            {t('pro.history.bonusConditions', {
              rating: stats.data.bonus.conditions.minRating,
              cancel: stats.data.bonus.conditions.maxCancelRatePercent,
            })}
          </T>
          <T variant="small">{t('pro.history.bonusFormula')}</T>
        </Card>
      ) : null}

      {(awards.data ?? []).length > 0 ? (
        <Card>
          <T variant="h2">{t('case.bonus.awards')}</T>
          {(awards.data ?? []).map((a) => (
            <View key={a.period} style={{ gap: 2 }}>
              <Row label={monthTitle(a.period)} value={money(a.finalCents, a.currency)} strong />
              <T variant="small">{t('case.bonus.awardLine', { orders: a.ordersCount, commission: money(a.commissionPaidCents, a.currency), date: date(a.expiresAt) })}</T>
            </View>
          ))}
          <T variant="small">{t('case.bonus.note')}</T>
        </Card>
      ) : null}

      <Button title={t('pro.history.export')} variant="secondary" loading={exporting} onPress={() => void exportCsv()} />
      <ErrorText error={exportError} />

      {(orders.data ?? []).length === 0 && !orders.isLoading ? <T variant="muted" center>{t('pro.history.empty')}</T> : null}
      {(orders.data ?? []).map((o) => (
        <Card key={o.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
            <T variant="body" style={{ fontWeight: '600', flex: 1 }}>{localized(o.category.names, o.category.code)}</T>
            <T variant="small">{date(o.completedAt)}</T>
          </View>
          <T variant="small">
            {t('pro.order.number', { number: o.number })} · {o.paymentMethod === 'CASH' ? t('pro.offer.cash') : t('pro.offer.card')}
            {o.clientUnconfirmed ? ` · ${t('order.client_unconfirmed')}` : ''}
          </T>
          <Row label={t('pro.order.amount')} value={money(o.amountCents, o.currency)} />
          <Row label={t('pro.order.commission')} value={money(o.commissionCents, o.currency)} />
          {o.bonusDiscountCents > 0 ? <Row label={t('pro.order.bonusDiscount')} value={`−${money(o.bonusDiscountCents, o.currency)}`} /> : null}
          <Row label={t('pro.history.netOrder')} value={money(o.netCents, o.currency)} strong />
        </Card>
      ))}
    </Screen>
  );
}
