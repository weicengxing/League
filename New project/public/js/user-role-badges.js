(function initUserRoleBadges(global) {
  const ROLE_BADGE_MAP = {
    SuperAdmin: {
      key: "superadmin",
      label: "天尊超管",
      icon: "✦",
      aura: "圣耀金辉",
    },
    AllianceAdmin: {
      key: "allianceadmin",
      label: "联盟盟主",
      icon: "✧",
      aura: "赤曜王印",
    },
    VerifiedUser: {
      key: "verifieduser",
      label: "妖盟盟主",
      icon: "⬢",
      aura: "玄曜盟纹",
    },
    Verified: {
      key: "verified",
      label: "认证用户",
      icon: "◈",
      aura: "紫穹星徽",
    },
    Guest: {
      key: "guest",
      label: "Guest",
      icon: "◌",
      aura: "流沙访客",
    },
  };

  function getRoleBadgeMeta(role) {
    const normalizedRole = String(role || "").trim();
    return ROLE_BADGE_MAP[normalizedRole] || ROLE_BADGE_MAP.Guest;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderRoleBadge(role) {
    const meta = getRoleBadgeMeta(role);
    return `
      <span class="user-role-badge user-role-badge--${escapeHtml(meta.key)}" data-role-badge="${escapeHtml(meta.key)}">
        <span class="user-role-badge__flare" aria-hidden="true"></span>
        <span class="user-role-badge__crest" aria-hidden="true">${escapeHtml(meta.icon)}</span>
        <span class="user-role-badge__text">
          <span class="user-role-badge__title">${escapeHtml(meta.label)}</span>
          <span class="user-role-badge__aura">${escapeHtml(meta.aura)}</span>
        </span>
      </span>
    `;
  }

  global.UserRoleBadges = {
    getRoleBadgeMeta,
    renderRoleBadge,
  };
})(window);
