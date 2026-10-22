import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cases } from '../../src/cases/api';
import { Button, ErrorText, Field, Screen, T } from '../../src/ui/components';
import { space } from '../../src/ui/theme';

export default function NewTicketScreen() {
  const { t } = useTranslation();
  const { orderId } = useLocalSearchParams<{ orderId?: string }>();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const tk = await cases.createTicket({ subject: subject.trim(), body: body.trim(), ...(orderId ? { orderId } : {}) });
      router.replace({ pathname: '/support/[id]', params: { id: tk.id } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <T variant="muted">{t('case.support.newIntro')}</T>
      <Field label={t('case.support.subject')} value={subject} onChangeText={setSubject} maxLength={200} />
      <Field label={t('case.support.message')} value={body} onChangeText={setBody} multiline maxLength={4_000} style={{ minHeight: 120, textAlignVertical: 'top', paddingTop: space.sm }} />
      <ErrorText error={error} />
      <Button title={t('case.support.send')} disabled={subject.trim().length < 3 || body.trim().length < 3} loading={busy} onPress={() => void submit()} />
    </Screen>
  );
}
