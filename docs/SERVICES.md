# Внешние сервисы и ключи

| Сервис | Зачем | Что получить | Переменная | Когда нужно |
|---|---|---|---|---|
| Railway | Хостинг API, Postgres с PostGIS, Redis | Аккаунт, проект, сервисы PostGIS и Redis | `DATABASE_URL`, `REDIS_URL` | Сейчас |
| Twilio Verify | SMS-коды для входа | Account SID, Auth Token, Verify Service SID (VA…) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | Сейчас |
| Expo / EAS | Сборка приложений (APK, AAB, iOS) и доставка push через Expo Push Service | Аккаунт Expo, `eas init` (EAS_PROJECT_ID), ключ FCM V1 и APNs-ключ загружаются в EAS | `PUSH_PROVIDER=expo`, `EXPO_ACCESS_TOKEN` (необязательно), в приложении `EAS_PROJECT_ID` | Сейчас |
| Firebase Cloud Messaging | Доставка push на Android (через Expo) или напрямую (`PUSH_PROVIDER=fcm`) | Проект Firebase, ключ FCM V1 (сервисный аккаунт) | `FIREBASE_SERVICE_ACCOUNT_B64` — только для `fcm` | Сейчас |
| Stripe | Пополнение баланса мастеров картой | Secret key и Webhook signing secret (сервер), Publishable key (приложение) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; в Masterio Pro `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Сейчас |
| Stripe Connect | Выплаты мастерам за карточные заказы | Включённый Connect, проверка платформы Stripe | — | Позже (флаг `PAYOUTS_ENABLED`) |
| Google Maps Platform | Карты в приложениях, автокомплит адресов, ETA с пробками | API-ключи: Maps SDK for Android/iOS, Places API, Routes API (с ограничениями по приложению и серверу) | `GOOGLE_MAPS_API_KEY` (сервер: Routes, Places API (New), Geocoding); в Masterio `GOOGLE_MAPS_ANDROID_API_KEY`, `GOOGLE_MAPS_IOS_API_KEY` (Maps SDK) | Сейчас: без ключа Android-карта Masterio не показывается, а поиск адресов отключён (остаются GPS и карта на iOS) |
| MapTiler или Stadia Maps | Подложка живой карты в CRM | API-ключ, ограниченный доменом админки | `VITE_MAP_TILE_URL`, `VITE_MAP_ATTRIBUTION` (CRM) | Перед запуском (для разработки хватает OpenStreetMap) |
| Аутентификатор (Google Authenticator, 1Password) | Второй фактор входа в CRM | — | `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (первый суперадмин) | Сейчас |
| Sentry | Ошибки сервера и приложений | DSN проекта | `SENTRY_DSN` | Рекомендуется сейчас |
| S3-хранилище | Фото заказов, документы KYC, лицензии (закрытый бакет, временные ссылки) | Бакет и ключ доступа: **AWS S3** (рекомендуется, регион eu-central-1) или MinIO. Нужна поддержка presigned POST — Cloudflare R2 её не поддерживает и не подходит | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | Сейчас |
| Apple Developer / Google Play Console | Публикация Masterio и Masterio Pro | Аккаунты разработчика | — | Фаза 3–4 |

Ключи хранятся только в переменных окружения Railway. В репозиторий попадает лишь `.env.example` с описаниями.
