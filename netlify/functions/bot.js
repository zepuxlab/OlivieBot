const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Состояния пользователей для обработки текстовых вводов
const userStates = new Map();

// Главное меню
function getMainMenu() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '➕ Добавить блюдо' }],
        [{ text: '📦 Список блюд' }]
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

// Форматирование времени для отображения
function formatTime(date) {
  const d = new Date(date);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

// Форматирование даты и времени для отображения
function formatDateTime(date) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}.${month} ${hours}:${minutes}`;
}

// Команда /start
bot.start((ctx) => {
  console.log('[BOT] /start command from user', ctx.from.id);
  ctx.reply('Добро пожаловать! Выберите действие:', getMainMenu());
});

// Обработка кнопки "Добавить блюдо"
bot.hears('➕ Добавить блюдо', async (ctx) => {
  console.log('[BOT] Add dish button clicked by user', ctx.from.id);
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
    
    if (recentDishes) {
      for (const dish of recentDishes) {
        if (dish.name && !seenNames.has(dish.name)) {
          uniqueNames.push(dish.name);
          seenNames.add(dish.name);
          if (uniqueNames.length >= 8) break;
        }
      }
    }

    const buttons = [];
    if (uniqueNames.length > 0) {
      // Создаем кнопки для названий (по 2 в ряд)
      // Используем индекс для callback_data, чтобы избежать проблем с длиной и спецсимволами
      for (let i = 0; i < uniqueNames.length; i += 2) {
        const row = [];
        // Сохраняем названия в состоянии пользователя для последующего использования
        if (!userStates.has(ctx.from.id)) {
          userStates.set(ctx.from.id, {});
        }
        const state = userStates.get(ctx.from.id);
        if (!state.dishNames) {
          state.dishNames = uniqueNames;
        }
        
        row.push({ text: uniqueNames[i], callback_data: `dish_idx_${i}` });
        if (i + 1 < uniqueNames.length) {
          row.push({ text: uniqueNames[i + 1], callback_data: `dish_idx_${i + 1}` });
        }
        buttons.push(row);
      }
    }
    
    // Кнопка "Добавить новое блюдо"
    buttons.push([{ text: '➕ Добавить новое блюдо', callback_data: 'dish_new' }]);

    await ctx.reply('Выберите блюдо или добавьте новое:', {
      reply_markup: {
        inline_keyboard: buttons
      }
    });
  } catch (error) {
    console.error('Error fetching recent dishes:', error);
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
    if (text === '➕ Добавить блюдо' || text === '📦 Список блюд') {
      // Пропускаем эти команды - они обрабатываются через bot.hears
      console.log('[BOT] Menu command in middleware, allowing bot.hears to handle it');
      return next();
    }
  }
  return next();
});

// Обработка кнопки "Список блюд"
// КРИТИЧЕСКИ ВАЖНО: должен быть зарегистрирован ДО bot.on('text')
bot.hears('📦 Список блюд', async (ctx) => {
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

    // Формируем список блюд с датой и временем
    const dishesList = dishes.map((dish, index) => {
      const expiresDate = new Date(dish.expires_at);
      const expiresTime = formatTime(dish.expires_at);
      const timeUntil = formatTimeUntil(dish.expires_at);
      
      // Форматируем дату
      const day = String(expiresDate.getDate()).padStart(2, '0');
      const month = String(expiresDate.getMonth() + 1).padStart(2, '0');
      const dateStr = `${day}.${month}`;
      
      return `${index + 1}. ${dish.name}\n   📅 ${dateStr} ${expiresTime} — ${timeUntil}`;
    }).join('\n\n');

    // Создаем кнопки для списания (ограничиваем длину текста кнопки)
    const buttons = dishes.map((dish, index) => {
      const buttonText = dish.name.length > 20 
        ? `${index + 1}. ${dish.name.substring(0, 17)}... ❌` 
        : `${index + 1}. ${dish.name} ❌`;
      
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

// Обработка текстового ввода для нового блюда
// ВАЖНО: этот обработчик должен быть ПОСЛЕ всех bot.hears
// Команды меню обрабатываются через bot.hears благодаря middleware выше
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const state = userStates.get(userId);
  
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
  }
});

// Обработка выбора срока хранения
bot.action(/^duration_/, async (ctx) => {
  const durationStr = ctx.callbackQuery.data.split('_')[1];
  const userId = ctx.from.id;
  const state = userStates.get(userId);

  if (!state || !state.dish_name) {
    await ctx.answerCbQuery('Ошибка: название блюда не выбрано');
    return;
  }

  if (durationStr === 'custom') {
    // Запрашиваем ввод времени в минутах
    await ctx.editMessageText('Введите время хранения в минутах (например: 30, 90, 120):');
    await ctx.answerCbQuery();
    
    // Сохраняем состояние для кастомного времени
    userStates.set(userId, {
      ...state,
      action: 'waiting_for_custom_minutes'
    });
    return;
  }

  // Сохраняем блюдо с выбранным сроком
  const hours = parseInt(durationStr);
  await saveDish(ctx, state.dish_name, hours, userId);
});


// Сохранение блюда
// timeValue - значение времени (часы или минуты)
// isMinutes - true если timeValue в минутах, false если в часах
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
      // Если все блюда списаны
      await ctx.editMessageText('✅ Все блюда списаны. Нет активных блюд.');
      return;
    }

    // Формируем обновленный список
    const dishesList = remainingDishes.map((remainingDish, index) => {
      const expiresDate = new Date(remainingDish.expires_at);
      const expiresTime = formatTime(remainingDish.expires_at);
      const timeUntil = formatTimeUntil(remainingDish.expires_at);
      
      const day = String(expiresDate.getDate()).padStart(2, '0');
      const month = String(expiresDate.getMonth() + 1).padStart(2, '0');
      const dateStr = `${day}.${month}`;
      
      return `${index + 1}. ${remainingDish.name}\n   📅 ${dateStr} ${expiresTime} — ${timeUntil}`;
    }).join('\n\n');

    // Создаем обновленные кнопки
    const buttons = remainingDishes.map((remainingDish, index) => {
      const buttonText = remainingDish.name.length > 20 
        ? `${index + 1}. ${remainingDish.name.substring(0, 17)}... ❌` 
        : `${index + 1}. ${remainingDish.name} ❌`;
      
      return [{
        text: buttonText,
        callback_data: `remove_${remainingDish.id}`
      }];
    });

    const message = `📦 Список активных блюд:\n\n${dishesList}`;

    await ctx.editMessageText(message, {
      reply_markup: {
        inline_keyboard: buttons
      }
    });
  } catch (error) {
    console.error('Error removing dish:', error);
    await ctx.answerCbQuery('Ошибка при списании блюда');
  }
});

// Обработка ошибок
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
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
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    console.log(`[SCHEDULER] Starting at ${now.toISOString()} (${currentHour}:${currentMinute})`);

    // 1. Ежедневное уведомление в 10:00
    if (currentHour === 10 && currentMinute < 15) {
      console.log('[SCHEDULER] Checking daily notifications (10:00)');
      try {
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(todayStart);
        todayEnd.setDate(todayEnd.getDate() + 1);

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
      } catch (err) {
        console.error('[SCHEDULER] Error in daily notifications:', err);
        results.daily.errors++;
      }
    }

    // 2. Уведомление за 1 час до истечения
    console.log('[SCHEDULER] Checking one hour notifications');
    try {
      const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
      const { data: dishes, error } = await supabase
        .from('dishes')
        .select('id, name, expires_at, chat_id')
        .eq('status', 'active')
        .eq('notified_one_hour', false)
        .gte('expires_at', now.toISOString())
        .lte('expires_at', oneHourLater.toISOString());

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
    try {
      const { data: dishes, error } = await supabase
        .from('dishes')
        .select('id, name, expires_at, chat_id')
        .eq('status', 'active')
        .lte('expires_at', now.toISOString());

      if (error) {
        console.error('[SCHEDULER] Error fetching expired dishes:', error);
        results.expired.errors++;
      } else if (dishes && dishes.length > 0) {
        console.log(`[SCHEDULER] Found ${dishes.length} expired dishes`);
        
        const dishesByChat = {};
        for (const dish of dishes) {
          if (!dish.chat_id) {
            console.warn(`[SCHEDULER] Dish ${dish.id} has no chat_id`);
            continue;
          }
          if (!dishesByChat[dish.chat_id]) dishesByChat[dish.chat_id] = [];
          dishesByChat[dish.chat_id].push(dish);
        }

        console.log(`[SCHEDULER] Sending expired notifications to ${Object.keys(dishesByChat).length} users`);

        for (const [chatId, userDishes] of Object.entries(dishesByChat)) {
          try {
            const messages = userDishes.map(d => 
              `❌ Срок истёк: ${d.name || 'Неизвестное блюдо'}. Требуется списание.`
            );
            await bot.telegram.sendMessage(chatId, messages.join('\n'));
            console.log(`[SCHEDULER] Expired notification sent to ${chatId} for ${userDishes.length} dishes`);
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
            console.error(`[SCHEDULER] Error sending expired notification to ${chatId}:`, err.message);
            results.expired.errors++;
          }
        }
      } else {
        console.log('[SCHEDULER] No expired dishes found');
      }
    } catch (err) {
      console.error('[SCHEDULER] Error in expired dishes check:', err);
      results.expired.errors++;
    }

    console.log('[SCHEDULER] Summary:', JSON.stringify(results, null, 2));
    return results;

  } catch (error) {
    console.error('[SCHEDULER] Fatal error in sendAllNotifications:', error);
    throw error;
  }
}

// ==================== EXPORTS ====================

// Handler для webhook (Telegram)
exports.handler = async (event, context) => {
  console.log('[BOT] ========================================');
  console.log('[BOT] Webhook handler called');
  console.log('[BOT] Event body:', event.body ? 'present' : 'missing');
  
  try {
    // Парсим тело запроса
    const body = JSON.parse(event.body);
    console.log('[BOT] Update type:', body.message?.text || body.callback_query?.data || 'unknown');
    console.log('[BOT] From user:', body.message?.from?.id || body.callback_query?.from?.id);
    
    // Обрабатываем обновление через Telegraf
    await bot.handleUpdate(body);
    console.log('[BOT] Update processed successfully');
    
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true })
    };
  } catch (error) {
    console.error('[BOT] Handler error:', error);
    console.error('[BOT] Error stack:', error.stack);
    console.log('[BOT] ========================================');
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      })
    };
  }
};

// Handler для scheduler (Netlify Scheduled Functions)
exports.schedulerHandler = async (event, context) => {
  const startTime = Date.now();
  console.log('[SCHEDULER] ========================================');
  console.log('[SCHEDULER] Handler called');
  console.log('[SCHEDULER] Event:', JSON.stringify(event, null, 2));
  
  try {
    // Проверяем переменные окружения
    if (!process.env.BOT_TOKEN) {
      console.error('[SCHEDULER] ERROR: BOT_TOKEN not set');
      return { statusCode: 500, body: JSON.stringify({ error: 'BOT_TOKEN not configured' }) };
    }
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
      console.error('[SCHEDULER] ERROR: Supabase credentials not set');
      return { statusCode: 500, body: JSON.stringify({ error: 'Supabase not configured' }) };
    }

    const results = await sendAllNotifications();
    const duration = Date.now() - startTime;
    
    console.log('[SCHEDULER] Completed in', duration, 'ms');
    console.log('[SCHEDULER] ========================================');

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        ok: true,
        timestamp: new Date().toISOString(),
        duration: duration,
        results: results
      })
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('[SCHEDULER] Fatal error:', error);
    console.error('[SCHEDULER] Stack:', error.stack);
    console.log('[SCHEDULER] ========================================');
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message,
        stack: error.stack,
        duration: duration
      })
    };
  }
};
