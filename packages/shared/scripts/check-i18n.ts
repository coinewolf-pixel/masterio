/* Проверка переводов для CI: в каждом языке те же ключи и те же {{параметры}}, что в en. */
import { BASE_LOCALE, TRANSLATIONS, flattenKeys, placeholders, translate } from '../src/i18n';
import { ERROR_CODES } from '../src/errors';
import { LOCALES } from '../src/schemas';

const problems: string[] = [];
const baseKeys = new Set(flattenKeys(TRANSLATIONS[BASE_LOCALE]));

for (const code of ERROR_CODES) {
  if (!baseKeys.has(`errors.${code}`)) problems.push(`[${BASE_LOCALE}] missing errors.${code}`);
}

for (const locale of LOCALES) {
  const keys = new Set(flattenKeys(TRANSLATIONS[locale]));
  for (const key of baseKeys) {
    if (!keys.has(key)) {
      problems.push(`[${locale}] missing key: ${key}`);
      continue;
    }
    const expected = placeholders(translate(BASE_LOCALE, key)).join(',');
    const actual = placeholders(translate(locale, key)).join(',');
    if (expected !== actual) problems.push(`[${locale}] placeholders differ in ${key}: {${actual}} vs {${expected}}`);
    if (translate(locale, key).trim() === '') problems.push(`[${locale}] empty value: ${key}`);
  }
  for (const key of keys) {
    if (!baseKeys.has(key)) problems.push(`[${locale}] extra key not in ${BASE_LOCALE}: ${key}`);
  }
}

if (problems.length > 0) {
  console.error(`i18n check failed (${problems.length}):\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`i18n check passed: ${baseKeys.size} keys × ${LOCALES.length} languages`);
