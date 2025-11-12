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
        ["🍽️ Добавить блюдо"],
        ["🥘 Список блюд", "🗑 Списанные блюда"],
      ],
      resize_keyboard: true
    }
  };
}

// Конвертация UTC в МСК (UTC+3)
function toMoscowTime(date) {
  const msk = new Date(date);
  msk.setUTCHours(msk.getUTCHours() + 3);
  return msk;
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

// Форматирование даты и времени (в МСК для отображения)
function formatDateTime(date) {
  const d = toMoscowTime(date);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day}.${month} ${hours}:${minutes} МСК`;
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
    
    // Проверяем, существует ли пользователь с таким именем
    const { data: existingUser, error: userError } = await supabase
      .from("users")
      .select("id, name, password, chat_id")
      .eq("name", state.name)
      .single();
    
    if (userError || !existingUser) {
      // Пользователя нет - отказываем в авторизации
      userStates.delete(chatId);
      return ctx.reply("❌ Пользователь не найден. Проверьте имя и попробуйте снова. /start");
    }
    
    // Пользователь существует - проверяем пароль
    // Приводим оба значения к строке и обрезаем пробелы для надежности
    const dbPassword = String(existingUser.password || "").trim();
    const inputPassword = String(text).trim();
    
    if (dbPassword !== inputPassword) {
      return ctx.reply("❌ Неверный PIN. Попробуйте снова:");
    }
    
    // Пароль правильный - обновляем chat_id (если NULL или изменился)
    if (!existingUser.chat_id || existingUser.chat_id !== chatId) {
      await supabase
        .from("users")
        .update({ chat_id: chatId })
        .eq("id", existingUser.id);
    }
    
    authorized.set(chatId, { name: existingUser.name });
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
  if (text === "🍽️ Добавить блюдо") {
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
      buttons.push([{ text: "🍽️ Добавить новое блюдо", callback_data: "dish_new" }]);
      
      return ctx.reply("Выберите блюдо или добавьте новое:", {
        reply_markup: { inline_keyboard: buttons }
      });
    } else {
      userStates.set(chatId, { step: "new_dish" });
      return ctx.reply("Введите название блюда:");
    }
  }

  if (text === "🥘 Список блюд") {
    if (!(await isAuth(ctx))) return ctx.reply("Сначала /start");

    const { data } = await supabase
      .from("dishes")
      .select("*")
      .eq("chat_id", chatId)
      .eq("status", "active")
      .order("expires_at");

    if (!data || data.length === 0) return ctx.reply("Нет активных блюд.", mainMenu());

    const list = data.map((d, i) => {
      const expiresDate = toMoscowTime(d.expires_at);
      const day = String(expiresDate.getUTCDate()).padStart(2, '0');
      const month = String(expiresDate.getUTCMonth() + 1).padStart(2, '0');
      const hours = String(expiresDate.getUTCHours()).padStart(2, '0');
      const minutes = String(expiresDate.getUTCMinutes()).padStart(2, '0');
      const dateStr = `${day}.${month} ${hours}:${minutes} МСК`;
      const timeUntil = formatTimeUntil(d.expires_at);
      
      return `${i + 1}. ${d.name}\n   🕐 ${dateStr} — ${timeUntil}`;
    }).join("\n\n");

    const buttons = data.map(d => [{
      text: `❌ ${d.name.length > 20 ? d.name.substring(0, 17) + '...' : d.name} Списать`,
      callback_data: `rm_${d.id}`
    }]);

    return ctx.reply(`🥘 Список блюд:\n\n${list}`, { reply_markup: { inline_keyboard: buttons }});
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

    // Получаем имя текущего пользователя из таблицы users по chat_id
    const { data: currentUser } = await supabase
      .from("users")
      .select("name")
      .eq("chat_id", chatId)
      .single();

    const userName = currentUser?.name || `ID:${chatId}`;

    const list = data.map((d, i) => {
      const statusEmoji = d.status === "expired" ? "🍳" : "❌";
      const statusText = d.status === "expired" ? "Истёк" : "Списано";
      
      // Для списанных используем updated_at если есть, иначе created_at (для старых записей)
      // Для истекших используем expires_at
      let dateToShow;
      if (d.status === "removed") {
        dateToShow = d.updated_at || d.created_at; // Если updated_at нет, используем created_at
      } else {
        dateToShow = d.expires_at;
      }
      
      const date = toMoscowTime(dateToShow);
      const day = String(date.getUTCDate()).padStart(2, '0');
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const hours = String(date.getUTCHours()).padStart(2, '0');
      const minutes = String(date.getUTCMinutes()).padStart(2, '0');
      const dateStr = `${day}.${month} ${hours}:${minutes} МСК`;
      
      return `${i + 1}. ${d.name} ${statusEmoji} ${statusText}\n   🕐 ${dateStr} | 👨‍🍳 ${userName}`;
    }).join("\n\n");

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
      messageText = `✅ Тестовое блюдо "${state.dishName}" добавлено!\nСрок хранения: до ${formatDateTime(expiresAt.toISOString())} (${formatTimeUntil(expiresAt.toISOString())})\n\n🧪 Уведомление придет через 1 минуту!`;
    } else {
      // Обработка часов (24, 48, 72)
      const hoursStr = callbackData.replace("dur_", "");
      const hours = parseInt(hoursStr);
      
      if (isNaN(hours) || ![24, 48, 72].includes(hours)) {
        await ctx.answerCbQuery("❌ Неверное значение времени");
        return;
      }
      
      expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000);
      messageText = `✅ Блюдо "${state.dishName}" добавлено!\nСрок хранения: до ${formatDateTime(expiresAt.toISOString())} (${formatTimeUntil(expiresAt.toISOString())})`;
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
    
    // Обновление сообщения (без клавиатуры, так как это editMessageText)
    await ctx.editMessageText(messageText);
    // Отправляем новое сообщение с главным меню
    await ctx.reply("Блюдо добавлено!", mainMenu());
    
  } catch (error) {
    console.error("Error in dur_ handler:", error);
    await ctx.answerCbQuery("❌ Произошла ошибка");
  }
});

// ==================== REMOVE DISH ====================
bot.action(/^rm_/, async (ctx) => {
  const id = ctx.callbackQuery.data.replace("rm_", "");
  const chatId = ctx.chat.id;
  
  // Получаем имя пользователя для записи
  const user = authorized.get(chatId);
  const userName = user?.name || `ID:${chatId}`;
  
  await supabase.from("dishes").update({ 
    status: "removed",
    updated_at: new Date().toISOString()
  }).eq("id", id).eq("chat_id", chatId);
  
  await ctx.answerCbQuery("✅ Списано");
  
  // Обновляем список
  const { data: remainingDishes } = await supabase
    .from("dishes")
    .select("*")
    .eq("chat_id", chatId)
    .eq("status", "active")
    .order("expires_at");
  
  if (!remainingDishes || remainingDishes.length === 0) {
    await ctx.editMessageText("✅ Блюдо списано.\n\nНет активных блюд.");
    await ctx.reply("Нет активных блюд.", mainMenu());
    return;
  }
  
    const list = remainingDishes.map((d, i) => {
      const expiresDate = toMoscowTime(d.expires_at);
      const day = String(expiresDate.getUTCDate()).padStart(2, '0');
      const month = String(expiresDate.getUTCMonth() + 1).padStart(2, '0');
      const hours = String(expiresDate.getUTCHours()).padStart(2, '0');
      const minutes = String(expiresDate.getUTCMinutes()).padStart(2, '0');
      const dateStr = `${day}.${month} ${hours}:${minutes} МСК`;
      const timeUntil = formatTimeUntil(d.expires_at);
      
      return `${i + 1}. ${d.name}\n   🕐 ${dateStr} — ${timeUntil}`;
    }).join("\n\n");
  
  const buttons = remainingDishes.map(d => [{
    text: `❌ ${d.name.length > 20 ? d.name.substring(0, 17) + '...' : d.name} Списать`,
    callback_data: `rm_${d.id}`
  }]);
  
  await ctx.editMessageText(`✅ Блюдо списано.\n\n🥘 Список блюд:\n\n${list}`, {
    reply_markup: { inline_keyboard: buttons }
  });
});

// ==================== AUTO CHECK: EXPIRED ====================
async function checkExpired() {
  const now = new Date().toISOString();

  // Проверяем активные блюда, которые истекли
  const { data: activeExpired } = await supabase
    .from("dishes")
    .select("id, name, chat_id, expires_at")
    .eq("status", "active")
    .lte("expires_at", now);

  if (activeExpired && activeExpired.length > 0) {
    for (const d of activeExpired) {
      try {
        await bot.telegram.sendMessage(d.chat_id, `❌ Срок истёк: ${d.name}. Требуется списание.`);
        await supabase.from("dishes").update({ status: "expired" }).eq("id", d.id);
      } catch (error) {
        console.error(`[CHECK_EXPIRED] Error sending to ${d.chat_id}:`, error.message);
      }
    }
  }

  // Также проверяем уже истекшие блюда (статус expired), чтобы отправлять повторные уведомления
  // пока блюдо не списано вручную
  const { data: expiredDishes } = await supabase
    .from("dishes")
    .select("id, name, chat_id, expires_at, updated_at")
    .eq("status", "expired")
    .lte("expires_at", now);

  if (expiredDishes && expiredDishes.length > 0) {
    for (const d of expiredDishes) {
      // Отправляем уведомление только если прошло больше 1 часа с последнего обновления
      // чтобы не спамить каждую минуту
      const lastUpdate = new Date(d.updated_at || d.expires_at);
      const hoursSinceUpdate = (new Date() - lastUpdate) / (1000 * 60 * 60);
      
      if (hoursSinceUpdate >= 1) {
        try {
          await bot.telegram.sendMessage(d.chat_id, `❌ Срок истёк: ${d.name}. Требуется списание.`);
          // Обновляем updated_at чтобы не спамить
          await supabase.from("dishes").update({ updated_at: new Date().toISOString() }).eq("id", d.id);
        } catch (error) {
          console.error(`[CHECK_EXPIRED] Error sending repeat notification to ${d.chat_id}:`, error.message);
        }
      }
    }
  }
}

// ==================== MORNING SUMMARY ====================
async function morningSummary() {
  const now = new Date();
  // Конвертируем в МСК для проверки времени
  const mskTime = toMoscowTime(now);
  const mskHour = mskTime.getUTCHours();
  const mskMinute = mskTime.getUTCMinutes();
  
  // Проверяем, наступило ли 10:00 МСК (в пределах 1 минуты)
  if (mskHour !== 10 || mskMinute !== 0) return;
  
  try {
    // Получаем всех пользователей
    const { data: allUsers } = await supabase
      .from("users")
      .select("chat_id, name");
    
    if (!allUsers || allUsers.length === 0) return;
    
    // Для каждого пользователя формируем сводку
    for (const user of allUsers) {
      const chatId = user.chat_id;
      
      // 1. Активные блюда
      const { data: activeDishes } = await supabase
        .from("dishes")
        .select("name, expires_at")
        .eq("chat_id", chatId)
        .eq("status", "active")
        .order("expires_at");
      
      // 2. Блюда, которые истекают сегодня
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getUTCDate());
      const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
      
      const { data: todayExpiring } = await supabase
        .from("dishes")
        .select("name, expires_at")
        .eq("chat_id", chatId)
        .eq("status", "active")
        .gte("expires_at", todayStart.toISOString())
        .lt("expires_at", todayEnd.toISOString());
      
      // 3. Блюда, списанные вчера
      const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
      const yesterdayEnd = todayStart;
      
      const { data: yesterdayRemoved } = await supabase
        .from("dishes")
        .select("name, updated_at, created_at")
        .eq("chat_id", chatId)
        .eq("status", "removed")
        .gte("updated_at", yesterdayStart.toISOString())
        .lt("updated_at", yesterdayEnd.toISOString());
      
      // Формируем сообщение
      const parts = [];
      parts.push("🌅 Утренняя сводка (10:00 МСК)\n");
      
      // Активные блюда
      if (activeDishes && activeDishes.length > 0) {
        parts.push(`\n🥘 Активные блюда (${activeDishes.length}):`);
        activeDishes.forEach((d, i) => {
          const expiresDate = toMoscowTime(d.expires_at);
          const day = String(expiresDate.getUTCDate()).padStart(2, '0');
          const month = String(expiresDate.getUTCMonth() + 1).padStart(2, '0');
          const hours = String(expiresDate.getUTCHours()).padStart(2, '0');
          const minutes = String(expiresDate.getUTCMinutes()).padStart(2, '0');
          const timeUntil = formatTimeUntil(d.expires_at);
          parts.push(`${i + 1}. ${d.name} — до ${day}.${month} ${hours}:${minutes} МСК (${timeUntil})`);
        });
      } else {
        parts.push("\n🥘 Активные блюда: нет");
      }
      
      // Истекают сегодня
      if (todayExpiring && todayExpiring.length > 0) {
        parts.push(`\n🍳 Истекают сегодня (${todayExpiring.length}):`);
        todayExpiring.forEach((d, i) => {
          const expiresDate = toMoscowTime(d.expires_at);
          const hours = String(expiresDate.getUTCHours()).padStart(2, '0');
          const minutes = String(expiresDate.getUTCMinutes()).padStart(2, '0');
          parts.push(`${i + 1}. ${d.name} — до ${hours}:${minutes} МСК`);
        });
      } else {
        parts.push("\n🍳 Истекают сегодня: нет");
      }
      
      // Списанные вчера
      if (yesterdayRemoved && yesterdayRemoved.length > 0) {
        parts.push(`\n🗑 Списанные вчера (${yesterdayRemoved.length}):`);
        yesterdayRemoved.forEach((d, i) => {
          const removedDate = toMoscowTime(d.updated_at || d.created_at);
          const hours = String(removedDate.getUTCHours()).padStart(2, '0');
          const minutes = String(removedDate.getUTCMinutes()).padStart(2, '0');
          parts.push(`${i + 1}. ${d.name} — ${hours}:${minutes} МСК`);
        });
      } else {
        parts.push("\n🗑 Списанные вчера: нет");
      }
      
      const message = parts.join("\n");
      
      try {
        await bot.telegram.sendMessage(chatId, message);
      } catch (error) {
        console.error(`[MORNING_SUMMARY] Error sending to ${chatId}:`, error.message);
      }
    }
  } catch (error) {
    console.error('[MORNING_SUMMARY] Error:', error);
  }
}

// ==================== RUN SCHEDULER ====================
setInterval(checkExpired, 60 * 1000);
setInterval(morningSummary, 60 * 1000);

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
