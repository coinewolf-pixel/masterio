import { Redirect } from 'expo-router';
import { needsOnboarding, useSession } from '../src/session/SessionProvider';
import { Loading } from '../src/ui/components';

/** Точка входа: вход по SMS → приглашение в команду (если есть) → анкета → основной экран. */
export default function Index() {
  const { status, me } = useSession();
  if (status === 'loading') return <Loading />;
  if (status === 'signedOut') return <Redirect href="/(auth)/phone" />;
  // приглашение в команду показывается до анкеты: участнику услуги и города не нужны
  if (me && !me.team && me.pendingInvites > 0 && needsOnboarding(me)) return <Redirect href="/team/invites" />;
  if (me && needsOnboarding(me)) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)" />;
}
