import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { MAX_UPLOAD_BYTES } from '@masterio/shared';
import { api, uploadToStorage } from '../src/api';
import type { DocumentItem } from '../src/api/types';
import { date, localized } from '../src/format';
import { useSession } from '../src/session/SessionProvider';
import { Banner, Button, Card, Chip, ErrorText, Loading, Screen, T } from '../src/ui/components';
import { space, useColors } from '../src/ui/theme';
import { InsuranceSection } from '../src/cases/Insurance';

type Kind = Extract<DocumentItem['kind'], 'ID_DOCUMENT' | 'SELFIE' | 'LICENSE'>;

/** Документы: удостоверение и селфи для проверки личности, лицензии по категориям. Файлы — в закрытом хранилище. */
export default function DocumentsScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  const { me } = useSession();
  const queryClient = useQueryClient();
  const docs = useQuery({ queryKey: ['documents'], queryFn: api.documents.list });
  const groups = useQuery({ queryKey: ['categories'], queryFn: () => api.catalog.categories(), staleTime: 3_600_000 });
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [licenseCategory, setLicenseCategory] = useState<string | null>(null);

  const myLicenseCategories = (groups.data ?? [])
    .flatMap((g) => g.categories)
    .filter((cat) => cat.requiresLicense && me?.worker?.categoryIds.includes(cat.id));

  const latest = (kind: DocumentItem['kind'], categoryId?: string) =>
    (docs.data ?? []).find((d) => d.kind === kind && (!categoryId || d.license?.categoryId === categoryId));

  const pick = async (kind: Kind, source: 'camera' | 'library') => {
    setError(null);
    const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError(new Error('permission'));
      return;
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.7,
      cameraType: kind === 'SELFIE' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
    };
    const res = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    const type = asset.mimeType ?? 'image/jpeg';
    const size = asset.fileSize ?? 0;
    if (size > MAX_UPLOAD_BYTES) {
      setError(new Error('size'));
      return;
    }
    setBusy(kind);
    try {
      const form = await api.documents.uploadForm(type, size || 1);
      await uploadToStorage(form, { uri: asset.uri, name: asset.fileName ?? 'document.jpg', type });
      await api.documents.register({ kind, fileKey: form.key, ...(kind === 'LICENSE' && licenseCategory ? { categoryId: licenseCategory } : {}) });
      await queryClient.invalidateQueries({ queryKey: ['documents'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  if (docs.isLoading) return <Loading />;

  const statusLine = (doc: DocumentItem | undefined) =>
    doc ? `${t(`pro.documents.status.${doc.status}`)} · ${date(doc.createdAt)}${doc.rejectReason ? ` · ${doc.rejectReason}` : ''}` : t('pro.documents.notUploaded');

  const block = (kind: Kind, title: string, hint: string, doc: DocumentItem | undefined, enabled = true) => (
    <Card key={kind + title}>
      <T variant="h2">{title}</T>
      <T variant="small">{hint}</T>
      <T variant="muted" style={{ color: doc?.status === 'REJECTED' ? c.danger : doc?.status === 'VERIFIED' ? c.success : c.textMuted }}>{statusLine(doc)}</T>
      {doc?.status !== 'VERIFIED' ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button title={t('pro.documents.camera')} style={{ flex: 1 }} loading={busy === kind} disabled={!enabled || busy !== null} onPress={() => void pick(kind, 'camera')} />
          {kind !== 'SELFIE' ? (
            <Button title={t('pro.documents.gallery')} variant="secondary" style={{ flex: 1 }} disabled={!enabled || busy !== null} onPress={() => void pick(kind, 'library')} />
          ) : null}
        </View>
      ) : null}
    </Card>
  );

  const errorText =
    error instanceof Error && error.message === 'permission'
      ? t('pro.documents.permissionDenied')
      : error instanceof Error && error.message === 'size'
        ? t('pro.documents.tooLarge')
        : null;

  return (
    <Screen refreshing={docs.isRefetching} onRefresh={() => void docs.refetch()}>
      <Banner text={t('pro.documents.privacy')} />
      {block('ID_DOCUMENT', t('pro.documents.id'), t('pro.documents.idHint'), latest('ID_DOCUMENT'))}
      {block('SELFIE', t('pro.documents.selfie'), t('pro.documents.selfieHint'), latest('SELFIE'))}

      {myLicenseCategories.length > 0 ? (
        <Card>
          <T variant="h2">{t('pro.documents.licenses')}</T>
          <T variant="small">{t('pro.documents.licensesHint')}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {myLicenseCategories.map((cat) => (
              <Chip key={cat.id} label={localized(cat.names)} selected={licenseCategory === cat.id} onPress={() => setLicenseCategory(cat.id)} />
            ))}
          </View>
        </Card>
      ) : null}
      {licenseCategory ? block('LICENSE', t('pro.documents.license'), t('pro.documents.licenseHint'), latest('LICENSE', licenseCategory)) : null}
      <InsuranceSection docs={docs.data ?? []} />

      {errorText ? <T variant="small" style={{ color: c.danger }}>{errorText}</T> : <ErrorText error={error} />}
      {onboarding ? <Button title={t('pro.documents.continue')} onPress={() => router.replace('/(tabs)')} /> : null}
    </Screen>
  );
}
