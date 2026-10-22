import { getLocales } from 'expo-localization';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../src/api';
import { deviceId } from '../../src/device';
import { currentLocale } from '../../src/i18n/locale';
import { useSession } from '../../src/session/SessionProvider';
import { Button, ErrorText, Field, Screen, T } from '../../src/ui/components';

const RESEND_SECONDS = 60;

export default function CodeScreen() {
  const { t } = useTranslation();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const { signIn } = useSession();
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(RESEND_SECONDS);

  useEffect(() => {
    const timer = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1_000);
    return () => clearInterval(timer);
  }, []);

  const verify = async (value: string) => {
    if (!phone || value.length < 4) return;
    setLoading(true);
    setError(null);
    try {
      const country = (getLocales()[0]?.regionCode ?? 'AM').toUpperCase();
      const res = await api.auth.verifyOtp(phone, value, await deviceId(), currentLocale(), country);
      await signIn({ accessToken: res.accessToken, refreshToken: res.refreshToken });
      router.replace('/');
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (!phone) return;
    setError(null);
    try {
      await api.auth.requestOtp(phone, await deviceId());
      setResendIn(RESEND_SECONDS);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <Screen>
      <T variant="muted">{t('client.auth.codeSent', { phone: phone ?? '' })}</T>
      <Field
        label={t('client.auth.codeLabel')}
        value={code}
        onChangeText={(v) => {
          const digits = v.replace(/\D/g, '').slice(0, 6);
          setCode(digits);
          if (digits.length === 6) void verify(digits);
        }}
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        maxLength={6}
        autoFocus
      />
      <ErrorText error={error} />
      <Button title={t('client.auth.verify')} onPress={() => void verify(code)} loading={loading} disabled={code.length < 4} />
      <Button
        title={resendIn > 0 ? t('client.auth.resendIn', { seconds: resendIn }) : t('client.auth.resend')}
        variant="ghost"
        disabled={resendIn > 0}
        onPress={() => void resend()}
      />
    </Screen>
  );
}
