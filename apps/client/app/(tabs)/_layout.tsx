import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Redirect, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { cases } from '../../src/cases/api';
import { needsOnboarding, useSession } from '../../src/session/SessionProvider';
import { Loading } from '../../src/ui/components';
import { useColors } from '../../src/ui/theme';

export default function TabsLayout() {
  const { t } = useTranslation();
  const c = useColors();
  const { status, me } = useSession();
  // действующие условия страны нужно принять до работы с приложением (если они опубликованы)
  const legal = useQuery({ queryKey: ['legal', 'registration'], queryFn: () => cases.required('registration'), enabled: status === 'signedIn' && me !== null && !needsOnboarding(me), staleTime: 300_000 });
  if (status === 'loading') return <Loading />;
  if (status === 'signedOut') return <Redirect href="/(auth)/phone" />;
  if (me && needsOnboarding(me)) return <Redirect href="/onboarding" />;
  if (legal.data && legal.data.required.length > 0) return <Redirect href="/legal" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.primary,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.text,
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('client.tabs.home'), tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color as string} size={size} /> }} />
      <Tabs.Screen name="orders" options={{ title: t('client.tabs.orders'), tabBarIcon: ({ color, size }) => <Ionicons name="receipt-outline" color={color as string} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: t('client.tabs.profile'), tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" color={color as string} size={size} /> }} />
    </Tabs>
  );
}
