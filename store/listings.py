"""
Тексты для Google Play и App Store: один источник для обоих приложений и всех языков.
Запуск: python3 store/listings.py — проверяет лимиты площадок и пишет файлы в формате fastlane:
  store/<app>/android/<locale>/{title,short_description,full_description}.txt
  store/<app>/ios/<locale>/{name,subtitle,keywords,promotional_text,description}.txt
Google Play поддерживает армянский (hy-AM); в App Store армянской локализации нет — там en-US и ru.
Тексты не обещают страховку, гарантий результата или выплат от Masterio (разделы 18.3, 18.4 ТЗ).
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent

LIMITS_ANDROID = {'title': 30, 'short_description': 80, 'full_description': 4000}
LIMITS_IOS = {'name': 30, 'subtitle': 30, 'keywords': 100, 'promotional_text': 170, 'description': 4000}

CLIENT = {
    'android': {
        'en-US': {
            'title': 'Masterio: home & car services',
            'short_description': 'Find a verified master nearby, watch them arrive live and pay in cash.',
            'full_description': """Masterio connects you with independent masters near you — for a leaking pipe, a car that won't start or a door you're locked out of.

HOW IT WORKS
• Choose a service, describe the problem and add photos.
• Set the address by GPS, search or a pin on the map.
• Before you order, see how many masters are available nearby.
• Masterio offers your order to the nearest suitable masters one by one. The first one to accept takes it.
• Watch the master drive to you on a live map with distance and arrival time.
• Approve the estimate before work starts. A new price needs your approval again.
• Pay the master in cash and confirm the amount in the app.

SERVICES
Plumber, electrician, handyman, appliance repair, air conditioning, cleaning, windows and doors, lockout and lock replacement, painter, tiler, movers and transport, gardener, gates and garage doors. Car mechanic, tire service, auto electrician, roadside assistance and tow truck.

WHO COMES
You see the master's name, photo, rating and badges: identity checked, licence checked, own insurance. If a master works with a team, you see exactly who will come. A replacement needs your consent. If a different person arrives, report it in one tap.

SAFETY
• Phone numbers and payment details are hidden in chat. Deals outside the app are not protected.
• Report an incident from the order screen. The app first shows the emergency number 112.
• Open a dispute with photos. Support sees the chat, the estimate and the route.

YOUR DATA
Download all your data or delete your account in the app.

Masterio is a platform that connects clients and independent masters. The master or their company performs the work and is responsible for it as required by law. Masterio does not provide insurance.""",
        },
        'ru-RU': {
            'title': 'Masterio: мастер на дом',
            'short_description': 'Проверенный мастер рядом за минуты. Видно, где он едет. Оплата наличными.',
            'full_description': """Masterio находит независимого мастера рядом с вами: потекла труба, не заводится машина, захлопнулась дверь.

КАК ЭТО РАБОТАЕТ
• Выберите услугу, опишите проблему и добавьте фото.
• Укажите адрес: GPS, поиск или метка на карте.
• До заказа видно, сколько мастеров свободно рядом.
• Masterio предлагает заказ ближайшим подходящим мастерам по очереди — берёт тот, кто примет первым.
• Мастер едет к вам на живой карте: расстояние и время прибытия.
• Смету вы подтверждаете до начала работы. Новая цена — только с вашего согласия.
• Оплата мастеру наличными, сумму вы подтверждаете в приложении.

УСЛУГИ
Сантехник, электрик, мастер на час, ремонт техники, кондиционеры, уборка, окна и двери, вскрытие и замена замков, маляр, плиточник, грузчики и перевозки, садовник, ворота и гаражные двери. Автомеханик, шиномонтаж, автоэлектрик, помощь на дороге, эвакуатор.

КТО ПРИЕДЕТ
Вы видите имя, фото, рейтинг и значки мастера: личность проверена, лицензия проверена, своя страховка. Если мастер работает с командой, видно, кто именно приедет. Замена исполнителя — только с вашего согласия. Пришёл другой человек — сообщите в одно касание.

БЕЗОПАСНОСТЬ
• Телефоны и реквизиты в чате скрываются. Договорённости вне приложения не защищены.
• Сообщить о происшествии можно с экрана заказа. Сначала приложение покажет номер экстренной службы 112.
• Спор можно открыть с фото. Поддержка видит переписку, смету и маршрут.

ВАШИ ДАННЫЕ
Скачать все свои данные или удалить аккаунт можно в приложении.

Masterio — платформа, которая связывает клиентов и независимых мастеров. Работу выполняет мастер или его компания и отвечает за неё по закону. Masterio не предоставляет страховку.""",
        },
        'hy-AM': {
            'title': 'Masterio՝ վարպետ տուն',
            'short_description': 'Ստուգված վարպետ մոտակայքում՝ րոպեների ընթացքում։ Վճարում՝ կանխիկ։',
            'full_description': """Masterio-ն գտնում է ձեզ մոտ գտնվող անկախ վարպետ, երբ ջրատարն է կաթում, մեքենան չի միանում կամ դուռը փակվել է։

ԻՆՉՊԵՍ Է ԱՇԽԱՏՈՒՄ
• Ընտրեք ծառայությունը, նկարագրեք խնդիրը և ավելացրեք լուսանկարներ։
• Նշեք հասցեն՝ GPS-ով, որոնմամբ կամ քարտեզի վրա։
• Պատվիրելուց առաջ տեսնում եք, թե քանի վարպետ է ազատ մոտակայքում։
• Masterio-ն պատվերը հերթով առաջարկում է մոտակա համապատասխան վարպետներին․ այն վերցնում է առաջինը ընդունողը։
• Վարպետը գալիս է կենդանի քարտեզի վրա՝ հեռավորությամբ և ժամանման ժամանակով։
• Նախահաշիվը հաստատում եք աշխատանքը սկսելուց առաջ։ Նոր գինը՝ միայն ձեր համաձայնությամբ։
• Վճարում եք վարպետին կանխիկ և գումարը հաստատում հավելվածում։

ԾԱՌԱՅՈՒԹՅՈՒՆՆԵՐ
Սանտեխնիկ, էլեկտրիկ, ունիվերսալ վարպետ, տեխնիկայի վերանորոգում, օդորակիչներ, մաքրում, պատուհաններ և դռներ, կողպեքների բացում և փոխարինում, ներկարար, սալիկապատող, բեռնակիրներ և բեռնափոխադրում, այգեպան, դարպասներ և ավտոտնակի դռներ։ Ավտոմեխանիկ, անվադողերի սպասարկում, ավտոէլեկտրիկ, ճանապարհային օգնություն, էվակուատոր։

ՈՎ ԿԳԱ
Տեսնում եք վարպետի անունը, լուսանկարը, վարկանիշը և նշանները՝ ինքնությունը ստուգված է, լիցենզիան ստուգված է, ունի ապահովագրություն։ Եթե վարպետն աշխատում է թիմով, տեսնում եք, թե կոնկրետ ով կգա։ Կատարողի փոխարինումը՝ միայն ձեր համաձայնությամբ։ Եկել է այլ մարդ՝ հայտնեք մեկ հպումով։

ԱՆՎՏԱՆԳՈՒԹՅՈՒՆ
• Հեռախոսահամարները և վճարային տվյալները զրույցում թաքցվում են։ Հավելվածից դուրս պայմանավորվածությունները պաշտպանված չեն։
• Միջադեպի մասին կարող եք հայտնել պատվերի էկրանից․ նախ հավելվածը ցույց կտա շտապ ծառայության 112 համարը։
• Վեճը կարող եք բացել լուսանկարներով։ Աջակցությունը տեսնում է զրույցը, նախահաշիվը և երթուղին։

ՁԵՐ ՏՎՅԱԼՆԵՐԸ
Հավելվածում կարող եք ներբեռնել ձեր բոլոր տվյալները կամ ջնջել հաշիվը։

Masterio-ն հարթակ է, որը կապում է հաճախորդներին և անկախ վարպետներին։ Աշխատանքը կատարում է վարպետը կամ նրա ընկերությունը և պատասխանատու է դրա համար՝ օրենքով սահմանված չափով։ Masterio-ն ապահովագրություն չի տրամադրում։""",
        },
    },
    'ios': {
        'en-US': {
            'name': 'Masterio',
            'subtitle': 'Verified masters nearby',
            'keywords': 'plumber,electrician,handyman,locksmith,tow truck,repair,cleaning,movers,mechanic,Yerevan',
            'promotional_text': 'A verified master nearby in minutes. Watch them arrive on a live map, approve the estimate first and pay in cash.',
        },
        'ru': {
            'name': 'Masterio',
            'subtitle': 'Проверенные мастера рядом',
            'keywords': 'сантехник,электрик,мастер на час,эвакуатор,вскрытие замков,ремонт,уборка,грузчики,Ереван',
            'promotional_text': 'Проверенный мастер рядом за минуты. Видно, как он едет, смета — до начала работы, оплата наличными.',
        },
    },
}

PRO = {
    'android': {
        'en-US': {
            'title': 'Masterio Pro: orders nearby',
            'short_description': 'Orders from clients near you. No subscription — commission on completed work.',
            'full_description': """Masterio Pro is the app for independent masters and service companies: receive orders from clients near you and grow your business.

ORDERS NEARBY
• Go online — orders for your services in your cities come one at a time.
• Every offer shows the service, distance, description, photos and payment method. You have 30 seconds to accept or decline.
• Navigation to the address, call and chat with the client. Phone numbers become visible after you accept.
• Statuses "On my way", "Arrived" (only at the address) and "Work started". The client sees you on a live map.
• Send an estimate with work, materials and travel. Payment is made in cash.

FAIR TERMS
• No subscription. A commission is charged only on completed orders, from your prepaid balance.
• The wallet shows separate pockets: top-up, welcome credit with its expiry date, bonus, debt.
• Top up by card. History of every operation.
• Monthly bonuses for active work reduce your future commission.
• Monthly history and summary, CSV export for taxes.

YOUR TEAM
Work alone or as a company. Invite a helper, an employee or a second master, send them to orders and replace them when needed. Commission and rating stay on your account.

TRUST
Identity check, licences for licensed services, your insurance with expiry reminders. Disputes, "client did not show up" with photo and location, incident report with the emergency number 112.

Masterio is a platform that connects clients and independent masters. You perform the work as an independent master or company. Masterio is not your employer and does not provide insurance.""",
        },
        'ru-RU': {
            'title': 'Masterio Pro: заказы рядом',
            'short_description': 'Заказы от клиентов рядом. Без абонплаты — комиссия только с выполненных.',
            'full_description': """Masterio Pro — приложение для независимых мастеров и сервисных компаний: заказы от клиентов рядом с вами.

ЗАКАЗЫ РЯДОМ
• Выйдите на линию — заказы по вашим услугам в ваших городах приходят по одному.
• В предложении видно услугу, расстояние, описание, фото и способ оплаты. На решение — 30 секунд.
• Навигация до адреса, звонок и чат с клиентом. Телефоны видны после принятия заказа.
• Статусы «Выехал», «Прибыл» (только на адресе), «Начал работу». Клиент видит вас на живой карте.
• Смета: работа, материалы, выезд. Оплата наличными.

ЧЕСТНЫЕ УСЛОВИЯ
• Без абонентской платы. Комиссия — только с выполненных заказов, из предоплаченного баланса.
• Кошелёк по отдельным карманам: пополнение, приветственный кредит со сроком, бонус, долг.
• Пополнение картой, история всех операций.
• Ежемесячные бонусы за активную работу уменьшают будущую комиссию.
• История и итоги за месяц, выгрузка CSV для налогов.

ВАША КОМАНДА
Работайте самостоятельно или как компания. Пригласите помощника, сотрудника или второго мастера, назначайте их на заказы и заменяйте при необходимости. Комиссия и рейтинг остаются на вашем аккаунте.

ДОВЕРИЕ
Проверка личности, лицензии для лицензируемых услуг, ваша страховка с напоминаниями о сроке. Споры, «клиент не вышел» с фото и геопозицией, сообщение о происшествии с номером экстренной службы 112.

Masterio — платформа, которая связывает клиентов и независимых мастеров. Работу выполняете вы как независимый мастер или компания. Masterio не является вашим работодателем и не предоставляет страховку.""",
        },
        'hy-AM': {
            'title': 'Masterio Pro՝ պատվերներ մոտիկ',
            'short_description': 'Պատվերներ մոտակա հաճախորդներից։ Առանց բաժանորդավճարի։',
            'full_description': """Masterio Pro-ն հավելված է անկախ վարպետների և սպասարկման ընկերությունների համար՝ պատվերներ ձեզ մոտ գտնվող հաճախորդներից։

ՊԱՏՎԵՐՆԵՐ ՄՈՏԱԿԱՅՔՈՒՄ
• Դուրս եկեք գծին․ ձեր ծառայությունների պատվերները ձեր քաղաքներում գալիս են մեկ առ մեկ։
• Առաջարկում երևում են ծառայությունը, հեռավորությունը, նկարագրությունը, լուսանկարները և վճարման եղանակը։ Որոշման համար՝ 30 վայրկյան։
• Նավիգացիա մինչև հասցե, զանգ և զրույց հաճախորդի հետ։ Հեռախոսահամարները երևում են պատվերն ընդունելուց հետո։
• «Մեկնեցի», «Ժամանեցի» (միայն հասցեում), «Սկսեցի աշխատանքը» կարգավիճակներ։ Հաճախորդը տեսնում է ձեզ կենդանի քարտեզի վրա։
• Նախահաշիվ՝ աշխատանք, նյութեր, մեկնում։ Վճարումը՝ կանխիկ։

ԱՐԴԱՐ ՊԱՅՄԱՆՆԵՐ
• Առանց բաժանորդավճարի։ Միջնորդավճարը՝ միայն կատարված պատվերներից, կանխավճարված հաշվեկշռից։
• Դրամապանակը՝ առանձին գրպաններով․ լիցքավորում, ողջույնի վարկ՝ ժամկետով, բոնուս, պարտք։
• Լիցքավորում քարտով, բոլոր գործարքների պատմությունը։
• Ամսական բոնուսներն ակտիվ աշխատանքի համար նվազեցնում են ապագա միջնորդավճարը։
• Ամսվա պատմություն և ամփոփում, CSV արտահանում հարկերի համար։

ՁԵՐ ԹԻՄԸ
Աշխատեք ինքնուրույն կամ որպես ընկերություն։ Հրավիրեք օգնականի, աշխատակցի կամ երկրորդ վարպետի, նշանակեք նրանց պատվերների և անհրաժեշտության դեպքում փոխարինեք։ Միջնորդավճարը և վարկանիշը մնում են ձեր հաշվին։

ՎՍՏԱՀՈՒԹՅՈՒՆ
Ինքնության ստուգում, լիցենզիաներ լիցենզավորվող ծառայությունների համար, ձեր ապահովագրությունը՝ ժամկետի հիշեցումներով։ Վեճեր, «հաճախորդը չեկավ»՝ լուսանկարով և գտնվելու վայրով, միջադեպի մասին հաղորդում՝ շտապ ծառայության 112 համարով։

Masterio-ն հարթակ է, որը կապում է հաճախորդներին և անկախ վարպետներին։ Աշխատանքը կատարում եք դուք՝ որպես անկախ վարպետ կամ ընկերություն։ Masterio-ն ձեր գործատուն չէ և ապահովագրություն չի տրամադրում։""",
        },
    },
    'ios': {
        'en-US': {
            'name': 'Masterio Pro',
            'subtitle': 'Orders from clients nearby',
            'keywords': 'master,handyman,plumber,electrician,jobs,orders,clients,service business,Yerevan,Armenia',
            'promotional_text': 'Orders from clients near you, one at a time. No subscription: commission only on completed work. Work alone or with your team.',
        },
        'ru': {
            'name': 'Masterio Pro',
            'subtitle': 'Заказы от клиентов рядом',
            'keywords': 'мастер,заказы,работа,сантехник,электрик,мастер на час,клиенты,подработка,Ереван,Армения',
            'promotional_text': 'Заказы от клиентов рядом, по одному. Без абонплаты: комиссия только с выполненных. Работайте сами или с командой.',
        },
    },
}

# описание для App Store — то же, что полное описание в Google Play
for app in (CLIENT, PRO):
    app['ios']['en-US']['description'] = app['android']['en-US']['full_description']
    app['ios']['ru']['description'] = app['android']['ru-RU']['full_description']


def check_and_write() -> int:
    errors = []
    for slug, app in (('client', CLIENT), ('worker', PRO)):
        for platform, limits in (('android', LIMITS_ANDROID), ('ios', LIMITS_IOS)):
            for locale, fields in app[platform].items():
                missing = set(limits) - set(fields)
                if missing:
                    errors.append(f'{slug}/{platform}/{locale}: missing {sorted(missing)}')
                for field, text in fields.items():
                    if len(text) > limits[field]:
                        errors.append(f'{slug}/{platform}/{locale}/{field}: {len(text)} > {limits[field]}')
                    out = ROOT / slug / platform / locale / f'{field}.txt'
                    out.parent.mkdir(parents=True, exist_ok=True)
                    out.write_text(text.strip() + '\n', encoding='utf-8')
    for e in errors:
        print('ERROR', e)
    print('store texts ok' if not errors else f'{len(errors)} problems')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(check_and_write())
