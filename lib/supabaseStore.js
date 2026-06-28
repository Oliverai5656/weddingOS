const { createClient } = require("@supabase/supabase-js");

const tableMap = {
  users: "app_users",
  weddings: "weddings",
  weddingMembers: "wedding_members",
  ceremonies: "ceremonies",
  tasks: "tasks",
  budgetItems: "budget_items",
  guests: "guests",
  guestCeremonies: "guest_ceremonies",
  invites: "invites",
  notes: "notes",
  activity: "activity"
};

const readOrder = [
  "users",
  "weddings",
  "weddingMembers",
  "ceremonies",
  "tasks",
  "budgetItems",
  "guests",
  "guestCeremonies",
  "invites",
  "notes",
  "activity"
];

const deleteOrder = [
  "activity",
  "guestCeremonies",
  "notes",
  "invites",
  "guests",
  "budgetItems",
  "tasks",
  "ceremonies",
  "weddingMembers",
  "weddings",
  "users"
];

const insertOrder = readOrder;

function createSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing.");
  }
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required when DATA_BACKEND=supabase.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function toDbRows(key, rows) {
  const normalizeDate = (value) => value || null;
  const normalizeRow = (row) => {
    const next = { ...row };
    for (const field of ["date", "due_date"]) {
      if (Object.hasOwn(next, field)) next[field] = normalizeDate(next[field]);
    }
    if (Object.hasOwn(next, "ceremony_id")) next.ceremony_id = next.ceremony_id || null;
    if (Object.hasOwn(next, "assignee")) next.assignee = next.assignee || null;
    if (Object.hasOwn(next, "actual_amount") && next.actual_amount === "") next.actual_amount = null;
    return next;
  };

  if (key === "weddingMembers") {
    return rows.map((row) => ({
      wedding_id: row.wedding_id,
      user_id: row.user_id,
      joined_at: row.joined_at
    }));
  }

  if (key === "guestCeremonies") {
    return rows.map((row) => ({
      guest_id: row.guest_id,
      ceremony_id: row.ceremony_id
    }));
  }

  return rows.map(normalizeRow);
}

async function readSupabaseDb(emptyDb) {
  const supabase = createSupabaseAdmin();
  const db = emptyDb();

  for (const key of readOrder) {
    const { data, error } = await supabase.from(tableMap[key]).select("*");
    if (error) {
      throw new Error(`Supabase read failed for ${tableMap[key]}: ${error.message}`);
    }
    db[key] = data || [];
  }

  return db;
}

async function writeSupabaseDb(db) {
  const supabase = createSupabaseAdmin();

  for (const key of deleteOrder) {
    const { error } = await supabase.from(tableMap[key]).delete().neq("_row_guard", "__never__");
    if (error) {
      throw new Error(`Supabase delete failed for ${tableMap[key]}: ${error.message}`);
    }
  }

  for (const key of insertOrder) {
    const rows = toDbRows(key, db[key] || []);
    if (!rows.length) continue;
    const { error } = await supabase.from(tableMap[key]).insert(rows);
    if (error) {
      throw new Error(`Supabase insert failed for ${tableMap[key]}: ${error.message}`);
    }
  }
}

module.exports = {
  readSupabaseDb,
  writeSupabaseDb
};
