import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { api } from '../../src/api';
import type { OrderStatus } from '../../src/api/types';
import { useDraft } from '../../src/draft/NewOrderProvider';
import { localized } from '../../src/format';
import { useSession } from '../../src/session/SessionProvider';
import { Card, Loading, Screen, T } from '../../src/ui/components';
import { radius, space, useColors } from '../../src/ui/theme';

const OPEN: OrderStatus[] = ['SEARCHING', 'NO_WORKERS', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED_BY_WORKER', 'DISPUTED'];

const GROUP_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  urgent: 'flash-outline',
  auto: 'car-outline',
  home: 'home-outline',
  moving: 'cube-outline',
  extra: 'leaf-outline',
};

/** Главная: активные заказы сверху, затем категории по группам (срочные — первыми). */
export default function HomeScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { me } = useSession();
  const { reset } = useDraft();
  const groups = useQuery({ queryKey: ['categories'], queryFn: () => api.catalog.categories(), staleTime: 3_600_000 });
  const orders = useQuery({ queryKey: ['orders'], queryFn: api.orders.active, refetchInterval: 30_000 });

  const open = (orders.data ?? []).filter((o) => OPEN.includes(o.status as OrderStatus));
  const sorted = [...(groups.data ?? [])].sort((a, b) => (a.code === 'urgent' ? -1 : b.code === 'urgent' ? 1 : 0));
  const allCategories = (groups.data ?? []).flatMap((g) => g.categories);

  if (groups.isLoading) return <Loading />;

  return (
    <Screen refreshing={orders.isRefetching} onRefresh={() => void Promise.all([orders.refetch(), groups.refetch()])}>
      <T variant="title">{t('client.home.hello', { name: me?.firstName ?? '' })}</T>
      <T variant="muted">{t('client.home.subtitle')}</T>

      {open.map((o) => (
        <Card key={o.id} onPress={() => router.push(`/order/${o.id}`)} style={{ borderColor: c.primary, borderWidth: 1.5 }}>
          <T variant="small">{t('client.home.activeOrder')}</T>
          <T variant="h2">{localized(allCategories.find((x) => x.id === o.categoryId)?.names)}</T>
          <T style={{ color: c.primary }}>{t(`order.status.${o.status}`)}</T>
        </Card>
      ))}

      {sorted.map((g) => (
        <View key={g.id} style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Ionicons name={GROUP_ICONS[g.code] ?? 'construct-outline'} size={20} color={g.code === 'urgent' ? c.danger : c.primary} />
            <T variant="h2">{localized(g.names)}</T>
          </View>
          <View style={styles.grid}>
            {g.categories.map((cat) => (
              <Pressable
                key={cat.id}
                accessibilityRole="button"
                onPress={() => {
                  reset(cat.id);
                  router.push('/new-order');
                }}
                style={({ pressed }) => [
                  styles.tile,
                  { backgroundColor: c.surface, borderColor: cat.isUrgent ? c.danger : c.border, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <T variant="body" style={{ fontWeight: '600' }}>{localized(cat.names)}</T>
                {cat.isUrgent ? <T variant="small" style={{ color: c.danger }}>{t('client.home.urgent')}</T> : null}
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { width: '48%', minHeight: 72, borderRadius: radius.md, borderWidth: 1, padding: space.md, justifyContent: 'center', gap: 2 },
});
