import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useStripe } from '@stripe/stripe-react-native';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { BRAND } from '@masterio/shared';
import { api } from '../src/api';
import { cases } from '../src/cases/api';
import { STRIPE_PUBLISHABLE_KEY } from '../src/config';
import { money, parseAmount } from '../src/format';
import { Banner, Button, Chip, ErrorText, Field, Loading, Screen, T } from '../src/ui/components';
import { space } from '../src/ui/theme';

const PRESETS = [2_000, 5_000, 10_000];

function TopupForm() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: api.wallet.get });
  const consents = useQuery({ queryKey: ['legal', 'topup'], queryFn: () => cases.required('topup') });
  const [amount, setAmount] = useState('50');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // один ключ идемпотентности на попытку: повторное нажатие не создаст второй платёж
  const attemptKey = useMemo(() => Crypto.randomUUID(), []);

  if (!wallet.data) return <Loading />;
  const currency = wallet.data.currency;
  const cents = parseAmount(amount);

  const pay = async () => {
    if (cents === null || cents <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const intent = await api.wallet.topup(cents, `${attemptKey}-${cents}`);
      const init = await initPaymentSheet({
        paymentIntentClientSecret: intent.clientSecret,
        merchantDisplayName: BRAND.platform,
        allowsDelayedPaymentMethods: false,
        returnURL: `${BRAND.workerApp.scheme}://topup`,
      });
      if (init.error) throw new Error(init.error.message);
      const result = await presentPaymentSheet();
      if (result.error) {
        if (result.error.code !== 'Canceled') throw new Error(result.error.message);
        return;
      }
      // баланс зачисляется после подтверждения платежа Stripe (webhook); обновляем экран
      setDone(true);
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['wallet'] }), 2_000);
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['eligibility'] }), 2_000);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Screen>
        <Banner tone="success" text={t('pro.topup.success')} />
        <Button title={t('pro.common.done')} onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <T variant="muted">{t('pro.topup.hint')}</T>
      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
        {PRESETS.map((p) => (
          <Chip key={p} label={money(p, currency)} selected={cents === p} onPress={() => setAmount((p / 100).toFixed(2))} />
        ))}
      </View>
      <Field label={t('pro.topup.amount', { currency })} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Banner tone="info" text={t('pro.topup.terms')} />
      {(consents.data?.required.length ?? 0) > 0 ? (
        <>
          <Banner tone="warning" text={t('case.legal.topupNeeded')} />
          <Button title={t('case.legal.readAccept')} variant="secondary" onPress={() => router.push({ pathname: '/legal', params: { context: 'topup' } })} />
        </>
      ) : null}
      {error instanceof Error && !(error as { code?: string }).code ? <T variant="small">{error.message}</T> : <ErrorText error={error} />}
      <Button title={t('pro.topup.pay', { amount: cents ? money(cents, currency) : '' })} onPress={() => void pay()} loading={busy} disabled={!cents || (consents.data?.required.length ?? 0) > 0} />
    </Screen>
  );
}

/** Пополнение баланса картой через Stripe: предоплата услуг платформы, не выводится (раздел 21.8). */
export default function TopupScreen() {
  const { t } = useTranslation();
  if (!STRIPE_PUBLISHABLE_KEY) {
    return (
      <Screen>
        <Banner tone="warning" text={t('errors.FEATURE_DISABLED')} />
      </Screen>
    );
  }
  return <TopupForm />;
}
