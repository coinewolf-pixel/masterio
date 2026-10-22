import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { BRAND, LOCALES, type Locale } from '@masterio/shared';
import { api } from '../../src/api';
import { changeLanguage } from '../../src/i18n';
import { currentLocale } from '../../src/i18n/locale';
import { useSession } from '../../src/session/SessionProvider';
import { Button, Card, Chip, ErrorText, Field, Screen, T } from '../../src/ui/components';
import { space } from '../../src/ui/theme';

const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', ru: 'Русский', de: 'Deutsch', es: 'Español', hy: 'Հայերեն' };

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { me, reloadMe, signOut } = useSession();
  const [lang, setLang] = useState<Locale>(currentLocale());
  const [firstName, setFirstName] = useState(me?.firstName ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const saveName = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.me.update({ firstName: firstName.trim() });
      await reloadMe();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Card>
        <T variant="muted">{me?.phone ?? ''}</T>
        <Field label={t('client.onboarding.firstName')} value={firstName} onChangeText={setFirstName} autoComplete="given-name" />
        <Button
          title={t('client.profile.save')}
          variant="secondary"
          onPress={() => void saveName()}
          loading={saving}
          disabled={firstName.trim().length === 0 || firstName.trim() === (me?.firstName ?? '')}
        />
      </Card>

      <Button title={t('client.profile.addresses')} variant="secondary" onPress={() => router.push('/addresses')} />
      <Button title={t('case.support.title')} variant="secondary" onPress={() => router.push('/support')} />
      <Button title={t('case.privacy.title')} variant="secondary" onPress={() => router.push('/privacy')} />

      <Card>
        <T variant="h2">{t('client.profile.language')}</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {LOCALES.map((l) => (
            <Chip
              key={l}
              label={LANGUAGE_NAMES[l]}
              selected={lang === l}
              onPress={() => {
                setLang(l);
                void changeLanguage(l);
                void api.me.update({ locale: l }).catch(() => undefined);
              }}
            />
          ))}
        </View>
      </Card>

      <Card>
        <T variant="h2">{t('client.profile.safetyTitle')}</T>
        <T variant="muted">{t('client.profile.safetyText')}</T>
      </Card>

      <ErrorText error={error} />
      <Button title={t('client.profile.signOut')} variant="ghost" onPress={() => void signOut()} />
      <T variant="small" center>{`${BRAND.clientApp.name} · ${t('client.onboarding.platformNote')}`}</T>
    </Screen>
  );
}
