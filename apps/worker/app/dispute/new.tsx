import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { CLIENT_DISPUTE_REASONS, WORKER_DISPUTE_REASONS } from '@masterio/shared';
import { cases } from '../../src/cases/api';
import { PhotoPicker, type PickedPhoto } from '../../src/cases/PhotoPicker';
import { useSession } from '../../src/session/SessionProvider';
import { Banner, Button, Chip, ErrorText, Field, Screen, T } from '../../src/ui/components';
import { space } from '../../src/ui/theme';

/** Открыть спор из заказа (раздел 18.5): причина, описание, фото. Вторая сторона получит уведомление. */
export default function NewDisputeScreen() {
  const { t } = useTranslation();
  const { me } = useSession();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const reasons: readonly string[] = me?.role === 'WORKER' ? WORKER_DISPUTE_REASONS : CLIENT_DISPUTE_REASONS;
  const [reason, setReason] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async () => {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      const d = await cases.openDispute(orderId, { reason, description: description.trim(), photoKeys: photos.map((p) => p.key) });
      router.replace({ pathname: '/dispute/[id]', params: { id: d.id } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <T variant="muted">{t('case.dispute.newIntro')}</T>
      <T variant="h2">{t('case.dispute.reasonTitle')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {reasons.map((r) => (
          <Chip key={r} label={t(`case.reason.${r}`)} selected={reason === r} onPress={() => setReason(r)} />
        ))}
      </View>
      {reason === 'ACCIDENT_INJURY' ? <Banner tone="danger" text={t('case.dispute.injuryHint')} /> : null}
      <Field
        label={t('case.dispute.description')}
        placeholder={t('case.dispute.descriptionHint')}
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={2_000}
        style={{ minHeight: 110, textAlignVertical: 'top', paddingTop: space.sm }}
      />
      <PhotoPicker purpose="dispute_evidence" photos={photos} onChange={setPhotos} />
      <Banner tone="info" text={t('case.dispute.howItWorks')} />
      <ErrorText error={error} />
      <Button title={t('case.dispute.submit')} disabled={!reason || description.trim().length < 3} loading={busy} onPress={() => void submit()} />
    </Screen>
  );
}
