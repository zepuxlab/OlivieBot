-- Таблица настроек пользователей
CREATE TABLE IF NOT EXISTS user_settings (
  chat_id BIGINT PRIMARY KEY,
  morning_notification_time TEXT NOT NULL DEFAULT '10:00' CHECK (morning_notification_time ~ '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Индекс для оптимизации запросов
CREATE INDEX IF NOT EXISTS idx_user_settings_chat_id ON user_settings(chat_id);

