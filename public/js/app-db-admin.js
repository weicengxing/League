const DB_PAGE_SIZE = 20;

const dbState = {
  tables: [],
  currentTable: null,
  currentPage: 1,
  columns: [],
  items: [],
  totalCount: 0,
};

const DB_TABLE_NAMES = {
  announcements: "公告与瓜棚",
  guild_registry: "妖盟注册表",
  members: "成员信息",
  member_cert_requests: "成员认证申请",
  admin_role_requests: "权限申请",
  users: "用户表",
};

const DB_FIELD_LABELS = {
  username: "用户名",
  password_hash: "密码哈希",
  salt: "盐值",
  display_name: "显示名",
  title: "标题",
  content: "内容",
  category: "分类",
  author: "作者",
  alliance: "联盟",
  hill: "山头",
  guild_code: "妖盟编号",
  guild_prefix: "妖盟前缀",
  guild: "妖盟名称",
  guild_power: "妖盟总战力",
  leader_name: "盟主名称",
  guild_key: "妖盟标识",
  name: "成员名称",
  role: "等级",
  realm: "境界",
  power: "战力",
  hp: "生命",
  attack: "攻击",
  defense: "防御",
  speed: "敏捷",
  bonus_damage: "增伤",
  damage_reduction: "减伤",
  pet: "灵兽",
  note: "备注",
  verified: "已认证",
  screenshot_path: "截图路径",
  status: "状态",
  user_id: "用户 ID",
  member_id: "成员 ID",
  request_type: "申请类型",
  target_name: "目标名称",
  is_read: "已读",
  reviewer_id: "审核人 ID",
  reviewed_at: "审核时间",
  read_at: "读取时间",
  email: "邮箱",
  league: "权限范围",
};

function initDbAdmin() {
  document.querySelector("#dbAdminBtn")?.addEventListener("click", openDbAdminPanel);
  document.querySelector("#dbExportBtn")?.addEventListener("click", handleDbExport);
  document.querySelector("#uploadsExportBtn")?.addEventListener("click", handleUploadsExport);
  document.querySelector("#dbTableList")?.addEventListener("click", handleDbTableSelect);
  document.querySelector("#dbScrollLeftBtn")?.addEventListener("click", () => scrollDbTable(-480));
  document.querySelector("#dbScrollRightBtn")?.addEventListener("click", () => scrollDbTable(480));
  document.querySelector("#dbRefreshBtn")?.addEventListener("click", refreshDbTable);
  document.querySelector("#dbAddBtn")?.addEventListener("click", openDbAddModal);
  document.querySelector("#dbEditForm")?.addEventListener("submit", handleDbEditSubmit);
  document.querySelector("#dbPagination")?.addEventListener("click", handleDbPagination);
  document.querySelector("#dbTableBody")?.addEventListener("click", handleDbTableAction);
  updateDbAdminVisibility();
}

function openDbAdminPanel() {
  switchView("dbAdmin");
  loadDbTables();
}

function handleDbExport() {
  triggerFileDownload("/api/db/export");
}

function handleUploadsExport() {
  triggerFileDownload("/api/db/uploads/export");
}

async function loadDbTables() {
  try {
    const data = await request("/api/db/tables");
    dbState.tables = data.tables || [];
    renderDbTableList();
    updateDbAdminVisibility();
  } catch (error) {
    toast(`加载数据表失败：${error.message}`);
  }
}

function renderDbTableList() {
  const list = document.querySelector("#dbTableList");
  if (!list) return;
  list.innerHTML = dbState.tables.map((table) => `
    <button type="button" class="db-table-btn ${dbState.currentTable === table ? "is-active" : ""}" data-table="${escapeHtml(table)}">
      ${escapeHtml(DB_TABLE_NAMES[table] || table)}
    </button>
  `).join("");
}

async function handleDbTableSelect(event) {
  const button = event.target.closest(".db-table-btn");
  if (!(button instanceof HTMLElement)) return;
  const tableName = button.dataset.table;
  if (!tableName) return;

  dbState.currentTable = tableName;
  dbState.currentPage = 1;
  dbState.columns = [];
  dbState.items = [];
  dbState.totalCount = 0;
  renderDbTableList();
  await loadDbTableData();
}

async function loadDbTableData() {
  if (!dbState.currentTable) return;
  try {
    const data = await request(`/api/db/table/${encodeURIComponent(dbState.currentTable)}`);
    dbState.columns = data.columns || [];
    dbState.items = data.items || [];
    dbState.totalCount = dbState.items.length;
    renderDbTablePanel();
  } catch (error) {
    toast(`加载表数据失败：${error.message}`);
  }
}

function renderDbTablePanel() {
  const panel = document.querySelector("#dbTablePanel");
  const title = document.querySelector("#dbTableTitle");
  const info = document.querySelector("#dbTableInfo");
  const head = document.querySelector("#dbTableHead");
  const body = document.querySelector("#dbTableBody");
  const pagination = document.querySelector("#dbPagination");
  if (!panel || !head || !body || !pagination) return;

  if (!dbState.currentTable) {
    panel.classList.add("hidden");
    return;
  }

  panel.classList.remove("hidden");
  if (title) title.textContent = DB_TABLE_NAMES[dbState.currentTable] || dbState.currentTable;
  if (info) info.textContent = `共 ${dbState.totalCount} 条记录`;

  const readOnly = false;
  head.innerHTML = `
    <tr>
      ${dbState.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}
      ${readOnly ? "" : "<th>操作</th>"}
    </tr>
  `;

  const totalPages = Math.max(1, Math.ceil(dbState.totalCount / DB_PAGE_SIZE));
  const page = Math.min(Math.max(1, dbState.currentPage), totalPages);
  const start = (page - 1) * DB_PAGE_SIZE;
  const pageItems = dbState.items.slice(start, start + DB_PAGE_SIZE);
  dbState.currentPage = page;

  body.innerHTML = pageItems.map((item) => `
    <tr>
      ${dbState.columns.map((column) => renderDbCell(column, item[column])).join("")}
      ${readOnly ? "" : `
        <td>
          <div class="actions">
            <button class="action-btn action-btn--edit" data-db-action="edit" data-db-id="${escapeHtml(String(item.id ?? ""))}">编辑</button>
            <button class="action-btn action-btn--delete" data-db-action="delete" data-db-id="${escapeHtml(String(item.id ?? ""))}">删除</button>
          </div>
        </td>
      `}
    </tr>
  `).join("") || `<tr><td colspan="${dbState.columns.length + (readOnly ? 0 : 1)}">暂无数据</td></tr>`;

  pagination.innerHTML = `
    <button type="button" ${page <= 1 ? "disabled" : ""} data-db-page="prev">上一页</button>
    <span>第 ${page} / ${totalPages} 页</span>
    <button type="button" ${page >= totalPages ? "disabled" : ""} data-db-page="next">下一页</button>
  `;
}

function scrollDbTable(offset) {
  const tableWrap = document.querySelector("#dbTablePanel .table-wrap");
  if (!(tableWrap instanceof HTMLElement)) return;
  tableWrap.scrollBy({ left: offset, behavior: "smooth" });
}

function renderDbCell(column, value) {
  if (["password_hash", "salt", "verify_code"].includes(column) && value) {
    return `<td><span class="db-cell-truncate">${escapeHtml(String(value).slice(0, 20))}...</span></td>`;
  }
  if (value === null || value === undefined || value === "") {
    return `<td><span style="color:#999">-</span></td>`;
  }
  if (typeof value === "string" && value.length > 100) {
    return `<td><span class="db-cell-content" title="${escapeHtml(value)}">${escapeHtml(value.slice(0, 50))}...</span></td>`;
  }
  return `<td>${escapeHtml(String(value))}</td>`;
}

function handleDbPagination(event) {
  const button = event.target.closest("button[data-db-page]");
  if (!(button instanceof HTMLButtonElement) || button.disabled) return;
  dbState.currentPage += button.dataset.dbPage === "prev" ? -1 : 1;
  renderDbTablePanel();
}

async function handleDbTableAction(event) {
  const button = event.target.closest("[data-db-action]");
  if (!(button instanceof HTMLElement)) return;
  const action = button.dataset.dbAction;
  const recordId = button.dataset.dbId;
  if (!action || !recordId) return;

  if (action === "edit") {
    await openDbEditModal(recordId);
    return;
  }

  const confirmed = await openDangerConfirm({
    title: "删除记录",
    message: "确定删除这条记录吗？此操作不可撤销。",
    confirmText: "确认删除",
  });
  if (confirmed) {
    await deleteDbRecord(recordId);
  }
}

async function openDbEditModal(recordId = null) {
  const modal = document.querySelector("#dbEditModal");
  const title = document.querySelector("#dbEditModalTitle");
  const recordField = document.querySelector("#dbEditRecordId");
  const fields = document.querySelector("#dbEditFields");
  if (!modal || !title || !recordField || !fields) return;

  const item = recordId ? dbState.items.find((entry) => String(entry.id) === String(recordId)) : null;
  const editableColumns = dbState.columns.filter((column) => !["id", "created_at", "updated_at"].includes(column));
  recordField.value = recordId || "";
  title.textContent = recordId ? "编辑记录" : "新增记录";
  fields.innerHTML = editableColumns.map((column) => `
    <label>
      <span>${escapeHtml(DB_FIELD_LABELS[column] || column)}</span>
      <input type="text" name="${escapeHtml(column)}" value="${escapeHtml(String(item?.[column] ?? ""))}">
    </label>
  `).join("");
  modal.classList.remove("hidden");
}

function closeDbEditModal() {
  document.querySelector("#dbEditModal")?.classList.add("hidden");
}

async function handleDbEditSubmit(event) {
  event.preventDefault();
  const recordId = document.querySelector("#dbEditRecordId")?.value || "";
  const formData = new FormData(event.target);
  const payload = {};
  formData.forEach((value, key) => {
    payload[key] = value;
  });

  for (const key of ["power", "hp", "attack", "defense", "speed", "guild_power", "bonus_damage", "damage_reduction", "verified", "user_id", "member_id", "reviewer_id", "is_read"]) {
    if (payload[key] !== undefined && payload[key] !== "") {
      payload[key] = Number(payload[key]);
    }
  }

  const url = recordId
    ? `/api/db/table/${encodeURIComponent(dbState.currentTable)}/${recordId}`
    : `/api/db/table/${encodeURIComponent(dbState.currentTable)}`;
  const method = recordId ? "PUT" : "POST";

  try {
    await request(url, { method, body: JSON.stringify(payload) });
    closeDbEditModal();
    await loadDbTableData();
    toast(recordId ? "记录更新成功" : "记录创建成功");
  } catch (error) {
    toast(`保存失败：${error.message}`);
  }
}

async function deleteDbRecord(recordId) {
  try {
    await request(`/api/db/table/${encodeURIComponent(dbState.currentTable)}/${recordId}`, { method: "DELETE" });
    await loadDbTableData();
    toast("记录删除成功");
  } catch (error) {
    toast(`删除失败：${error.message}`);
  }
}

function refreshDbTable() {
  loadDbTableData();
}

function openDbAddModal() {
  openDbEditModal();
}

function updateDbAdminVisibility() {
  const isSuperAdmin = currentUserRole() === "SuperAdmin";
  document.querySelector("#dbAdminBtn")?.classList.toggle("hidden", !isSuperAdmin);
  document.querySelector("#dbExportBtn")?.classList.toggle("hidden", !isSuperAdmin);
  document.querySelector("#uploadsExportBtn")?.classList.toggle("hidden", !isSuperAdmin);
  document.querySelector('[data-view="dbAdmin"]')?.classList.toggle("hidden", !isSuperAdmin);
  document.querySelector("#dbAdminGate")?.classList.toggle("hidden", isSuperAdmin);
  document.querySelector("#dbAdminLayout")?.classList.toggle("hidden", !isSuperAdmin);
}

const originalRenderAuth = renderAuth;
renderAuth = function renderAuthWithDbAdmin() {
  originalRenderAuth();
  updateDbAdminVisibility();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDbAdmin);
} else {
  initDbAdmin();
}
