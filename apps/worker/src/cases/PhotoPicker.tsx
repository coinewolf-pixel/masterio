import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { MAX_UPLOAD_BYTES } from '@masterio/shared';
import { Button, ErrorText, T } from '../ui/components';
import { radius, space, useColors } from '../ui/theme';
import { uploadPhoto } from './api';

export interface PickedPhoto {
  key: string;
  uri: string;
}

/** Фото-доказательства: камера или галерея, до max штук; долгое нажатие удаляет. */
export function PhotoPicker({ purpose, photos, onChange, max = 6 }: { purpose: 'dispute_evidence' | 'incident'; photos: PickedPhoto[]; onChange: (p: PickedPhoto[]) => void; max?: number }) {
  const { t } = useTranslation();
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);

  const add = async (source: 'camera' | 'library') => {
    setError(null);
    setNote(null);
    const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setNote(t('case.photos.permission'));
      return;
    }
    const res = source === 'camera' ? await ImagePicker.launchCameraAsync({ quality: 0.6 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    const asset = res.canceled ? null : res.assets[0];
    if (!asset) return;
    if ((asset.fileSize ?? 0) > MAX_UPLOAD_BYTES) {
      setNote(t('case.photos.tooLarge'));
      return;
    }
    setBusy(true);
    try {
      const key = await uploadPhoto(purpose, asset);
      onChange([...photos, { key, uri: asset.uri }]);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.sm }}>
      <T variant="small">{t('case.photos.hint', { max })}</T>
      <View style={styles.row}>
        {photos.map((p) => (
          <Pressable key={p.key} onLongPress={() => onChange(photos.filter((x) => x.key !== p.key))} accessibilityHint={t('case.photos.remove')}>
            <Image source={{ uri: p.uri }} style={[styles.photo, { borderColor: c.border }]} />
          </Pressable>
        ))}
      </View>
      {photos.length < max ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button title={t('case.photos.camera')} variant="secondary" style={{ flex: 1 }} loading={busy} onPress={() => void add('camera')} />
          <Button title={t('case.photos.gallery')} variant="secondary" style={{ flex: 1 }} disabled={busy} onPress={() => void add('library')} />
        </View>
      ) : null}
      {note ? <T variant="small" style={{ color: c.danger }}>{note}</T> : <ErrorText error={error} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  photo: { width: 84, height: 84, borderRadius: radius.md, borderWidth: 1 },
});
