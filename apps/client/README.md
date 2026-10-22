# Masterio — приложение клиента (`apps/client`)

React Native + Expo SDK 58, expo-router, TanStack Query, i18next (5 языков), Socket.IO, react-native-maps.

> Нужен общий пакет из `masterio-shared-phase-7.zip`, распакованный в `packages/shared` (см. корневой README).
> Перед запуском соберите его: `pnpm --filter @masterio/shared build` — конфиг приложения берёт имя Masterio из `@masterio/shared`.

## Что умеет

- Вход по SMS-коду, язык телефона по умолчанию (en, ru, de, es, hy), переключение в профиле; клиенту достаточно имени.
- Главная: активные заказы сверху, услуги по группам — срочные первыми.
- Новый заказ: описание, фото проблемы (камера/галерея, загрузка прямо в закрытое хранилище), адрес, «как можно скорее» или время, оплата (наличные; карта появится, когда её включат флагом), сразу видно, сколько свободных мастеров рядом.
- Адрес: поиск с подсказками Google, «моё местоположение» по GPS, уточнение на карте перетаскиванием, подъезд/этаж/квартира, сохранение адреса.
- Заказ: поиск мастера по очереди, «мастеров нет» → расширить радиус / искать снова / бесплатная отмена; карточка мастера (рейтинг, значки «личность проверена», «лицензия», «своя страховка»), звонок и чат.
- **Живая карта как в такси:** машина мастера плавно едет и поворачивается по направлению движения, пройденный путь, пунктир до адреса, расстояние и время прибытия, «связь потеряна» при отсутствии точек; карта держит в кадре мастера и адрес, пока её не сдвинули (кнопка «вернуть»).
- Смета: утвердить / отклонить; подтверждение «оплатил наличными X» — расхождение с суммой мастера открывает спор; отзыв со звёздами; «не предлагать мои заказы этому мастеру».
- Отмена с причиной и заранее показанной стоимостью; экстренный номер страны на экране заказа.
- Мои заказы за месяц: сколько заказов и сколько потрачено, исполнитель и сумма, «повторить заказ».
- Push: статусы заказа, мастер в пути и на месте, новая смета; нажатие открывает заказ.
- Споры с фото, сообщение о происшествии (сначала экстренный номер), поддержка, юридические документы и согласия, выгрузка и удаление своих данных.
- Команды мастеров: кто фактически приедет (имя, роль, значки, без документов), согласие или отказ на замену исполнителя, «Пришёл другой человек» — заказ останавливается и открывается спор.

## Переменные

Скопируйте `.env.example` в `.env`:

| Переменная | Что это |
|---|---|
| `EXPO_PUBLIC_API_URL` | адрес API на Railway: `https://<домен>/api/v1` |
| `GOOGLE_MAPS_ANDROID_API_KEY` | ключ Maps SDK for Android (ограничьте по пакету `com.masterio.client` и SHA-1 подписи) — без него карта на Android пустая |
| `GOOGLE_MAPS_IOS_API_KEY` | ключ Maps SDK for iOS; если пусто — на iPhone используется Apple Maps |
| `EAS_PROJECT_ID` | id проекта Expo (`eas init`) — нужен для push |

Подсказки адресов идут через сервер (ключ `GOOGLE_MAPS_API_KEY` в API с включёнными Places API (New) и Geocoding API) — в приложении серверного ключа нет.

## Запуск в разработке

Push и карты Google не работают в Expo Go — нужна dev-сборка.

```bash
pnpm install
pnpm --filter @masterio/shared build
cd apps/client
npx expo prebuild                # создаёт android/ и ios/ из app.config.ts
npx expo run:android             # или: npx expo run:ios (нужен macOS с Xcode)
pnpm start                       # Metro для dev-клиента
```

С эмулятора Android локальный сервер доступен как `http://10.0.2.2:3000/api/v1`.
Чтобы увидеть живую карту, войдите в Masterio Pro на втором телефоне (или эмуляторе) мастером, примите заказ и нажмите «Выехал».

## Сборка release

**Через EAS (рекомендуется):**
```bash
npm i -g eas-cli && eas login
eas init
eas env:create --name EXPO_PUBLIC_API_URL --value https://<домен>/api/v1 --environment production
eas env:create --name GOOGLE_MAPS_ANDROID_API_KEY --value <ключ> --environment production --visibility sensitive
eas env:create --name GOOGLE_MAPS_IOS_API_KEY --value <ключ> --environment production --visibility sensitive
eas build -p android --profile preview       # APK для установки на телефон
eas build -p android --profile production    # AAB для Google Play
eas build -p ios --profile production        # App Store (нужен Apple Developer)
eas submit -p android / eas submit -p ios
```

**Локально (Android SDK, JDK 17):**
```bash
npx expo prebuild -p android
cd android && ./gradlew assembleRelease      # APK: android/app/build/outputs/apk/release/
./gradlew bundleRelease                      # AAB: android/app/build/outputs/bundle/release/
```
Для release-подписи создайте keystore (или используйте управляемые ключи EAS) и добавьте SHA-1 подписи в ограничения ключа Google Maps.

**iOS локально:** `npx expo prebuild -p ios && cd ios && pod install`, затем Archive в Xcode.

## Push-уведомления

Как в Masterio Pro: `eas init` → `EAS_PROJECT_ID`, ключ FCM V1 (`eas credentials -p android`) и APNs-ключ (`eas credentials -p ios`); на сервере `PUSH_PROVIDER=expo`.

## Проверки

```bash
pnpm typecheck
pnpm lint
pnpm test            # плавное движение метки, азимут, кадр карты, ETA, выбор города, форматирование, полнота переводов
pnpm bundle:check    # сборка JS-бандлов Android и iOS
node scripts/gen-native-locales.js   # обновить тексты системных разрешений после изменения переводов
```
