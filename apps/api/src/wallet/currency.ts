/** Валюта по стране, если у мастера ещё нет города. Города задают валюту явно (City.currency). */
const COUNTRY_CURRENCY: Record<string, string> = {
  AM: 'AMD',
  GB: 'GBP',
  CH: 'CHF',
  PL: 'PLN',
  CZ: 'CZK',
  SE: 'SEK',
  DK: 'DKK',
  NO: 'NOK',
  HU: 'HUF',
  RO: 'RON',
  GE: 'GEL',
};

export function currencyForCountry(countryCode: string): string {
  return COUNTRY_CURRENCY[countryCode.toUpperCase()] ?? 'EUR';
}
