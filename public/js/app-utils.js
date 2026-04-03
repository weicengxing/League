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
  const wrapper = document.createElement("div");
  wrapper.innerHTML = text;
  for (const link of [...wrapper.querySelectorAll("a[href]")]) {
    const href = String(link.getAttribute("href") || "").trim();
    const lowerHref = href.toLowerCase();
    if (lowerHref.endsWith(".mp3")) {
      const audio = document.createElement("audio");
      audio.setAttribute("controls", "");
      audio.setAttribute("preload", "metadata");
      audio.setAttribute("src", href);
      link.replaceWith(audio);
      continue;
    }
    if (lowerHref.endsWith(".mp4")) {
      const video = document.createElement("video");
      video.setAttribute("controls", "");
      video.setAttribute("preload", "metadata");
      video.setAttribute("src", href);
      link.replaceWith(video);
    }
  }
  return wrapper.innerHTML;
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
  if (rawTarget.closest("a[href], audio, video")) {
    return;
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

const MELON_ALLOWED_FILE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".docx", ".txt", ".pptx", ".mp3", ".mp4"]);
const MELON_ALLOWED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const MELON_ALLOWED_AUDIO_EXTENSIONS = new Set([".mp3"]);
const MELON_ALLOWED_VIDEO_EXTENSIONS = new Set([".mp4"]);
const MELON_MAX_FILE_SIZE = 50 * 1024 * 1024;

function getPendingMelonAssetObjectUrls(content = "") {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = String(content || "");
  return [...new Set(
    [
      ...[...wrapper.querySelectorAll("img")]
        .map((image) => String(image.getAttribute("src") || "").trim()),
      ...[...wrapper.querySelectorAll("a")]
        .map((link) => String(link.getAttribute("href") || "").trim()),
      ...[...wrapper.querySelectorAll("audio, video")]
        .map((media) => String(media.getAttribute("src") || "").trim()),
    ].filter((src) => src.startsWith("blob:"))
  )];
}

function cleanupPendingMelonAssets(targets) {
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
  const objectUrls = cleanup ? getPendingMelonAssetObjectUrls(currentHtml) : [];
  if (melonRichEditor) {
    melonRichEditor.setHtml("");
  }
  if (els.melonContent) {
    els.melonContent.value = "";
  }
  if (cleanup && objectUrls.length) {
    cleanupPendingMelonAssets(objectUrls);
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
  if (file.size > MELON_MAX_FILE_SIZE) {
    throw new Error("文件不能超过 50MB");
  }
}

function validateMelonAssetFile(file) {
  if (!file) throw new Error("请选择文件");
  const name = String(file.name || "");
  const suffix = name.includes(".") ? `.${name.split(".").pop().toLowerCase()}` : "";
  if (!MELON_ALLOWED_FILE_EXTENSIONS.has(suffix)) {
    throw new Error("仅支持图片、PDF、DOCX、TXT、PPTX、MP3、MP4");
  }
  if (file.size > MELON_MAX_FILE_SIZE) {
    throw new Error("文件不能超过 50MB");
  }
}

async function createMelonObjectUrl(file) {
  const name = String(file?.name || "");
  const suffix = name.includes(".") ? `.${name.split(".").pop().toLowerCase()}` : "";
  let mimeType = String(file?.type || "").trim() || "application/octet-stream";
  if (suffix === ".txt") {
    const buffer = await file.arrayBuffer();
    let text = "";
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      try {
        text = new TextDecoder("gb18030").decode(buffer);
      } catch {
        text = new TextDecoder("utf-8").decode(buffer);
      }
    }
    return URL.createObjectURL(new Blob([text], { type: "text/plain; charset=utf-8" }));
  } else if (suffix === ".pdf") {
    mimeType = "application/pdf";
  } else if (suffix === ".mp3") {
    mimeType = "audio/mpeg";
  } else if (suffix === ".mp4") {
    mimeType = "video/mp4";
  }
  return URL.createObjectURL(new Blob([file], { type: mimeType }));
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

function insertMelonFileLink(url, fileName = "附件") {
  if (!melonRichEditor || !url) return;
  const safeUrl = escapeHtml(String(url));
  const safeName = escapeHtml(String(fileName || "附件"));
  const html = `<p><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeName}</a></p>`;
  if (typeof melonRichEditor.dangerouslyInsertHtml === "function") {
    melonRichEditor.dangerouslyInsertHtml(html);
  } else if (typeof melonRichEditor.getHtml === "function" && typeof melonRichEditor.setHtml === "function") {
    melonRichEditor.setHtml(`${melonRichEditor.getHtml() || ""}${html}`);
  }
  syncMelonEditorValue();
}

function insertMelonMedia(url, fileName = "附件", kind = "file") {
  if (!melonRichEditor || !url) return;
  const safeUrl = escapeHtml(String(url));
  const safeName = escapeHtml(String(fileName || "附件"));
  let html = "";
  if (kind === "audio") {
    html = `<p><audio controls preload="metadata" src="${safeUrl}">${safeName}</audio></p>`;
  } else if (kind === "video") {
    html = `<p><video controls preload="metadata" src="${safeUrl}"></video></p>`;
  } else {
    html = `<p><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeName}</a></p>`;
  }
  if (typeof melonRichEditor.dangerouslyInsertHtml === "function") {
    melonRichEditor.dangerouslyInsertHtml(html);
  } else if (typeof melonRichEditor.getHtml === "function" && typeof melonRichEditor.setHtml === "function") {
    melonRichEditor.setHtml(`${melonRichEditor.getHtml() || ""}${html}`);
  }
  syncMelonEditorValue();
}

async function insertMelonAssetFromFile(file) {
  validateMelonAssetFile(file);
  const tempId = `melon_temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const objectUrl = await createMelonObjectUrl(file);
  const suffix = String(file.name || "").includes(".") ? `.${String(file.name).split(".").pop().toLowerCase()}` : "";
  const kind = String(file.type || "").startsWith("image/")
    ? "image"
    : MELON_ALLOWED_AUDIO_EXTENSIONS.has(suffix)
      ? "audio"
      : MELON_ALLOWED_VIDEO_EXTENSIONS.has(suffix)
        ? "video"
        : "file";
  pendingMelonImageFiles.set(tempId, {
    file,
    objectUrl,
    alt: file?.name || "附件",
    kind,
  });
  if (kind === "image") {
    insertMelonImage(objectUrl, file?.name || "瓜棚图片");
    toast("图片已插入");
    return;
  }
  insertMelonFileLink(objectUrl, file?.name || "附件");
  toast(kind === "audio" ? "音频已插入" : kind === "video" ? "视频已插入" : "附件已插入");
}

function prepareMelonContentForSubmit(content) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = String(content || "");
  const images = [...wrapper.querySelectorAll("img")];
  const links = [...wrapper.querySelectorAll("a")];
  const audios = [...wrapper.querySelectorAll("audio")];
  const videos = [...wrapper.querySelectorAll("video")];
  const pendingFiles = [];
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
    pendingFiles.push({
      tempId,
      file: pending.file,
      alt: image.getAttribute("alt") || pending.alt || "瓜棚图片",
    });
  }
  for (const link of links) {
    const href = String(link.getAttribute("href") || "").trim();
    if (!href.startsWith("blob:")) continue;
    const pendingEntry = [...pendingMelonImageFiles.entries()].find(([, value]) => value?.objectUrl === href);
    const [tempId, pending] = pendingEntry || [];
    if (!tempId || !pending?.file) {
      throw new Error("存在未准备好的附件，请重新插入后再试");
    }
    validateMelonAssetFile(pending.file);
    link.setAttribute("href", buildPendingMelonImageSrc(tempId));
    if (!link.textContent?.trim()) {
      link.textContent = pending.file.name || "附件";
    }
    pendingFiles.push({
      tempId,
      file: pending.file,
      alt: link.textContent || pending.file.name || "附件",
    });
  }
  for (const media of [...audios, ...videos]) {
    const src = String(media.getAttribute("src") || "").trim();
    if (!src.startsWith("blob:")) continue;
    const pendingEntry = [...pendingMelonImageFiles.entries()].find(([, value]) => value?.objectUrl === src);
    const [tempId, pending] = pendingEntry || [];
    if (!tempId || !pending?.file) {
      throw new Error("存在未准备好的媒体文件，请重新插入后再试");
    }
    validateMelonAssetFile(pending.file);
    media.setAttribute("src", buildPendingMelonImageSrc(tempId));
    pendingFiles.push({
      tempId,
      file: pending.file,
      alt: pending.file.name || "媒体文件",
    });
  }
  return {
    content: wrapper.innerHTML,
    pendingImages: pendingFiles,
  };
}

async function handleMelonClipboardPaste(event) {
  const items = Array.from(event?.clipboardData?.items || []);
  const fileItem = items.find((item) => {
    const type = String(item.type || "").toLowerCase();
    return type.startsWith("image/")
      || type === "application/pdf"
      || type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      || type === "text/plain"
      || type === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      || type === "audio/mpeg"
      || type === "video/mp4";
  });
  if (!fileItem) return;
  event.preventDefault();
  const file = fileItem.getAsFile();
  if (!file) return;
  try {
    await insertMelonAssetFromFile(file);
  } catch (error) {
    toast(error.message || "文件粘贴失败");
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
      const supportedType = item.types.find((type) =>
        type.startsWith("image/")
        || type === "application/pdf"
        || type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        || type === "text/plain"
        || type === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        || type === "audio/mpeg"
        || type === "video/mp4"
      );
      if (!supportedType) continue;
      const blob = await item.getType(supportedType);
      const extensionMap = {
        "application/pdf": "pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
        "text/plain": "txt",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
        "audio/mpeg": "mp3",
        "video/mp4": "mp4",
      };
      const extension = supportedType.startsWith("image/")
        ? (supportedType.split("/")[1] || "png")
        : (extensionMap[supportedType] || "bin");
      const file = new File([blob], `melon-paste.${extension}`, { type: supportedType });
      await insertMelonAssetFromFile(file);
      return;
    }
    toast("剪贴板中没有可粘贴的图片或文件");
  } catch (error) {
    toast(error.message || "读取剪贴板失败，请确认已复制图片或文件并允许访问剪贴板");
  }
}

async function handleMelonImageSelected(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  try {
    await insertMelonAssetFromFile(file);
  } catch (error) {
    toast(error.message || "文件上传失败");
  } finally {
    if (event?.target) {
      event.target.value = "";
    }
  }
}


