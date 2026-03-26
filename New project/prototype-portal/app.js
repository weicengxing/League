const STORAGE_KEY = "alliance-portal-members";

const seedMembers = [
  { id: crypto.randomUUID(), alliance: "青云联盟", guild: "天狐妖盟", name: "青玄子", role: "盟主", realm: "化神后期", power: 328000, hp: 98000, attack: 23500, defense: 16800, speed: 9200, pet: "应龙", note: "主修暴击流，负责联盟指挥。" },
  { id: crypto.randomUUID(), alliance: "青云联盟", guild: "玄龟妖盟", name: "白芷", role: "副盟主", realm: "元婴圆满", power: 285600, hp: 86200, attack: 21000, defense: 15200, speed: 10100, pet: "九尾狐", note: "负责资源统计与招新审核。" },
  { id: crypto.randomUUID(), alliance: "青云联盟", guild: "赤羽妖盟", name: "曜尘", role: "长老", realm: "元婴后期", power: 243500, hp: 79800, attack: 18700, defense: 14500, speed: 8800, pet: "玄龟", note: "主抗伤阵容，联盟战前排。" }
];

const announcements = [
  { title: "联盟招新开启", content: "本周开放 2 个妖盟名额，要求活跃、配合填表。", date: "2026-03-23" },
  { title: "周日晚联盟战", content: "请各妖盟于 20:00 前同步主力战力和灵兽配置。", date: "2026-03-22" },
  { title: "资料表更新提醒", content: "新增成员后请第一时间录入，避免排行统计失真。", date: "2026-03-21" }
];

const melonPosts = [
  { title: "天狐妖盟昨晚冲榜成功", content: "前三主力全部破 30 万战，今天已经坐稳联盟第一梯队。", date: "2026-03-23" },
  { title: "玄龟妖盟准备换阵", content: "据说正在测试双反击流，有望下周冲进前二。", date: "2026-03-22" },
  { title: "赤羽妖盟开始补人", content: "缺 2 名活跃玩家，优先考虑能稳定更新资料的成员。", date: "2026-03-20" }
];

const state = {
  members: loadMembers(),
  search: "",
  guildFilter: "all",
  rankingGuildFilter: "all",
  sort: "power-desc"
};

const memberForm = document.querySelector("#memberForm");
const formTitle = document.querySelector("#formTitle");
const submitBtn = document.querySelector("#submitBtn");
const resetFormBtn = document.querySelector("#resetFormBtn");
const searchInput = document.querySelector("#searchInput");
const guildFilter = document.querySelector("#guildFilter");
const rankingGuildFilter = document.querySelector("#rankingGuildFilter");
const sortSelect = document.querySelector("#sortSelect");
const exportBtn = document.querySelector("#exportBtn");
const importInput = document.querySelector("#importInput");
const memberTableBody = document.querySelector("#memberTableBody");
const guildSummary = document.querySelector("#guildSummary");
const rankingList = document.querySelector("#rankingList");
const announcementList = document.querySelector("#announcementList");
const melonList = document.querySelector("#melonList");
const rankingItemTemplate = document.querySelector("#rankingItemTemplate");
const adminLoginBtn = document.querySelector("#adminLoginBtn");
const adminTip = document.querySelector("#adminTip");

const allianceNameEl = document.querySelector("#allianceName");
const memberCountEl = document.querySelector("#memberCount");
const totalPowerEl = document.querySelector("#totalPower");
const guildCountEl = document.querySelector("#guildCount");
const topMemberEl = document.querySelector("#topMember");
const topGuildEl = document.querySelector("#topGuild");

memberForm.addEventListener("submit", handleSubmit);
resetFormBtn.addEventListener("click", resetForm);
searchInput.addEventListener("input", (event) => {
  state.search = event.target.value.trim().toLowerCase();
  render();
});
guildFilter.addEventListener("change", (event) => {
  state.guildFilter = event.target.value;
  render();
});
rankingGuildFilter.addEventListener("change", (event) => {
  state.rankingGuildFilter = event.target.value;
  render();
});
sortSelect.addEventListener("change", (event) => {
  state.sort = event.target.value;
  render();
});
exportBtn.addEventListener("click", exportMembers);
importInput.addEventListener("change", importMembers);
memberTableBody.addEventListener("click", handleTableAction);
adminLoginBtn.addEventListener("click", () => {
  adminTip.textContent = "模拟登录成功：这里后续可以扩展为真实后台权限系统。";
});

render();
resetForm();

function loadMembers() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seedMembers));
    return seedMembers;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeMember) : seedMembers;
  } catch (error) {
    console.error("读取本地数据失败，已回退示例数据。", error);
    return seedMembers;
  }
}

function saveMembers() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.members));
}

function handleSubmit(event) {
  event.preventDefault();
  const formData = new FormData(memberForm);
  const payload = normalizeMember({
    id: formData.get("memberId") || crypto.randomUUID(),
    alliance: formData.get("alliance"),
    guild: formData.get("guild"),
    name: formData.get("name"),
    role: formData.get("role"),
    realm: formData.get("realm"),
    power: formData.get("power"),
    hp: formData.get("hp"),
    attack: formData.get("attack"),
    defense: formData.get("defense"),
    speed: formData.get("speed"),
    pet: formData.get("pet"),
    note: formData.get("note")
  });

  const existingIndex = state.members.findIndex((member) => member.id === payload.id);
  if (existingIndex >= 0) {
    state.members[existingIndex] = payload;
  } else {
    state.members.push(payload);
  }

  saveMembers();
  resetForm();
  render();
  window.location.hash = "guilds";
}

function handleTableAction(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const { action, id } = target.dataset;
  if (!action || !id) return;
  const member = state.members.find((item) => item.id === id);
  if (!member) return;

  if (action === "edit") {
    setField("memberId", member.id);
    setField("alliance", member.alliance);
    setField("guild", member.guild);
    setField("name", member.name);
    setField("role", member.role);
    setField("realm", member.realm);
    setField("power", member.power);
    setField("hp", member.hp);
    setField("attack", member.attack);
    setField("defense", member.defense);
    setField("speed", member.speed);
    setField("pet", member.pet);
    setField("note", member.note);
    formTitle.textContent = `编辑成员 · ${member.name}`;
    submitBtn.textContent = "更新成员信息";
    window.location.hash = "submit";
    return;
  }

  if (action === "delete") {
    state.members = state.members.filter((item) => item.id !== id);
    saveMembers();
    render();
  }
}

function setField(id, value) {
  const field = document.querySelector(`#${id}`);
  if (field) field.value = value;
}

function resetForm() {
  memberForm.reset();
  setField("memberId", "");
  setField("alliance", getPrimaryAllianceName());
  setField("role", "成员");
  formTitle.textContent = "新增成员信息";
  submitBtn.textContent = "保存成员信息";
}

function render() {
  syncHeader();
  renderStats();
  renderGuildFilters();
  renderGuildSummary();
  renderTable();
  renderRanking();
  renderFeeds();
}

function syncHeader() {
  allianceNameEl.textContent = getPrimaryAllianceName();
  memberCountEl.textContent = `${state.members.length} 名成员`;
}

function renderStats() {
  const totalPower = state.members.reduce((sum, member) => sum + member.power, 0);
  const guildMap = getGuildMap();
  const topMember = [...state.members].sort((a, b) => b.power - a.power)[0];
  const strongestGuild = [...guildMap.entries()].sort((a, b) => b[1].power - a[1].power)[0];
  totalPowerEl.textContent = formatNumber(totalPower);
  guildCountEl.textContent = String(guildMap.size);
  topMemberEl.textContent = topMember ? `${topMember.name} · ${formatNumber(topMember.power)}` : "暂无";
  topGuildEl.textContent = strongestGuild ? `${strongestGuild[0]} · ${formatNumber(strongestGuild[1].power)}` : "暂无";
}

function renderGuildFilters() {
  const guilds = [...new Set(state.members.map((member) => member.guild).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const options = [`<option value="all">全部妖盟</option>`, ...guilds.map((guild) => `<option value="${escapeHtml(guild)}">${escapeHtml(guild)}</option>`)].join("");
  guildFilter.innerHTML = options;
  rankingGuildFilter.innerHTML = options;
  guildFilter.value = guilds.includes(state.guildFilter) ? state.guildFilter : "all";
  rankingGuildFilter.value = guilds.includes(state.rankingGuildFilter) ? state.rankingGuildFilter : "all";
  state.guildFilter = guildFilter.value;
  state.rankingGuildFilter = rankingGuildFilter.value;
}

function renderGuildSummary() {
  const guildMap = [...getGuildMap().entries()].sort((a, b) => b[1].power - a[1].power);
  if (!guildMap.length) {
    guildSummary.innerHTML = `<p class="empty-state">暂无妖盟数据。</p>`;
    return;
  }

  guildSummary.innerHTML = guildMap.map(([guildName, info]) => `
    <article class="guild-card">
      <h3>${escapeHtml(guildName)}</h3>
      <p>成员数量：${info.count} 人</p>
      <p>总战力：${formatNumber(info.power)}</p>
      <p>最高成员：${escapeHtml(info.topMember.name)} · ${formatNumber(info.topMember.power)}</p>
      <p>联盟：${escapeHtml(info.topMember.alliance)}</p>
    </article>
  `).join("");
}

function renderTable() {
  const members = getVisibleMembers();
  if (!members.length) {
    memberTableBody.innerHTML = `<tr><td colspan="13"><p class="empty-state">没有匹配的数据，试试更换搜索词或筛选条件。</p></td></tr>`;
    return;
  }

  memberTableBody.innerHTML = members.map((member) => `
    <tr>
      <td>${escapeHtml(member.alliance)}</td>
      <td>${escapeHtml(member.guild)}</td>
      <td>${escapeHtml(member.name)}</td>
      <td><span class="tag">${escapeHtml(member.role)}</span></td>
      <td>${escapeHtml(member.realm)}</td>
      <td>${formatNumber(member.power)}</td>
      <td>${formatNumber(member.hp)}</td>
      <td>${formatNumber(member.attack)}</td>
      <td>${formatNumber(member.defense)}</td>
      <td>${formatNumber(member.speed)}</td>
      <td>${escapeHtml(member.pet)}</td>
      <td>${escapeHtml(member.note || "-")}</td>
      <td>
        <div class="actions">
          <button class="action-btn action-btn--edit" data-action="edit" data-id="${member.id}">编辑</button>
          <button class="action-btn action-btn--delete" data-action="delete" data-id="${member.id}">删除</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderRanking() {
  rankingList.innerHTML = "";
  const topMembers = [...state.members]
    .filter((member) => state.rankingGuildFilter === "all" || member.guild === state.rankingGuildFilter)
    .sort(sorters[state.sort])
    .slice(0, 10);

  if (!topMembers.length) {
    rankingList.innerHTML = `<p class="empty-state">暂无排行数据。</p>`;
    return;
  }

  topMembers.forEach((member, index) => {
    const fragment = rankingItemTemplate.content.cloneNode(true);
    fragment.querySelector(".ranking-item__index").textContent = String(index + 1);
    fragment.querySelector(".ranking-item__name").textContent = member.name;
    fragment.querySelector(".ranking-item__meta").textContent = `${member.guild} · ${member.role} · ${member.realm} · 灵兽 ${member.pet}`;
    fragment.querySelector(".ranking-item__power").textContent = formatNumber(member.power);
    rankingList.appendChild(fragment);
  });
}

function renderFeeds() {
  announcementList.innerHTML = announcements.map(renderFeedItem).join("");
  melonList.innerHTML = melonPosts.map(renderFeedItem).join("");
}

function renderFeedItem(item) {
  return `<article class="feed-item"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.content)}</p><small>${item.date}</small></article>`;
}

function getVisibleMembers() {
  return state.members
    .filter((member) => {
      if (state.guildFilter !== "all" && member.guild !== state.guildFilter) return false;
      if (!state.search) return true;
      const text = `${member.alliance} ${member.guild} ${member.name} ${member.role} ${member.realm} ${member.pet} ${member.note}`.toLowerCase();
      return text.includes(state.search);
    })
    .sort(sorters[state.sort]);
}

function getGuildMap() {
  return state.members.reduce((map, member) => {
    const entry = map.get(member.guild) || { count: 0, power: 0, topMember: member };
    entry.count += 1;
    entry.power += member.power;
    if (member.power > entry.topMember.power) entry.topMember = member;
    map.set(member.guild, entry);
    return map;
  }, new Map());
}

function getPrimaryAllianceName() {
  return state.members[0]?.alliance || "青云联盟";
}

function exportMembers() {
  const blob = new Blob([JSON.stringify(state.members, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "alliance-portal-members.json";
  link.click();
  URL.revokeObjectURL(url);
}

function importMembers(event) {
  const [file] = event.target.files || [];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (!Array.isArray(parsed)) throw new Error("导入文件格式不正确");
      state.members = parsed.map(normalizeMember);
      saveMembers();
      render();
      resetForm();
    } catch (error) {
      alert("导入失败，请确认 JSON 文件格式正确。");
      console.error(error);
    } finally {
      importInput.value = "";
    }
  };
  reader.readAsText(file, "utf-8");
}

function normalizeMember(member) {
  return {
    id: member.id || crypto.randomUUID(),
    alliance: String(member.alliance || "青云联盟").trim(),
    guild: String(member.guild || "未分组妖盟").trim(),
    name: String(member.name || "未命名成员").trim(),
    role: String(member.role || "成员").trim(),
    realm: String(member.realm || "待补充").trim(),
    power: Number(member.power) || 0,
    hp: Number(member.hp) || 0,
    attack: Number(member.attack) || 0,
    defense: Number(member.defense) || 0,
    speed: Number(member.speed) || 0,
    pet: String(member.pet || "待补充").trim(),
    note: String(member.note || "").trim()
  };
}

const sorters = {
  "power-desc": (a, b) => b.power - a.power,
  "power-asc": (a, b) => a.power - b.power,
  "name-asc": (a, b) => a.name.localeCompare(b.name, "zh-CN")
};

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
