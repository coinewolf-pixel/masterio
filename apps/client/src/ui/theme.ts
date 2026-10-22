import { useColorScheme } from 'react-native';

const light = {
  bg: '#F6F7F5',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF2EF',
  text: '#16201C',
  textMuted: '#5C6A64',
  border: '#DCE3DF',
  primary: '#1F4E79',
  primaryText: '#FFFFFF',
  danger: '#C2410C',
  warning: '#B45309',
  success: '#15803D',
  online: '#16A34A',
  offline: '#6B7280',
};

const dark: typeof light = {
  bg: '#0F1412',
  surface: '#18201D',
  surfaceAlt: '#212B27',
  text: '#ECF2EF',
  textMuted: '#9AA9A2',
  border: '#2C3833',
  primary: '#7FB3E6',
  primaryText: '#071624',
  danger: '#F97316',
  warning: '#F59E0B',
  success: '#22C55E',
  online: '#22C55E',
  offline: '#9CA3AF',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 };

export const accent = '#FFC43D';
