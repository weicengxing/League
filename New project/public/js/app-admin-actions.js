function openDangerConfirm({
  title = "危险操作确认",
  message = "此操作不可撤销，请再次确认。",
  confirmText = "确认继续",
} = {}) {
  if (!els.dangerConfirmModal) return Promise.resolve(false);
  if (els.dangerConfirmTitle) els.dangerConfirmTitle.textContent = title;
  if (els.dangerConfirmMessage) els.dangerConfirmMessage.textContent = message;
  if (els.dangerConfirmSubmitBtn) els.dangerConfirmSubmitBtn.textContent = confirmText;
  els.dangerConfirmModal.classList.remove("hidden");
  return new Promise((resolve) => {
    pendingDangerConfirmResolver = resolve;
  });
}

function handleModalDismiss(event) {
  const rawTarget = event.target;
  if (!(rawTarget instanceof Element)) return;
  const target = rawTarget.closest("[data-close-modal]");
  if (!(target instanceof HTMLElement)) return;
  if (target.dataset.closeModal === "guild-edit") {
    closeGuildEditModal();
    return;
  }
  if (target.dataset.closeModal === "member-edit") {
    closeMemberEditModal();
    return;
  }
  if (target.dataset.closeModal === "hill-edit") {
    closeHillEditModal();
    return;
  }
  if (target.dataset.closeModal === "screenshot-preview") {
    closeScreenshotPreviewModal();
    return;
  }
  if (target.dataset.closeModal === "cert-request") {
    closeCertRequestModal();
    return;
  }
  if (target.dataset.closeModal === "role-request") {
    closeRoleRequestModal();
    return;
  }
  if (target.dataset.closeModal === "role-apply") {
    closeRoleApplyModal();
    return;
  }
  if (target.dataset.closeModal === "feed-preview") {
    closeFeedPreviewModal();
    return;
  }
  if (target.dataset.closeModal === "announcement-edit") {
    closeAnnouncementEditModal();
    return;
  }
  if (target.dataset.closeModal === "danger-confirm") {
    resolveDangerConfirm(false);
    return;
  }
  if (target.dataset.closeModal === "notice") {
    closeNoticeModal();
  }
}

async function handleGuildExcelFileSelected(event) {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("alliance", state.dashboard?.alliance_name || "🔮联盟");

  try {
    const result = await request("/api/guilds/import", {
      method: "POST",
      body: formData,
    });
    await refreshAll();
    let message = result.message || "妖盟导入成功";
    if (result.skipped_existing > 0) {
      message += `（已存在跳过 ${result.skipped_existing} 个）`;
    }
    toast(message);
  } catch (error) {
    toast(error.message);
  } finally {
    input.value = "";
  }
}

function handleModalKeydown(event) {
  if (event.key === "Escape" && !els.guildEditModal?.classList.contains("hidden")) {
    closeGuildEditModal();
    return;
  }
  if (event.key === "Escape" && !els.roleApplyModal?.classList.contains("hidden")) {
    closeRoleApplyModal();
    return;
  }
  if (event.key === "Escape" && !els.roleRequestModal?.classList.contains("hidden")) {
    closeRoleRequestModal();
    return;
  }
  if (event.key === "Escape" && !els.certRequestModal?.classList.contains("hidden")) {
    closeCertRequestModal();
    return;
  }
  if (event.key === "Escape" && !els.memberEditModal?.classList.contains("hidden")) {
    closeMemberEditModal();
    return;
  }
  if (event.key === "Escape" && !els.hillEditModal?.classList.contains("hidden")) {
    closeHillEditModal();
    return;
  }
  if (event.key === "Escape" && !els.screenshotPreviewModal?.classList.contains("hidden")) {
    closeScreenshotPreviewModal();
  }
  if (event.key === "Escape" && !els.feedPreviewModal?.classList.contains("hidden")) {
    closeFeedPreviewModal();
  }
  if (event.key === "Escape" && !els.announcementEditModal?.classList.contains("hidden")) {
    closeAnnouncementEditModal();
  }
  if (event.key === "Escape" && !els.dangerConfirmModal?.classList.contains("hidden")) {
    resolveDangerConfirm(false);
  }
  if (event.key === "Escape" && !els.noticeModal?.classList.contains("hidden")) {
    closeNoticeModal();
  }
}

async function handleMemberEditSubmit(event) {
  event.preventDefault();
  const guildKey = els.memberEditGuildKey.value;
  const id = els.memberEditId.value;
  const guildMember = state.members.find((item) => buildGuildKey(item) === guildKey);
  const dashboardGuild = (state.dashboard?.guilds || []).find((guild) => {
    const key = guild.key || [guild.code || "", guild.prefix || "", guild.name || ""].join("|");
    return key === guildKey;
  });
  if (!guildMember && !dashboardGuild) {
    toast("没有找到对应妖盟");
    return;
  }
  const guildBase = guildMember || {
    alliance: dashboardGuild?.alliance || dashboardGuild?.hill || "默认联盟",
    hill: dashboardGuild?.hill || dashboardGuild?.alliance || "默认联盟",
    guild_code: dashboardGuild?.code || "",
    guild_prefix: dashboardGuild?.prefix || "",
    guild_power: Number(dashboardGuild?.custom_power || dashboardGuild?.customPower || dashboardGuild?.power || 0),
    guild: dashboardGuild?.name || "",
  };
  const payload = {
    alliance: guildBase.alliance,
    hill: guildBase.hill,
    guild_code: guildBase.guild_code || "",
    guild_prefix: guildBase.guild_prefix || "",
    guild_power: Number(guildBase.guild_power || 0),
    guild: guildBase.guild,
    name: els.memberEditName.value.trim(),
    role: els.memberEditRole.value.trim(),
    realm: els.memberEditRealm.value.trim(),
    power: normalizeScaledInput(els.memberEditPower.value.trim()),
    hp: 0,
    attack: 0,
    defense: 0,
    speed: normalizeScaledInput(els.memberEditSpeed.value.trim()),
    bonus_damage: normalizeScaledInput(els.memberEditBonusDamage.value.trim()),
    damage_reduction: normalizeScaledInput(els.memberEditDamageReduction.value.trim()),
    pet: els.memberEditPet.value.trim(),
    note: "",
    screenshot_path: id ? (state.members.find((item) => String(item.id) === id)?.screenshot_url || "") : "",
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
  const rawTarget = event.target;
  if (!(rawTarget instanceof Element)) return;
  const target = rawTarget.closest("[data-action]");
  if (!(target instanceof HTMLElement)) return;
  if (target.dataset.action === "go-login") {
    if (!state.me.authenticated) {
      window.location.href = "/auth.html";
    } else {
      switchView(hasPermission("manage_guilds") || state.me.is_admin ? "guildAdmin" : "guilds");
    }
    return;
  }
  if (target.dataset.action === "add-member" && canManageAlliance(state.members.find((item) => buildGuildKey(item) === state.selectedGuild)?.alliance || getGuildDetail(state.selectedGuild)?.hill || "") && state.selectedGuild) {
    openMemberEditModal(null, state.selectedGuild);
    return;
  }
  if (target.dataset.action === "import-excel" && canManageAlliance(state.members.find((item) => buildGuildKey(item) === state.selectedGuild)?.alliance || getGuildDetail(state.selectedGuild)?.hill || "") && state.selectedGuild) {
    triggerExcelImport();
    return;
  }
  if (target.dataset.action === "export-members" && state.me.is_admin && state.selectedGuild) {
    handleMemberExport();
  }
}

async function handleGuildDetailAction(event) {
  const rawTarget = event.target;
  if (!(rawTarget instanceof Element)) return;
  const target = rawTarget.closest("[data-action]");
  if (!(target instanceof HTMLElement)) return;
  if (target.dataset.action === "apply-cert") {
    const memberId = target.dataset.id;
    if (!state.me.authenticated) {
      switchView("login");
      toast("请先登录后再申请认证");
      return;
    }
    if (currentUserRole() !== "Guest") {
      toast("只有 Guest 才可以申请成员认证");
      return;
    }
    if (!memberId) return;
    request("/api/member-cert-requests", {
      method: "POST",
      body: JSON.stringify({ member_id: memberId }),
    })
      .then(async () => {
        await loadMyMemberRequests();
        renderGuildDetail();
        toast("认证申请已提交");
      })
      .catch((error) => toast(error.message));
    return;
  }
  if (target.dataset.action === "open-member-cert") {
    const memberId = target.dataset.id;
    if (!memberId) return;
    const member = state.members.find((item) => String(item.id) === memberId);
    if (!member || !canManageAlliance(member.alliance || member.hill || "")) return;
    openCertRequestModal(memberId);
    return;
  }
  const memberId = target.dataset.id;
  if (!memberId) return;
  const member = state.members.find((item) => String(item.id) === memberId);
  if (!member) return;
  if (target.dataset.action === "preview-screenshot") {
    openScreenshotPreview(member);
    return;
  }
  if (target.dataset.action === "delete-screenshot") {
    if (!canManageAlliance(member.alliance || member.hill || "")) return;
    deleteMemberScreenshot(member);
    return;
  }
  if (target.dataset.action === "upload-screenshot") {
    if (!canManageAlliance(member.alliance || member.hill || "")) return;
    triggerMemberScreenshotUpload(member.id);
    return;
  }
  if (target.dataset.action === "edit-detail-member") {
    if (!canManageAlliance(member.alliance || member.hill || "")) return;
    openMemberEditModal(member, buildGuildKey(member));
    return;
  }
  if (target.dataset.action === "delete-detail-member") {
    if (!canManageAlliance(member.alliance || member.hill || "")) return;
    const confirmed = await openDangerConfirm({
      title: "删除成员",
      message: `确定删除成员 ${member.name} 吗？`,
      confirmText: "确认删除",
    });
    if (!confirmed) return;
    request(`/api/members/${member.id}`, { method: "DELETE" })
      .then(async () => {
        await refreshAll();
        switchView("guildDetail");
        toast("成员删除成功");
      })
      .catch((error) => toast(error.message));
  }
}

function setGuildFormEditMode(isEdit) {
  for (const id of ["memberAlliance", "memberGuildCode", "memberGuildPrefix"]) {
    const field = document.querySelector(`#${id}`);
    if (field) {
      field.readOnly = isEdit;
      field.disabled = false;
    }
  }
}

async function handleAdminMemberAction(event) {
  const rawTarget = event.target;
  if (!(rawTarget instanceof Element)) return;
  const target = rawTarget.closest("[data-action]");
  if (!(target instanceof HTMLElement)) return;
  const { action, guildKey } = target.dataset;
  if (!action || !guildKey) return;
  const guildRow = getAdminGuildRowByKey(guildKey);
  if (!guildRow) return;

  if (action === "edit-member") {
    openGuildEditModal(guildRow);
    return;
  }

  if (action === "delete-member") {
    const confirmed = await openDangerConfirm({
      title: "删除妖盟",
      message: `确定删除妖盟 ${guildRow.displayName} 吗？`,
      confirmText: "确认删除",
    });
    if (!confirmed) return;
    request(`/api/guilds/${encodeURIComponent(guildKey)}`, { method: "DELETE" })
      .then(async () => {
        await refreshAll();
        toast("妖盟删除成功");
      })
      .catch((error) => toast(error.message));
  }
}

async function handleAdminAnnouncementAction(event) {
  const rawTarget = event.target;
  if (!(rawTarget instanceof Element)) return;
  const target = rawTarget.closest("[data-action]");
  if (!(target instanceof HTMLElement)) return;
  const { action, id } = target.dataset;
  if (!action || !id) return;
  const item = state.announcements.find((announcement) => String(announcement.id) === id);
  if (!item) return;

  if (action === "edit-announcement") {
    openAnnouncementEditModal(item);
    return;
  }

  if (action === "delete-announcement") {
    const confirmed = await openDangerConfirm({
      title: "删除公告",
      message: `确定删除 ${item.title} 吗？`,
      confirmText: "确认删除",
    });
    if (!confirmed) return;
    request(`/api/announcements/${id}`, { method: "DELETE" })
      .then(async () => {
        await Promise.all([loadDashboard(), fetchAnnouncements()]);
        toast("公告删除成功");
      })
      .catch((error) => toast(error.message));
  }
}

document.addEventListener("click", (event) => {
  const hillEditButton = event.target.closest("[data-edit-hill]");
  if (hillEditButton instanceof HTMLElement) {
    const hillName = hillEditButton.dataset.editHill || "";
    if (!canManageAlliance(hillName)) return;
    openHillEditModal(hillName);
    return;
  }

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
      if (kind === "admin-guild-page") {
        state.adminGuildPage = action === "prev" ? Math.max(1, state.adminGuildPage - 1) : state.adminGuildPage + 1;
        renderAdminMembers();
      }
      if (kind === "announcement-page") {
        state.announcementPage = action === "prev" ? Math.max(1, state.announcementPage - 1) : state.announcementPage + 1;
        renderFeeds();
      }
      if (kind === "melon-page") {
        state.melonPage = action === "prev" ? Math.max(1, state.melonPage - 1) : state.melonPage + 1;
        renderFeeds();
      }
      if (kind === "hill-browse-page") {
        const visibleHills = getVisibleHills();
        const maxPage = Math.max(1, visibleHills.length);
        state.hillBrowsePage = action === "prev" ? Math.max(1, state.hillBrowsePage - 1) : Math.min(maxPage, state.hillBrowsePage + 1);
        renderGuildSummary();
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

