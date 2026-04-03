function renderAdminMembers() {
  if (!els.adminMemberTable) return;
  const guildRows = getAdminGuildRows();
  if (!guildRows.length) {
    els.adminMemberTable.innerHTML = `<tr><td colspan="6">暂无妖盟数据。</td></tr>`;
    if (els.adminGuildPagination) els.adminGuildPagination.innerHTML = "";
    return;
  }
  const page = paginateItems(guildRows, state.adminGuildPage, 5);
  state.adminGuildPage = page.currentPage;
  els.adminMemberTable.innerHTML = page.items.map((guild) => `
    <tr>
      <td>${escapeHtml(guild.alliance)}</td>
      <td>${escapeHtml(guild.code || "-")}</td>
      <td>${escapeHtml(guild.shortName)}</td>
      <td>${escapeHtml(formatNumber(guild.power || 0))}</td>
      <td>${escapeHtml(normalizeEmptyDisplay(guild.leaderName) || "-")}</td>
      <td>
        ${canManageGuildScope(guild.key) || Boolean(state.me?.is_admin) ? `
          <div class="actions">
            <button class="action-btn action-btn--edit" data-action="edit-member" data-guild-key="${escapeHtml(guild.key)}">编辑</button>
            <button class="action-btn action-btn--delete" data-action="delete-member" data-guild-key="${escapeHtml(guild.key)}">删除</button>
          </div>
        ` : `<span class="table-note">无权限</span>`}
      </td>
    </tr>
  `).join("");
  if (els.adminGuildPagination) {
    els.adminGuildPagination.innerHTML = renderSimplePagination("admin-guild-page", page);
  }
}

function renderAdminAnnouncements() {
  if (!els.adminAnnouncementTable) return;
  const announcementItems = state.announcements.filter((item) => item.category === "公告");
  if (!announcementItems.length) {
    els.adminAnnouncementTable.innerHTML = `<tr><td colspan="3">暂无公告内容。</td></tr>`;
    return;
  }
  els.adminAnnouncementTable.innerHTML = announcementItems.map((item) => `
    <tr>
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
  return (state.dashboard?.guilds || []).map((guild) => ({
    key: guild.key || [guild.code || "", guild.prefix || "", guild.name || ""].join("|"),
    alliance: guild.hill || guild.alliance || "默认联盟",
    code: guild.code || "",
    displayName: guild.displayName || guild.display_name || guild.name || "未命名妖盟",
    shortName: guild.name || "未命名妖盟",
    leaderName: normalizeEmptyDisplay(guild.leader_name || guild.top_member?.name || ""),
    power: Number(guild.customPower || guild.custom_power || guild.power || 0),
    prefix: guild.prefix || "",
  }));
}

function getAdminGuildRowByKey(guildKey) {
  return getAdminGuildRows().find((guild) => guild.key === guildKey) || null;
}

function triggerFileDownload(url) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function handleGuildExport() {
  triggerFileDownload("/api/guilds/export");
}

function handleMemberExport() {
  if (!state.selectedGuild) {
    toast("请先选择一个妖盟");
    return;
  }
  triggerFileDownload(`/api/guilds/${encodeURIComponent(state.selectedGuild)}/members/export`);
}

async function saveGuildRecord(guildKey, payload) {
  const encodedGuildKey = encodeURIComponent(guildKey);
  await request(`/api/guilds/${encodedGuildKey}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

function openGuildEditModal(guildRow) {
  if (!els.guildEditModal || !els.guildEditKey || !els.guildEditName || !els.guildEditLeader) return;
  if (!guildRow) return;
  els.guildEditKey.value = guildRow.key || "";
  if (els.guildEditLeaderId) els.guildEditLeaderId.value = "";
  if (els.guildEditAlliance) els.guildEditAlliance.value = guildRow.alliance || "";
  if (els.guildEditCode) els.guildEditCode.value = guildRow.code || "";
  if (els.guildEditPrefix) els.guildEditPrefix.value = guildRow.prefix || "";
  if (els.guildEditCode) els.guildEditCode.disabled = true;
  if (els.guildEditPrefix) els.guildEditPrefix.disabled = true;
  if (els.guildEditPower) els.guildEditPower.value = formatNumber(guildRow.power || 0);
  els.guildEditName.value = guildRow.shortName || "";
  els.guildEditLeader.value = normalizeEmptyDisplay(guildRow.leaderName);
  if (els.guildEditTitle) {
    els.guildEditTitle.textContent = `编辑妖盟 · ${guildRow.displayName || guildRow.shortName || ""}`;
  }
  els.guildEditModal.classList.remove("hidden");
  window.setTimeout(() => els.guildEditName?.focus(), 0);
}

function closeGuildEditModal() {
  els.guildEditModal?.classList.add("hidden");
  els.guildEditForm?.reset();
  if (els.guildEditLeaderId) els.guildEditLeaderId.value = "";
}

function openHillEditModal(hillName) {
  if (!els.hillEditModal || !els.hillEditOldName || !els.hillEditName) return;
  els.hillEditOldName.value = hillName;
  const currentField = document.querySelector("#hillEditCurrentName");
  if (currentField) currentField.textContent = hillName;
  els.hillEditName.value = hillName;
  els.hillEditModal.classList.remove("hidden");
  window.setTimeout(() => els.hillEditName?.focus(), 0);
}

function closeHillEditModal() {
  els.hillEditModal?.classList.add("hidden");
  els.hillEditForm?.reset();
}

async function openMemberEditModal(member, guildKey) {
  if (!els.memberEditModal || !els.memberEditForm) return;
  let sourceMember = member || state.members.find((item) => buildGuildKey(item) === guildKey);
  const dashboardGuild = (state.dashboard?.guilds || []).find((guild) => {
    const key = guild.key || [guild.code || "", guild.prefix || "", guild.name || ""].join("|");
    return key === guildKey;
  });
  if (!sourceMember && !dashboardGuild) return;
  const isEdit = Boolean(member);
  if (isEdit && sourceMember?.id) {
    try {
      const result = await request(`/api/members/${sourceMember.id}/touch`, { method: "POST", body: "{}" });
      if (result?.item) {
        sourceMember = result.item;
        state.members = state.members.map((item) => (String(item.id) === String(sourceMember.id) ? { ...item, ...result.item } : item));
      }
    } catch (error) {
      toast(error.message);
      return;
    }
  }
  const guildDisplayName = sourceMember
    ? getGuildDisplayName(sourceMember)
    : (dashboardGuild?.display_name || dashboardGuild?.displayName || [dashboardGuild?.code || "", dashboardGuild?.prefix || "", dashboardGuild?.name || ""].filter(Boolean).join(" "));
  const allianceName = sourceMember?.alliance || dashboardGuild?.alliance || dashboardGuild?.hill || "默认联盟";
  if (els.memberEditTitle) {
    els.memberEditTitle.textContent = isEdit ? `编辑成员 · ${sourceMember.name}` : `新增成员 · ${guildDisplayName}`;
  }
  els.memberEditId.value = isEdit ? String(sourceMember.id) : "";
  els.memberEditGuildKey.value = guildKey;
  els.memberEditAlliance.value = allianceName;
  els.memberEditGuildDisplay.value = guildDisplayName;
  els.memberEditName.value = isEdit ? sourceMember.name || "" : "";
  els.memberEditRole.value = isEdit ? sourceMember.role || "" : "";
  els.memberEditRealm.value = isEdit ? sourceMember.realm || "" : "";
  els.memberEditPower.value = isEdit ? formatNumber(sourceMember.power || 0) : "0";
  els.memberEditSpeed.value = isEdit && Number(sourceMember.speed || 0) ? formatNumber(sourceMember.speed || 0) : "";
  els.memberEditPet.value = isEdit ? sourceMember.pet || "" : "";
  els.memberEditBonusDamage.value = isEdit && Number(sourceMember.bonus_damage || 0) ? formatNumber(sourceMember.bonus_damage || 0) : "";
  els.memberEditDamageReduction.value = isEdit && Number(sourceMember.damage_reduction || 0) ? formatNumber(sourceMember.damage_reduction || 0) : "";
  els.memberEditModal.classList.remove("hidden");
  window.setTimeout(() => els.memberEditName?.focus(), 0);
}

function closeMemberEditModal() {
  els.memberEditModal?.classList.add("hidden");
  els.memberEditForm?.reset();
}

function openScreenshotPreview(member) {
  if (!member?.screenshot_url || !els.screenshotPreviewModal || !els.screenshotPreviewImage) return;
  if (els.screenshotPreviewTitle) {
    els.screenshotPreviewTitle.textContent = `${member.name} 的截图预览`;
  }
  els.screenshotPreviewImage.src = member.screenshot_url;
  els.screenshotPreviewImage.alt = `${member.name} 的截图预览`;
  els.screenshotPreviewModal.classList.remove("hidden");
}

function closeScreenshotPreviewModal() {
  els.screenshotPreviewModal?.classList.add("hidden");
  if (els.screenshotPreviewImage) {
    els.screenshotPreviewImage.removeAttribute("src");
  }
}

function injectScreenshotDeleteButtons() {
  if (!els.guildDetailList) return;
  for (const actions of els.guildDetailList.querySelectorAll(".detail-member-card__actions")) {
    if (!(actions instanceof HTMLElement) || actions.querySelector('[data-action="delete-screenshot"]')) continue;
    const uploadButton = actions.querySelector('[data-action="upload-screenshot"]');
    const previewButton = actions.querySelector('[data-action="preview-screenshot"]');
    if (!(uploadButton instanceof HTMLElement) || !(previewButton instanceof HTMLElement)) continue;
    const memberId = uploadButton.dataset.id;
    if (!memberId) continue;
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "action-btn action-btn--remove-image";
    deleteButton.dataset.action = "delete-screenshot";
    deleteButton.dataset.id = memberId;
    deleteButton.textContent = "删除截图";
    previewButton.insertAdjacentElement("afterend", deleteButton);
  }
}

function triggerMemberScreenshotUpload(memberId) {
  if (!els.memberScreenshotInput) return;
  state.pendingScreenshotMemberId = memberId;
  els.memberScreenshotInput.value = "";
  els.memberScreenshotInput.click();
}

function triggerExcelImport() {
  const excelInput = document.querySelector("#excelImportInput");
  if (excelInput) {
    excelInput.value = "";
    excelInput.click();
  }
}

function triggerGuildExcelImport() {
  const excelInput = document.querySelector("#guildExcelImportInput");
  if (excelInput) {
    excelInput.value = "";
    excelInput.click();
  }
}

async function handleExcelFileSelected(event) {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;

  // 鑾峰彇褰撳墠濡栫洘鐨勪俊鎭?
  const guildKey = state.selectedGuild;
  if (!guildKey) {
    toast("未选择妖盟");
    input.value = "";
    return;
  }

  // 瑙ｆ瀽guildKey鑾峰彇濡栫洘淇℃伅
  const parts = guildKey.split("|");
  const guild_code = parts[0] || "";
  const guild_prefix = parts[1] || "";
  const guild_name = parts[2] || "";

  const formData = new FormData();
  formData.append("file", file);
  formData.append("guild_code", guild_code);
  formData.append("guild_prefix", guild_prefix);
  formData.append("guild", guild_name);

  try {
    const result = await request("/api/members/import", {
      method: "POST",
      body: formData,
    });
    await refreshAll();
    switchView("guildDetail");
    
    let message = result.message;
    if (result.skipped_excel_duplicates > 0) {
      message += `（Excel 内去重 ${result.skipped_excel_duplicates} 人）`;
    }
    if (result.skipped_existing > 0) {
      message += `（已跳过已有成员 ${result.skipped_existing} 人）`;
    }
    toast(message);
  } catch (error) {
    toast(error.message);
  } finally {
    input.value = "";
  }
}

async function handleMemberScreenshotSelected(event) {
  const input = event.target;
  const memberId = state.pendingScreenshotMemberId;
  const file = input.files?.[0];
  state.pendingScreenshotMemberId = null;
  if (!memberId || !file) return;

  const formData = new FormData();
  formData.append("screenshot", file);

  try {
    const uploadUrl = state.pendingProfileUploadType === "screenshot"
      ? "/api/profile/me/screenshot"
      : `/api/members/${memberId}/screenshot`;
    await request(uploadUrl, {
      method: "POST",
      body: formData,
    });
    await refreshAll();
    if (state.pendingProfileUploadType === "screenshot") {
      switchView("profile");
      toast("个人截图上传成功");
    } else {
      switchView("guildDetail");
      toast("成员截图上传成功");
    }
  } catch (error) {
    toast(error.message);
  } finally {
    input.value = "";
    state.pendingProfileUploadType = "";
  }
}

async function deleteMemberScreenshot(member) {
  if (!member?.screenshot_url) {
    toast("当前成员还没有截图");
    return;
  }
  const confirmed = await openDangerConfirm({
    title: "删除截图",
    message: `确定删除 ${member.name} 的截图吗？`,
    confirmText: "确认删除",
  });
  if (!confirmed) {
    return;
  }
  try {
    await request(`/api/members/${member.id}/screenshot`, { method: "DELETE" });
    closeScreenshotPreviewModal();
    await refreshAll();
    switchView("guildDetail");
    toast("成员截图已删除");
  } catch (error) {
    toast(error.message);
  }
}

async function handleGuildEditSubmit(event) {
  event.preventDefault();
  const guildKey = els.guildEditKey?.value || "";
  if (!guildKey) return;
  try {
    const matchingMembers = state.members.filter((item) => buildGuildKey(item) === guildKey);
    await saveGuildRecord(guildKey, {
      alliance: els.guildEditAlliance?.value.trim(),
      hill: els.guildEditAlliance?.value.trim(),
      guild_code: els.guildEditCode?.value.trim(),
      guild_prefix: els.guildEditPrefix?.value.trim(),
      guild: els.guildEditName.value.trim(),
      leader_name: normalizeEmptyDisplay(els.guildEditLeader?.value),
      guild_power: normalizeScaledInput(els.guildEditPower?.value.trim()) || getGuildManualPower(matchingMembers),
    });
    closeGuildEditModal();
    await refreshAll();
    toast("妖盟更新成功");
  } catch (error) {
    toast(error.message);
  }
}

async function handleHillEditSubmit(event) {
  event.preventDefault();
  const oldName = els.hillEditOldName?.value.trim();
  const nextName = els.hillEditName?.value.trim();
  if (!oldName || !nextName) return;

  const hillGuilds = getDerivedHills().find((hill) => hill.name === oldName)?.guilds || [];
  if (!hillGuilds.length) {
    toast("没有找到对应联盟");
    return;
  }

  try {
    await Promise.all(
      hillGuilds.map((guild) =>
        saveGuildRecord(guild.key, {
          alliance: nextName,
          hill: nextName,
          guild_code: guild.code || "",
          guild_prefix: guild.prefix || "",
          guild_power: guild.customPower || guild.custom_power || guild.power || 0,
          guild: guild.name || "",
          leader_name: normalizeEmptyDisplay(guild.leader_name || guild.leaderName || guild.top_member?.name || ""),
        }),
      ),
    );
    closeHillEditModal();
    if (state.hillFilter === oldName) {
      state.hillFilter = nextName;
    }
    await refreshAll();
    toast("联盟名称更新成功");
  } catch (error) {
    toast(error.message);
  }
}

async function handleHillDelete() {
  const hillName = els.hillEditOldName?.value.trim();
  if (!hillName) return;

  const hillGuilds = getDerivedHills().find((hill) => hill.name === hillName)?.guilds || [];
  if (!hillGuilds.length) {
    toast("没有找到对应联盟");
    return;
  }

  const confirmed = await openDangerConfirm({
    title: "删除联盟",
    message: `确定删除联盟 ${hillName} 吗？该联盟下的所有妖盟和成员都会一起删除。`,
    confirmText: "确认删除",
  });
  if (!confirmed) {
    return;
  }

  try {
    await Promise.all(
      hillGuilds.map((guild) => request(`/api/guilds/${encodeURIComponent(guild.key)}`, { method: "DELETE" })),
    );
    closeHillEditModal();
    if (state.hillFilter === hillName) {
      state.hillFilter = "all";
    }
    if (state.selectedGuild && hillGuilds.some((guild) => guild.key === state.selectedGuild)) {
      state.selectedGuild = null;
      state.currentView = "guilds";
    }
    state.hillBrowsePage = 1;
    await refreshAll();
    toast("联盟及其下属妖盟已删除");
  } catch (error) {
    toast(error.message);
  }
}

function resolveDangerConfirm(confirmed) {
  const resolver = pendingDangerConfirmResolver;
  pendingDangerConfirmResolver = null;
  els.dangerConfirmModal?.classList.add("hidden");
  if (resolver) resolver(confirmed);
}

