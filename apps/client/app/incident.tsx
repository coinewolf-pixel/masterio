import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Switch, View } from 'react-native';
import { INCIDENT_TYPES } from '@masterio/shared';
import { cases } from '../src/cases/api';
import { PhotoPicker, type PickedPhoto } from '../src/cases/PhotoPicker';
import { Banner, Button, Card, Chip, ErrorText, Field, Screen, T } from '../src/ui/components';
import { space, useColors } from '../src/ui/theme';

/**
 * Несчастный случай или ущерб (раздел 19.4). Сначала — призыв звонить в экстренные службы страны,
 * потом форма: что случилось, фото, место. Masterio сохраняет материалы и передаёт поддержке, но не обещает выплат.
 */
export default function IncidentScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { orderId, emergency } = useLocalSearchParams<{ orderId: string; emergency?: string }>();
  const number = emergency || '112';
  const [step, setStep] = useState<'emergency' | 'form' | 'done'>('emergency');
  const [type, setType] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [called, setCalled] = useState(false);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);

  const submit = async () => {
    if (!type) return;
    setBusy(true);
    setError(null);
    try {
      let location: { lat: number; lng: number } | undefined;
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.granted) {
        const pos = await Location.getLastKnownPositionAsync();
        if (pos) location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      }
      const res = await cases.incident(orderId, { type, description: description.trim(), emergencyCalled: called, photoKeys: photos.map((p) => p.key), ...(location ? { location } : {}) });
      setTicketId(res.ticketId);
      setStep('done');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (step === 'emergency') {
    return (
      <Screen>
        <T variant="title">{t('case.incident.emergencyTitle')}</T>
        <T>{t('case.incident.emergencyText')}</T>
        <Button title={t('case.incident.call', { number })} variant="danger" onPress={() => void Linking.openURL(`tel:${number}`)} />
        <T variant="small">{t('case.incident.notify')}</T>
        <Button title={t('case.incident.continue')} variant="secondary" onPress={() => setStep('form')} />
      </Screen>
    );
  }

  if (step === 'done') {
    return (
      <Screen>
        <Banner tone="success" text={t('case.incident.saved')} />
        <T>{t('case.incident.savedText')}</T>
        {ticketId ? <Button title={t('case.incident.openTicket')} onPress={() => router.replace({ pathname: '/support/[id]', params: { id: ticketId } })} /> : null}
        <Button title={t('case.incident.back')} variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <T variant="h2">{t('case.incident.typeTitle')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {INCIDENT_TYPES.map((x) => (
          <Chip key={x} label={t(`case.incident.types.${x}`)} selected={type === x} onPress={() => setType(x)} />
        ))}
      </View>
      <Field
        label={t('case.incident.description')}
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={3_000}
        style={{ minHeight: 110, textAlignVertical: 'top', paddingTop: space.sm }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Switch value={called} onValueChange={setCalled} trackColor={{ true: c.primary, false: c.border }} accessibilityLabel={t('case.incident.called')} />
        <T style={{ flex: 1 }}>{t('case.incident.called')}</T>
      </View>
      <PhotoPicker purpose="incident" photos={photos} onChange={setPhotos} />
      <Card>
        <T variant="small">{t('case.incident.noPromise')}</T>
      </Card>
      <ErrorText error={error} />
      <Button title={t('case.incident.submit')} disabled={!type || description.trim().length < 3} loading={busy} onPress={() => void submit()} />
    </Screen>
  );
}
