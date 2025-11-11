// Простой скрипт для проверки истекших блюд и отправки уведомлений
// Запускается отдельно или вызывается из scheduler

const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ ERROR: Missing environment variables!');
  console.error('Required: BOT_TOKEN, SUPABASE_URL, SUPABASE_KEY');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Простая функция проверки истекших блюд
async function checkExpiredDishes() {
  console.log('[CHECK_EXPIRED] ========================================');
  console.log('[CHECK_EXPIRED] Starting expired dishes check...');
  
  try {
    const now = new Date();
    console.log('[CHECK_EXPIRED] Current time (UTC):', now.toISOString());
    
    // Получаем все блюда, где expires_at <= now и статус active или expired
    // (expired тоже проверяем, чтобы отправлять повторные уведомления)
    const { data: dishes, error } = await supabase
      .from('dishes')
      .select('id, name, expires_at, chat_id, status')
      .in('status', ['active', 'expired'])
      .lte('expires_at', now.toISOString());
    
    if (error) {
      console.error('[CHECK_EXPIRED] ❌ Error fetching dishes:', error);
      return;
    }
    
    if (!dishes || dishes.length === 0) {
      console.log('[CHECK_EXPIRED] ✅ No expired dishes found');
      return;
    }
    
    console.log(`[CHECK_EXPIRED] Found ${dishes.length} expired dishes`);
    
    // Группируем по chat_id
    const dishesByChat = {};
    for (const dish of dishes) {
      if (!dish.chat_id) {
        console.warn(`[CHECK_EXPIRED] Dish ${dish.id} (${dish.name}) has no chat_id`);
        continue;
      }
      if (!dishesByChat[dish.chat_id]) {
        dishesByChat[dish.chat_id] = [];
      }
      dishesByChat[dish.chat_id].push(dish);
    }
    
    console.log(`[CHECK_EXPIRED] Sending notifications to ${Object.keys(dishesByChat).length} users`);
    
    // Отправляем уведомления
    let sentCount = 0;
    let errorCount = 0;
    
    for (const [chatId, userDishes] of Object.entries(dishesByChat)) {
      try {
        const messages = userDishes.map(d => 
          `❌ Срок истёк: ${d.name || 'Неизвестное блюдо'}. Требуется списание.`
        );
        const messageText = messages.join('\n');
        
        await bot.telegram.sendMessage(chatId, messageText);
        console.log(`[CHECK_EXPIRED] ✅ Notification sent to ${chatId} for ${userDishes.length} dishes`);
        sentCount++;
        
        // Обновляем статус на expired для активных блюд
        const activeDishIds = userDishes
          .filter(d => d.status === 'active')
          .map(d => d.id);
        
        if (activeDishIds.length > 0) {
          const { error: updateError } = await supabase
            .from('dishes')
            .update({ status: 'expired' })
            .in('id', activeDishIds);
          
          if (updateError) {
            console.error(`[CHECK_EXPIRED] Error updating status for dishes:`, updateError);
          } else {
            console.log(`[CHECK_EXPIRED] Updated ${activeDishIds.length} dishes to expired status`);
          }
        }
      } catch (err) {
        console.error(`[CHECK_EXPIRED] ❌ Error sending to ${chatId}:`, err.message);
        errorCount++;
      }
    }
    
    console.log('[CHECK_EXPIRED] ========================================');
    console.log(`[CHECK_EXPIRED] Summary: ${sentCount} sent, ${errorCount} errors`);
    console.log('[CHECK_EXPIRED] ========================================');
    
  } catch (error) {
    console.error('[CHECK_EXPIRED] ❌ Fatal error:', error);
    console.error('[CHECK_EXPIRED] Stack:', error.stack);
  }
}

// Если скрипт запущен напрямую (не импортирован)
if (require.main === module) {
  console.log('[CHECK_EXPIRED] Running as standalone script...');
  checkExpiredDishes()
    .then(() => {
      console.log('[CHECK_EXPIRED] ✅ Check completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[CHECK_EXPIRED] ❌ Check failed:', error);
      process.exit(1);
    });
}

// Экспортируем функцию для использования в других модулях
module.exports = { checkExpiredDishes };

