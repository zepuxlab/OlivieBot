const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Состояния пользователей для обработки текстовых вводов
const userStates = new Map();

// Авторизованные пользователи (chat_id -> user data)
const authorizedUsers = new Map();

// Получение текущего времени в МСК (UTC+3)
function getMoscowTime() {
  const now = new Date();
  const moscowOffset = 3 * 60 * 60 * 1000; // 3 часа в миллисекундах
  const moscowTime = new Date(now.getTime() + moscowOffset);
  return moscowTime;
}

// Конвертация UTC времени в МСК для отображения
function toMoscowTime(date) {
  const moscowOffset = 3 * 60 * 60 * 1000;
  return new Date(new Date(date).getTime() + moscowOffset);
}

// Главное меню
function getMainMenu() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '➕ Добавить блюдо' }],
        [{ text: '📦 Список блюд' }, { text: '🗑 Списанные блюда' }],
        [{ text: '⚙️ Настройки' }]
      ],
      resize_keyboard: true
    }
  };
}

// Форматирование времени до истечения (используем МСК)
function formatTimeUntil(expiresAt) {
  const now = getMoscowTime();
  const expires = toMoscowTime(expiresAt);
  const diffMs = expires - now;
  
  if (diffMs <= 0) {
    return 'истёк';
  }
  
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  const parts = [];
  if (diffDays > 0) {
    parts.push(`${diffDays} ${diffDays === 1 ? 'день' : diffDays < 5 ? 'дня' : 'дней'}`);
  }
  if (diffHours > 0) {
    parts.push(`${diffHours} ${diffHours === 1 ? 'час' : diffHours < 5 ? 'часа' : 'часов'}`);
  }
  if (diffMinutes > 0 && diffDays === 0) {
    parts.push(`${diffMinutes} ${diffMinutes === 1 ? 'минута' : diffMinutes < 5 ? 'минуты' : 'минут'}`);
  }
  
  if (parts.length === 0) {
    return 'менее минуты';
  }
  
  return `через ${parts.join(' ')}`;
}

// Форматирование времени для отображения (в МСК)
function formatTime(date) {
  const d = toMoscowTime(date);
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

// Форматирование даты и времени для отображения (в МСК)
function formatDateTime(date) {
  const d = toMoscowTime(date);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day}.${month} ${hours}:${minutes}`;
}

// Проверка авторизации
async function checkAuth(ctx) {
  const chatId = ctx.chat.id;
  
  // Проверяем в памяти
  if (authorizedUsers.has(chatId)) {
    return true;
  }
  
  // Проверяем в базе данных
  const { data: user, error } = await supabase
    .from('users')
    .select('id, name, chat_id')
    .eq('chat_id', chatId)
    .single();
  
  if (user && !error) {
    authorizedUsers.set(chatId, user);
    return true;
  }
  
  return false;
}

// Команда /start
bot.start(async (ctx) => {
  console.log('[BOT] /start command from user', ctx.from.id);
  const chatId = ctx.chat.id;
  
  // Проверяем авторизацию
  const isAuthorized = await checkAuth(ctx);
  
  if (!isAuthorized) {
    userStates.set(ctx.from.id, { action: 'waiting_for_username' });
    await ctx.reply('Для использования бота необходима авторизация.\nВведите ваше имя:');
    return;
  }
  
  await ctx.reply('Добро пожаловать! Выберите действие:', getMainMenu());
});

// Обработка кнопки "Добавить блюдо"
bot.hears('➕ Добавить блюдо', async (ctx) => {
  console.log('[BOT] Add dish button clicked by user', ctx.from.id);
  
  // Проверка авторизации
  const isAuthorized = await checkAuth(ctx);
  if (!isAuthorized) {
    await ctx.reply('Необходима авторизация. Используйте /start');
    return;
  }
  
  try {
    const chatId = ctx.chat.id;
    
    // Получаем последние 8 уникальных названий блюд для этого пользователя
    const { data: recentDishes, error } = await supabase
      .from('dishes')
      .select('name')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    // Получаем уникальные названия (последние 8)
    const uniqueNames = [];
    const seenNames = new Set();
    for (const dish of recentDishes || []) {
      if (!seenNames.has(dish.name)) {
        seenNames.add(dish.name);
        uniqueNames.push(dish.name);
        if (uniqueNames.length >= 8) break;
      }
    }

    const userId = ctx.from.id;
    userStates.set(userId, { dishNames: uniqueNames });

    // Создаем кнопки для выбора блюда
    const buttons = uniqueNames.map((name, index) => {
      const displayName = name.length > 30 ? `${name.substring(0, 27)}...` : name;
      return [{
        text: displayName,
        callback_data: `dish_idx_${index}`
      }];
    });

    buttons.push([{
      text: '➕ Добавить новое блюдо',
      callback_data: 'dish_new'
    }]);

    await ctx.reply('Выберите блюдо или добавьте новое:', {
      reply_markup: {
        inline_keyboard: buttons
      }
    });
  } catch (error) {
    console.error('[BOT] Error loading dishes:', error);
    ctx.reply('Произошла ошибка при загрузке блюд. Попробуйте позже.');
  }
});

// Обработка выбора блюда
bot.action(/^dish_/, async (ctx) => {
  const callbackData = ctx.callbackQuery.data;
  const userId = ctx.from.id;
  
  if (callbackData === 'dish_new') {
    // Запрашиваем название нового блюда
    userStates.set(userId, { action: 'waiting_for_dish_name' });
    await ctx.editMessageText('Введите название блюда:');
    await ctx.answerCbQuery();
  } else if (callbackData.startsWith('dish_idx_')) {
    // Получаем индекс из callback_data
    const index = parseInt(callbackData.replace('dish_idx_', ''));
    const state = userStates.get(userId);
    
    if (!state || !state.dishNames || !state.dishNames[index]) {
      await ctx.answerCbQuery('Ошибка: блюдо не найдено');
      return;
    }
    
    const dishName = state.dishNames[index];
    
    // Сохраняем выбранное название и переходим к выбору срока
    userStates.set(userId, { 
      action: 'selecting_duration', 
      dish_name: dishName
    });
    
    await ctx.editMessageText('Выберите срок хранения:', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '12 ч', callback_data: 'duration_12' },
            { text: '24 ч', callback_data: 'duration_24' }
          ],
          [
            { text: '48 ч', callback_data: 'duration_48' },
            { text: '72 ч', callback_data: 'duration_72' }
          ],
          [
            { text: 'Другое время...', callback_data: 'duration_custom' }
          ]
        ]
      }
    });
    await ctx.answerCbQuery();
  }
});

// Middleware для пропуска команд меню - должен быть ПЕРЕД bot.on('text')
bot.use(async (ctx, next) => {
  if (ctx.message && ctx.message.text) {
    const text = ctx.message.text;
    const menuCommands = ['➕ Добавить блюдо', '📦 Список блюд', '🗑 Списанные блюда', '⚙️ Настройки'];
    if (menuCommands.includes(text)) {
      // Пропускаем эти команды - они обрабатываются через bot.hears
      console.log('[BOT] Menu command in middleware, allowing bot.hears to handle it');
      return next();
    }
  }
  return next();
});

// Обработка кнопки "Список блюд"
bot.hears('📦 Список блюд', async (ctx) => {
  // Проверка авторизации
  const isAuthorized = await checkAuth(ctx);
  if (!isAuthorized) {
    await ctx.reply('Необходима авторизация. Используйте /start');
    return;
  }
  
  try {
    console.log('[BOT] ===== List dishes button clicked =====');
    console.log('[BOT] User ID:', ctx.from.id);
    console.log('[BOT] Chat ID:', ctx.chat.id);
    const chatId = ctx.chat.id;
    
    console.log('[BOT] Fetching dishes for chat_id:', chatId);
    const { data: dishes, error } = await supabase
      .from('dishes')
      .select('id, name, expires_at')
      .eq('status', 'active')
      .eq('chat_id', chatId)
      .order('expires_at', { ascending: true });

    if (error) {
      console.error('[BOT] Error fetching dishes:', error);
      throw error;
    }

    console.log('[BOT] Found dishes:', dishes?.length || 0);

    if (!dishes || dishes.length === 0) {
      await ctx.reply('Нет активных блюд.', getMainMenu());
      return;
    }

    // Формируем список блюд с датой и временем (в МСК)
    const dishesList = dishes.map((dish, index) => {
      const expiresDate = toMoscowTime(dish.expires_at);
      const expiresTime = formatTime(dish.expires_at);
      const timeUntil = formatTimeUntil(dish.expires_at);
      
      // Форматируем дату (в МСК)
      const day = String(expiresDate.getUTCDate()).padStart(2, '0');
      const month = String(expiresDate.getUTCMonth() + 1).padStart(2, '0');
      const dateStr = `${day}.${month}`;
      
      return `${index + 1}. ${dish.name}\n   📅 ${dateStr} ${expiresTime} — ${timeUntil}`;
    }).join('\n\n');

    // Создаем кнопки для списания (ограничиваем длину текста кнопки)
    const buttons = dishes.map((dish, index) => {
      const dishName = dish.name.length > 15 
        ? `${dish.name.substring(0, 12)}...` 
        : dish.name;
      const buttonText = `${index + 1}. ${dishName} ❌ Списать`;
      
      return [{
        text: buttonText,
        callback_data: `remove_${dish.id}`
      }];
    });

    const message = `📦 Список активных блюд:\n\n${dishesList}`;

    console.log('[BOT] Sending dishes list to user');
    await ctx.reply(message, {
      reply_markup: {
        inline_keyboard: buttons
      }
    });
    console.log('[BOT] Dishes list sent successfully');
  } catch (error) {
    console.error('[BOT] Error fetching dishes:', error);
    console.error('[BOT] Error stack:', error.stack);
    await ctx.reply('Произошла ошибка при загрузке списка блюд. Попробуйте позже.');
  }
});

// Обработка кнопки "Списанные блюда"
bot.hears('🗑 Списанные блюда', async (ctx) => {
  // Проверка авторизации
  const isAuthorized = await checkAuth(ctx);
  if (!isAuthorized) {
    await ctx.reply('Необходима авторизация. Используйте /start');
    return;
  }
  
  try {
    const chatId = ctx.chat.id;
    
    const { data: dishes, error } = await supabase
      .from('dishes')
      .select('id, name, expires_at, status, created_at')
      .eq('chat_id', chatId)
      .in('status', ['removed', 'expired'])
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[BOT] Error fetching removed dishes:', error);
      throw error;
    }

    if (!dishes || dishes.length === 0) {
      await ctx.reply('Нет списанных блюд.', getMainMenu());
      return;
    }

    // Формируем список списанных блюд
    const dishesList = dishes.map((dish, index) => {
      const createdDate = toMoscowTime(dish.created_at);
      const day = String(createdDate.getUTCDate()).padStart(2, '0');
      const month = String(createdDate.getUTCMonth() + 1).padStart(2, '0');
      const dateStr = `${day}.${month}`;
      const statusEmoji = dish.status === 'expired' ? '⏰' : '❌';
      const statusText = dish.status === 'expired' ? 'Истёк' : 'Списано';
      
      return `${index + 1}. ${dish.name} ${statusEmoji} ${statusText} (${dateStr})`;
    }).join('\n');

    const message = `🗑 Списанные блюда:\n\n${dishesList}`;
    await ctx.reply(message, getMainMenu());
  } catch (error) {
    console.error('[BOT] Error fetching removed dishes:', error);
    await ctx.reply('Произошла ошибка при загрузке списка списанных блюд. Попробуйте позже.');
  }
});

// Обработка кнопки "Настройки"
bot.hears('⚙️ Настройки', async (ctx) => {
  // Проверка авторизации
  const isAuthorized = await checkAuth(ctx);
  if (!isAuthorized) {
    await ctx.reply('Необходима авторизация. Используйте /start');
    return;
  }
  
  try {
    const chatId = ctx.chat.id;
    
    // Получаем настройки пользователя
    const { data: settings, error } = await supabase
      .from('user_settings')
      .select('morning_notification_time')
      .eq('chat_id', chatId)
      .single();
    
    const currentTime = settings?.morning_notification_time || '10:00';
    
    await ctx.reply(
      `⚙️ Настройки\n\n` +
      `Время утреннего уведомления: ${currentTime}\n\n` +
      `Выберите новое время:`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '08:00', callback_data: 'set_time_08:00' },
              { text: '09:00', callback_data: 'set_time_09:00' },
              { text: '10:00', callback_data: 'set_time_10:00' }
            ],
            [
              { text: '11:00', callback_data: 'set_time_11:00' },
              { text: '12:00', callback_data: 'set_time_12:00' },
              { text: 'Другое...', callback_data: 'set_time_custom' }
            ]
          ]
        }
      }
    );
  } catch (error) {
    console.error('[BOT] Error loading settings:', error);
    await ctx.reply('Произошла ошибка при загрузке настроек. Попробуйте позже.');
  }
});

// Обработка изменения времени уведомления
bot.action(/^set_time_/, async (ctx) => {
  const timeStr = ctx.callbackQuery.data.replace('set_time_', '');
  const chatId = ctx.chat.id;
  
  if (timeStr === 'custom') {
    userStates.set(ctx.from.id, { action: 'waiting_for_notification_time' });
    await ctx.editMessageText('Введите время в формате ЧЧ:ММ (например: 09:30):');
    await ctx.answerCbQuery();
    return;
  }
  
  try {
    // Сохраняем настройку
    const { error } = await supabase
      .from('user_settings')
      .upsert({
        chat_id: chatId,
        morning_notification_time: timeStr
      }, {
        onConflict: 'chat_id'
      });
    
    if (error) throw error;
    
    await ctx.editMessageText(`✅ Время утреннего уведомления установлено: ${timeStr}`);
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('[BOT] Error saving settings:', error);
    await ctx.answerCbQuery('Ошибка при сохранении настроек');
  }
});

// Обработка текстового ввода
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const state = userStates.get(userId);
  const chatId = ctx.chat.id;
  
  // Обработка авторизации
  if (state && state.action === 'waiting_for_username') {
    const username = ctx.message.text.trim();
    if (!username || username.length === 0) {
      await ctx.reply('Имя не может быть пустым. Введите ваше имя:');
      return;
    }
    userStates.set(userId, { action: 'waiting_for_password', username: username });
    await ctx.reply('Введите пароль (4 цифры):');
    return;
  }
  
  if (state && state.action === 'waiting_for_password') {
    const password = ctx.message.text.trim();
    if (!/^\d{4}$/.test(password)) {
      await ctx.reply('Пароль должен состоять из 4 цифр. Введите пароль:');
      return;
    }
    
    try {
      // Проверяем пользователя в базе
      const { data: user, error } = await supabase
        .from('users')
        .select('id, name, password, chat_id')
        .eq('name', state.username)
        .eq('password', password)
        .single();
      
      if (user && !error) {
        // Обновляем chat_id если нужно
        if (user.chat_id !== chatId) {
          await supabase
            .from('users')
            .update({ chat_id: chatId })
            .eq('id', user.id);
        }
        
        authorizedUsers.set(chatId, user);
        userStates.delete(userId);
        await ctx.reply(`✅ Авторизация успешна, ${user.name}!`, getMainMenu());
      } else {
        await ctx.reply('❌ Неверное имя или пароль. Попробуйте снова.\nВведите ваше имя:');
        userStates.set(userId, { action: 'waiting_for_username' });
      }
    } catch (error) {
      console.error('[BOT] Auth error:', error);
      await ctx.reply('Произошла ошибка при авторизации. Попробуйте позже.');
      userStates.delete(userId);
    }
    return;
  }
  
  // Если нет состояния - не обрабатываем
  if (!state) {
    return;
  }

  if (state.action === 'waiting_for_dish_name') {
    const dishName = ctx.message.text.trim();
    
    if (!dishName || dishName.length === 0) {
      await ctx.reply('Название не может быть пустым. Введите название блюда:');
      return;
    }

    // Переходим к выбору срока
    userStates.set(userId, { 
      action: 'selecting_duration', 
      dish_name: dishName
    });

    await ctx.reply('Выберите срок хранения:', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '12 ч', callback_data: 'duration_12' },
            { text: '24 ч', callback_data: 'duration_24' }
          ],
          [
            { text: '48 ч', callback_data: 'duration_48' },
            { text: '72 ч', callback_data: 'duration_72' }
          ],
          [
            { text: 'Другое время...', callback_data: 'duration_custom' }
          ]
        ]
      }
    });
  } else if (state.action === 'waiting_for_custom_minutes') {
    const minutesText = ctx.message.text.trim();
    const minutes = parseInt(minutesText);
    
    if (isNaN(minutes) || minutes <= 0) {
      await ctx.reply('Пожалуйста, введите положительное число минут (например: 30, 90, 120):');
      return;
    }

    // Сохраняем блюдо с указанным временем в минутах
    await saveDish(ctx, state.dish_name, minutes, userId, true); // true = минуты
  } else if (state.action === 'waiting_for_notification_time') {
    const timeText = ctx.message.text.trim();
    if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(timeText)) {
      await ctx.reply('Неверный формат времени. Введите время в формате ЧЧ:ММ (например: 09:30):');
      return;
    }
    
    try {
      const chatId = ctx.chat.id;
      const { error } = await supabase
        .from('user_settings')
        .upsert({
          chat_id: chatId,
          morning_notification_time: timeText
        }, {
          onConflict: 'chat_id'
        });
      
      if (error) throw error;
      
      userStates.delete(userId);
      await ctx.reply(`✅ Время утреннего уведомления установлено: ${timeText}`, getMainMenu());
    } catch (error) {
      console.error('[BOT] Error saving notification time:', error);
      await ctx.reply('Произошла ошибка при сохранении времени. Попробуйте позже.');
    }
  }
});

// Обработка выбора срока хранения
bot.action(/^duration_/, async (ctx) => {
  const durationStr = ctx.callbackQuery.data.split('_')[1];
  const userId = ctx.from.id;
  const state = userStates.get(userId);

  if (!state || !state.dish_name) {
    await ctx.answerCbQuery('Ошибка: название блюда не найдено');
    return;
  }

  if (durationStr === 'custom') {
    userStates.set(userId, { 
      action: 'waiting_for_custom_minutes',
      dish_name: state.dish_name
    });
    await ctx.editMessageText('Введите время в минутах (например: 30, 90, 120):');
    await ctx.answerCbQuery();
    return;
  }

  const hours = parseInt(durationStr);
  if (isNaN(hours) || hours <= 0) {
    await ctx.answerCbQuery('Ошибка: неверное значение времени');
    return;
  }

  await saveDish(ctx, state.dish_name, hours, userId, false); // false = часы
  await ctx.answerCbQuery();
});

// Сохранение блюда
async function saveDish(ctx, dishName, timeValue, userId, isMinutes = false) {
  try {
    const now = new Date();
    const chatId = ctx.chat.id;
    
    // Конвертируем время в миллисекунды
    let expiresAt;
    if (isMinutes) {
      expiresAt = new Date(now.getTime() + timeValue * 60 * 1000);
    } else {
      expiresAt = new Date(now.getTime() + timeValue * 60 * 60 * 1000);
    }

    // Сохраняем блюдо
    const { data: dish, error: dishError } = await supabase
      .from('dishes')
      .insert({
        name: dishName,
        chat_id: chatId,
        created_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        status: 'active',
        notified_day: false,
        notified_one_hour: false
      })
      .select()
      .single();

    if (dishError) {
      console.error('Supabase error:', dishError);
      throw dishError;
    }

    // Очищаем состояние
    userStates.delete(userId);

    const expiresDateTime = formatDateTime(expiresAt);
    const message = `✅ Блюдо "${dishName}" добавлено!\n` +
      `Срок хранения: до ${expiresDateTime} (${formatTimeUntil(expiresAt)})`;
    
    // Проверяем, является ли это callback query или обычное сообщение
    if (ctx.callbackQuery) {
      // Для callback query используем editMessageText без клавиатуры, затем отправляем новое сообщение с меню
      await ctx.editMessageText(message);
      await ctx.answerCbQuery();
      await ctx.reply('Выберите действие:', getMainMenu());
    } else {
      // Для обычного сообщения просто отправляем ответ с меню
      await ctx.reply(message, getMainMenu());
    }
  } catch (error) {
    console.error('Error saving dish:', error);
    const errorMessage = 'Произошла ошибка при сохранении блюда. Попробуйте позже.';
    
    if (ctx.callbackQuery) {
      await ctx.editMessageText(errorMessage);
      await ctx.answerCbQuery();
    } else {
      await ctx.reply(errorMessage);
    }
    userStates.delete(userId);
  }
}

// Обработка списания блюда
bot.action(/^remove_/, async (ctx) => {
  const dishId = parseInt(ctx.callbackQuery.data.split('_')[1]);

  try {
    // Получаем информацию о блюде перед удалением
    const { data: dish, error: fetchError } = await supabase
      .from('dishes')
      .select('name')
      .eq('id', dishId)
      .single();

    if (fetchError) throw fetchError;

    // Обновляем статус
    const { error } = await supabase
      .from('dishes')
      .update({ status: 'removed' })
      .eq('id', dishId);

    if (error) throw error;

    await ctx.answerCbQuery(`✅ Блюдо "${dish.name}" списано`);
    
    // Получаем обновленный список блюд
    const chatId = ctx.chat.id;
    const { data: remainingDishes, error: listError } = await supabase
      .from('dishes')
      .select('id, name, expires_at')
      .eq('status', 'active')
      .eq('chat_id', chatId)
      .order('expires_at', { ascending: true });

    if (listError) {
      // Если ошибка при получении списка, просто обновим текст
      const originalText = ctx.callbackQuery.message.text;
      await ctx.editMessageText(originalText + '\n\n✅ Блюдо списано');
      return;
    }

    if (!remainingDishes || remainingDishes.length === 0) {
      await ctx.editMessageText('✅ Все блюда списаны. Нет активных блюд.');
      return;
    }

    // Обновляем список блюд
    const dishesList = remainingDishes.map((dish, index) => {
      const expiresDate = toMoscowTime(dish.expires_at);
      const expiresTime = formatTime(dish.expires_at);
      const timeUntil = formatTimeUntil(dish.expires_at);
      
      const day = String(expiresDate.getUTCDate()).padStart(2, '0');
      const month = String(expiresDate.getUTCMonth() + 1).padStart(2, '0');
      const dateStr = `${day}.${month}`;
      
      return `${index + 1}. ${dish.name}\n   📅 ${dateStr} ${expiresTime} — ${timeUntil}`;
    }).join('\n\n');

    const buttons = remainingDishes.map((dish, index) => {
      const dishName = dish.name.length > 15 
        ? `${dish.name.substring(0, 12)}...` 
        : dish.name;
      const buttonText = `${index + 1}. ${dishName} ❌ Списать`;
      
      return [{
        text: buttonText,
        callback_data: `remove_${dish.id}`
      }];
    });

    const message = `📦 Список активных блюд:\n\n${dishesList}`;
    await ctx.editMessageText(message, {
      reply_markup: {
        inline_keyboard: buttons
      }
    });
  } catch (error) {
    console.error('[BOT] Error removing dish:', error);
    await ctx.answerCbQuery('Ошибка при списании блюда');
  }
});

// Обработка ошибок
bot.catch((err, ctx) => {
  console.error('[BOT] Error:', err);
  ctx.reply('Произошла ошибка. Попробуйте позже.');
});

// ==================== SCHEDULER ФУНКЦИИ ====================

// Объединенная функция для всех уведомлений
async function sendAllNotifications() {
  const results = {
    daily: { sent: 0, errors: 0 },
    oneHour: { sent: 0, errors: 0 },
    expired: { sent: 0, errors: 0 }
  };

  try {
    const now = getMoscowTime();
    const currentHour = now.getUTCHours();
    const currentMinute = now.getUTCMinutes();
    
    console.log(`[SCHEDULER] Starting at ${now.toISOString()} (МСК: ${currentHour}:${currentMinute})`);

    // 1. Ежедневное уведомление (проверяем настройки каждого пользователя)
    console.log('[SCHEDULER] Checking daily notifications');
    try {
      // Получаем всех пользователей с настройками
      const { data: allUsers, error: usersError } = await supabase
        .from('user_settings')
        .select('chat_id, morning_notification_time');
      
      if (usersError) {
        console.error('[SCHEDULER] Error fetching user settings:', usersError);
      } else {
        // Проверяем каждого пользователя
        for (const userSetting of allUsers || []) {
          const [settingHour, settingMinute] = (userSetting.morning_notification_time || '10:00').split(':').map(Number);
          
          // Проверяем, наступило ли время уведомления для этого пользователя (в пределах 15 минут)
          if (currentHour === settingHour && currentMinute >= settingMinute && currentMinute < settingMinute + 15) {
            console.log(`[SCHEDULER] Sending daily notification to ${userSetting.chat_id} at ${userSetting.morning_notification_time}`);
            
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getUTCDate());
            const todayEnd = new Date(todayStart);
            todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

            const { data: dishes, error } = await supabase
              .from('dishes')
              .select('id, name, expires_at, chat_id')
              .eq('status', 'active')
              .eq('notified_day', false)
              .eq('chat_id', userSetting.chat_id)
              .gte('expires_at', todayStart.toISOString())
              .lt('expires_at', todayEnd.toISOString());

            if (error) {
              console.error(`[SCHEDULER] Error fetching daily dishes for ${userSetting.chat_id}:`, error);
              results.daily.errors++;
            } else if (dishes && dishes.length > 0) {
              console.log(`[SCHEDULER] Found ${dishes.length} dishes expiring today for ${userSetting.chat_id}`);
              
              try {
                const messages = dishes.map(d => 
                  `⚠ Сегодня истекает срок хранения: ${d.name || 'Неизвестное блюдо'} до ${formatTime(d.expires_at)}`
                );
                await bot.telegram.sendMessage(userSetting.chat_id, messages.join('\n'));
                console.log(`[SCHEDULER] Daily notification sent to ${userSetting.chat_id}`);
                results.daily.sent++;
                
                const dishIds = dishes.map(d => d.id);
                await supabase.from('dishes').update({ notified_day: true }).in('id', dishIds);
              } catch (err) {
                console.error(`[SCHEDULER] Error sending daily notification to ${userSetting.chat_id}:`, err.message);
                results.daily.errors++;
              }
            }
          }
        }
      }
      
      // Если нет настроек, используем дефолтное время 10:00
      if (!allUsers || allUsers.length === 0) {
        if (currentHour === 10 && currentMinute < 15) {
          console.log('[SCHEDULER] Checking daily notifications (default 10:00)');
          const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getUTCDate());
          const todayEnd = new Date(todayStart);
          todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

          const { data: dishes, error } = await supabase
            .from('dishes')
            .select('id, name, expires_at, chat_id')
            .eq('status', 'active')
            .eq('notified_day', false)
            .gte('expires_at', todayStart.toISOString())
            .lt('expires_at', todayEnd.toISOString());

          if (error) {
            console.error('[SCHEDULER] Error fetching daily dishes:', error);
            results.daily.errors++;
          } else if (dishes && dishes.length > 0) {
            console.log(`[SCHEDULER] Found ${dishes.length} dishes expiring today`);
            
            const dishesByChat = {};
            for (const dish of dishes) {
              if (!dish.chat_id) continue;
              if (!dishesByChat[dish.chat_id]) dishesByChat[dish.chat_id] = [];
              dishesByChat[dish.chat_id].push(dish);
            }

            for (const [chatId, userDishes] of Object.entries(dishesByChat)) {
              try {
                const messages = userDishes.map(d => 
                  `⚠ Сегодня истекает срок хранения: ${d.name || 'Неизвестное блюдо'} до ${formatTime(d.expires_at)}`
                );
                await bot.telegram.sendMessage(chatId, messages.join('\n'));
                console.log(`[SCHEDULER] Daily notification sent to ${chatId}`);
                results.daily.sent++;
                
                const dishIds = userDishes.map(d => d.id);
                await supabase.from('dishes').update({ notified_day: true }).in('id', dishIds);
              } catch (err) {
                console.error(`[SCHEDULER] Error sending daily notification to ${chatId}:`, err.message);
                results.daily.errors++;
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('[SCHEDULER] Error in daily notifications:', err);
      results.daily.errors++;
    }

    // 2. Уведомление за 1 час до истечения
    console.log('[SCHEDULER] Checking one hour notifications');
    try {
      const nowUTC = new Date(); // UTC для запроса к БД
      const { data: dishes, error } = await supabase
        .from('dishes')
        .select('id, name, expires_at, chat_id')
        .eq('status', 'active')
        .eq('notified_one_hour', false)
        .gte('expires_at', nowUTC.toISOString())
        .lte('expires_at', new Date(nowUTC.getTime() + 60 * 60 * 1000).toISOString());

      if (error) {
        console.error('[SCHEDULER] Error fetching one hour dishes:', error);
        results.oneHour.errors++;
      } else if (dishes && dishes.length > 0) {
        console.log(`[SCHEDULER] Found ${dishes.length} dishes expiring in 1 hour`);
        
        const dishesByChat = {};
        for (const dish of dishes) {
          if (!dish.chat_id) continue;
          if (!dishesByChat[dish.chat_id]) dishesByChat[dish.chat_id] = [];
          dishesByChat[dish.chat_id].push(dish);
        }

        for (const [chatId, userDishes] of Object.entries(dishesByChat)) {
          try {
            const messages = userDishes.map(d => 
              `⏳ Через 1 час истекает: ${d.name || 'Неизвестное блюдо'}`
            );
            await bot.telegram.sendMessage(chatId, messages.join('\n'));
            console.log(`[SCHEDULER] One hour notification sent to ${chatId}`);
            results.oneHour.sent++;
            
            const dishIds = userDishes.map(d => d.id);
            await supabase.from('dishes').update({ notified_one_hour: true }).in('id', dishIds);
          } catch (err) {
            console.error(`[SCHEDULER] Error sending one hour notification to ${chatId}:`, err.message);
            results.oneHour.errors++;
          }
        }
      }
    } catch (err) {
      console.error('[SCHEDULER] Error in one hour notifications:', err);
      results.oneHour.errors++;
    }

    // 3. Уведомления об истекших блюдах
    console.log('[SCHEDULER] Checking expired dishes');
    const nowUTC = new Date(); // UTC для запроса к БД
    console.log('[SCHEDULER] Current time (МСК):', now.toISOString());
    console.log('[SCHEDULER] Current time (UTC):', nowUTC.toISOString());
    try {
      // Получаем все активные блюда для проверки
      const { data: allActiveDishes, error: allError } = await supabase
        .from('dishes')
        .select('id, name, expires_at, chat_id, status')
        .eq('status', 'active')
        .limit(100);
      
      if (allError) {
        console.error('[SCHEDULER] Error fetching all active dishes:', allError);
      } else {
        console.log(`[SCHEDULER] Total active dishes: ${allActiveDishes?.length || 0}`);
        if (allActiveDishes && allActiveDishes.length > 0) {
          const expiredCount = allActiveDishes.filter(d => new Date(d.expires_at) <= nowUTC).length;
          console.log(`[SCHEDULER] Dishes that should be expired: ${expiredCount}`);
        }
      }

      const { data: dishes, error } = await supabase
        .from('dishes')
        .select('id, name, expires_at, chat_id')
        .eq('status', 'active')
        .lte('expires_at', nowUTC.toISOString());

      if (error) {
        console.error('[SCHEDULER] Error fetching expired dishes:', error);
        results.expired.errors++;
      } else if (dishes && dishes.length > 0) {
        console.log(`[SCHEDULER] Found ${dishes.length} expired dishes`);
        dishes.forEach(d => {
          console.log(`[SCHEDULER] Expired dish: ${d.name}, expires_at: ${d.expires_at}, chat_id: ${d.chat_id}`);
        });
        
        const dishesByChat = {};
        for (const dish of dishes) {
          if (!dish.chat_id) {
            console.warn(`[SCHEDULER] Dish ${dish.id} (${dish.name}) has no chat_id`);
            continue;
          }
          if (!dishesByChat[dish.chat_id]) dishesByChat[dish.chat_id] = [];
          dishesByChat[dish.chat_id].push(dish);
        }

        console.log(`[SCHEDULER] Sending expired notifications to ${Object.keys(dishesByChat).length} users`);
        console.log(`[SCHEDULER] Chat IDs:`, Object.keys(dishesByChat));

        for (const [chatId, userDishes] of Object.entries(dishesByChat)) {
          try {
            const messages = userDishes.map(d => 
              `❌ Срок истёк: ${d.name || 'Неизвестное блюдо'}. Требуется списание.`
            );
            const messageText = messages.join('\n');
            console.log(`[SCHEDULER] Attempting to send to chat ${chatId}:`, messageText);
            
            await bot.telegram.sendMessage(chatId, messageText);
            console.log(`[SCHEDULER] ✅ Expired notification sent to ${chatId} for ${userDishes.length} dishes`);
            results.expired.sent++;
            
            const dishIds = userDishes.map(d => d.id);
            const { error: updateError } = await supabase
              .from('dishes')
              .update({ status: 'expired' })
              .in('id', dishIds);
            
            if (updateError) {
              console.error(`[SCHEDULER] Error updating expired dishes:`, updateError);
            } else {
              console.log(`[SCHEDULER] Updated ${dishIds.length} dishes to expired status`);
            }
          } catch (err) {
            console.error(`[SCHEDULER] ❌ Error sending expired notification to ${chatId}:`, err.message);
            console.error(`[SCHEDULER] Error details:`, err);
            results.expired.errors++;
          }
        }
      } else {
        console.log('[SCHEDULER] No expired dishes found (status=active AND expires_at <= now)');
      }
    } catch (err) {
      console.error('[SCHEDULER] Error in expired dishes check:', err);
      console.error('[SCHEDULER] Error stack:', err.stack);
      results.expired.errors++;
    }

    console.log('[SCHEDULER] Summary:', JSON.stringify(results, null, 2));
    return results;

  } catch (error) {
    console.error('[SCHEDULER] Fatal error in sendAllNotifications:', error);
    throw error;
  }
}

// Запуск scheduler каждые 15 минут
setInterval(async () => {
  try {
    await sendAllNotifications();
  } catch (error) {
    console.error('[SCHEDULER] Interval error:', error);
  }
}, 15 * 60 * 1000); // 15 минут

// HTTP сервер для webhook
const http = require('http');

const server = http.createServer(async (req, res) => {
  // Обработка webhook от Telegram
  // Netlify Servers автоматически проксирует запросы, поэтому проверяем путь
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'POST' && (url.pathname === '/webhook' || url.pathname === '/.netlify/server')) {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      try {
        const update = JSON.parse(body);
        console.log('[BOT] Webhook update received:', update.update_id);
        await bot.handleUpdate(update);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        console.error('[BOT] Webhook error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// Запуск сервера
const PORT = process.env.PORT || 8888;

async function startServer() {
  try {
    // Удаляем webhook если был установлен (для чистоты)
    try {
      await bot.telegram.deleteWebhook();
      console.log('[BOT] Old webhook removed');
    } catch (error) {
      console.log('[BOT] No old webhook to remove');
    }
    
    // Запускаем HTTP сервер
    server.listen(PORT, () => {
      console.log(`[SERVER] HTTP server started on port ${PORT}`);
      console.log(`[SERVER] Webhook URL: https://devserver-main--oliviebot.netlify.app/webhook`);
    });
    
    // Запускаем scheduler сразу при старте
    console.log('[SCHEDULER] Running initial notification check...');
    await sendAllNotifications();
    
    console.log('[BOT] Server ready to receive webhook updates');
  } catch (error) {
    console.error('[SERVER] Error starting server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('[SERVER] Shutting down...');
  server.close();
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log('[SERVER] Shutting down...');
  server.close();
  process.exit(0);
});

// Запускаем сервер
startServer();

