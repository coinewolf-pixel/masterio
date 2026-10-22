import { Redirect } from 'expo-router';
import { needsOnboarding, useSession } from '../src/session/SessionProvider';
import { Loading } from '../src/ui/components';

/** Точка входа: вход по SMS → анкета (имя, категории, города) → основной экран. */
export default function Index() {
  const { status, me } = useSession();
  if (status === 'loading') return <Loading />;
  if (status === 'signedOut') return <Redirect href="/(auth)/phone" />;
  if (me && needsOnboarding(me)) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)" />;
}
