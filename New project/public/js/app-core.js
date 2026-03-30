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
    toast(`新瓜动态：${item.title}`);
  }
}

async function handleMelonNewEvent(eventData) {
  const melonId = String(eventData?.id || "");
  const alreadyPresent = melonId ? state.announcements.some((item) => String(item.id) === melonId) : false;
  await fetchAnnouncements();
  if (!alreadyPresent) {
    toast(eventData?.title ? `新瓜动态：${eventData.title}` : "有新的瓜动态");
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
          return;
        }
        if (data.type === "admin_role_request_created") {
          handleAdminRoleRequestCreated(data);
          return;
        }
        if (data.type === "admin_role_request_reviewed") {
          handleAdminRoleRequestReviewed(data);
          return;
        }
        if (data.type === "member_cert_request_created") {
          handleMemberCertRequestCreated(data);
          return;
        }
        if (data.type === "member_cert_request_reviewed") {
          handleMemberCertRequestReviewed(data);
          return;
        }
        if (data.type === "identity_swap_request_created") {
          handleIdentitySwapRequestCreated(data);
          return;
        }
        if (data.type === "identity_swap_request_reviewed") {
          handleIdentitySwapRequestReviewed(data);
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

async function handleAdminRoleRequestCreated(data) {
  if (!hasPermission("manage_roles")) return;
  try {
    await loadRoleRequests();
    renderAuth();
    if (!els.roleRequestModal?.classList.contains("hidden")) {
      renderRoleRequestList();
    }
  } catch (error) {
    console.error("[Auth WS] Failed to refresh role requests:", error);
  }
  const label = data?.request_type === "alliance" ? "联盟盟主" : "妖盟盟主";
  toast(`新的${label}申请：${data?.username || "有用户"}提交了申请`);
}

async function handleAdminRoleRequestReviewed(data) {
  try {
    await loadRoleRequests();
    renderAuth();
    if (!els.roleRequestModal?.classList.contains("hidden")) {
      renderRoleRequestList();
    }
  } catch (error) {
    console.error("[Auth WS] Failed to refresh reviewed role requests:", error);
  }
  const statusLabel = data?.status === "approved" ? "已通过" : "已拒绝";
  toast(hasPermission("manage_roles") ? `申请已被处理：${statusLabel}` : `你的盟主申请${statusLabel}`);
}

async function handleMemberCertRequestCreated(data) {
  if (!canReviewMemberRequests()) return;
  try {
    await loadMemberCertRequests();
    renderAuth();
    if (!els.certRequestModal?.classList.contains("hidden")) {
      renderCertRequestList();
    }
  } catch (error) {
    console.error("[Auth WS] Failed to refresh member cert requests:", error);
  }
  toast(`新的认证申请：${data?.username || "有用户"} 申请认领 ${data?.member_name || "成员"}`);
}

async function handleMemberCertRequestReviewed(data) {
  try {
    await loadMyMemberRequests();
    if (canReviewMemberRequests()) {
      await loadMemberCertRequests();
    }
    renderAuth();
    renderGuildDetail();
    if (!els.certRequestModal?.classList.contains("hidden")) {
      renderCertRequestList();
    }
  } catch (error) {
    console.error("[Auth WS] Failed to refresh reviewed member cert requests:", error);
  }
  const statusLabel = data?.status === "approved" ? "已通过" : "已拒绝";
  toast(`认证申请已被处理：${statusLabel}`);
}

async function handleIdentitySwapRequestCreated(data) {
  try {
    await loadIdentitySwapRequests();
    renderAuth();
    if (!els.identitySwapRequestModal?.classList.contains("hidden")) {
      renderIdentitySwapRequestList();
    }
  } catch (error) {
    console.error("[Auth WS] Failed to refresh identity swap requests:", error);
  }
  toast(`新的身份交换申请：${data?.username || "有用户"}发起了申请`);
}

async function handleIdentitySwapRequestReviewed(data) {
  try {
    await Promise.all([fetchMe(), loadDashboard(), fetchMembers()]);
    await loadIdentitySwapRequests();
    renderAuth();
    renderProfilePage();
    renderGuildDetail();
    if (!els.identitySwapRequestModal?.classList.contains("hidden")) {
      renderIdentitySwapRequestList();
    }
  } catch (error) {
    console.error("[Auth WS] Failed to refresh reviewed identity swap requests:", error);
  }
  const statusLabel = data?.status === "approved" ? "已同意" : "已拒绝";
  toast(`身份交换申请已被处理：${statusLabel}`);
}

const state = {
  dashboard: null,
  members: [],
  announcements: [],
  me: { authenticated: false, user: null, is_admin: false },
  roleRequests: [],
  roleRequestUnreadCount: 0,
  memberRequests: [],
  memberRequestUnreadCount: 0,
  myMemberRequests: [],
  myMemberRequestUnreadCount: 0,
  identitySwapOptions: [],
  identitySwapRequests: [],
  identitySwapUnreadCount: 0,
  selectedMemberCertId: null,
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
  pendingProfileUploadType: "",
};

const els = {
  allianceName: document.querySelector("#allianceName"),
  memberCount: document.querySelector("#memberCount"),
  guildCount: document.querySelector("#guildCount"),
  viewButtons: [...document.querySelectorAll(".top-pills__btn")],
  viewPanels: [...document.querySelectorAll(".board-panel")],
  guildSummary: document.querySelector("#guildSummary"),
  profilePage: document.querySelector("#profilePage"),
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
  roleRequestBtn: document.querySelector("#roleRequestBtn"),
  certRequestBtn: document.querySelector("#certRequestBtn"),
  identitySwapBtn: document.querySelector("#identitySwapBtn"),
  identitySwapRequestBtn: document.querySelector("#identitySwapRequestBtn"),
  roleApplyBtn: document.querySelector("#roleApplyBtn"),
  roleRequestModal: document.querySelector("#roleRequestModal"),
  roleRequestList: document.querySelector("#roleRequestList"),
  roleApplyModal: document.querySelector("#roleApplyModal"),
  roleApplyForm: document.querySelector("#roleApplyForm"),
  roleApplyType: document.querySelector("#roleApplyType"),
  roleApplyTargetLabel: document.querySelector("#roleApplyTargetLabel"),
  roleApplyAlliance: document.querySelector("#roleApplyAlliance"),
  certRequestModal: document.querySelector("#certRequestModal"),
  certRequestList: document.querySelector("#certRequestList"),
  identitySwapModal: document.querySelector("#identitySwapModal"),
  identitySwapForm: document.querySelector("#identitySwapModal #identitySwapForm"),
  identitySwapAlliance: document.querySelector("#identitySwapModal #identitySwapAlliance"),
  identitySwapGuild: document.querySelector("#identitySwapModal #identitySwapGuild"),
  identitySwapMember: document.querySelector("#identitySwapModal #identitySwapMember"),
  identitySwapMessage: document.querySelector("#identitySwapModal #identitySwapMessage"),
  identitySwapSummary: document.querySelector("#identitySwapModal #identitySwapSummary"),
  identitySwapRequestModal: document.querySelector("#identitySwapRequestModal"),
  identitySwapRequestList: document.querySelector("#identitySwapRequestList"),
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
  profileAvatarInput: document.querySelector("#profileAvatarInput"),
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
ensureRoleUi();
setupRichTextEditors();
bindEvents();
boot();

function ensureRoleUi() {
  if (!document.querySelector("#roleApplyBtn")) {
    const topActions = document.createElement("div");
    topActions.className = "board-top__actions";
    topActions.innerHTML = `
      <button id="roleApplyBtn" type="button" class="ghost-btn action-btn--apply">申请联盟管理员</button>
      <button id="roleRequestBtn" type="button" class="ghost-btn action-btn--approve">
        申请列表<span id="roleRequestBadge" class="btn-badge hidden">0</span>
      </button>
      <button id="certRequestBtn" type="button" class="ghost-btn action-btn--approve">
        认证申请<span id="certRequestBadge" class="btn-badge hidden">0</span>
      </button>
      <button id="identitySwapBtn" type="button" class="ghost-btn">交换身份</button>
      <button id="identitySwapRequestBtn" type="button" class="ghost-btn">
        交换申请<span id="identitySwapRequestBadge" class="btn-badge hidden">0</span>
      </button>
    `;
    document.querySelector(".board-top")?.appendChild(topActions);
  }

  const roleRequestBtn = document.querySelector("#roleRequestBtn");
  if (roleRequestBtn && !roleRequestBtn.querySelector("#roleRequestBadge")) {
    roleRequestBtn.insertAdjacentHTML("beforeend", `<span id="roleRequestBadge" class="btn-badge hidden">0</span>`);
  }
  const certRequestBtn = document.querySelector("#certRequestBtn");
  if (certRequestBtn && !certRequestBtn.querySelector("#certRequestBadge")) {
    certRequestBtn.insertAdjacentHTML("beforeend", `<span id="certRequestBadge" class="btn-badge hidden">0</span>`);
  }
  const identitySwapRequestBtn = document.querySelector("#identitySwapRequestBtn");
  if (identitySwapRequestBtn && !identitySwapRequestBtn.querySelector("#identitySwapRequestBadge")) {
    identitySwapRequestBtn.insertAdjacentHTML("beforeend", `<span id="identitySwapRequestBadge" class="btn-badge hidden">0</span>`);
  }

  if (!document.querySelector("#roleApplyModal")) {
    document.body.insertAdjacentHTML("beforeend", `
      <div id="roleApplyModal" class="modal hidden">
        <div class="modal__backdrop" data-close-modal="role-apply"></div>
        <div class="modal__dialog">
          <div class="modal__head">
            <h3>申请联盟管理员</h3>
            <button type="button" class="ghost-btn" data-close-modal="role-apply">关闭</button>
          </div>
          <form id="roleApplyForm" class="stack-form modal-form">
            <label>
              <span>申请类型</span>
              <select id="roleApplyType">
                <option value="guild">申请妖盟盟主</option>
                <option value="alliance">申请联盟盟主</option>
              </select>
            </label>
            <label>
              <span id="roleApplyTargetLabel">目标妖盟</span>
              <select id="roleApplyAlliance"></select>
            </label>
            <div class="modal-actions">
              <button type="button" class="ghost-btn" data-close-modal="role-apply">取消</button>
              <button type="submit" class="primary-btn">提交申请</button>
            </div>
          </form>
        </div>
      </div>
      <div id="roleRequestModal" class="modal hidden">
        <div class="modal__backdrop" data-close-modal="role-request"></div>
        <div class="modal__dialog modal__dialog--wide">
          <div class="modal__head">
            <h3>联盟管理员申请列表</h3>
            <button type="button" class="ghost-btn" data-close-modal="role-request">关闭</button>
          </div>
          <div id="roleRequestList" class="modal__body"></div>
        </div>
      </div>
      <div id="certRequestModal" class="modal hidden">
        <div class="modal__backdrop" data-close-modal="cert-request"></div>
        <div class="modal__dialog modal__dialog--wide">
          <div class="modal__head">
            <h3>成员认证申请</h3>
            <button type="button" class="ghost-btn" data-close-modal="cert-request">关闭</button>
          </div>
          <div id="certRequestList" class="modal__body"></div>
        </div>
      </div>
      <div id="identitySwapRequestModal" class="modal hidden">
        <div class="modal__backdrop" data-close-modal="identity-swap-request"></div>
        <div class="modal__dialog modal__dialog--wide">
          <div class="modal__head">
            <h3>身份交换申请</h3>
            <button type="button" class="ghost-btn" data-close-modal="identity-swap-request">关闭</button>
          </div>
          <div id="identitySwapRequestList" class="modal__body"></div>
        </div>
      </div>
    `);
  }

  els.roleApplyBtn = document.querySelector("#roleApplyBtn");
  els.roleRequestBtn = document.querySelector("#roleRequestBtn");
  els.certRequestBtn = document.querySelector("#certRequestBtn");
  els.identitySwapBtn = document.querySelector("#identitySwapBtn");
  els.identitySwapRequestBtn = document.querySelector("#identitySwapRequestBtn");
  els.roleApplyModal = document.querySelector("#roleApplyModal");
  els.roleRequestModal = document.querySelector("#roleRequestModal");
  els.certRequestModal = document.querySelector("#certRequestModal");
  els.identitySwapModal = document.querySelector("#identitySwapModal");
  els.identitySwapRequestModal = document.querySelector("#identitySwapRequestModal");
  els.roleApplyForm = document.querySelector("#roleApplyForm");
  els.roleApplyType = document.querySelector("#roleApplyType");
  els.roleApplyTargetLabel = document.querySelector("#roleApplyTargetLabel");
  els.roleApplyAlliance = document.querySelector("#roleApplyAlliance");
  els.roleRequestList = document.querySelector("#roleRequestList");
  els.certRequestList = document.querySelector("#certRequestList");
  els.identitySwapForm = document.querySelector("#identitySwapModal #identitySwapForm");
  els.identitySwapAlliance = document.querySelector("#identitySwapModal #identitySwapAlliance");
  els.identitySwapGuild = document.querySelector("#identitySwapModal #identitySwapGuild");
  els.identitySwapMember = document.querySelector("#identitySwapModal #identitySwapMember");
  els.identitySwapMessage = document.querySelector("#identitySwapModal #identitySwapMessage");
  els.identitySwapSummary = document.querySelector("#identitySwapModal #identitySwapSummary");
  els.identitySwapRequestList = document.querySelector("#identitySwapRequestList");
}

function setupUserProfileUI() {
  els.viewButtons = [...document.querySelectorAll(".top-pills__btn")];
  els.viewPanels = [...document.querySelectorAll(".board-panel")];

  for (const [element, placeholder] of [
    [document.querySelector("#memberGuildPower"), "支持小数，可写 26 万亿"],
    [els.memberEditPower, "支持小数，可写 4538.99 万"],
    [els.memberEditSpeed, "支持小数，可写 1.58 万"],
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
    els.guildEditPower.setAttribute("placeholder", "支持小数，可写 26 万亿");
  }
  if (els.guildEditLeader) {
    els.guildEditLeader.removeAttribute("required");
    els.guildEditLeader.setAttribute("placeholder", "可留空");
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
  els.roleApplyBtn?.addEventListener("click", openRoleApplyModal);
  els.roleApplyForm?.addEventListener("submit", submitRoleApplyForm);
  els.roleApplyType?.addEventListener("change", syncRoleApplyTargetOptions);
  els.roleRequestBtn?.addEventListener("click", openRoleRequestModal);
  els.certRequestBtn?.addEventListener("click", () => openCertRequestModal());
  els.identitySwapBtn?.addEventListener("click", openIdentitySwapModal);
  els.identitySwapRequestBtn?.addEventListener("click", openIdentitySwapRequestModal);
  els.identitySwapForm?.addEventListener("submit", submitIdentitySwapForm);
  els.identitySwapAlliance?.addEventListener("change", () => syncIdentitySwapOptions("alliance"));
  els.identitySwapGuild?.addEventListener("change", () => syncIdentitySwapOptions("guild"));
  els.identitySwapMember?.addEventListener("change", () => syncIdentitySwapSummary());
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
  els.profilePage?.addEventListener("click", handleProfileAction);
  els.profilePage?.addEventListener("submit", handleProfileSubmit);
  els.memberScreenshotInput?.addEventListener("change", handleMemberScreenshotSelected);
  els.profileAvatarInput?.addEventListener("change", handleProfileAvatarSelected);
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
  
  // 鐡滄鍙戝竷琛ㄥ崟
  const melonPostForm = document.querySelector("#melonPostForm");
  if (melonPostForm) {
    melonPostForm.addEventListener("submit", handleMelonPostSubmit);
  }
  
  // 鐡滄鎾ゅ洖鎸夐挳
  document.addEventListener("click", (event) => {
    const revokeBtn = event.target.closest("[data-melon-revoke]");
    if (revokeBtn instanceof HTMLElement) {
      const melonId = revokeBtn.dataset.melonRevoke;
      if (melonId) {
        handleMelonRevoke(melonId);
      }
    }
  });
  document.addEventListener("click", async (event) => {
    const requestAction = event.target.closest("[data-request-action]");
    if (!(requestAction instanceof HTMLElement)) return;
    await reviewMemberRequest(requestAction.dataset.id, requestAction.dataset.requestAction);
  });
  document.addEventListener("click", async (event) => {
    const roleAction = event.target.closest("[data-role-request-action]");
    if (!(roleAction instanceof HTMLElement)) return;
    await reviewRoleRequest(roleAction.dataset.id, roleAction.dataset.roleRequestAction);
  });
  document.addEventListener("click", async (event) => {
    const identitySwapAction = event.target.closest("[data-identity-swap-action]");
    if (!(identitySwapAction instanceof HTMLElement)) return;
    await reviewIdentitySwapRequest(identitySwapAction.dataset.id, identitySwapAction.dataset.identitySwapAction);
  });
  
  // 创建隐藏的文件输入框用于 Excel 导入
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

