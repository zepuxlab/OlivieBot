const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

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

// Форматирование времени для отображения (в МСК)
function formatTime(date) {
  const d = toMoscowTime(date);
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

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
      const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
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

// Handler для scheduler (Netlify Scheduled Functions)
exports.handler = async (event, context) => {
  const startTime = Date.now();
  console.log('[SCHEDULER] ========================================');
  console.log('[SCHEDULER] Handler called');
  console.log('[SCHEDULER] Event:', JSON.stringify(event, null, 2));
  console.log('[SCHEDULER] Context:', JSON.stringify(context, null, 2));
  
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

    console.log('[SCHEDULER] Environment variables OK');
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
