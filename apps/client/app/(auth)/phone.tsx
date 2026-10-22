import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { BRAND, LOCALES, phoneSchema, type Locale } from '@masterio/shared';
import { api } from '../../src/api';
import { deviceId } from '../../src/device';
import { changeLanguage } from '../../src/i18n';
import { currentLocale } from '../../src/i18n/locale';
import { Button, Chip, ErrorText, Field, Screen, T } from '../../src/ui/components';
import { space } from '../../src/ui/theme';

const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', ru: 'Русский', de: 'Deutsch', es: 'Español', hy: 'Հայերեն' };

export default function PhoneScreen() {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('+');
  const [error, setError] = useState<unknown>(null);
  const [invalid, setInvalid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lang, setLang] = useState<Locale>(currentLocale());

  const submit = async () => {
    const normalized = phone.replace(/[\s()-]/g, '');
    if (!phoneSchema.safeParse(normalized).success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setLoading(true);
    setError(null);
    try {
      await api.auth.requestOtp(normalized, await deviceId());
      router.push({ pathname: '/(auth)/code', params: { phone: normalized } });
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <T variant="title">{BRAND.clientApp.name}</T>
      <T variant="muted">{t('client.auth.subtitle')}</T>
      <Field
        label={t('client.auth.phoneLabel')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        placeholder="+374 91 123456"
        error={invalid ? t('client.auth.phoneInvalid') : null}
      />
      <ErrorText error={error} />
      <Button title={t('client.auth.sendCode')} onPress={() => void submit()} loading={loading} />
      <T variant="small">{t('client.auth.legalNote')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg }}>
        {LOCALES.map((l) => (
          <Chip
            key={l}
            label={LANGUAGE_NAMES[l]}
            selected={lang === l}
            onPress={() => {
              setLang(l);
              void changeLanguage(l);
            }}
          />
        ))}
      </View>
    </Screen>
  );
}
