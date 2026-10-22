import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { api } from '../src/api';
import { localized } from '../src/format';
import { isTeamMember, useSession } from '../src/session/SessionProvider';
import { Button, Card, Chip, ErrorText, Field, Loading, Screen, T } from '../src/ui/components';
import { space } from '../src/ui/theme';

/** Анкета мастера: имя, независимый мастер или компания, категории и города работы. */
export default function Onboarding() {
  const { t } = useTranslation();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const editing = mode === 'edit';
  const { me, reloadMe } = useSession();
  const cities = useQuery({ queryKey: ['cities'], queryFn: api.catalog.cities, staleTime: 3_600_000 });
  const groups = useQuery({ queryKey: ['categories'], queryFn: () => api.catalog.categories(), staleTime: 3_600_000 });

  const [firstName, setFirstName] = useState(me?.firstName ?? '');
  const [type, setType] = useState<'INDEPENDENT' | 'COMPANY'>(me?.worker?.type ?? 'INDEPENDENT');
  const [companyName, setCompanyName] = useState(me?.worker?.companyName ?? '');
  const [categoryIds, setCategoryIds] = useState<string[]>(me?.worker?.categoryIds ?? []);
  const [cityIds, setCityIds] = useState<string[]>(me?.worker?.cityIds ?? []);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!me?.worker) return;
    setCategoryIds(me.worker.categoryIds);
    setCityIds(me.worker.cityIds);
  }, [me]);

  const member = isTeamMember(me);
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const valid = member ? firstName.trim().length > 0 : firstName.trim().length > 0 && categoryIds.length > 0 && cityIds.length > 0 && (type === 'INDEPENDENT' || companyName.trim().length > 0);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.me.update({ firstName: firstName.trim() });
      if (member) {
        // участник команды: только имя, затем документы для проверки личности
        await reloadMe();
        if (editing) router.back();
        else router.replace({ pathname: '/documents', params: { onboarding: '1' } });
        return;
      }
      await api.worker.updateProfile({ type, ...(type === 'COMPANY' ? { companyName: companyName.trim() } : {}) });
      await api.worker.setCities(cityIds);
      await api.worker.setCategories(categoryIds);
      await reloadMe();
      if (editing) router.back();
      else router.replace({ pathname: '/documents', params: { onboarding: '1' } });
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  if (cities.isLoading || groups.isLoading) return <Loading />;

  if (member) {
    return (
      <Screen>
        <T variant="muted">{t('pro.team.memberOnboarding', { team: me?.team?.name ?? '' })}</T>
        <Field label={t('pro.onboarding.firstName')} value={firstName} onChangeText={setFirstName} autoComplete="given-name" />
        <ErrorText error={error} />
        <Button title={editing ? t('pro.common.save') : t('pro.onboarding.continue')} onPress={() => void save()} loading={saving} disabled={!valid} />
      </Screen>
    );
  }

  return (
    <Screen>
      {!editing ? <T variant="muted">{t('pro.onboarding.intro')}</T> : null}
      <Field label={t('pro.onboarding.firstName')} value={firstName} onChangeText={setFirstName} autoComplete="given-name" />

      <T variant="h2">{t('pro.onboarding.typeTitle')}</T>
      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
        <Chip label={t('pro.onboarding.independent')} selected={type === 'INDEPENDENT'} onPress={() => setType('INDEPENDENT')} />
        <Chip label={t('pro.onboarding.company')} selected={type === 'COMPANY'} onPress={() => setType('COMPANY')} />
      </View>
      {type === 'COMPANY' ? <Field label={t('pro.onboarding.companyName')} value={companyName} onChangeText={setCompanyName} /> : null}

      <T variant="h2">{t('pro.onboarding.citiesTitle')}</T>
      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
        {(cities.data ?? []).map((city) => (
          <Chip key={city.id} label={localized(city.names)} selected={cityIds.includes(city.id)} onPress={() => setCityIds((l) => toggle(l, city.id))} />
        ))}
      </View>

      <T variant="h2">{t('pro.onboarding.categoriesTitle')}</T>
      {(groups.data ?? []).map((g) => (
        <Card key={g.id}>
          <T variant="body" style={{ fontWeight: '600' }}>{localized(g.names)}</T>
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            {g.categories.map((cat) => (
              <Chip
                key={cat.id}
                label={localized(cat.names) + (cat.requiresLicense ? ` · ${t('pro.onboarding.licenseNeeded')}` : '')}
                selected={categoryIds.includes(cat.id)}
                onPress={() => setCategoryIds((l) => toggle(l, cat.id))}
              />
            ))}
          </View>
        </Card>
      ))}

      <ErrorText error={error} />
      <Button title={editing ? t('pro.common.save') : t('pro.onboarding.continue')} onPress={() => void save()} loading={saving} disabled={!valid} />
    </Screen>
  );
}
