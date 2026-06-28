// Vercel catch-all serverless function。
// 所有 /api/* 请求都会路由到这里，再交给 server.js 的 handler 处理。
// req.url 保持原始路径（如 /api/session），server.js 内部路由逻辑正常工作。
const handler = require("../server.js");

module.exports = handler;
