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

// Команда /help
// Тестовая команда для проверки уведомлений
bot.command('test_notifications', async (ctx) => {
  try {
    await checkAuth(ctx);
    await ctx.reply('🔍 Проверяю уведомления...');
    
    // Запускаем проверку уведомлений вручную
    const results = await sendAllNotifications();
    
    const message = `📊 Результаты проверки уведомлений:\n\n` +
      `✅ Ежедневные: ${results.daily.sent} отправлено, ${results.daily.errors} ошибок\n` +
      `⏳ За 1 час: ${results.oneHour.sent} отправлено, ${results.oneHour.errors} ошибок\n` +
      `❌ Истекшие: ${results.expired.sent} отправлено, ${results.expired.errors} ошибок`;
    
    await ctx.reply(message);
  } catch (error) {
    console.error('[BOT] Error in test_notifications:', error);
    await ctx.reply('❌ Ошибка при проверке уведомлений: ' + error.message);
  }
});

bot.command('help', async (ctx) => {
  const isAuthorized = await checkAuth(ctx);
  if (!isAuthorized) {
    await ctx.reply('Необходима авторизация. Используйте /start');
    return;
  }
  
  const helpText = `📖 Помощь по использованию бота

🕐 **Часовой пояс**
Все времена отображаются и обрабатываются в часовом поясе МСК (Московское время, UTC+3).

📋 **Основные функции:**

➕ **Добавить блюдо**
• Выберите из последних использованных названий или введите новое
• Укажите срок хранения: 12ч, 24ч, 48ч, 72ч или введите кастомное время в минутах

📦 **Список блюд**
• Показывает все активные блюда
• Отображает дату истечения (в формате МСК) и оставшееся время
• Кнопка "❌ Списать" для каждого блюда

🗑 **Списанные блюда**
• История всех списанных и истекших блюд
• Показывает статус (Списано/Истёк) и дату создания

⚙️ **Настройки**
• Настройка времени утреннего уведомления
• Можно выбрать из предложенных или ввести кастомное время (ЧЧ:ММ)

🔔 **Уведомления:**
• Ежедневно в установленное время (по умолчанию 10:00 МСК) - о блюдах, срок которых истекает сегодня
• За 1 час до истечения - предупреждение
• При истечении срока - уведомление о необходимости списания

💡 **Совет:** Все времена в боте отображаются в московском времени (МСК).`;

  await ctx.reply(helpText, { parse_mode: 'Markdown' });
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

    // Проверяем, не истек ли уже срок (по МСК)
    const nowMoscow = getMoscowTime();
    const nowUTC = new Date(nowMoscow.getTime() - 3 * 60 * 60 * 1000); // МСК -> UTC для сравнения с БД
    const isExpired = new Date(expiresAt) <= nowUTC;

    if (isExpired) {
      // Срок уже истек - сразу отправляем уведомление и обновляем статус
      console.log(`[BOT] Dish "${dishName}" already expired, sending notification immediately`);
      
      // Обновляем статус на expired
      await supabase
        .from('dishes')
        .update({ status: 'expired' })
        .eq('id', dish.id);
      
      // Отправляем уведомление
      const expiredMessage = `❌ Срок истёк: ${dishName}. Требуется списание.`;
      await ctx.reply(expiredMessage);
      
      const expiresDateTime = formatDateTime(expiresAt);
      const message = `✅ Блюдо "${dishName}" добавлено!\n` +
        `Срок хранения: до ${expiresDateTime} (${formatTimeUntil(expiresAt)})\n` +
        `⚠️ Внимание: срок уже истёк!`;
      
      // Проверяем, является ли это callback query или обычное сообщение
      if (ctx.callbackQuery) {
        await ctx.editMessageText(message);
        await ctx.answerCbQuery();
        await ctx.reply('Выберите действие:', getMainMenu());
      } else {
        await ctx.reply(message, getMainMenu());
      }
    } else {
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
    const nowMoscow = getMoscowTime();
    const currentHour = nowMoscow.getUTCHours();
    const currentMinute = nowMoscow.getUTCMinutes();
    
    console.log(`[SCHEDULER] ========================================`);
    console.log(`[SCHEDULER] Starting notification check`);
    console.log(`[SCHEDULER] Current time (МСК): ${currentHour}:${String(currentMinute).padStart(2, '0')}`);
    console.log(`[SCHEDULER] ISO time: ${nowMoscow.toISOString()}`);
    console.log(`[SCHEDULER] ========================================`);

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
        console.log(`[SCHEDULER] Found ${allUsers?.length || 0} users with settings`);
        // Проверяем каждого пользователя
        for (const userSetting of allUsers || []) {
          const [settingHour, settingMinute] = (userSetting.morning_notification_time || '10:00').split(':').map(Number);
          console.log(`[SCHEDULER] Checking user ${userSetting.chat_id}: setting time ${settingHour}:${String(settingMinute).padStart(2, '0')}, current ${currentHour}:${String(currentMinute).padStart(2, '0')}`);
          
          // Проверяем, наступило ли время уведомления для этого пользователя (в пределах 15 минут)
          const isTimeMatch = currentHour === settingHour && currentMinute >= settingMinute && currentMinute < settingMinute + 15;
          console.log(`[SCHEDULER] Time match: ${isTimeMatch} (current: ${currentHour}:${String(currentMinute).padStart(2, '0')}, setting: ${settingHour}:${String(settingMinute).padStart(2, '0')})`);
          
          if (isTimeMatch) {
            console.log(`[SCHEDULER] Sending daily notification to ${userSetting.chat_id} at ${userSetting.morning_notification_time}`);
            
            // Сегодня в МСК - конвертируем в UTC для сравнения с БД
            const todayStartMoscow = new Date(nowMoscow.getFullYear(), nowMoscow.getMonth(), nowMoscow.getUTCDate());
            const todayStartUTC = new Date(todayStartMoscow.getTime() - 3 * 60 * 60 * 1000); // МСК -> UTC
            const todayEndUTC = new Date(todayStartUTC.getTime() + 24 * 60 * 60 * 1000);

            console.log(`[SCHEDULER] Querying dishes for chat ${userSetting.chat_id}`);
            console.log(`[SCHEDULER] Date range: ${todayStartUTC.toISOString()} to ${todayEndUTC.toISOString()}`);
            
            const { data: dishes, error } = await supabase
              .from('dishes')
              .select('id, name, expires_at, chat_id')
              .eq('status', 'active')
              .eq('notified_day', false)
              .eq('chat_id', userSetting.chat_id)
              .gte('expires_at', todayStartUTC.toISOString())
              .lt('expires_at', todayEndUTC.toISOString());

            if (error) {
              console.error(`[SCHEDULER] Error fetching daily dishes for ${userSetting.chat_id}:`, error);
              results.daily.errors++;
            } else {
              console.log(`[SCHEDULER] Found ${dishes?.length || 0} dishes expiring today for ${userSetting.chat_id}`);
              if (dishes && dishes.length > 0) {
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
      }
      
      // Если нет настроек, используем дефолтное время 10:00
      if (!allUsers || allUsers.length === 0) {
        console.log('[SCHEDULER] No user settings found, using default 10:00');
        const isDefaultTime = currentHour === 10 && currentMinute < 15;
        console.log(`[SCHEDULER] Default time check: ${isDefaultTime} (current: ${currentHour}:${String(currentMinute).padStart(2, '0')})`);
        if (isDefaultTime) {
          console.log('[SCHEDULER] Checking daily notifications (default 10:00)');
          // Сегодня в МСК - конвертируем в UTC для сравнения с БД
          const todayStartMoscow = new Date(nowMoscow.getFullYear(), nowMoscow.getMonth(), nowMoscow.getUTCDate());
          const todayStartUTC = new Date(todayStartMoscow.getTime() - 3 * 60 * 60 * 1000); // МСК -> UTC
          const todayEndUTC = new Date(todayStartUTC.getTime() + 24 * 60 * 60 * 1000);

          const { data: dishes, error } = await supabase
            .from('dishes')
            .select('id, name, expires_at, chat_id')
            .eq('status', 'active')
            .eq('notified_day', false)
            .gte('expires_at', todayStartUTC.toISOString())
            .lt('expires_at', todayEndUTC.toISOString());

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
      // Используем МСК для сравнения (expires_at в БД хранится в UTC, но сравниваем с МСК)
      const nowMoscow1h = getMoscowTime();
      const nowUTC1h = new Date(nowMoscow1h.getTime() - 3 * 60 * 60 * 1000); // Конвертируем МСК обратно в UTC для сравнения с БД
      const oneHourLaterUTC = new Date(nowUTC1h.getTime() + 60 * 60 * 1000);
      
      // ИСПРАВЛЕНИЕ: проверяем блюда, которые истекают РОВНО через 1 час (с допуском ±5 минут)
      // То есть: expires_at должен быть между (now + 55 минут) и (now + 65 минут)
      const minTime = new Date(nowUTC1h.getTime() + 55 * 60 * 1000); // 55 минут от сейчас
      const maxTime = new Date(nowUTC1h.getTime() + 65 * 60 * 1000); // 65 минут от сейчас
      
      console.log(`[SCHEDULER] Querying dishes expiring in ~1 hour (55-65 minutes from now)`);
      console.log(`[SCHEDULER] Current МСК: ${nowMoscow1h.toISOString()}`);
      console.log(`[SCHEDULER] Current UTC: ${nowUTC1h.toISOString()}`);
      console.log(`[SCHEDULER] Time range: ${minTime.toISOString()} to ${maxTime.toISOString()}`);
      
      const { data: dishes, error } = await supabase
        .from('dishes')
        .select('id, name, expires_at, chat_id')
        .eq('status', 'active')
        .eq('notified_one_hour', false)
        .gte('expires_at', minTime.toISOString())
        .lte('expires_at', maxTime.toISOString());
      
      // Дополнительная диагностика: показываем все блюда в этом диапазоне
      if (!error && dishes) {
        console.log(`[SCHEDULER] Found ${dishes.length} dishes in 1-hour range (55-65 minutes)`);
        dishes.forEach(d => {
          const expiresAt = new Date(d.expires_at);
          const diffMs = expiresAt - nowUTC1h;
          const diffMinutes = Math.floor(diffMs / 60000);
          const diffHours = (diffMinutes / 60).toFixed(1);
          console.log(`[SCHEDULER]   - "${d.name}": expires_at=${d.expires_at}, diff=${diffMinutes} minutes (${diffHours} hours) from now`);
        });
      }

      if (error) {
        console.error('[SCHEDULER] Error fetching one hour dishes:', error);
        results.oneHour.errors++;
      } else {
        console.log(`[SCHEDULER] Found ${dishes?.length || 0} dishes expiring in 1 hour`);
        if (dishes && dishes.length > 0) {
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
      }
    } catch (err) {
      console.error('[SCHEDULER] Error in one hour notifications:', err);
      results.oneHour.errors++;
    }

    // 3. Уведомления об истекших блюдах
    console.log('[SCHEDULER] Checking expired dishes');
    // Используем МСК для сравнения (expires_at в БД хранится в UTC, но сравниваем с МСК)
    const nowMoscowExp = getMoscowTime();
    const nowUTCExp = new Date(nowMoscowExp.getTime() - 3 * 60 * 60 * 1000); // Конвертируем МСК обратно в UTC для сравнения с БД
    console.log('[SCHEDULER] Current time (МСК):', nowMoscowExp.toISOString());
    console.log('[SCHEDULER] Current time (UTC for DB):', nowUTCExp.toISOString());
    try {
      // Получаем ВСЕ блюда (не только active) для диагностики
      const { data: allDishesDebug, error: allDishesError } = await supabase
        .from('dishes')
        .select('id, name, expires_at, chat_id, status')
        .limit(100);
      
      if (allDishesError) {
        console.error('[SCHEDULER] Error fetching all dishes:', allDishesError);
      } else {
        console.log(`[SCHEDULER] Total dishes in DB (all statuses): ${allDishesDebug?.length || 0}`);
        if (allDishesDebug && allDishesDebug.length > 0) {
          const activeCount = allDishesDebug.filter(d => d.status === 'active').length;
          console.log(`[SCHEDULER] Active dishes: ${activeCount}`);
          console.log(`[SCHEDULER] Removed dishes: ${allDishesDebug.filter(d => d.status === 'removed').length}`);
          console.log(`[SCHEDULER] Expired dishes: ${allDishesDebug.filter(d => d.status === 'expired').length}`);
          
          // Показываем все активные блюда
          const activeDishes = allDishesDebug.filter(d => d.status === 'active');
          if (activeDishes.length > 0) {
            console.log(`[SCHEDULER] Active dishes details:`);
            activeDishes.forEach(d => {
              const expiresAt = new Date(d.expires_at);
              const isExpired = expiresAt <= nowUTCExp;
              console.log(`[SCHEDULER]   - "${d.name}": expires_at=${d.expires_at}, isExpired=${isExpired}, chat_id=${d.chat_id}`);
            });
          }
        }
      }
      
      // Получаем все активные блюда для проверки
      const { data: allActiveDishes, error: allError } = await supabase
        .from('dishes')
        .select('id, name, expires_at, chat_id, status')
        .eq('status', 'active')
        .limit(100);
      
      if (allError) {
        console.error('[SCHEDULER] Error fetching all active dishes:', allError);
      } else {
        console.log(`[SCHEDULER] Total active dishes (from query): ${allActiveDishes?.length || 0}`);
        if (allActiveDishes && allActiveDishes.length > 0) {
          const expiredCount = allActiveDishes.filter(d => new Date(d.expires_at) <= nowUTCExp).length;
          console.log(`[SCHEDULER] Dishes that should be expired (МСК): ${expiredCount}`);
        }
      }

      console.log(`[SCHEDULER] Querying expired dishes`);
      console.log(`[SCHEDULER] Expired before: ${nowUTCExp.toISOString()}`);
      console.log(`[SCHEDULER] Current MСК time: ${nowMoscowExp.toISOString()}`);
      
      // Дополнительная проверка: получаем все активные блюда и проверяем вручную
      const { data: allDishes, error: allDishesError2 } = await supabase
        .from('dishes')
        .select('id, name, expires_at, chat_id, status')
        .eq('status', 'active');
      
      if (!allDishesError2 && allDishes) {
        console.log(`[SCHEDULER] Total active dishes in DB: ${allDishes.length}`);
        allDishes.forEach(d => {
          const expiresAt = new Date(d.expires_at);
          const isExpired = expiresAt <= nowUTCExp;
          console.log(`[SCHEDULER] Dish "${d.name}": expires_at=${d.expires_at}, isExpired=${isExpired}, chat_id=${d.chat_id}`);
        });
      }
      
      // ВАЖНО: для истекших блюд НЕ проверяем флаги notified_* - они должны отправляться каждый раз пока не списаны
      // ВАЖНО: для истекших блюд проверяем И active И expired статусы
      // Это позволяет отправлять уведомления даже после того, как статус изменился на expired
      const { data: dishes, error } = await supabase
        .from('dishes')
        .select('id, name, expires_at, chat_id, status')
        .in('status', ['active', 'expired']) // Проверяем и active, и expired
        .lte('expires_at', nowUTCExp.toISOString());

      if (error) {
        console.error('[SCHEDULER] Error fetching expired dishes:', error);
        results.expired.errors++;
      } else {
        console.log(`[SCHEDULER] Found ${dishes?.length || 0} expired dishes`);
        if (dishes && dishes.length > 0) {
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
              
              // ВАЖНО: обновляем статус на 'expired' только для блюд со статусом 'active'
              // Блюда со статусом 'expired' уже обновлены, их не трогаем
              // Это позволяет отправлять уведомления повторно, пока блюдо не списано
              const dishIds = userDishes
                .filter(d => d.status === 'active')
                .map(d => d.id);
              
              if (dishIds.length > 0) {
                const { error: updateError } = await supabase
                  .from('dishes')
                  .update({ status: 'expired' })
                  .in('id', dishIds);
                
                if (updateError) {
                  console.error(`[SCHEDULER] Error updating expired dishes:`, updateError);
                } else {
                  console.log(`[SCHEDULER] Updated ${dishIds.length} dishes to expired status (but keeping them for repeated notifications)`);
                }
              } else {
                console.log(`[SCHEDULER] All dishes already have expired status, skipping update (will continue sending notifications)`);
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
      }
    } catch (err) {
      console.error('[SCHEDULER] Error in expired dishes check:', err);
      console.error('[SCHEDULER] Error stack:', err.stack);
      results.expired.errors++;
    }

    console.log('[SCHEDULER] ========================================');
    console.log('[SCHEDULER] Summary:');
    console.log(`[SCHEDULER] Daily notifications: ${results.daily.sent} sent, ${results.daily.errors} errors`);
    console.log(`[SCHEDULER] One hour notifications: ${results.oneHour.sent} sent, ${results.oneHour.errors} errors`);
    console.log(`[SCHEDULER] Expired notifications: ${results.expired.sent} sent, ${results.expired.errors} errors`);
    console.log('[SCHEDULER] ========================================');
    return results;

  } catch (error) {
    console.error('[SCHEDULER] Fatal error in sendAllNotifications:', error);
    throw error;
  }
}

// Запуск scheduler каждые 15 минут
let schedulerInterval = null;

function startScheduler() {
  // Проверяем, не запущен ли уже scheduler
  if (schedulerInterval) {
    console.log('[SCHEDULER] ⚠️ Scheduler already running (interval ID: ' + schedulerInterval + '), skipping...');
    return;
  }
  
  console.log('[SCHEDULER] ========================================');
  console.log('[SCHEDULER] Starting scheduler...');
  console.log('[SCHEDULER] ========================================');
  
  // Запускаем сразу
  console.log('[SCHEDULER] Running initial notification check...');
  sendAllNotifications().catch(error => {
    console.error('[SCHEDULER] Initial run error:', error);
    console.error('[SCHEDULER] Error stack:', error.stack);
  });
  
  // Затем каждую минуту
  schedulerInterval = setInterval(async () => {
    try {
      console.log('[SCHEDULER] ========================================');
      console.log('[SCHEDULER] Scheduled run triggered (every 1 minute)');
      console.log('[SCHEDULER] ========================================');
      await sendAllNotifications();
    } catch (error) {
      console.error('[SCHEDULER] Interval error:', error);
      console.error('[SCHEDULER] Error stack:', error.stack);
    }
  }, 60 * 1000); // 1 минута
  
  console.log('[SCHEDULER] ✅ Scheduler started successfully');
  console.log('[SCHEDULER] Will run every 1 minute');
  console.log('[SCHEDULER] Interval ID:', schedulerInterval);
  console.log('[SCHEDULER] ========================================');
}

// HTTP сервер для health check (Render)
const http = require('http');
const PORT = process.env.PORT || 4000;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'oliviebot' }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// Запуск бота через polling
async function startBot() {
  try {
    console.log('[BOT] Initializing bot...');
    
    // Проверяем токен перед началом работы
    if (!process.env.BOT_TOKEN) {
      console.error('[BOT] ❌ ERROR: BOT_TOKEN is not set in environment variables!');
      console.error('[BOT] Please set BOT_TOKEN in Render Dashboard → Environment');
      process.exit(1);
    }
    
    // Проверяем валидность токена через getMe
    try {
      const botInfo = await bot.telegram.getMe();
      console.log(`[BOT] ✅ Bot token is valid. Bot username: @${botInfo.username}`);
    } catch (error) {
      if (error.response && error.response.error_code === 401) {
        console.error('[BOT] ❌ ERROR: Invalid bot token (401 Unauthorized)');
        console.error('[BOT] Please check BOT_TOKEN in Render Dashboard → Environment');
        console.error('[BOT] Make sure the token is correct and saved');
        process.exit(1);
      } else {
        console.error('[BOT] ❌ ERROR: Could not verify bot token:', error.message);
        process.exit(1);
      }
    }
    
    // Агрессивное удаление webhook - больше попыток и задержек
    console.log('[BOT] Starting aggressive webhook removal...');
    let webhookDeleted = false;
    for (let i = 0; i < 5; i++) {
      try {
        console.log(`[BOT] Attempting to delete webhook (attempt ${i + 1}/5)...`);
        const result = await bot.telegram.deleteWebhook({ drop_pending_updates: true });
        console.log('[BOT] Webhook deleted successfully:', result);
        webhookDeleted = true;
        await new Promise(resolve => setTimeout(resolve, 3000)); // Ждем 3 секунды после удаления
        break; // Выходим из цикла при успехе
      } catch (error) {
        if (error.response && error.response.error_code === 401) {
          console.error(`[BOT] ❌ ERROR: Invalid bot token (401 Unauthorized) on attempt ${i + 1}/5`);
          console.error('[BOT] Please check BOT_TOKEN in Render Dashboard → Environment');
          console.error('[BOT] Make sure the token is correct and saved');
          process.exit(1);
        }
        console.log(`[BOT] Error deleting webhook (attempt ${i + 1}/5):`, error.message);
        if (i < 4) {
          await new Promise(resolve => setTimeout(resolve, 3000)); // Ждем 3 секунды перед повтором
        }
      }
    }

    // Проверяем текущий webhook несколько раз с более длинными задержками
    console.log('[BOT] Verifying webhook is deleted...');
    for (let i = 0; i < 7; i++) {
      try {
        const webhookInfo = await bot.telegram.getWebhookInfo();
        console.log(`[BOT] Webhook check ${i + 1}/7:`, JSON.stringify(webhookInfo, null, 2));

        if (webhookInfo.url && webhookInfo.url !== '') {
          console.log('[BOT] WARNING: Webhook still exists, deleting again...');
          await bot.telegram.deleteWebhook({ drop_pending_updates: true });
          await new Promise(resolve => setTimeout(resolve, 5000)); // Увеличена задержка до 5 секунд
        } else {
          console.log('[BOT] ✅ Webhook confirmed deleted - no webhook URL found');
          break;
        }
      } catch (error) {
        console.log(`[BOT] Could not check webhook info (attempt ${i + 1}/7):`, error.message);
        if (i < 6) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    }
    
    // Финальная проверка webhook перед запуском polling
    try {
      const finalWebhookCheck = await bot.telegram.getWebhookInfo();
      if (finalWebhookCheck.url && finalWebhookCheck.url !== '') {
        console.log('[BOT] ⚠️ WARNING: Webhook still exists after all attempts:', finalWebhookCheck.url);
      } else {
        console.log('[BOT] ✅ Final webhook check: confirmed deleted');
      }
    } catch (error) {
      console.log('[BOT] Could not perform final webhook check:', error.message);
    }
    
    // Дополнительная задержка перед запуском polling (увеличена для Render)
    console.log('[BOT] Waiting 15 seconds before starting polling to ensure webhook is fully removed...');
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    // Запускаем HTTP сервер для health check
    server.listen(PORT, () => {
      console.log(`[SERVER] Health check server started on port ${PORT}`);
      console.log(`[SERVER] Health check: http://localhost:${PORT}/health`);
    });
    
    // Запускаем polling с обработкой ошибок конфликта
    console.log('[BOT] Starting bot with polling...');
    console.log('[BOT] Note: If you see 409 error, another bot instance is running polling');
    console.log('[BOT] Check Render Dashboard - ensure only ONE service is running');
    let pollingStarted = false;
    let retryCount = 0;
    const maxRetries = 5;
    
    while (!pollingStarted && retryCount < maxRetries) {
      try {
        console.log(`[BOT] Attempting to start polling (attempt ${retryCount + 1}/${maxRetries})...`);
        await bot.launch({
          dropPendingUpdates: true, // Игнорируем старые обновления
          allowedUpdates: ['message', 'callback_query'] // Только нужные типы обновлений
        });
        pollingStarted = true;
        console.log('[BOT] ✅ Bot started successfully with polling');
      } catch (error) {
        retryCount++;
        if (error.response && error.response.error_code === 409) {
          console.error(`[BOT] ❌ Conflict error (attempt ${retryCount}/${maxRetries}): Another instance is running`);
          if (retryCount < maxRetries) {
            const waitTime = retryCount * 10; // Увеличиваем задержку: 10, 20, 30, 40, 50 секунд
            console.log(`[BOT] Waiting ${waitTime} seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
            
            // Пытаемся еще раз удалить webhook перед повтором
            try {
              await bot.telegram.deleteWebhook({ drop_pending_updates: true });
              console.log('[BOT] Webhook deleted again before retry');
              // Дополнительная задержка после удаления webhook
              await new Promise(resolve => setTimeout(resolve, 5000));
            } catch (e) {
              console.log('[BOT] Could not delete webhook:', e.message);
            }
          } else {
            console.error('[BOT] ❌ Max retries reached. Please ensure only one bot instance is running.');
            console.error('[BOT] ============================================');
            console.error('[BOT] DIAGNOSTIC INFORMATION:');
            console.error('[BOT] ============================================');
            console.error('[BOT] Error: 409 Conflict - Another bot instance is using polling');
            console.error('[BOT] This means another process is calling getUpdates with the same token');
            console.error('[BOT] Possible causes:');
            console.error('[BOT] 1. Multiple services running on Render with the same BOT_TOKEN');
            console.error('[BOT] 2. Another deployment/service is still running');
            console.error('[BOT] 3. Local development instance is running');
            console.error('[BOT] ============================================');
            console.error('[BOT] SOLUTION:');
            console.error('[BOT] 1. Go to Render Dashboard → Services');
            console.error('[BOT] 2. Check if there are multiple services with the same bot');
            console.error('[BOT] 3. Stop ALL other services except ONE');
            console.error('[BOT] 4. Wait 30 seconds, then restart this service');
            console.error('[BOT] ============================================');
            console.error('[BOT] This instance will continue running scheduler only.');
            
            // Запускаем scheduler даже если polling не запустился
            console.log('[SCHEDULER] Starting scheduler anyway (bot may work via webhook or another instance)...');
            startScheduler();
            
            // Не завершаем процесс - scheduler будет работать
            console.log('[BOT] ⚠️ Bot polling failed, but scheduler is running.');
            console.log('[BOT] ⚠️ To fix: Stop other bot instances and restart this service.');
            return; // Выходим из функции, но процесс продолжает работать
          }
        } else {
          throw error;
        }
      }
    }
    
    // Запускаем scheduler
    console.log('[SCHEDULER] Starting scheduler...');
    startScheduler();
    
    console.log('[BOT] Bot is ready and polling for updates');
  } catch (error) {
    console.error('[BOT] ❌ Error starting bot:', error);
    console.error('[BOT] Error stack:', error.stack);
    
    // Если это не ошибка 409, запускаем scheduler и завершаем процесс
    if (!error.response || error.response.error_code !== 409) {
      console.log('[SCHEDULER] Starting scheduler before exit...');
      startScheduler();
      // Даем scheduler время запуститься
      await new Promise(resolve => setTimeout(resolve, 2000));
      process.exit(1);
    } else {
      // Для ошибки 409 - продолжаем работу со scheduler
      console.error('[BOT] ============================================');
      console.error('[BOT] DIAGNOSTIC INFORMATION:');
      console.error('[BOT] ============================================');
      console.error('[BOT] Error: 409 Conflict - Another bot instance is using polling');
      console.error('[BOT] This means another process is calling getUpdates with the same token');
      console.error('[BOT] Possible causes:');
      console.error('[BOT] 1. Multiple services running on Render with the same BOT_TOKEN');
      console.error('[BOT] 2. Another deployment/service is still running');
      console.error('[BOT] 3. Local development instance is running');
      console.error('[BOT] ============================================');
      console.error('[BOT] SOLUTION:');
      console.error('[BOT] 1. Go to Render Dashboard → Services');
      console.error('[BOT] 2. Check if there are multiple services with the same bot');
      console.error('[BOT] 3. Stop ALL other services except ONE');
      console.error('[BOT] 4. Wait 30 seconds, then restart this service');
      console.error('[BOT] ============================================');
      console.log('[SCHEDULER] Starting scheduler (409 error - another instance running)...');
      startScheduler();
      console.log('[BOT] ⚠️ Bot polling failed due to conflict, but scheduler is running.');
      console.log('[BOT] ⚠️ To fix: Stop other bot instances and restart this service.');
      // Не завершаем процесс - scheduler будет работать
    }
  }
}

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('[BOT] Shutting down...');
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }
  server.close();
  bot.stop('SIGINT');
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log('[BOT] Shutting down...');
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }
  server.close();
  bot.stop('SIGTERM');
  process.exit(0);
});

// Запускаем бота
startBot();

