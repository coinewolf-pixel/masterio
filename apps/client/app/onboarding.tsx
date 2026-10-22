import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../src/api';
import { useSession } from '../src/session/SessionProvider';
import { Button, ErrorText, Field, Screen, T } from '../src/ui/components';

/** Клиенту достаточно имени — его видит мастер. */
export default function Onboarding() {
  const { t } = useTranslation();
  const { me, reloadMe } = useSession();
  const [firstName, setFirstName] = useState(me?.firstName ?? '');
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.me.update({ firstName: firstName.trim() });
      await reloadMe();
      router.replace('/(tabs)');
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <T variant="muted">{t('client.onboarding.intro')}</T>
      <Field label={t('client.onboarding.firstName')} value={firstName} onChangeText={setFirstName} autoComplete="given-name" autoFocus />
      <ErrorText error={error} />
      <Button title={t('client.onboarding.continue')} onPress={() => void save()} loading={saving} disabled={firstName.trim().length === 0} />
      <T variant="small">{t('client.onboarding.platformNote')}</T>
    </Screen>
  );
}
