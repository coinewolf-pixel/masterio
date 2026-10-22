# Masterio API — контракт

Базовый путь `/api/v1`. Авторизация: `Authorization: Bearer <access JWT>` (15 минут), refresh — 30 дней, одноразовый.
Тела запросов описаны zod-схемами в `@masterio/shared/schemas.ts`; Swagger в разработке — `/docs`.
Ошибки: `{ "code": "ORDER_ALREADY_TAKEN", "messageKey": "errors.ORDER_ALREADY_TAKEN", "details"?: … }` — приложение показывает перевод по ключу.
Деньги — целые числа в минимальных единицах валюты (центы). Роли: C — клиент, W — мастер, A — админ (подроль в скобках).

## Работает (фазы 2–7)

| Метод | Путь | Кто | Что делает |
|---|---|---|---|
| GET | /health | все | состояние БД и Redis |
| POST | /auth/otp/request | все | отправить SMS-код (лимиты по телефону, устройству, IP) |
| POST | /auth/otp/verify | все | проверить код → токены; `appType`: `client` или `worker` |
| POST | /auth/refresh | все | ротация refresh; повтор старого → `TOKEN_REUSED`, сессия закрыта |
| POST | /auth/logout | все | закрыть сессию |
| POST | /auth/admin/login | — | email + пароль + TOTP |
| GET / PATCH | /me | все | профиль, имя (хранится зашифрованным), язык |
| POST | /me/devices | все | push-токен и устройство |
| GET | /cities | все | города: страна, валюта, часовой пояс, центр, экстренный номер |
| GET | /categories?cityId | все | группы и категории с флагами «срочно», «лицензия», «страховка» |
| GET | /availability | C | сколько мастеров рядом, предложить ли больший радиус |
| POST | /worker/online, /worker/offline | W | статус с геопозицией; в ответе — причины, почему заказы не приходят |
| GET | /worker/eligibility | W | причины: KYC, баланс, долг, категории, город, активный заказ, офлайн |
| PUT | /worker/categories, /worker/cities | W | выбор |
| PATCH | /worker/profile | W | независимый мастер / компания, свой радиус, зачёт комиссии из заработка |
| POST | /orders | C | создать заказ → сразу поиск мастера |
| GET | /orders, /orders/:id | C, W, A | свои заказы; телефон второй стороны открыт только после принятия; в карточке — карточка исполнителя (имя, рейтинг, значки), фото на 5 минут, `reviewedByMe` |
| GET | /orders/:id/cancel-preview?reason | C | сколько будет стоить отмена сейчас |
| POST | /orders/:id/cancel | C | отмена с обязательной причиной; штраф или компенсация за выезд |
| POST | /orders/:id/worker-cancel | W | отмена мастером → заказ снова в поиске |
| POST | /orders/:id/restart-search | C | «расширить радиус» (`radiusM`) или «подождать» |
| POST | /orders/:id/status | W | `EN_ROUTE`, `ARRIVED` (только в геозоне), `IN_PROGRESS`, с геопозицией |
| POST | /orders/:id/estimates | W | новая версия сметы (работа, материалы, выезд) |
| POST | /orders/:id/estimates/:v/approve, /reject | C | решение клиента; сумма меняется только так |
| POST | /orders/:id/complete | W | «получил наличными X» → комиссия списана с баланса |
| POST | /orders/:id/confirm-payment | C | «оплатил X»; расхождение → автоматический спор |
| POST | /orders/:id/review | C, W | только по подтверждённому заказу, один раз |
| GET | /offers/current | W | активное предложение и серверное время |
| POST | /offers/:id/accept | W | атомарно: 409 `ORDER_ALREADY_TAKEN`, 410 `OFFER_EXPIRED` / `OFFER_NOT_ACTIVE` |
| POST | /offers/:id/decline | W | отказ — этот заказ больше не придёт |
| POST | /tracking/batch | W | буфер точек после потери связи |
| GET | /orders/:id/track | C (пока заказ активен), W, A | последние точки трека |
| GET / POST | /orders/:id/messages | стороны заказа, A (чтение) | чат с фильтром телефонов, ссылок, мессенджеров, IBAN |
| GET | /wallet | W | карманы: пополнение, приветственный (со сроком), бонус (со сроком), заработок (за флагом), долг |
| GET | /wallet/transactions | W | история операций из журнала |
| POST | /wallet/topups | W | пополнение через Stripe (флаг `WORKER_TOPUP_ENABLED`) |
| POST | /webhooks/stripe | Stripe | проверка подписи, без дублей |
| — | вывод с пополнения, промо, бонуса | — | **не существует**, любой такой путь → 404 |
| POST | /uploads | все (документы — W) | подписанная форма загрузки в закрытое хранилище: `purpose` (document, order_photo, avatar), тип, размер до 10 МБ |
| POST | /documents | W | зарегистрировать загруженный файл: удостоверение, селфи, лицензия (с категорией), страховка (с данными полиса) |
| GET | /documents | W | свои документы и статусы проверки |
| GET | /documents/:id/view-url | владелец, A (moderator, support) | ссылка на 5 минут; каждый просмотр — в журнал |
| GET | /worker/history?month=YYYY-MM | W | завершённые заказы с суммой, комиссией, скидкой бонуса и чистым доходом |
| GET | /worker/stats?month=YYYY-MM | W | сводка за месяц, прошлый месяц, ступень бонуса и сколько заказов до следующей |
| GET | /worker/history/export?month | W | CSV для налогов |
| GET / POST | /me/addresses | C | сохранённые адреса (название, адрес, подъезд/этаж, точка) |
| DELETE | /me/addresses/:id | C | удалить свой адрес |
| GET | /geo/autocomplete?q&lat&lng&session | все | подсказки адресов (Google Places, токен сессии); без ключа → `FEATURE_DISABLED` |
| GET | /geo/place/:placeId?session | все | точка и полный адрес выбранной подсказки |
| GET | /geo/reverse?lat&lng | все | адрес по точке на карте |
| GET | /app-config?cityId | все | что включено для города: наличные, карты, радиус и максимум, бесплатная отмена, экстренный номер, валюта |
| GET | /client/history?month=YYYY-MM | C | заказы за месяц, сколько потрачено, исполнитель и оплаченная сумма |
| GET / POST / DELETE | /me/blacklist/:workerId | C | «не предлагать мои заказы этому мастеру» — только для мастеров, которые уже выполняли заказ клиента |
| GET | /notifications | все | лента уведомлений |
| POST | /notifications/read | все | отметить прочитанными |

### Фаза 6: споры, происшествия, поддержка, документы, приватность

| Метод | Путь | Кто | Что делает |
|---|---|---|---|
| POST | /orders/:id/disputes | C, W | открыть спор: причина (у клиента и мастера свои списки), описание, фото `dispute_evidence`; окно — `DISPUTE_OPEN_WINDOW_DAYS` после завершения; снимки чата, сметы, таймлайна, GPS и заказа сохраняются сразу |
| POST | /orders/:id/no-show | W | «клиент не вышел»: только в ARRIVED, после `NO_SHOW_WAIT_MINUTES`, внутри геозоны, с фото; иначе `NO_SHOW_TOO_EARLY` |
| GET | /disputes, /disputes/:id | C, W | мои споры; карточка без внутренних заметок поддержки, срок ответа, итог |
| POST | /disputes/:id/responses | C, W | объяснение стороны с фото; в закрытом споре → `DISPUTE_CLOSED` |
| POST | /orders/:id/incidents | C, W | происшествие (тип, описание, вызвана ли экстренная служба, точка, фото) + обращение в поддержку; в ответе экстренный номер города |
| GET / POST | /support/tickets | все | мои обращения / новое |
| GET | /support/tickets/:id | все | переписка без внутренних заметок |
| POST | /support/tickets/:id/messages | все | ответить; обращение снова открывается |
| GET | /legal/required?context | все | какие редакции нужно принять (`registration`, `order`, `topup`, `add_helper`) и какие только показать |
| GET | /legal/versions/:id | все | текст редакции на языке пользователя (иначе en) |
| GET / POST | /legal/consents | все | мои согласия / принять редакции (сохраняются IP, устройство, страна, контекст) |
| GET | /worker/insurance-requirements | W | что требуется по стране, услуге и типу мастера, есть ли подходящий действующий полис |
| GET | /worker/bonuses | W | начисленные месячные бонусы: период, валюта, заказы, комиссия, сумма, срок |
| POST | /me/data-export | все | выгрузка всех моих данных (JSON) со ссылкой на скачивание |
| GET | /me/data-requests | все | мои выгрузки и запросы на удаление |
| POST | /me/delete-account | все | `{confirm: true}`; при активном заказе, открытом споре или долге → `ACCOUNT_DELETE_BLOCKED`; результат — список того, что сохранено по закону |

Без принятых документов регистрации нельзя создать заказ и выйти на линию, без условий пополнения — пополнить баланс (`CONSENT_REQUIRED`).

### Фаза 7: команды и помощники

| Метод | Путь | Кто | Что делает |
|---|---|---|---|
| GET | /team | W | `mode: none` (можно создать, если `TEAMS_ENABLED`), `owner` (участники с проверкой, лицензиями, страховкой и занятостью, приглашения, ёмкость) или `member` (команда, руководитель, роль) |
| POST / PATCH | /team | W | создать или переименовать команду; руководитель становится участником с ролью LEADER |
| GET | /team/events?before | W (руководитель) | журнал: приглашения, вступления, выходы, назначения, замены, «пришёл не тот» |
| POST | /team/invites | W (руководитель) | приглашение по номеру с ролью MASTER, HELPER или EMPLOYEE; нужно согласие `add_helper`; лимит `TEAM_MAX_MEMBERS`, срок `TEAM_INVITE_TTL_HOURS`; номер клиента или участника другой команды → ошибка |
| DELETE | /team/invites/:id | W (руководитель) | отозвать приглашение |
| GET | /team/invites/mine | W | приглашения на мой номер |
| POST | /team/invites/:id/accept, /decline | W | принять (режим участника: офлайн, без предложений и кошелька) или отклонить; с активным заказом или предложением → `TEAM_HAS_ACTIVE_WORK` |
| DELETE | /team/members/:id | W (руководитель) | исключить участника; если он исполнитель активного заказа → `TEAM_HAS_ACTIVE_WORK` |
| POST | /team/leave | W (участник) | выйти из команды (те же ограничения) |
| GET | /orders/:id/performers | W (руководитель) | кого можно назначить и почему нет: `kyc`, `blocked`, `license`, `insurance`, `busy`, `inactive` |
| POST | /orders/:id/assign | W (руководитель) | назначить исполнителя; первое назначение до выезда — сразу с уведомлением клиента, дальше — замена с согласием клиента (`PERFORMER_CHANGE_CONSENT`); непроверенный → `TEAM_MEMBER_NOT_ELIGIBLE` |
| DELETE | /orders/:id/assign/pending | W (руководитель) | отозвать замену, которую клиент ещё не подтвердил |
| POST | /orders/:id/performer-change | C | `{approve}` — согласиться на замену или оставить прежнего |
| POST | /orders/:id/performer-mismatch | C | «пришёл другой человек» (в пути, на месте, в работе): событие, автоматический спор `PERFORMER_MISMATCH`, заказ остановлен |
| GET | /admin/workers/:id/team | support, moderator, finance | команда мастера (участники, приглашения, журнал) или в чьей команде он состоит |

Изменилось:
- `GET /orders/:id` — `viewer` (`owner` / `performer` / `client`), `team` для руководителя (текущий исполнитель, ожидающая замена, нужно ли назначить, срок) и `pendingPerformerChange` для клиента.
- `GET /worker/eligibility` — `capacity` (сколько заказов команда ведёт одновременно), `activeOrderIds`, причина `team_member`; для участника `activeOrderId` — назначенный ему заказ (по нему идёт геопозиция).
- `GET /me` — `team` (`member` / `owner`, название, роль) и `pendingInvites`.
- Участник не может выйти на линию и пополнить баланс (`TEAM_MEMBER_MODE`). Статусы, смету, завершение, «клиент не вышел» и сообщение о происшествии отправляет тот, кто на месте; спор и отмену ведёт руководитель.
- `GET /admin/documents` — у документа участника поле `team` (команда, роль); `GET /admin/orders/:id` — назначения с именами, состояниями и согласием клиента.

### Админка (`/admin/...`, каждое изменение пишется в журнал действий)

| Метод | Путь | Подроль | Что делает |
|---|---|---|---|
| GET | /admin/me | все админы | email, подроли, дневной лимит начислений |
| GET | /admin/dashboard?tz | support+ | заказы за сегодня (по часовому поясу браузера), «сейчас», пульс городов с «мало мастеров», очереди, комиссия за день (только finance) |
| GET | /admin/settings | support+ | все действующие значения и переопределения |
| POST | /admin/settings/:key/reset | finance (финансовые ключи), superadmin | снять переопределение города, страны или услуги |
| PUT | /admin/settings/:key | finance (финансовые ключи), superadmin | значение, область (глобально, страна, город, категория, город+категория), комментарий |
| GET | /admin/settings/:key/history | support+ | история изменений |
| POST | /admin/grants | finance, superadmin | приветственный кредит: пресет 50/100 или сумма, причина, срок |
| POST | /admin/grants/:id/approve, /reject | superadmin (не создатель) | второе подтверждение выше порога |
| GET | /admin/grants | finance, superadmin | список начислений |
| GET | /admin/orders, /admin/orders/:id | support+ | фильтры (статус, город, услуга, день, номер, мастер, клиент); карточка: таймлайн, журнал рассылки, сметы, назначения, отмена, споры, чат, трек, фото, проводки |
| POST | /admin/orders/:id/cancel | support, superadmin | отмена поддержкой с причиной, без штрафа и компенсации |
| GET | /admin/map/snapshot | support+ | онлайн-мастера и активные заказы (далее дельты в сокете `admin:map`) |
| POST | /admin/workers/:id/kyc | moderator, superadmin | подтвердить / отклонить с причиной |
| GET | /admin/workers, /admin/workers/:id | support+ | поиск по телефону или ID (имена зашифрованы), фильтры KYC, онлайн, город; карточка: допуск, документы, заказы, начисления, отметки |
| GET | /admin/clients, /admin/clients/:id | support+ | история, отмены со штрафами, споры, чёрный список, отметки |
| GET | /admin/workers/:id/wallet | finance, superadmin | карманы мастера |
| POST | /admin/users/:id/block | moderator, superadmin | блокировка; приветственный кредит сгорает |
| POST | /admin/users/:id/unblock | moderator, superadmin | снятие ограничений с причиной |
| GET | /admin/finance/summary?from&to | finance, superadmin | по валютам: оборот, комиссия и откуда списана, пополнения, кредиты, бонусы, chargeback, остатки |
| GET | /admin/finance/transactions | finance, superadmin | операции журнала за период, фильтр по виду и владельцу |
| GET | /admin/finance/export.csv?from&to | finance, superadmin | CSV журнала; выгрузка пишется в журнал действий |
| GET | /admin/finance/ledger-integrity | finance, superadmin | сумма журнала = 0, кэш остатков сходится |
| GET | /admin/fraud-flags?resolved | moderator, superadmin | подозрительные действия |
| POST | /admin/fraud-flags/:id/resolve | moderator, superadmin | итог проверки с комментарием |
| GET | /admin/catalog | support+ | группы, услуги, города с центром и списком услуг |
| POST / PUT | /admin/catalog/groups, /categories, /cities | superadmin | справочники с названиями на 5 языках; валюту города с заказами менять нельзя |
| PUT | /admin/catalog/cities/:id/categories | superadmin | какие услуги заказываются в городе |
| GET / POST | /admin/admins | superadmin | список; новый админ — секрет TOTP показывается один раз |
| PATCH | /admin/admins/:id | superadmin | подроли, лимит, доступ; сессии закрываются; последнего суперадмина отключить нельзя |
| POST | /admin/admins/:id/reset-totp | superadmin | новый секрет TOTP, сессии закрываются |
| GET | /admin/audit-log | superadmin | журнал действий админов |
| GET | /admin/documents?status | moderator, support | очередь проверки документов |
| POST | /admin/documents/:id/review | moderator | подтвердить / отклонить с причиной; удостоверение + селфи → KYC пройден |
| GET | /admin/disputes, /admin/disputes/:id | support, moderator, finance | очередь со счётчиками; карточка: события, снимки, доказательства по подписанным ссылкам; просмотр пишется в журнал |
| POST | /admin/disputes/:id/actions | support, moderator (finance — только `settle` с возвратом комиссии) | `assign`, `request_response`, `proposal`, `escalate`, `note`, `settle` (итог, резюме, возврат комиссии), `refer` |
| GET / POST / PATCH | /admin/tickets, /admin/tickets/:id, /admin/tickets/:id/messages | support+ | обращения: ответ (пуш пользователю), внутренняя заметка, статус, исполнитель |
| GET | /admin/incidents, /admin/incidents/:id | support+ | происшествия с точкой на карте; просмотр пишется в журнал |
| GET | /admin/legal, /admin/legal/versions/:id | support+ | документы по странам, редакции, кто проверил, число согласий |
| POST | /admin/legal/versions | superadmin | черновик редакции на 5 языках |
| POST | /admin/legal/:documentId/versions/:version/publish | superadmin | публикация (нужны все языки и проверка юриста); после неё редакция неизменна |
| DELETE | /admin/legal/:documentId/versions/:version | superadmin | удалить черновик (опубликованную нельзя) |
| GET / POST / PUT / DELETE | /admin/insurance-rules | superadmin (изменение) | требования к страховке по стране, услуге и типу мастера |
| GET / POST / PUT | /admin/bonus-rules | finance | правила месячного бонуса |
| GET / POST | /admin/bonus-runs | finance | расчёты за период (черновик, пересчёт) |
| GET | /admin/bonus-runs/:id | finance | итоги по валютам и начисления с формулой |
| POST | /admin/bonus-runs/:id/approve, /cancel | finance | одобрение зачисляет бонусы (проводки BONUS_ACCRUAL) и шлёт пуш; отмена |
| GET | /admin/data-requests | support | выгрузки и удаления аккаунтов |

## Socket.IO (namespace `/rt`)

Подключение с `auth: { token }`. Сервер отвечает `rt:ready` после проверки токена — до этого события не отправлять.

| Событие | Направление | Данные |
|---|---|---|
| `offer:new` | сервер → мастер | offerId, orderId, категория, расстояние, способ оплаты, `expiresAt` и `serverNow` |
| `offer:closed` | сервер → мастер | причина: `expired`, `declined`, `taken`, `cancelled` |
| `order:status` | сервер → стороны, админы | новый статус и время |
| `order:estimate` | сервер → клиент / мастер | новая смета или решение по ней |
| `order:join` | клиент → сервер (с ответом) | вход в комнату заказа; `ok: false`, если заказ не активен |
| `location:update` | исполнитель → сервер (с ответом) | lat, lng, accuracyM, speedMps, heading, recordedAt |
| `location:worker` | сервер → комната заказа | позиция, distanceM, etaSeconds |
| `location:lost` / `location:restored` | сервер → комната заказа | статус связи |
| `chat:message` | сервер → стороны | сообщение (уже отфильтрованное) |
| `dispatch:no-workers` | сервер → клиент | варианты: расширить радиус, подождать, отменить без штрафа |
| `wallet:changed` | сервер → мастер | остатки карманов |
| `admin:map` | сервер → админы | движение мастеров: `worker` (онлайн), `performer` (на заказе, с расстоянием и ETA), `offline` |
| `dispute:updated` | сервер → стороны, админы | id спора, новый статус |
| `ticket:message` | сервер → пользователь, админы | новое сообщение в обращении |
| `order:assignment` | сервер → клиент, руководитель, участники | назначение, замена, согласие или отказ клиента, отмена |
| `team:updated` | сервер → руководитель, участник | приглашение, вступление, исключение — приложение перечитывает режим |

## Фоновые задачи (BullMQ)

| Задача | Когда | Что делает |
|---|---|---|
| `offer-expire` | через `OFFER_TTL_SECONDS` | закрывает предложение, предлагает следующему |
| `dispatch-timeout` | через `MAX_DISPATCH_MINUTES` | «Мастеров сейчас нет» |
| `auto-confirm` | через `AUTO_CONFIRM_HOURS` после «Завершил» | подтверждение с пометкой «не подтверждено клиентом» |
| `tracking-watchdog` | каждые 20 с | «связь потеряна» после 60 с без точек |
| `track-retention` | каждые 6 ч | удаление треков старше `LOCATION_RETENTION_DAYS`, кроме спорных |
| `lots-expiry` | каждый час | сгорание просроченного приветственного кредита и бонусов |
| `dispute-response-due` | через `DISPUTE_RESPONSE_HOURS` | срок ответа второй стороны истёк → на рассмотрение поддержки |
| `dispute-escalate` | через `DISPUTE_ESCALATE_HOURS` | нерешённый спор передаётся старшему специалисту |
| `documents-expiry` | каждые 6 ч | напоминания о полисе за 30/14/3 дня, просроченные документы → EXPIRED |
| `bonus-monthly` | каждые 6 ч | черновик расчёта бонусов за прошлый месяц (одобряет finance) |
| `team-assign-timeout` | через `TEAM_ASSIGN_TIMEOUT_MIN` после принятия командой | исполнитель не выбран → руководитель (если занят — первый свободный подходящий участник) |

## Ещё не включено

Карточные оплаты клиентов и выплаты Stripe Connect — за флагами перед их включением.
