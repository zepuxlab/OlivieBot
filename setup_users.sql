-- Таблица пользователей для авторизации
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL CHECK (LENGTH(password) = 4 AND password ~ '^[0-9]+$'),
  chat_id BIGINT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Индексы для оптимизации запросов
CREATE INDEX IF NOT EXISTS idx_users_chat_id ON users(chat_id);
CREATE INDEX IF NOT EXISTS idx_users_name ON users(name);

-- Пример добавления тестового пользователя (опционально)
-- INSERT INTO users (name, password) VALUES ('testuser', '1234');

