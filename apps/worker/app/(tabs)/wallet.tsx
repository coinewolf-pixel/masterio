import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { api } from '../../src/api';
import { date, dateTime, money } from '../../src/format';
import { Banner, Button, Card, Loading, Row, Screen, T } from '../../src/ui/components';
import { space, useColors } from '../../src/ui/theme';

/**
 * Кошелёк (раздел 21.4): карманы отдельными строками. Пополнение, бонус и приветственный кредит не выводятся —
 * они идут только на порог доступа и комиссию платформы. Заработок показывается, когда включены карточные оплаты.
 */
export default function WalletScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: api.wallet.get });
  const tx = useQuery({ queryKey: ['wallet', 'tx'], queryFn: api.wallet.transactions });

  if (wallet.isLoading || !wallet.data) return <Loading />;
  const w = wallet.data;
  const promoExpiry = w.promoLots[0]?.expiresAt ?? null;
  const bonusExpiry = w.bonusLots[0]?.expiresAt ?? null;
  const daysLeft = bonusExpiry ? Math.max(0, Math.ceil((new Date(bonusExpiry).getTime() - Date.now()) / 86_400_000)) : null;

  return (
    <Screen refreshing={wallet.isRefetching} onRefresh={() => void Promise.all([wallet.refetch(), tx.refetch()])}>
      <Card>
        <T variant="small">{t('pro.wallet.access')}</T>
        <T variant="money">{money(w.topupCents + w.promoCents, w.currency)}</T>
      </Card>

      <Card>
        <Row label={t('wallet.pocket.topup')} value={money(w.topupCents, w.currency)} />
        <Row label={t('wallet.pocket.promo')} value={money(w.promoCents, w.currency)} />
        {w.promoCents > 0 && promoExpiry ? <T variant="small">{t('wallet.promo_valid_until', { amount: money(w.promoCents, w.currency), date: date(promoExpiry) })}</T> : null}
        <Row label={t('wallet.pocket.bonus')} value={money(w.bonusCents, w.currency)} />
        {w.bonusCents > 0 && bonusExpiry ? (
          <T variant="small" style={{ color: daysLeft !== null && daysLeft <= 3 ? c.warning : c.textMuted }}>
            {t('wallet.bonus_expires', { amount: money(w.bonusCents, w.currency), date: date(bonusExpiry) })} · {t('pro.wallet.daysLeft', { count: daysLeft ?? 0 })}
          </T>
        ) : null}
        {w.showEarnings ? <Row label={t('wallet.pocket.earnings')} value={money(w.earningsCents, w.currency)} /> : null}
        {w.debtCents > 0 ? <Row label={t('wallet.pocket.debt')} value={`−${money(w.debtCents, w.currency)}`} strong /> : null}
        <T variant="small">{t('wallet.not_withdrawable')}</T>
      </Card>

      {w.debtCents > 0 ? <Banner tone="danger" text={t('pro.wallet.debtHint')} /> : null}
      {w.topupEnabled ? <Button title={t('pro.wallet.topUp')} onPress={() => router.push('/topup')} /> : null}

      <Card>
        <T variant="h2">{t('pro.wallet.howItWorks')}</T>
        <T variant="muted">{t('pro.wallet.order')}</T>
      </Card>

      <T variant="h2">{t('pro.wallet.history')}</T>
      {(tx.data?.items ?? []).length === 0 ? <T variant="muted">{t('pro.wallet.noTransactions')}</T> : null}
      {(tx.data?.items ?? []).map((item) => (
        <View key={item.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm, paddingVertical: space.xs }}>
          <View style={{ flex: 1 }}>
            <T>{t(`pro.wallet.kind.${item.kind}`, { defaultValue: item.kind })}</T>
            <T variant="small">{t(`wallet.pocket.${pocketKey(item.pocket)}`)} · {dateTime(item.createdAt)}</T>
          </View>
          <T style={{ fontWeight: '600', color: item.amountCents >= 0 ? c.success : c.text }}>
            {item.amountCents >= 0 ? '+' : '−'}
            {money(Math.abs(item.amountCents), item.currency)}
          </T>
        </View>
      ))}
    </Screen>
  );
}

function pocketKey(type: string): string {
  switch (type) {
    case 'WORKER_TOPUP':
      return 'topup';
    case 'WORKER_PROMO':
      return 'promo';
    case 'WORKER_BONUS':
      return 'bonus';
    case 'WORKER_EARNINGS':
      return 'earnings';
    default:
      return 'debt';
  }
}
