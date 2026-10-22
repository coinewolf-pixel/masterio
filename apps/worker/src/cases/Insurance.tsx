import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, View } from 'react-native';
import { MAX_UPLOAD_BYTES } from '@masterio/shared';
import { api, client, uploadToStorage } from '../api';
import type { DocumentItem } from '../api/types';
import { date, localized, parseDay } from '../format';
import { Banner, Button, Card, ErrorText, Field, T } from '../ui/components';
import { radius, space, useColors } from '../ui/theme';

interface Requirement {
  countryCode: string;
  categoryId: string;
  categoryNames: Record<string, string>;
  requiredRisks: string[];
  satisfied: boolean;
  note: Record<string, string> | null;
}

/**
 * Страховка (разделы 18.3, 19.4): что требуется по правилам страны для моих услуг, мой полис и его срок.
 * Проверка полиса платформой — не гарантия покрытия конкретного случая.
 */
export function InsuranceSection({ docs }: { docs: DocumentItem[] }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const queryClient = useQueryClient();
  const req = useQuery({ queryKey: ['insuranceRequirements'], queryFn: () => client.request<{ items: Requirement[] }>('GET', '/worker/insurance-requirements') });
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<{ uri: string; type: string; size: number; name: string } | null>(null);
  const [insurer, setInsurer] = useState('');
  const [policy, setPolicy] = useState('');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [risks, setRisks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);

  const items = req.data?.items ?? [];
  const policies = docs.filter((d) => d.kind === 'INSURANCE');
  const fromIso = parseDay(from);
  const untilIso = parseDay(until);
  const riskList = risks.split(',').map((x) => x.trim()).filter((x) => x.length >= 2);
  const valid = Boolean(photo && insurer.trim().length >= 2 && policy.trim().length >= 2 && fromIso && untilIso && untilIso > fromIso && riskList.length > 0);

  const pick = async () => {
    setNote(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setNote(t('case.photos.permission'));
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    const a = res.canceled ? null : res.assets[0];
    if (!a) return;
    if ((a.fileSize ?? 0) > MAX_UPLOAD_BYTES) {
      setNote(t('case.photos.tooLarge'));
      return;
    }
    setPhoto({ uri: a.uri, type: a.mimeType ?? 'image/jpeg', size: a.fileSize ?? 1, name: a.fileName ?? 'policy.jpg' });
  };

  const submit = async () => {
    if (!photo || !fromIso || !untilIso) return;
    setBusy(true);
    setError(null);
    try {
      const form = await api.documents.uploadForm(photo.type, photo.size);
      await uploadToStorage(form, { uri: photo.uri, name: photo.name, type: photo.type });
      await client.request('POST', '/documents', {
        kind: 'INSURANCE',
        fileKey: form.key,
        insurance: { insurerName: insurer.trim(), policyNumber: policy.trim(), validFrom: fromIso, validUntil: untilIso, coveredRisks: riskList },
      });
      setOpen(false);
      setPhoto(null);
      await queryClient.invalidateQueries({ queryKey: ['documents'] });
      await queryClient.invalidateQueries({ queryKey: ['insuranceRequirements'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <T variant="h2">{t('case.insurance.title')}</T>
      {items.length === 0 ? <T variant="small">{t('case.insurance.notRequired')}</T> : null}
      {items.map((r) => (
        <View key={`${r.countryCode}-${r.categoryId}`} style={{ gap: 2 }}>
          <T style={{ color: r.satisfied ? c.success : c.danger }}>
            {localized(r.categoryNames)} · {r.countryCode}: {r.satisfied ? t('case.insurance.ok') : t('case.insurance.missing')}
          </T>
          {r.requiredRisks.length > 0 ? <T variant="small">{t('case.insurance.risks', { risks: r.requiredRisks.join(', ') })}</T> : null}
          {r.note ? <T variant="small">{r.note[i18n.language] ?? r.note.en ?? ''}</T> : null}
        </View>
      ))}
      {policies.map((p) => (
        <T key={p.id} variant="small">
          {t('case.insurance.policy', { status: t(`pro.documents.status.${p.status}`), date: date(p.validUntil) })}
        </T>
      ))}
      <T variant="small">{t('case.insurance.disclaimer')}</T>
      {!open ? (
        <Button title={t('case.insurance.upload')} variant="secondary" onPress={() => setOpen(true)} />
      ) : (
        <View style={{ gap: space.sm }}>
          {photo ? <Image source={{ uri: photo.uri }} style={{ width: '100%', height: 160, borderRadius: radius.md }} /> : null}
          <Button title={photo ? t('case.insurance.otherPhoto') : t('case.insurance.photo')} variant="secondary" onPress={() => void pick()} />
          <Field label={t('case.insurance.insurer')} value={insurer} onChangeText={setInsurer} />
          <Field label={t('case.insurance.number')} value={policy} onChangeText={setPolicy} />
          <Field label={t('case.insurance.from')} value={from} onChangeText={setFrom} placeholder="31.12.2026" keyboardType="numbers-and-punctuation" />
          <Field label={t('case.insurance.until')} value={until} onChangeText={setUntil} placeholder="31.12.2027" keyboardType="numbers-and-punctuation" />
          <Field label={t('case.insurance.coveredRisks')} value={risks} onChangeText={setRisks} placeholder="liability, property" autoCapitalize="none" />
          {(from && !fromIso) || (until && !untilIso) ? <T variant="small" style={{ color: c.danger }}>{t('case.insurance.badDate')}</T> : null}
          {note ? <Banner tone="warning" text={note} /> : <ErrorText error={error} />}
          <Button title={t('case.insurance.send')} disabled={!valid} loading={busy} onPress={() => void submit()} />
          <Button title={t('case.common.cancel')} variant="ghost" onPress={() => setOpen(false)} />
        </View>
      )}
    </Card>
  );
}
