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
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (diffHours > 0) {
    return `через ${diffHours} ч ${diffMinutes > 0 ? diffMinutes + ' мин' : ''}`;
  } else if (diffMinutes > 0) {
    return `через ${diffMinutes} мин`;
  } else {
    return 'истёк';
  }
}

// Форматирование времени для отображения
function formatTime(date) {
  const d = new Date(date);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

// Команда /start
bot.start((ctx) => {
  ctx.reply('Добро пожаловать! Выберите действие:', getMainMenu());
});

// Обработка кнопки "Добавить блюдо"
bot.hears('➕ Добавить блюдо', async (ctx) => {
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

// Обработка текстового ввода для нового блюда
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const state = userStates.get(userId);
  
  if (!state) {
    // Проверяем, не является ли это командой из главного меню
    if (ctx.message.text === '📦 Список блюд') {
      return; // Обработается в bot.hears
    }
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
    // Показываем кнопки для кастомного времени
    await ctx.editMessageText('Выберите дополнительное время:', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '+1 ч', callback_data: 'custom_1' },
            { text: '+6 ч', callback_data: 'custom_6' }
          ],
          [
            { text: '+24 ч', callback_data: 'custom_24' }
          ],
          [
            { text: 'Сохранить', callback_data: 'custom_save' }
          ]
        ]
      }
    });
    await ctx.answerCbQuery();
    
    // Сохраняем состояние для кастомного времени
    userStates.set(userId, {
      ...state,
      action: 'selecting_custom_duration',
      custom_hours: 0
    });
    return;
  }

  // Сохраняем блюдо с выбранным сроком
  const hours = parseInt(durationStr);
  await saveDish(ctx, state.dish_name, hours, userId);
});

// Обработка кастомного времени
bot.action(/^custom_/, async (ctx) => {
  const action = ctx.callbackQuery.data.split('_')[1];
  const userId = ctx.from.id;
  const state = userStates.get(userId);

  if (!state || state.action !== 'selecting_custom_duration') {
    await ctx.answerCbQuery('Ошибка');
    return;
  }

  if (action === 'save') {
    if (state.custom_hours === 0) {
      await ctx.answerCbQuery('Выберите время перед сохранением');
      return;
    }
    await saveDish(ctx, state.dish_name, state.custom_hours, userId);
  } else {
    // Добавляем часы
    const hoursToAdd = parseInt(action);
    const newTotal = (state.custom_hours || 0) + hoursToAdd;
    
    userStates.set(userId, {
      ...state,
      custom_hours: newTotal
    });

    await ctx.editMessageText(`Выбрано: ${newTotal} часов\nВыберите дополнительное время:`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '+1 ч', callback_data: 'custom_1' },
            { text: '+6 ч', callback_data: 'custom_6' }
          ],
          [
            { text: '+24 ч', callback_data: 'custom_24' }
          ],
          [
            { text: 'Сохранить', callback_data: 'custom_save' }
          ]
        ]
      }
    });
    await ctx.answerCbQuery();
  }
});

// Сохранение блюда
async function saveDish(ctx, dishName, hours, userId) {
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000);
    const chatId = ctx.chat.id;

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

    if (dishError) throw dishError;

    // Очищаем состояние
    userStates.delete(userId);

    const expiresTime = formatTime(expiresAt);
    await ctx.editMessageText(
      `✅ Блюдо "${dishName}" добавлено!\n` +
      `Срок хранения: до ${expiresTime} (${formatTimeUntil(expiresAt)})`,
      getMainMenu()
    );
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Error saving dish:', error);
    await ctx.editMessageText('Произошла ошибка при сохранении блюда. Попробуйте позже.');
    await ctx.answerCbQuery();
    userStates.delete(userId);
  }
}

// Обработка кнопки "Список блюд"
bot.hears('📦 Список блюд', async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    
    const { data: dishes, error } = await supabase
      .from('dishes')
      .select('id, name, expires_at')
      .eq('status', 'active')
      .eq('chat_id', chatId)
      .order('expires_at', { ascending: true });

    if (error) throw error;

    if (!dishes || dishes.length === 0) {
      await ctx.reply('Нет активных блюд.', getMainMenu());
      return;
    }

    // Формируем список блюд
    const dishesList = dishes.map((dish, index) => {
      const expiresTime = formatTime(dish.expires_at);
      const timeUntil = formatTimeUntil(dish.expires_at);
      return `${index + 1}. ${dish.name} — до ${expiresTime} (${timeUntil})`;
    }).join('\n');

    // Создаем кнопки для списания
    const buttons = dishes.map((dish, index) => [
      {
        text: `${index + 1}. ${dish.name} ❌ Списать`,
        callback_data: `remove_${dish.id}`
      }
    ]);

    await ctx.reply(dishesList, {
      reply_markup: {
        inline_keyboard: buttons
      }
    });
  } catch (error) {
    console.error('Error fetching dishes:', error);
    ctx.reply('Произошла ошибка при загрузке списка блюд. Попробуйте позже.');
  }
});

// Обработка списания блюда
bot.action(/^remove_/, async (ctx) => {
  const dishId = parseInt(ctx.callbackQuery.data.split('_')[1]);

  try {
    const { error } = await supabase
      .from('dishes')
      .update({ status: 'removed' })
      .eq('id', dishId);

    if (error) throw error;

    await ctx.answerCbQuery('Блюдо списано');
    await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ Списано');
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

// Экспорт handler для Netlify Functions
exports.handler = async (event, context) => {
  try {
    // Парсим тело запроса
    const body = JSON.parse(event.body);
    
    // Обрабатываем обновление через Telegraf
    await bot.handleUpdate(body);
    
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true })
    };
  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
