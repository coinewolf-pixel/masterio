import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '@masterio/shared';
import { radius, space, useColors } from './theme';

export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  padded = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  padded?: boolean;
}) {
  const c = useColors();
  const content = <View style={[padded && styles.padded, { gap: space.md }]}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['left', 'right', 'bottom']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: space.xxl }}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} tintColor={c.primary} /> : undefined}
        >
          {content}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, padded && styles.padded]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

type TextVariant = 'title' | 'h2' | 'body' | 'muted' | 'small' | 'money';

export function T({ children, variant = 'body', style, center }: { children: ReactNode; variant?: TextVariant; style?: TextStyle; center?: boolean }) {
  const c = useColors();
  const base: Record<TextVariant, TextStyle> = {
    title: { fontSize: 26, fontWeight: '700', color: c.text },
    h2: { fontSize: 18, fontWeight: '600', color: c.text },
    body: { fontSize: 16, color: c.text },
    muted: { fontSize: 15, color: c.textMuted },
    small: { fontSize: 13, color: c.textMuted },
    money: { fontSize: 22, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] },
  };
  return <Text style={[base[variant], center && { textAlign: 'center' }, style]}>{children}</Text>;
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: ViewStyle; onPress?: () => void }) {
  const c = useColors();
  const body = <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }, style]}>{children}</View>;
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const c = useColors();
  const bg = variant === 'primary' ? c.primary : variant === 'danger' ? c.danger : variant === 'secondary' ? c.surfaceAlt : 'transparent';
  const fg = variant === 'primary' ? c.primaryText : variant === 'danger' ? '#FFFFFF' : variant === 'ghost' ? c.primary : c.text;
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: inactive ? 0.55 : pressed ? 0.85 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontSize: 16, fontWeight: '600' }}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string | null }) {
  const c = useColors();
  return (
    <View style={{ gap: space.xs }}>
      <T variant="small">{label}</T>
      <TextInput
        placeholderTextColor={c.textMuted}
        {...props}
        style={[styles.input, { color: c.text, backgroundColor: c.surface, borderColor: error ? c.danger : c.border }, props.style]}
      />
      {error ? <T variant="small" style={{ color: c.danger }}>{error}</T> : null}
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      style={[styles.chip, { backgroundColor: selected ? c.primary : c.surface, borderColor: selected ? c.primary : c.border }]}
    >
      <Text style={{ color: selected ? c.primaryText : c.text, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

export function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <T variant={strong ? 'body' : 'muted'} style={{ flex: 1 }}>{label}</T>
      <T variant="body" style={{ fontWeight: strong ? '700' : '500', fontVariant: ['tabular-nums'] }}>{value}</T>
    </View>
  );
}

export function Banner({ text, tone = 'info' }: { text: string; tone?: 'info' | 'warning' | 'danger' | 'success' }) {
  const c = useColors();
  const color = tone === 'danger' ? c.danger : tone === 'warning' ? c.warning : tone === 'success' ? c.success : c.primary;
  return (
    <View style={[styles.banner, { borderColor: color, backgroundColor: c.surface }]}>
      <Text style={{ color, fontSize: 15 }}>{text}</Text>
    </View>
  );
}

/** Перевод ошибки API по её ключу; неизвестные — общий текст. */
export function useErrorText(): (error: unknown) => string {
  const { t } = useTranslation();
  return (error: unknown) => {
    if (error instanceof ApiError) return t(error.messageKey, { defaultValue: t('errors.INTERNAL') });
    return t('errors.INTERNAL');
  };
}

export function ErrorText({ error }: { error: unknown }) {
  const text = useErrorText();
  const c = useColors();
  if (!error) return null;
  return <T variant="small" style={{ color: c.danger }}>{text(error)}</T>;
}

export function Loading() {
  const c = useColors();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, backgroundColor: c.bg }}>
      <ActivityIndicator color={c.primary} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  padded: { padding: space.lg },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg, gap: space.sm },
  button: { minHeight: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  input: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md, fontSize: 17 },
  chip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 2 },
  banner: { borderLeftWidth: 4, borderRadius: radius.sm, padding: space.md },
});
