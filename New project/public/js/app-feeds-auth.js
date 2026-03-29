function renderFeedGroup(items, emptyText) {
  if (!items.length) return `<article class="empty-card">${emptyText}</article>`;
  return items.map((item) => {
    // 璁＄畻鏄惁鍦?鍒嗛挓鍐呭彲鎾ゅ洖
    let canRevoke = false;
    if (item.created_at && state.me.authenticated) {
      const createdTime = new Date(item.created_at.replace(' ', 'T'));
      const now = new Date();
      const elapsed = (now - createdTime) / 1000; // 绉?
      canRevoke = elapsed <= 120; // 2鍒嗛挓 = 120绉?
      // 妫€鏌ユ槸鍚︽槸鍙戝竷鑰呮湰浜?
      const currentUsername = state.me.user?.username || state.me.user?.display_name || "";
      if (item.author !== currentUsername) {
        canRevoke = false;
      }
    }
    const renderedContent = renderStoredContent(item.content || "");
    const plainText = escapeHtml(htmlToPlainText(renderedContent));
    return `
      <article class="feed-item" data-melon-id="${item.id}" data-feed-preview="${item.id}">
        <small class="feed-item__meta">${escapeHtml(item.created_at || "")}${item.author ? ` · ${escapeHtml(item.author)}` : ""}</small>
        <strong>${escapeHtml(item.title)}</strong>
        <div class="feed-item__content" title="${plainText}">${renderedContent}</div>
        <span class="feed-item__preview-hint">查看详情</span>
        ${canRevoke ? `<button type="button" class="melon-revoke-btn" data-melon-revoke="${item.id}">撤回</button>` : ""}      </article>
    `;
  }).join("");
}

function hasPendingMemberRequest(memberId) {
  return state.myMemberRequests.some((request) => String(request.member_id) === String(memberId) && request.status === "pending");
}

function renderMemberVerificationState(member) {
  if (member?.verified) {
    return `<span class="member-status member-status--verified">已认证</span>`;
  }
  if (currentUserRole() === "AllianceAdmin" && canManageAlliance(member.alliance || member.hill || "")) {
    return `<button type="button" class="action-btn action-btn--approve" data-action="open-member-cert" data-id="${member.id}">认证</button>`;
  }
  if (currentUserRole() === "Guest") {
    if (hasPendingMemberRequest(member.id)) {
      return `<span class="member-status member-status--pending">申请中</span>`;
    }
    return `<button type="button" class="action-btn action-btn--apply" data-action="apply-cert" data-id="${member.id}">申请认证</button>`;
  }
  return `<span class="member-status member-status--pending">未认证</span>`;
}

async function openCertRequestModal(memberId = null) {
  if (!els.certRequestModal || !els.certRequestList) return;
  try {
    state.selectedMemberCertId = memberId ? String(memberId) : null;
    const query = state.selectedMemberCertId ? `?member_id=${encodeURIComponent(state.selectedMemberCertId)}` : "";
    const data = await request(`/api/member-cert-requests${query}`);
    state.memberRequests = data.items || [];
  } catch (error) {
    toast(error.message);
    return;
  }
  renderCertRequestList();
  els.certRequestModal.classList.remove("hidden");
}

function closeCertRequestModal() {
  els.certRequestModal?.classList.add("hidden");
  state.selectedMemberCertId = null;
}

function renderCertRequestList() {
  if (!els.certRequestList) return;
  const items = state.selectedMemberCertId
    ? state.memberRequests.filter((item) => String(item.member_id) === String(state.selectedMemberCertId))
    : state.memberRequests;
  if (!items.length) {
    els.certRequestList.innerHTML = `<article class="empty-card">暂无待审核申请。</article>`;
    return;
  }
  els.certRequestList.innerHTML = items.map((item) => `
    <article class="request-item">
      <div class="request-item__body">
        <strong>${escapeHtml(item.display_name || item.username || "-")}</strong>
        <p>${escapeHtml(item.member_name || "-")} 路 ${escapeHtml(item.guild_name || "-")} 路 ${escapeHtml(item.alliance || "-")}</p>
        <small>${escapeHtml(item.created_at || "")}</small>
      </div>
      <div class="request-item__actions">
        <button type="button" class="action-btn action-btn--approve" data-request-action="approve" data-id="${item.id}">同意</button>
        <button type="button" class="action-btn action-btn--reject" data-request-action="reject" data-id="${item.id}">拒绝</button>
      </div>
    </article>
  `).join("");
}

async function reviewMemberRequest(requestId, action) {
  if (!requestId || !action) return;
  try {
    await request(`/api/member-cert-requests/${requestId}`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    await loadMyMemberRequests();
    await openCertRequestModal(state.selectedMemberCertId);
    toast(action === "approve" ? "申请已通过" : "申请已拒绝");
  } catch (error) {
    toast(error.message);
  }
}

function openRoleApplyModal() {
  if (!els.roleApplyModal || !els.roleApplyAlliance) return;
  els.roleApplyAlliance.innerHTML = renderAllianceSelectOptions();
  els.roleApplyModal.classList.remove("hidden");
}

function closeRoleApplyModal() {
  els.roleApplyModal?.classList.add("hidden");
  els.roleApplyForm?.reset();
}

async function submitRoleApplyForm(event) {
  event.preventDefault();
  const alliance = els.roleApplyAlliance?.value || "";
  if (!alliance) {
    toast("请选择联盟");
    return;
  }
  try {
    await request("/api/admin-role-requests", {
      method: "POST",
      body: JSON.stringify({ alliance }),
    });
    closeRoleApplyModal();
    toast("联盟管理员申请已提交");
  } catch (error) {
    toast(error.message);
  }
}

async function openRoleRequestModal() {
  if (!els.roleRequestModal || !els.roleRequestList) return;
  try {
    await loadRoleRequests();
  } catch (error) {
    toast(error.message);
    return;
  }
  renderRoleRequestList();
  els.roleRequestModal.classList.remove("hidden");
}

function closeRoleRequestModal() {
  els.roleRequestModal?.classList.add("hidden");
}

function renderRoleRequestList() {
  if (!els.roleRequestList) return;
  if (!state.roleRequests.length) {
    els.roleRequestList.innerHTML = `<article class="empty-card">暂无联盟管理员申请。</article>`;
    return;
  }
  els.roleRequestList.innerHTML = state.roleRequests.map((item) => `
    <article class="request-item">
      <div class="request-item__body">
        <strong>${escapeHtml(item.display_name || item.username || "-")}</strong>
        <p>${escapeHtml(item.email || "-")}</p>
        <small>${escapeHtml(item.created_at || "")}</small>
      </div>
      <div class="request-item__actions">
        <select class="request-alliance-select" data-role-request-alliance="${item.id}">
          ${renderAllianceSelectOptions(item.alliance || "")}
        </select>
        <button type="button" class="action-btn action-btn--approve" data-role-request-action="approve" data-id="${item.id}">同意</button>
        <button type="button" class="action-btn action-btn--reject" data-role-request-action="reject" data-id="${item.id}">拒绝</button>
      </div>
    </article>
  `).join("");
}

async function reviewRoleRequest(requestId, action) {
  if (!requestId || !action) return;
  const allianceSelect = els.roleRequestList?.querySelector(`[data-role-request-alliance="${requestId}"]`);
  const alliance = allianceSelect instanceof HTMLSelectElement ? allianceSelect.value : "";
  try {
    await request(`/api/admin-role-requests/${requestId}`, {
      method: "POST",
      body: JSON.stringify({ action, alliance }),
    });
    await loadRoleRequests();
    renderRoleRequestList();
    toast(action === "approve" ? "申请已通过" : "申请已拒绝");
  } catch (error) {
    toast(error.message);
  }
}

function renderAuth() {
  const authenticated = state.me.authenticated && (hasPermission("admin_panel_access") || state.me.is_admin);
  els.logoutBtn?.classList.toggle("hidden", !state.me.authenticated);
  els.loginForm?.classList.toggle("hidden", state.me.authenticated);
  els.roleApplyBtn?.classList.toggle("hidden", !(state.me.authenticated && currentUserRole() !== "AllianceAdmin" && currentUserRole() !== "SuperAdmin"));
  els.roleRequestBtn?.classList.toggle("hidden", currentUserRole() !== "SuperAdmin");
  els.certRequestBtn?.classList.toggle("hidden", currentUserRole() !== "AllianceAdmin");
  const badge = document.querySelector("#roleRequestBadge");
  if (badge) {
    const count = state.roleRequests.length;
    badge.textContent = count;
    badge.classList.toggle("hidden", count === 0);
  }
  if (els.loginNavButton) {
    els.loginNavButton.textContent = state.me.authenticated ? "退出登录" : "登录";
  }
  els.guildAdminGate?.classList.toggle("hidden", authenticated);
  els.guildAdminLayout?.classList.toggle("hidden", !authenticated);
  els.announcementAdminGate?.classList.toggle("hidden", authenticated);
  els.announcementAdminLayout?.classList.toggle("hidden", !authenticated);
  document.querySelector('[data-view="guildAdmin"]')?.classList.toggle("hidden", !hasPermission("manage_guilds"));
  document.querySelector('[data-view="announcementAdmin"]')?.classList.toggle("hidden", !hasPermission("manage_announcements"));
    if (els.loginState) {
    if (state.me.authenticated && state.me.user) {
      els.loginState.textContent = `当前用户：${state.me.user.display_name || state.me.user.username}（${currentUserRole()}）`;
    } else {
      els.loginState.textContent = "未登录";
    }
  }
  if ((state.currentView === "guildAdmin" || state.currentView === "announcementAdmin") && !hasPermission("admin_panel_access")) {
    state.currentView = state.me.authenticated ? "guilds" : "login";
  }
  renderView();
  renderGuildSummary();
  renderGuildDetail();
  renderAdminMembers();
}

function renderAdminProfile() {
  const admin = state.me?.is_admin ? state.me.user : null;
  const hills = getDerivedHills();
  const guildCount = hills.reduce((sum, hill) => sum + hill.guilds.length, 0);

  if (els.adminProfileName) {
    els.adminProfileName.textContent = admin?.display_name || "管理员";
  }
  if (els.adminProfileUsername) {
    els.adminProfileUsername.textContent = `账号：${admin?.username || "-"}`;
  }
  if (els.adminProfileDisplayName) {
    els.adminProfileDisplayName.textContent = admin?.display_name || "-";
  }
  if (els.adminProfileAccount) {
    els.adminProfileAccount.textContent = admin?.username || "-";
  }
  if (els.adminProfileMemberCount) {
    els.adminProfileMemberCount.textContent = formatNumber(state.members.length || 0);
  }
  if (els.adminProfileGuildCount) {
    els.adminProfileGuildCount.textContent = formatNumber(guildCount);
  }
  if (els.adminProfileHillCount) {
    els.adminProfileHillCount.textContent = formatNumber(hills.length);
  }
  if (els.adminProfileAnnouncementCount) {
    els.adminProfileAnnouncementCount.textContent = formatNumber(state.announcements.length || 0);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  try {
    const result = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: els.username.value.trim(),
        password: els.password.value.trim(),
      }),
    });
    localStorage.setItem("alliance_user", JSON.stringify({
      ...(result.user || {}),
      is_admin: Boolean(result.is_admin),
      loginTime: Date.now(),
    }));
    await fetchMe();
    switchView(result?.is_admin ? "guildAdmin" : "guilds");
    openNoticeModal({
      title: "登录成功",
      message: "欢迎回来",
      confirmText: "知道了",
      autoCloseMs: 1400,
    });
  } catch (error) {
    toast(error.message);
  }
}

async function handleLogout() {
  try {
    state.logoutInProgress = true;
    disconnectAuthWebSocket();
    await request("/api/auth/logout", { method: "POST", body: "{}" });
    localStorage.removeItem("alliance_user");
    await fetchMe();
    state.me = { authenticated: false, user: null, is_admin: false };
    renderAuth();
    window.location.href = "/auth.html";
  } catch (error) {
    toast(error.message);
  } finally {
    state.logoutInProgress = false;
  }
}

function handleAdminProfileAction(event) {
  const target = event.target.closest("[data-profile-action]");
  if (!(target instanceof HTMLElement)) return;
  const nextView = target.dataset.profileAction;
  if (!nextView) return;
  switchView(nextView);
}

async function handleMemberSubmit(event) {
  event.preventDefault();
  const formId = document.querySelector("#memberId").value;
  const guildPayload = {
    alliance: document.querySelector("#memberAlliance").value.trim(),
    hill: document.querySelector("#memberAlliance").value.trim() || "默认联盟",
    guild_code: document.querySelector("#memberGuildCode").value.trim(),
    guild_prefix: document.querySelector("#memberGuildPrefix").value.trim(),
    guild_power: normalizeScaledInput(document.querySelector("#memberGuildPower").value.trim()),
    guild: document.querySelector("#memberGuild").value.trim(),
    leader_name: normalizeEmptyDisplay(document.querySelector("#memberName").value.trim()) ? document.querySelector("#memberName").value.trim() : "",
  };

  try {
    if (formId.startsWith("guild:")) {
      await saveGuildRecord(formId.replace("guild:", ""), guildPayload);
    } else {
      await request("/api/guilds", { method: "POST", body: JSON.stringify(guildPayload) });
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
  document.querySelector("#memberAlliance").value = state.dashboard?.alliance_name || "默认联盟";
  setGuildFormEditMode(false);
  if (els.memberFormTitle) els.memberFormTitle.textContent = "录入新妖盟";
  if (els.memberSubmitBtn) els.memberSubmitBtn.textContent = "保存妖盟";
}

function openAnnouncementEditModal(item = null) {
  if (!els.announcementEditModal) return;
  if (els.announcementEditModalTitle) {
    els.announcementEditModalTitle.textContent = item ? `编辑公告 · ${item.title}` : "新增公告";
  }
  if (els.announcementEditId) els.announcementEditId.value = item?.id || "";
  if (els.announcementEditTitle) els.announcementEditTitle.value = item?.title || "";
  if (els.announcementEditContent) els.announcementEditContent.value = contentToEditorText(item?.content || "");
  if (els.announcementEditSubmitBtn) {
    els.announcementEditSubmitBtn.textContent = item ? "更新公告" : "发布公告";
  }
  els.announcementEditModal.classList.remove("hidden");
  window.setTimeout(() => els.announcementEditTitle?.focus(), 0);
}

function closeAnnouncementEditModal() {
  els.announcementEditModal?.classList.add("hidden");
  els.announcementEditForm?.reset();
  if (els.announcementEditId) els.announcementEditId.value = "";
}

async function handleAnnouncementEditSubmit(event) {
  event.preventDefault();
  const payload = {
    category: "公告",
    title: els.announcementEditTitle?.value.trim() || "",
    content: els.announcementEditContent?.value.trim() || "",
  };
  const announcementId = els.announcementEditId?.value || "";
  const method = announcementId ? "PUT" : "POST";
  const url = announcementId ? `/api/announcements/${announcementId}` : "/api/announcements";

  try {
    await request(url, { method, body: JSON.stringify(payload) });
    closeAnnouncementEditModal();
    await Promise.all([loadDashboard(), fetchAnnouncements()]);
    toast(announcementId ? "公告更新成功" : "公告发布成功");
  } catch (error) {
    toast(error.message);
  }
}
