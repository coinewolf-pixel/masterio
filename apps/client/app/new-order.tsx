import { useQuery } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { MAX_UPLOAD_BYTES } from '@masterio/shared';
import { api, uploadToStorage } from '../src/api';
import { nearestCity, useDraft } from '../src/draft/NewOrderProvider';
import { dateTime, distance, localized } from '../src/format';
import { Banner, Button, Card, Chip, ErrorText, Field, Loading, Screen, T } from '../src/ui/components';
import { radius, space, useColors } from '../src/ui/theme';

const MAX_PHOTOS = 6;
const SLOTS_HOURS = [2, 4, 24, 48];

/** Новый заказ: что случилось (текст и фото), где, когда, как платить; сразу видно, есть ли мастера рядом. */
export default function NewOrderScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { draft, update } = useDraft();
  const groups = useQuery({ queryKey: ['categories'], queryFn: () => api.catalog.categories(), staleTime: 3_600_000 });
  const cities = useQuery({ queryKey: ['cities'], queryFn: api.catalog.cities, staleTime: 3_600_000 });
  const city = draft.address && cities.data ? nearestCity(cities.data, draft.address.location) : null;
  const config = useQuery({ queryKey: ['app-config', city?.id ?? null], queryFn: () => api.catalog.config(city?.id), enabled: city !== null });
  const availability = useQuery({
    queryKey: ['availability', city?.id, draft.categoryId, draft.address?.location.lat, draft.address?.location.lng],
    queryFn: () => api.catalog.availability(city?.id ?? '', draft.categoryId ?? '', draft.address?.location ?? { lat: 0, lng: 0 }),
    enabled: Boolean(city && draft.categoryId && draft.address),
    retry: false,
  });
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  if (groups.isLoading || cities.isLoading) return <Loading />;
  const category = groups.data?.flatMap((g) => g.categories).find((x) => x.id === draft.categoryId);
  const units = { m: t('units.m'), km: t('units.km') };

  const addPhoto = async (source: 'camera' | 'library') => {
    setError(null);
    const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError(new Error('permission'));
      return;
    }
    const res = source === 'camera' ? await ImagePicker.launchCameraAsync({ quality: 0.6 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    const asset = res.canceled ? null : res.assets[0];
    if (!asset) return;
    const type = asset.mimeType ?? 'image/jpeg';
    if ((asset.fileSize ?? 0) > MAX_UPLOAD_BYTES) {
      setError(new Error('size'));
      return;
    }
    setUploading(true);
    try {
      const form = await api.uploads.orderPhotoForm(type, asset.fileSize ?? 1);
      await uploadToStorage(form, { uri: asset.uri, name: asset.fileName ?? 'photo.jpg', type });
      update({ photos: [...draft.photos, { key: form.key, uri: asset.uri }] });
    } catch (e) {
      setError(e);
    } finally {
      setUploading(false);
    }
  };

  const cashAllowed = config.data?.cashEnabled ?? true;
  const cardAllowed = config.data?.cardPaymentsEnabled ?? false;
  const paymentOk = (draft.paymentMethod === 'CASH' && cashAllowed) || (draft.paymentMethod === 'CARD' && cardAllowed);
  const ready = Boolean(category && draft.description.trim().length >= 3 && draft.address && city && paymentOk && (draft.timing === 'ASAP' || draft.scheduledAt));

  const submit = async () => {
    if (!draft.address || !city || !draft.categoryId) return;
    setSubmitting(true);
    setError(null);
    try {
      if (draft.address.save) {
        await api.me
          .addAddress({ label: draft.address.label, formatted: draft.address.formatted, details: draft.address.details, placeId: draft.address.placeId, location: draft.address.location })
          .catch(() => undefined);
      }
      const order = await api.orders.create({
        categoryId: draft.categoryId,
        cityId: city.id,
        description: draft.description.trim(),
        address: {
          formatted: draft.address.formatted,
          details: draft.address.details || undefined,
          placeId: draft.address.placeId,
          location: draft.address.location,
        },
        timing: draft.timing,
        scheduledAt: draft.timing === 'SCHEDULED' && draft.scheduledAt ? draft.scheduledAt.toISOString() : undefined,
        paymentMethod: draft.paymentMethod,
        photoKeys: draft.photos.map((p) => p.key),
      });
      router.replace(`/order/${order.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setSubmitting(false);
    }
  };

  const localError =
    error instanceof Error && error.message === 'permission' ? t('client.newOrder.permissionDenied') : error instanceof Error && error.message === 'size' ? t('client.newOrder.tooLarge') : null;

  return (
    <Screen>
      <T variant="title">{localized(category?.names)}</T>
      {category?.isUrgent ? <Banner tone="warning" text={t('client.newOrder.urgentHint')} /> : null}

      <Field
        label={t('client.newOrder.description')}
        placeholder={t('client.newOrder.descriptionPlaceholder')}
        value={draft.description}
        onChangeText={(v) => update({ description: v })}
        multiline
        style={{ minHeight: 96, textAlignVertical: 'top', paddingTop: space.sm }}
        maxLength={2_000}
      />

      <T variant="small">{t('client.newOrder.photos')}</T>
      <View style={styles.photos}>
        {draft.photos.map((p) => (
          <Pressable key={p.key} onLongPress={() => update({ photos: draft.photos.filter((x) => x.key !== p.key) })} accessibilityHint={t('client.newOrder.removePhotoHint')}>
            <Image source={{ uri: p.uri }} style={[styles.photo, { borderColor: c.border }]} />
          </Pressable>
        ))}
      </View>
      {draft.photos.length < MAX_PHOTOS ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button title={t('client.newOrder.camera')} variant="secondary" style={{ flex: 1 }} loading={uploading} onPress={() => void addPhoto('camera')} />
          <Button title={t('client.newOrder.gallery')} variant="secondary" style={{ flex: 1 }} disabled={uploading} onPress={() => void addPhoto('library')} />
        </View>
      ) : null}

      <Card onPress={() => router.push('/address')}>
        <T variant="small">{t('client.newOrder.address')}</T>
        {draft.address ? (
          <>
            <T variant="h2">{draft.address.formatted}</T>
            {draft.address.details ? <T variant="muted">{draft.address.details}</T> : null}
            {city ? <T variant="small">{localized(city.names)}</T> : null}
          </>
        ) : (
          <T style={{ color: c.primary }}>{t('client.newOrder.chooseAddress')}</T>
        )}
      </Card>

      {availability.data ? (
        availability.data.availableCount > 0 ? (
          <Banner
            tone="success"
            text={t('client.newOrder.available', {
              count: availability.data.availableCount,
              distance: availability.data.nearestDistanceM !== null ? distance(availability.data.nearestDistanceM, units) : '',
            })}
          />
        ) : (
          <Banner tone="warning" text={availability.data.suggestExpandRadius ? t('client.newOrder.noneNearbyFar') : t('client.newOrder.noneNearby')} />
        )
      ) : null}
      {availability.error ? <ErrorText error={availability.error} /> : null}

      <T variant="h2">{t('client.newOrder.when')}</T>
      <View style={styles.chips}>
        <Chip label={t('client.newOrder.asap')} selected={draft.timing === 'ASAP'} onPress={() => update({ timing: 'ASAP', scheduledAt: null })} />
        {SLOTS_HOURS.map((h) => {
          const at = new Date(Math.ceil((Date.now() + h * 3_600_000) / 900_000) * 900_000);
          const selected = draft.timing === 'SCHEDULED' && draft.scheduledAt !== null && Math.abs(draft.scheduledAt.getTime() - at.getTime()) < 900_000;
          return <Chip key={h} label={t('client.newOrder.inHours', { count: h })} selected={selected} onPress={() => update({ timing: 'SCHEDULED', scheduledAt: at })} />;
        })}
      </View>
      {draft.timing === 'SCHEDULED' && draft.scheduledAt ? <T variant="small">{dateTime(draft.scheduledAt.toISOString())}</T> : null}

      <T variant="h2">{t('client.newOrder.payment')}</T>
      <View style={styles.chips}>
        {cashAllowed ? <Chip label={t('client.newOrder.cash')} selected={draft.paymentMethod === 'CASH'} onPress={() => update({ paymentMethod: 'CASH' })} /> : null}
        {cardAllowed ? <Chip label={t('client.newOrder.card')} selected={draft.paymentMethod === 'CARD'} onPress={() => update({ paymentMethod: 'CARD' })} /> : null}
      </View>
      {draft.paymentMethod === 'CASH' && cashAllowed ? <Banner tone="info" text={t('client.newOrder.cashWarning')} /> : null}
      {!cashAllowed && !cardAllowed && config.data ? <Banner tone="danger" text={t('errors.FEATURE_DISABLED')} /> : null}

      <T variant="small">{t('client.newOrder.legal')}</T>
      {localError ? <T variant="small" style={{ color: c.danger }}>{localError}</T> : <ErrorText error={error} />}
      <Button title={t('client.newOrder.submit')} onPress={() => void submit()} loading={submitting} disabled={!ready || uploading} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  photo: { width: 84, height: 84, borderRadius: radius.md, borderWidth: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
