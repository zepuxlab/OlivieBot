const { Telegraf } = require("telegraf");
const { createClient } = require("@supabase/supabase-js");
const http = require("http");

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const userStates = new Map();
const authorized = new Map();

function mainMenu() {
  return {
    reply_markup: {
      keyboard: [
        ["➕ Добавить блюдо"],
        ["📦 Список блюд", "🗑 Списанные блюда"],
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

// Форматирование даты и времени
function formatDateTime(date) {
  const d = new Date(date);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day}.${month} ${hours}:${minutes}`;
}

async function isAuth(ctx) {
  const chatId = ctx.chat.id;
  if (authorized.has(chatId)) return true;

  const { data } = await supabase
    .from("users")
    .select("id, name")
    .eq("chat_id", chatId)
    .single();

  if (data) {
    authorized.set(chatId, data);
    return true;
  }
  return false;
}

// ==================== START ====================
bot.start(async (ctx) => {
  const chatId = ctx.chat.id;

  if (await isAuth(ctx)) {
    return ctx.reply("✅ Вы авторизованы.", mainMenu());
  }

  userStates.set(chatId, { step: "name" });
  ctx.reply("Введите имя:");
});

// ==================== TEXT HANDLER ====================
bot.on("text", async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text;
  const state = userStates.get(chatId);

  // Авторизация
  if (state?.step === "name") {
    userStates.set(chatId, { step: "pin", name: text });
    return ctx.reply("Введите PIN (4 цифры):");
  }

  if (state?.step === "pin") {
    if (!/^\d{4}$/.test(text)) return ctx.reply("PIN должен быть 4 цифры:");
    await supabase.from("users").insert({ name: state.name, password: text, chat_id: chatId });
    authorized.set(chatId, { name: state.name });
    userStates.delete(chatId);
    return ctx.reply("✅ Авторизация выполнена!", mainMenu());
  }

  // Добавление блюда → ввод имени
  if (state?.step === "new_dish") {
    userStates.set(chatId, { step: "dish_duration", dishName: text });
    
    const inlineKeyboard = {
      inline_keyboard: [
        [{ text: "24 часа", callback_data: "dur_24" }],
        [{ text: "48 часов", callback_data: "dur_48" }],
        [{ text: "72 часа", callback_data: "dur_72" }],
        [{ text: "🧪 Тест (1 минута)", callback_data: "dur_test" }]
      ]
    };
    
    return ctx.reply("Выберите срок хранения:", { reply_markup: inlineKeyboard });
  }

  // Меню:
  if (text === "➕ Добавить блюдо") {
    if (!(await isAuth(ctx))) return ctx.reply("Сначала /start");
    
    // Получаем последние использованные названия
    const { data: recentDishes } = await supabase
      .from("dishes")
      .select("name")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(50);
    
    const uniqueNames = [...new Set(recentDishes?.map(d => d.name) || [])].slice(0, 8);
    
    if (uniqueNames.length > 0) {
      const buttons = uniqueNames.map(name => [
        { text: name, callback_data: `dish_${encodeURIComponent(name)}` }
      ]);
      buttons.push([{ text: "➕ Добавить новое блюдо", callback_data: "dish_new" }]);
      
      return ctx.reply("Выберите блюдо или добавьте новое:", {
        reply_markup: { inline_keyboard: buttons }
      });
    } else {
      userStates.set(chatId, { step: "new_dish" });
      return ctx.reply("Введите название блюда:");
    }
  }

  if (text === "📦 Список блюд") {
    if (!(await isAuth(ctx))) return ctx.reply("Сначала /start");

    const { data } = await supabase
      .from("dishes")
      .select("*")
      .eq("chat_id", chatId)
      .eq("status", "active")
      .order("expires_at");

    if (!data || data.length === 0) return ctx.reply("Нет активных блюд.", mainMenu());

    const list = data.map((d, i) => {
      const expiresDate = new Date(d.expires_at);
      const day = String(expiresDate.getUTCDate()).padStart(2, '0');
      const month = String(expiresDate.getUTCMonth() + 1).padStart(2, '0');
      const hours = String(expiresDate.getUTCHours()).padStart(2, '0');
      const minutes = String(expiresDate.getUTCMinutes()).padStart(2, '0');
      const dateStr = `${day}.${month} ${hours}:${minutes}`;
      const timeUntil = formatTimeUntil(d.expires_at);
      
      return `${i + 1}. ${d.name}\n   📅 ${dateStr} UTC — ${timeUntil}`;
    }).join("\n\n");

    const buttons = data.map(d => [{
      text: `❌ ${d.name.length > 20 ? d.name.substring(0, 17) + '...' : d.name} Списать`,
      callback_data: `rm_${d.id}`
    }]);

    return ctx.reply(`📦 Список блюд:\n\n${list}`, {
      reply_markup: { inline_keyboard: buttons }
    });
  }

  if (text === "🗑 Списанные блюда") {
    if (!(await isAuth(ctx))) return ctx.reply("Сначала /start");

    const { data } = await supabase
      .from("dishes")
      .select("*")
      .eq("chat_id", chatId)
      .in("status", ["removed", "expired"])
      .order("created_at", { ascending: false })
      .limit(50);

    if (!data || data.length === 0) return ctx.reply("Нет списанных блюд.", mainMenu());

    const list = data.map((d, i) => {
      const createdDate = new Date(d.created_at);
      const day = String(createdDate.getUTCDate()).padStart(2, '0');
      const month = String(createdDate.getUTCMonth() + 1).padStart(2, '0');
      const dateStr = `${day}.${month}`;
      const statusEmoji = d.status === "expired" ? "⏰" : "❌";
      const statusText = d.status === "expired" ? "Истёк" : "Списано";
      
      return `${i + 1}. ${d.name} ${statusEmoji} ${statusText} (${dateStr})`;
    }).join("\n");

    return ctx.reply(`🗑 Списанные блюда:\n\n${list}`, mainMenu());
  }
});

// ==================== CALLBACK HANDLERS ====================

// Выбор блюда из списка
bot.action(/^dish_/, async (ctx) => {
  const callbackData = ctx.callbackQuery.data;
  const chatId = ctx.chat.id;
  
  if (callbackData === "dish_new") {
    await ctx.answerCbQuery();
    await ctx.editMessageText("Введите название блюда:");
    userStates.set(chatId, { step: "new_dish" });
    return;
  }
  
  const dishName = decodeURIComponent(callbackData.replace("dish_", ""));
  userStates.set(chatId, { step: "dish_duration", dishName });
  
  const inlineKeyboard = {
    inline_keyboard: [
      [{ text: "24 часа", callback_data: "dur_24" }],
      [{ text: "48 часов", callback_data: "dur_48" }],
      [{ text: "72 часа", callback_data: "dur_72" }],
      [{ text: "🧪 Тест (1 минута)", callback_data: "dur_test" }]
    ]
  };
  
  await ctx.answerCbQuery();
  await ctx.editMessageText("Выберите срок хранения:", { reply_markup: inlineKeyboard });
});

// Выбор времени хранения
bot.action(/^dur_/, async (ctx) => {
  const callbackData = ctx.callbackQuery.data;
  const chatId = ctx.chat.id;
  const state = userStates.get(chatId);
  
  if (!state || !state.dishName) {
    await ctx.answerCbQuery("❌ Ошибка: не найдено название блюда");
    return;
  }
  
  try {
    const now = new Date();
    let expiresAt;
    let messageText;
    
    // Обработка тестовой кнопки
    if (callbackData === "dur_test") {
      expiresAt = new Date(now.getTime() + 1 * 60 * 1000); // 1 минута
      messageText = `✅ Тестовое блюдо "${state.dishName}" добавлено!\nСрок хранения: до ${formatDateTime(expiresAt.toISOString())} UTC (${formatTimeUntil(expiresAt.toISOString())})\n\n🧪 Уведомление придет через 1 минуту!`;
    } else {
      // Обработка часов (24, 48, 72)
      const hoursStr = callbackData.replace("dur_", "");
      const hours = parseInt(hoursStr);
      
      if (isNaN(hours) || ![24, 48, 72].includes(hours)) {
        await ctx.answerCbQuery("❌ Неверное значение времени");
        return;
      }
      
      expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000);
      messageText = `✅ Блюдо "${state.dishName}" добавлено!\nСрок хранения: до ${formatDateTime(expiresAt.toISOString())} UTC (${formatTimeUntil(expiresAt.toISOString())})`;
    }
    
    // Сохранение в базу
    const { error } = await supabase.from("dishes").insert({
      chat_id: chatId,
      name: state.dishName,
      expires_at: expiresAt.toISOString(),
      status: "active"
    });
    
    if (error) {
      console.error("Error saving dish:", error);
      await ctx.answerCbQuery("❌ Ошибка при сохранении");
      return;
    }
    
    // Очистка состояния
    userStates.delete(chatId);
    await ctx.answerCbQuery("✅ Готово");
    
    // Обновление сообщения и отправка главного меню
    await ctx.editMessageText(messageText);
    await ctx.reply("Блюдо добавлено!", mainMenu());
    
  } catch (error) {
    console.error("Error in dur_ handler:", error);
    await ctx.answerCbQuery("❌ Произошла ошибка");
  }
});

// Удаление блюда
bot.action(/^rm_/, async (ctx) => {
  const id = ctx.callbackQuery.data.replace("rm_", "");
  const chatId = ctx.chat.id;
  
  await supabase.from("dishes").update({ status: "removed" }).eq("id", id).eq("chat_id", chatId);
  await ctx.answerCbQuery("✅ Списано");
  
  // Обновляем список
  const { data: remainingDishes } = await supabase
    .from("dishes")
    .select("*")
    .eq("chat_id", chatId)
    .eq("status", "active")
    .order("expires_at");
  
  if (!remainingDishes || remainingDishes.length === 0) {
    await ctx.editMessageText("✅ Блюдо списано.\n\nНет активных блюд.", mainMenu());
    return;
  }
  
  const list = remainingDishes.map((d, i) => {
    const expiresDate = new Date(d.expires_at);
    const day = String(expiresDate.getUTCDate()).padStart(2, '0');
    const month = String(expiresDate.getUTCMonth() + 1).padStart(2, '0');
    const hours = String(expiresDate.getUTCHours()).padStart(2, '0');
    const minutes = String(expiresDate.getUTCMinutes()).padStart(2, '0');
    const dateStr = `${day}.${month} ${hours}:${minutes}`;
    const timeUntil = formatTimeUntil(d.expires_at);
    
    return `${i + 1}. ${d.name}\n   📅 ${dateStr} UTC — ${timeUntil}`;
  }).join("\n\n");
  
  const buttons = remainingDishes.map(d => [{
    text: `❌ ${d.name.length > 20 ? d.name.substring(0, 17) + '...' : d.name} Списать`,
    callback_data: `rm_${d.id}`
  }]);
  
  await ctx.editMessageText(`✅ Блюдо списано.\n\n📦 Список блюд:\n\n${list}`, {
    reply_markup: { inline_keyboard: buttons }
  });
});

// ==================== AUTO CHECK: EXPIRED ====================
async function checkExpired() {
  const now = new Date().toISOString();

  const { data } = await supabase
    .from("dishes")
    .select("id, name, chat_id, expires_at")
    .eq("status", "active")
    .lte("expires_at", now);

  if (!data || data.length === 0) return;

  for (const d of data) {
    await bot.telegram.sendMessage(d.chat_id, `❌ Срок истёк: ${d.name}. Требуется списание.`);
    await supabase.from("dishes").update({ status: "expired" }).eq("id", d.id);
  }
}

// ==================== MORNING SUMMARY ====================
async function morningSummary() {
  const now = new Date();
  const isMorningUTC = now.getUTCHours() === 10 && now.getUTCMinutes() === 0;
  if (!isMorningUTC) return;

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getUTCDate());
  const todayEnd = new Date(todayStart.getTime() + 24 * 3600 * 1000);
  
  const { data } = await supabase
    .from("dishes")
    .select("chat_id, name")
    .eq("status", "active")
    .gte("expires_at", todayStart.toISOString())
    .lt("expires_at", todayEnd.toISOString());

  if (!data || data.length === 0) return;

  const grouped = {};
  for (const d of data) (grouped[d.chat_id] ??= []).push(d.name);

  for (const chatId in grouped) {
    const list = grouped[chatId].map(x => `• ${x}`).join("\n");
    await bot.telegram.sendMessage(chatId, `⚠ Сегодня истекает срок хранения:\n${list}`);
  }
}

// ==================== ONE HOUR NOTIFICATION ====================
async function oneHourNotification() {
  const now = new Date();
  const minTime = new Date(now.getTime() + 55 * 60000);
  const maxTime = new Date(now.getTime() + 65 * 60000);

  const { data } = await supabase
    .from("dishes")
    .select("id, name, chat_id")
    .eq("status", "active")
    .gte("expires_at", minTime.toISOString())
    .lte("expires_at", maxTime.toISOString());

  if (!data || data.length === 0) return;

  const grouped = {};
  for (const d of data) (grouped[d.chat_id] ??= []).push(d.name);

  for (const chatId in grouped) {
    const list = grouped[chatId].map(x => `• ${x}`).join("\n");
    await bot.telegram.sendMessage(chatId, `⏳ Через 1 час истекает:\n${list}`);
  }
}

// ==================== RUN SCHEDULER ====================
setInterval(checkExpired, 60 * 1000);
setInterval(morningSummary, 60 * 1000);
setInterval(oneHourNotification, 60 * 1000);

// ==================== START POLLING ====================
bot.launch();
console.log("✅ BOT RUNNING");

// Render health check server
http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }));
  } else {
    res.writeHead(404);
    res.end("Not Found");
  }
}).listen(process.env.PORT || 4000);
