// Импортируем scheduler handler из bot.js
const { schedulerHandler } = require('./bot');

// Экспортируем handler для Netlify Scheduled Functions
exports.handler = schedulerHandler;
