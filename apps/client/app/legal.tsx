import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch, View } from 'react-native';
import type { ConsentContext } from '@masterio/shared';
import { cases } from '../src/cases/api';
import { useSession } from '../src/session/SessionProvider';
import { Button, Card, ErrorText, Loading, Screen, T } from '../src/ui/components';
import { space, useColors } from '../src/ui/theme';

/**
 * Принятие действующих условий (раздел 18.6): показываются только применимые документы страны пользователя.
 * Сервер записывает версию, дату, время, страну и контекст согласия.
 */
export default function LegalScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { signOut } = useSession();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ context?: string }>();
  const context = (params.context ?? 'registration') as ConsentContext;
  const q = useQuery({ queryKey: ['legal', context], queryFn: () => cases.required(context) });
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (q.isLoading) return <Loading />;
  const required = q.data?.required ?? [];
  const notices = q.data?.notices ?? [];

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await cases.accept(context, required.map((d) => d.versionId));
      await queryClient.invalidateQueries({ queryKey: ['legal'] });
      if (context === 'registration') router.replace('/(tabs)');
      else router.back();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <T variant="title">{t('case.legal.title')}</T>
      <T variant="muted">{t('case.legal.intro')}</T>
      <ErrorText error={q.error} />
      {required.map((d) => (
        <Card key={d.versionId} onPress={() => router.push({ pathname: '/legal-doc', params: { id: d.versionId } })}>
          <T variant="h2">{t(`case.legal.audience.${d.audience}`)}</T>
          <T variant="small">{t('case.legal.version', { version: d.version })}</T>
          <T style={{ color: c.primary }}>{t('case.legal.read')}</T>
        </Card>
      ))}
      {notices.length > 0 ? <T variant="small">{t('case.legal.alsoRead')}</T> : null}
      {notices.map((d) => (
        <Card key={d.versionId} onPress={() => router.push({ pathname: '/legal-doc', params: { id: d.versionId } })}>
          <T>{t(`case.legal.audience.${d.audience}`)}</T>
        </Card>
      ))}
      {required.length > 0 ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Switch value={agreed} onValueChange={setAgreed} trackColor={{ true: c.primary, false: c.border }} accessibilityLabel={t('case.legal.agree')} />
            <T style={{ flex: 1 }}>{t('case.legal.agree')}</T>
          </View>
          <ErrorText error={error} />
          <Button title={t('case.legal.accept')} disabled={!agreed} loading={busy} onPress={() => void accept()} />
        </>
      ) : (
        <Button title={t('case.legal.continue')} onPress={() => (context === 'registration' ? router.replace('/(tabs)') : router.back())} />
      )}
      {context === 'registration' ? <Button title={t('case.legal.decline')} variant="ghost" onPress={() => void signOut()} /> : null}
    </Screen>
  );
}
