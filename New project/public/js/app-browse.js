function renderView() {
  els.viewButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.currentView);
  });
  els.viewPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.panel === state.currentView);
  });
  renderProfilePage();
  renderGuildDetail();
}

function switchView(view) {
  state.currentView = view;
  renderView();
  if (view === "profile") {
    void touchCurrentProfileMember();
  }
}

function showBrowseView() {
  if (state.currentView !== "guilds") {
    switchView("guilds");
  }
}

function getCurrentProfileMember() {
  const linkedId = state.me?.user?.member_id || state.me?.user?.member;
  if (!linkedId) return null;
  return state.members.find((member) => String(member.id) === String(linkedId)) || null;
}

function getLikelyProfileMember() {
  const username = String(state.me?.user?.username || "").trim();
  if (!username) return null;
  return state.members.find((member) => String(member.name || "").trim() === username) || null;
}

function openGuildFromProfile(member) {
  if (!member) return;
  state.selectedGuild = buildGuildKey(member);
  state.guildDetailSearch = "";
  state.guildDetailRoleFilter = "all";
  state.guildDetailPage = 1;
  switchView("guildDetail");
}

function handleProfileAction(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const actionTarget = target.closest("[data-action]");
  if (actionTarget instanceof HTMLElement && actionTarget.dataset.action === "preview-screenshot") {
    const memberId = actionTarget.dataset.id;
    const member = state.members.find((item) => String(item.id) === String(memberId));
    if (member) {
      openScreenshotPreview(member);
    }
    return;
  }
  const profileActionTarget = target.closest("[data-profile-action]");
  if (!(profileActionTarget instanceof HTMLElement)) return;
  const action = profileActionTarget.dataset.profileAction;
  if (!action) return;

  if (action === "go-auth") {
    window.location.href = "/auth.html";
    return;
  }

  const member = getCurrentProfileMember() || getLikelyProfileMember();
  if (action === "open-guild" && member) {
    openGuildFromProfile(member);
    return;
  }
  if (action === "open-cert" && member) {
    openCertRequestModal(member.id);
    return;
  }
  if (action === "upload-screenshot") {
    triggerOwnScreenshotUpload();
    return;
  }
  if (action === "delete-screenshot") {
    deleteOwnScreenshot();
    return;
  }
  if (action === "upload-avatar") {
    triggerOwnAvatarUpload();
    return;
  }
  if (action === "delete-avatar") {
    deleteOwnAvatar();
  }
}

async function touchCurrentProfileMember() {
  const member = getCurrentProfileMember();
  if (!member) return;
  try {
    const result = await request("/api/profile/me/touch", {
      method: "POST",
      body: "{}",
    });
    if (result?.item) {
      state.members = state.members.map((item) => (String(item.id) === String(result.item.id) ? { ...item, ...result.item } : item));
      if (state.currentView === "profile") {
        renderProfilePage();
      }
    }
  } catch (error) {
    console.error("Failed to refresh profile updated_at:", error);
  }
}

async function handleProfileSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== "profileEditForm") return;
  event.preventDefault();
  const member = getCurrentProfileMember();
  if (!member) {
    toast("当前没有可编辑的成员资料");
    return;
  }
  const formData = new FormData(form);
  const payload = {
    name: String(formData.get("name") || "").trim(),
    role: String(formData.get("role") || "").trim(),
    realm: String(formData.get("realm") || "").trim(),
    power: String(formData.get("power") || "").trim(),
    hp: String(formData.get("hp") || "").trim(),
    attack: String(formData.get("attack") || "").trim(),
    defense: String(formData.get("defense") || "").trim(),
    speed: String(formData.get("speed") || "").trim(),
    bonus_damage: String(formData.get("bonus_damage") || "").trim(),
    damage_reduction: String(formData.get("damage_reduction") || "").trim(),
    pet: String(formData.get("pet") || "").trim(),
    note: String(formData.get("note") || "").trim(),
  };
  try {
    await request("/api/profile/me", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    await refreshAll();
    toast("个人资料已更新");
  } catch (error) {
    toast(error.message);
  }
}

function triggerOwnScreenshotUpload() {
  const member = getCurrentProfileMember();
  if (!member || !els.memberScreenshotInput) {
    toast("当前没有可上传截图的成员资料");
    return;
  }
  state.pendingProfileUploadType = "screenshot";
  state.pendingScreenshotMemberId = member.id;
  els.memberScreenshotInput.value = "";
  els.memberScreenshotInput.click();
}

function triggerOwnAvatarUpload() {
  if (!els.profileAvatarInput) return;
  state.pendingProfileUploadType = "avatar";
  els.profileAvatarInput.value = "";
  els.profileAvatarInput.click();
}

async function handleProfileAvatarSelected(event) {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;
  const formData = new FormData();
  formData.append("avatar", file);
  try {
    await request("/api/profile/me/avatar", {
      method: "POST",
      body: formData,
    });
    await refreshAll();
    toast("头像上传成功");
  } catch (error) {
    toast(error.message);
  } finally {
    input.value = "";
    state.pendingProfileUploadType = "";
  }
}

async function deleteOwnScreenshot() {
  const member = getCurrentProfileMember();
  if (!member?.screenshot_url) {
    toast("当前还没有上传截图");
    return;
  }
  try {
    await request("/api/profile/me/screenshot", { method: "DELETE" });
    await refreshAll();
    toast("截图已删除");
  } catch (error) {
    toast(error.message);
  }
}

async function deleteOwnAvatar() {
  if (!state.me?.user?.avatar_url) {
    toast("当前还没有上传头像");
    return;
  }
  try {
    await request("/api/profile/me/avatar", { method: "DELETE" });
    await refreshAll();
    toast("头像已删除");
  } catch (error) {
    toast(error.message);
  }
}

function renderProfilePage() {
  if (!els.profilePage) return;

  if (!state.me?.authenticated) {
    els.profilePage.innerHTML = `
      <article class="empty-card profile-empty-card">
        <h3>还没有登录</h3>
        <p>登录后可以在这里查看自己的成员资料、当前妖盟、战力、灵兽和认证状态。</p>
        <button type="button" class="primary-btn profile-cta-btn" data-profile-action="go-auth">去登录</button>
      </article>
    `;
    return;
  }

  const member = getCurrentProfileMember();
  const likelyMember = getLikelyProfileMember();

  if (state.me?.is_admin && !member) {
    const hills = getDerivedHills();
    const guildCount = hills.reduce((sum, hill) => sum + hill.guilds.length, 0);
    els.profilePage.innerHTML = `
      <section class="profile-shell">
        <article class="profile-hero">
          <div class="profile-hero__main">
            <p class="panel-eyebrow">Admin Account</p>
            <h3>${escapeHtml(state.me.user?.display_name || state.me.user?.username || "管理员")}</h3>
            <p class="profile-hero__meta">账号：${escapeHtml(state.me.user?.username || "-")} · 身份：超级管理员</p>
            <p class="profile-hero__desc">当前账号未绑定游戏成员，因此这里展示的是管理账号概览。</p>
          </div>
        </article>
        <div class="profile-stat-grid">
          <article class="profile-stat-card"><span>成员总数</span><strong>${formatNumber(state.members.length || 0)}</strong></article>
          <article class="profile-stat-card"><span>妖盟数量</span><strong>${formatNumber(guildCount)}</strong></article>
          <article class="profile-stat-card"><span>联盟数量</span><strong>${formatNumber(hills.length)}</strong></article>
          <article class="profile-stat-card"><span>动态数量</span><strong>${formatNumber(state.announcements.length || 0)}</strong></article>
        </div>
      </section>
    `;
    return;
  }

  if (!member) {
    const hintText = likelyMember
      ? `检测到可能同名成员：${likelyMember.name}，你可以先进入该妖盟详情申请认证绑定。`
      : "当前账号还没有绑定成员，可以到妖盟详情里申请认证后再回来查看。";
    els.profilePage.innerHTML = `
      <article class="empty-card profile-empty-card">
        <h3>${escapeHtml(state.me.user?.display_name || state.me.user?.username || "当前用户")}</h3>
        <p>${escapeHtml(hintText)}</p>
        <div class="profile-empty-actions">
          ${likelyMember ? `<button type="button" class="primary-btn profile-cta-btn" data-profile-action="open-guild">前往我的妖盟</button>` : ""}
          ${likelyMember ? `<button type="button" class="ghost-btn" data-profile-action="open-cert">申请认证</button>` : ""}
        </div>
      </article>
    `;
    return;
  }

  const avatarUrl = state.me?.user?.avatar_url || "";
  const avatarBlock = avatarUrl
    ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(member.name)} 的头像" class="profile-avatar-image">`
    : `<div class="profile-avatar-text">${escapeHtml(String(member.name || "我").slice(0, 2))}</div>`;
  const screenshotBlock = member.screenshot_url
    ? `
      <button type="button" class="member-screenshot-card profile-screenshot-card" data-action="preview-screenshot" data-id="${member.id}">
        <img src="${escapeHtml(member.screenshot_url)}" alt="${escapeHtml(member.name)} 的游戏截图">
        <span>预览我的截图</span>
      </button>
    `
    : `<div class="member-screenshot-placeholder profile-screenshot-placeholder">暂未上传截图</div>`;

  els.profilePage.innerHTML = `
    <section class="profile-shell">
      <article class="profile-hero">
        <div class="profile-hero__main">
          <p class="panel-eyebrow">My Profile</p>
          <h3>${escapeHtml(member.name || state.me.user?.username || "我的主页")}</h3>
          <p class="profile-hero__meta">${escapeHtml(member.alliance || member.hill || "-")} · ${escapeHtml(getGuildDisplayName(member) || "-")} · 等级 ${escapeHtml(member.role || "-")}</p>
          <p class="profile-hero__desc">${escapeHtml(member.note || "这里会展示你的成员简介、培养方向和当前定位。")}</p>
          <div class="profile-chip-row">
            <span class="profile-chip">境界 ${escapeHtml(member.realm || "-")}</span>
            <span class="profile-chip">灵兽 ${escapeHtml(member.pet || "-")}</span>
            <span class="profile-chip">认证 ${member.verified ? "已完成" : "待认证"}</span>
          </div>
        </div>
        <div class="profile-hero__side">
          <div class="profile-avatar">${avatarBlock}</div>
          <div class="profile-account-card">
            <span>账号</span>
            <strong>${escapeHtml(state.me.user?.display_name || state.me.user?.username || "-")}</strong>
            <small>${escapeHtml(currentUserRole())}</small>
          </div>
          <div class="profile-empty-actions">
            <button type="button" class="ghost-btn" data-profile-action="upload-avatar">${avatarUrl ? "替换头像" : "上传头像"}</button>
            ${avatarUrl ? `<button type="button" class="ghost-btn" data-profile-action="delete-avatar">删除头像</button>` : ""}
          </div>
        </div>
      </article>

      <form id="profileEditForm" class="profile-edit-grid">
        <article class="profile-info-card profile-info-card--full profile-save-card">
          <div class="profile-save-row">
            <div>
              <h4>保存修改</h4>
              <p class="profile-save-hint">修改完资料后，直接点右侧这个按钮就会保存。</p>
            </div>
            <button type="submit" class="primary-btn profile-cta-btn">保存资料</button>
          </div>
        </article>

        <article class="profile-info-card">
          <h4>基础资料</h4>
          <div class="profile-form-grid">
            <label><span>联盟</span><input type="text" value="${escapeHtml(member.alliance || member.hill || "-")}" readonly></label>
            <label><span>妖盟</span><input type="text" value="${escapeHtml(getGuildDisplayName(member) || "-")}" readonly></label>
            <label><span>成员编号</span><input type="text" value="${escapeHtml(String(member.id || "-"))}" readonly></label>
            <label><span>成员昵称</span><input name="name" type="text" value="${escapeHtml(member.name || "")}"></label>
            <label><span>等级</span><input name="role" type="text" value="${escapeHtml(member.role || "")}"></label>
            <label><span>境界</span><input name="realm" type="text" value="${escapeHtml(member.realm || "")}"></label>
            <label><span>灵兽</span><input name="pet" type="text" value="${escapeHtml(member.pet || "")}"></label>
            <label><span>认证状态</span><input type="text" value="${member.verified ? "已认证" : "未认证"}" readonly></label>
          </div>
        </article>

        <article class="profile-info-card">
          <h4>数值属性</h4>
          <div class="profile-form-grid">
            <label><span>战力</span><input name="power" type="text" value="${escapeHtml(formatNumber(member.power || 0))}"></label>
            <label><span>气血</span><input name="hp" type="text" value="${escapeHtml(formatNumber(member.hp || 0))}"></label>
            <label><span>攻击</span><input name="attack" type="text" value="${escapeHtml(formatNumber(member.attack || 0))}"></label>
            <label><span>防御</span><input name="defense" type="text" value="${escapeHtml(formatNumber(member.defense || 0))}"></label>
            <label><span>敏捷</span><input name="speed" type="text" value="${escapeHtml(formatNumber(member.speed || 0))}"></label>
            <label><span>增伤</span><input name="bonus_damage" type="text" value="${escapeHtml(formatOptionalMetric(member.bonus_damage).replace(/-$/, ""))}"></label>
            <label><span>减伤</span><input name="damage_reduction" type="text" value="${escapeHtml(formatOptionalMetric(member.damage_reduction).replace(/-$/, ""))}"></label>
          </div>
        </article>

        <article class="profile-info-card profile-info-card--full">
          <h4>个人介绍</h4>
          <label class="profile-form-grid__full">
            <span>备注</span>
            <textarea name="note" rows="5" placeholder="写点你的定位、常用流派、培养方向或招人说明">${escapeHtml(member.note || "")}</textarea>
          </label>
          <div class="profile-empty-actions">
            <button type="submit" class="primary-btn profile-cta-btn">保存资料</button>
            <button type="button" class="ghost-btn" data-profile-action="open-guild">查看我的妖盟</button>
            ${!member.verified ? `<button type="button" class="ghost-btn" data-profile-action="open-cert">认证记录</button>` : ""}
          </div>
        </article>
      </form>

      <div class="profile-detail-grid">
        <article class="profile-media-card">
          <h4>个人截图</h4>
          ${screenshotBlock}
          <div class="profile-empty-actions">
            <button type="button" class="ghost-btn" data-profile-action="upload-screenshot">${member.screenshot_url ? "替换截图" : "上传截图"}</button>
            ${member.screenshot_url ? `<button type="button" class="ghost-btn" data-profile-action="delete-screenshot">删除截图</button>` : ""}
          </div>
        </article>
      </div>
    </section>
  `;
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
  const canManageCurrentGuild = canManageGuildScope(detail.key) || Boolean(state.me?.is_admin);
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
        ${canManageGuildScope(member) ? `
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

