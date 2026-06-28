const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { loadEnv } = require("./lib/env");
const { readSupabaseDb, writeSupabaseDb } = require("./lib/supabaseStore");

const ROOT = __dirname;
loadEnv(ROOT);

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const emptyDb = () => ({
  users: [],
  weddings: [],
  weddingMembers: [],
  ceremonies: [],
  tasks: [],
  budgetItems: [],
  guests: [],
  guestCeremonies: [],
  invites: [],
  notes: [],
  activity: []
});

function ensureDb() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(emptyDb(), null, 2));
    }
  } catch (error) {
    // 只读文件系统（Vercel serverless 等）无法写入本地 json。
    // 此时必须 DATA_BACKEND=supabase，否则读写会失败。
  }
}

async function readDb() {
  if (process.env.DATA_BACKEND === "supabase") {
    return readSupabaseDb(emptyDb);
  }
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

async function writeDb(db) {
  if (process.env.DATA_BACKEND === "supabase") {
    return writeSupabaseDb(db);
  }
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function isoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function taskGroupForDueDate(dueDate) {
  if (!dueDate) return "later";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  const daysUntilDue = Math.ceil((due.getTime() - today.getTime()) / 86_400_000);
  if (daysUntilDue <= 45) return "now";
  if (daysUntilDue <= 150) return "soon";
  return "later";
}

function selectedCeremonyTemplates(selection) {
  const all = {
    pickup: { name: "接亲仪式", type: "pickup", dayOffset: 0 },
    tea: { name: "敬茶仪式", type: "tea", dayOffset: 0 },
    banquet: { name: "婚宴", type: "banquet", dayOffset: 0 },
    returnHome: { name: "回门", type: "return_home", dayOffset: 3 },
    registration: { name: "注册仪式", type: "registration", dayOffset: -7 }
  };
  const requested = Array.isArray(selection) && selection.length ? selection : ["pickup", "tea", "banquet"];
  return requested.map((key) => all[key]).filter(Boolean).slice(0, 4);
}

function buildGeneratedTasks(weddingId, weddingDate, ceremonies) {
  const date = new Date(weddingDate);
  const validDate = !Number.isNaN(date.getTime());
  const findCeremony = (type) => ceremonies.find((item) => item.type === type)?.id || null;
  const makeTask = ({ title, offsetDays, ceremonyType = null }) => {
    const dueDate = validDate ? isoDate(addDays(date, offsetDays)) : "";
    return {
      id: id("tsk"),
      wedding_id: weddingId,
      ceremony_id: ceremonyType ? findCeremony(ceremonyType) : null,
      title,
      due_date: dueDate,
      group: taskGroupForDueDate(dueDate),
      status: "open",
      assignee: null,
      updated_at: nowIso(),
      created_at: nowIso()
    };
  };

  const tasks = [
    makeTask({ title: "双方家庭确认婚礼日期与主要流程", offsetDays: -210 }),
    makeTask({ title: "确认婚宴场地与初步桌数", offsetDays: -180 }),
    makeTask({ title: "整理第一版宾客名单", offsetDays: -165 }),
    makeTask({ title: "确认摄影与录像团队", offsetDays: -150 }),
    makeTask({ title: "安排婚纱、西装与试身时间", offsetDays: -120 }),
    makeTask({ title: "设定预算分类与初步金额", offsetDays: -105 }),
    makeTask({ title: "确认请柬文字与派发名单", offsetDays: -90 }),
    makeTask({ title: "更新宾客出席状态与桌数估算", offsetDays: -45 }),
    makeTask({ title: "准备红包收入记录表", offsetDays: -21 }),
    makeTask({ title: "确认婚礼当天完整时间表", offsetDays: -14 })
  ];

  if (findCeremony("pickup")) {
    tasks.push(
      makeTask({ title: "确认接亲兄弟姐妹团名单与分工", offsetDays: -60, ceremonyType: "pickup" }),
      makeTask({ title: "准备接亲红包、游戏道具与路线", offsetDays: -21, ceremonyType: "pickup" })
    );
  }
  if (findCeremony("tea")) {
    tasks.push(
      makeTask({ title: "整理敬茶长辈名单与顺序", offsetDays: -75, ceremonyType: "tea" }),
      makeTask({ title: "准备茶具、跪垫与敬茶红包安排", offsetDays: -21, ceremonyType: "tea" })
    );
  }
  if (findCeremony("banquet")) {
    tasks.push(
      makeTask({ title: "确认婚宴菜单、酒水与桌数", offsetDays: -90, ceremonyType: "banquet" }),
      makeTask({ title: "确认婚宴司仪、进场与敬酒流程", offsetDays: -30, ceremonyType: "banquet" })
    );
  }
  if (findCeremony("return_home")) {
    tasks.push(
      makeTask({ title: "确认回门时间、礼品与用餐安排", offsetDays: -14, ceremonyType: "return_home" })
    );
  }
  if (findCeremony("registration")) {
    tasks.push(
      makeTask({ title: "确认注册预约、证婚人与所需文件", offsetDays: -60, ceremonyType: "registration" })
    );
  }

  return tasks.sort((a, b) => {
    const rank = { now: 0, soon: 1, later: 2 };
    return rank[a.group] - rank[b.group] || String(a.due_date).localeCompare(String(b.due_date));
  });
}

function buildGeneratedBudget(weddingId, totalBudget) {
  const total = Math.max(0, sanitizeNumber(totalBudget));
  const categories = [
    ["婚宴场地与酒席", 0.42],
    ["摄影与录像", 0.12],
    ["婚纱、西装与礼服", 0.1],
    ["布置与花艺", 0.1],
    ["化妆与发型", 0.05],
    ["敬茶与接亲用品", 0.06],
    ["戒指与首饰", 0.08],
    ["交通与物流", 0.04],
    ["预备金", 0.03]
  ];
  let allocated = 0;
  const items = categories.map(([category, ratio], index) => {
    const planned = index === categories.length - 1 ? total - allocated : Math.round(total * ratio);
    allocated += planned;
    return {
      id: id("bud"),
      wedding_id: weddingId,
      category,
      planned_amount: planned,
      actual_amount: null,
      type: "expense",
      updated_at: nowIso(),
      created_at: nowIso()
    };
  });

  items.push({
    id: id("bud"),
    wedding_id: weddingId,
    category: "红包收入",
    planned_amount: 0,
    actual_amount: null,
    type: "income",
    updated_at: nowIso(),
    created_at: nowIso()
  });

  return items;
}

function pick(source, keys) {
  return Object.fromEntries(keys.map((key) => [key, source[key]]).filter(([, value]) => value !== undefined));
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function requireUser(db, userId) {
  return db.users.find((user) => user.id === userId);
}

function requireMember(db, weddingId, userId) {
  const user = requireUser(db, userId);
  const membership = db.weddingMembers.find((member) => member.wedding_id === weddingId && member.user_id === userId);
  return user && membership;
}

function recordActivity(db, weddingId, userId, action, label) {
  db.activity.unshift({
    id: id("act"),
    wedding_id: weddingId,
    user_id: userId,
    action,
    label,
    created_at: nowIso()
  });
  db.activity = db.activity.slice(0, 80);
}

function weddingPayload(db, weddingId) {
  const wedding = db.weddings.find((item) => item.id === weddingId);
  const ceremonies = db.ceremonies.filter((item) => item.wedding_id === weddingId);
  const ceremonyIds = new Set(ceremonies.map((item) => item.id));
  const guests = db.guests
    .filter((item) => item.wedding_id === weddingId)
    .map((guest) => ({
      ...guest,
      ceremony_ids: db.guestCeremonies
        .filter((link) => link.guest_id === guest.id && ceremonyIds.has(link.ceremony_id))
        .map((link) => link.ceremony_id)
    }));

  return {
    wedding,
    members: db.weddingMembers
      .filter((member) => member.wedding_id === weddingId)
      .map((member) => db.users.find((user) => user.id === member.user_id))
      .filter(Boolean)
      .map((user) => pick(user, ["id", "name", "email"])),
    ceremonies,
    tasks: db.tasks.filter((item) => item.wedding_id === weddingId),
    budgetItems: db.budgetItems.filter((item) => item.wedding_id === weddingId),
    guests,
    notes: db.notes.filter((item) => item.wedding_id === weddingId),
    activity: db.activity
      .filter((item) => item.wedding_id === weddingId)
      .slice(0, 8)
      .map((item) => ({
        ...item,
        user_name: db.users.find((user) => user.id === item.user_id)?.name || "Partner"
      }))
  };
}

async function handleApi(req, res, url) {
  const db = await readDb();
  const parts = url.pathname.split("/").filter(Boolean);
  const method = req.method;

  if (method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, backend: process.env.DATA_BACKEND || "json", at: nowIso() });
  }

  if (method === "POST" && url.pathname === "/api/users") {
    const body = await parseBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    if (!email || !name) return sendError(res, 400, "请填写名字和 Email。");

    let user = db.users.find((item) => item.email === email);
    if (!user) {
      user = { id: id("usr"), name, email, created_at: nowIso() };
      db.users.push(user);
      await writeDb(db);
    }
    return sendJson(res, 200, { user });
  }

  if (method === "POST" && url.pathname === "/api/login") {
    const body = await parseBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const user = db.users.find((item) => item.email === email);
    if (!user) return sendError(res, 404, "找不到这个 Email 的本机用户。");
    return sendJson(res, 200, { user });
  }

  if (method === "GET" && url.pathname === "/api/session") {
    const userId = url.searchParams.get("userId");
    const user = requireUser(db, userId);
    if (!user) return sendError(res, 404, "找不到用户 session。");
    const weddingIds = db.weddingMembers.filter((member) => member.user_id === userId).map((member) => member.wedding_id);
    const weddings = db.weddings.filter((wedding) => weddingIds.includes(wedding.id));
    return sendJson(res, 200, { user, weddings });
  }

  if (method === "POST" && url.pathname === "/api/bootstrap") {
    // 首次使用（完全没有用户）：建立默认 Oliver + 空婚礼，并直接登入。
    // 已有用户：不自动登入，返回用户列表让前端选择/登入，避免把伴侣的 session 盖掉。
    let user = null;
    let weddingId = "";
    if (db.users.length === 0) {
      user = { id: id("usr"), name: "Oliver", email: "oliver@local", created_at: nowIso() };
      db.users.push(user);
      const wedding = {
        id: id("wed"),
        name: "O&S 婚礼计划",
        date: "",
        total_budget: 0,
        size_estimate: 0,
        created_by: user.id,
        updated_at: nowIso(),
        created_at: nowIso()
      };
      db.weddings.push(wedding);
      db.weddingMembers.push({ wedding_id: wedding.id, user_id: user.id, joined_at: nowIso() });
      recordActivity(db, wedding.id, user.id, "created", "建立共享婚礼计划");
      await writeDb(db);
      weddingId = wedding.id;
    }
    const users = db.users.map((item) => ({ id: item.id, name: item.name, email: item.email }));
    return sendJson(res, 200, { user, weddingId, users });
  }

  if (method === "POST" && url.pathname === "/api/weddings") {
    const body = await parseBody(req);
    if (!requireUser(db, body.userId)) return sendError(res, 401, "请先建立或登入用户。");

    const wedding = {
      id: id("wed"),
      name: String(body.name || "O&S 婚礼计划").trim(),
      date: String(body.date || ""),
      total_budget: sanitizeNumber(body.total_budget),
      size_estimate: sanitizeNumber(body.size_estimate),
      created_by: body.userId,
      updated_at: nowIso(),
      created_at: nowIso()
    };
    db.weddings.push(wedding);
    db.weddingMembers.push({ wedding_id: wedding.id, user_id: body.userId, joined_at: nowIso() });

    const ceremonies = Array.isArray(body.ceremonies) ? body.ceremonies : [];
    ceremonies.slice(0, 6).forEach((item) => {
      const name = String(item.name || "").trim();
      if (!name) return;
      db.ceremonies.push({
        id: id("cer"),
        wedding_id: wedding.id,
        name,
        type: String(item.type || "ceremony").trim(),
        date: String(item.date || wedding.date || ""),
        updated_at: nowIso(),
        created_at: nowIso()
      });
    });

    if (body.generatePlan) {
      const createdCeremonies = db.ceremonies.filter((item) => item.wedding_id === wedding.id);
      db.tasks.push(...buildGeneratedTasks(wedding.id, wedding.date, createdCeremonies));
      db.budgetItems.push(...buildGeneratedBudget(wedding.id, wedding.total_budget));
    }

    recordActivity(db, wedding.id, body.userId, "created", body.generatePlan ? "生成了第一份共享计划" : "建立了共享婚礼计划");
    await writeDb(db);
    return sendJson(res, 201, weddingPayload(db, wedding.id));
  }

  if (method === "POST" && url.pathname === "/api/onboarding") {
    const body = await parseBody(req);
    if (!requireUser(db, body.userId)) return sendError(res, 401, "请先建立或登入用户。");

    const weddingDate = String(body.date || "").trim();
    const budget = sanitizeNumber(body.total_budget);
    const sizeEstimate = sanitizeNumber(body.size_estimate);
    if (!weddingDate || !budget || !sizeEstimate) {
      return sendError(res, 400, "请填写婚礼日期、预算和预计宾客人数。");
    }

    const wedding = {
      id: id("wed"),
      name: "O&S 婚礼计划",
      date: weddingDate,
      total_budget: budget,
      size_estimate: sizeEstimate,
      created_by: body.userId,
      updated_at: nowIso(),
      created_at: nowIso()
    };
    db.weddings.push(wedding);
    db.weddingMembers.push({ wedding_id: wedding.id, user_id: body.userId, joined_at: nowIso() });

    const baseDate = new Date(weddingDate);
    const ceremonyTemplates = selectedCeremonyTemplates(body.ceremony_types);
    const ceremonies = ceremonyTemplates.map((item) => ({
      id: id("cer"),
      wedding_id: wedding.id,
      name: item.name,
      type: item.type,
      date: isoDate(addDays(baseDate, item.dayOffset)) || weddingDate,
      updated_at: nowIso(),
      created_at: nowIso()
    }));
    db.ceremonies.push(...ceremonies);
    db.tasks.push(...buildGeneratedTasks(wedding.id, wedding.date, ceremonies));
    db.budgetItems.push(...buildGeneratedBudget(wedding.id, wedding.total_budget));

    recordActivity(db, wedding.id, body.userId, "generated", "生成了待办与预算追踪表");
    await writeDb(db);
    return sendJson(res, 201, weddingPayload(db, wedding.id));
  }

  if (method === "GET" && parts[0] === "api" && parts[1] === "weddings" && parts.length === 3) {
    const weddingId = parts[2];
    const userId = url.searchParams.get("userId");
    if (!requireMember(db, weddingId, userId)) return sendError(res, 403, "这个用户没有加入这份婚礼计划。");
    return sendJson(res, 200, weddingPayload(db, weddingId));
  }

  if (method === "PATCH" && parts[0] === "api" && parts[1] === "weddings" && parts.length === 3) {
    const weddingId = parts[2];
    const body = await parseBody(req);
    if (!requireMember(db, weddingId, body.userId)) return sendError(res, 403, "这个用户没有加入这份婚礼计划。");
    const wedding = db.weddings.find((item) => item.id === weddingId);
    Object.assign(wedding, pick(body, ["name", "date"]));
    if (body.total_budget !== undefined) wedding.total_budget = sanitizeNumber(body.total_budget);
    if (body.size_estimate !== undefined) wedding.size_estimate = sanitizeNumber(body.size_estimate);
    wedding.updated_at = nowIso();
    recordActivity(db, weddingId, body.userId, "updated", "更新了婚礼资料");
    await writeDb(db);
    return sendJson(res, 200, weddingPayload(db, weddingId));
  }

  if (method === "POST" && parts[0] === "api" && parts[1] === "weddings" && parts[3] === "invites") {
    const weddingId = parts[2];
    const body = await parseBody(req);
    if (!requireMember(db, weddingId, body.userId)) return sendError(res, 403, "这个用户没有加入这份婚礼计划。");
    const invite = {
      token: crypto.randomBytes(12).toString("hex"),
      wedding_id: weddingId,
      expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
      created_by: body.userId,
      created_at: nowIso()
    };
    db.invites.push(invite);
    recordActivity(db, weddingId, body.userId, "invited", "建立了伴侣邀请链接");
    await writeDb(db);
    return sendJson(res, 201, { invite });
  }

  if (method === "POST" && parts[0] === "api" && parts[1] === "weddings" && parts[3] === "ceremonies") {
    const weddingId = parts[2];
    const body = await parseBody(req);
    if (!requireMember(db, weddingId, body.userId)) return sendError(res, 403, "这个用户没有加入这份婚礼计划。");
    const ceremony = {
      id: id("cer"),
      wedding_id: weddingId,
      name: String(body.name || "").trim(),
      type: String(body.type || "ceremony").trim(),
      date: String(body.date || "").trim(),
      updated_at: nowIso(),
      created_at: nowIso()
    };
    if (!ceremony.name) return sendError(res, 400, "请填写仪式名称。");
    db.ceremonies.push(ceremony);
    recordActivity(db, weddingId, body.userId, "added", `新增仪式：${ceremony.name}`);
    await writeDb(db);
    return sendJson(res, 201, weddingPayload(db, weddingId));
  }

  if (method === "POST" && parts[0] === "api" && parts[1] === "weddings" && parts[3] === "tasks") {
    const weddingId = parts[2];
    const body = await parseBody(req);
    if (!requireMember(db, weddingId, body.userId)) return sendError(res, 403, "这个用户没有加入这份婚礼计划。");
    const task = {
      id: id("tsk"),
      wedding_id: weddingId,
      ceremony_id: body.ceremony_id || null,
      title: String(body.title || "").trim(),
      due_date: String(body.due_date || "").trim(),
      group: ["now", "soon", "later"].includes(body.group) ? body.group : "now",
      status: body.status === "done" ? "done" : "open",
      assignee: body.assignee || null,
      updated_at: nowIso(),
      created_at: nowIso()
    };
    if (!task.title) return sendError(res, 400, "请填写待办事项。");
    db.tasks.push(task);
    recordActivity(db, weddingId, body.userId, "added", `新增待办：${task.title}`);
    await writeDb(db);
    return sendJson(res, 201, weddingPayload(db, weddingId));
  }

  if (method === "PATCH" && parts[0] === "api" && parts[1] === "tasks" && parts[2]) {
    const body = await parseBody(req);
    const task = db.tasks.find((item) => item.id === parts[2]);
    if (!task) return sendError(res, 404, "找不到这个待办。");
    if (!requireMember(db, task.wedding_id, body.userId)) return sendError(res, 403, "这个用户没有加入这份婚礼计划。");
    Object.assign(task, pick(body, ["title", "due_date", "group", "status", "ceremony_id", "assignee"]));
    task.updated_at = nowIso();
    recordActivity(db, task.wedding_id, body.userId, "updated", `更新待办：${task.title}`);
    await writeDb(db);
    return sendJson(res, 200, weddingPayload(db, task.wedding_id));
  }

  if (method === "POST" && parts[0] === "api" && parts[1] === "weddings" && parts[3] === "budget-items") {
    const weddingId = parts[2];
    const body = await parseBody(req);
    if (!requireMember(db, weddingId, body.userId)) return sendError(res, 403, "这个用户没有加入这份婚礼计划。");
    const item = {
      id: id("bud"),
      wedding_id: weddingId,
      category: String(body.category || "").trim(),
      planned_amount: sanitizeNumber(body.planned_amount),
      actual_amount: body.actual_amount === "" || body.actual_amount === undefined ? null : sanitizeNumber(body.actual_amount),
      type: body.type === "income" ? "income" : "expense",
      updated_at: nowIso(),
      created_at: nowIso()
    };
    if (!item.category) return sendError(res, 400, "请填写预算分类。");
    db.budgetItems.push(item);
    recordActivity(db, weddingId, body.userId, "added", `新增预算项：${item.category}`);
    await writeDb(db);
    return sendJson(res, 201, weddingPayload(db, weddingId));
  }

  if (method === "POST" && parts[0] === "api" && parts[1] === "weddings" && parts[3] === "guests") {
    const weddingId = parts[2];
    const body = await parseBody(req);
    if (!requireMember(db, weddingId, body.userId)) return sendError(res, 403, "这个用户没有加入这份婚礼计划。");
    const guest = {
      id: id("gst"),
      wedding_id: weddingId,
      name: String(body.name || "").trim(),
      status: ["invited", "confirmed", "declined"].includes(body.status) ? body.status : "invited",
      updated_at: nowIso(),
      created_at: nowIso()
    };
    if (!guest.name) return sendError(res, 400, "请填写宾客姓名。");
    db.guests.push(guest);
    const ceremonyIds = new Set(db.ceremonies.filter((item) => item.wedding_id === weddingId).map((item) => item.id));
    (Array.isArray(body.ceremony_ids) ? body.ceremony_ids : [])
      .filter((ceremonyId) => ceremonyIds.has(ceremonyId))
      .forEach((ceremonyId) => db.guestCeremonies.push({ guest_id: guest.id, ceremony_id: ceremonyId }));
    recordActivity(db, weddingId, body.userId, "added", `新增宾客：${guest.name}`);
    await writeDb(db);
    return sendJson(res, 201, weddingPayload(db, weddingId));
  }

  if (method === "PATCH" && parts[0] === "api" && parts[1] === "guests" && parts[2]) {
    const body = await parseBody(req);
    const guest = db.guests.find((item) => item.id === parts[2]);
    if (!guest) return sendError(res, 404, "找不到这个宾客。");
    if (!requireMember(db, guest.wedding_id, body.userId)) return sendError(res, 403, "这个用户没有加入这份婚礼计划。");
    Object.assign(guest, pick(body, ["name", "status"]));
    if (Array.isArray(body.ceremony_ids)) {
      db.guestCeremonies = db.guestCeremonies.filter((link) => link.guest_id !== guest.id);
      const ceremonyIds = new Set(db.ceremonies.filter((item) => item.wedding_id === guest.wedding_id).map((item) => item.id));
      body.ceremony_ids.filter((ceremonyId) => ceremonyIds.has(ceremonyId)).forEach((ceremonyId) => {
        db.guestCeremonies.push({ guest_id: guest.id, ceremony_id: ceremonyId });
      });
    }
    guest.updated_at = nowIso();
    recordActivity(db, guest.wedding_id, body.userId, "updated", `更新宾客：${guest.name}`);
    await writeDb(db);
    return sendJson(res, 200, weddingPayload(db, guest.wedding_id));
  }

  if (method === "GET" && parts[0] === "api" && parts[1] === "invites" && parts[2]) {
    const invite = db.invites.find((item) => item.token === parts[2]);
    if (!invite) return sendError(res, 404, "找不到邀请链接。");
    if (new Date(invite.expires_at).getTime() < Date.now()) return sendError(res, 410, "邀请链接已过期。");
    const payload = weddingPayload(db, invite.wedding_id);
    return sendJson(res, 200, {
      invite,
      wedding: pick(payload.wedding, ["id", "name", "date", "size_estimate"]),
      ceremonies: payload.ceremonies.map((item) => pick(item, ["id", "name", "type", "date"])),
      members: payload.members
    });
  }

  if (method === "POST" && parts[0] === "api" && parts[1] === "invites" && parts[3] === "accept") {
    const token = parts[2];
    const body = await parseBody(req);
    const invite = db.invites.find((item) => item.token === token);
    if (!invite) return sendError(res, 404, "找不到邀请链接。");
    if (new Date(invite.expires_at).getTime() < Date.now()) return sendError(res, 410, "邀请链接已过期。");
    if (!requireUser(db, body.userId)) return sendError(res, 401, "请先建立或登入用户。");
    const exists = db.weddingMembers.some((member) => member.wedding_id === invite.wedding_id && member.user_id === body.userId);
    if (!exists) db.weddingMembers.push({ wedding_id: invite.wedding_id, user_id: body.userId, joined_at: nowIso() });
    recordActivity(db, invite.wedding_id, body.userId, "joined", "加入了共享婚礼计划");
    await writeDb(db);
    return sendJson(res, 200, weddingPayload(db, invite.wedding_id));
  }

  return sendError(res, 404, "Route not found.");
}

function serveStatic(req, res, url) {
  let filePath = path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  if (!fs.existsSync(filePath)) filePath = path.join(PUBLIC_DIR, "index.html");
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };
  res.writeHead(200, { "content-type": types[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (error) {
    return sendError(res, 500, error.message || "Server error.");
  }
}

module.exports = handler;

// 本地开发：npm start 直接跑长驻 server。
// Vercel / serverless：由 api/[...slug].js 引入 handler，不执行下面的 listen。
if (require.main === module) {
  ensureDb();
  const server = http.createServer(handler);
  server.listen(PORT, () => {
    console.log(`Wedding Plan running at http://localhost:${PORT}`);
  });
}
