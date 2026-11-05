# Food Boom

Лендинг доставки еды, блог и админ-панель: заказы, заявки, публикации,
пользователи, роли и права доступа.

- Backend: Node.js + Express
- База данных: **MySQL** (Replit и обычный хостинг) или SQLite (локально, если MySQL нет)

## Демо-доступы

| Роль | Email | Пароль |
| --- | --- | --- |
| Администратор | admin@foodboom.ru | admin123 |
| Оператор | operator@foodboom.ru | operator123 |
| Редактор | editor@foodboom.ru | editor123 |

При первом запуске база заполняется автоматически: создаются эти учётные
записи, 5 товаров и две публикации блога.

## Локальный запуск

```bash
npm install
npm start
```

Сайт: <http://localhost:5000>

Без настроенного MySQL приложение использует файл `foodboom.db` (SQLite) —
этого достаточно для разработки. Если MySQL установлен, укажите подключение
в `.env` (пример — `.env.example`):

```
DATABASE_URL=mysql://user:password@localhost:3306/foodboom
JWT_SECRET=любая_длинная_строка
```

## Деплой на Replit

1. **Создайте Replit из GitHub-репозитория** (`Create App → Import from GitHub`).
2. **Добавьте базу данных.** В панели Replit откройте *Tools → Database* и
   создайте **MySQL**. Replit выдаст строку подключения вида
   `mysql://user:password@host:3306/имя_базы`.
3. **Пропишите секреты.** В *Secrets* (или *Environment*) добавьте:
   - `DATABASE_URL` — строка подключения к MySQL из шага 2;
   - `JWT_SECRET` — любая длинная случайная строка.
4. **Запустите.** Кнопка *Run* поднимет `npm start` (это уже описано в `.replit`).
   При первом старте таблицы и демо-данные создаются автоматически.
5. **Задеплойте.** Нажмите *Deploy*, выберите **Reserved VM** — обычный сервер,
   а не Autoscale: приложению нужен постоянный процесс и постоянное подключение
   к базе. В настройках деплоя обязательно привяжите ту же базу MySQL
   (*Database* → *Attach*), иначе `DATABASE_URL` не попадёт в окружение.

После деплоя сайт доступен по адресу вида `https://имя.replit.app`,
админка — `/admin.html`.

### Переменные окружения

| Переменная | Назначение |
| --- | --- |
| `DATABASE_URL` | Строка подключения MySQL (`mysql://...`). Достаточно одной. |
| `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` | Альтернатива `DATABASE_URL` по отдельным полям. |
| `MYSQL_SSL=1` | Включить TLS (если хостинг его требует). |
| `PORT` | Порт приложения (по умолчанию 5000). |
| `JWT_SECRET` | Секрет подписи токенов. Обязательно задайте свой. |
| `DB_PATH` | Путь к файлу SQLite для локального запуска (по умолчанию `foodboom.db`). |
| `DB_DRIVER` | `mysql` — требовать MySQL, `sqlite` — принудительно SQLite. |

## Структура

```
server.js          — Express-приложение, все API
lib/db.js          — слой доступа к данным: MySQL (mysql2) или SQLite
lib/schema.js      — DDL для MySQL и SQLite
index.html         — лендинг, корзина, оформление заказа
blog.html          — публичный блог
admin.html         — админ-панель
js/api-fallback.js — резервный клиентский API для статического хостинга
```

`js/api-fallback.js` нужен только если сайт открывают как статику (без Node):
он перехватывает запросы к `/api/*`, которые отвечают 404, и работает с
данными в `localStorage` браузера. На Replit и при `npm start` он не
включается — работают настоящие API и MySQL.

## API (кратко)

| Метод | Путь | Доступ |
| --- | --- | --- |
| `GET` | `/api/products` | все |
| `POST` | `/api/auth/register`, `/api/auth/login` | все |
| `GET` | `/api/auth/me` | авторизованные |
| `POST` | `/api/orders` | все |
| `GET/PATCH/DELETE` | `/api/orders` | право `orders` |
| `POST` | `/api/feedback` | все |
| `GET/PATCH/DELETE` | `/api/feedback` | право `feedback` |
| `GET` | `/api/news`, `/api/news/:id` | все (только опубликованное) |
| `GET/POST/PATCH/DELETE` | `/api/news/all`, `/api/news` | право `news` |
| `GET/POST/PATCH/DELETE` | `/api/users` | только `admin` |
| `GET` | `/api/health` | все |
