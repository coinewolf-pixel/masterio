/* Генерирует native-locales/*.json (тексты системных разрешений iOS и имя приложения) из общих переводов.
   Запуск: node scripts/gen-native-locales.js — тест проверяет, что файлы не устарели. */
const fs = require('node:fs');
const path = require('node:path');

const LOCALES = ['en', 'ru', 'de', 'es', 'hy'];
const NAME = 'Masterio';

function build(locale) {
  const dict = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../packages/shared/src/locales', `${locale}.json`), 'utf8'));
  const p = dict.client.permissions;
  return {
    ios: {
      CFBundleDisplayName: NAME,
      NSLocationWhenInUseUsageDescription: p.location,
      NSCameraUsageDescription: p.camera,
      NSPhotoLibraryUsageDescription: p.photos,
    },
    android: { app_name: NAME },
  };
}

module.exports = { build, LOCALES };

if (require.main === module) {
  for (const l of LOCALES) {
    fs.writeFileSync(path.join(__dirname, '..', 'native-locales', `${l}.json`), `${JSON.stringify(build(l), null, 2)}\n`);
  }
  console.log('native-locales updated');
}
