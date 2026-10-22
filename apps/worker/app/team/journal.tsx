import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { dateTime } from '../../src/format';
import { teamApi, type TeamEventRow } from '../../src/team/api';
import { Button, Card, ErrorText, Loading, Screen, T } from '../../src/ui/components';

/** Журнал команды: приглашения, вступления, назначения и замены по заказам (раздел 18.2). */
export default function JournalScreen() {
  const { t } = useTranslation();
  const q = useInfiniteQuery({
    queryKey: ['teamEvents'],
    queryFn: ({ pageParam }) => teamApi.events(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: TeamEventRow[]) => (last.length === 50 ? last[last.length - 1]?.createdAt : undefined),
  });
  if (q.isLoading) return <Loading />;
  const rows = q.data?.pages.flat() ?? [];
  const who = (e: TeamEventRow) => (e.actor === 'you' ? t('pro.team.actor.you') : e.actor === 'client' ? t('pro.team.actor.client') : e.actor === 'system' ? t('pro.team.actor.system') : (e.actor ?? ''));
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <ErrorText error={q.error} />
      {rows.length === 0 ? <T variant="muted" center>{t('pro.team.journalEmpty')}</T> : null}
      {rows.map((e) => (
        <Card key={e.id} onPress={e.orderId ? () => router.push(`/order/${e.orderId ?? ''}`) : undefined}>
          <T variant="body" style={{ fontWeight: '600' }}>{t(`pro.team.event.${e.type}`, { defaultValue: e.type })}</T>
          <T variant="small">
            {[e.memberName ? `${e.memberName}${e.memberRole ? ` (${t(`pro.team.role.${e.memberRole}`)})` : ''}` : null, e.orderNumber !== null ? t('pro.order.number', { number: e.orderNumber }) : null]
              .filter(Boolean)
              .join(' · ')}
          </T>
          <T variant="small">{`${who(e)} · ${dateTime(e.createdAt)}`}</T>
        </Card>
      ))}
      {q.hasNextPage ? <Button title={t('pro.team.more')} variant="secondary" loading={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()} /> : null}
    </Screen>
  );
}
