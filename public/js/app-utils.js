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

function buildFeedSummary(content, maxLength = 88) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderStoredContent(content || "");
  const imageCount = wrapper.querySelectorAll("img").length;
  const plainText = (wrapper.textContent || wrapper.innerText || "").replace(/\s+/g, " ").trim();
  const imageLabel = imageCount > 0 ? `[图片${imageCount > 1 ? ` ${imageCount}` : ""}]` : "";
  const combined = [imageLabel, plainText].filter(Boolean).join(" ");
  if (!combined) return "点击查看详情";
  return combined.length > maxLength ? `${combined.slice(0, maxLength).trim()}...` : combined;
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

function getPendingMelonImageObjectUrls(content = "") {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = String(content || "");
  return [...new Set(
    [...wrapper.querySelectorAll("img")]
      .map((image) => String(image.getAttribute("src") || "").trim())
      .filter((src) => src.startsWith("blob:"))
  )];
}

function cleanupPendingMelonImages(targets) {
  const values = [...new Set((targets || []).filter(Boolean))];
  for (const value of values) {
    let entryKey = "";
    let entry = pendingMelonImageFiles.get(value);
    if (entry) {
      entryKey = value;
    } else {
      for (const [tempId, pendingEntry] of pendingMelonImageFiles.entries()) {
        if (pendingEntry?.objectUrl === value) {
          entryKey = tempId;
          entry = pendingEntry;
          break;
        }
      }
    }
    if (!entry) continue;
    if (entry.objectUrl) {
      URL.revokeObjectURL(entry.objectUrl);
    }
    pendingMelonImageFiles.delete(entryKey);
  }
}

function resetMelonEditor({ cleanup = true } = {}) {
  const currentHtml = melonRichEditor?.getHtml?.() || els.melonContent?.value || "";
  const objectUrls = cleanup ? getPendingMelonImageObjectUrls(currentHtml) : [];
  if (melonRichEditor) {
    melonRichEditor.setHtml("");
  }
  if (els.melonContent) {
    els.melonContent.value = "";
  }
  if (cleanup && objectUrls.length) {
    cleanupPendingMelonImages(objectUrls);
  }
}

function insertMelonImage(url, altText = "瓜棚图片") {
  if (!melonRichEditor || !url) return;
  const safeUrl = escapeHtml(String(url));
  const safeAlt = escapeHtml(String(altText || "瓜棚图片"));
  const html = `<p><img src="${safeUrl}" alt="${safeAlt}"></p>`;
  if (typeof melonRichEditor.dangerouslyInsertHtml === "function") {
    melonRichEditor.dangerouslyInsertHtml(html);
  } else if (typeof melonRichEditor.getHtml === "function" && typeof melonRichEditor.setHtml === "function") {
    melonRichEditor.setHtml(`${melonRichEditor.getHtml() || ""}${html}`);
  }
  syncMelonEditorValue();
}

function validateMelonImageFile(file) {
  if (!file) throw new Error("请选择图片");
  if (!String(file.type || "").startsWith("image/")) {
    throw new Error("仅支持图片文件");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("图片不能超过 10MB");
  }
}

function buildPendingMelonImageSrc(tempId) {
  return `/uploads/melon/__pending__/${encodeURIComponent(String(tempId || ""))}`;
}

function insertMelonImageFromFile(file) {
  validateMelonImageFile(file);
  const tempId = `melon_temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const objectUrl = URL.createObjectURL(file);
  pendingMelonImageFiles.set(tempId, {
    file,
    objectUrl,
    alt: file?.name || "瓜棚图片",
  });
  insertMelonImage(objectUrl, file?.name || "瓜棚图片");
  toast("图片已插入");
}

function prepareMelonContentForSubmit(content) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = String(content || "");
  const images = [...wrapper.querySelectorAll("img")];
  const pendingImages = [];
  for (const image of images) {
    const src = String(image.getAttribute("src") || "").trim();
    if (!src.startsWith("blob:")) continue;
    const pendingEntry = [...pendingMelonImageFiles.entries()].find(([, value]) => value?.objectUrl === src);
    const [tempId, pending] = pendingEntry || [];
    if (!tempId || !pending?.file) {
      throw new Error("存在未准备好的图片，请重新插入后再试");
    }
    validateMelonImageFile(pending.file);
    image.setAttribute("src", buildPendingMelonImageSrc(tempId));
    image.setAttribute("alt", image.getAttribute("alt") || pending.alt || "瓜棚图片");
    pendingImages.push({
      tempId,
      file: pending.file,
      alt: image.getAttribute("alt") || pending.alt || "瓜棚图片",
    });
  }
  return {
    content: wrapper.innerHTML,
    pendingImages,
  };
}

async function handleMelonClipboardPaste(event) {
  const items = Array.from(event?.clipboardData?.items || []);
  const imageItem = items.find((item) => String(item.type || "").startsWith("image/"));
  if (!imageItem) return;
  event.preventDefault();
  const file = imageItem.getAsFile();
  if (!file) return;
  try {
    insertMelonImageFromFile(file);
  } catch (error) {
    toast(error.message || "图片粘贴失败");
  }
}

async function handleMelonPasteImageClick() {
  if (!navigator.clipboard?.read) {
    els.melonImageInput?.click();
    return;
  }
  try {
    const clipboardItems = await navigator.clipboard.read();
    for (const item of clipboardItems) {
      const imageType = item.types.find((type) => type.startsWith("image/"));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      const extension = imageType.split("/")[1] || "png";
      const file = new File([blob], `melon-paste.${extension}`, { type: imageType });
      insertMelonImageFromFile(file);
      return;
    }
    toast("剪贴板中没有图片");
  } catch (error) {
    toast(error.message || "读取剪贴板失败，请确认已复制图片并允许访问剪贴板");
  }
}

async function handleMelonImageSelected(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  try {
    insertMelonImageFromFile(file);
  } catch (error) {
    toast(error.message || "图片上传失败");
  } finally {
    if (event?.target) {
      event.target.value = "";
    }
  }
}


