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
    state.hillBrowsePage = 1;
  }
  if (state.guildFilter !== "all" && !guildNames.includes(state.guildFilter)) {
    state.guildFilter = "all";
    state.hillBrowsePage = 1;
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

  const visibleGuilds = hills
    .flatMap((hill) => hill.guilds || [])
    .filter((guild) => state.guildFilter === "all" || guild.key === state.guildFilter);
  const visibleMembers = visibleGuilds.reduce((sum, guild) => {
    if (typeof guild.count === "number") {
      return sum + guild.count;
    }
    return sum + state.members.filter((member) => buildGuildKey(member) === guild.key).length;
  }, 0);
  if (els.filterSummaryLabel) {
    els.filterSummaryLabel.textContent = state.guildFilter === "all" ? "全部妖盟" : getGuildLabelFromKey(state.guildFilter, hills);
  }
  if (els.filterGuildCount) {
    els.filterGuildCount.textContent = String(visibleGuilds.length);
  }
  if (els.filterMemberCount) {
    els.filterMemberCount.textContent = String(visibleMembers);
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
        <h2>${escapeHtml(hill.name)}</h2>
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
        <span class="guild-card__mark">${guild.rank <= 3 ? "TOP" : `NO.${guild.rank}`}</span>
      </div>
      <p class="guild-card__power-label">总战力 <strong>${formatNumber(getGuildPower(guild))}</strong></p>
      <div class="guild-card__leaders">
        <div class="guild-card__leader">
          <span>车头1：</span>
          <strong>${first ? escapeHtml(first.name) : "暂无"}</strong>
          <b>${first ? formatNumber(first.power) : "-"}</b>
        </div>
        <div class="guild-card__leader">
          <span>车头2：</span>
          <strong>${second ? escapeHtml(second.name) : "暂无"}</strong>
          <b>${second ? formatNumber(second.power) : "-"}</b>
        </div>
      </div>
      <p class="guild-card__update">最后更新：${escapeHtml(guild.updatedAt || "暂无记录")}</p>
      <button type="button" class="guild-card__action" data-open-guild="${escapeHtml(guild.key)}">查看妖盟成员</button>
    </article>
  `;
}

function renderGuildDetail() {
  if (!els.guildDetailList || !els.guildDetailTitle || !els.guildDetailMeta) return;
  if (!state.selectedGuild) {
    els.guildDetailTitle.textContent = "妖盟详情";
    els.guildDetailMeta.textContent = "点击妖盟卡片查看完整成员信息";
    if (els.guildDetailActions) els.guildDetailActions.innerHTML = "";
    if (els.guildDetailSearch) els.guildDetailSearch.value = "";
    if (els.guildDetailRoleFilter) els.guildDetailRoleFilter.innerHTML = `<option value="all">全部等级</option>`;
    els.guildDetailList.innerHTML = `<article class="empty-card">请选择一个妖盟查看详情。</article>`;
    return;
  }

  const detail = getGuildDetail(state.selectedGuild);
  if (!detail) {
    els.guildDetailTitle.textContent = "妖盟详情";
    els.guildDetailMeta.textContent = "当前妖盟未找到";
    if (els.guildDetailActions) els.guildDetailActions.innerHTML = "";
    if (els.guildDetailSearch) els.guildDetailSearch.value = "";
    if (els.guildDetailRoleFilter) els.guildDetailRoleFilter.innerHTML = `<option value="all">全部等级</option>`;
    els.guildDetailList.innerHTML = `<article class="empty-card">没有找到该妖盟的数据。</article>`;
    return;
  }

  els.guildDetailTitle.textContent = detail.name;
  els.guildDetailMeta.textContent = `${detail.hill} · ${detail.members.length} 名成员 · 总战力 ${formatNumber(detail.power)}`;
  renderGuildDetailFilters(detail.members);
  const detailAlliance = detail.members[0]?.alliance || detail.hill || "";
  const canManageCurrentGuild = canManageAlliance(detailAlliance) || Boolean(state.me?.is_admin);
  if (els.guildDetailActions) {
    els.guildDetailActions.innerHTML = canManageCurrentGuild
      ? `<button type="button" class="primary-btn" data-action="import-excel">导入 Excel</button>
         ${state.me?.is_admin ? `<button type="button" class="ghost-btn" data-action="export-members">导出成员</button>` : ""}
         <button type="button" class="ghost-btn" data-action="add-member">新增成员</button>`
      : `<button type="button" class="ghost-btn" data-action="go-login">登录后可申请认证</button>`;
  }
  if (els.guildDetailActions && state.me.authenticated && !canManageCurrentGuild) {
    const toolbarLabel = currentUserRole() === "AllianceAdmin"
      ? "已登录，可在下方审核成员认证"
      : "已登录，可在下方申请成员认证";
    els.guildDetailActions.innerHTML = `<span class="detail-toolbar-note">${toolbarLabel}</span>`;
  }
  const filteredMembers = getFilteredGuildMembers(detail.members);
  if (!filteredMembers.length) {
    els.guildDetailList.innerHTML = `<article class="empty-card">没有找到符合条件的成员。</article>`;
    return;
  }
  const page = paginateItems(filteredMembers, state.guildDetailPage, 10);
  state.guildDetailPage = page.currentPage;
  els.guildDetailList.innerHTML = page.items.map((member, index) => `
    <article class="detail-member-card">
      <div class="detail-member-card__rank">${(page.currentPage - 1) * page.pageSize + index + 1}</div>
      <div class="detail-member-card__body">
        <div class="detail-member-card__compact">
          <div class="detail-member-card__info">
            <div class="detail-member-card__top">
              <div>
                <strong>${escapeHtml(member.name)}</strong>
                <p>等级 ${escapeHtml(member.role || "-")} · ${escapeHtml(member.realm || "-")}</p>
              </div>
            </div>
            <div class="detail-member-card__status">
              ${renderMemberVerificationState(member)}
            </div>
            <div class="detail-member-card__stats">
              <span>境界 ${escapeHtml(member.realm || "-")}</span>
              <span>战力 ${formatNumber(member.power)}</span>
              <span>敏捷 ${formatOptionalMetric(member.speed)}</span>
              <span>灵兽 ${escapeHtml(member.pet || "-")}</span>
              <span>增伤 ${formatOptionalMetric(member.bonus_damage, "%")}</span>
              <span>减伤 ${formatOptionalMetric(member.damage_reduction, "%")}</span>
            </div>
          </div>
          <div class="detail-member-card__media">
            ${member.screenshot_url ? `
              <button type="button" class="member-screenshot-card member-screenshot-card--compact" data-action="preview-screenshot" data-id="${member.id}">
                <img src="${escapeHtml(member.screenshot_url)}" alt="${escapeHtml(member.name)} 的游戏截图">
              </button>
            ` : `
              <div class="member-screenshot-placeholder member-screenshot-placeholder--compact">暂无截图</div>
            `}
          </div>
        </div>
        ${canManageAlliance(detail.alliance || detail.hill || "") ? `
          <div class="detail-member-card__actions">
            <button type="button" class="action-btn action-btn--upload" data-action="upload-screenshot" data-id="${member.id}">${member.screenshot_url ? "替换截图" : "上传截图"}</button>
            ${member.screenshot_url ? `<button type="button" class="action-btn action-btn--preview" data-action="preview-screenshot" data-id="${member.id}">预览截图</button>` : ""}
            <button type="button" class="action-btn action-btn--edit" data-action="edit-detail-member" data-id="${member.id}">编辑</button>
            <button type="button" class="action-btn action-btn--delete" data-action="delete-detail-member" data-id="${member.id}">删除</button>
          </div>
        ` : ""}
      </div>
    </article>
  `).join("") + renderSimplePagination("guild-detail-page", page);
  injectScreenshotDeleteButtons();
}

function getGuildDetail(guildKey) {
  const members = state.members
    .filter((member) => buildGuildKey(member) === guildKey)
    .sort((a, b) => Number(b.power || 0) - Number(a.power || 0));
  const dashboardGuild = (state.dashboard?.guilds || []).find((guild) => {
    const key = guild.key || [guild.code || "", guild.prefix || "", guild.name || ""].join("|");
    return key === guildKey;
  });
  if (!members.length && !dashboardGuild) return null;

  const detailName = members.length
    ? getGuildDisplayName(members[0])
    : (dashboardGuild?.display_name || dashboardGuild?.displayName || [dashboardGuild?.code || "", dashboardGuild?.prefix || "", dashboardGuild?.name || ""].filter(Boolean).join(" "));
  const detailHill = members[0]?.hill || dashboardGuild?.hill || dashboardGuild?.alliance || "默认联盟";
  const detailPower = members.length
    ? (getGuildManualPower(members) || members.reduce((sum, member) => sum + Number(member.power || 0), 0))
    : Number(dashboardGuild?.custom_power || dashboardGuild?.customPower || dashboardGuild?.power || 0);

  return {
    key: guildKey,
    name: detailName,
    hill: detailHill,
    power: detailPower,
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
      `<option value="all">全部等级</option>`,
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
  const pageSize = 3;
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
    const totalPages = Math.max(1, Math.ceil(hill.guilds.length / 3));
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

  for (const hill of state.dashboard?.hills || []) {
    if (!hillMap.has(hill.name)) {
      hillMap.set(hill.name, {
        name: hill.name,
        power: Number(hill.power || 0),
        guilds: new Map(),
      });
    }
    const hillEntry = hillMap.get(hill.name);
    hillEntry.power = Math.max(Number(hillEntry.power || 0), Number(hill.power || 0));
    for (const guild of hill.guilds || []) {
      const dashboardGuildKey = guild.key || [guild.code || "", guild.prefix || "", guild.name || ""].join("|");
      if (!dashboardGuildKey) continue;
      if (!hillEntry.guilds.has(dashboardGuildKey)) {
        hillEntry.guilds.set(dashboardGuildKey, {
          key: dashboardGuildKey,
          name: guild.name || "未命名妖盟",
          displayName: guild.displayName || guild.display_name || guild.name || "未命名妖盟",
          code: guild.code || "",
          prefix: guild.prefix || "",
          hill: hill.name,
          count: Number(guild.count || 0),
          power: Number(guild.power || 0),
          customPower: Number(guild.customPower || guild.custom_power || 0),
          updatedAt: guild.updatedAt || guild.updated_at || "",
          leaders: [],
        });
        continue;
      }
      const existingGuild = hillEntry.guilds.get(dashboardGuildKey);
      existingGuild.customPower = Math.max(Number(existingGuild.customPower || 0), Number(guild.customPower || guild.custom_power || 0));
      existingGuild.power = Math.max(Number(existingGuild.power || 0), Number(guild.power || 0));
      existingGuild.updatedAt = newerDate(existingGuild.updatedAt, guild.updatedAt || guild.updated_at || "");
    }
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
    fragment.querySelector(".ranking-item__meta").textContent = `${member.hill || "默认联盟"} · ${getGuildDisplayName(member)} · 等级 ${member.role || "-"} · ${member.realm || "-"}`;    fragment.querySelector(".ranking-item__power").textContent = formatNumber(member.power);
    els.rankingList.appendChild(fragment);
  });
  els.rankingList.insertAdjacentHTML("beforeend", renderSimplePagination("ranking-page", page));
}

function renderFeeds() {
  const announcements = state.announcements.filter((item) => ["公告", "鍏憡"].includes(item.category));
  const melonPosts = state.announcements.filter((item) => ["瓜棚", "鐡滄"].includes(item.category));
  const announcementPage = paginateItems(announcements, state.announcementPage, 5);
  const melonPage = paginateItems(melonPosts, state.melonPage, 5);
  state.announcementPage = announcementPage.currentPage;
  state.melonPage = melonPage.currentPage;
  if (els.announcementList) {
    els.announcementList.innerHTML = renderFeedGroup(announcementPage.items, "暂无公告内容")
      + renderSimplePagination("announcement-page", announcementPage);
  }
  if (els.melonList) {
    els.melonList.innerHTML = renderFeedGroup(melonPage.items, "暂无瓜棚内容")
      + renderSimplePagination("melon-page", melonPage);
  }
}

