// WebSocket connection for real-time melon updates
let melonWs = null;
let melonReconnectAttempts = 0;
const MELON_WS_MAX_RECONNECT = 5;
let authWs = null;
let authWsReconnectAttempts = 0;
const AUTH_WS_MAX_RECONNECT = 5;
let melonRichEditor = null;
let pendingDangerConfirmResolver = null;
let noticeModalTimer = null;
let noticeModalConfirmHandler = null;

function connectMelonWebSocket() {
  if (melonWs && melonWs.readyState === WebSocket.OPEN) {
    return;
  }
  
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/melon`;
  
  try {
    melonWs = new WebSocket(wsUrl);
    
    melonWs.onopen = () => {
      console.log('[Melon WS] Connected');
      melonReconnectAttempts = 0;
    };
    
    melonWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'melon_new') {
          handleMelonNewEvent(data);
        }
        if (data.type === 'melon_deleted' && data.deleted_id) {
          handleMelonDeleted(data.deleted_id);
        }
      } catch (e) {
        console.error('[Melon WS] Parse error:', e);
      }
    };
    
    melonWs.onclose = () => {
      console.log('[Melon WS] Disconnected');
      melonWs = null;
      // Auto reconnect with backoff
      if (melonReconnectAttempts < MELON_WS_MAX_RECONNECT) {
        const delay = Math.min(1000 * Math.pow(2, melonReconnectAttempts), 30000);
        melonReconnectAttempts++;
        setTimeout(connectMelonWebSocket, delay);
      }
    };
    
    melonWs.onerror = (error) => {
      console.error('[Melon WS] Error:', error);
    };
    
  } catch (e) {
    console.error('[Melon WS] Failed to connect:', e);
  }
}

function handleNewMelonPost(item) {
  // Add to local announcements state (optimistic)
  if (!state.announcements.find(a => a.id === item.id)) {
    state.announcements.unshift(item);
  }
  // Re-render melon list
  renderFeeds();
  renderAdminAnnouncements();
  // Show notification (only for real items, not temp ones)
  if (!String(item.id).startsWith('temp_')) {
    toast(`新瓜棚动态: ${item.title}`);
  }
}

async function handleMelonNewEvent(eventData) {
  const melonId = String(eventData?.id || "");
  const alreadyPresent = melonId ? state.announcements.some((item) => String(item.id) === melonId) : false;
  await fetchAnnouncements();
  if (!alreadyPresent) {
    toast(eventData?.title ? `新瓜棚动态: ${eventData.title}` : "有新的瓜棚动态");
  }
}

function handleMelonDeleted(deletedId) {
  // Remove from local announcements state
  const index = state.announcements.findIndex(a => String(a.id) === String(deletedId));
  if (index !== -1) {
    state.announcements.splice(index, 1);
  }
  // Re-render melon list
  renderFeeds();
  renderAdminAnnouncements();
  // Show notification
  toast("瓜棚动态已撤回");
}

function disconnectMelonWebSocket() {
  if (melonWs) {
    melonWs.close();
    melonWs = null;
  }
}

function connectAuthWebSocket() {
  if (!state.me?.authenticated) return;
  if (authWs && authWs.readyState === WebSocket.OPEN) return;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws/auth`;

  try {
    authWs = new WebSocket(wsUrl);

    authWs.onopen = () => {
      authWsReconnectAttempts = 0;
    };

    authWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "session_kicked") {
          disconnectAuthWebSocket();
          handleSessionKicked();
        }
      } catch (error) {
        console.error("[Auth WS] Parse error:", error);
      }
    };

    authWs.onclose = () => {
      authWs = null;
      if (state.me?.authenticated && !state.logoutInProgress && !state.sessionKickHandled && authWsReconnectAttempts < AUTH_WS_MAX_RECONNECT) {
        const delay = Math.min(1000 * Math.pow(2, authWsReconnectAttempts), 10000);
        authWsReconnectAttempts += 1;
        setTimeout(connectAuthWebSocket, delay);
      }
    };

    authWs.onerror = (error) => {
      console.error("[Auth WS] Error:", error);
    };
  } catch (error) {
    console.error("[Auth WS] Failed to connect:", error);
  }
}

function disconnectAuthWebSocket() {
  if (authWs) {
    authWs.close();
    authWs = null;
  }
}

const state = {
  dashboard: null,
  members: [],
  announcements: [],
  me: { authenticated: false, user: null, is_admin: false },
  currentView: "guilds",
  selectedGuild: null,
  search: "",
  guildDetailSearch: "",
  guildDetailRoleFilter: "all",
  hillFilter: "all",
  guildFilter: "all",
  guildPageByHill: {},
  hillBrowsePage: 1,
  rankingPage: 1,
  guildDetailPage: 1,
  announcementPage: 1,
  melonPage: 1,
  adminGuildPage: 1,
  sessionKickHandled: false,
  logoutInProgress: false,
  rankingGuildFilter: "all",
  sort: "power-desc",
  pendingScreenshotMemberId: null,
};

const els = {
  allianceName: document.querySelector("#allianceName"),
  memberCount: document.querySelector("#memberCount"),
  guildCount: document.querySelector("#guildCount"),
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
  filterSummaryLabel: document.querySelector("#filterSummaryLabel"),
  filterGuildCount: document.querySelector("#filterGuildCount"),
  filterMemberCount: document.querySelector("#filterMemberCount"),
  backTopBtn: document.querySelector("#backTopBtn"),
  rankingGuildFilter: document.querySelector("#rankingGuildFilter"),
  sortSelect: document.querySelector("#sortSelect"),
  loginForm: document.querySelector("#loginForm"),
  logoutBtn: document.querySelector("#logoutBtn"),
  loginState: document.querySelector("#loginState"),
  username: document.querySelector("#username"),
  password: document.querySelector("#password"),
  adminProfileGuest: document.querySelector("#adminProfileGuest"),
  adminProfilePanel: document.querySelector("#adminProfilePanel"),
  adminProfileName: document.querySelector("#adminProfileName"),
  adminProfileUsername: document.querySelector("#adminProfileUsername"),
  adminProfileDisplayName: document.querySelector("#adminProfileDisplayName"),
  adminProfileAccount: document.querySelector("#adminProfileAccount"),
  adminProfileMemberCount: document.querySelector("#adminProfileMemberCount"),
  adminProfileGuildCount: document.querySelector("#adminProfileGuildCount"),
  adminProfileHillCount: document.querySelector("#adminProfileHillCount"),
  adminProfileAnnouncementCount: document.querySelector("#adminProfileAnnouncementCount"),
  adminProfileActions: document.querySelector("#adminProfileActions"),
  guildAdminGate: document.querySelector("#guildAdminGate"),
  guildAdminLayout: document.querySelector("#guildAdminLayout"),
  announcementAdminGate: document.querySelector("#announcementAdminGate"),
  announcementAdminLayout: document.querySelector("#announcementAdminLayout"),
  loginNavButton: document.querySelector('[data-view="login"]'),
  refreshBtn: document.querySelector("#refreshBtn"),
  exportGuildsBtn: document.querySelector("#exportGuildsBtn"),
  adminGuildPagination: document.querySelector("#adminGuildPagination"),
  memberForm: document.querySelector("#memberForm"),
  memberFormTitle: document.querySelector("#memberFormTitle"),
  memberFormHint: document.querySelector("#memberFormHint"),
  memberSubmitBtn: document.querySelector("#memberSubmitBtn"),
  importGuildsBtn: document.querySelector("#importGuildsBtn"),
  resetMemberBtn: document.querySelector("#resetMemberBtn"),
  guildEditModal: document.querySelector("#guildEditModal"),
  guildEditForm: document.querySelector("#guildEditForm"),
  guildEditKey: document.querySelector("#guildEditKey"),
  guildEditLeaderId: null,
  guildEditAlliance: document.querySelector("#guildEditAlliance"),
  guildEditHill: null,
  guildEditCode: document.querySelector("#guildEditCode"),
  guildEditPrefix: document.querySelector("#guildEditPrefix"),
  guildEditPower: document.querySelector("#guildEditPower"),
  guildEditName: document.querySelector("#guildEditName"),
  guildEditLeader: document.querySelector("#guildEditLeader"),
  guildEditTitle: document.querySelector("#guildEditTitle"),
  hillEditModal: null,
  hillEditForm: null,
  hillEditOldName: null,
  hillEditName: null,
  hillDeleteBtn: null,
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
  memberScreenshotInput: document.querySelector("#memberScreenshotInput"),
  screenshotPreviewModal: document.querySelector("#screenshotPreviewModal"),
  screenshotPreviewTitle: document.querySelector("#screenshotPreviewTitle"),
  screenshotPreviewImage: document.querySelector("#screenshotPreviewImage"),
  feedPreviewModal: document.querySelector("#feedPreviewModal"),
  feedPreviewTitle: document.querySelector("#feedPreviewTitle"),
  feedPreviewMeta: document.querySelector("#feedPreviewMeta"),
  feedPreviewContent: document.querySelector("#feedPreviewContent"),
  adminMemberTable: document.querySelector("#adminMemberTable"),
  addAnnouncementBtn: document.querySelector("#addAnnouncementBtn"),
  adminAnnouncementTable: document.querySelector("#adminAnnouncementTable"),
  announcementEditModal: document.querySelector("#announcementEditModal"),
  announcementEditForm: document.querySelector("#announcementEditForm"),
  announcementEditModalTitle: document.querySelector("#announcementEditModalTitle"),
  announcementEditId: document.querySelector("#announcementEditId"),
  announcementEditTitle: document.querySelector("#announcementEditTitle"),
  announcementEditContent: document.querySelector("#announcementEditContent"),
  announcementEditSubmitBtn: document.querySelector("#announcementEditSubmitBtn"),
  dangerConfirmModal: document.querySelector("#dangerConfirmModal"),
  dangerConfirmTitle: document.querySelector("#dangerConfirmTitle"),
  dangerConfirmMessage: document.querySelector("#dangerConfirmMessage"),
  dangerConfirmSubmitBtn: document.querySelector("#dangerConfirmSubmitBtn"),
  dangerConfirmCancelBtn: document.querySelector("#dangerConfirmCancelBtn"),
  noticeModal: document.querySelector("#noticeModal"),
  noticeModalTitle: document.querySelector("#noticeModalTitle"),
  noticeModalMessage: document.querySelector("#noticeModalMessage"),
  noticeModalConfirmBtn: document.querySelector("#noticeModalConfirmBtn"),
  melonEditor: document.querySelector("#melonEditor"),
  melonToolbar: document.querySelector("#melonToolbar"),
  melonContent: document.querySelector("#melonContent"),
};

setupUserProfileUI();
setupGuildEditUI();
setupMemberEditUI();
setupRichTextEditors();
bindEvents();
boot();

function setupUserProfileUI() {
  els.viewButtons = [...document.querySelectorAll(".top-pills__btn")];
  els.viewPanels = [...document.querySelectorAll(".board-panel")];

  for (const [element, placeholder] of [
    [document.querySelector("#memberGuildPower"), "支持小数，可写 26万亿"],
    [els.memberEditPower, "支持小数，可写 4538.99万"],
    [els.memberEditSpeed, "支持小数，可写 1.58万"],
    [els.memberEditBonusDamage, "支持小数，可写 657.6"],
    [els.memberEditDamageReduction, "支持小数，可写 686.7"],
  ]) {
    if (!element) continue;
    element.type = "text";
    element.setAttribute("inputmode", "decimal");
    element.setAttribute("placeholder", placeholder);
  }
}

function setupGuildEditUI() {
  if (els.guildEditModal) {
    const dialog = els.guildEditModal.querySelector(".modal__dialog");
    if (dialog) {
      dialog.innerHTML = `
        <div class="modal__head">
          <div class="modal__title-block">
            <p class="modal__eyebrow">Guild</p>
            <h3 id="guildEditTitle">编辑妖盟</h3>
          </div>
          <button type="button" class="modal__close" data-close-modal="guild-edit" aria-label="关闭">×</button>
        </div>
        <form id="guildEditForm" class="member-form">
          <input type="hidden" id="guildEditKey">
          <input type="hidden" id="guildEditLeaderId">
          <label>联盟<input id="guildEditAlliance" type="text" readonly></label>
          <label>山头号<input id="guildEditCode" type="text" readonly></label>
          <label>山名字号<input id="guildEditPrefix" type="text" readonly></label>
          <label>妖盟总战力<input id="guildEditPower" type="text" inputmode="decimal" placeholder="支持小数，可写 26万亿"></label>
          <label>妖盟名称<input id="guildEditName" type="text" required></label>
          <label>盟主昵称<input id="guildEditLeader" type="text" placeholder="可留空"></label>
          <div class="modal__actions full">
            <button type="button" class="ghost-btn" data-close-modal="guild-edit">取消</button>
            <button type="submit" class="primary-btn">保存修改</button>
          </div>
        </form>
      `;
    }
  }

  els.guildEditForm = document.querySelector("#guildEditForm");
  els.guildEditKey = document.querySelector("#guildEditKey");
  els.guildEditLeaderId = document.querySelector("#guildEditLeaderId");
  els.guildEditAlliance = document.querySelector("#guildEditAlliance");
  els.guildEditCode = document.querySelector("#guildEditCode");
  els.guildEditPrefix = document.querySelector("#guildEditPrefix");
  els.guildEditPower = document.querySelector("#guildEditPower");
  els.guildEditName = document.querySelector("#guildEditName");
  els.guildEditLeader = document.querySelector("#guildEditLeader");
  els.guildEditTitle = document.querySelector("#guildEditTitle");
  els.guildEditHill = null;

  for (const element of [els.guildEditAlliance, els.guildEditCode, els.guildEditPrefix, els.guildEditPower]) {
    if (!element) continue;
    element.removeAttribute("readonly");
  }
  if (els.guildEditPower) {
    els.guildEditPower.setAttribute("inputmode", "decimal");
    els.guildEditPower.setAttribute("placeholder", "支持小数，可写 26万亿");
  }
  if (els.guildEditLeader) {
    els.guildEditLeader.removeAttribute("required");
    els.guildEditLeader.setAttribute("placeholder", "可留空");
  }

  if (!document.querySelector("#hillEditModal")) {
    document.body.insertAdjacentHTML(
      "beforeend",
      `
        <div id="hillEditModal" class="modal hidden">
          <div class="modal__backdrop" data-close-modal="hill-edit"></div>
          <div class="modal__dialog modal__dialog--hill">
            <div class="modal__head">
              <div class="modal__title-block">
                <p class="modal__eyebrow">联盟设置</p>
                <h3>编辑联盟</h3>
              </div>
              <button type="button" class="modal__close" data-close-modal="hill-edit" aria-label="关闭">×</button>
            </div>
            <form id="hillEditForm" class="stack-form modal-form">
              <input type="hidden" id="hillEditOldName">
              <div class="modal-summary-card">
                <span>当前联盟</span>
                <strong id="hillEditCurrentName">-</strong>
              </div>
              <label>
                <span>新联盟名称</span>
                <input id="hillEditName" type="text" required>
                <small class="field-hint">修改后会同步到这个联盟下的所有妖盟。</small>
              </label>
              <div class="modal-actions modal-actions--split">
                <button type="button" id="hillDeleteBtn" class="danger-btn">删除整个联盟</button>
                <div class="modal-actions__right">
                  <button type="button" class="ghost-btn" data-close-modal="hill-edit">取消</button>
                  <button type="submit" class="primary-btn">保存修改</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      `,
    );
  }

  els.hillEditModal = document.querySelector("#hillEditModal");
  els.hillEditForm = document.querySelector("#hillEditForm");
  els.hillEditOldName = document.querySelector("#hillEditOldName");
  els.hillEditName = document.querySelector("#hillEditName");
  els.hillDeleteBtn = document.querySelector("#hillDeleteBtn");
  els.hillEditForm?.addEventListener("submit", handleHillEditSubmit);
  els.hillDeleteBtn?.addEventListener("click", handleHillDelete);

  const memberRoleLabel = els.memberEditRole?.closest("label");
  if (memberRoleLabel) {
    const roleText = memberRoleLabel.childNodes[0];
    if (roleText && roleText.nodeType === Node.TEXT_NODE) {
      roleText.textContent = "等级";
    }
  }
  if (els.memberEditRole) {
    els.memberEditRole.setAttribute("placeholder", "例如 1200级");
  }
  els.memberEditNote?.closest("label")?.remove();
}

function setupMemberEditUI() {
  if (els.memberEditModal) {
    const dialog = els.memberEditModal.querySelector(".modal__dialog");
    if (dialog) {
      dialog.innerHTML = `
        <div class="modal__head">
          <h3 id="memberEditTitle">编辑成员</h3>
          <button type="button" class="ghost-btn" data-close-modal="member-edit">关闭</button>
        </div>
        <form id="memberEditForm" class="member-form">
          <input type="hidden" id="memberEditId">
          <input type="hidden" id="memberEditGuildKey">
          <label>联盟名称<input id="memberEditAlliance" type="text" readonly></label>
          <label>所属妖盟<input id="memberEditGuildDisplay" type="text" readonly></label>
          <label>成员昵称<input id="memberEditName" type="text" required></label>
          <label>等级<input id="memberEditRole" type="text" placeholder="例如 1200级" required></label>
          <label>境界<input id="memberEditRealm" type="text" required></label>
          <label>战力<input id="memberEditPower" type="text" inputmode="decimal" placeholder="支持小数，可写 10万亿" required></label>
          <label>敏捷<input id="memberEditSpeed" type="text" inputmode="decimal" placeholder="可留空，支持 1万亿"></label>
          <label>灵兽<input id="memberEditPet" type="text" required></label>
          <label>增伤<input id="memberEditBonusDamage" type="text" inputmode="decimal" placeholder="可留空，支持小数"></label>
          <label>减伤<input id="memberEditDamageReduction" type="text" inputmode="decimal" placeholder="可留空，支持小数"></label>
          <div class="modal__actions full">
            <button type="button" class="ghost-btn" data-close-modal="member-edit">取消</button>
            <button type="submit" class="primary-btn">保存成员</button>
          </div>
        </form>
      `;
    }
  }

  els.memberEditForm = document.querySelector("#memberEditForm");
  els.memberEditTitle = document.querySelector("#memberEditTitle");
  els.memberEditId = document.querySelector("#memberEditId");
  els.memberEditGuildKey = document.querySelector("#memberEditGuildKey");
  els.memberEditAlliance = document.querySelector("#memberEditAlliance");
  els.memberEditGuildDisplay = document.querySelector("#memberEditGuildDisplay");
  els.memberEditName = document.querySelector("#memberEditName");
  els.memberEditRole = document.querySelector("#memberEditRole");
  els.memberEditRealm = document.querySelector("#memberEditRealm");
  els.memberEditPower = document.querySelector("#memberEditPower");
  els.memberEditSpeed = document.querySelector("#memberEditSpeed");
  els.memberEditPet = document.querySelector("#memberEditPet");
  els.memberEditBonusDamage = document.querySelector("#memberEditBonusDamage");
  els.memberEditDamageReduction = document.querySelector("#memberEditDamageReduction");
}

function setupRichTextEditors() {
  const editorRoot = els.melonEditor;
  const toolbarRoot = els.melonToolbar;
  if (!editorRoot || !toolbarRoot || !window.wangEditor) return;
  const WangEditor = window.wangEditor;
  const { createEditor, createToolbar, i18nChangeLanguage } = WangEditor;
  i18nChangeLanguage?.("zh-CN");
  melonRichEditor = createEditor({
    selector: "#melonEditor",
    html: "",
    config: {
      placeholder: "分享新鲜事...",
      onChange(editor) {
        if (els.melonContent) {
          els.melonContent.value = normalizeRichEditorHtml(editor.getHtml());
        }
      },
    },
    mode: "simple",
  });
  createToolbar({
    editor: melonRichEditor,
    selector: "#melonToolbar",
    mode: "simple",
  });
}

function bindEvents() {
  els.searchInput?.addEventListener("input", (event) => {
    state.search = event.target.value.trim();
    state.hillBrowsePage = 1;
    showBrowseView();
    renderGuildFilters();
    renderGuildSummary();
  });

  els.searchBtn?.addEventListener("click", () => {
    state.hillBrowsePage = 1;
    showBrowseView();
    renderGuildFilters();
    renderGuildSummary();
  });

  els.viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const targetView = button.dataset.view || "guilds";
      if (targetView === "login") {
        if (state.me?.authenticated) {
          handleLogout();
        } else {
          window.location.href = "/auth.html";
        }
        return;
      }
      switchView(targetView);
    });
  });

  els.guildFilter?.addEventListener("change", (event) => {
    state.guildFilter = event.target.value;
    state.hillBrowsePage = 1;
    showBrowseView();
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
  els.exportGuildsBtn?.addEventListener("click", handleGuildExport);
  els.memberForm?.addEventListener("submit", handleMemberSubmit);
  els.importGuildsBtn?.addEventListener("click", triggerGuildExcelImport);
  els.resetMemberBtn?.addEventListener("click", resetMemberForm);
  els.guildEditForm?.addEventListener("submit", handleGuildEditSubmit);
  els.memberEditForm?.addEventListener("submit", handleMemberEditSubmit);
  els.addAnnouncementBtn?.addEventListener("click", () => openAnnouncementEditModal());
  els.announcementEditForm?.addEventListener("submit", handleAnnouncementEditSubmit);
  els.adminMemberTable?.addEventListener("click", handleAdminMemberAction);
  els.adminAnnouncementTable?.addEventListener("click", handleAdminAnnouncementAction);
  els.guildDetailList?.addEventListener("click", handleGuildDetailAction);
  els.guildDetailActions?.addEventListener("click", handleGuildDetailToolbarAction);
  els.memberScreenshotInput?.addEventListener("change", handleMemberScreenshotSelected);
  els.melonList?.addEventListener("click", handleFeedListClick);
  els.announcementList?.addEventListener("click", handleFeedListClick);
  els.dangerConfirmSubmitBtn?.addEventListener("click", () => resolveDangerConfirm(true));
  els.dangerConfirmCancelBtn?.addEventListener("click", () => resolveDangerConfirm(false));
  els.noticeModalConfirmBtn?.addEventListener("click", closeNoticeModal);
  document.addEventListener("click", handleModalDismiss);
  document.addEventListener("keydown", handleModalKeydown);
  window.addEventListener("focus", checkSessionOnResume);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkSessionOnResume();
    }
  });
  
  // 瓜棚发布表单
  const melonPostForm = document.querySelector("#melonPostForm");
  if (melonPostForm) {
    melonPostForm.addEventListener("submit", handleMelonPostSubmit);
  }
  
  // 创建隐藏的文件输入框用于Excel导入
  const excelInput = document.createElement("input");
  excelInput.type = "file";
  excelInput.accept = ".xlsx,.xls";
  excelInput.style.display = "none";
  excelInput.id = "excelImportInput";
  document.body.appendChild(excelInput);
  excelInput.addEventListener("change", handleExcelFileSelected);

  const guildExcelInput = document.createElement("input");
  guildExcelInput.type = "file";
  guildExcelInput.accept = ".xlsx,.xls";
  guildExcelInput.style.display = "none";
  guildExcelInput.id = "guildExcelImportInput";
  document.body.appendChild(guildExcelInput);
  guildExcelInput.addEventListener("change", handleGuildExcelFileSelected);
}

async function checkSessionOnResume() {
  if (!state.me?.authenticated) return;
  try {
    await fetchMe();
  } catch (error) {
    // 401 handling is centralized in request()
  }
}

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
    await refreshAll();
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
  await loadDashboard();
  await Promise.all([fetchMembers(), fetchAnnouncements()]);
  await fetchMe();
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
  } else {
    disconnectAuthWebSocket();
  }
  renderAuth();
  renderFeeds();
  renderAdminAnnouncements();
}

function renderDashboard() {
  const hills = getDerivedHills();
  const guildCount = hills.reduce((sum, hill) => sum + hill.guilds.length, 0);
  if (els.allianceName) {
    els.allianceName.textContent = state.dashboard?.alliance_name || "🔮联盟";
  }
  if (els.memberCount) {
    els.memberCount.textContent = `${state.members.length || state.dashboard?.member_count || 0} 名成员`;
  }
  if (els.guildCount) {
    els.guildCount.textContent = `${guildCount} 个妖盟`;
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
        <h2>🔮 ${escapeHtml(hill.name)}</h2>
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
      <button type="button" class="guild-card__action" data-open-guild="${escapeHtml(guild.key)}">查看妖盟全成员战力</button>
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
    if (els.guildDetailRoleFilter) els.guildDetailRoleFilter.innerHTML = `<option value="all">全部等级</option>`;
    els.guildDetailList.innerHTML = `<article class="empty-card">请选择一个妖盟查看详情。</article>`;
    return;
  }

  const detail = getGuildDetail(state.selectedGuild);
  if (!detail) {
    els.guildDetailTitle.textContent = "妖盟详情";
    els.guildDetailMeta.textContent = "当前妖盟未找到。";
    if (els.guildDetailActions) els.guildDetailActions.innerHTML = "";
    if (els.guildDetailSearch) els.guildDetailSearch.value = "";
    if (els.guildDetailRoleFilter) els.guildDetailRoleFilter.innerHTML = `<option value="all">全部等级</option>`;
    els.guildDetailList.innerHTML = `<article class="empty-card">没有找到该妖盟的数据。</article>`;
    return;
  }

  els.guildDetailTitle.textContent = detail.name;
  els.guildDetailMeta.textContent = `${detail.hill} · ${detail.members.length} 名成员 · 总战力 ${formatNumber(detail.power)}`;
  renderGuildDetailFilters(detail.members);
  if (els.guildDetailActions) {
    els.guildDetailActions.innerHTML = state.me.is_admin
      ? `<button type="button" class="primary-btn" data-action="import-excel">导入Excel</button>
         <button type="button" class="ghost-btn" data-action="export-members">导出成员</button>
         <button type="button" class="ghost-btn" data-action="add-member">新增成员</button>`
      : `<button type="button" class="ghost-btn" data-action="go-login">登录后管理成员</button>`;
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
                <p>等级 ${escapeHtml(member.role || "-")} · ${escapeHtml(member.realm)}</p>
              </div>
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
        ${state.me.is_admin ? `
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
    fragment.querySelector(".ranking-item__name").textContent = "";
    fragment.querySelector(".ranking-item__meta").textContent = `${getShortGuildName(member)} ${member.name || "-"} ${member.role || "-"} ${member.realm || "-"}`.replace(/\s+/g, " ").trim();
    fragment.querySelector(".ranking-item__power").textContent = formatNumber(member.power);
    els.rankingList.appendChild(fragment);
  });
  els.rankingList.insertAdjacentHTML("beforeend", renderSimplePagination("ranking-page", page));
}

function renderFeeds() {
  const announcements = state.announcements.filter((item) => item.category === "公告");
  const melonPosts = state.announcements.filter((item) => item.category === "瓜棚");
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

function renderFeedGroup(items, emptyText) {
  if (!items.length) return `<article class="empty-card">${emptyText}</article>`;
  return items.map((item) => {
    // 计算是否在2分钟内可撤回
    let canRevoke = false;
    if (item.created_at && state.me.authenticated) {
      const createdTime = new Date(item.created_at.replace(' ', 'T'));
      const now = new Date();
      const elapsed = (now - createdTime) / 1000; // 秒
      canRevoke = elapsed <= 120; // 2分钟 = 120秒
      // 检查是否是发布者本人
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
        <span class="feed-item__preview-hint">预览</span>
        ${canRevoke ? `<button type="button" class="melon-revoke-btn" data-melon-revoke="${item.id}">撤回</button>` : ''}
      </article>
    `;
  }).join("");
}

function renderAuth() {
  const authenticated = state.me.authenticated && state.me.is_admin;
  els.logoutBtn?.classList.toggle("hidden", !state.me.authenticated);
  els.loginForm?.classList.toggle("hidden", state.me.authenticated);
  if (els.loginNavButton) {
    els.loginNavButton.textContent = state.me.authenticated ? "退出登录" : "登录";
  }
  els.guildAdminGate?.classList.toggle("hidden", authenticated);
  els.guildAdminLayout?.classList.toggle("hidden", !authenticated);
  els.announcementAdminGate?.classList.toggle("hidden", authenticated);
  els.announcementAdminLayout?.classList.toggle("hidden", !authenticated);
  document.querySelector('[data-view="guildAdmin"]')?.classList.toggle("hidden", !state.me.is_admin);
  document.querySelector('[data-view="announcementAdmin"]')?.classList.toggle("hidden", !state.me.is_admin);
  if (els.loginState) {
    els.loginState.textContent = state.me.authenticated && state.me.user
      ? `当前用户：${state.me.is_admin ? (state.me.user.display_name || state.me.user.username) : state.me.user.username}${state.me.is_admin ? "（管理员）" : "（普通用户）"}`
      : "未登录";
  }
  if ((state.currentView === "guildAdmin" || state.currentView === "announcementAdmin") && !state.me.is_admin) {
    state.currentView = "guilds";
  }
  if (state.currentView === "login") {
    state.currentView = "guilds";
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
  document.querySelector("#memberAlliance").value = state.dashboard?.alliance_name || "🔮联盟";
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
        <div class="actions">
          <button class="action-btn action-btn--edit" data-action="edit-member" data-guild-key="${escapeHtml(guild.key)}">编辑</button>
          <button class="action-btn action-btn--delete" data-action="delete-member" data-guild-key="${escapeHtml(guild.key)}">删除</button>
        </div>
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
    alliance: guild.hill || guild.alliance || "🔮联盟",
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

function openMemberEditModal(member, guildKey) {
  if (!els.memberEditModal || !els.memberEditForm) return;
  const sourceMember = member || state.members.find((item) => buildGuildKey(item) === guildKey);
  const dashboardGuild = (state.dashboard?.guilds || []).find((guild) => {
    const key = guild.key || [guild.code || "", guild.prefix || "", guild.name || ""].join("|");
    return key === guildKey;
  });
  if (!sourceMember && !dashboardGuild) return;
  const isEdit = Boolean(member);
  const guildDisplayName = sourceMember
    ? getGuildDisplayName(sourceMember)
    : (dashboardGuild?.display_name || dashboardGuild?.displayName || [dashboardGuild?.code || "", dashboardGuild?.prefix || "", dashboardGuild?.name || ""].filter(Boolean).join(" "));
  const allianceName = sourceMember?.alliance || dashboardGuild?.alliance || dashboardGuild?.hill || "🔮联盟";
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
    els.screenshotPreviewTitle.textContent = `${member.name} 的游戏截图`;
  }
  els.screenshotPreviewImage.src = member.screenshot_url;
  els.screenshotPreviewImage.alt = `${member.name} 的游戏截图`;
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

  // 获取当前妖盟的信息
  const guildKey = state.selectedGuild;
  if (!guildKey) {
    toast("未选择妖盟");
    input.value = "";
    return;
  }

  // 解析guildKey获取妖盟信息
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
      message += `（Excel内去重 ${result.skipped_excel_duplicates} 人）`;
    }
    if (result.skipped_existing > 0) {
      message += `（已有成员跳过 ${result.skipped_existing} 人）`;
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
    await request(`/api/members/${memberId}/screenshot`, {
      method: "POST",
      body: formData,
    });
    await refreshAll();
    switchView("guildDetail");
    toast("成员截图上传成功");
  } catch (error) {
    toast(error.message);
  } finally {
    input.value = "";
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
    message: `确定删除联盟 ${hillName} 吗？该联盟下的所有妖盟和成员都会被一起删除。`,
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

function openDangerConfirm({ title = "确认删除", message = "此操作不可恢复，请确认是否继续。", confirmText = "确认删除" } = {}) {
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
  }
  if (event.key === "Escape" && !els.memberEditModal?.classList.contains("hidden")) {
    closeMemberEditModal();
  }
  if (event.key === "Escape" && !els.hillEditModal?.classList.contains("hidden")) {
    closeHillEditModal();
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
    alliance: dashboardGuild?.alliance || dashboardGuild?.hill || "🔮联盟",
    hill: dashboardGuild?.hill || dashboardGuild?.alliance || "🔮联盟",
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
      switchView(state.me.is_admin ? "guildAdmin" : "guilds");
    }
    return;
  }
  if (target.dataset.action === "add-member" && state.me.is_admin && state.selectedGuild) {
    openMemberEditModal(null, state.selectedGuild);
    return;
  }
  if (target.dataset.action === "import-excel" && state.me.is_admin && state.selectedGuild) {
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
  const memberId = target.dataset.id;
  if (!memberId) return;
  const member = state.members.find((item) => String(item.id) === memberId);
  if (!member) return;
  if (target.dataset.action === "preview-screenshot") {
    openScreenshotPreview(member);
    return;
  }
  if (target.dataset.action === "delete-screenshot") {
    if (!state.me.is_admin) return;
    deleteMemberScreenshot(member);
    return;
  }
  if (target.dataset.action === "upload-screenshot") {
    if (!state.me.is_admin) return;
    triggerMemberScreenshotUpload(member.id);
    return;
  }
  if (target.dataset.action === "edit-detail-member") {
    if (!state.me.is_admin) return;
    openMemberEditModal(member, buildGuildKey(member));
    return;
  }
  if (target.dataset.action === "delete-detail-member") {
    if (!state.me.is_admin) return;
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
    if (!state.me.is_admin) return;
    openHillEditModal(hillEditButton.dataset.editHill || "");
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

function normalizeEmptyDisplay(value) {
  return String(value ?? "").replace(/\u200B/g, "").trim();
}

function normalizeScaledInput(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  let normalized = raw.replaceAll(",", "").replaceAll("，", "").replace(/\s+/g, "");
  let multiplier = 1;

  const compositeUnits = [
    ["万亿", 1_000_000_000_000],
    ["萬億", 1_000_000_000_000],
  ];
  for (const [suffix, unitValue] of compositeUnits) {
    if (normalized.endsWith(suffix)) {
      multiplier = unitValue;
      normalized = normalized.slice(0, -suffix.length);
      break;
    }
  }

  if (multiplier === 1) {
    const unitMap = {
      k: 1_000,
      K: 1_000,
      千: 1_000,
      w: 10_000,
      W: 10_000,
      万: 10_000,
      亿: 100_000_000,
    };
    const suffix = normalized.slice(-1);
    if (unitMap[suffix]) {
      multiplier = unitMap[suffix];
      normalized = normalized.slice(0, -1);
    }
  }

  const number = Number(normalized || "0");
  if (!Number.isFinite(number)) {
    return raw;
  }
  return String(number * multiplier);
}

function formatOptionalMetric(value, suffix = "") {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number === 0) {
    return "-";
  }
  return `${formatNumber(number)}${suffix}`;
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";

  const abs = Math.abs(number);
  if (abs >= 1_000_000_000_000) {
    return `${trimTrailingZeros((number / 1_000_000_000_000).toFixed(2))}万亿`;
  }
  if (abs >= 100000000) {
    return `${trimTrailingZeros((number / 100000000).toFixed(2))}亿`;
  }
  if (abs >= 10000) {
    return `${trimTrailingZeros((number / 10000).toFixed(2))}万`;
  }
  if (Number.isInteger(number)) {
    return new Intl.NumberFormat("zh-CN").format(number);
  }
  return trimTrailingZeros(number.toFixed(2));
}

function trimTrailingZeros(text) {
  return String(text).replace(/\.?0+$/, "");
}

function getShortGuildName(member) {
  const guildName = String(member?.guild || "").replace(/妖盟$/u, "").trim();
  return guildName || getGuildDisplayName(member).replace(/妖盟$/u, "").trim();
}

function normalizeRichEditorHtml(html) {
  return String(html || "")
    .replace(/<div>/gi, "<p>")
    .replace(/<\/div>/gi, "</p>")
    .trim();
}

function htmlToPlainText(html) {
  const div = document.createElement("div");
  div.innerHTML = String(html || "");
  return (div.textContent || div.innerText || "").replace(/\s+/g, " ").trim();
}

function renderStoredContent(content) {
  const text = String(content || "");
  if (!/<[a-z][\s\S]*>/i.test(text)) {
    return escapeHtml(text).replace(/\n/g, "<br>");
  }
  return text;
}

function contentToEditorText(content) {
  const text = String(content || "");
  if (!/<[a-z][\s\S]*>/i.test(text)) {
    return text;
  }
  return htmlToPlainText(text);
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

function ensureVisibleHillPage(hills) {
  const totalPages = Math.max(1, hills.length);
  state.hillBrowsePage = Math.min(Math.max(1, state.hillBrowsePage || 1), totalPages);
}

function renderVisibleHillPagination(hills) {
  return "";
}

renderGuildSummary = function renderGuildSummaryOverride() {
  if (!els.guildSummary) return;
  const hills = getVisibleHills();
  if (!hills.length) {
    els.guildSummary.innerHTML = `<article class="empty-card">暂无符合条件的妖盟数据。</article>`;
    return;
  }

  ensureVisibleHillPage(hills);
  const displayHills = state.hillFilter === "all" ? [hills[state.hillBrowsePage - 1]] : hills;

  els.guildSummary.innerHTML = `
    ${displayHills.map((hill) => `
      <section class="hill-section">
        <header class="hill-section__head">
          <div class="hill-section__bar">
            <h2>${escapeHtml(hill.name)}</h2>
            ${state.me.is_admin ? `<button type="button" class="ghost-btn hill-section__edit-btn" data-edit-hill="${escapeHtml(hill.name)}">编辑联盟</button>` : ""}
          </div>
        </header>
        <div class="guild-card-grid">
          ${getPagedGuilds(hill).items.map((guild) => renderGuildCard(guild)).join("")}
        </div>
        ${renderHillPagination(hill)}
      </section>
    `).join("")}
  `;
};

function handleFeedListClick(event) {
  const rawTarget = event.target;
  if (!(rawTarget instanceof Element)) return;
  const revokeBtn = rawTarget.closest("[data-melon-revoke]");
  if (revokeBtn instanceof HTMLElement) {
    event.stopPropagation();
    const melonId = revokeBtn.dataset.melonRevoke;
    if (melonId) {
      handleMelonRevoke(melonId);
      return;
    }
  }
  const previewTrigger = rawTarget.closest("[data-feed-preview]");
  if (previewTrigger instanceof HTMLElement) {
    const itemId = previewTrigger.dataset.feedPreview;
    const item = state.announcements.find((entry) => String(entry.id) === String(itemId));
    if (item) {
      openFeedPreviewModal(item);
    }
  }
}

function openFeedPreviewModal(item) {
  if (!els.feedPreviewModal || !item) return;
  if (els.feedPreviewTitle) els.feedPreviewTitle.textContent = item.title || "预览";
  if (els.feedPreviewMeta) {
    els.feedPreviewMeta.textContent = `${item.created_at || ""}${item.author ? ` · ${item.author}` : ""}`;
  }
  if (els.feedPreviewContent) {
    els.feedPreviewContent.innerHTML = renderStoredContent(item.content || "");
  }
  els.feedPreviewModal.classList.remove("hidden");
}

function closeFeedPreviewModal() {
  els.feedPreviewModal?.classList.add("hidden");
}

function syncMelonEditorValue() {
  if (melonRichEditor && els.melonContent) {
    els.melonContent.value = normalizeRichEditorHtml(melonRichEditor.getHtml());
  }
}

function resetMelonEditor() {
  if (melonRichEditor) {
    melonRichEditor.setHtml("");
  }
  if (els.melonContent) {
    els.melonContent.value = "";
  }
}


