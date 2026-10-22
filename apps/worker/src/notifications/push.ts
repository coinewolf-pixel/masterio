import * as Application from 'expo-application';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '../api';
import { EAS_PROJECT_ID } from '../config';
import { deviceId } from '../device';
import { i18n } from '../i18n';

/** Показывать уведомления и когда приложение открыто (предложение заказа видно сразу). */
Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const type = (n.request.content.data as Record<string, unknown> | undefined)?.type;
    const silent = type === 'push.offer_closed';
    return { shouldShowBanner: !silent, shouldShowList: !silent, shouldPlaySound: !silent, shouldSetBadge: false };
  },
});

/** Каналы Android: «offers» — максимальная важность и звук для предложений заказов. */
export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('offers', {
    name: i18n.t('pro.notifications.offersChannel'),
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 400, 200, 400],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  await Notifications.setNotificationChannelAsync('default', {
    name: i18n.t('pro.notifications.defaultChannel'),
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/** Разрешение на уведомления и регистрация push-токена Expo на сервере. */
export async function registerForPush(): Promise<'granted' | 'denied' | 'unavailable'> {
  await ensureChannels();
  if (!Device.isDevice) return 'unavailable';
  const existing = await Notifications.getPermissionsAsync();
  const status = existing.granted ? existing : await Notifications.requestPermissionsAsync();
  if (!status.granted) return 'denied';
  if (!EAS_PROJECT_ID) return 'unavailable';
  const token = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
  await api.me.registerDevice({
    deviceId: await deviceId(),
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    pushToken: token.data,
    appVersion: Application.nativeApplicationVersion ?? undefined,
  });
  return 'granted';
}

/** Убрать уведомление о предложении, когда оно закрыто (истекло, принято другим, отменено). */
export async function dismissOfferNotification(offerId: string): Promise<void> {
  const shown = await Notifications.getPresentedNotificationsAsync();
  for (const n of shown) {
    const data = n.request.content.data as Record<string, unknown> | undefined;
    if (data?.offerId === offerId) await Notifications.dismissNotificationAsync(n.request.identifier);
  }
}
