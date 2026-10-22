import brand from './brand.json';

/**
 * Единственное место, где заданы имена платформы и приложений (src/brand.json). JSON читают и код, и app.config.ts
 * приложений: конфиг Expo загружается на сервере сборки до любых шагов сборки, поэтому не зависит от dist/.
 */
export const BRAND = brand as {
  readonly platform: 'Masterio';
  readonly clientApp: { readonly name: string; readonly bundleId: string; readonly scheme: string };
  readonly workerApp: { readonly name: string; readonly bundleId: string; readonly scheme: string };
  readonly admin: { readonly name: string };
};

export type AppType = 'client' | 'worker';
