import { Redirect, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../src/session/SessionProvider';
import { useColors } from '../../src/ui/theme';

export default function AuthLayout() {
  const { status } = useSession();
  const { t } = useTranslation();
  const c = useColors();
  if (status === 'signedIn') return <Redirect href="/" />;
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: c.surface }, headerTintColor: c.text, contentStyle: { backgroundColor: c.bg } }}>
      <Stack.Screen name="phone" options={{ title: t('pro.auth.title') }} />
      <Stack.Screen name="code" options={{ title: t('pro.auth.codeTitle') }} />
    </Stack>
  );
}
