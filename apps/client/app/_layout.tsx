import '../src/notifications/push';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '@masterio/shared';
import { NewOrderProvider } from '../src/draft/NewOrderProvider';
import { ClientEventsProvider } from '../src/events/ClientEventsProvider';
import { i18n, initI18n } from '../src/i18n';
import { RealtimeProvider } from '../src/realtime/RealtimeProvider';
import { SessionProvider } from '../src/session/SessionProvider';
import { useColors } from '../src/ui/theme';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      staleTime: 15_000,
    },
  },
});

function Navigator() {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.surface },
          headerTintColor: c.text,
          contentStyle: { backgroundColor: c.bg },
          headerBackTitle: t('client.common.back'),
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ title: t('client.onboarding.title') }} />
        <Stack.Screen name="new-order" options={{ title: t('client.newOrder.title') }} />
        <Stack.Screen name="address" options={{ title: t('client.address.title'), presentation: 'modal' }} />
        <Stack.Screen name="order/[id]" options={{ title: t('client.order.title') }} />
        <Stack.Screen name="order/chat" options={{ title: t('client.chat.title') }} />
        <Stack.Screen name="addresses" options={{ title: t('client.addresses.title') }} />
        <Stack.Screen name="legal" options={{ title: t('case.legal.screen'), headerBackVisible: false, gestureEnabled: false }} />
        <Stack.Screen name="legal-doc" options={{ title: t('case.legal.document') }} />
        <Stack.Screen name="dispute/new" options={{ title: t('case.dispute.newTitle') }} />
        <Stack.Screen name="dispute/[id]" options={{ title: t('case.dispute.title') }} />
        <Stack.Screen name="incident" options={{ title: t('case.incident.title') }} />
        <Stack.Screen name="support/index" options={{ title: t('case.support.title') }} />
        <Stack.Screen name="support/new" options={{ title: t('case.support.newTitle') }} />
        <Stack.Screen name="support/[id]" options={{ title: t('case.support.ticket') }} />
        <Stack.Screen name="privacy" options={{ title: t('case.privacy.title') }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void initI18n().finally(() => {
      setReady(true);
      void SplashScreen.hideAsync();
    });
  }, []);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <RealtimeProvider>
              <ClientEventsProvider>
                <NewOrderProvider>
                  <Navigator />
                </NewOrderProvider>
              </ClientEventsProvider>
            </RealtimeProvider>
          </SessionProvider>
        </QueryClientProvider>
      </I18nextProvider>
    </SafeAreaProvider>
  );
}
