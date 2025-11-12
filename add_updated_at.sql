-- Добавление поля updated_at в таблицу dishes (если его нет)
ALTER TABLE dishes 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Обновляем updated_at для существующих записей со статусом removed
UPDATE dishes 
SET updated_at = created_at 
WHERE status = 'removed' AND updated_at IS NULL;

