const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Форматирование времени для отображения
function formatTime(date) {
  const d = new Date(date);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

// Ежедневное уведомление в 10:00 о блюдах, срок которых истекает сегодня
async function sendDailyNotifications() {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    // Получаем блюда, срок которых истекает сегодня и еще не было уведомления
    const { data: dishes, error } = await supabase
      .from('dishes')
      .select('id, name, expires_at, chat_id')
      .eq('status', 'active')
      .eq('notified_day', false)
      .gte('expires_at', todayStart.toISOString())
      .lt('expires_at', todayEnd.toISOString());

    if (error) {
      console.error('Error fetching dishes for daily notification:', error);
      return;
    }

    if (!dishes || dishes.length === 0) {
      return;
    }

    // Группируем по chat_id
    const dishesByChat = {};
    for (const dish of dishes) {
      const chatId = dish.chat_id;
      if (!chatId) continue; // Пропускаем если нет chat_id
      
      if (!dishesByChat[chatId]) {
        dishesByChat[chatId] = [];
      }
      dishesByChat[chatId].push(dish);
    }

    // Отправляем уведомления
    for (const [chatId, userDishes] of Object.entries(dishesByChat)) {
      const messages = userDishes.map(dish => {
        const dishName = dish.name || 'Неизвестное блюдо';
        const expiresTime = formatTime(dish.expires_at);
        return `⚠ Сегодня истекает срок хранения: ${dishName} до ${expiresTime}`;
      });

      try {
        await bot.telegram.sendMessage(chatId, messages.join('\n'));
        
        // Обновляем notified_day для всех блюд этого пользователя
        const dishIds = userDishes.map(d => d.id);
        await supabase
          .from('dishes')
          .update({ notified_day: true })
          .in('id', dishIds);
      } catch (err) {
        console.error(`Error sending daily notification to ${chatId}:`, err);
      }
    }
  } catch (error) {
    console.error('Error in sendDailyNotifications:', error);
  }
}

// Уведомление за 1 час до истечения
async function sendOneHourNotifications() {
  try {
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

    // Получаем блюда, срок которых истекает в течение часа
    const { data: dishes, error } = await supabase
      .from('dishes')
      .select('id, name, expires_at, chat_id')
      .eq('status', 'active')
      .eq('notified_one_hour', false)
      .gte('expires_at', now.toISOString())
      .lte('expires_at', oneHourLater.toISOString());

    if (error) {
      console.error('Error fetching dishes for one hour notification:', error);
      return;
    }

    if (!dishes || dishes.length === 0) {
      return;
    }

    // Группируем по chat_id
    const dishesByChat = {};
    for (const dish of dishes) {
      const chatId = dish.chat_id;
      if (!chatId) continue;
      
      if (!dishesByChat[chatId]) {
        dishesByChat[chatId] = [];
      }
      dishesByChat[chatId].push(dish);
    }

    // Отправляем уведомления
    for (const [chatId, userDishes] of Object.entries(dishesByChat)) {
      const messages = userDishes.map(dish => {
        const dishName = dish.name || 'Неизвестное блюдо';
        return `⏳ Через 1 час истекает: ${dishName}`;
      });

      try {
        await bot.telegram.sendMessage(chatId, messages.join('\n'));
        
        // Обновляем notified_one_hour для всех блюд этого пользователя
        const dishIds = userDishes.map(d => d.id);
        await supabase
          .from('dishes')
          .update({ notified_one_hour: true })
          .in('id', dishIds);
      } catch (err) {
        console.error(`Error sending one hour notification to ${chatId}:`, err);
      }
    }
  } catch (error) {
    console.error('Error in sendOneHourNotifications:', error);
  }
}

// Пометка истекших блюд и отправка уведомлений
async function markExpiredDishes() {
  try {
    const now = new Date();
    console.log('Checking for expired dishes at:', now.toISOString());

    // Получаем все истекшие активные блюда
    const { data: dishes, error } = await supabase
      .from('dishes')
      .select('id, name, expires_at, chat_id')
      .eq('status', 'active')
      .lte('expires_at', now.toISOString());

    if (error) {
      console.error('Error fetching expired dishes:', error);
      return;
    }

    if (!dishes || dishes.length === 0) {
      console.log('No expired dishes found');
      return;
    }

    console.log(`Found ${dishes.length} expired dishes`);

    // Группируем по chat_id
    const dishesByChat = {};
    for (const dish of dishes) {
      const chatId = dish.chat_id;
      if (!chatId) {
        console.warn(`Dish ${dish.id} has no chat_id, skipping`);
        continue;
      }
      
      if (!dishesByChat[chatId]) {
        dishesByChat[chatId] = [];
      }
      dishesByChat[chatId].push(dish);
    }

    console.log(`Sending notifications to ${Object.keys(dishesByChat).length} users`);

    // Отправляем уведомления и обновляем статус
    for (const [chatId, userDishes] of Object.entries(dishesByChat)) {
      const messages = userDishes.map(dish => {
        const dishName = dish.name || 'Неизвестное блюдо';
        return `❌ Срок истёк: ${dishName}. Требуется списание.`;
      });

      const messageText = messages.join('\n');
      console.log(`Sending expired notification to chat ${chatId}:`, messageText);

      try {
        await bot.telegram.sendMessage(chatId, messageText);
        console.log(`Successfully sent notification to chat ${chatId}`);
        
        // Обновляем статус на 'expired' для всех блюд этого пользователя
        const dishIds = userDishes.map(d => d.id);
        const { error: updateError } = await supabase
          .from('dishes')
          .update({ status: 'expired' })
          .in('id', dishIds);
        
        if (updateError) {
          console.error(`Error updating status for dishes:`, updateError);
        } else {
          console.log(`Updated ${dishIds.length} dishes to expired status`);
        }
      } catch (err) {
        console.error(`Error sending expired notification to ${chatId}:`, err);
        // Продолжаем обработку других пользователей даже при ошибке
      }
    }
  } catch (error) {
    console.error('Error in markExpiredDishes:', error);
  }
}

// Главная функция планировщика
exports.handler = async (event, context) => {
  try {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    console.log(`Scheduler running at ${now.toISOString()} (${currentHour}:${currentMinute})`);

    // Проверяем, нужно ли отправить ежедневное уведомление (в 10:00)
    if (currentHour === 10 && currentMinute < 15) {
      console.log('Running daily notifications check');
      await sendDailyNotifications();
    }

    // Проверяем уведомления за 1 час до истечения
    console.log('Running one hour notifications check');
    await sendOneHourNotifications();

    // Проверяем и помечаем истекшие блюда (это должно работать всегда)
    console.log('Running expired dishes check');
    await markExpiredDishes();

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        ok: true,
        timestamp: now.toISOString(),
        hour: currentHour,
        minute: currentMinute
      })
    };
  } catch (error) {
    console.error('Scheduler error:', error);
    console.error('Error stack:', error.stack);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message,
        stack: error.stack
      })
    };
  }
};
