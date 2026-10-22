import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'masterio.deviceId';

/** Устойчивый id устройства: ANDROID_ID / identifierForVendor, иначе случайный и сохранённый. */
export async function deviceId(): Promise<string> {
  const saved = await SecureStore.getItemAsync(KEY);
  if (saved) return saved;
  let id: string | null = null;
  try {
    id = Platform.OS === 'android' ? Application.getAndroidId() : await Application.getIosIdForVendorAsync();
  } catch {
    id = null;
  }
  const value = id && id.length >= 8 ? `${Platform.OS}-${id}` : `${Platform.OS}-${Crypto.randomUUID()}`;
  await SecureStore.setItemAsync(KEY, value);
  return value;
}
