# OlivieBot - Telegram бот для отслеживания сроков хранения блюд

Telegram-бот на Node.js с использованием Telegraf и Supabase для управления блюдами и уведомлений о сроке хранения. Деплой на Netlify через webhook.

## Структура проекта

```
OlivieBot/
├── netlify/
│   └── functions/
│       ├── bot.js          # Webhook handler для Telegram
│       └── scheduler.js    # Scheduled function для уведомлений
├── netlify.toml            # Конфигурация Netlify
├── package.json            # Зависимости проекта
└── README.md               # Этот файл
```

## Настройка Supabase

### 1. Создание таблиц

Выполните следующие SQL-запросы в Supabase SQL Editor:

```sql
-- Таблица пользователей
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL CHECK (LENGTH(password) = 4 AND password ~ '^[0-9]+$'),
  chat_id BIGINT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Таблица блюд
CREATE TABLE dishes (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  chat_id BIGINT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  notified_day BOOLEAN NOT NULL DEFAULT FALSE,
  notified_one_hour BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed', 'expired'))
);

-- Таблица настроек пользователей
CREATE TABLE user_settings (
  chat_id BIGINT PRIMARY KEY,
  morning_notification_time TEXT NOT NULL DEFAULT '10:00' CHECK (morning_notification_time ~ '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Индексы для оптимизации запросов
CREATE INDEX idx_dishes_status ON dishes(status);
CREATE INDEX idx_dishes_expires_at ON dishes(expires_at);
CREATE INDEX idx_dishes_chat_id ON dishes(chat_id);
CREATE INDEX idx_dishes_created_at ON dishes(created_at);
CREATE INDEX idx_users_chat_id ON users(chat_id);
CREATE INDEX idx_users_name ON users(name);
```

### 2. Получение ключей Supabase

1. Перейдите в ваш проект на [Supabase](https://supabase.com)
2. Откройте Settings → API
3. Скопируйте:
   - **Project URL** (SUPABASE_URL)
   - **anon public** key (SUPABASE_KEY)

## Настройка Telegram бота

1. Создайте бота через [@BotFather](https://t.me/BotFather)
2. Отправьте команду `/newbot` и следуйте инструкциям
3. Сохраните полученный **BOT_TOKEN**

## Деплой на Netlify

### 1. Подготовка репозитория

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-repo-url>
git push -u origin main
```

### 2. Деплой через Netlify

1. Перейдите на [Netlify](https://netlify.com) и войдите в аккаунт
2. Нажмите "Add new site" → "Import an existing project"
3. Подключите ваш Git-репозиторий
4. Настройки сборки:
   - **Build command**: оставьте пустым (не требуется)
   - **Publish directory**: оставьте пустым

### 3. Настройка переменных окружения

В Netlify Dashboard → Site settings → Environment variables добавьте:

- `BOT_TOKEN` - токен вашего Telegram бота
- `SUPABASE_URL` - URL вашего Supabase проекта
- `SUPABASE_KEY` - anon key из Supabase

### 4. Установка webhook

После деплоя получите URL вашего сайта (например: `https://your-site.netlify.app`)

Выполните запрос (замените `<BOT_TOKEN>` и `<site>` на ваши значения):

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<site>.netlify.app/webhook"
```

Или откройте в браузере:
```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<site>.netlify.app/webhook
```

Вы должны получить ответ:
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

### 5. Проверка webhook

Проверить текущий webhook:
```
https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo
```

## Локальная разработка

### Установка зависимостей

```bash
npm install
```

### Настройка переменных окружения

Создайте файл `.env` в корне проекта:

```
BOT_TOKEN=your_telegram_bot_token_here
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_anon_key
```

### Запуск локального сервера

```bash
npm run dev
```

Netlify Dev автоматически запустит функции локально.

**Важно**: Для локальной разработки с webhook используйте [ngrok](https://ngrok.com) или другой туннелинг сервис:

```bash
ngrok http 8888
```

Затем установите webhook на ngrok URL:
```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://your-ngrok-url.ngrok.io/webhook
```

## Функциональность бота

### Главное меню

- **➕ Добавить блюдо** - добавить новое блюдо с указанием срока хранения
- **📦 Список блюд** - просмотр активных блюд с возможностью списания

### Добавление блюда

1. Выбор из последних 8 использованных названий блюд или ввод нового названия
2. Выбор срока хранения: 12, 24, 48, 72 часа или кастомное время
3. Автоматическое сохранение в базу данных

### Уведомления

Бот автоматически отправляет уведомления:

- **Ежедневно в 10:00**: о блюдах, срок которых истекает сегодня
- **За 1 час до истечения**: предупреждение о скором истечении срока
- **При истечении срока**: уведомление о необходимости списания

## Структура базы данных

### Таблица `dishes`

| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL | Первичный ключ |
| name | TEXT | Название блюда |
| chat_id | BIGINT | ID чата пользователя |
| expires_at | TIMESTAMP | Дата истечения срока |
| created_at | TIMESTAMP | Дата создания |
| notified_day | BOOLEAN | Уведомление о дне истечения отправлено |
| notified_one_hour | BOOLEAN | Уведомление за 1 час отправлено |
| status | TEXT | Статус: 'active', 'removed', 'expired' |

## Troubleshooting

### Webhook не работает

1. Проверьте, что URL правильный и доступен
2. Убедитесь, что переменные окружения установлены в Netlify
3. Проверьте логи функций в Netlify Dashboard

### Уведомления не приходят

1. Убедитесь, что scheduled function настроена в `netlify.toml`
2. Проверьте, что `chat_id` сохраняется при создании блюда
3. Проверьте логи scheduler функции в Netlify

### Ошибки базы данных

1. Убедитесь, что таблицы созданы правильно
2. Проверьте права доступа в Supabase (RLS policies)
3. Убедитесь, что используются правильные ключи API

## Лицензия

MIT

