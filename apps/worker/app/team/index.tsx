import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';
import { phoneSchema, TEAM_INVITE_ROLES, type TeamInviteRole } from '@masterio/shared';
import { cases } from '../../src/cases/api';
import { date } from '../../src/format';
import { useSession } from '../../src/session/SessionProvider';
import { teamApi, type MyTeam, type TeamMemberRow } from '../../src/team/api';
import { Banner, Button, Card, Chip, ErrorText, Field, Loading, Row, Screen, T } from '../../src/ui/components';
import { space, useColors } from '../../src/ui/theme';

/**
 * «Моя команда» (раздел 18.2). Руководитель: участники со статусом проверки и занятостью, приглашения по номеру,
 * журнал. Участник: своя команда, руководитель, роль, выход из команды.
 */
export default function TeamScreen() {
  const { t } = useTranslation();
  const { reloadMe } = useSession();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['team'], queryFn: teamApi.mine });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['team'] });
    await reloadMe();
  };

  if (q.isLoading) return <Loading />;
  if (!q.data) return <Screen><ErrorText error={q.error} /></Screen>;
  const data = q.data;
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      {data.mode === 'none' ? <CreateTeam enabled={data.teamsEnabled} onDone={refresh} /> : null}
      {data.mode === 'member' ? <MemberView data={data} onLeft={refresh} /> : null}
      {data.mode === 'owner' ? <OwnerView data={data} onChange={refresh} /> : null}
      <T variant="small">{t('pro.team.legalNote')}</T>
    </Screen>
  );
}

function CreateTeam({ enabled, onDone }: { enabled: boolean; onDone: () => Promise<void> }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!enabled) return <Banner tone="info" text={t('pro.team.disabled')} />;
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await teamApi.create(name.trim());
      await onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <T variant="h2">{t('pro.team.createTitle')}</T>
      <T variant="muted">{t('pro.team.createText')}</T>
      <Field label={t('pro.team.name')} value={name} onChangeText={setName} maxLength={80} />
      <ErrorText error={error} />
      <Button title={t('pro.team.create')} disabled={name.trim().length < 2} loading={busy} onPress={() => void create()} />
    </Card>
  );
}

function MemberView({ data, onLeft }: { data: Extract<MyTeam, { mode: 'member' }>; onLeft: () => Promise<void> }) {
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>(null);
  const leave = () =>
    Alert.alert(t('pro.team.leaveTitle'), t('pro.team.leaveConfirm'), [
      { text: t('pro.common.cancel'), style: 'cancel' },
      {
        text: t('pro.team.leave'),
        style: 'destructive',
        onPress: () => {
          setError(null);
          teamApi
            .leave()
            .then(onLeft)
            .then(() => router.replace('/'))
            .catch(setError);
        },
      },
    ]);
  return (
    <>
      <Card>
        <T variant="title">{data.team.name}</T>
        <Row label={t('pro.team.leader')} value={data.leaderName ?? '—'} />
        <Row label={t('pro.team.myRole')} value={t(`pro.team.role.${data.role}`)} />
        <Row label={t('pro.team.since')} value={date(data.joinedAt)} />
      </Card>
      <Banner tone="info" text={t('pro.team.memberRules')} />
      <ErrorText error={error} />
      <Button title={t('pro.team.leave')} variant="ghost" onPress={leave} />
    </>
  );
}

function OwnerView({ data, onChange }: { data: Extract<MyTeam, { mode: 'owner' }>; onChange: () => Promise<void> }) {
  const { t } = useTranslation();
  const c = useColors();
  const [error, setError] = useState<unknown>(null);
  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    fn().then(onChange).catch(setError);
  };
  const others = data.members.filter((m) => m.role !== 'LEADER');
  return (
    <>
      <Card>
        <T variant="title">{data.team.name}</T>
        <T variant="small">{t('pro.team.capacity', { count: data.capacity })}</T>
        <Button title={t('pro.team.journal')} variant="secondary" onPress={() => router.push('/team/journal')} />
      </Card>

      <T variant="h2">{t('pro.team.members', { count: others.length, limit: data.limit })}</T>
      {others.length === 0 ? <T variant="muted">{t('pro.team.noMembers')}</T> : null}
      {others.map((m) => (
        <MemberCard key={m.id} m={m} onRemove={() =>
          Alert.alert(t('pro.team.removeTitle'), t('pro.team.removeConfirm', { name: m.name ?? m.phone ?? '' }), [
            { text: t('pro.common.cancel'), style: 'cancel' },
            { text: t('pro.team.remove'), style: 'destructive', onPress: () => run(() => teamApi.remove(m.id)) },
          ])
        } />
      ))}

      {data.invites.length > 0 ? (
        <Card>
          <T variant="h2">{t('pro.team.pendingInvites')}</T>
          {data.invites.map((i) => (
            <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <T style={{ flex: 1 }}>{`${i.phone} · ${t(`pro.team.role.${i.role}`)}`}</T>
              <T variant="small" style={{ color: c.textMuted }}>{t('pro.team.until', { date: date(i.expiresAt) })}</T>
              <Button title={t('pro.team.revoke')} variant="ghost" onPress={() => run(() => teamApi.revoke(i.id))} />
            </View>
          ))}
        </Card>
      ) : null}

      <InviteForm onDone={onChange} />
      <ErrorText error={error} />
    </>
  );
}

function MemberCard({ m, onRemove }: { m: TeamMemberRow; onRemove: () => void }) {
  const { t } = useTranslation();
  const c = useColors();
  const ok = m.kycStatus === 'VERIFIED' && !m.blocked;
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <T variant="body" style={{ fontWeight: '600', flex: 1 }}>{m.name ?? m.phone ?? '—'}</T>
        <T variant="small">{t(`pro.team.role.${m.role}`)}</T>
      </View>
      <T variant="small" style={{ color: ok ? c.success : c.danger }}>
        {m.blocked ? t('pro.team.blocked') : t('pro.team.kyc', { status: t(`pro.documents.status.${m.kycStatus}`) })}
      </T>
      <T variant="small">
        {[m.licenses > 0 ? t('pro.team.licenses', { count: m.licenses }) : null, m.insured ? t('pro.team.insured') : null].filter(Boolean).join(' · ') || t('pro.team.noExtraDocs')}
      </T>
      {m.busyOrderNumber !== null ? <T variant="small">{t('pro.team.busy', { number: m.busyOrderNumber })}</T> : null}
      {!ok ? <T variant="small">{t('pro.team.notAssignable')}</T> : null}
      <Button title={t('pro.team.remove')} variant="ghost" onPress={onRemove} />
    </Card>
  );
}

function InviteForm({ onDone }: { onDone: () => Promise<void> }) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('+');
  const [role, setRole] = useState<TeamInviteRole>('HELPER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState<{ exists: boolean } | null>(null);
  const consents = useQuery({ queryKey: ['legal', 'add_helper'], queryFn: () => cases.required('add_helper') });
  const normalized = phone.replace(/[\s()-]/g, '');
  const valid = phoneSchema.safeParse(normalized).success;
  const needsConsent = (consents.data?.required.length ?? 0) > 0;

  const send = async () => {
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const res = await teamApi.invite(normalized, role);
      setSent({ exists: res.accountExists });
      setPhone('+');
      await onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <T variant="h2">{t('pro.team.inviteTitle')}</T>
      <T variant="small">{t('pro.team.inviteText')}</T>
      {needsConsent ? (
        <>
          <Banner tone="warning" text={t('pro.team.consentNeeded')} />
          <Button title={t('case.legal.readAccept')} variant="secondary" onPress={() => router.push({ pathname: '/legal', params: { context: 'add_helper' } })} />
        </>
      ) : null}
      <Field label={t('pro.team.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {TEAM_INVITE_ROLES.map((r) => (
          <Chip key={r} label={t(`pro.team.role.${r}`)} selected={role === r} onPress={() => setRole(r)} />
        ))}
      </View>
      <T variant="small">{t(`pro.team.roleHint.${role}`)}</T>
      {sent ? <Banner tone="success" text={sent.exists ? t('pro.team.inviteSentExisting') : t('pro.team.inviteSentNew')} /> : null}
      <ErrorText error={error} />
      <Button title={t('pro.team.invite')} disabled={!valid || needsConsent} loading={busy} onPress={() => void send()} />
    </Card>
  );
}
