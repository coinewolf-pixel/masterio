# Публикация в Google Play и App Store

Тексты лежат в `listings.py`, это единственный источник. `python3 store/listings.py` проверяет лимиты площадок и пишет файлы:

```
store/client/android/{en-US,ru-RU,hy-AM}/   title, short_description, full_description
store/client/ios/{en-US,ru}/                name, subtitle, keywords, promotional_text, description
store/worker/…                              то же для Masterio Pro
```

Google Play поддерживает армянский язык — в Play три языка. В App Store армянской локализации нет — там английский (основной) и русский.
Тексты вставляются в Play Console и App Store Connect вручную или через fastlane `supply` / `deliver` (структура папок совместима).

## Аккаунты для проверки

Проверяющие Apple и Google не получают SMS на наши номера. Поэтому:

1. Выберите 2–4 номера, которые не принадлежат реальным людям: один клиент, один мастер, для команд — ещё руководитель и участник.
2. На Railway в сервисе API задайте `REVIEW_PHONES=+374…,+374…` и `REVIEW_OTP_CODE=<6 случайных цифр>`. Для этих номеров SMS не отправляется, код постоянный.
3. Заказы тестового клиента получают **только** тестовые мастера, а заказы реальных клиентов к тестовым мастерам не приходят.
4. Подготовьте тестового мастера через CRM: войдите в Masterio Pro с его номером, загрузите любые фото документов и подтвердите их. Начислите стартовый баланс и выберите Ереван и все услуги.
5. После одобрения приложений уберите номера из `REVIEW_PHONES` (или оставьте только для следующих обновлений).

## Заметки для проверяющих (App Review Information / инструкции доступа в Play)

**Masterio (клиент):**
> Sign in with phone +374XXXXXXXX and code XXXXXX (no SMS is sent to this test number). To see the full flow: choose any service in Yerevan, set the address on the map and place an order. A test master account (see Masterio Pro notes) receives it; when the master accepts, you will see them on the live map. Payment is in cash to the master — there are no in-app purchases in the client app.

**Masterio Pro (мастер):**
> Sign in with phone +374XXXXXXXX and code XXXXXX. The account is verified and has a test balance. Tap "Online" to receive test orders (they are created from the client test account). Location: while online, the app shares the master's location so that the nearest master gets the order; during an active order it shares location every few seconds so the client can see the master arriving — the same as a taxi app. Location is not collected when the master is offline. Top-up of the prepaid commission balance is a payment for platform services (Stripe), not digital content.

## Google Play: декларации

**Фоновая геопозиция (только Masterio Pro)** — Policy → App content → Location permissions:
- Функция: *"Masters share their live location with the client during an active order (on the way, arrived) and while online to receive nearby orders. The client sees the master on a map with the arrival time, like in taxi apps."*
- Почему нужен фон: *"Masters drive to the address with a navigation app open, so our app is in the background exactly when the client needs to see the master's location."*
- Видео до 30 секунд: включение линии → принятие заказа → «Выехал» → открыт Google Maps → у клиента метка движется. Снимите на тестовых аккаунтах.
- Системное уведомление о передаче геопозиции во время заказа уже есть (foreground service на Android).

**Data safety** (обе программы; отличия у Masterio Pro отмечены):

| Данные | Собираются | Зачем | Передаются третьим лицам |
|---|---|---|---|
| Номер телефона | да, обязательно | вход, связь по заказу | Twilio (отправка SMS) |
| Имя | да | показ второй стороне заказа | нет |
| Точная геопозиция | да | адрес заказа; у Pro — подбор заказов и живая карта (фон) | нет |
| Фото | по желанию | фото проблемы, смета, споры | нет |
| Документы личности, лицензии, страховка | только Pro | проверка мастера | нет |
| Платёжные данные | только Pro, вводятся в форме Stripe | пополнение баланса | Stripe (обработчик платежей) |
| Сообщения в чате | да | связь по заказу, споры | нет |
| Идентификаторы устройства | да | push-уведомления, защита от мультиаккаунтов | Expo/Google/Apple (доставка push) |

- Данные шифруются при передаче (HTTPS/WSS).
- Пользователь может удалить аккаунт в приложении («Мои данные»). Записи, которые закон требует хранить, остаются обезличенными. Это нужно указать в анкете.
- Рекламы и продажи данных нет.

**Целевая аудитория:** 18+. **Категории:** Masterio — «Дом и интерьер» (House & Home), Masterio Pro — «Бизнес».

## App Store: App Privacy и требования

- **Privacy Nutrition Labels** — те же данные, что в таблице выше. Всё связано с личностью пользователя (Linked to you), для отслеживания (Tracking) не используется.
- **Удаление аккаунта** есть в приложении (требование 5.1.1(v)).
- **Фоновая геопозиция (Masterio Pro):** режим Location updates включён в сборке. Тексты разрешений на 5 языках — в `apps/worker/native-locales`.
- **Пополнение баланса картой (Masterio Pro)** — оплата услуг платформы для бизнеса, а не цифровой контент, поэтому Stripe, а не In-App Purchase (правило 3.1.3). Эту формулировку стоит повторить в заметках, если проверяющий спросит.
- **Ссылка на политику конфиденциальности** обязательна в обоих магазинах. Разместите опубликованный текст `PRIVACY_POLICY` на сайте (например `masterio.am/privacy`) до отправки на проверку.

## Скриншоты

Нужны: телефон 6,7″ и 6,5″ (iOS), телефон (Android); по 3–8 штук на язык. Сюжеты:

1. Masterio: главная с услугами → новый заказ с фото → «Рядом 5 мастеров» → живая карта с мастером → смета на подтверждение → оценка.
2. Masterio Pro: «На линии» → предложение заказа с таймером → активный заказ с кнопками → кошелёк по карманам → история за месяц → «Моя команда».

Снимите их на тестовых аккаунтах после выхода тестовой сборки. Подписи к ним — короткие фразы из `promotional_text` и разделов описания.
