import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RT_EVENTS } from '@masterio/shared';
import { api } from '../../src/api';
import type { ChatMessage } from '../../src/api/types';
import { dateTime } from '../../src/format';
import { useRealtimeEvent } from '../../src/realtime/RealtimeProvider';
import { useSession } from '../../src/session/SessionProvider';
import { Banner, Button, ErrorText, T } from '../../src/ui/components';
import { radius, space, useColors } from '../../src/ui/theme';

/** Чат только через приложение. Телефоны, ссылки и мессенджеры скрываются сервером. */
export default function ChatScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useSession();
  const queryClient = useQueryClient();
  const messages = useQuery({ queryKey: ['chat', id], queryFn: () => api.orders.messages(id), refetchInterval: 30_000 });
  const [text, setText] = useState('');
  const [warning, setWarning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);

  useRealtimeEvent<{ orderId: string }>(RT_EVENTS.chatMessage, (p) => {
    if (p.orderId === id) void queryClient.invalidateQueries({ queryKey: ['chat', id] });
  });

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      const res = await api.orders.send(id, body);
      setText('');
      setWarning(res.filtered);
      await queryClient.invalidateQueries({ queryKey: ['chat', id] });
    } catch (e) {
      setError(e);
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <View style={{ padding: space.md }}>
          <Banner text={t('chat.off_platform_warning')} tone={warning ? 'warning' : 'info'} />
        </View>
        <FlatList<ChatMessage>
          inverted
          data={messages.data ?? []}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: space.md, gap: space.sm }}
          renderItem={({ item }) => {
            const mine = item.senderId === me?.id;
            return (
              <View style={[styles.bubble, { alignSelf: mine ? 'flex-end' : 'flex-start', backgroundColor: mine ? c.primary : c.surface, borderColor: c.border }]}>
                <T style={{ color: mine ? c.primaryText : c.text }}>{item.body}</T>
                <T variant="small" style={{ color: mine ? c.primaryText : c.textMuted }}>{dateTime(item.createdAt)}</T>
              </View>
            );
          }}
        />
        <ErrorText error={error} />
        <View style={[styles.composer, { borderTopColor: c.border, backgroundColor: c.surface }]}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('client.chat.placeholder')}
            placeholderTextColor={c.textMuted}
            style={[styles.input, { color: c.text, borderColor: c.border }]}
            multiline
            maxLength={2_000}
          />
          <Button title={t('client.chat.send')} onPress={() => void send()} loading={sending} disabled={!text.trim()} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '80%', padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, padding: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, fontSize: 16 },
});
