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
            ${hasPermission("manage_guilds") && canManageAlliance(hill.name) ? `<button type="button" class="ghost-btn hill-section__edit-btn" data-edit-hill="${escapeHtml(hill.name)}">编辑联盟</button>` : ""}
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


