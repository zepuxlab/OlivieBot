const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const http = require('http');

// ==================== ИНИЦИАЛИЗАЦИЯ ====================

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const PORT = process.env.PORT || 4000;

if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ ERROR: Missing environment variables!');
  console.error('Required: BOT_TOKEN, SUPABASE_URL, SUPABASE_KEY');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Состояния пользователей
const userStates = new Map();
const authorizedUsers = new Map();

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

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

// Форматирование времени до истечения
function formatTimeUntil(expiresAt) {
  const now = new Date();
  const expires = new Date(expiresAt);
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

// Форматирование времени
function formatTime(date) {
  const d = new Date(date);
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

// Форматирование даты и времени
function formatDateTime(date) {
  const d = new Date(date);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day}.${month} ${hours}:${minutes}`;
}

// Проверка авторизации
async function checkAuth(ctx) {
  const chatId = ctx.chat.id;
  
  if (authorizedUsers.has(chatId)) {
    return true;
  }
  
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

// ==================== КОМАНДЫ БОТА ====================

// Команда /start
bot.start(async (ctx) => {
  const chatId = ctx.chat.id;
  
  const isAuthorized = await checkAuth(ctx);
  if (isAuthorized) {
    await ctx.reply('Добро пожаловать! Используйте меню для навигации.', getMainMenu());
    return;
  }
  
  await ctx.reply('Для использования бота необходима авторизация.\nВведите ваше имя:');
  userStates.set(chatId, { step: 'waiting_for_name' });
});

// Команда /help
bot.command('help', async (ctx) => {
  const isAuthorized = await checkAuth(ctx);
  if (!isAuthorized) {
    await ctx.reply('Необходима авторизация. Используйте /start');
    return;
  }
  
  const helpText = `📖 Помощь по использованию бота

🕐 **Часовой пояс**
Все времена отображаются и обрабатываются в часовом поясе UTC.

📋 **Основные функции:**

➕ **Добавить блюдо**
• Выберите из последних использованных названий или введите новое
• Укажите срок хранения: 12ч, 24ч, 48ч, 72ч или введите кастомное время в минутах

📦 **Список блюд**
• Показывает все активные блюда
• Отображает дату истечения (в формате UTC) и оставшееся время
• Кнопка "❌ Списать" для каждого блюда

🗑 **Списанные блюда**
• История всех списанных и истекших блюд
• Показывает статус (Списано/Истёк) и дату создания

⚙️ **Настройки**
• Настройка времени утреннего уведомления
• Можно выбрать из предложенных или ввести кастомное время (ЧЧ:ММ)

🔔 **Уведомления:**
• Ежедневно в установленное время (по умолчанию 10:00 UTC) - о блюдах, срок которых истекает сегодня
• За 1 час до истечения - предупреждение
• При истечении срока - уведомление о необходимости списания (проверяется каждую минуту)

💡 **Совет:** Все времена в боте отображаются в UTC.`;

  await ctx.reply(helpText, { parse_mode: 'Markdown' });
});

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text;
  const state = userStates.get(chatId);
  
  // Проверяем, не является ли это командой меню
  if (['➕ Добавить блюдо', '📦 Список блюд', '🗑 Списанные блюда', '⚙️ Настройки'].includes(text)) {
    return; // Обработается в bot.hears
  }
  
  // Обработка авторизации
  if (state && state.step === 'waiting_for_name') {
    const name = text.trim();
    if (name.length < 2) {
      await ctx.reply('Имя должно содержать минимум 2 символа. Попробуйте снова:');
      return;
    }
    
    userStates.set(chatId, { step: 'waiting_for_password', name });
    await ctx.reply('Введите пароль (4 цифры):');
    return;
  }
  
  if (state && state.step === 'waiting_for_password') {
    const password = text.trim();
    if (!/^\d{4}$/.test(password)) {
      await ctx.reply('Пароль должен состоять из 4 цифр. Попробуйте снова:');
      return;
    }
    
    try {
      const { data: user, error } = await supabase
        .from('users')
        .insert({
          name: state.name,
          password: password,
          chat_id: chatId
        })
        .select()
        .single();
      
      if (error) {
        if (error.code === '23505') { // Unique violation
          await ctx.reply('Пользователь с таким именем уже существует. Введите другое имя:');
          userStates.set(chatId, { step: 'waiting_for_name' });
        } else {
          await ctx.reply('Ошибка при регистрации. Попробуйте снова через /start');
          userStates.delete(chatId);
        }
        return;
      }
      
      authorizedUsers.set(chatId, user);
      userStates.delete(chatId);
      await ctx.reply('✅ Авторизация успешна! Теперь вы можете использовать бота.', getMainMenu());
    } catch (error) {
      console.error('Error during registration:', error);
      await ctx.reply('Произошла ошибка. Попробуйте снова через /start');
      userStates.delete(chatId);
    }
    return;
  }
  
  // Обработка ввода названия блюда
  if (state && state.step === 'waiting_for_dish_name') {
    const dishName = text.trim();
    if (dishName.length < 1) {
      await ctx.reply('Название блюда не может быть пустым. Попробуйте снова:');
      return;
    }
    
    userStates.set(chatId, { step: 'waiting_for_duration', dishName });
    
    const inlineKeyboard = {
      inline_keyboard: [
        [{ text: '12 часов', callback_data: 'duration_12' }],
        [{ text: '24 часа', callback_data: 'duration_24' }],
        [{ text: '48 часов', callback_data: 'duration_48' }],
        [{ text: '72 часа', callback_data: 'duration_72' }],
        [{ text: 'Другое время...', callback_data: 'duration_custom' }]
      ]
    };
    
    await ctx.reply('Выберите срок хранения:', { reply_markup: inlineKeyboard });
    return;
  }
  
  // Обработка кастомного времени (в минутах)
  if (state && state.step === 'waiting_for_custom_minutes') {
    const minutes = parseInt(text.trim());
    if (isNaN(minutes) || minutes <= 0) {
      await ctx.reply('Введите положительное число минут:');
      return;
    }
    
    await saveDish(ctx, state.dishName, minutes, chatId, true);
    return;
  }
  
  // Обработка времени утреннего уведомления
  if (state && state.step === 'waiting_for_notification_time') {
    const timeMatch = text.match(/^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/);
    if (!timeMatch) {
      await ctx.reply('Неверный формат времени. Используйте формат ЧЧ:ММ (например, 10:00):');
      return;
    }
    
    try {
      const { error } = await supabase
        .from('user_settings')
        .upsert({
          chat_id: chatId,
          morning_notification_time: text,
          updated_at: new Date().toISOString()
        });
      
      if (error) {
        throw error;
      }
      
      userStates.delete(chatId);
      await ctx.reply(`✅ Время утреннего уведомления установлено: ${text} UTC`, getMainMenu());
    } catch (error) {
      console.error('Error saving notification time:', error);
      await ctx.reply('Ошибка при сохранении настроек. Попробуйте позже.');
      userStates.delete(chatId);
    }
    return;
  }
});

// Кнопка "Добавить блюдо"
bot.hears('➕ Добавить блюдо', async (ctx) => {
  const isAuthorized = await checkAuth(ctx);
  if (!isAuthorized) {
    await ctx.reply('Необходима авторизация. Используйте /start');
    return;
  }
  
  const chatId = ctx.chat.id;
  
  // Получаем последние 8 уникальных названий блюд пользователя
  const { data: recentDishes } = await supabase
    .from('dishes')
    .select('name')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(50);
  
  const uniqueNames = [...new Set(recentDishes?.map(d => d.name) || [])].slice(0, 8);
  
  if (uniqueNames.length > 0) {
    const buttons = uniqueNames.map(name => [{ text: name, callback_data: `dish_${encodeURIComponent(name)}` }]);
    buttons.push([{ text: '➕ Добавить новое блюдо', callback_data: 'dish_new' }]);
    
    await ctx.reply('Выберите блюдо или добавьте новое:', {
      reply_markup: { inline_keyboard: buttons }
    });
  } else {
    await ctx.reply('Введите название блюда:');
    userStates.set(chatId, { step: 'waiting_for_dish_name' });
  }
});

// Кнопка "Список блюд"
bot.hears('📦 Список блюд', async (ctx) => {
  const isAuthorized = await checkAuth(ctx);
  if (!isAuthorized) {
    await ctx.reply('Необходима авторизация. Используйте /start');
    return;
  }
  
  const chatId = ctx.chat.id;
  
  const { data: dishes, error } = await supabase
    .from('dishes')
    .select('id, name, expires_at')
    .eq('chat_id', chatId)
    .eq('status', 'active')
    .order('expires_at', { ascending: true });
  
  if (error) {
    console.error('Error fetching dishes:', error);
    await ctx.reply('Ошибка при загрузке списка блюд. Попробуйте позже.');
    return;
  }
  
  if (!dishes || dishes.length === 0) {
    await ctx.reply('Нет активных блюд.', getMainMenu());
    return;
  }
  
  const dishesList = dishes.map((dish, index) => {
    const expiresDate = new Date(dish.expires_at);
    const expiresTime = formatTime(dish.expires_at);
    const timeUntil = formatTimeUntil(dish.expires_at);
    const day = String(expiresDate.getUTCDate()).padStart(2, '0');
    const month = String(expiresDate.getUTCMonth() + 1).padStart(2, '0');
    const dateStr = `${day}.${month}`;
    
    return `${index + 1}. ${dish.name}\n   📅 ${dateStr} ${expiresTime} — ${timeUntil}`;
  }).join('\n\n');
  
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
  
  await ctx.reply(`📦 Список блюд:\n\n${dishesList}`, {
    reply_markup: { inline_keyboard: buttons }
  });
});

// Кнопка "Списанные блюда"
bot.hears('🗑 Списанные блюда', async (ctx) => {
  const isAuthorized = await checkAuth(ctx);
  if (!isAuthorized) {
    await ctx.reply('Необходима авторизация. Используйте /start');
    return;
  }
  
  const chatId = ctx.chat.id;
  
  const { data: dishes, error } = await supabase
    .from('dishes')
    .select('id, name, status, created_at')
    .eq('chat_id', chatId)
    .in('status', ['removed', 'expired'])
    .order('created_at', { ascending: false })
    .limit(50);
  
  if (error) {
    console.error('Error fetching removed dishes:', error);
    await ctx.reply('Ошибка при загрузке списка списанных блюд. Попробуйте позже.');
    return;
  }
  
  if (!dishes || dishes.length === 0) {
    await ctx.reply('Нет списанных блюд.', getMainMenu());
    return;
  }
  
  const dishesList = dishes.map((dish, index) => {
    const createdDate = new Date(dish.created_at);
    const day = String(createdDate.getUTCDate()).padStart(2, '0');
    const month = String(createdDate.getUTCMonth() + 1).padStart(2, '0');
    const dateStr = `${day}.${month}`;
    const statusEmoji = dish.status === 'expired' ? '⏰' : '❌';
    const statusText = dish.status === 'expired' ? 'Истёк' : 'Списано';
    
    return `${index + 1}. ${dish.name} ${statusEmoji} ${statusText} (${dateStr})`;
  }).join('\n');
  
  await ctx.reply(`🗑 Списанные блюда:\n\n${dishesList}`, getMainMenu());
});

// Кнопка "Настройки"
bot.hears('⚙️ Настройки', async (ctx) => {
  const isAuthorized = await checkAuth(ctx);
  if (!isAuthorized) {
    await ctx.reply('Необходима авторизация. Используйте /start');
    return;
  }
  
  const chatId = ctx.chat.id;
  
  const { data: settings } = await supabase
    .from('user_settings')
    .select('morning_notification_time')
    .eq('chat_id', chatId)
    .single();
  
  const currentTime = settings?.morning_notification_time || '10:00';
  
  const inlineKeyboard = {
    inline_keyboard: [
      [{ text: '08:00', callback_data: 'time_08:00' }],
      [{ text: '09:00', callback_data: 'time_09:00' }],
      [{ text: '10:00', callback_data: 'time_10:00' }],
      [{ text: '11:00', callback_data: 'time_11:00' }],
      [{ text: '12:00', callback_data: 'time_12:00' }],
      [{ text: 'Другое время...', callback_data: 'time_custom' }]
    ]
  };
  
  await ctx.reply(`⚙️ Настройки\n\nТекущее время утреннего уведомления: ${currentTime} UTC\n\nВыберите новое время:`, {
    reply_markup: inlineKeyboard
  });
});

// Обработка callback query
bot.action(/^dish_/, async (ctx) => {
  const callbackData = ctx.callbackQuery.data;
  const chatId = ctx.chat.id;
  
  if (callbackData === 'dish_new') {
    await ctx.answerCbQuery();
    await ctx.editMessageText('Введите название блюда:');
    userStates.set(chatId, { step: 'waiting_for_dish_name' });
    return;
  }
  
  const dishName = decodeURIComponent(callbackData.replace('dish_', ''));
  userStates.set(chatId, { step: 'waiting_for_duration', dishName });
  
  const inlineKeyboard = {
    inline_keyboard: [
      [{ text: '12 часов', callback_data: 'duration_12' }],
      [{ text: '24 часа', callback_data: 'duration_24' }],
      [{ text: '48 часов', callback_data: 'duration_48' }],
      [{ text: '72 часа', callback_data: 'duration_72' }],
      [{ text: 'Другое время...', callback_data: 'duration_custom' }]
    ]
  };
  
  await ctx.answerCbQuery();
  await ctx.editMessageText('Выберите срок хранения:', { reply_markup: inlineKeyboard });
});

bot.action(/^duration_/, async (ctx) => {
  const callbackData = ctx.callbackQuery.data;
  const chatId = ctx.chat.id;
  const state = userStates.get(chatId);
  
  if (!state || !state.dishName) {
    await ctx.answerCbQuery('Ошибка: не найдено название блюда');
    return;
  }
  
  if (callbackData === 'duration_custom') {
    await ctx.answerCbQuery();
    await ctx.editMessageText('Введите время в минутах (например, 30, 90, 120):');
    userStates.set(chatId, { step: 'waiting_for_custom_minutes', dishName: state.dishName });
    return;
  }
  
  const hours = parseInt(callbackData.replace('duration_', ''));
  await ctx.answerCbQuery();
  await saveDish(ctx, state.dishName, hours, chatId, false);
});

bot.action(/^time_/, async (ctx) => {
  const callbackData = ctx.callbackQuery.data;
  const chatId = ctx.chat.id;
  
  if (callbackData === 'time_custom') {
    await ctx.answerCbQuery();
    await ctx.editMessageText('Введите время в формате ЧЧ:ММ (например, 10:00):');
    userStates.set(chatId, { step: 'waiting_for_notification_time' });
    return;
  }
  
  const time = callbackData.replace('time_', '');
  
  try {
    const { error } = await supabase
      .from('user_settings')
      .upsert({
        chat_id: chatId,
        morning_notification_time: time,
        updated_at: new Date().toISOString()
      });
    
    if (error) {
      throw error;
    }
    
    await ctx.answerCbQuery();
    await ctx.editMessageText(`✅ Время утреннего уведомления установлено: ${time} UTC`, getMainMenu());
  } catch (error) {
    console.error('Error saving notification time:', error);
    await ctx.answerCbQuery('Ошибка при сохранении настроек');
  }
});

bot.action(/^remove_/, async (ctx) => {
  const dishId = parseInt(ctx.callbackQuery.data.replace('remove_', ''));
  const chatId = ctx.chat.id;
  
  try {
    const { error } = await supabase
      .from('dishes')
      .update({ status: 'removed' })
      .eq('id', dishId)
      .eq('chat_id', chatId);
    
    if (error) {
      throw error;
    }
    
    await ctx.answerCbQuery('✅ Блюдо списано');
    
    // Обновляем список
    const { data: remainingDishes } = await supabase
      .from('dishes')
      .select('id, name, expires_at')
      .eq('chat_id', chatId)
      .eq('status', 'active')
      .order('expires_at', { ascending: true });
    
    if (!remainingDishes || remainingDishes.length === 0) {
      await ctx.editMessageText('✅ Блюдо списано.\n\nНет активных блюд.', getMainMenu());
      return;
    }
    
    const dishesList = remainingDishes.map((dish, index) => {
      const expiresDate = new Date(dish.expires_at);
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
      return [{
        text: `${index + 1}. ${dishName} ❌ Списать`,
        callback_data: `remove_${dish.id}`
      }];
    });
    
    await ctx.editMessageText(`✅ Блюдо списано.\n\n📦 Список блюд:\n\n${dishesList}`, {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (error) {
    console.error('Error removing dish:', error);
    await ctx.answerCbQuery('Ошибка при списании блюда');
  }
});

// Сохранение блюда
async function saveDish(ctx, dishName, timeValue, userId, isMinutes = false) {
  try {
    const now = new Date();
    const chatId = ctx.chat.id;
    
    let expiresAt;
    if (isMinutes) {
      expiresAt = new Date(now.getTime() + timeValue * 60 * 1000);
    } else {
      expiresAt = new Date(now.getTime() + timeValue * 60 * 60 * 1000);
    }
    
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
    
    userStates.delete(userId);
    
    // Проверяем, не истек ли уже срок
    const isExpired = new Date(expiresAt) <= now;
    
    if (isExpired) {
      await supabase
        .from('dishes')
        .update({ status: 'expired' })
        .eq('id', dish.id);
      
      const expiredMessage = `❌ Срок истёк: ${dishName}. Требуется списание.`;
      await ctx.reply(expiredMessage);
    }
    
    const expiresDateTime = formatDateTime(expiresAt);
    const message = `✅ Блюдо "${dishName}" добавлено!\n` +
      `Срок хранения: до ${expiresDateTime} UTC (${formatTimeUntil(expiresAt)})`;
    
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery();
      await ctx.editMessageText(message);
      await ctx.reply(message, getMainMenu());
    } else {
      await ctx.reply(message, getMainMenu());
    }
  } catch (error) {
    console.error('Error saving dish:', error);
    const errorMessage = 'Произошла ошибка при сохранении блюда. Попробуйте позже.';
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery(errorMessage);
    } else {
      await ctx.reply(errorMessage);
    }
  }
}

// ==================== SCHEDULER ====================

// Ежедневные уведомления
async function sendDailyNotifications() {
  const now = new Date();
  const currentHour = now.getUTCHours();
  const currentMinute = now.getUTCMinutes();
  
  try {
    const { data: allUsers } = await supabase
      .from('user_settings')
      .select('chat_id, morning_notification_time');
    
    for (const userSetting of allUsers || []) {
      const [settingHour, settingMinute] = (userSetting.morning_notification_time || '10:00').split(':').map(Number);
      const isTimeMatch = currentHour === settingHour && currentMinute >= settingMinute && currentMinute < settingMinute + 15;
      
      if (isTimeMatch) {
        const todayStartUTC = new Date(now.getFullYear(), now.getMonth(), now.getUTCDate());
        const todayEndUTC = new Date(todayStartUTC.getTime() + 24 * 60 * 60 * 1000);
        
        const { data: dishes } = await supabase
          .from('dishes')
          .select('id, name, expires_at')
          .eq('status', 'active')
          .eq('notified_day', false)
          .eq('chat_id', userSetting.chat_id)
          .gte('expires_at', todayStartUTC.toISOString())
          .lt('expires_at', todayEndUTC.toISOString());
        
        if (dishes && dishes.length > 0) {
          const messages = dishes.map(d =>
            `⚠ Сегодня истекает срок хранения: ${d.name} до ${formatTime(d.expires_at)} UTC`
          );
          await bot.telegram.sendMessage(userSetting.chat_id, messages.join('\n'));
          
          const dishIds = dishes.map(d => d.id);
          await supabase.from('dishes').update({ notified_day: true }).in('id', dishIds);
        }
      }
    }
  } catch (error) {
    console.error('[SCHEDULER] Error in daily notifications:', error);
  }
}

// Уведомления за 1 час
async function sendOneHourNotifications() {
  try {
    const now = new Date();
    const minTime = new Date(now.getTime() + 55 * 60000);
    const maxTime = new Date(now.getTime() + 65 * 60000);
    
    const { data: dishes } = await supabase
      .from('dishes')
      .select('id, name, chat_id')
      .eq('status', 'active')
      .eq('notified_one_hour', false)
      .gte('expires_at', minTime.toISOString())
      .lte('expires_at', maxTime.toISOString());
    
    if (dishes && dishes.length > 0) {
      const dishesByChat = {};
      for (const dish of dishes) {
        if (!dishesByChat[dish.chat_id]) dishesByChat[dish.chat_id] = [];
        dishesByChat[dish.chat_id].push(dish);
      }
      
      for (const [chatId, userDishes] of Object.entries(dishesByChat)) {
        const messages = userDishes.map(d => `⏳ Через 1 час истекает: ${d.name}`);
        await bot.telegram.sendMessage(chatId, messages.join('\n'));
        
        const dishIds = userDishes.map(d => d.id);
        await supabase.from('dishes').update({ notified_one_hour: true }).in('id', dishIds);
      }
    }
  } catch (error) {
    console.error('[SCHEDULER] Error in one hour notifications:', error);
  }
}

// Запуск scheduler
let schedulerInterval = null;

function startScheduler() {
  if (schedulerInterval) {
    console.log('[SCHEDULER] ⚠️ Scheduler already running');
    return;
  }
  
  console.log('[SCHEDULER] Starting scheduler...');
  
  // Запускаем сразу
  sendDailyNotifications();
  sendOneHourNotifications();
  
  // Загружаем checkExpired модуль
  const { checkExpiredDishes } = require('./checkExpired');
  checkExpiredDishes(bot, supabase).catch(err => {
    console.error('[SCHEDULER] Error in initial checkExpired:', err);
  });
  
  // Затем каждую минуту
  schedulerInterval = setInterval(async () => {
    try {
      sendDailyNotifications();
      sendOneHourNotifications();
      await checkExpiredDishes(bot, supabase);
    } catch (error) {
      console.error('[SCHEDULER] Interval error:', error);
    }
  }, 60 * 1000);
  
  console.log('[SCHEDULER] ✅ Scheduler started (runs every 1 minute)');
}

// ==================== HTTP SERVER ====================

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

// ==================== ЗАПУСК БОТА ====================

async function startBot() {
  try {
    console.log('[BOT] Initializing bot...');
    
    const botInfo = await bot.telegram.getMe();
    console.log(`[BOT] ✅ Bot token is valid. Bot username: @${botInfo.username}`);
    
    server.listen(PORT, () => {
      console.log(`[SERVER] Health check server started on port ${PORT}`);
    });
    
    console.log('[BOT] Starting bot with polling...');
    await bot.launch({
      dropPendingUpdates: true,
      allowedUpdates: ['message', 'callback_query']
    });
    
    console.log('[BOT] ✅ Bot started successfully with polling');
    
    startScheduler();
    
    console.log('[BOT] Bot is ready and polling for updates');
  } catch (error) {
    console.error('[BOT] ❌ Error starting bot:', error);
    startScheduler(); // Запускаем scheduler даже если бот не запустился
    process.exit(1);
  }
}

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('[BOT] Shutting down...');
  if (schedulerInterval) clearInterval(schedulerInterval);
  server.close();
  bot.stop('SIGINT');
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log('[BOT] Shutting down...');
  if (schedulerInterval) clearInterval(schedulerInterval);
  server.close();
  bot.stop('SIGTERM');
  process.exit(0);
});

// Запускаем бота
startBot();
