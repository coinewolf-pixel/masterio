import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking } from 'react-native';
import { cases } from '../src/cases/api';
import { dateTime } from '../src/format';
import { useSession } from '../src/session/SessionProvider';
import { Button, Card, ErrorText, Field, Loading, Screen, T } from '../src/ui/components';

/** Мои данные (GDPR): выгрузка в файл и удаление аккаунта с объяснением, что хранится по закону. */
export default function PrivacyScreen() {
  const { t } = useTranslation();
  const { signOut } = useSession();
  const queryClient = useQueryClient();
  const requests = useQuery({ queryKey: ['dataRequests'], queryFn: cases.dataRequests });
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reason, setReason] = useState('');

  const doExport = async () => {
    setBusy('export');
    setError(null);
    try {
      const res = await cases.exportData();
      await queryClient.invalidateQueries({ queryKey: ['dataRequests'] });
      await Linking.openURL(res.url);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const doDelete = () => {
    Alert.alert(t('case.privacy.deleteTitle'), t('case.privacy.deleteConfirm'), [
      { text: t('case.common.cancel'), style: 'cancel' },
      {
        text: t('case.privacy.deleteButton'),
        style: 'destructive',
        onPress: () => {
          setBusy('delete');
          setError(null);
          cases
            .deleteAccount(reason.trim() || undefined)
            .then(() => signOut())
            .catch((e: unknown) => setError(e))
            .finally(() => setBusy(null));
        },
      },
    ]);
  };

  return (
    <Screen>
      <Card>
        <T variant="h2">{t('case.privacy.exportTitle')}</T>
        <T variant="muted">{t('case.privacy.exportText')}</T>
        <Button title={t('case.privacy.exportButton')} variant="secondary" loading={busy === 'export'} onPress={() => void doExport()} />
      </Card>
      {requests.isLoading ? <Loading /> : null}
      {(requests.data ?? [])
        .filter((r) => r.type === 'export' && r.url)
        .slice(0, 3)
        .map((r) => (
          <Card key={r.id} onPress={() => void Linking.openURL(r.url ?? '')}>
            <T>{t('case.privacy.exportReady', { time: dateTime(r.createdAt) })}</T>
          </Card>
        ))}
      <Card>
        <T variant="h2">{t('case.privacy.deleteTitle')}</T>
        <T variant="muted">{t('case.privacy.deleteText')}</T>
        <Field label={t('case.privacy.reason')} value={reason} onChangeText={setReason} maxLength={500} />
        <Button title={t('case.privacy.deleteButton')} variant="danger" loading={busy === 'delete'} onPress={doDelete} />
      </Card>
      <ErrorText error={error} />
    </Screen>
  );
}
