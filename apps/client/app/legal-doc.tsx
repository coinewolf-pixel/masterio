import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { cases } from '../src/cases/api';
import { dateTime } from '../src/format';
import { ErrorText, Loading, Screen, T } from '../src/ui/components';
import { space } from '../src/ui/theme';

/** Текст документа. Markdown показывается просто: заголовки, абзацы, списки. */
export default function LegalDocScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ['legalText', id], queryFn: () => cases.legalText(id) });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <Screen><ErrorText error={q.error} /></Screen>;
  const blocks = q.data.body.split(/\n{2,}/);
  return (
    <Screen>
      <T variant="title">{t(`case.legal.audience.${q.data.audience}`)}</T>
      <T variant="small">{t('case.legal.versionFrom', { version: q.data.version, date: dateTime(q.data.publishedAt) })}</T>
      <View style={{ gap: space.md }}>
        {blocks.map((b, i) => {
          const heading = /^#{1,3}\s+/.test(b);
          const text = b.replace(/^#{1,3}\s+/, '').replace(/\*\*(.+?)\*\*/g, '$1');
          return (
            <T key={i} variant={heading ? 'h2' : 'body'}>
              {text}
            </T>
          );
        })}
      </View>
    </Screen>
  );
}
