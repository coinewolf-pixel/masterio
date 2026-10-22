import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch, View } from 'react-native';
import { BRAND, LOCALES, type Locale } from '@masterio/shared';
import { api } from '../../src/api';
import { changeLanguage } from '../../src/i18n';
import { currentLocale } from '../../src/i18n/locale';
import { isTeamMember, useSession } from '../../src/session/SessionProvider';
import { Banner, Button, Card, Chip, ErrorText, Row, Screen, T } from '../../src/ui/components';
import { space, useColors } from '../../src/ui/theme';

const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', ru: 'Русский', de: 'Deutsch', es: 'Español', hy: 'Հայերեն' };
const RADII = [3_000, 5_000, 10_000, 20_000];

export default function ProfileScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { me, reloadMe, signOut } = useSession();
  const [lang, setLang] = useState<Locale>(currentLocale());
  const [error, setError] = useState<unknown>(null);
  const w = me?.worker;
  const member = isTeamMember(me);

  const update = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await reloadMe();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <Screen>
      <Card>
        <T variant="title">{me?.firstName ?? ''}</T>
        <T variant="muted">{me?.phone ?? ''}</T>
        {w ? (
          <>
            {member ? (
              <Row label={t('pro.team.title')} value={`${me?.team?.name ?? ''} · ${t(`pro.team.role.${me?.team?.role ?? 'HELPER'}`)}`} />
            ) : (
              <>
                <Row label={t('pro.profile.rating')} value={w.ratingCount > 0 ? `${w.ratingAvg.toFixed(2)} (${w.ratingCount})` : '—'} />
                <Row label={t('pro.profile.type')} value={w.type === 'COMPANY' ? `${t('pro.onboarding.company')}: ${w.companyName ?? ''}` : t('pro.onboarding.independent')} />
              </>
            )}
            <Row label={t('pro.profile.kyc')} value={t(`pro.documents.status.${w.kycStatus}`)} />
          </>
        ) : null}
      </Card>

      {w && w.kycStatus !== 'VERIFIED' ? <Banner tone="warning" text={t('worker.ineligible.kyc')} /> : null}
      <Button title={t('pro.profile.documents')} variant="secondary" onPress={() => router.push('/documents')} />
      <Button title={t('pro.team.title')} variant="secondary" onPress={() => router.push('/team')} />
      {member ? null : <Button title={t('pro.profile.editWork')} variant="secondary" onPress={() => router.push({ pathname: '/onboarding', params: { mode: 'edit' } })} />}
      {member ? null : (me?.pendingInvites ?? 0) > 0 ? <Button title={t('pro.team.invitesTitle')} variant="secondary" onPress={() => router.push('/team/invites')} /> : null}
      <Button title={t('case.support.title')} variant="secondary" onPress={() => router.push('/support')} />
      <Button title={t('case.privacy.title')} variant="secondary" onPress={() => router.push('/privacy')} />

      {member ? null : (
        <>
          <Card>
            <T variant="h2">{t('pro.profile.radius')}</T>
            <T variant="small">{t('pro.profile.radiusHint')}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              <Chip label={t('pro.profile.radiusDefault')} selected={!w?.preferredRadiusM} onPress={() => void update(() => api.worker.updateProfile({ preferredRadiusM: null }))} />
              {RADII.map((r) => (
                <Chip
                  key={r}
                  label={`${r / 1_000} ${t('units.km')}`}
                  selected={w?.preferredRadiusM === r}
                  onPress={() => void update(() => api.worker.updateProfile({ preferredRadiusM: r }))}
                />
              ))}
            </View>
          </Card>

          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View style={{ flex: 1 }}>
                <T variant="h2">{t('pro.profile.autoEarnings')}</T>
                <T variant="small">{t('pro.profile.autoEarningsHint')}</T>
              </View>
              <Switch
                value={w?.autoUseEarnings ?? false}
                onValueChange={(v) => void update(() => api.worker.updateProfile({ autoUseEarnings: v }))}
                trackColor={{ true: c.primary, false: c.border }}
              />
            </View>
          </Card>
        </>
      )}

      <Card>
        <T variant="h2">{t('pro.profile.language')}</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {LOCALES.map((l) => (
            <Chip
              key={l}
              label={LANGUAGE_NAMES[l]}
              selected={lang === l}
              onPress={() => {
                setLang(l);
                void changeLanguage(l);
                void api.me.update({ locale: l }).catch(() => undefined);
              }}
            />
          ))}
        </View>
      </Card>

      <ErrorText error={error} />
      <Button title={t('pro.profile.signOut')} variant="ghost" onPress={() => void signOut()} />
      <T variant="small" center>{`${BRAND.workerApp.name} · ${t('pro.profile.platformNote')}`}</T>
    </Screen>
  );
}
