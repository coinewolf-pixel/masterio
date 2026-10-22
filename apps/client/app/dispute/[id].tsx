import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Linking, Pressable, View } from 'react-native';
import { RT_EVENTS } from '@masterio/shared';
import { cases, FINAL_DISPUTE } from '../../src/cases/api';
import { PhotoPicker, type PickedPhoto } from '../../src/cases/PhotoPicker';
import { dateTime } from '../../src/format';
import { useRealtimeEvent } from '../../src/realtime/RealtimeProvider';
import { useSession } from '../../src/session/SessionProvider';
import { Banner, Button, Card, ErrorText, Field, Loading, Screen, T } from '../../src/ui/components';
import { radius, space, useColors } from '../../src/ui/theme';

/** Спор: объяснения сторон, предложения поддержки, ответ, итог; если не договорились — куда обратиться дальше. */
export default function DisputeScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { me } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['dispute', id], queryFn: () => cases.dispute(id) });
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useRealtimeEvent<{ disputeId: string }>(RT_EVENTS.disputeUpdated, (p) => {
    if (p.disputeId === id) void queryClient.invalidateQueries({ queryKey: ['dispute', id] });
  });

  if (q.isLoading) return <Loading />;
  const d = q.data;
  if (!d) return <Screen><ErrorText error={q.error} /></Screen>;
  const mySide = me?.role === 'WORKER' ? 'worker' : 'client';
  const who = (from: string) => (from === mySide ? t('case.dispute.you') : from === 'support' ? t('case.dispute.support') : from === 'worker' ? t('case.dispute.worker') : t('case.dispute.client'));
  const final = FINAL_DISPUTE.includes(d.status);
  const waitingForMe = d.status === 'AWAITING_RESPONSE' && !d.mine;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await cases.respond(id, { text: text.trim(), photoKeys: photos.map((p) => p.key) });
      setText('');
      setPhotos([]);
      await queryClient.invalidateQueries({ queryKey: ['dispute', id] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <T variant="small">{t('case.dispute.order', { number: d.orderNumber })}</T>
      <T variant="title">{t(`case.reason.${d.reason}`)}</T>
      <Banner tone={final ? (d.status === 'SETTLED' ? 'success' : 'warning') : 'info'} text={t(`case.status.${d.status}`)} />
      {waitingForMe && d.responseDueAt ? <Banner tone="warning" text={t('case.dispute.answerBy', { time: dateTime(d.responseDueAt) })} /> : null}

      {d.timeline.map((e) => (
        <Card key={e.id} style={e.from === 'support' ? { borderColor: c.primary, borderWidth: 1 } : undefined}>
          <T variant="small">
            {who(e.from)} · {dateTime(e.createdAt)}
          </T>
          <T variant="h2">{t(`case.event.${e.type}`, { defaultValue: e.type })}</T>
          {e.text ? <T>{e.text}</T> : null}
        </Card>
      ))}

      {d.photos.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {d.photos.map((p) =>
            p.url ? (
              <Pressable key={p.id} onPress={() => void Linking.openURL(p.url ?? '')} accessibilityLabel={who(p.from)}>
                <Image source={{ uri: p.url }} style={{ width: 84, height: 84, borderRadius: radius.md }} />
              </Pressable>
            ) : null,
          )}
        </View>
      ) : null}

      {d.outcome?.summary ? (
        <Card>
          <T variant="h2">{t('case.dispute.outcome')}</T>
          {d.outcome.resolution ? <T variant="small">{t(`case.resolution.${d.outcome.resolution}`, { defaultValue: '' })}</T> : null}
          <T>{d.outcome.summary}</T>
        </Card>
      ) : null}
      {d.status === 'UNRESOLVED_REFERRED' ? (
        <Card>
          <T variant="h2">{t('case.dispute.nextStepsTitle')}</T>
          <T>{t('case.dispute.nextSteps')}</T>
        </Card>
      ) : null}

      {!final ? (
        <>
          <Field label={t('case.dispute.yourAnswer')} value={text} onChangeText={setText} multiline maxLength={2_000} style={{ minHeight: 90, textAlignVertical: 'top', paddingTop: space.sm }} />
          <PhotoPicker purpose="dispute_evidence" photos={photos} onChange={setPhotos} />
          <ErrorText error={error} />
          <Button title={t('case.dispute.send')} disabled={text.trim().length < 3} loading={busy} onPress={() => void send()} />
        </>
      ) : null}
      <T variant="small">{t('case.dispute.notCourt')}</T>
      <Button title={t('case.dispute.toOrder')} variant="ghost" onPress={() => router.push(`/order/${d.orderId}`)} />
    </Screen>
  );
}
