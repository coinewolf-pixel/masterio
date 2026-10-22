# Запуск в Армении — пошаговый план

Порядок важен: сначала сервер и CRM, потом приложения (им нужен адрес API), в конце — магазины.
Ключи вставляются только в Railway, EAS и секреты GitHub. В репозиторий они не попадают.

## 0. Что нужно заранее

| Аккаунт | Для чего | Есть |
|---|---|---|
| GitHub (приватный репозиторий) | код, проверки CI, сборки приложений | ✓ |
| Railway | API, CRM, Postgres + PostGIS, Redis | ✓ |
| AWS | S3-бакет для фото и документов (регион `eu-central-1`) | нужен |
| Twilio | SMS-коды (Verify) | ✓ |
| Stripe | пополнение баланса мастеров картой | ✓ |
| Expo | сборка приложений и доставка push | ✓ |
| Apple Developer, Google Play Console | публикация двух приложений | ✓ |
| Google Cloud | ключи карт и поиска адресов | нужен |
| Firebase | ключ FCM V1 для push на Android (загружается в Expo) | нужен |
| MapTiler или Stadia Maps | подложка карты в CRM | нужен |
| Юрист в Армении | тексты условий и политики конфиденциальности | нужен |

**Cloudflare R2 не подходит**: приложения загружают файлы через presigned POST, а R2 его не поддерживает. Используйте AWS S3.

## 1. Секреты (один раз)

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 32   # PII_ENCRYPTION_KEY — сохраните в менеджере паролей: без него имена пользователей не расшифровать
```

`PII_ENCRYPTION_KEY` после запуска не меняется. Если его потерять, зашифрованные имена восстановить нельзя.

## 2. Хранилище (AWS S3)

1. S3 → Create bucket, например `masterio-prod-files`, регион `eu-central-1`, **Block all public access — включено**.
2. IAM → пользователь `masterio-api` с политикой только на этот бакет: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket`.
3. Access key этого пользователя → `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. `S3_ENDPOINT` пустой, `S3_REGION=eu-central-1`, `S3_FORCE_PATH_STYLE=false`.

## 3. Railway: база, Redis, API

1. New Project → Deploy from GitHub repo → ваш репозиторий. Railway найдёт `railway.json` в корне: сборка по `apps/api/Dockerfile`, проверка `/api/v1/health`, пересборка только при изменениях API или общего пакета.
2. Add Service → **PostGIS** (шаблон Railway). Add Service → **Redis**; у сервиса Redis должен быть том (Volume), чтобы таймеры переживали перезапуск.
3. Переменные сервиса API:

| Переменная | Значение |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | ссылка на PostGIS: `${{PostGIS.DATABASE_URL}}` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `PUBLIC_URL` | `https://<домен API>` (после шага 4) |
| `CORS_ORIGINS` | `https://<домен CRM>` (после шага 5) |
| `JWT_ACCESS_SECRET`, `PII_ENCRYPTION_KEY` | из шага 1 |
| `SMS_PROVIDER` / `TWILIO_*` | `twilio` и три ключа из шага 6 |
| `PUSH_PROVIDER` | `expo` (`EXPO_ACCESS_TOKEN` — если включите Enhanced Security в Expo) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | из шага 7 |
| `S3_*` | из шага 2 |
| `GOOGLE_MAPS_API_KEY` | серверный ключ из шага 8 |
| `SENTRY_DSN` | желательно |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_COUNTRY=AM` | первый суперадмин |
| `REVIEW_PHONES`, `REVIEW_OTP_CODE` | тестовые аккаунты для проверки в магазинах (шаг 10) |

Без SMS-провайдера, push, S3 и Stripe сервер в режиме `production` не стартует и пишет в логе, чего не хватает.

4. Settings → Networking → Generate Domain (или свой, например `api.masterio.am`). Проверка: `https://<домен>/api/v1/health` → `{"status":"ok"}`.
5. Начальные данные — один раз, с компьютера с установленным Railway CLI:

```bash
railway link                                    # выбрать проект и сервис API
railway run pnpm --filter @masterio/api seed    # услуги на 5 языках, ступени бонусов, суперадмин; печатает ссылку для TOTP — один раз
railway run pnpm --filter @masterio/api launch:am
```

`launch:am` создаёт 7 городов Армении (Ереван, Гюмри, Ванадзор, Вагаршапат, Абовян, Раздан, Капан) с номером 112. Он прячет демо-города других стран и задаёт денежные пороги в драмах для страны AM. Каждое изменение пишется в историю настроек. После него перезапустите сервис API.

Стартовые суммы (меняются в CRM → Настройки → уровень «Страна: AM»):

| Настройка | AMD |
|---|---|
| Минимальный баланс для наличных заказов | 8 000 |
| Лимит долга | 12 000 |
| Максимум наличного заказа (новый мастер) | 200 000 (80 000) |
| Штраф клиента: принят / в пути | 1 000 / 3 000 |
| Компенсация выезда | 6 000 |
| Приветственный кредит (кнопки) | 20 000 / 40 000 |
| Пополнение: минимум / максимум | 4 000 / 200 000 |

Это пересчёт с евро по курсу ~408 AMD. Цены услуг в Армении ниже европейских — проверьте пороги на первых неделях.

## 4. Railway: CRM

1. New Service → тот же репозиторий. Settings → Config-as-code → путь `/apps/admin/railway.json`.
2. Variables: `VITE_API_URL=https://<домен API>/api/v1`, `VITE_MAP_TILE_URL` и `VITE_MAP_ATTRIBUTION` (MapTiler или Stadia, ключ ограничьте доменом CRM).
3. Generate Domain (например `crm.masterio.am`) → этот адрес в `CORS_ORIGINS` сервиса API.
4. Вход: email и пароль суперадмина и код из приложения-аутентификатора. Сразу создайте отдельных админов с ролями support, moderator, finance.

## 5. Twilio Verify

1. Verify → Services → Create, имя «Masterio», длина кода 6 → `TWILIO_VERIFY_SERVICE_SID` (VA…).
2. **Geo Permissions** для Verify: разрешите Армению (+374). Иначе SMS туда не уйдут. Включите Fraud Guard.
3. Account SID и Auth Token → `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`.
4. Проверка: вход в Masterio по армянскому номеру приходит за несколько секунд.

## 6. Stripe

1. Live-режим. Валюта пополнения — AMD (у Stripe двухзнаковая: 4 000 драмов = `400000`). Минимальный платёж Stripe считается в валюте выплат вашего аккаунта. 4 000 AMD выше минимума для AED, EUR и USD.
2. Developers → API keys: Secret key → `STRIPE_SECRET_KEY` (Railway), Publishable key `pk_live_…` → `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` (EAS, только Masterio Pro).
3. Webhooks → Add endpoint `https://<домен API>/api/v1/webhooks/stripe`, события: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.dispute.created`. Signing secret → `STRIPE_WEBHOOK_SECRET`.
4. Проверка: пополнение на 4 000 AMD реальной картой → в CRM → Финансы видна операция, «журнал сходится».

## 7. Google Maps

Google Cloud → проект Masterio → включите Maps SDK for Android, Maps SDK for iOS, Places API (New), Routes API, Geocoding API. Три ключа:

| Ключ | Ограничение | Куда |
|---|---|---|
| Сервер | по IP недоступно на Railway — ограничьте по API (Places, Routes, Geocoding) | `GOOGLE_MAPS_API_KEY` (Railway) |
| Android | приложения `com.masterio.client`, `com.masterio.pro` + SHA-1 из EAS (`eas credentials`) | `GOOGLE_MAPS_ANDROID_API_KEY` (EAS) |
| iOS | bundle id `com.masterio.client`, `com.masterio.pro` | `GOOGLE_MAPS_IOS_API_KEY` (EAS) |

Поставьте бюджет и оповещения о расходах в Google Cloud Billing.

## 8. Expo (EAS) и push

1. На своём компьютере (один раз):
   ```bash
   npm i -g eas-cli && eas login
   cd apps/client && eas init      # проект Masterio → покажет projectId
   cd ../worker && eas init        # проект Masterio Pro
   ```
2. На expo.dev для **каждого** проекта → Environment variables, окружения `preview` и `production`:
   - `EXPO_PUBLIC_API_URL=https://<домен API>/api/v1`
   - `EAS_PROJECT_ID=<id проекта>`
   - `GOOGLE_MAPS_ANDROID_API_KEY`, `GOOGLE_MAPS_IOS_API_KEY`
   - Masterio Pro: `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`, по желанию `EXPO_PUBLIC_APPLE_MERCHANT_ID`

   Без HTTPS-адреса API и id проекта (а для Masterio Pro в production — без `pk_live_`) сборка остановится с понятной ошибкой. Так приложение не попадёт к людям с локальным адресом.
3. Push на Android: Firebase → проект → Service accounts → новый ключ (JSON) → `eas credentials -p android` → Google Service Account Key for FCM V1, для обоих проектов.
4. Push на iOS: `eas credentials -p ios` → Push Notifications key (EAS создаст ключ APNs в вашем Apple-аккаунте).
5. GitHub → Settings → Secrets and variables → Actions:
   - секрет `EXPO_TOKEN` (expo.dev → Account settings → Access tokens);
   - переменные `CLIENT_EAS_PROJECT_ID`, `WORKER_EAS_PROJECT_ID`.

## 9. Сборки

GitHub → Actions → **Release apps (EAS)** → Run workflow:

1. `profile: preview`, `platform: android` → APK обоих приложений для тестеров (ссылки на expo.dev).
2. Пройдите на реальных телефонах `CHECKLIST.md`: разделы «Masterio Pro на телефоне», «Masterio на телефоне», фазы 6 и 7. Особенно фоновую геопозицию и push.
3. `profile: production`, `platform: all`, `submit: true` → AAB во внутренний тест Google Play и сборка iOS в TestFlight.

## 10. Магазины

Всё для публикации — в `store/README.md`:
- тексты описаний на армянском, русском и английском с проверкой лимитов (`store/listings.py`);
- тестовые аккаунты для проверяющих: `REVIEW_PHONES` и `REVIEW_OTP_CODE` в Railway; заказы тестовых аккаунтов изолированы от реальных пользователей;
- заметки для проверяющих Apple и Google;
- декларация фоновой геопозиции для Google Play и ответы Data safety и App Privacy;
- список скриншотов.

Перед отправкой на проверку разместите политику конфиденциальности на сайте — ссылка обязательна в обоих магазинах.

## 11. Юридические документы для Армении

Без опубликованных документов приложения пускают пользователей без экрана согласия. До открытия для людей опубликуйте в CRM → Юридические документы для страны **AM** на 5 языках:

| Документ | Кому |
|---|---|
| Условия для клиентов (`CLIENT`) | Masterio |
| Условия для самостоятельных мастеров (`INDEPENDENT_WORKER`), для компаний (`COMPANY`) | Masterio Pro |
| Условия для команд (`TEAM_MEMBER`) | участники и руководители команд |
| Условия пополнения баланса (`TOPUP_TERMS`) | Masterio Pro |
| Политика конфиденциальности (`PRIVACY_POLICY`) | все |
| Правила споров, происшествий, требования к страховке | для ознакомления |

Тексты готовит юрист. Он учитывает армянский закон о защите персональных данных, налоговый статус мастеров, расчёты наличными и то, что пополнение — предоплата услуг платформы. Публикация без имени проверившего юриста невозможна.

## 12. Перед открытием

- [ ] `/api/v1/health` в порядке, в логах нет ошибок, Sentry получает события.
- [ ] Резервные копии PostGIS включены (Railway → база → Backups), восстановление проверено один раз.
- [ ] CRM: финансы → «Журнал сходится».
- [ ] Реальный путь по `CHECKLIST.md` на двух телефонах: заказ, живая карта, наличные, комиссия, спор, команда.
- [ ] Стартовые кредиты для первых мастеров начислены через CRM (50/100 → в драмах 20 000 / 40 000).
- [ ] Поддержка (support) дежурит в CRM в первые дни, очереди тикетов и споров пустые.
