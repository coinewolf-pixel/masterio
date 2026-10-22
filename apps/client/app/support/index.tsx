import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { cases } from '../../src/cases/api';
import { dateTime } from '../../src/format';
import { Button, Card, ErrorText, Loading, Screen, T } from '../../src/ui/components';
import { useColors } from '../../src/ui/theme';

/** Мои обращения в поддержку, включая споры и инциденты. */
export default function SupportListScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const q = useQuery({ queryKey: ['tickets'], queryFn: cases.tickets });
  if (q.isLoading) return <Loading />;
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Button title={t('case.support.new')} onPress={() => router.push('/support/new')} />
      <ErrorText error={q.error} />
      {q.data && q.data.length === 0 ? <T variant="muted" center>{t('case.support.empty')}</T> : null}
      {(q.data ?? []).map((tk) => (
        <Card key={tk.id} onPress={() => router.push({ pathname: '/support/[id]', params: { id: tk.id } })}>
          <T variant="h2">{tk.subject}</T>
          <T style={{ color: tk.status === 'PENDING_USER' ? c.primary : c.textMuted }}>{t(`case.support.status.${tk.status}`)}</T>
          {tk.lastMessage ? (
            <T variant="small">
              {tk.lastMessage.fromSupport ? `${t('case.dispute.support')}: ` : ''}
              {tk.lastMessage.body}
            </T>
          ) : null}
          <T variant="small">{dateTime(tk.updatedAt)}</T>
        </Card>
      ))}
    </Screen>
  );
}
