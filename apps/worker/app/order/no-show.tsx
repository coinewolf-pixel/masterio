import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image } from 'react-native';
import { ApiError, MAX_UPLOAD_BYTES } from '@masterio/shared';
import { cases, uploadPhoto } from '../../src/cases/api';
import { currentPosition } from '../../src/location/control';
import { Banner, Button, ErrorText, Field, Screen, T } from '../../src/ui/components';
import { radius, space } from '../../src/ui/theme';

/**
 * «Клиент не вышел» (раздел 12): только на месте, после ожидания, с фото адреса. Открывается спор,
 * поддержка рассматривает GPS, время ожидания и фото.
 */
export default function NoShowScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [photo, setPhoto] = useState<{ key: string; uri: string } | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);

  const takePhoto = async () => {
    setNote(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setNote(t('case.photos.permission'));
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    const asset = res.canceled ? null : res.assets[0];
    if (!asset) return;
    if ((asset.fileSize ?? 0) > MAX_UPLOAD_BYTES) {
      setNote(t('case.photos.tooLarge'));
      return;
    }
    setBusy(true);
    try {
      setPhoto({ key: await uploadPhoto('dispute_evidence', asset), uri: asset.uri });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!photo) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const d = await cases.noShow(id, { location: await currentPosition(), photoKey: photo.key, ...(comment.trim() ? { comment: comment.trim() } : {}) });
      router.replace({ pathname: '/dispute/[id]', params: { id: d.id } });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NO_SHOW_TOO_EARLY') {
        const left = (e.details as { minutesLeft?: number } | undefined)?.minutesLeft ?? 0;
        setNote(t('case.noShow.tooEarly', { minutes: left }));
      } else setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <T variant="muted">{t('case.noShow.intro')}</T>
      <Banner tone="info" text={t('case.noShow.rules')} />
      {photo ? <Image source={{ uri: photo.uri }} style={{ width: '100%', height: 220, borderRadius: radius.md }} /> : null}
      <Button title={photo ? t('case.noShow.retake') : t('case.noShow.photo')} variant="secondary" loading={busy && !photo} onPress={() => void takePhoto()} />
      <Field label={t('case.noShow.comment')} value={comment} onChangeText={setComment} multiline maxLength={1_000} style={{ minHeight: 80, textAlignVertical: 'top', paddingTop: space.sm }} />
      {note ? <Banner tone="warning" text={note} /> : null}
      <ErrorText error={error} />
      <Button title={t('case.noShow.submit')} disabled={!photo} loading={busy && Boolean(photo)} onPress={() => void submit()} />
    </Screen>
  );
}
