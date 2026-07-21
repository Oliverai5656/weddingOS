const app = document.querySelector("#app");

const state = {
  user: null,
  users: [],
  weddings: [],
  weddingId: localStorage.getItem("weddingId") || "",
  data: null,
  inviteToken: new URLSearchParams(location.search).get("invite") || "",
  invite: null,
  message: "",
  view: "dashboard"
};

const money = new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR", maximumFractionDigits: 0 });
const dateText = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" });
const LOCAL_DB_KEY = "os-wedding-live-db";
const CACHED_USER_KEY = "os-wedding-user";
const LAST_USERNAME_KEY = "os-wedding-last-username";
const SESSION_TOKEN_KEY = "os-wedding-session-token";
const LOCAL_MIGRATION_KEY = "os-wedding-local-migration-v1";
const CANONICAL_WEDDING_DATE = "2027-09-11";
const FIXED_ACCOUNTS = Object.freeze({
  oliver: { name: "Oliver", email: "oliver@local", passwordHash: "ac07ebf3bc8fa7cecc910f5bfa6a557c115eb2f0e3f391f9cf9aea11b5f7b005" },
  sherine: { name: "Sherine", email: "sherine@local", passwordHash: "3056d0479798773fe2da0d6e6afa18bd05bb6a9af2cb49b84519a647fe4649b0" }
});

function cacheUser(user) {
  if (user) localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(CACHED_USER_KEY);
}

function readCachedUser() {
  try {
    return JSON.parse(localStorage.getItem(CACHED_USER_KEY)) || null;
  } catch {
    return null;
  }
}

function currentView() {
  return location.hash === "#/manage" ? "manage" : "dashboard";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  try {
    const token = localStorage.getItem(SESSION_TOKEN_KEY);
    const response = await fetch(path, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    const type = response.headers.get("content-type") || "";
    if (!type.includes("application/json")) throw new Error("NO_API_BACKEND");
    const payload = await response.json();
    if (!response.ok) {
      const error = new Error(payload.error || "请求失败。");
      error.isApiResponse = true;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.isApiResponse) throw error;
    throw new Error("共享云端暂时无法连接，请稍后刷新。为避免两人的资料分开，系统不会再改存到此设备。", { cause: error });
  }
}

async function migrateBrowserDataToShared(weddingId) {
  if (!weddingId || localStorage.getItem(LOCAL_MIGRATION_KEY) === weddingId) return 0;
  const localData = readLocalDb();
  const meaningfulCount = ["ceremonies", "tasks", "budgetItems", "guests", "notes", "activity"]
    .reduce((total, key) => total + (Array.isArray(localData[key]) ? localData[key].length : 0), 0);
  if (!meaningfulCount) {
    localStorage.setItem(LOCAL_MIGRATION_KEY, weddingId);
    return 0;
  }
  const result = await api(`/api/weddings/${weddingId}/import-local`, {
    method: "POST",
    body: JSON.stringify({ userId: currentUserId(), data: localData })
  });
  localStorage.setItem(LOCAL_MIGRATION_KEY, weddingId);
  return Number(result.imported || 0);
}

function emptyLocalDb() {
  return {
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
  };
}

function readLocalDb() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_DB_KEY)) || emptyLocalDb();
  } catch {
    return emptyLocalDb();
  }
}

function writeLocalDb(db) {
  localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(db));
}

function localId(prefix) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function localNowIso() {
  return new Date().toISOString();
}

async function localPasswordHash(password) {
  const bytes = new TextEncoder().encode(String(password || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function localIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function localAddDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function localTaskGroup(dueDate) {
  if (!dueDate) return "later";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  const days = Math.ceil((due.getTime() - today.getTime()) / 86_400_000);
  if (days <= 45) return "now";
  if (days <= 150) return "soon";
  return "later";
}

function localCeremonyTemplates(selection) {
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

function localGeneratedTasks(weddingId, weddingDate, ceremonies) {
  const date = new Date(weddingDate);
  const findCeremony = (type) => ceremonies.find((item) => item.type === type)?.id || null;
  const makeTask = ({ title, offsetDays, ceremonyType = null }) => {
    const dueDate = localIsoDate(localAddDays(date, offsetDays));
    return {
      id: localId("tsk"),
      wedding_id: weddingId,
      ceremony_id: ceremonyType ? findCeremony(ceremonyType) : null,
      title,
      due_date: dueDate,
      group: localTaskGroup(dueDate),
      status: "open",
      assignee: null,
      updated_at: localNowIso(),
      created_at: localNowIso()
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
  if (findCeremony("pickup")) tasks.push(makeTask({ title: "确认接亲兄弟姐妹团名单与分工", offsetDays: -60, ceremonyType: "pickup" }), makeTask({ title: "准备接亲红包、游戏道具与路线", offsetDays: -21, ceremonyType: "pickup" }));
  if (findCeremony("tea")) tasks.push(makeTask({ title: "整理敬茶长辈名单与顺序", offsetDays: -75, ceremonyType: "tea" }), makeTask({ title: "准备茶具、跪垫与敬茶红包安排", offsetDays: -21, ceremonyType: "tea" }));
  if (findCeremony("banquet")) tasks.push(makeTask({ title: "确认婚宴菜单、酒水与桌数", offsetDays: -90, ceremonyType: "banquet" }), makeTask({ title: "确认婚宴司仪、进场与敬酒流程", offsetDays: -30, ceremonyType: "banquet" }));
  if (findCeremony("return_home")) tasks.push(makeTask({ title: "确认回门时间、礼品与用餐安排", offsetDays: -14, ceremonyType: "return_home" }));
  const rank = { now: 0, soon: 1, later: 2 };
  return tasks.sort((a, b) => rank[a.group] - rank[b.group] || String(a.due_date).localeCompare(String(b.due_date)));
}

function localGeneratedBudget(weddingId, totalBudget) {
  const total = Math.max(0, Number(totalBudget) || 0);
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
    return { id: localId("bud"), wedding_id: weddingId, category, planned_amount: planned, actual_amount: null, type: "expense", updated_at: localNowIso(), created_at: localNowIso() };
  });
  items.push({ id: localId("bud"), wedding_id: weddingId, category: "红包收入", planned_amount: 0, actual_amount: null, type: "income", updated_at: localNowIso(), created_at: localNowIso() });
  return items;
}

function localWeddingPayload(db, weddingId) {
  const wedding = db.weddings.find((item) => item.id === weddingId);
  const ceremonies = db.ceremonies.filter((item) => item.wedding_id === weddingId);
  const ceremonyIds = new Set(ceremonies.map((item) => item.id));
  return {
    wedding,
    members: db.weddingMembers.filter((member) => member.wedding_id === weddingId).map((member) => db.users.find((user) => user.id === member.user_id)).filter(Boolean),
    ceremonies,
    tasks: db.tasks.filter((item) => item.wedding_id === weddingId),
    budgetItems: db.budgetItems.filter((item) => item.wedding_id === weddingId),
    guests: db.guests.filter((item) => item.wedding_id === weddingId).map((guest) => ({
      ...guest,
      ceremony_ids: db.guestCeremonies.filter((link) => link.guest_id === guest.id && ceremonyIds.has(link.ceremony_id)).map((link) => link.ceremony_id)
    })),
    notes: db.notes.filter((item) => item.wedding_id === weddingId),
    activity: db.activity
      .filter((item) => item.wedding_id === weddingId)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map((item) => ({ ...item, user_name: db.users.find((user) => user.id === item.user_id)?.name || "O&S" }))
  };
}

function recordLocalActivity(db, weddingId, userId, label) {
  db.activity.unshift({ id: localId("act"), wedding_id: weddingId, user_id: userId, action: "updated", label, created_at: localNowIso() });
}

function ensureLocalAccounts(db) {
  let changed = false;
  const accounts = Object.values(FIXED_ACCOUNTS).map((account) => {
    let user = db.users.find((item) => String(item.name || "").toLowerCase() === account.name.toLowerCase());
    if (!user) {
      user = { id: localId("usr"), name: account.name, email: account.email, created_at: localNowIso() };
      db.users.push(user);
      changed = true;
    } else if (user.name !== account.name || user.email !== account.email) {
      user.name = account.name;
      user.email = account.email;
      changed = true;
    }
    return user;
  });
  let wedding = db.weddings[0];
  if (!wedding) {
    wedding = { id: localId("wed"), name: "O&S 婚礼计划", date: "", total_budget: 0, size_estimate: 0, created_by: accounts[0].id, updated_at: localNowIso(), created_at: localNowIso() };
    db.weddings.push(wedding);
    recordLocalActivity(db, wedding.id, accounts[0].id, "建立共享婚礼计划");
    changed = true;
  }
  accounts.forEach((user) => {
    if (!db.weddingMembers.some((member) => member.wedding_id === wedding.id && member.user_id === user.id)) {
      db.weddingMembers.push({ wedding_id: wedding.id, user_id: user.id, joined_at: localNowIso() });
      changed = true;
    }
  });
  if (changed) writeLocalDb(db);
  return { accounts, wedding };
}

async function localApi(path, options = {}) {
  const method = options.method || "GET";
  const body = options.body ? JSON.parse(options.body) : {};
  const url = new URL(path, location.origin);
  const parts = url.pathname.split("/").filter(Boolean);
  const db = readLocalDb();

  if (url.pathname === "/api/health") return { ok: true, backend: "browser-local", at: localNowIso() };
  if (method === "POST" && url.pathname === "/api/bootstrap") {
    const setup = ensureLocalAccounts(db);
    const users = setup.accounts.map(({ id, name, email }) => ({ id, name, email }));
    return { user: null, weddingId: setup.wedding.id, users };
  }
  if (method === "POST" && url.pathname === "/api/users") {
    throw new Error("此计划只开放 Oliver 与 Sherine 两个账号。");
  }
  if (method === "POST" && url.pathname === "/api/login") {
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const account = FIXED_ACCOUNTS[username];
    if (!account || account.passwordHash !== await localPasswordHash(password)) throw new Error("用户名或密码不正确。");
    const setup = ensureLocalAccounts(db);
    const user = setup.accounts.find((item) => item.name.toLowerCase() === username);
    return { user, token: `local:${user.id}` };
  }
  if (method === "GET" && url.pathname === "/api/session") {
    const userId = url.searchParams.get("userId");
    const user = db.users.find((item) => item.id === userId);
    if (!user) throw new Error("找不到用户 session。");
    const weddingIds = db.weddingMembers.filter((member) => member.user_id === userId).map((member) => member.wedding_id);
    return { user, weddings: db.weddings.filter((wedding) => weddingIds.includes(wedding.id)) };
  }
  if (method === "POST" && url.pathname === "/api/onboarding") {
    const wedding = { id: localId("wed"), name: "O&S 婚礼计划", date: body.date, total_budget: Number(body.total_budget) || 0, size_estimate: Number(body.size_estimate) || 0, created_by: body.userId, updated_at: localNowIso(), created_at: localNowIso() };
    db.weddings.push(wedding);
    db.weddingMembers.push({ wedding_id: wedding.id, user_id: body.userId, joined_at: localNowIso() });
    const baseDate = new Date(wedding.date);
    const ceremonies = localCeremonyTemplates(body.ceremony_types).map((item) => ({ id: localId("cer"), wedding_id: wedding.id, name: item.name, type: item.type, date: localIsoDate(localAddDays(baseDate, item.dayOffset)) || wedding.date, updated_at: localNowIso(), created_at: localNowIso() }));
    db.ceremonies.push(...ceremonies);
    db.tasks.push(...localGeneratedTasks(wedding.id, wedding.date, ceremonies));
    db.budgetItems.push(...localGeneratedBudget(wedding.id, wedding.total_budget));
    recordLocalActivity(db, wedding.id, body.userId, "生成了待办与预算追踪表");
    writeLocalDb(db);
    return localWeddingPayload(db, wedding.id);
  }
  if (method === "GET" && parts[0] === "api" && parts[1] === "weddings") return localWeddingPayload(db, parts[2]);
  if (method === "POST" && parts[0] === "api" && parts[1] === "weddings" && parts[3] === "invites") {
    const invite = { token: crypto.randomUUID().replaceAll("-", "").slice(0, 24), wedding_id: parts[2], expires_at: localNowIso(), created_by: body.userId, created_at: localNowIso() };
    db.invites.push(invite);
    recordLocalActivity(db, parts[2], body.userId, "建立了伴侣邀请链接");
    writeLocalDb(db);
    return { invite };
  }
  if (method === "POST" && parts[0] === "api" && parts[1] === "weddings" && parts[3] === "ceremonies") {
    db.ceremonies.push({ id: localId("cer"), wedding_id: parts[2], name: body.name, type: body.type || "自定义", date: body.date || "", updated_at: localNowIso(), created_at: localNowIso() });
    recordLocalActivity(db, parts[2], body.userId, `新增仪式：${body.name}`);
    writeLocalDb(db);
    return localWeddingPayload(db, parts[2]);
  }
  if (method === "POST" && parts[0] === "api" && parts[1] === "weddings" && parts[3] === "tasks") {
    db.tasks.push({ id: localId("tsk"), wedding_id: parts[2], ceremony_id: body.ceremony_id || null, title: body.title, due_date: body.due_date || "", group: body.group || "now", status: "open", assignee: null, updated_at: localNowIso(), created_at: localNowIso() });
    recordLocalActivity(db, parts[2], body.userId, `新增待办：${body.title}`);
    writeLocalDb(db);
    return localWeddingPayload(db, parts[2]);
  }
  if (method === "POST" && parts[0] === "api" && parts[1] === "weddings" && parts[3] === "budget-items") {
    db.budgetItems.push({ id: localId("bud"), wedding_id: parts[2], category: body.category, planned_amount: Number(body.planned_amount) || 0, actual_amount: body.actual_amount === "" || body.actual_amount === undefined ? null : Number(body.actual_amount) || 0, type: body.type === "income" ? "income" : "expense", updated_at: localNowIso(), created_at: localNowIso() });
    recordLocalActivity(db, parts[2], body.userId, `新增预算项：${body.category}`);
    writeLocalDb(db);
    return localWeddingPayload(db, parts[2]);
  }
  if (method === "POST" && parts[0] === "api" && parts[1] === "weddings" && parts[3] === "guests") {
    const guest = { id: localId("gst"), wedding_id: parts[2], name: body.name, status: body.status || "invited", updated_at: localNowIso(), created_at: localNowIso() };
    db.guests.push(guest);
    (body.ceremony_ids || []).forEach((ceremonyId) => db.guestCeremonies.push({ guest_id: guest.id, ceremony_id: ceremonyId }));
    recordLocalActivity(db, parts[2], body.userId, `新增宾客：${body.name}`);
    writeLocalDb(db);
    return localWeddingPayload(db, parts[2]);
  }
  throw new Error("这个 live 版本暂不支持此操作。");
}

function setMessage(message) {
  state.message = message;
  render();
}

function currentUserId() {
  return state.user?.id || localStorage.getItem("userId") || "";
}

function groupLabel(group) {
  return { now: "现在", soon: "即将", later: "以后" }[group] || group;
}

function budgetTypeLabel(type) {
  return type === "income" ? "收入" : "支出";
}

function ceremonyTypeLabel(type) {
  return {
    pickup: "接亲",
    tea: "敬茶",
    banquet: "婚宴",
    return_home: "回门",
    registration: "注册"
  }[type] || type || "自定义";
}

function guestStatusLabel(status) {
  return { invited: "已邀请", confirmed: "已确认", declined: "婉拒" }[status] || status;
}

function daysUntil(date) {
  const target = new Date(date);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
}

async function boot() {
  try {
    const bootResult = await api("/api/bootstrap", { method: "POST", body: JSON.stringify({}) });
    state.users = bootResult.users || [];
  } catch {
    state.users = [];
  }
  const userId = localStorage.getItem("userId");
  if (userId) {
    try {
      const session = await api(`/api/session?userId=${encodeURIComponent(userId)}`);
      state.user = session.user;
      state.weddings = session.weddings;
      if (!state.weddingId && session.weddings[0]) state.weddingId = session.weddings[0].id;
    } catch {
      localStorage.removeItem("userId");
      localStorage.removeItem("weddingId");
      localStorage.removeItem(SESSION_TOKEN_KEY);
      cacheUser(null);
      state.user = null;
      state.weddingId = "";
    }
  }
  if (state.inviteToken) {
    try {
      state.invite = await api(`/api/invites/${state.inviteToken}`);
    } catch (error) {
      state.message = error.message;
    }
  }
  if (state.user && state.weddingId) {
    await loadWedding(state.weddingId, false);
  }
  if (!location.hash || !/^#\/(dashboard|manage)$/.test(location.hash)) {
    history.replaceState({}, "", "#/dashboard");
  }
  state.view = currentView();
  render();
}

async function loadWedding(weddingId, shouldRender = true) {
  state.data = await api(`/api/weddings/${weddingId}?userId=${encodeURIComponent(currentUserId())}`);
  state.weddingId = weddingId;
  localStorage.setItem("weddingId", weddingId);
  if (shouldRender) render();
}

function topbar() {
  const user = state.user;
  const wedding = state.data?.wedding;
  return `
    <header class="topbar">
      <div class="brand ${wedding ? "brand-title" : ""}">
        ${wedding ? "" : `<div class="mark" aria-hidden="true">O&S</div>`}
        <div>
          <h1>${wedding ? `${escapeHtml(wedding.name)}` : "O&S 婚礼 Dashboard"}</h1>
          <p>${wedding ? `${escapeHtml(wedding.date || "未设日期")} · O&S 婚礼更新与追踪` : "两个人一起更新、追踪和确认婚礼进度。"}</p>
        </div>
      </div>
      <div class="userbar">
        ${user ? `<span class="tag">${escapeHtml(user.name)} - ${escapeHtml(user.email)}</span><button class="ghost" data-action="logout">退出</button>` : ""}
      </div>
    </header>
  `;
}

function accountPanel() {
  const lastUsername = localStorage.getItem(LAST_USERNAME_KEY) || "Oliver";
  const accounts = state.users.length ? state.users : Object.values(FIXED_ACCOUNTS);
  const options = accounts.map((user) => `<option value="${escapeHtml(user.name)}" ${user.name === lastUsername ? "selected" : ""}>${escapeHtml(user.name)}</option>`).join("");
  return `
    <section class="panel account-panel">
      <h2>登入你们的婚礼计划</h2>
      <p class="copy">用户名已为你准备好。选择 Oliver 或 Sherine，只需输入密码即可继续。</p>
      <form class="form-grid" data-form="login" style="margin-top: 16px;">
        <label>用户名<select name="username" autocomplete="username">${options}</select></label>
        <label>密码<input name="password" type="password" autocomplete="current-password" inputmode="numeric" required autofocus placeholder="输入密码"></label>
        <button type="submit">登入 Dashboard</button>
      </form>
    </section>
  `;
}

function invitePanel() {
  if (!state.inviteToken) return "";
  if (!state.invite) {
    return `
      <section class="panel">
        <h2>邀请链接</h2>
        <p class="copy">${escapeHtml(state.message || "正在载入邀请内容...")}</p>
      </section>
    `;
  }
  const wedding = state.invite.wedding;
  return `
    <section class="panel">
      <h2>你收到 O&S 婚礼计划邀请</h2>
      <p class="copy">登入前可以先看这份共享计划的摘要。</p>
      <div class="list">
        <div class="item">
          <div class="item-title">${escapeHtml(wedding.name)}</div>
          <div class="meta">${escapeHtml(wedding.date || "未设日期")} - 预计 ${escapeHtml(wedding.size_estimate || 0)} 位宾客</div>
          <div class="tag-row">
            ${state.invite.ceremonies.map((item) => `<span class="tag">${escapeHtml(item.name)}</span>`).join("")}
          </div>
        </div>
      </div>
      <div class="muted-action">
        <button data-action="acceptInvite" ${state.user ? "" : "disabled"}>加入共享计划</button>
        ${state.user ? "" : `<span class="meta">请先建立或打开用户。</span>`}
      </div>
    </section>
  `;
}

function onboardingPanel() {
  return `
    <section class="hero-panel">
      <div>
        <h2>填 3 个资料，先生成完整追踪表。</h2>
        <p class="copy">系统会根据日期、预算和人数，生成华人婚礼任务、预算骨架和红包收入追踪。</p>
      </div>
      <form class="form-grid" data-form="onboarding">
        <div class="two-col">
          <label>婚礼日期<input name="date" type="date" value="${CANONICAL_WEDDING_DATE}" required></label>
          <label>总预算 RM<input name="total_budget" type="number" min="0" value="50000"></label>
        </div>
        <label>预计宾客人数<input name="size_estimate" type="number" min="1" value="180" required></label>
        <div class="panel-inline">
          <span class="inline-label">仪式范围</span>
          <div class="checkbox-list">
            <label><input type="checkbox" name="ceremony_types" value="pickup" checked>接亲仪式</label>
            <label><input type="checkbox" name="ceremony_types" value="tea" checked>敬茶仪式</label>
            <label><input type="checkbox" name="ceremony_types" value="banquet" checked>婚宴</label>
            <label><input type="checkbox" name="ceremony_types" value="returnHome">回门</label>
          </div>
        </div>
        <button type="submit">生成追踪 Dashboard</button>
      </form>
    </section>
  `;
}

function weddingSelector() {
  if (!state.weddings.length) return "";
  return `
    <label>共享婚礼
      <select data-action="selectWedding">
        ${state.weddings.map((wedding) => `<option value="${wedding.id}" ${wedding.id === state.weddingId ? "selected" : ""}>${escapeHtml(wedding.name)}</option>`).join("")}
      </select>
    </label>
  `;
}

function foundationSummary() {
  const data = state.data;
  const wedding = data.wedding;
  const expensePlanned = data.budgetItems.filter((item) => item.type === "expense").reduce((sum, item) => sum + Number(item.planned_amount || 0), 0);
  const actualExpense = data.budgetItems.filter((item) => item.type === "expense").reduce((sum, item) => sum + Number(item.actual_amount || 0), 0);
  const incomeActual = data.budgetItems.filter((item) => item.type === "income").reduce((sum, item) => sum + Number(item.actual_amount || 0), 0);
  const confirmedGuests = data.guests.filter((guest) => guest.status === "confirmed").length;
  const invitedGuests = data.guests.filter((guest) => guest.status === "invited").length;
  const remainingBudget = Number(wedding.total_budget || 0) - actualExpense;
  const budgetTotal = Number(wedding.total_budget || 0);
  const spentPercent = budgetTotal ? Math.min(100, Math.round((actualExpense / budgetTotal) * 100)) : 0;
  const confirmedPercent = wedding.size_estimate ? Math.min(100, Math.round((confirmedGuests / Number(wedding.size_estimate)) * 100)) : 0;
  const invitedPercent = wedding.size_estimate ? Math.min(100, Math.round((invitedGuests / Number(wedding.size_estimate)) * 100)) : 0;
  const ceremonyPercent = data.ceremonies.length ? Math.min(100, Math.round((data.ceremonies.length / 4) * 100)) : 0;
  const countdown = daysUntil(wedding.date);
  const taskCounts = data.tasks.reduce((counts, task) => {
    counts[task.group] = (counts[task.group] || 0) + 1;
    return counts;
  }, {});
  const nextTasks = data.tasks
    .filter((task) => task.status !== "done")
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
    .slice(0, 3);
  const timelineRows = data.ceremonies.length ? data.ceremonies.map((item, index) => `
    <div class="timeline-row">
      <span class="timeline-icon">${index + 1}</span>
      <time>${escapeHtml(item.date ? dateText.format(new Date(item.date)) : "待定")}</time>
      <strong>${escapeHtml(item.name)}</strong>
    </div>
  `).join("") : `<div class="empty">还没有仪式时间线。</div>`;
  return `
    <section class="dashboard-card countdown-card">
      <div>
        <h2>婚礼倒计时</h2>
        <div class="countdown-number">${countdown === null ? "--" : Math.max(0, countdown)}</div>
        <p class="countdown-unit">天</p>
        <p class="countdown-date">${escapeHtml(wedding.date || "未设日期")}</p>
      </div>
    </section>
    <section class="dashboard-card task-focus-card">
      <div class="card-heading">
        <h2>今日待办 · 接下来</h2>
        <span>查看全部 (${data.tasks.length})</span>
      </div>
      <div class="focus-list">
        ${nextTasks.length ? nextTasks.map((task) => `
          <div class="focus-row">
            <span class="circle"></span>
            <strong>${escapeHtml(task.title)}</strong>
            <time>${escapeHtml(task.due_date ? dateText.format(new Date(task.due_date)) : "待定")}</time>
          </div>
        `).join("") : `<div class="empty">目前没有待处理事项。</div>`}
      </div>
    </section>
    <section class="dashboard-card timeline-card">
      <div class="card-heading">
        <h2>婚礼日程时间线</h2>
        <span>${data.ceremonies.length} 个仪式</span>
      </div>
      <div class="timeline-list">
        ${timelineRows}
      </div>
    </section>
    <section class="dashboard-card budget-overview-card">
      <div class="card-heading">
        <h2>预算跟踪</h2>
        <span>查看详情</span>
      </div>
      <div class="budget-ring-wrap">
        <div class="budget-ring" style="--spent:${spentPercent}%">
          <span>总预算</span>
          <strong>${money.format(budgetTotal)}</strong>
        </div>
        <div class="legend-list">
          <div><span class="legend-dot red"></span>已支付 ${money.format(actualExpense)}</div>
          <div><span class="legend-dot gold"></span>预算骨架 ${money.format(expensePlanned)}</div>
          <div><span class="legend-dot pale"></span>余额 ${money.format(remainingBudget)}</div>
        </div>
      </div>
    </section>
    <section class="dashboard-card guest-overview-card">
      <div class="card-heading">
        <h2>宾客管理</h2>
        <span>查看详情</span>
      </div>
      <div class="guest-metrics">
        <div><span>总人数</span><strong>${escapeHtml(wedding.size_estimate || 0)}</strong></div>
        <div><span>已确认</span><strong>${confirmedGuests}</strong></div>
        <div><span>待确认</span><strong>${invitedGuests}</strong></div>
      </div>
      <div class="bar-list">
        <div><span>已确认</span><i style="--bar:${confirmedPercent}%"></i><b>${confirmedGuests}</b></div>
        <div><span>已邀请</span><i style="--bar:${invitedPercent}%"></i><b>${invitedGuests}</b></div>
        <div><span>仪式</span><i style="--bar:${ceremonyPercent}%"></i><b>${data.ceremonies.length}</b></div>
      </div>
    </section>
    <section class="dashboard-card invite-card">
      <div>
        <h2>邀请伴侣一起规划</h2>
        <p>共享婚礼计划，双方都可以更新任务、预算和宾客。</p>
      </div>
      <div class="envelope-art">
        <span>O&S</span>
      </div>
      <button data-action="createInvite">建立伴侣邀请链接</button>
    </section>
  `;
}

function controlsPanel() {
  return `
    <section class="side-rail">
      <div class="side-logo">O&S</div>
      <nav class="side-nav" aria-label="主功能">
        <a class="${state.view === "dashboard" ? "active" : ""}" href="#/dashboard">首页 Dashboard</a>
        <a class="${state.view === "manage" ? "active" : ""}" href="#/manage">更新与清单</a>
      </nav>
      <div class="side-actions">
        ${accountSwitcher()}
        ${weddingSelector()}
        <button data-action="refresh" class="secondary">刷新最新资料</button>
        <button data-action="createInvite">建立伴侣邀请链接</button>
        <p class="message">${escapeHtml(state.message)}</p>
      </div>
      <div id="inviteResult" class="invite-box" style="display:none; margin-top: 12px;"></div>
      <div class="side-card">
        <strong>共享成员</strong>
        ${state.data.members.map((member) => `<span>${escapeHtml(member.name)}</span>`).join("")}
      </div>
      <div class="side-card">
        <strong>最近更新</strong>
        ${state.data.activity.length ? state.data.activity.slice(0, 2).map((item) => `<span><b>${escapeHtml(item.user_name)}</b> · ${escapeHtml(item.label)}</span>`).join("") : `<span>更新记录会显示在这里。</span>`}
      </div>
    </section>
  `;
}

function todaySummary() {
  const data = state.data;
  const wedding = data.wedding;
  const countdown = daysUntil(wedding.date);
  const totalTasks = data.tasks.length;
  const completedTasks = data.tasks.filter((task) => task.status === "done").length;
  const progressPercent = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const latestActivity = data.activity.slice(0, 2);
  const nextTasks = data.tasks
    .filter((task) => task.status !== "done")
    .sort((a, b) => {
      const groupRank = { now: 0, soon: 1, later: 2 };
      return (groupRank[a.group] ?? 3) - (groupRank[b.group] ?? 3) || String(a.due_date).localeCompare(String(b.due_date));
    })
    .slice(0, 3);
  const countdownLabel = countdown === null ? "未设日期" : countdown < 0 ? "婚礼日期已记录" : `还有 ${Math.max(0, countdown)} 天`;
  const progressText = countdown === null
    ? "设定婚礼日期后会显示倒计时"
    : totalTasks
      ? `你们一起完成了 ${progressPercent}%`
      : "计划已经建立，可以先加入第一件事";

  return `
    <section class="today-panel">
      <div class="today-summary">
        <span class="eyebrow">首页 / 今天</span>
        <h2>${escapeHtml(countdownLabel)}</h2>
        <p>${escapeHtml(progressText)}。下一步保持简单，先处理最靠前的事项。</p>
        <div class="today-meta">
          <span>${escapeHtml(wedding.date || "未设日期")}</span>
          <span>${completedTasks} 件已完成</span>
          <span>${data.members.length} 位成员</span>
        </div>
        <a class="primary-link" href="#/manage">处理下一件事</a>
      </div>
      <div class="today-progress" aria-label="完成进度">
        <span>共同进度</span>
        <strong>${progressPercent}%</strong>
        <small>${totalTasks ? `${completedTasks} / ${totalTasks} 件` : "还没有任务"}</small>
      </div>
    </section>
    <section class="next-panel">
      <div class="section-heading">
        <h2>接下来</h2>
        <span>最多 3 件</span>
      </div>
      <div class="focus-list">
        ${nextTasks.length ? nextTasks.map((task) => `
          <div class="focus-row">
            <span class="circle"></span>
            <strong>${escapeHtml(task.title)}</strong>
            <time>${escapeHtml(task.due_date ? dateText.format(new Date(task.due_date)) : "待定")}</time>
          </div>
        `).join("") : `<div class="empty">目前没有待处理事项。</div>`}
      </div>
      <a class="text-link" href="#/manage">查看任务管理</a>
    </section>
    <section class="shared-panel">
      <div class="section-heading">
        <h2>共同更新</h2>
        <span>${latestActivity.length ? "最近记录" : "准备开始"}</span>
      </div>
      <div class="activity-list">
        ${latestActivity.length ? latestActivity.map((item) => `<span><b>${escapeHtml(item.user_name)}</b> · ${escapeHtml(item.label)}</span>`).join("") : `<span>更新记录会显示在这里。</span>`}
      </div>
      <button data-action="createInvite">建立伴侣邀请链接</button>
    </section>
  `;
}

function ceremonyPanel() {
  return `
    <section class="panel compact-panel" id="timeline">
      <h2>仪式时间线</h2>
      <form class="form-grid" data-form="addCeremony">
        <div class="two-col">
          <label>仪式名称<input name="name" placeholder="安床"></label>
          <label>类型<input name="type" placeholder="自定义"></label>
        </div>
        <label>日期<input name="date" type="date"></label>
        <button type="submit">新增仪式</button>
      </form>
      <div class="list">
        ${state.data.ceremonies.map((item) => `<div class="item"><div class="item-title">${escapeHtml(item.name)}<span class="tag">${escapeHtml(ceremonyTypeLabel(item.type))}</span></div><div class="meta">${escapeHtml(item.date || "未设日期")}</div></div>`).join("")}
      </div>
    </section>
  `;
}

function taskPanel() {
  const ceremonyOptions = `<option value="">整场婚礼</option>${state.data.ceremonies.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}`;
  return `
    <section class="panel compact-panel" id="tasks">
      <h2>待办更新</h2>
      <form class="form-grid" data-form="addTask">
        <label>事项<input name="title" placeholder="确认婚礼当天流程表"></label>
        <div class="two-col">
          <label>时间组<select name="group"><option value="now">现在</option><option value="soon">即将</option><option value="later">以后</option></select></label>
          <label>关联仪式<select name="ceremony_id">${ceremonyOptions}</select></label>
        </div>
        <label>日期<input name="due_date" type="date"></label>
        <button type="submit">新增待办</button>
      </form>
      <div class="list">
        ${state.data.tasks.length ? state.data.tasks.map((item) => `<div class="item"><div class="item-title">${escapeHtml(item.title)}<span class="tag">${escapeHtml(groupLabel(item.group))}</span></div><div class="meta">${escapeHtml(item.due_date || "未设日期")} - ${escapeHtml(ceremonyName(item.ceremony_id) || "整场婚礼")}</div></div>`).join("") : `<div class="empty">新增事项后会同步给另一位。</div>`}
      </div>
    </section>
  `;
}

function ceremonyName(id) {
  return state.data?.ceremonies.find((item) => item.id === id)?.name || "";
}

function budgetPanel() {
  return `
    <section class="panel compact-panel" id="budget">
      <h2>预算与红包追踪</h2>
      <form class="form-grid" data-form="addBudget">
        <div class="two-col">
          <label>分类<input name="category" placeholder="婚车"></label>
          <label>类型<select name="type"><option value="expense">支出</option><option value="income">收入 / 红包</option></select></label>
        </div>
        <div class="two-col">
          <label>预算 RM<input name="planned_amount" type="number" min="0" value="0"></label>
          <label>实际 RM<input name="actual_amount" type="number" min="0" placeholder="可之后填写"></label>
        </div>
        <button type="submit">新增预算项</button>
      </form>
      <div class="list">
        ${state.data.budgetItems.length ? state.data.budgetItems.map((item) => `<div class="item"><div class="item-title">${escapeHtml(item.category)}<span class="tag">${escapeHtml(budgetTypeLabel(item.type))}</span></div><div class="meta">预算 ${money.format(item.planned_amount || 0)} - 实际 ${item.actual_amount === null ? "未填写" : money.format(item.actual_amount || 0)}</div></div>`).join("") : `<div class="empty">预算项会显示预算与实际金额。</div>`}
      </div>
    </section>
  `;
}

function guestPanel() {
  const ceremonyChecks = state.data.ceremonies.map((item) => `
    <label><input type="checkbox" name="ceremony_ids" value="${item.id}">${escapeHtml(item.name)}</label>
  `).join("");
  const stats = state.data.ceremonies.map((ceremony) => {
    const confirmed = state.data.guests.filter((guest) => guest.status === "confirmed" && guest.ceremony_ids.includes(ceremony.id)).length;
    return `<span class="tag">${escapeHtml(ceremony.name)} 已确认 ${confirmed}</span>`;
  }).join("");
  return `
    <section class="panel compact-panel full" id="guests">
      <h2>宾客追踪</h2>
      <div class="tag-row" style="margin-top: 10px;">${stats || `<span class="tag">还没有仪式统计</span>`}</div>
      <form class="form-grid" data-form="addGuest" style="margin-top: 14px;">
        <div class="two-col">
          <label>宾客姓名<input name="name" placeholder="林阿姨"></label>
          <label>状态<select name="status"><option value="invited">已邀请</option><option value="confirmed">已确认</option><option value="declined">婉拒</option></select></label>
        </div>
        <div class="checkbox-list">${ceremonyChecks}</div>
        <button type="submit">新增宾客</button>
      </form>
      <div class="list">
        ${state.data.guests.length ? state.data.guests.map((guest) => `<div class="item"><div class="item-title">${escapeHtml(guest.name)}<span class="tag">${escapeHtml(guestStatusLabel(guest.status))}</span></div><div class="tag-row">${guest.ceremony_ids.map((id) => `<span class="tag">${escapeHtml(ceremonyName(id))}</span>`).join("") || `<span class="tag">未关联仪式</span>`}</div></div>`).join("") : `<div class="empty">新增宾客并关联一个或多个仪式。</div>`}
      </div>
    </section>
  `;
}

function accountSwitcher() {
  if (!state.user) return "";
  return `<div class="signed-in-user"><span>当前账号</span><strong>${escapeHtml(state.user.name)}</strong></div>`;
}

function activityTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function activityPanel() {
  const items = state.data.activity || [];
  return `
    <section class="panel activity-history full" id="history">
      <div class="card-heading">
        <div>
          <h2>更新历史</h2>
          <p class="copy">每次资料更新都会记录账号、更新内容与时间。</p>
        </div>
        <span>${items.length} 条记录</span>
      </div>
      <div class="history-list">
        ${items.length ? items.map((item) => `
          <div class="history-row">
            <span class="history-avatar" aria-hidden="true">${escapeHtml(item.user_name?.slice(0, 1) || "O")}</span>
            <div>
              <strong>${escapeHtml(item.user_name || "O&S")}</strong>
              <p>${escapeHtml(item.label)}</p>
            </div>
            <time datetime="${escapeHtml(item.created_at)}">${escapeHtml(activityTime(item.created_at))}</time>
          </div>
        `).join("") : `<div class="empty">保存资料后，记录会显示在这里。</div>`}
      </div>
    </section>
  `;
}

function mainApp() {
  if (!state.user) {
    return `<main class="layout"><div class="section-stack">${accountPanel()}${invitePanel()}</div><section class="hero-panel"><h2>开始 O&S 婚礼追踪。</h2><p class="copy">两个人一起更新、追踪和确认婚礼进度。登入后会直接进入 Dashboard。</p></section></main>`;
  }
  if (state.inviteToken && state.invite && !state.data) {
    return `<main class="layout"><div class="section-stack">${invitePanel()}</div><section class="hero-panel"><h2>加入后一起更新。</h2><p class="copy">接受邀请后，你们会拥有同一份婚礼追踪资料。</p></section></main>`;
  }
  if (!state.data) {
    return `<main class="layout"><div class="section-stack">${controlsPanelForNoData()}</div>${onboardingPanel()}</main>`;
  }
  const view = state.view === "manage" ? manageView() : dashboardView();
  return `
    <main class="dashboard-layout" id="dashboard">
      ${controlsPanel()}
      <section class="dashboard-main">
        ${view}
      </section>
    </main>
  `;
}

function dashboardView() {
  return `
    <div class="dashboard-grid">
      ${todaySummary()}
    </div>
    <div class="dashboard-grid overview-grid">
      ${foundationSummary()}
    </div>
    ${activityPanel()}
    ${inspirationPanel()}
  `;
}

function manageView() {
  return `
    <div class="manage-head">
      <h2>更新与清单</h2>
      <p class="copy">在这里新增和追踪仪式、待办、预算与宾客。Dashboard 会即时反映更新。</p>
    </div>
    <div class="data-grid manage-grid">
      ${ceremonyPanel()}
      ${taskPanel()}
      ${budgetPanel()}
      ${guestPanel()}
      ${activityPanel()}
    </div>
  `;
}

function inspirationPanel() {
  return `
    <section class="panel inspiration-panel">
      <div class="card-heading">
        <h2>灵感收藏</h2>
        <span>红金主题</span>
      </div>
      <div class="inspiration-strip" aria-label="婚礼视觉灵感">
        <div class="inspiration-tile tile-red"></div>
        <div class="inspiration-tile tile-table"></div>
        <div class="inspiration-tile tile-card"></div>
        <div class="inspiration-tile tile-dress"></div>
        <div class="inspiration-tile tile-flower"></div>
      </div>
    </section>
  `;
}

function controlsPanelForNoData() {
  return `
    <section class="panel">
      <h2>已登入</h2>
      <p class="copy">现在是 ${escapeHtml(state.user.name)}。请先生成第一份婚礼追踪表。</p>
      <p class="message">${escapeHtml(state.message)}</p>
      <button class="ghost" data-action="logout">退出</button>
    </section>
    ${invitePanel()}
  `;
}

function render() {
  app.innerHTML = `${topbar()}${mainApp()}`;
}

function formData(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  if (form.dataset.form === "addGuest") {
    data.ceremony_ids = new FormData(form).getAll("ceremony_ids");
  }
  if (form.dataset.form === "onboarding") {
    data.ceremony_types = new FormData(form).getAll("ceremony_types");
  }
  return data;
}

app.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const kind = form.dataset.form;
  const data = formData(form);
  try {
    if (kind === "register") {
      const result = await api("/api/users", { method: "POST", body: JSON.stringify(data) });
      state.user = result.user;
      localStorage.setItem("userId", result.user.id);
      cacheUser(result.user);
      state.users = state.users.find((u) => u.id === result.user.id) ? state.users : [...state.users, { id: result.user.id, name: result.user.name, email: result.user.email }];
      history.replaceState({}, "", "#/dashboard");
      state.view = "dashboard";
      state.message = "用户已建立。";
      if (state.inviteToken && state.invite) {
        state.data = null;
      }
    }
    if (kind === "login") {
      const result = await api("/api/login", { method: "POST", body: JSON.stringify(data) });
      state.user = result.user;
      localStorage.setItem("userId", result.user.id);
      localStorage.setItem(LAST_USERNAME_KEY, result.user.name);
      localStorage.setItem(SESSION_TOKEN_KEY, result.token);
      cacheUser(result.user);
      const session = await api(`/api/session?userId=${encodeURIComponent(result.user.id)}`);
      state.weddings = session.weddings;
      state.weddingId = session.weddings[0]?.id || "";
      let imported = 0;
      if (state.weddingId) {
        localStorage.setItem("weddingId", state.weddingId);
        imported = await migrateBrowserDataToShared(state.weddingId);
        await loadWedding(state.weddingId, false);
      }
      history.replaceState({}, "", "#/dashboard");
      state.view = "dashboard";
      state.message = imported
        ? `已登入：${result.user.name}；并合并此设备原有的 ${imported} 项资料。`
        : `已登入：${result.user.name}；现在使用两人共享资料。`;
    }
    if (kind === "onboarding") {
      state.data = await api("/api/onboarding", {
        method: "POST",
        body: JSON.stringify({ ...data, userId: currentUserId() })
      });
      state.weddingId = state.data.wedding.id;
      state.weddings = [state.data.wedding];
      localStorage.setItem("weddingId", state.weddingId);
      state.message = "第一份追踪 Dashboard 已生成。";
    }
    if (kind === "addCeremony") {
      state.data = await api(`/api/weddings/${state.weddingId}/ceremonies`, {
        method: "POST",
        body: JSON.stringify({ ...data, userId: currentUserId() })
      });
      state.message = "仪式已保存。";
    }
    if (kind === "addTask") {
      state.data = await api(`/api/weddings/${state.weddingId}/tasks`, {
        method: "POST",
        body: JSON.stringify({ ...data, userId: currentUserId() })
      });
      state.message = "待办已保存。";
    }
    if (kind === "addBudget") {
      state.data = await api(`/api/weddings/${state.weddingId}/budget-items`, {
        method: "POST",
        body: JSON.stringify({ ...data, userId: currentUserId() })
      });
      state.message = "预算项已保存。";
    }
    if (kind === "addGuest") {
      state.data = await api(`/api/weddings/${state.weddingId}/guests`, {
        method: "POST",
        body: JSON.stringify({ ...data, userId: currentUserId() })
      });
      state.message = "宾客已保存。";
    }
    form.reset();
    render();
  } catch (error) {
    setMessage(error.message);
  }
});

app.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  try {
    if (action === "logout") {
      localStorage.removeItem("userId");
      localStorage.removeItem("weddingId");
      localStorage.removeItem(SESSION_TOKEN_KEY);
      cacheUser(null);
      state.user = null;
      state.users = [];
      state.weddings = [];
      state.weddingId = "";
      state.data = null;
      state.message = "";
      history.replaceState({}, "", "#/dashboard");
      state.view = "dashboard";
      await boot();
    }
    if (action === "refresh") {
      await loadWedding(state.weddingId);
      state.message = "已刷新最新资料。";
      render();
    }

    if (action === "createInvite") {
      const result = await api(`/api/weddings/${state.weddingId}/invites`, {
        method: "POST",
        body: JSON.stringify({ userId: currentUserId() })
      });
      const url = `${location.origin}/?invite=${result.invite.token}`;
      const box = document.querySelector("#inviteResult");
      box.style.display = "grid";
      box.innerHTML = `<strong>伴侣邀请链接</strong><code>${escapeHtml(url)}</code><button class="secondary" data-copy="${escapeHtml(url)}">复制链接</button>`;
      state.message = "邀请链接已建立。对方登入前可以先看摘要。";
      await loadWedding(state.weddingId, false);
      render();
      const refreshed = document.querySelector("#inviteResult");
      if (refreshed) {
        refreshed.style.display = "grid";
        refreshed.innerHTML = `<strong>伴侣邀请链接</strong><code>${escapeHtml(url)}</code>`;
      }
    }
    if (action === "acceptInvite") {
      state.data = await api(`/api/invites/${state.inviteToken}/accept`, {
        method: "POST",
        body: JSON.stringify({ userId: currentUserId() })
      });
      state.weddingId = state.data.wedding.id;
      localStorage.setItem("weddingId", state.weddingId);
      state.weddings = [state.data.wedding];
      history.replaceState({}, "", "/");
      state.inviteToken = "";
      state.invite = null;
      state.message = "你已加入同一份婚礼计划。";
      history.replaceState({}, "", "#/dashboard");
      state.view = "dashboard";
      render();
    }
  } catch (error) {
    setMessage(error.message);
  }
});


  app.addEventListener("change", async (event) => {
    const target = event.target.closest("[data-action='selectWedding']");
    if (!target) return;
    await loadWedding(target.value);
  });

  window.addEventListener("hashchange", () => {
    state.view = currentView();
    render();
  });


async function refreshSharedDataInBackground() {
  if (document.hidden || !state.user || !state.weddingId) return;
  if (document.activeElement?.matches("input, select, textarea")) return;
  try {
    await loadWedding(state.weddingId, false);
    render();
  } catch {
    // Keep the current screen intact; an explicit refresh will show the cloud error.
  }
}

boot();
setInterval(refreshSharedDataInBackground, 30_000);
document.addEventListener("visibilitychange", refreshSharedDataInBackground);
