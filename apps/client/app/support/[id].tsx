import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { RT_EVENTS } from '@masterio/shared';
import { cases } from '../../src/cases/api';
import { dateTime } from '../../src/format';
import { useRealtimeEvent } from '../../src/realtime/RealtimeProvider';
import { Banner, Button, ErrorText, Field, Loading, Screen, T } from '../../src/ui/components';
import { radius, space, useColors } from '../../src/ui/theme';

/** Переписка с поддержкой. Поддержка отвечает на языке пользователя; push приходит при ответе. */
export default function TicketScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['ticket', id], queryFn: () => cases.ticket(id) });
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useRealtimeEvent<{ ticketId: string }>(RT_EVENTS.ticketMessage, (p) => {
    if (p.ticketId === id) void queryClient.invalidateQueries({ queryKey: ['ticket', id] });
  });
  if (q.isLoading) return <Loading />;
  const tk = q.data;
  if (!tk) return <Screen><ErrorText error={q.error} /></Screen>;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await cases.postTicket(id, body.trim());
      setBody('');
      await queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      await queryClient.invalidateQueries({ queryKey: ['tickets'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <T variant="title">{tk.subject}</T>
      <Banner tone={tk.status === 'PENDING_USER' ? 'info' : tk.status === 'RESOLVED' || tk.status === 'CLOSED' ? 'success' : 'warning'} text={t(`case.support.status.${tk.status}`)} />
      {tk.disputeId ? <Button title={t('case.support.openDispute')} variant="secondary" onPress={() => router.push({ pathname: '/dispute/[id]', params: { id: tk.disputeId ?? '' } })} /> : null}
      <View style={{ gap: space.sm }}>
        {tk.messages.map((m) => (
          <View
            key={m.id}
            style={{
              alignSelf: m.fromSupport ? 'flex-start' : 'flex-end',
              maxWidth: '85%',
              backgroundColor: m.fromSupport ? c.surface : c.surfaceAlt,
              borderColor: c.border,
              borderWidth: 1,
              borderRadius: radius.md,
              padding: space.md,
              gap: 2,
            }}
          >
            <T variant="small">
              {m.fromSupport ? t('case.dispute.support') : t('case.dispute.you')} · {dateTime(m.createdAt)}
            </T>
            <T>{m.body}</T>
          </View>
        ))}
      </View>
      {tk.status !== 'CLOSED' ? (
        <>
          <Field label={t('case.support.message')} value={body} onChangeText={setBody} multiline maxLength={4_000} style={{ minHeight: 80, textAlignVertical: 'top', paddingTop: space.sm }} />
          <ErrorText error={error} />
          <Button title={t('case.support.send')} disabled={body.trim().length === 0} loading={busy} onPress={() => void send()} />
        </>
      ) : null}
    </Screen>
  );
}
