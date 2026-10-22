import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Redirect, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { RT_EVENTS } from '@masterio/shared';
import { cases } from '../../src/cases/api';
import { useRealtimeEvent } from '../../src/realtime/RealtimeProvider';
import { isTeamMember, needsOnboarding, useSession } from '../../src/session/SessionProvider';
import { Loading } from '../../src/ui/components';
import { useColors } from '../../src/ui/theme';
import { OfferSheet } from '../../src/work/OfferSheet';

export default function TabsLayout() {
  const { t } = useTranslation();
  const c = useColors();
  const { status, me, reloadMe } = useSession();
  // приняли в команду, исключили, новое приглашение — режим приложения меняется сразу
  useRealtimeEvent(RT_EVENTS.teamUpdated, () => {
    void reloadMe();
  });
  // условия для мастеров страны принимаются до выхода на линию (если они опубликованы)
  const legal = useQuery({ queryKey: ['legal', 'registration'], queryFn: () => cases.required('registration'), enabled: status === 'signedIn' && me !== null && !needsOnboarding(me), staleTime: 300_000 });
  if (status === 'loading') return <Loading />;
  if (status === 'signedOut') return <Redirect href="/(auth)/phone" />;
  if (me && needsOnboarding(me)) return <Redirect href="/onboarding" />;
  if (legal.data && legal.data.required.length > 0) return <Redirect href="/legal" />;
  // участник команды: без кошелька и истории заработка (баланс и комиссия — у руководителя)
  const member = isTeamMember(me);

  return (
    <>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: c.primary,
          tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
          headerStyle: { backgroundColor: c.surface },
          headerTintColor: c.text,
          sceneStyle: { backgroundColor: c.bg },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{ title: t('pro.tabs.work'), tabBarIcon: ({ color, size }) => <Ionicons name="briefcase-outline" color={color as string} size={size} /> }}
        />
        <Tabs.Screen
          name="history"
          options={{ href: member ? null : undefined, title: t('pro.tabs.history'), tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" color={color as string} size={size} /> }}
        />
        <Tabs.Screen
          name="wallet"
          options={{ href: member ? null : undefined, title: t('pro.tabs.wallet'), tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" color={color as string} size={size} /> }}
        />
        <Tabs.Screen
          name="profile"
          options={{ title: t('pro.tabs.profile'), tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" color={color as string} size={size} /> }}
        />
      </Tabs>
      {member ? null : <OfferSheet />}
    </>
  );
}
