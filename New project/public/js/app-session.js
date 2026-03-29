function openNoticeModal({ title = "提示", message = "", confirmText = "确认", onConfirm = null, autoCloseMs = 0 } = {}) {
  if (!els.noticeModal || !els.noticeModalTitle || !els.noticeModalMessage || !els.noticeModalConfirmBtn) return;
  if (noticeModalTimer) {
    clearTimeout(noticeModalTimer);
    noticeModalTimer = null;
  }
  noticeModalConfirmHandler = onConfirm;
  els.noticeModalTitle.textContent = title;
  els.noticeModalMessage.textContent = message;
  els.noticeModalConfirmBtn.textContent = confirmText;
  els.noticeModal.classList.remove("hidden");
  if (autoCloseMs > 0) {
    noticeModalTimer = window.setTimeout(() => closeNoticeModal(), autoCloseMs);
  }
}

function closeNoticeModal() {
  if (noticeModalTimer) {
    clearTimeout(noticeModalTimer);
    noticeModalTimer = null;
  }
  els.noticeModal?.classList.add("hidden");
  const callback = noticeModalConfirmHandler;
  noticeModalConfirmHandler = null;
  if (typeof callback === "function") {
    callback();
  }
}

function handleSessionKicked() {
  if (state.sessionKickHandled) return;
  state.sessionKickHandled = true;
  disconnectAuthWebSocket();
  state.me = { authenticated: false, user: null, is_admin: false };
  localStorage.removeItem("alliance_user");
  renderAuth();
  openNoticeModal({
    title: "登录失效",
    message: "账号已在其他设备登录，请重新登录。",
    confirmText: "去登录",
    onConfirm: () => {
      window.location.href = "/auth.html";
    },
  });
}

async function boot() {
  try {
    await fetchMe();
    await loadDashboard();
    await Promise.all([fetchMembers(), fetchAnnouncements()]);
    connectMelonWebSocket();
    connectAuthWebSocket();
  } catch (error) {
    console.error(error);
    toast(`页面初始化失败：${error.message}`);
  }
  renderView();
}

async function handleMelonPostSubmit(event) {
  event.preventDefault();
  const titleInput = document.querySelector("#melonTitle");
  syncMelonEditorValue();
  const contentInput = els.melonContent;
  const form = document.querySelector("#melonPostForm");
  
  const title = titleInput?.value.trim();
  const content = normalizeRichEditorHtml(contentInput?.value.trim());
  const plainContent = htmlToPlainText(content);
  
  if (!title || !plainContent) {
    toast("标题和内容不能为空");
    return;
  }
  
  if (!state.me.authenticated) {
    toast("请先登录后再发布");
    return;
  }
  
  // Optimistic update - add to list immediately
  const tempId = `temp_${Date.now()}`;
  const tempItem = {
    id: tempId,
    title: title,
    content: content,
    category: "瓜棚",
    created_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
    author: state.me.user?.username || state.me.user?.display_name || "匿名用户",
  };
  
  // Add optimistic item
  state.announcements.unshift(tempItem);
  state.melonPage = 1;
  renderFeeds();
  
  // Clear form
  form?.reset();
  resetMelonEditor();
  
  try {
    const result = await request("/api/melon", {
      method: "POST",
      body: JSON.stringify({ title, content }),
    });
    
    // Replace the optimistic item and dedupe against any WebSocket echo
    if (result.item) {
      const realId = String(result.item.id);
      const existingRealIndex = state.announcements.findIndex((a) => String(a.id) === realId);
      const tempIndex = state.announcements.findIndex((a) => a.id === tempId);

      if (existingRealIndex !== -1 && tempIndex !== -1 && existingRealIndex !== tempIndex) {
        state.announcements.splice(tempIndex, 1);
      } else if (tempIndex !== -1) {
        state.announcements[tempIndex] = result.item;
      } else if (existingRealIndex === -1) {
        state.announcements.unshift(result.item);
      }
    }
    state.melonPage = 1;
    renderFeeds();
    renderAdminAnnouncements();
    
    toast("瓜棚发布成功");
  } catch (error) {
    // Remove optimistic item on error
    const index = state.announcements.findIndex(a => a.id === tempId);
    if (index !== -1) {
      state.announcements.splice(index, 1);
    }
    renderFeeds();
    toast(error.message);
  }
}

async function handleMelonRevoke(melonId) {
  // Skip temp items
  if (String(melonId).startsWith('temp_')) {
    toast("无法撤回");
    return;
  }
  
  if (!state.me.authenticated) {
    toast("请先登录");
    return;
  }
  
  const index = state.announcements.findIndex((item) => String(item.id) === String(melonId));
  const removedItem = index !== -1 ? state.announcements[index] : null;
  if (index !== -1) {
    state.announcements.splice(index, 1);
    renderFeeds();
    renderAdminAnnouncements();
  }

  try {
    await request(`/api/melon/${melonId}`, {
      method: "DELETE",
      body: JSON.stringify({}),
    });
    toast("撤回成功");
  } catch (error) {
    if (removedItem) {
      state.announcements.splice(index, 0, removedItem);
      renderFeeds();
      renderAdminAnnouncements();
    }
    toast(error.message);
  }
}

async function refreshAll() {
  await fetchMe();
  await loadDashboard();
  await Promise.all([fetchMembers(), fetchAnnouncements()]);
}

async function request(url, options = {}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: isFormData ? { ...(options.headers || {}) } : { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const isJson = response.headers.get("Content-Type")?.includes("application/json");
  const data = isJson ? await response.json() : null;
  if (!response.ok) {
    if (response.status === 401 && state.me?.authenticated && !state.logoutInProgress) {
      handleSessionKicked();
    }
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
  state.announcementPage = Math.max(1, state.announcementPage || 1);
  state.melonPage = Math.max(1, state.melonPage || 1);
  renderFeeds();
  renderAdminAnnouncements();
}

async function fetchMe() {
  const previousAuthenticated = Boolean(state.me?.authenticated);
  state.me = await request("/api/auth/me");
  if (previousAuthenticated && !state.me?.authenticated && !state.logoutInProgress) {
    handleSessionKicked();
    return;
  }
  if (state.me?.authenticated) {
    state.sessionKickHandled = false;
    connectAuthWebSocket();
    await loadMyMemberRequests();
    if (currentUserRole() === "SuperAdmin") {
      try {
        await loadRoleRequests();
      } catch {
        state.roleRequests = [];
      }
    } else {
      state.roleRequests = [];
    }
  } else {
    disconnectAuthWebSocket();
    state.myMemberRequests = [];
    state.memberRequests = [];
    state.roleRequests = [];
  }
  renderAuth();
  renderFeeds();
  renderAdminAnnouncements();
}

async function loadMyMemberRequests() {
  try {
    const data = await request("/api/member-cert-requests/mine");
    state.myMemberRequests = data.items || [];
  } catch {
    state.myMemberRequests = [];
  }
}

function getAllianceOptions() {
  return [...new Set((state.dashboard?.hills || []).map((hill) => hill.name).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function renderAllianceSelectOptions(selectedValue = "") {
  const alliances = getAllianceOptions();
  return [
    `<option value="">请选择联盟</option>`,
    ...alliances.map((alliance) => `<option value="${escapeHtml(alliance)}" ${alliance === selectedValue ? "selected" : ""}>${escapeHtml(alliance)}</option>`),
  ].join("");
}

function currentUserRole() {
  return state.me?.authenticated ? (state.me.user?.role || "Guest") : "Guest";
}

function currentPermissions() {
  return Array.isArray(state.me?.permissions)
    ? state.me.permissions
    : Array.isArray(state.me?.user?.permissions)
      ? state.me.user.permissions
      : [];
}

function hasPermission(permission) {
  return currentUserRole() === "SuperAdmin" || currentPermissions().includes(permission);
}

function canManageAlliance(allianceName) {
  if (!state.me?.authenticated || !hasPermission("manage_members")) {
    return false;
  }
  if (currentUserRole() === "SuperAdmin") {
    return true;
  }
  const managedAlliance = String(state.me.user?.alliance || "").trim();
  const targetAlliance = String(allianceName || "").trim();
  return Boolean(managedAlliance) && managedAlliance === targetAlliance;
}

async function loadRoleRequests() {
  const data = await request("/api/admin-role-requests");
  state.roleRequests = data.items || [];
}

function renderDashboard() {
  const hills = getDerivedHills();
  const guildCount = hills.reduce((sum, hill) => sum + hill.guilds.length, 0);
  if (els.allianceName) {
    els.allianceName.textContent = state.dashboard?.alliance_name || "默认联盟";
  }
  if (els.memberCount) {
    els.memberCount.textContent = `${state.members.length || state.dashboard?.member_count || 0} 名成员`;
  }
  if (els.guildCount) {
    els.guildCount.textContent = `${guildCount} 个妖盟`;
  }
}

