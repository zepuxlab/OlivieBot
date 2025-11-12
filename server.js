require("dotenv").config();
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
        ["📦 Список блюд"],
      ],
      resize_keyboard: true
    }
  };
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
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString(); // default 24h
    await supabase.from("dishes").insert({ chat_id: chatId, name: text, expires_at: expiresAt, status: "active" });
    userStates.delete(chatId);
    return ctx.reply(`✅ Блюдо "${text}" добавлено на 24ч`, mainMenu());
  }

  // Меню:
  if (text === "➕ Добавить блюдо") {
    if (!(await isAuth(ctx))) return ctx.reply("Сначала /start");
    userStates.set(chatId, { step: "new_dish" });
    return ctx.reply("Введите название блюда:");
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

    const list = data.map((d, i) => `${i+1}. ${d.name} (${new Date(d.expires_at).toLocaleString()})`).join("\n");
    const buttons = data.map(d => [{ text: `❌ ${d.name}`, callback_data: `rm_${d.id}` }]);

    return ctx.reply(`📦 Активные блюда:\n\n${list}`, { reply_markup: { inline_keyboard: buttons }});
  }
});

// ==================== REMOVE DISH ====================
bot.action(/^rm_/, async (ctx) => {
  const id = ctx.callbackQuery.data.replace("rm_", "");
  await supabase.from("dishes").update({ status: "removed" }).eq("id", id);
  ctx.answerCbQuery("✅ Списано");
  ctx.reply("✅ Списано.", mainMenu());
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
    await bot.telegram.sendMessage(d.chat_id, `❌ Срок истёк: ${d.name}`);
    await supabase.from("dishes").update({ status: "expired" }).eq("id", d.id);
  }
}

// ==================== MORNING SUMMARY ====================
async function morningSummary() {
  const now = new Date();
  const isMorningUTC = now.getUTCHours() === 7 && now.getUTCMinutes() === 0;
  if (!isMorningUTC) return;

  const since = new Date(Date.now() - 24*3600*1000).toISOString();
  const { data } = await supabase
    .from("dishes")
    .select("chat_id, name")
    .eq("status", "expired")
    .gte("expires_at", since);

  if (!data || data.length === 0) return;

  const grouped = {};
  for (const d of data) (grouped[d.chat_id] ??= []).push(d.name);

  for (const chatId in grouped) {
    const list = grouped[chatId].map(x => `• ${x}`).join("\n");
    await bot.telegram.sendMessage(chatId, `🌅 Утреняя сводка:\n${list}`);
  }
}

// ==================== RUN SCHEDULER ====================
setInterval(checkExpired, 60 * 1000);
setInterval(morningSummary, 60 * 1000);

// ==================== START POLLING ====================
bot.launch();
console.log("✅ BOT RUNNING");

// Render health check server
http.createServer((req,res)=>{res.end("ok")}).listen(process.env.PORT || 4000);