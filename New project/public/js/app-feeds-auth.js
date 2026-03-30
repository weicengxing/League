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

function getMemberClaimCooldownText() {
  const availableAt = state.me?.user?.member_unbind_available_at;
  if (!availableAt) return "";
  const parsed = new Date(String(availableAt).replace(" ", "T"));
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) return "";
  return `冷却中，${availableAt} 后可再次认领`;
}

function isCurrentUserLinkedToMember(member) {
  if (!state.me?.authenticated || !member) return false;
  const linkedId = state.me.user?.member_id || state.me.user?.member;
  return Boolean(linkedId) && String(linkedId) === String(member.id);
}

function canBecomeMemberDirectly(member) {
  return currentUserRole() === "AllianceAdmin" && canReviewMemberCert(member);
}

function renderMemberVerificationState(member) {
  if (isCurrentUserLinkedToMember(member)) {
    return `<button type="button" class="action-btn action-btn--reject" data-action="unbind-member" data-id="${member.id}">解绑</button>`;
  }
  if (member?.verified) {
    return `<span class="member-status member-status--verified">已认证</span>`;
  }
  if (canBecomeMemberDirectly(member)) {
    return `<button type="button" class="action-btn action-btn--approve" data-action="become-member" data-id="${member.id}">成为</button>`;
  }
  if (canReviewMemberCert(member)) {
    return `<button type="button" class="action-btn action-btn--approve" data-action="open-member-cert" data-id="${member.id}">认证</button>`;
  }
  if (currentUserRole() === "Guest") {
    const cooldownText = getMemberClaimCooldownText();
    if (cooldownText) {
      return `<span class="member-status member-status--pending">${escapeHtml(cooldownText)}</span>`;
    }
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
    if (canReviewMemberRequests()) {
      await loadMemberCertRequests(true, state.selectedMemberCertId || "");
    } else {
      await loadMyMemberRequests(true);
    }
  } catch (error) {
    toast(error.message);
    return;
  }
  renderAuth();
  renderCertRequestList();
  els.certRequestModal.classList.remove("hidden");
}

function closeCertRequestModal() {
  els.certRequestModal?.classList.add("hidden");
  state.selectedMemberCertId = null;
}

function closeIdentitySwapModal() {
  els.identitySwapModal?.classList.add("hidden");
  els.identitySwapForm?.reset();
}

function closeIdentitySwapRequestModal() {
  els.identitySwapRequestModal?.classList.add("hidden");
}

function getIdentitySwapItems() {
  if (state.identitySwapOptions?.length) {
    return state.identitySwapOptions;
  }
  return state.members
    .filter((member) => member?.verified)
    .map((member) => ({
      member_id: member.id,
      alliance: member.alliance || member.hill || "",
      guild: member.guild || "",
      guild_display: getGuildDisplayName(member) || member.guild || "",
      name: member.name || "",
      verified: Boolean(member.verified),
    }))
    .filter((item) => String(item.member_id || "") !== String(state.me?.user?.member_id || state.me?.user?.member || ""));
}

function renderIdentitySwapAllianceOptions(selectedValue = "") {
  const alliances = [...new Set(getIdentitySwapItems().map((item) => item.alliance).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  return [
    `<option value="">请选择联盟</option>`,
    ...alliances.map((alliance) => `<option value="${escapeHtml(alliance)}" ${alliance === selectedValue ? "selected" : ""}>${escapeHtml(alliance)}</option>`),
  ].join("");
}

function renderIdentitySwapGuildOptions(allianceValue, selectedValue = "") {
  const guilds = [...new Set(
    getIdentitySwapItems()
      .filter((item) => !allianceValue || item.alliance === allianceValue)
      .map((item) => item.guild_display || item.guild)
      .filter(Boolean),
  )].sort((a, b) => a.localeCompare(b, "zh-CN"));
  return [
    `<option value="">请选择妖盟</option>`,
    ...guilds.map((guild) => `<option value="${escapeHtml(guild)}" ${guild === selectedValue ? "selected" : ""}>${escapeHtml(guild)}</option>`),
  ].join("");
}

function renderIdentitySwapMemberOptions(allianceValue, guildValue, selectedValue = "") {
  const members = getIdentitySwapItems()
    .filter((item) => (!allianceValue || item.alliance === allianceValue) && (!guildValue || (item.guild_display || item.guild) === guildValue))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-CN"));
  return [
    `<option value="">请选择已认证成员</option>`,
    ...members.map((item) => `<option value="${escapeHtml(String(item.member_id))}" ${String(item.member_id) === String(selectedValue) ? "selected" : ""}>${escapeHtml(item.name || `成员 #${item.member_id}`)}</option>`),
  ].join("");
}

function syncIdentitySwapSummary() {
  if (!els.identitySwapSummary) return;
  const selectedId = els.identitySwapMember?.value || "";
  const item = getIdentitySwapItems().find((entry) => String(entry.member_id) === String(selectedId));
  if (!item) {
    els.identitySwapSummary.textContent = "请选择目标身份。";
    return;
  }
  els.identitySwapSummary.textContent = `将与 ${item.alliance || "-"} / ${item.guild_display || item.guild || "-"} / ${item.name || "-"} 绑定的账号交换 role、league、member、alliance 和冷却时间。`;
}

function syncIdentitySwapOptions(changedField = "alliance") {
  if (!els.identitySwapAlliance || !els.identitySwapGuild || !els.identitySwapMember) return;
  const selectedAlliance = els.identitySwapAlliance.value || "";
  let selectedGuild = els.identitySwapGuild.value || "";
  let selectedMember = els.identitySwapMember.value || "";

  els.identitySwapGuild.innerHTML = renderIdentitySwapGuildOptions(selectedAlliance, selectedGuild);
  if (![...els.identitySwapGuild.options].some((option) => option.value === selectedGuild)) {
    const firstGuild = [...els.identitySwapGuild.options].find((option) => option.value);
    selectedGuild = firstGuild?.value || "";
    els.identitySwapGuild.value = selectedGuild;
  }

  if (changedField === "alliance") {
    selectedMember = "";
  }

  els.identitySwapMember.innerHTML = renderIdentitySwapMemberOptions(selectedAlliance, selectedGuild, selectedMember);
  if (![...els.identitySwapMember.options].some((option) => option.value === selectedMember)) {
    const firstMember = [...els.identitySwapMember.options].find((option) => option.value);
    els.identitySwapMember.value = firstMember?.value || "";
  }
  syncIdentitySwapSummary();
}

async function openIdentitySwapModal() {
  if (!els.identitySwapModal || !els.identitySwapAlliance || !els.identitySwapGuild || !els.identitySwapMember) return;
  const currentMemberId = state.me?.user?.member_id || state.me?.user?.member;
  if (!currentMemberId) {
    toast("你还没有认证，暂时不能交换身份");
    return;
  }
  try {
    const data = await request("/api/profile/me/identity-swap/options");
    state.identitySwapOptions = data.items || [];
  } catch (error) {
    toast(error.message);
    return;
  }
  if (!state.identitySwapOptions.length) {
    toast("当前没有可交换的已认证成员");
    return;
  }
  els.identitySwapAlliance.innerHTML = renderIdentitySwapAllianceOptions();
  const firstAlliance = [...els.identitySwapAlliance.options].find((option) => option.value);
  els.identitySwapAlliance.value = firstAlliance?.value || "";
  if (els.identitySwapMessage) {
    els.identitySwapMessage.value = "";
  }
  syncIdentitySwapOptions("alliance");
  els.identitySwapModal.classList.remove("hidden");
}

async function submitIdentitySwapForm(event) {
  event.preventDefault();
  const memberId = els.identitySwapMember?.value || "";
  const message = els.identitySwapMessage?.value.trim() || "";
  if (!memberId) {
    toast("请选择目标成员");
    return;
  }
  try {
    const result = await request("/api/identity-swap-requests", {
      method: "POST",
      body: JSON.stringify({ member_id: Number(memberId), message }),
    });
    closeIdentitySwapModal();
    await loadIdentitySwapRequests();
    renderAuth();
    toast(result.message || "身份交换申请已提交");
  } catch (error) {
    toast(error.message);
  }
}

async function openIdentitySwapRequestModal() {
  if (!els.identitySwapRequestModal || !els.identitySwapRequestList) return;
  try {
    await loadIdentitySwapRequests(true);
  } catch (error) {
    toast(error.message);
    return;
  }
  renderAuth();
  renderIdentitySwapRequestList();
  els.identitySwapRequestModal.classList.remove("hidden");
}

function getIdentitySwapRequestStatusMeta(status) {
  if (status === "approved") return { label: "已同意", className: "member-status member-status--verified" };
  if (status === "rejected") return { label: "已拒绝", className: "member-status member-status--rejected" };
  return { label: "待确认", className: "member-status member-status--pending" };
}

function renderIdentitySwapRequestList() {
  if (!els.identitySwapRequestList) return;
  const items = state.identitySwapRequests || [];
  if (!items.length) {
    els.identitySwapRequestList.innerHTML = `<article class="empty-card">暂无身份交换申请记录。</article>`;
    return;
  }
  els.identitySwapRequestList.innerHTML = items.map((item) => {
    const statusMeta = getIdentitySwapRequestStatusMeta(item.status);
    const directionText = item.is_outgoing ? "我发起的申请" : "发给我的申请";
    const fromLabel = `${item.requester_member_name || "-"} / ${item.requester_guild || "-"} / ${item.requester_alliance || "-"}`;
    const toLabel = `${item.target_member_name || "-"} / ${item.target_guild || "-"} / ${item.target_alliance || "-"}`;
    return `
      <article class="request-item">
        <div class="request-item__body">
          <strong>${escapeHtml(directionText)}</strong>
          <p>发起身份：${escapeHtml(fromLabel)}</p>
          <p>目标身份：${escapeHtml(toLabel)}</p>
          <p><span class="${escapeHtml(statusMeta.className)}">${escapeHtml(statusMeta.label)}</span></p>
          <small>申请时间：${escapeHtml(item.created_at || "-")}</small>
          ${item.reviewed_at ? `<small>处理时间：${escapeHtml(item.reviewed_at)}</small>` : ""}
          ${item.message ? `<p class="request-item__comment">交换留言：${escapeHtml(item.message)}</p>` : ""}
          ${item.review_comment ? `<p class="request-item__comment">回复留言：${escapeHtml(item.review_comment)}</p>` : ""}
        </div>
        ${item.can_review ? `
          <div class="request-item__actions">
            <textarea class="request-comment-input" data-identity-swap-comment="${item.id}" rows="3" placeholder="回复留言（可填写同意说明或拒绝原因）">${escapeHtml(item.review_comment || "")}</textarea>
            <button type="button" class="action-btn action-btn--approve" data-identity-swap-action="approve" data-id="${item.id}">同意</button>
            <button type="button" class="action-btn action-btn--reject" data-identity-swap-action="reject" data-id="${item.id}">拒绝</button>
          </div>
        ` : ""}
      </article>
    `;
  }).join("");
}

async function reviewIdentitySwapRequest(requestId, action) {
  if (!requestId || !action) return;
  const commentInput = els.identitySwapRequestList?.querySelector(`[data-identity-swap-comment="${requestId}"]`);
  const review_comment = commentInput instanceof HTMLTextAreaElement ? commentInput.value.trim() : "";
  try {
    const result = await request(`/api/identity-swap-requests/${requestId}`, {
      method: "POST",
      body: JSON.stringify({ action, review_comment }),
    });
    await Promise.all([fetchMe(), loadIdentitySwapRequests()]);
    renderAuth();
    renderIdentitySwapRequestList();
    toast(result.message || (action === "approve" ? "身份交换已完成" : "身份交换申请已拒绝"));
  } catch (error) {
    toast(error.message);
  }
}

function renderCertRequestList() {
  if (!els.certRequestList) return;
  const reviewMode = canReviewMemberRequests();
  const modalTitle = els.certRequestModal?.querySelector(".modal__head h3");
  if (modalTitle) {
    modalTitle.textContent = reviewMode ? "成员认证申请" : "我的认证申请记录";
  }
  const sourceItems = reviewMode ? state.memberRequests : state.myMemberRequests;
  const items = state.selectedMemberCertId
    ? sourceItems.filter((item) => String(item.member_id) === String(state.selectedMemberCertId))
    : sourceItems;
  if (!items.length) {
    els.certRequestList.innerHTML = `<article class="empty-card">${reviewMode ? "暂无待审核申请。" : "暂无申请记录。"}</article>`;
    return;
  }
  els.certRequestList.innerHTML = items.map((item) => `
    <article class="request-item">
      <div class="request-item__body">
        <strong>${escapeHtml(item.display_name || item.username || "-")}</strong>
        <p>${escapeHtml(item.member_name || "-")} 路 ${escapeHtml(item.guild_name || "-")} 路 ${escapeHtml(item.alliance || "-")}</p>
        ${reviewMode ? "" : `<p><span class="${escapeHtml(getRoleRequestStatusMeta(item.status).className)}">${escapeHtml(getRoleRequestStatusMeta(item.status).label)}</span></p>`}
        <small>申请时间：${escapeHtml(item.created_at || "-")}</small>
        ${item.reviewed_at ? `<small>处理时间：${escapeHtml(item.reviewed_at)}</small>` : ""}
        ${item.review_comment ? `<p class="request-item__comment">审核备注：${escapeHtml(item.review_comment)}</p>` : ""}
      </div>
      ${reviewMode ? `
        <div class="request-item__actions">
          <textarea class="request-comment-input" data-member-request-comment="${item.id}" rows="3" placeholder="审核备注（可填写拒绝原因）">${escapeHtml(item.review_comment || "")}</textarea>
          <button type="button" class="action-btn action-btn--approve" data-request-action="approve" data-id="${item.id}">同意</button>
          <button type="button" class="action-btn action-btn--reject" data-request-action="reject" data-id="${item.id}">拒绝</button>
        </div>
      ` : ""}
    </article>
  `).join("");
}

async function reviewMemberRequest(requestId, action) {
  if (!requestId || !action) return;
  const commentInput = els.certRequestList?.querySelector(`[data-member-request-comment="${requestId}"]`);
  const review_comment = commentInput instanceof HTMLTextAreaElement ? commentInput.value.trim() : "";
  try {
    await request(`/api/member-cert-requests/${requestId}`, {
      method: "POST",
      body: JSON.stringify({ action, review_comment }),
    });
    await loadMyMemberRequests();
    await loadMemberCertRequests(false, state.selectedMemberCertId || "");
    renderAuth();
    renderCertRequestList();
    toast(action === "approve" ? "申请已通过" : "申请已拒绝");
  } catch (error) {
    toast(error.message);
  }
}

function openRoleApplyModal() {
  if (!els.roleApplyModal || !els.roleApplyAlliance) return;
  syncRoleApplyTargetOptions();
  els.roleApplyModal.classList.remove("hidden");
}

function closeRoleApplyModal() {
  els.roleApplyModal?.classList.add("hidden");
  els.roleApplyForm?.reset();
  syncRoleApplyTargetOptions();
}

function getRoleApplyGuildOptions(selectedValue = "") {
  const guilds = getDerivedHills()
    .flatMap((hill) => hill.guilds.map((guild) => ({
      key: String(guild.key || "").trim(),
      label: String(guild.displayName || guild.name || guild.key || "").trim(),
    })))
    .filter((guild) => guild.key)
    .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
  return [
    `<option value="">请选择妖盟</option>`,
    ...guilds.map((guild) => `<option value="${escapeHtml(guild.key)}" ${guild.key === selectedValue ? "selected" : ""}>${escapeHtml(guild.label)}</option>`),
  ].join("");
}

function renderRoleApplyTargetOptions(requestType, selectedValue = "") {
  return requestType === "guild"
    ? getRoleApplyGuildOptions(selectedValue)
    : renderAllianceSelectOptions(selectedValue);
}

function getRoleRequestTargetLabel(item) {
  const requestType = item?.request_type === "alliance" ? "alliance" : "guild";
  const targetName = String(item?.target_name || item?.alliance || "").trim();
  if (!targetName) return "-";
  if (requestType === "alliance") return targetName;
  return getGuildLabelFromKey(targetName, getDerivedHills()) || targetName;
}

function syncRoleApplyTargetOptions(selectedValue = "") {
  if (!els.roleApplyAlliance) return;
  const requestType = els.roleApplyType?.value === "alliance" ? "alliance" : "guild";
  if (els.roleApplyTargetLabel) {
    els.roleApplyTargetLabel.textContent = requestType === "guild" ? "目标妖盟" : "目标联盟";
  }
  els.roleApplyAlliance.innerHTML = renderRoleApplyTargetOptions(requestType, selectedValue);
}

async function submitRoleApplyForm(event) {
  event.preventDefault();
  const requestType = els.roleApplyType?.value === "alliance" ? "alliance" : "guild";
  const targetName = els.roleApplyAlliance?.value || "";
  if (!targetName) {
    toast(requestType === "guild" ? "请选择妖盟" : "请选择联盟");
    return;
  }
  try {
    await request("/api/admin-role-requests", {
      method: "POST",
      body: JSON.stringify({
        request_type: requestType,
        target_name: targetName,
        alliance: targetName,
      }),
    });
    closeRoleApplyModal();
    toast(requestType === "guild" ? "妖盟盟主申请已提交" : "联盟盟主申请已提交");
  } catch (error) {
    toast(error.message);
  }
}

async function openRoleRequestModal() {
  if (!els.roleRequestModal || !els.roleRequestList) return;
  try {
    await loadRoleRequests(true);
  } catch (error) {
    toast(error.message);
    return;
  }
  renderAuth();
  renderRoleRequestList();
  els.roleRequestModal.classList.remove("hidden");
}

function closeRoleRequestModal() {
  els.roleRequestModal?.classList.add("hidden");
}

function canReviewRoleRequests() {
  return hasPermission("manage_roles");
}

function getRoleRequestStatusMeta(status) {
  if (status === "approved") return { label: "已通过", className: "member-status member-status--verified" };
  if (status === "rejected") return { label: "已拒绝", className: "member-status member-status--rejected" };
  return { label: "审核中", className: "member-status member-status--pending" };
}

function renderRoleRequestList() {
  if (!els.roleRequestList) return;
  const reviewMode = canReviewRoleRequests();
  const modalTitle = els.roleRequestModal?.querySelector(".modal__head h3");
  if (modalTitle) {
    modalTitle.textContent = reviewMode ? "盟主权限申请列表" : "我的盟主申请记录";
  }
  if (!state.roleRequests.length) {
    els.roleRequestList.innerHTML = `<article class="empty-card">${reviewMode ? "暂无待审核申请。" : "暂无申请记录。"}</article>`;
    return;
  }
  els.roleRequestList.innerHTML = state.roleRequests.map((item) => `
    <article class="request-item">
      <div class="request-item__body">
        <strong>${escapeHtml(item.display_name || item.username || "-")}</strong>
        <p>${escapeHtml(item.email || "-")}</p>
        <p>${escapeHtml(item.request_type === "guild" ? "妖盟盟主" : "联盟盟主")} · ${escapeHtml(getRoleRequestTargetLabel(item))}</p>
        <p><span class="${escapeHtml(getRoleRequestStatusMeta(item.status).className)}">${escapeHtml(getRoleRequestStatusMeta(item.status).label)}</span></p>
        <small>申请时间：${escapeHtml(item.created_at || "-")}</small>
        ${item.reviewed_at ? `<small>处理时间：${escapeHtml(item.reviewed_at)}</small>` : ""}
        ${item.review_comment ? `<p class="request-item__comment">审核备注：${escapeHtml(item.review_comment)}</p>` : ""}
      </div>
      ${reviewMode ? `
        <div class="request-item__actions">
          <select class="request-alliance-select" data-role-request-alliance="${item.id}">
            ${renderRoleApplyTargetOptions(item.request_type === "alliance" ? "alliance" : "guild", item.target_name || item.alliance || "")}
          </select>
          <textarea class="request-comment-input" data-role-request-comment="${item.id}" rows="3" placeholder="审核备注（可填写拒绝原因）">${escapeHtml(item.review_comment || "")}</textarea>
          <button type="button" class="action-btn action-btn--approve" data-role-request-action="approve" data-id="${item.id}">同意</button>
          <button type="button" class="action-btn action-btn--reject" data-role-request-action="reject" data-id="${item.id}">拒绝</button>
        </div>
      ` : ""}
    </article>
  `).join("");
}

async function reviewRoleRequest(requestId, action) {
  if (!requestId || !action) return;
  const requestItem = state.roleRequests.find((item) => String(item.id) === String(requestId));
  if (requestItem && requestItem.status && requestItem.status !== "pending") {
    toast("该申请已处理过");
    return;
  }
  const allianceSelect = els.roleRequestList?.querySelector(`[data-role-request-alliance="${requestId}"]`);
  const commentInput = els.roleRequestList?.querySelector(`[data-role-request-comment="${requestId}"]`);
  const target_name = allianceSelect instanceof HTMLSelectElement ? allianceSelect.value : "";
  const review_comment = commentInput instanceof HTMLTextAreaElement ? commentInput.value.trim() : "";
  try {
    await request(`/api/admin-role-requests/${requestId}`, {
      method: "POST",
      body: JSON.stringify({
        action,
        request_type: requestItem?.request_type || "guild",
        target_name,
        alliance: target_name,
        review_comment,
      }),
    });
    await loadRoleRequests();
    renderRoleRequestList();
    toast(action === "approve" ? "申请已通过" : "申请已拒绝");
  } catch (error) {
    if (String(error.message || "").includes("已处理过")) {
      try {
        await loadRoleRequests();
        renderRoleRequestList();
      } catch (refreshError) {
        console.error(refreshError);
      }
    }
    toast(error.message);
  }
}

function renderAuth() {
  const authenticated = state.me.authenticated && (hasPermission("admin_panel_access") || state.me.is_admin);
  const currentRole = currentUserRole();
  const hasPendingRoleRequest = state.roleRequests.some((item) => item.status === "pending");
  const canShowRoleApply = state.me.authenticated && currentRole !== "AllianceAdmin" && currentRole !== "SuperAdmin";
  els.logoutBtn?.classList.toggle("hidden", !state.me.authenticated);
  els.loginForm?.classList.toggle("hidden", state.me.authenticated);
  els.roleApplyBtn?.classList.toggle("hidden", !canShowRoleApply);
  if (els.roleApplyBtn) {
    els.roleApplyBtn.disabled = hasPendingRoleRequest;
    els.roleApplyBtn.textContent = hasPendingRoleRequest ? "盟主申请审核中" : "申请盟主权限";
  }
  els.roleRequestBtn?.classList.toggle("hidden", !state.me.authenticated);
  els.certRequestBtn?.classList.toggle("hidden", !(state.me.authenticated && (currentRole === "Guest" || canReviewMemberRequests())));
  els.identitySwapBtn?.classList.toggle("hidden", !(state.me.authenticated && !state.me.is_admin));
  els.identitySwapRequestBtn?.classList.toggle("hidden", !(state.me.authenticated && !state.me.is_admin));
  const roleBadge = document.querySelector("#roleRequestBadge");
  if (roleBadge) {
    const count = state.roleRequestUnreadCount;
    roleBadge.textContent = count;
    roleBadge.classList.toggle("hidden", count === 0);
  }
  const certBadge = document.querySelector("#certRequestBadge");
  if (certBadge) {
    const count = canReviewMemberRequests()
      ? state.memberRequestUnreadCount
      : state.myMemberRequestUnreadCount;
    certBadge.textContent = count;
    certBadge.classList.toggle("hidden", count === 0);
  }
  const identitySwapBadge = document.querySelector("#identitySwapRequestBadge");
  if (identitySwapBadge) {
    const count = Number(state.identitySwapUnreadCount || 0);
    identitySwapBadge.textContent = count;
    identitySwapBadge.classList.toggle("hidden", count === 0);
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
      els.loginState.textContent = `当前用户：${state.me.user.display_name || state.me.user.username}（${currentRole}）`;
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
