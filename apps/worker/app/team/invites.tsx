import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { date } from '../../src/format';
import { needsOnboarding, useSession } from '../../src/session/SessionProvider';
import { teamApi } from '../../src/team/api';
import { Banner, Button, Card, ErrorText, Loading, Screen, T } from '../../src/ui/components';

/** Приглашение в команду: принять (режим участника) или работать самостоятельно. */
export default function InvitesScreen() {
  const { t } = useTranslation();
  const { reloadMe, me } = useSession();
  const q = useQuery({ queryKey: ['incomingInvites'], queryFn: teamApi.incoming });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const next = async () => {
    const fresh = await reloadMe();
    router.replace(needsOnboarding(fresh ?? me) ? '/onboarding' : '/(tabs)');
  };
  const act = async (id: string, accept: boolean) => {
    setBusy(id);
    setError(null);
    try {
      await (accept ? teamApi.accept(id) : teamApi.decline(id));
      if (accept) await next();
      else await q.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading) return <Loading />;
  const items = q.data ?? [];
  return (
    <Screen>
      <T variant="title">{t('pro.team.invitesTitle')}</T>
      <T variant="muted">{t('pro.team.invitesText')}</T>
      {items.length === 0 ? <T variant="muted">{t('pro.team.noInvites')}</T> : null}
      {items.map((i) => (
        <Card key={i.id}>
          <T variant="h2">{i.team.name}</T>
          <T>{t(i.team.company ? 'pro.team.fromCompany' : 'pro.team.fromMaster', { name: i.team.leaderName ?? '' })}</T>
          <T variant="small">{t('pro.team.asRole', { role: t(`pro.team.role.${i.role}`) })}</T>
          <T variant="small">{t('pro.team.until', { date: date(i.expiresAt) })}</T>
          <Button title={t('pro.team.accept')} loading={busy === i.id} disabled={busy !== null} onPress={() => void act(i.id, true)} />
          <Button title={t('pro.team.decline')} variant="ghost" disabled={busy !== null} onPress={() => void act(i.id, false)} />
        </Card>
      ))}
      <Banner tone="info" text={t('pro.team.memberRules')} />
      <ErrorText error={error} />
      <Button title={t('pro.team.workAlone')} variant="secondary" onPress={() => void next()} />
    </Screen>
  );
}
