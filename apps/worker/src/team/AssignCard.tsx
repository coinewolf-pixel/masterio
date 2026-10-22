import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { OrderDetails } from '../api/types';
import { dateTime } from '../format';
import { Banner, Button, Card, ErrorText, Field, T } from '../ui/components';
import { space, useColors } from '../ui/theme';
import { teamApi } from './api';

/**
 * Назначение исполнителя руководителем (раздел 19.2): кто едет сейчас, замена с согласием клиента, выбор
 * только из участников, которым можно доверить заказ (личность, лицензия, страховка, не заняты).
 */
export function AssignCard({ order, meId }: { order: OrderDetails; meId: string }) {
  const { t } = useTranslation();
  const c = useColors();
  const queryClient = useQueryClient();
  const team = order.team;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const candidates = useQuery({ queryKey: ['candidates', order.id], queryFn: () => teamApi.candidates(order.id), enabled: open });
  if (!team) return null;

  const performerIsMe = !team.current || team.current.userId === meId;
  const replacing = !team.needsAssignment;
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['order', order.id] });
    await queryClient.invalidateQueries({ queryKey: ['candidates', order.id] });
    await queryClient.invalidateQueries({ queryKey: ['eligibility'] });
  };
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      setOpen(false);
      setReason('');
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <T variant="h2">{t('pro.team.performerTitle')}</T>
      {team.needsAssignment ? (
        <Banner tone="warning" text={t('pro.team.assignNeeded', { time: dateTime(team.assignDeadline) })} />
      ) : null}
      <T>
        {team.current
          ? t('pro.team.performer', { name: team.current.name ?? '—', role: t(`pro.team.role.${team.current.role}`) })
          : t('pro.team.performerYou')}
      </T>
      {team.current?.automatic ? <T variant="small">{t('pro.team.autoAssigned')}</T> : null}
      {!performerIsMe ? <T variant="small">{t('pro.team.performerConfirms')}</T> : null}

      {team.pending ? (
        <View style={{ gap: space.sm }}>
          <Banner tone="info" text={t('pro.team.pendingChange', { name: team.pending.name ?? '—' })} />
          <Button title={t('pro.team.cancelChange')} variant="ghost" loading={busy === 'cancel'} onPress={() => void act('cancel', () => teamApi.cancelPending(order.id))} />
        </View>
      ) : null}

      {!open ? (
        <Button title={replacing ? t('pro.team.replace') : t('pro.team.assign')} variant={team.needsAssignment ? 'primary' : 'secondary'} onPress={() => setOpen(true)} />
      ) : (
        <View style={{ gap: space.sm }}>
          {replacing ? <T variant="small">{team.consentRequired ? t('pro.team.consentHint') : t('pro.team.notifyHint')}</T> : null}
          {replacing ? <Field label={t('pro.team.reason')} value={reason} onChangeText={setReason} maxLength={500} /> : null}
          {candidates.isLoading ? <T variant="muted">…</T> : null}
          {(candidates.data?.items ?? []).map((m) => {
            const current = team.current ? team.current.memberId === m.memberId : m.role === 'LEADER';
            return (
              <View key={m.memberId} style={{ gap: 2, paddingVertical: space.xs }}>
                <T variant="body" style={{ fontWeight: '600' }}>
                  {`${m.name ?? '—'} · ${t(`pro.team.role.${m.role}`)}`}
                  {current ? ` · ${t('pro.team.now')}` : ''}
                </T>
                {m.eligible ? null : (
                  <T variant="small" style={{ color: c.danger }}>
                    {m.blockers.map((b) => (b === 'busy' && m.busyOrderNumber !== null ? t('pro.team.busy', { number: m.busyOrderNumber }) : t(`pro.team.blocker.${b}`))).join(' · ')}
                  </T>
                )}
                {m.eligible && !current ? (
                  <Button
                    title={t('pro.team.choose')}
                    variant="secondary"
                    loading={busy === m.memberId}
                    disabled={busy !== null}
                    onPress={() => void act(m.memberId, () => teamApi.assign(order.id, m.memberId, reason.trim() || undefined))}
                  />
                ) : null}
              </View>
            );
          })}
          <Button title={t('pro.common.cancel')} variant="ghost" onPress={() => setOpen(false)} />
        </View>
      )}
      <ErrorText error={error ?? candidates.error} />
    </Card>
  );
}
