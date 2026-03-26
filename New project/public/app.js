const state = {
  dashboard: null,
  members: [],
  announcements: [],
  me: { authenticated: false, admin: null },
  currentView: "guilds",
  selectedGuild: null,
  search: "",
  guildDetailSearch: "",
  guildDetailRoleFilter: "all",
  hillFilter: "all",
  guildFilter: "all",
  guildPageByHill: {},
  rankingPage: 1,
  guildDetailPage: 1,
  rankingGuildFilter: "all",
  sort: "power-desc",
};

const els = {
  allianceName: document.querySelector("#allianceName"),
  memberCount: document.querySelector("#memberCount"),
  guildCount: document.querySelector("#guildCount"),
  hillCount: document.querySelector("#hillCount"),
  viewButtons: [...document.querySelectorAll(".top-pills__btn")],
  viewPanels: [...document.querySelectorAll(".board-panel")],
  guildSummary: document.querySelector("#guildSummary"),
  guildDetailBack: document.querySelector("#guildDetailBack"),
  guildDetailTitle: document.querySelector("#guildDetailTitle"),
  guildDetailMeta: document.querySelector("#guildDetailMeta"),
  guildDetailActions: document.querySelector("#guildDetailActions"),
  guildDetailSearch: document.querySelector("#guildDetailSearch"),
  guildDetailRoleFilter: document.querySelector("#guildDetailRoleFilter"),
  guildDetailList: document.querySelector("#guildDetailList"),
  rankingList: document.querySelector("#rankingList"),
  rankingItemTemplate: document.querySelector("#rankingItemTemplate"),
  announcementList: document.querySelector("#announcementList"),
  melonList: document.querySelector("#melonList"),
  searchInput: document.querySelector("#searchInput"),
  searchBtn: document.querySelector("#searchBtn"),
  guildFilter: document.querySelector("#guildFilter"),
  hillList: document.querySelector("#hillList"),
  currentHillLabel: document.querySelector("#currentHillLabel"),
  currentGuildCount: document.querySelector("#currentGuildCount"),
  backTopBtn: document.querySelector("#backTopBtn"),
  rankingGuildFilter: document.querySelector("#rankingGuildFilter"),
  sortSelect: document.querySelector("#sortSelect"),
  loginForm: document.querySelector("#loginForm"),
  logoutBtn: document.querySelector("#logoutBtn"),
  loginState: document.querySelector("#loginState"),
  username: document.querySelector("#username"),
  password: document.querySelector("#password"),
  guildAdminGate: document.querySelector("#guildAdminGate"),
  guildAdminLayout: document.querySelector("#guildAdminLayout"),
  announcementAdminGate: document.querySelector("#announcementAdminGate"),
  announcementAdminLayout: document.querySelector("#announcementAdminLayout"),
  refreshBtn: document.querySelector("#refreshBtn"),
  memberForm: document.querySelector("#memberForm"),
  memberFormTitle: document.querySelector("#memberFormTitle"),
  memberFormHint: document.querySelector("#memberFormHint"),
  memberSubmitBtn: document.querySelector("#memberSubmitBtn"),
  resetMemberBtn: document.querySelector("#resetMemberBtn"),
  guildEditModal: document.querySelector("#guildEditModal"),
  guildEditForm: document.querySelector("#guildEditForm"),
  guildEditKey: document.querySelector("#guildEditKey"),
  guildEditAlliance: document.querySelector("#guildEditAlliance"),
  guildEditCode: document.querySelector("#guildEditCode"),
  guildEditPrefix: document.querySelector("#guildEditPrefix"),
  guildEditPower: document.querySelector("#guildEditPower"),
  guildEditName: document.querySelector("#guildEditName"),
  guildEditLeader: document.querySelector("#guildEditLeader"),
  guildEditNote: document.querySelector("#guildEditNote"),
  guildEditTitle: document.querySelector("#guildEditTitle"),
  memberEditModal: document.querySelector("#memberEditModal"),
  memberEditForm: document.querySelector("#memberEditForm"),
  memberEditTitle: document.querySelector("#memberEditTitle"),
  memberEditId: document.querySelector("#memberEditId"),
  memberEditGuildKey: document.querySelector("#memberEditGuildKey"),
  memberEditAlliance: document.querySelector("#memberEditAlliance"),
  memberEditGuildDisplay: document.querySelector("#memberEditGuildDisplay"),
  memberEditName: document.querySelector("#memberEditName"),
  memberEditRole: document.querySelector("#memberEditRole"),
  memberEditRealm: document.querySelector("#memberEditRealm"),
  memberEditPower: document.querySelector("#memberEditPower"),
  memberEditSpeed: document.querySelector("#memberEditSpeed"),
  memberEditPet: document.querySelector("#memberEditPet"),
  memberEditBonusDamage: document.querySelector("#memberEditBonusDamage"),
  memberEditDamageReduction: document.querySelector("#memberEditDamageReduction"),
  memberEditNote: document.querySelector("#memberEditNote"),
  adminMemberTable: document.querySelector("#adminMemberTable"),
  announcementForm: document.querySelector("#announcementForm"),
  announcementFormTitle: document.querySelector("#announcementFormTitle"),
  announcementSubmitBtn: document.querySelector("#announcementSubmitBtn"),
  resetAnnouncementBtn: document.querySelector("#resetAnnouncementBtn"),
  adminAnnouncementTable: document.querySelector("#adminAnnouncementTable"),
};

bindEvents();
boot();

function bindEvents() {
  els.searchInput?.addEventListener("input", (event) => {
    state.search = event.target.value.trim();
    showBrowseView();
    renderGuildFilters();
    renderGuildSummary();
  });

  els.searchBtn?.addEventListener("click", () => {
    showBrowseView();
    renderGuildFilters();
    renderGuildSummary();
  });

  els.viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      switchView(button.dataset.view || "guilds");
    });
  });

  els.guildFilter?.addEventListener("change", (event) => {
    state.guildFilter = event.target.value;
    showBrowseView();
    renderGuildSummary();
  });

  els.hillList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-hill]");
    if (!(button instanceof HTMLElement)) return;
    state.hillFilter = button.dataset.hill || "all";
    showBrowseView();
    ensureGuildPages();
    renderGuildFilters();
    renderGuildSummary();
  });

  els.backTopBtn?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  els.guildDetailBack?.addEventListener("click", () => {
    switchView("guilds");
  });

  els.guildDetailSearch?.addEventListener("input", (event) => {
    state.guildDetailSearch = event.target.value.trim();
    state.guildDetailPage = 1;
    renderGuildDetail();
  });

  els.guildDetailRoleFilter?.addEventListener("change", (event) => {
    state.guildDetailRoleFilter = event.target.value;
    state.guildDetailPage = 1;
    renderGuildDetail();
  });

  els.rankingGuildFilter?.addEventListener("change", (event) => {
    state.rankingGuildFilter = event.target.value;
    state.rankingPage = 1;
    renderRanking();
  });

  els.sortSelect?.addEventListener("change", (event) => {
    state.sort = event.target.value;
    state.rankingPage = 1;
    state.guildDetailPage = 1;
    fetchMembers();
  });

  els.loginForm?.addEventListener("submit", handleLogin);
  els.logoutBtn?.addEventListener("click", handleLogout);
  els.refreshBtn?.addEventListener("click", async () => {
    await refreshAll();
    toast("数据已刷新");
  });
  els.memberForm?.addEventListener("submit", handleMemberSubmit);
  els.resetMemberBtn?.addEventListener("click", resetMemberForm);
  els.guildEditForm?.addEventListener("submit", handleGuildEditSubmit);
  els.memberEditForm?.addEventListener("submit", handleMemberEditSubmit);
  els.announcementForm?.addEventListener("submit", handleAnnouncementSubmit);
  els.resetAnnouncementBtn?.addEventListener("click", resetAnnouncementForm);
  els.adminMemberTable?.addEventListener("click", handleAdminMemberAction);
  els.adminAnnouncementTable?.addEventListener("click", handleAdminAnnouncementAction);
  els.guildDetailList?.addEventListener("click", handleGuildDetailAction);
  els.guildDetailActions?.addEventListener("click", handleGuildDetailToolbarAction);
  document.addEventListener("click", handleModalDismiss);
  document.addEventListener("keydown", handleModalKeydown);
}

async function boot() {
  try {
    await refreshAll();
  } catch (error) {
    console.error(error);
    toast(`页面初始化失败：${error.message}`);
  }
  renderView();
}

async function refreshAll() {
  await loadDashboard();
  await Promise.all([fetchMembers(), fetchAnnouncements(), fetchMe()]);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const isJson = response.headers.get("Content-Type")?.includes("application/json");
  const data = isJson ? await response.json() : null;
  if (!response.ok) {
    throw new Error(data?.error || "请求失败");
  }
  return data;
}

async function loadDashboard() {
  state.dashboard = await request("/api/dashboard");
  renderDashboard();
}

async function fetchMembers() {
  const query = new URLSearchParams({
    search: "",
    hill: "all",
    guild: "all",
    sort: state.sort,
  });
  const data = await request(`/api/members?${query.toString()}`);
  state.members = data.items || [];
  renderDashboard();
  renderGuildFilters();
  renderGuildSummary();
  renderRanking();
  renderAdminMembers();
  renderGuildDetail();
}

async function fetchAnnouncements() {
  const data = await request("/api/announcements");
  state.announcements = data.items || [];
  renderFeeds();
  renderAdminAnnouncements();
}

async function fetchMe() {
  state.me = await request("/api/me");
  renderAuth();
}

function renderDashboard() {
  const hills = getDerivedHills();
  const guildCount = hills.reduce((sum, hill) => sum + hill.guilds.length, 0);
  if (els.allianceName) {
    els.allianceName.textContent = state.dashboard?.alliance_name || "青云联盟";
  }
  if (els.memberCount) {
    els.memberCount.textContent = `${state.members.length || state.dashboard?.member_count || 0} 名成员`;
  }
  if (els.guildCount) {
    els.guildCount.textContent = `${guildCount} 个妖盟`;
  }
  if (els.hillCount) {
    els.hillCount.textContent = `${hills.length} 个联盟`;
  }
}

function renderView() {
  els.viewButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.currentView);
  });
  els.viewPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.panel === state.currentView);
  });
  renderGuildDetail();
}

function switchView(view) {
  state.currentView = view;
  renderView();
}

function showBrowseView() {
  if (state.currentView !== "guilds") {
    switchView("guilds");
  }
}

function renderGuildFilters() {
  const hills = getSearchMatchedHills();
  const guildNames = [
    ...new Set(
      hills
        .filter((hill) => state.hillFilter === "all" || hill.name === state.hillFilter)
        .flatMap((hill) => hill.guilds.map((guild) => guild.key)),
    ),
  ].sort((a, b) => a.localeCompare(b, "zh-CN"));

  if (state.hillFilter !== "all" && !hills.some((hill) => hill.name === state.hillFilter)) {
    state.hillFilter = "all";
  }
  if (state.guildFilter !== "all" && !guildNames.includes(state.guildFilter)) {
    state.guildFilter = "all";
  }
  if (state.rankingGuildFilter !== "all" && !guildNames.includes(state.rankingGuildFilter)) {
    state.rankingGuildFilter = "all";
  }

  if (els.guildFilter) {
    els.guildFilter.innerHTML = [
      `<option value="all">选择妖盟</option>`,
      ...guildNames.map((guildKey) => `<option value="${escapeHtml(guildKey)}">${escapeHtml(getGuildLabelFromKey(guildKey, hills))}</option>`),
    ].join("");
    els.guildFilter.value = state.guildFilter;
  }

  if (els.rankingGuildFilter) {
    els.rankingGuildFilter.innerHTML = [
      `<option value="all">全部妖盟</option>`,
      ...guildNames.map((guildKey) => `<option value="${escapeHtml(guildKey)}">${escapeHtml(getGuildLabelFromKey(guildKey, hills))}</option>`),
    ].join("");
    els.rankingGuildFilter.value = state.rankingGuildFilter;
  }

  if (els.currentHillLabel) {
    els.currentHillLabel.textContent = state.hillFilter === "all" ? "全部" : state.hillFilter;
  }

  if (els.currentGuildCount) {
    const currentGuildCount = hills
      .filter((hill) => state.hillFilter === "all" || hill.name === state.hillFilter)
      .reduce((sum, hill) => sum + hill.guilds.length, 0);
    els.currentGuildCount.textContent = String(currentGuildCount);
  }

  if (els.hillList) {
    els.hillList.innerHTML = [
      `<button type="button" class="hill-item ${state.hillFilter === "all" ? "is-active" : ""}" data-hill="all"><span>全部联盟</span><span class="hill-item__count">${hills.length}</span></button>`,
      ...hills.map((hill) => `
        <button type="button" class="hill-item ${state.hillFilter === hill.name ? "is-active" : ""}" data-hill="${escapeHtml(hill.name)}">
          <span>${escapeHtml(hill.name)}</span>
          <span class="hill-item__count">${hill.guilds.length}</span>
        </button>
      `),
    ].join("");
  }

  ensureGuildPages(hills);
}

function renderGuildSummary() {
  if (!els.guildSummary) return;
  const hills = getVisibleHills();
  if (!hills.length) {
    els.guildSummary.innerHTML = `<article class="empty-card">暂无符合条件的妖盟数据。</article>`;
    return;
  }

  els.guildSummary.innerHTML = hills.map((hill) => `
    <section class="hill-section">
      <header class="hill-section__head">
        <h2>📍 ${escapeHtml(hill.name)}</h2>
      </header>
      <div class="guild-card-grid">
        ${getPagedGuilds(hill).items.map((guild) => renderGuildCard(guild)).join("")}
      </div>
      ${renderHillPagination(hill)}
    </section>
  `).join("");
}

function renderGuildCard(guild) {
  const [first, second] = guild.leaders;
  return `
    <article class="guild-card">
      <div class="guild-card__badge">${guild.count}人</div>
      <div class="guild-card__title-row">
        <h3>${escapeHtml(guild.displayName)}</h3>
        <span class="guild-card__mark">${guild.rank <= 3 ? "🌟" : "🔸"}</span>
      </div>
      <p class="guild-card__power-label">总战力: <strong>${formatNumber(getGuildPower(guild))}</strong></p>
      <div class="guild-card__leaders">
        <div class="guild-card__leader">
          <span>🏆 车头1:</span>
          <strong>${first ? escapeHtml(first.name) : "暂无"}</strong>
          <b>${first ? formatNumber(first.power) : "-"}</b>
        </div>
        <div class="guild-card__leader">
          <span>🥈 车头2:</span>
          <strong>${second ? escapeHtml(second.name) : "暂无"}</strong>
          <b>${second ? formatNumber(second.power) : "-"}</b>
        </div>
      </div>
      <p class="guild-card__update">最后更新: ${escapeHtml(guild.updatedAt || "暂无记录")}</p>
      <button type="button" class="guild-card__action" data-open-guild="${escapeHtml(guild.key)}">📊 查看妖盟全成员战力</button>
    </article>
  `;
}

function renderGuildDetail() {
  if (!els.guildDetailList || !els.guildDetailTitle || !els.guildDetailMeta) return;
  if (!state.selectedGuild) {
    els.guildDetailTitle.textContent = "妖盟详情";
    els.guildDetailMeta.textContent = "点击妖盟卡片可查看完整成员信息。";
    if (els.guildDetailActions) els.guildDetailActions.innerHTML = "";
    if (els.guildDetailSearch) els.guildDetailSearch.value = "";
    if (els.guildDetailRoleFilter) els.guildDetailRoleFilter.innerHTML = `<option value="all">全部职位</option>`;
    els.guildDetailList.innerHTML = `<article class="empty-card">请选择一个妖盟查看详情。</article>`;
    return;
  }

  const detail = getGuildDetail(state.selectedGuild);
  if (!detail) {
    els.guildDetailTitle.textContent = "妖盟详情";
    els.guildDetailMeta.textContent = "当前妖盟未找到。";
    if (els.guildDetailActions) els.guildDetailActions.innerHTML = "";
    if (els.guildDetailSearch) els.guildDetailSearch.value = "";
    if (els.guildDetailRoleFilter) els.guildDetailRoleFilter.innerHTML = `<option value="all">全部职位</option>`;
    els.guildDetailList.innerHTML = `<article class="empty-card">没有找到该妖盟的数据。</article>`;
    return;
  }

  els.guildDetailTitle.textContent = detail.name;
  els.guildDetailMeta.textContent = `${detail.hill} · ${detail.members.length} 名成员 · 总战力 ${formatNumber(detail.power)}`;
  renderGuildDetailFilters(detail.members);
  if (els.guildDetailActions) {
    els.guildDetailActions.innerHTML = state.me.authenticated
      ? `<button type="button" class="primary-btn" data-action="add-member">新增成员</button>`
      : `<button type="button" class="ghost-btn" data-action="go-login">登录后管理成员</button>`;
  }
  const filteredMembers = getFilteredGuildMembers(detail.members);
  if (!filteredMembers.length) {
    els.guildDetailList.innerHTML = `<article class="empty-card">没有找到符合条件的成员。</article>`;
    return;
  }
  const page = paginateItems(filteredMembers, state.guildDetailPage, 6);
  state.guildDetailPage = page.currentPage;
  els.guildDetailList.innerHTML = page.items.map((member, index) => `
    <article class="detail-member-card">
      <div class="detail-member-card__rank">${(page.currentPage - 1) * page.pageSize + index + 1}</div>
      <div class="detail-member-card__body">
        <div class="detail-member-card__top">
          <div>
            <strong>${escapeHtml(member.name)}</strong>
            <p>${escapeHtml(member.role)} · ${escapeHtml(member.realm)}</p>
          </div>
          <b>${formatNumber(member.power)}</b>
        </div>
        <div class="detail-member-card__stats">
          <span>境界 ${escapeHtml(member.realm)}</span>
          <span>战力 ${formatNumber(member.power)}</span>
          <span>敏捷 ${formatNumber(member.speed)}</span>
          <span>灵兽 ${escapeHtml(member.pet)}</span>
          <span>增伤 ${formatNumber(member.bonus_damage)}%</span>
          <span>减伤 ${formatNumber(member.damage_reduction)}%</span>
        </div>
        <small>${escapeHtml(member.note || "暂无备注")}</small>
        ${state.me.authenticated ? `
          <div class="detail-member-card__actions">
            <button type="button" class="action-btn action-btn--edit" data-action="edit-detail-member" data-id="${member.id}">编辑</button>
            <button type="button" class="action-btn action-btn--delete" data-action="delete-detail-member" data-id="${member.id}">删除</button>
          </div>
        ` : ""}
      </div>
    </article>
  `).join("") + renderSimplePagination("guild-detail-page", page);
}

function getGuildDetail(guildKey) {
  const members = state.members
    .filter((member) => buildGuildKey(member) === guildKey)
    .sort((a, b) => Number(b.power || 0) - Number(a.power || 0));
  if (!members.length) return null;
  return {
    name: getGuildDisplayName(members[0]),
    hill: members[0].hill || "默认联盟",
    power: getGuildManualPower(members) || members.reduce((sum, member) => sum + Number(member.power || 0), 0),
    members,
  };
}

function renderGuildDetailFilters(members) {
  if (els.guildDetailSearch) {
    els.guildDetailSearch.value = state.guildDetailSearch;
  }
  if (els.guildDetailRoleFilter) {
    const roles = [...new Set(members.map((member) => member.role).filter(Boolean))];
    els.guildDetailRoleFilter.innerHTML = [
      `<option value="all">全部职位</option>`,
      ...roles.map((role) => `<option value="${escapeHtml(role)}">${escapeHtml(role)}</option>`),
    ].join("");
    els.guildDetailRoleFilter.value = roles.includes(state.guildDetailRoleFilter) ? state.guildDetailRoleFilter : "all";
    if (!roles.includes(state.guildDetailRoleFilter)) {
      state.guildDetailRoleFilter = "all";
    }
  }
}

function getFilteredGuildMembers(members) {
  const keyword = state.guildDetailSearch.trim().toLowerCase();
  return members.filter((member) => {
    const matchRole = state.guildDetailRoleFilter === "all" || member.role === state.guildDetailRoleFilter;
    const matchKeyword = !keyword || [
      member.name,
      member.role,
      member.realm,
      member.note,
      member.pet,
    ].some((value) => String(value || "").toLowerCase().includes(keyword));
    return matchRole && matchKeyword;
  });
}

function paginateItems(items, currentPage, pageSize) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, currentPage || 1), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    currentPage: safePage,
    totalPages,
    pageSize,
  };
}

function renderSimplePagination(kind, page) {
  if (page.totalPages <= 1) return "";
  return `
    <div class="hill-pagination">
      <button type="button" class="hill-pagination__btn" data-pagination-kind="${kind}" data-page-action="prev" ${page.currentPage === 1 ? "disabled" : ""}>上一页</button>
      <span class="hill-pagination__info">第 ${page.currentPage} / ${page.totalPages} 页</span>
      <button type="button" class="hill-pagination__btn" data-pagination-kind="${kind}" data-page-action="next" ${page.currentPage === page.totalPages ? "disabled" : ""}>下一页</button>
    </div>
  `;
}

function getSearchMatchedHills() {
  const keyword = state.search.trim();
  const hills = getDerivedHills();
  if (!keyword) return hills;
  return hills
    .map((hill) => ({
      ...hill,
      guilds: hill.guilds.filter((guild) => matchKeyword(hill.name, keyword) || matchKeyword(guild.displayName, keyword)),
    }))
    .filter((hill) => hill.guilds.length);
}

function getVisibleHills() {
  return getSearchMatchedHills()
    .filter((hill) => state.hillFilter === "all" || hill.name === state.hillFilter)
    .map((hill) => ({
      ...hill,
      guilds: hill.guilds.filter((guild) => state.guildFilter === "all" || guild.key === state.guildFilter),
    }))
    .filter((hill) => hill.guilds.length);
}

function getPagedGuilds(hill) {
  const pageSize = 4;
  const totalPages = Math.max(1, Math.ceil(hill.guilds.length / pageSize));
  const currentPage = Math.min(state.guildPageByHill[hill.name] || 1, totalPages);
  const start = (currentPage - 1) * pageSize;
  return {
    currentPage,
    totalPages,
    items: hill.guilds.slice(start, start + pageSize),
  };
}

function renderHillPagination(hill) {
  const page = getPagedGuilds(hill);
  if (page.totalPages <= 1) return "";
  return `
    <div class="hill-pagination">
      <button type="button" class="hill-pagination__btn" data-hill-page="${escapeHtml(hill.name)}" data-page-action="prev" ${page.currentPage === 1 ? "disabled" : ""}>上一页</button>
      <span class="hill-pagination__info">第 ${page.currentPage} / ${page.totalPages} 页</span>
      <button type="button" class="hill-pagination__btn" data-hill-page="${escapeHtml(hill.name)}" data-page-action="next" ${page.currentPage === page.totalPages ? "disabled" : ""}>下一页</button>
    </div>
  `;
}

function ensureGuildPages(hills = getSearchMatchedHills()) {
  for (const hill of hills) {
    const totalPages = Math.max(1, Math.ceil(hill.guilds.length / 4));
    const currentPage = state.guildPageByHill[hill.name] || 1;
    state.guildPageByHill[hill.name] = Math.min(currentPage, totalPages);
  }
}

function getDerivedHills() {
  const hillMap = new Map();

  for (const member of state.members) {
    const hillName = member.hill || "默认联盟";
    const guildName = member.guild || "未命名妖盟";
    const guildKey = buildGuildKey(member);
    const guildDisplayName = getGuildDisplayName(member);

    if (!hillMap.has(hillName)) {
      hillMap.set(hillName, {
        name: hillName,
        power: 0,
        guilds: new Map(),
      });
    }

    const hill = hillMap.get(hillName);
    hill.power += Number(member.power || 0);

    if (!hill.guilds.has(guildKey)) {
      hill.guilds.set(guildKey, {
        key: guildKey,
        name: guildName,
        displayName: guildDisplayName,
        code: member.guild_code || "",
        prefix: member.guild_prefix || "",
        hill: hillName,
        count: 0,
        power: 0,
        customPower: 0,
        updatedAt: member.updated_at || member.created_at || "",
        leaders: [],
      });
    }

    const guild = hill.guilds.get(guildKey);
    guild.count += 1;
    guild.power += Number(member.power || 0);
    guild.customPower = Math.max(guild.customPower || 0, Number(member.guild_power || 0));
    guild.updatedAt = newerDate(guild.updatedAt, member.updated_at || member.created_at || "");
    guild.leaders.push(member);
  }

  return [...hillMap.values()]
    .map((hill) => {
      const guilds = [...hill.guilds.values()]
        .map((guild) => ({
          ...guild,
          leaders: guild.leaders.sort((a, b) => Number(b.power || 0) - Number(a.power || 0)).slice(0, 2),
        }))
        .sort((a, b) => b.power - a.power)
        .map((guild, index) => ({ ...guild, rank: index + 1 }));
      return { ...hill, guilds };
    })
    .sort((a, b) => b.power - a.power);
}

function renderRanking() {
  if (!els.rankingList) return;
  const filteredItems = [...state.members]
    .filter((member) => state.rankingGuildFilter === "all" || buildGuildKey(member) === state.rankingGuildFilter)
    .sort(sorters[state.sort]);
  const page = paginateItems(filteredItems, state.rankingPage, 8);
  state.rankingPage = page.currentPage;

  if (!filteredItems.length) {
    els.rankingList.innerHTML = `<article class="empty-card">暂无排行榜数据。</article>`;
    return;
  }

  els.rankingList.innerHTML = "";
  page.items.forEach((member, index) => {
    const fragment = els.rankingItemTemplate.content.cloneNode(true);
    fragment.querySelector(".ranking-item__index").textContent = String((page.currentPage - 1) * page.pageSize + index + 1);
    fragment.querySelector(".ranking-item__name").textContent = member.name;
    fragment.querySelector(".ranking-item__meta").textContent = `${member.hill || "默认联盟"} · ${getGuildDisplayName(member)} · ${member.role} · ${member.realm}`;
    fragment.querySelector(".ranking-item__power").textContent = formatNumber(member.power);
    els.rankingList.appendChild(fragment);
  });
  els.rankingList.insertAdjacentHTML("beforeend", renderSimplePagination("ranking-page", page));
}

function renderFeeds() {
  const announcements = state.announcements.filter((item) => item.category === "公告");
  const melonPosts = state.announcements.filter((item) => item.category === "瓜棚");
  if (els.announcementList) {
    els.announcementList.innerHTML = renderFeedGroup(announcements, "暂无公告内容。");
  }
  if (els.melonList) {
    els.melonList.innerHTML = renderFeedGroup(melonPosts, "暂无瓜棚内容。");
  }
}

function renderFeedGroup(items, emptyText) {
  if (!items.length) return `<article class="empty-card">${emptyText}</article>`;
  return items.map((item) => `
    <article class="feed-item">
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.content)}</p>
      <small>${escapeHtml(item.created_at || "")}</small>
    </article>
  `).join("");
}

function renderAuth() {
  const authenticated = state.me.authenticated;
  els.logoutBtn?.classList.toggle("hidden", !authenticated);
  els.loginForm?.classList.toggle("hidden", authenticated);
  els.guildAdminGate?.classList.toggle("hidden", authenticated);
  els.guildAdminLayout?.classList.toggle("hidden", !authenticated);
  els.announcementAdminGate?.classList.toggle("hidden", authenticated);
  els.announcementAdminLayout?.classList.toggle("hidden", !authenticated);
  if (els.loginState) {
    els.loginState.textContent = authenticated ? `已登录：${state.me.admin.display_name}` : "未登录";
  }
}

async function handleLogin(event) {
  event.preventDefault();
  try {
    await request("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: els.username.value.trim(),
        password: els.password.value.trim(),
      }),
    });
    await fetchMe();
    toast("管理员登录成功");
  } catch (error) {
    toast(error.message);
  }
}

async function handleLogout() {
  try {
    await request("/api/logout", { method: "POST", body: "{}" });
    await fetchMe();
    toast("已退出登录");
  } catch (error) {
    toast(error.message);
  }
}

async function handleMemberSubmit(event) {
  event.preventDefault();
  const formId = document.querySelector("#memberId").value;
  const basePayload = {
    alliance: document.querySelector("#memberAlliance").value.trim(),
    hill: document.querySelector("#memberAlliance").value.trim() || "默认分组",
    guild_code: document.querySelector("#memberGuildCode").value.trim(),
    guild_prefix: document.querySelector("#memberGuildPrefix").value.trim(),
    guild_power: Number(document.querySelector("#memberGuildPower").value || 0),
    guild: document.querySelector("#memberGuild").value.trim(),
    name: document.querySelector("#memberName").value.trim(),
    role: "盟主",
    realm: "待补充",
    power: 0,
    hp: 0,
    attack: 0,
    defense: 0,
    speed: 0,
    pet: "待补充",
    note: document.querySelector("#memberNote").value.trim(),
  };

  try {
    if (formId.startsWith("guild:")) {
      await updateGuildRecord(formId.replace("guild:", ""), {
        guild: document.querySelector("#memberGuild").value.trim(),
        name: document.querySelector("#memberName").value.trim(),
        guild_power: Number(document.querySelector("#memberGuildPower").value || 0),
      });
    } else {
      const method = formId ? "PUT" : "POST";
      const url = formId ? `/api/members/${formId}` : "/api/members";
      await request(url, { method, body: JSON.stringify(basePayload) });
    }
    resetMemberForm();
    await refreshAll();
    toast(formId ? "妖盟更新成功" : "妖盟创建成功");
  } catch (error) {
    toast(error.message);
  }
}

function resetMemberForm() {
  els.memberForm?.reset();
  document.querySelector("#memberId").value = "";
  document.querySelector("#memberAlliance").value = state.dashboard?.alliance_name || "青云联盟";
  setGuildFormEditMode(false);
  if (els.memberFormTitle) els.memberFormTitle.textContent = "录入新妖盟";
  if (els.memberFormHint) els.memberFormHint.textContent = "新增妖盟时填写完整信息；编辑妖盟时只修改妖盟名称和盟主昵称。";
  if (els.memberSubmitBtn) els.memberSubmitBtn.textContent = "保存妖盟";
}

async function handleAnnouncementSubmit(event) {
  event.preventDefault();
  const payload = {
    category: document.querySelector("#announcementCategory").value,
    title: document.querySelector("#announcementTitle").value.trim(),
    content: document.querySelector("#announcementContent").value.trim(),
  };
  const announcementId = document.querySelector("#announcementId").value;
  const method = announcementId ? "PUT" : "POST";
  const url = announcementId ? `/api/announcements/${announcementId}` : "/api/announcements";

  try {
    await request(url, { method, body: JSON.stringify(payload) });
    resetAnnouncementForm();
    await Promise.all([loadDashboard(), fetchAnnouncements()]);
    toast(announcementId ? "内容更新成功" : "内容发布成功");
  } catch (error) {
    toast(error.message);
  }
}

function resetAnnouncementForm() {
  els.announcementForm?.reset();
  document.querySelector("#announcementId").value = "";
  document.querySelector("#announcementCategory").value = "公告";
  if (els.announcementFormTitle) els.announcementFormTitle.textContent = "发布动态";
  if (els.announcementSubmitBtn) els.announcementSubmitBtn.textContent = "发布内容";
}

function renderAdminMembers() {
  if (!els.adminMemberTable) return;
  const guildRows = getAdminGuildRows();
  if (!guildRows.length) {
    els.adminMemberTable.innerHTML = `<tr><td colspan="5">暂无妖盟数据。</td></tr>`;
    return;
  }
  els.adminMemberTable.innerHTML = guildRows.map((guild) => `
    <tr>
      <td>${escapeHtml(guild.alliance)}</td>
      <td>${escapeHtml(guild.code || "-")}</td>
      <td>${escapeHtml(guild.shortName)}</td>
      <td>${escapeHtml(guild.leaderName)}</td>
      <td>
        <div class="actions">
          <button class="action-btn action-btn--edit" data-action="edit-member" data-guild-key="${escapeHtml(guild.key)}">编辑</button>
          <button class="action-btn action-btn--delete" data-action="delete-member" data-guild-key="${escapeHtml(guild.key)}">删除</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderAdminAnnouncements() {
  if (!els.adminAnnouncementTable) return;
  if (!state.announcements.length) {
    els.adminAnnouncementTable.innerHTML = `<tr><td colspan="4">暂无动态内容。</td></tr>`;
    return;
  }
  els.adminAnnouncementTable.innerHTML = state.announcements.map((item) => `
    <tr>
      <td>${escapeHtml(item.category)}</td>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(item.created_at || "")}</td>
      <td>
        <div class="actions">
          <button class="action-btn action-btn--edit" data-action="edit-announcement" data-id="${item.id}">编辑</button>
          <button class="action-btn action-btn--delete" data-action="delete-announcement" data-id="${item.id}">删除</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function getAdminGuildRows() {
  const guildMap = new Map();
  for (const member of state.members) {
    const key = buildGuildKey(member);
    if (!guildMap.has(key)) {
      guildMap.set(key, {
        key,
        alliance: member.alliance || "未命名联盟",
        code: member.guild_code || "",
        displayName: getGuildDisplayName(member),
        shortName: member.guild || "未命名妖盟",
        leaderName: member.name || "待补充",
        power: Number(member.guild_power || 0),
      });
      continue;
    }
    const existing = guildMap.get(key);
    if ((member.role || "") === "盟主") {
      existing.id = member.id;
      existing.leaderName = member.name || existing.leaderName;
    }
  }
  return [...guildMap.values()];
}

async function updateGuildRecord(guildKey, payload) {
  const guildMembers = state.members.filter((item) => buildGuildKey(item) === guildKey);
  if (!guildMembers.length) {
    throw new Error("没有找到对应的妖盟记录");
  }

  await Promise.all(
    guildMembers.map((member) => {
      const memberPayload = {
        ...member,
        guild: payload.guild,
        guild_power: payload.guild_power ?? member.guild_power ?? 0,
        note: member.note,
        name: member.role === "盟主" ? payload.name : member.name,
      };
      return request(`/api/members/${member.id}`, {
        method: "PUT",
        body: JSON.stringify(memberPayload),
      });
    }),
  );
}

function openGuildEditModal(leader, guildKey) {
  if (!els.guildEditModal || !els.guildEditKey || !els.guildEditName || !els.guildEditLeader) return;
  els.guildEditKey.value = guildKey;
  if (els.guildEditAlliance) els.guildEditAlliance.value = leader.alliance || "";
  if (els.guildEditCode) els.guildEditCode.value = leader.guild_code || "";
  if (els.guildEditPrefix) els.guildEditPrefix.value = leader.guild_prefix || "";
  if (els.guildEditPower) els.guildEditPower.value = formatNumber(leader.guild_power || 0);
  els.guildEditName.value = leader.guild || "";
  els.guildEditLeader.value = leader.name || "";
  if (els.guildEditNote) els.guildEditNote.value = leader.note || "";
  if (els.guildEditTitle) {
    els.guildEditTitle.textContent = `编辑妖盟 · ${getGuildDisplayName(leader)}`;
  }
  els.guildEditModal.classList.remove("hidden");
  window.setTimeout(() => els.guildEditName?.focus(), 0);
}

function closeGuildEditModal() {
  els.guildEditModal?.classList.add("hidden");
  els.guildEditForm?.reset();
}

function openMemberEditModal(member, guildKey) {
  if (!els.memberEditModal || !els.memberEditForm) return;
  const sourceMember = member || state.members.find((item) => buildGuildKey(item) === guildKey);
  if (!sourceMember) return;
  const isEdit = Boolean(member);
  if (els.memberEditTitle) {
    els.memberEditTitle.textContent = isEdit ? `编辑成员 · ${sourceMember.name}` : `新增成员 · ${getGuildDisplayName(sourceMember)}`;
  }
  els.memberEditId.value = isEdit ? String(sourceMember.id) : "";
  els.memberEditGuildKey.value = guildKey;
  els.memberEditAlliance.value = sourceMember.alliance || "";
  els.memberEditGuildDisplay.value = getGuildDisplayName(sourceMember);
  els.memberEditName.value = isEdit ? sourceMember.name || "" : "";
  els.memberEditRole.value = isEdit ? sourceMember.role || "成员" : "成员";
  els.memberEditRealm.value = isEdit ? sourceMember.realm || "" : "";
  els.memberEditPower.value = isEdit ? String(sourceMember.power || 0) : "0";
  els.memberEditSpeed.value = isEdit ? String(sourceMember.speed || 0) : "0";
  els.memberEditPet.value = isEdit ? sourceMember.pet || "" : "";
  els.memberEditBonusDamage.value = isEdit ? String(sourceMember.bonus_damage || 0) : "0";
  els.memberEditDamageReduction.value = isEdit ? String(sourceMember.damage_reduction || 0) : "0";
  els.memberEditNote.value = isEdit ? sourceMember.note || "" : "";
  els.memberEditModal.classList.remove("hidden");
  window.setTimeout(() => els.memberEditName?.focus(), 0);
}

function closeMemberEditModal() {
  els.memberEditModal?.classList.add("hidden");
  els.memberEditForm?.reset();
}

async function handleGuildEditSubmit(event) {
  event.preventDefault();
  const guildKey = els.guildEditKey?.value || "";
  if (!guildKey) return;
  try {
    await updateGuildRecord(guildKey, {
      guild: els.guildEditName.value.trim(),
      name: els.guildEditLeader.value.trim(),
      guild_power: getGuildManualPower(state.members.filter((item) => buildGuildKey(item) === guildKey)),
    });
    closeGuildEditModal();
    await refreshAll();
    toast("妖盟更新成功");
  } catch (error) {
    toast(error.message);
  }
}

function handleModalDismiss(event) {
  const target = event.target.closest("[data-close-modal]");
  if (!(target instanceof HTMLElement)) return;
  if (target.dataset.closeModal === "guild-edit") {
    closeGuildEditModal();
    return;
  }
  if (target.dataset.closeModal === "member-edit") {
    closeMemberEditModal();
  }
}

function handleModalKeydown(event) {
  if (event.key === "Escape" && !els.guildEditModal?.classList.contains("hidden")) {
    closeGuildEditModal();
  }
  if (event.key === "Escape" && !els.memberEditModal?.classList.contains("hidden")) {
    closeMemberEditModal();
  }
}

async function handleMemberEditSubmit(event) {
  event.preventDefault();
  const guildKey = els.memberEditGuildKey.value;
  const id = els.memberEditId.value;
  const guildMember = state.members.find((item) => buildGuildKey(item) === guildKey);
  if (!guildMember) {
    toast("没有找到对应妖盟");
    return;
  }
  const payload = {
    alliance: guildMember.alliance,
    hill: guildMember.hill,
    guild_code: guildMember.guild_code || "",
    guild_prefix: guildMember.guild_prefix || "",
    guild_power: Number(guildMember.guild_power || 0),
    guild: guildMember.guild,
    name: els.memberEditName.value.trim(),
    role: els.memberEditRole.value.trim(),
    realm: els.memberEditRealm.value.trim(),
    power: Number(els.memberEditPower.value || 0),
    hp: 0,
    attack: 0,
    defense: 0,
    speed: Number(els.memberEditSpeed.value || 0),
    bonus_damage: Number(els.memberEditBonusDamage.value || 0),
    damage_reduction: Number(els.memberEditDamageReduction.value || 0),
    pet: els.memberEditPet.value.trim(),
    note: els.memberEditNote.value.trim(),
  };
  try {
    const url = id ? `/api/members/${id}` : "/api/members";
    const method = id ? "PUT" : "POST";
    await request(url, { method, body: JSON.stringify(payload) });
    closeMemberEditModal();
    await refreshAll();
    switchView("guildDetail");
    toast(id ? "成员更新成功" : "成员新增成功");
  } catch (error) {
    toast(error.message);
  }
}

function handleGuildDetailToolbarAction(event) {
  const target = event.target.closest("[data-action]");
  if (!(target instanceof HTMLElement)) return;
  if (target.dataset.action === "go-login") {
    switchView("login");
    return;
  }
  if (target.dataset.action === "add-member" && state.selectedGuild) {
    openMemberEditModal(null, state.selectedGuild);
  }
}

function handleGuildDetailAction(event) {
  const target = event.target.closest("[data-action]");
  if (!(target instanceof HTMLElement)) return;
  const memberId = target.dataset.id;
  if (!memberId) return;
  const member = state.members.find((item) => String(item.id) === memberId);
  if (!member) return;
  if (target.dataset.action === "edit-detail-member") {
    openMemberEditModal(member, buildGuildKey(member));
    return;
  }
  if (target.dataset.action === "delete-detail-member" && confirm(`确定删除成员 ${member.name} 吗？`)) {
    request(`/api/members/${member.id}`, { method: "DELETE" })
      .then(async () => {
        await refreshAll();
        switchView("guildDetail");
        toast("成员已删除");
      })
      .catch((error) => toast(error.message));
  }
}

function setGuildFormEditMode(isEdit) {
  for (const id of ["memberAlliance", "memberGuildCode", "memberGuildPrefix", "memberNote"]) {
    const field = document.querySelector(`#${id}`);
    if (field) {
      field.readOnly = isEdit;
      field.disabled = false;
    }
  }
}

function handleAdminMemberAction(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const { action, guildKey } = target.dataset;
  if (!action || !guildKey) return;
  const guildMembers = state.members.filter((item) => buildGuildKey(item) === guildKey);
  const leader = guildMembers.find((item) => item.role === "盟主") || guildMembers[0];
  if (!leader) return;

  if (action === "edit-member") {
    openGuildEditModal(leader, guildKey);
    return;
  }

  if (action === "delete-member" && confirm(`确定删除妖盟 ${getGuildDisplayName(leader)} 吗？`)) {
    Promise.all(guildMembers.map((member) => request(`/api/members/${member.id}`, { method: "DELETE" })))
      .then(async () => {
        await refreshAll();
        toast("妖盟已删除");
      })
      .catch((error) => toast(error.message));
  }
}

function handleAdminAnnouncementAction(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const { action, id } = target.dataset;
  if (!action || !id) return;
  const item = state.announcements.find((announcement) => String(announcement.id) === id);
  if (!item) return;

  if (action === "edit-announcement") {
    document.querySelector("#announcementId").value = item.id;
    document.querySelector("#announcementCategory").value = item.category;
    document.querySelector("#announcementTitle").value = item.title;
    document.querySelector("#announcementContent").value = item.content;
    els.announcementFormTitle.textContent = `编辑动态 · ${item.title}`;
    els.announcementSubmitBtn.textContent = "更新内容";
    state.currentView = "announcementAdmin";
    renderView();
    return;
  }

  if (action === "delete-announcement" && confirm(`确定删除 ${item.title} 吗？`)) {
    request(`/api/announcements/${id}`, { method: "DELETE" })
      .then(async () => {
        await Promise.all([loadDashboard(), fetchAnnouncements()]);
        toast("内容已删除");
      })
      .catch((error) => toast(error.message));
  }
}

document.addEventListener("click", (event) => {
  const genericPageButton = event.target.closest("[data-pagination-kind]");
  if (genericPageButton instanceof HTMLElement) {
    const kind = genericPageButton.dataset.paginationKind;
    const action = genericPageButton.dataset.pageAction;
    if (kind && action) {
      if (kind === "ranking-page") {
        state.rankingPage = action === "prev" ? Math.max(1, state.rankingPage - 1) : state.rankingPage + 1;
        renderRanking();
      }
      if (kind === "guild-detail-page") {
        state.guildDetailPage = action === "prev" ? Math.max(1, state.guildDetailPage - 1) : state.guildDetailPage + 1;
        renderGuildDetail();
      }
    }
    return;
  }

  const pageButton = event.target.closest("[data-hill-page]");
  if (pageButton instanceof HTMLElement) {
    const hillName = pageButton.dataset.hillPage;
    const action = pageButton.dataset.pageAction;
    if (hillName && action) {
      const currentPage = state.guildPageByHill[hillName] || 1;
      state.guildPageByHill[hillName] = action === "prev" ? Math.max(1, currentPage - 1) : currentPage + 1;
      renderGuildSummary();
    }
    return;
  }

  const openGuildButton = event.target.closest("[data-open-guild]");
  if (openGuildButton instanceof HTMLElement) {
    state.selectedGuild = openGuildButton.dataset.openGuild || null;
    state.guildDetailPage = 1;
    state.guildDetailSearch = "";
    state.guildDetailRoleFilter = "all";
    switchView("guildDetail");
    return;
  }

  const target = event.target.closest("[data-view-ranking]");
  if (!(target instanceof HTMLElement)) return;
  state.currentView = "ranking";
  state.rankingGuildFilter = target.dataset.viewRanking || "all";
  renderGuildFilters();
  renderView();
  renderRanking();
});

const sorters = {
  "power-desc": (a, b) => Number(b.power || 0) - Number(a.power || 0),
  "power-asc": (a, b) => Number(a.power || 0) - Number(b.power || 0),
  "name-asc": (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-CN"),
};

function newerDate(currentValue, nextValue) {
  if (!currentValue) return nextValue;
  if (!nextValue) return currentValue;
  return new Date(nextValue) > new Date(currentValue) ? nextValue : currentValue;
}

function getGuildManualPower(members) {
  return members.reduce((maxValue, member) => Math.max(maxValue, Number(member.guild_power || 0)), 0);
}

function getGuildPower(guild) {
  return Number(guild.customPower || 0) || Number(guild.power || 0);
}

function buildGuildKey(member) {
  return [member.guild_code || "", member.guild_prefix || "", member.guild || ""].join("|");
}

function getGuildDisplayName(member) {
  return [member.guild_code || "", member.guild_prefix || "", member.guild || ""].filter(Boolean).join(" ");
}

function getGuildLabelFromKey(guildKey, hills) {
  for (const hill of hills) {
    const guild = hill.guilds.find((item) => item.key === guildKey);
    if (guild) return guild.displayName;
  }
  return guildKey.split("|").filter(Boolean).join(" ");
}

function matchKeyword(text, keyword) {
  return String(text || "").toLowerCase().includes(String(keyword || "").toLowerCase());
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toast(message) {
  const banner = document.createElement("div");
  banner.className = "status-banner";
  banner.textContent = message;
  document.body.appendChild(banner);
  window.setTimeout(() => banner.remove(), 2200);
}
