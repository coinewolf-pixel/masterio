import * as Application from 'expo-application';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '../api';
import { EAS_PROJECT_ID } from '../config';
import { deviceId } from '../device';
import { i18n } from '../i18n';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/** Каналы Android: «offers» — важные события заказа (мастер выехал, рядом, прибыл), «default» — остальное. */
export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('offers', {
    name: i18n.t('client.notifications.orderChannel'),
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
  });
  await Notifications.setNotificationChannelAsync('default', {
    name: i18n.t('client.notifications.defaultChannel'),
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/** Разрешение на уведомления и регистрация push-токена на сервере. */
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
