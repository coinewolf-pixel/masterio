# Masterio Pro — приложение мастера (`apps/worker`)

React Native + Expo SDK 58, expo-router, TanStack Query, i18next (5 языков), Socket.IO, фоновая геопозиция, Stripe.

> Нужен общий пакет из `masterio-shared-phase-7.zip`, распакованный в `packages/shared` (см. корневой README).
> Перед запуском соберите его: `pnpm --filter @masterio/shared build` — конфиг приложения берёт имя Masterio Pro из `@masterio/shared`.

## Что умеет

- Вход по SMS-коду, выбор языка (en, ru, de, es, hy; по умолчанию — язык телефона), анкета: имя, независимый мастер или компания, услуги и города.
- Документы: удостоверение, селфи, лицензии по категориям — фото с камеры или из галереи, загрузка напрямую в закрытое хранилище, статус проверки.
- Онлайн/офлайн и понятные причины, почему заказы не приходят, с кнопками «Пополнить», «Загрузить документы».
- Предложение заказа поверх любого экрана: обратный отсчёт по **серверному** времени, «Принять» / «Отказаться», «Заказ уже недоступен».
- Активный заказ: маршрут в Google Maps, звонок и чат (телефоны и мессенджеры скрываются сервером), «Выехал» → «Прибыл» (только на месте) → «Начал работу», смета, «Завершил, получил наличными X», разбивка комиссии и скидки бонуса, отмена с причиной.
- Геопозиция в фоне: онлайн — раз в минуту/100 м, активный заказ — каждые ~5 с/10 м с уведомлением foreground service на Android. Без связи точки копятся на устройстве и отправляются при восстановлении.
- Кошелёк по карманам (пополнение, приветственный кредит со сроком, бонус со сроком, долг), пополнение картой через Stripe, история операций.
- История и заработок за месяц: сводка, сравнение с прошлым месяцем, прогресс бонуса, экспорт CSV, начисленные месячные бонусы.
- Споры, «клиент не вышел» (после ожидания, на месте, с фото), сообщение о происшествии с экстренным номером, поддержка, юридические документы и согласия, страховка с требованиями по стране, выгрузка и удаление своих данных.
- **Команда:** создать команду, пригласить помощника, сотрудника или второго мастера по номеру, видеть их проверку, лицензии, страховку и занятость, журнал. По принятому заказу — выбрать исполнителя из подходящих участников, заменить его (с согласием клиента), отозвать замену. Компания ведёт столько заказов одновременно, сколько у неё свободных проверенных исполнителей.
- **Режим участника:** приглашение видно сразу после входа; только назначенные заказы со статусами, сметой и наличными, геопозиция по назначенному заказу, без линии, предложений и кошелька.

## Переменные

Скопируйте `.env.example` в `.env`. Важно: `EXPO_PUBLIC_API_URL` — адрес вашего API на Railway (`https://<домен>/api/v1`).

## Запуск в разработке

Фоновая геопозиция, push и Stripe не работают в Expo Go — нужна dev-сборка.

```bash
pnpm install
pnpm --filter @masterio/shared build
cd apps/worker
npx expo prebuild                # создаёт android/ и ios/ из app.config.ts
npx expo run:android             # или: npx expo run:ios (нужен macOS с Xcode)
pnpm start                       # Metro для dev-клиента
```

С эмулятора Android локальный сервер доступен как `http://10.0.2.2:3000/api/v1`.

## Сборка release

**Через EAS (рекомендуется, без своего Android SDK и Mac):**
```bash
npm i -g eas-cli && eas login
eas init                                     # создаст проект и EAS_PROJECT_ID
eas env:create --name EXPO_PUBLIC_API_URL --value https://<домен>/api/v1 --environment production
eas build -p android --profile preview       # APK для установки на телефон
eas build -p android --profile production    # AAB для Google Play
eas build -p ios --profile production        # сборка для App Store (нужен Apple Developer)
eas submit -p android / eas submit -p ios
```

**Локально (нужен Android SDK, JDK 17):**
```bash
npx expo prebuild -p android
cd android && ./gradlew assembleRelease      # APK: android/app/build/outputs/apk/release/
./gradlew bundleRelease                      # AAB: android/app/build/outputs/bundle/release/
```
Для release-подписи создайте keystore и пропишите его в `android/app/build.gradle` (или используйте управляемые ключи EAS).

**iOS локально:** `npx expo prebuild -p ios && cd ios && pod install`, затем откройте `.xcworkspace` в Xcode, выберите команду разработчика и сделайте Archive.

## Push-уведомления

Приложение получает токен Expo Push и отправляет его на сервер; сервер шлёт уведомления через Expo (`PUSH_PROVIDER=expo` в API).
1. `eas init` → `EAS_PROJECT_ID` в `.env`.
2. Android: в Firebase создайте проект и загрузите ключ FCM V1 в EAS: `eas credentials -p android`.
3. iOS: загрузите APNs Auth Key (.p8) из Apple Developer: `eas credentials -p ios`.

## Проверки

```bash
pnpm typecheck
pnpm lint
pnpm test            # API-клиент (обновление токенов), буфер геопозиции, отсчёт по серверному времени, полнота переводов
pnpm bundle:check    # сборка JS-бандлов Android и iOS
node scripts/gen-native-locales.js   # обновить тексты системных разрешений после изменения переводов
```
