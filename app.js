(function () {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const app = document.getElementById("app");
  const modalRoot = document.getElementById("modal-root");

  const ACTIVE_CAMPAIGN_STATUSES = ["Planning", "Sourcing", "Active"];
  const PIPELINE_STATUSES = ["Picked", "Approved", "Contacted", "Negotiating", "Confirmed"];
  const PLATFORMS = ["TikTok", "Instagram", "Threads", "X", "YouTube", "Facebook"];
  const CATEGORIES = ["Beauty", "Skincare", "Makeup", "Daily Vlog", "Lifestyle", "Travel", "Cosplay", "Photographic", "Fashion", "Funny", "Dance", "Performance", "Lipsync", "Couple", "Tips", "Trend", "Tech", "Review", "Selfie", "AI"];
  const FOLLOWER_RANGES = [
    { id: "lt10k", label: "< 10K", min: 0, max: 10000 },
    { id: "10k_30k", label: "10K – 30K", min: 10000, max: 30000 },
    { id: "30k_100k", label: "30K – 100K", min: 30000, max: 100000 },
    { id: "100k_300k", label: "100K – 300K", min: 100000, max: 300000 },
    { id: "300k_1m", label: "300K – 1M", min: 300000, max: 1000000 },
    { id: "gt1m", label: "> 1M", min: 1000000, max: Infinity },
  ];

  const state = {
    data: null,
    route: "dashboard",
    campaignId: null,
    campaignTab: "overview",
    shortlistId: null,
    market: "All",
    search: "",
    selectedAccounts: new Set(),
    selectedShortlistAccounts: new Set(),
    databaseFilters: { platforms: [], app: "All", fee: "All", engagement: "0", categories: [], followers: [], status: "All" },
    outreachFilters: { platform: "All", status: "All" },
  };

  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const num = (value) => Number(value || 0);
  const formatNumber = (value) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(num(value));
  const compact = (value) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(num(value));
  const money = (value, currency = "VND") => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: currency === "VND" ? 0 : 2 }).format(num(value));
  const shortDate = (value) => value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(new Date(`${String(value).slice(0, 10)}T00:00:00`)) : "—";
  const fullDate = (value) => value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${String(value).slice(0, 10)}T00:00:00`)) : "—";
  const roleCanOperate = () => ["Admin", "Booking"].includes(state.data.profile.role);
  const isAdmin = () => state.data.profile.role === "Admin";
  const byId = (items) => Object.fromEntries(items.map((item) => [item.id, item]));
  const initials = (name) => String(name || "K").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const platformTone = (platform) => ({ TikTok: "dark", Instagram: "pink", Threads: "dark", YouTube: "red", Facebook: "blue", X: "dark" }[platform] || "slate");
  const statusTone = (status) => ({ Active: "green", Confirmed: "green", Deal: "green", Signed: "green", Paid: "green", Approved: "green", Planning: "violet", Sourcing: "blue", Picked: "blue", Contacted: "blue", Replied: "violet", Negotiating: "amber", Reviewing: "amber", "Draft submitted": "amber", Paused: "slate", Completed: "slate", Cancelled: "red", Declined: "red" }[status] || "slate");

  function toast(message, tone = "success") {
    const region = document.getElementById("toast-region");
    const item = document.createElement("div");
    item.className = `toast toast-${tone}`;
    item.innerHTML = `<span>${tone === "success" ? "✓" : "!"}</span><p>${esc(message)}</p>`;
    region.appendChild(item);
    setTimeout(() => item.classList.add("toast-out"), 3200);
    setTimeout(() => item.remove(), 3600);
  }

  async function reload() {
    state.data = await window.KOL_DATA.bootstrap();
    if (!state.data) return renderLogin();
    closeModal();
    if (state.data.profile.role === "Marketing" && state.market === "All" && state.data.profile.market !== "Global") {
      state.market = state.data.profile.market;
    }
    render();
  }

  async function boot() {
    try {
      await window.KOL_DATA.init();
      const session = await window.KOL_DATA.getSession();
      if (!session) return renderLogin();
      await reload();
    } catch (error) {
      renderFatal(error);
    }
  }

  function renderLogin() {
    app.innerHTML = `
      <main class="auth-page">
        <section class="auth-panel">
          <div class="brand brand-large"><span class="brand-mark">K</span><span>KOL Manager</span></div>
          <div class="auth-copy">
            <span class="eyebrow">TEAM WORKSPACE</span>
            <h1>Campaign planning starts with the right creator.</h1>
            <p>One workspace for outreach, rate management, shortlisting and campaign delivery.</p>
          </div>
          <div class="auth-proof"><span>✓</span> Role-based access <span>✓</span> Shared live data <span>✓</span> Platform-level rates</div>
        </section>
        <section class="login-card-wrap">
          <form class="login-card" id="login-form">
            <div><span class="eyebrow">WELCOME BACK</span><h2>Sign in to your workspace</h2><p>Use the team account created in Supabase.</p></div>
            <label>Email<input type="email" name="email" autocomplete="email" required placeholder="you@company.com" /></label>
            <label>Password<input type="password" name="password" autocomplete="current-password" required placeholder="••••••••" /></label>
            <button class="btn btn-primary btn-block" type="submit">Sign in</button>
            <p class="form-note">Account creation and role assignment are managed by an administrator.</p>
          </form>
        </section>
      </main>`;
  }

  function renderFatal(error) {
    app.innerHTML = `<main class="fatal"><div class="brand-mark">!</div><h1>Workspace could not be loaded</h1><p>${esc(error.message)}</p><button class="btn btn-primary" data-action="retry">Try again</button></main>`;
  }

  function visibleNav() {
    const role = state.data.profile.role;
    return [
      { id: "dashboard", label: "Dashboard", icon: "⌂" },
      { id: "campaigns", label: "Campaigns", icon: "◫" },
      { id: "database", label: "KOL Database", icon: "◎" },
      ...(roleCanOperate() ? [{ id: "outreach", label: "KOL Outreach", icon: "↗" }] : []),
      { id: "shortlists", label: "Shortlists", icon: "☆" },
      { id: "calendar", label: "Calendar", icon: "□" },
      ...(roleCanOperate() ? [{ id: "contracts", label: "Contracts", icon: "▤" }, { id: "payments", label: "Payments", icon: "$" }] : []),
      ...(role === "Admin" ? [{ id: "settings", label: "Settings", icon: "⚙" }] : []),
    ];
  }

  function render() {
    const profile = state.data.profile;
    app.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar" id="sidebar">
          <div class="brand"><span class="brand-mark">K</span><span>KOL Manager</span></div>
          <nav>${visibleNav().map((item) => `<button class="nav-item ${state.route === item.id ? "active" : ""}" data-route="${item.id}"><span>${item.icon}</span>${item.label}</button>`).join("")}</nav>
          <div class="sidebar-foot"><div class="version">v${esc(window.KOL_CONFIG.appVersion || "2.0.0")}</div><button class="support-link" data-action="show-help">Need help?</button></div>
        </aside>
        <div class="workspace">
          <header class="topbar">
            <button class="mobile-menu" data-action="toggle-sidebar" aria-label="Open menu">☰</button>
            <label class="global-search"><span>⌕</span><input id="global-search" value="${esc(state.search)}" placeholder="Search creators or campaigns" /><kbd>⌘ K</kbd></label>
            <div class="topbar-actions">
              <select id="global-market" aria-label="Market"><option ${state.market === "All" ? "selected" : ""}>All</option><option ${state.market === "VN" ? "selected" : ""}>VN</option><option ${state.market === "TH" ? "selected" : ""}>TH</option><option ${state.market === "TW" ? "selected" : ""}>TW</option></select>
              ${state.data.demo ? `<select id="demo-role" aria-label="Demo role"><option ${profile.role === "Marketing" ? "selected" : ""}>Marketing</option><option ${profile.role === "Booking" ? "selected" : ""}>Booking</option><option ${profile.role === "Admin" ? "selected" : ""}>Admin</option></select>` : ""}
              <button class="icon-btn" data-action="show-help" aria-label="Help">?</button>
              <button class="profile-chip" data-action="profile-menu"><span>${initials(profile.name)}</span><div><strong>${esc(profile.name)}</strong><small>${esc(profile.role)}</small></div></button>
            </div>
          </header>
          <main class="content">${renderRoute()}</main>
        </div>
      </div>
      ${renderSelectionBar()}`;
  }

  function pageHeader(eyebrow, title, description, actions = "") {
    return `<div class="page-header"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</div>`;
  }

  function renderRoute() {
    switch (state.route) {
      case "campaigns": return state.campaignId ? renderCampaignDetail() : renderCampaigns();
      case "database": return renderDatabase();
      case "outreach": return roleCanOperate() ? renderOutreach() : renderDashboard();
      case "shortlists": return renderShortlists();
      case "calendar": return renderCalendar();
      case "contracts": return roleCanOperate() ? renderOperations("contracts") : renderDashboard();
      case "payments": return roleCanOperate() ? renderOperations("payments") : renderDashboard();
      case "settings": return isAdmin() ? renderSettings() : renderDashboard();
      default: return renderDashboard();
    }
  }

  function filteredCampaigns() {
    const query = state.search.toLowerCase().trim();
    return state.data.campaigns.filter((item) => {
      if (state.market !== "All" && item.market !== state.market) return false;
      return !query || [item.name, item.app, item.code, item.market].join(" ").toLowerCase().includes(query);
    });
  }

  function renderDashboard() {
    const campaigns = filteredCampaigns();
    const active = campaigns.filter((item) => ACTIVE_CAMPAIGN_STATUSES.includes(item.status));
    const activeIds = new Set(active.map((item) => item.id));
    const pipeline = state.data.campaign_kols.filter((item) => activeIds.has(item.campaign_id) && PIPELINE_STATUSES.includes(item.booking_status));
    const confirmed = pipeline.filter((item) => item.booking_status === "Confirmed");
    const attention = state.data.campaign_kols.filter((item) => activeIds.has(item.campaign_id) && ["Need edit", "On hold"].includes(item.content_status)).length;
    const funnel = PIPELINE_STATUSES.map((status) => ({ status, count: pipeline.filter((item) => item.booking_status === status).length }));
    const maxFunnel = Math.max(1, ...funnel.map((item) => item.count));
    const marketCounts = ["VN", "TH", "TW"].map((market) => ({ market, count: state.data.accounts.filter((item) => item.active && item.starting_fee > 0 && (state.market === "All" || market === state.market) && state.data.creators.find((creator) => creator.id === item.creator_id)?.market === market).length }));
    const totalMarket = marketCounts.reduce((sum, item) => sum + item.count, 0);
    const upcoming = calendarEvents().filter((event) => event.date >= "2026-07-23").slice(0, 5);

    return `
      ${pageHeader("WORKSPACE OVERVIEW", `Good morning, ${esc(state.data.profile.name.split(" ")[0])}`, "Active campaign performance, booking progress and upcoming work at a glance.")}
      <section class="kpi-grid">
        ${kpi("◉", "blue", "Active campaigns", active.length, "Planning, sourcing and live")}
        ${kpi("♧", "violet", "KOLs in pipeline", pipeline.length, "Across active campaigns")}
        ${kpi("✓", "green", "Confirmed KOLs", confirmed.length, "Across active campaigns")}
        ${kpi("!", "amber", "Needs attention", attention, "Content requiring action")}
      </section>
      <section class="dashboard-grid">
        <article class="panel funnel-panel"><div class="panel-head"><div><span class="eyebrow">BOOKING FUNNEL</span><h2>Campaign pipeline</h2></div><button class="btn btn-ghost" data-route="campaigns">View all</button></div>
          <div class="funnel-list">${funnel.map((item) => `<div class="funnel-row"><span>${item.status}</span><div><i style="width:${Math.max(item.count ? 7 : 0, Math.round(item.count / maxFunnel * 100))}%" class="bar-${item.status === "Confirmed" ? "green" : "blue"}"></i></div><strong>${item.count}</strong></div>`).join("")}</div>
          <div class="panel-foot"><span><i class="dot green"></i>${pipeline.length ? Math.round(confirmed.length / pipeline.length * 100) : 0}% confirmation rate</span><button data-route="campaigns">View pipeline →</button></div>
        </article>
        <article class="panel distribution-panel"><div class="panel-head"><div><span class="eyebrow">DISTRIBUTION</span><h2>KOLs by market</h2></div></div>
          <div class="donut" style="--vn:${totalMarket ? marketCounts[0].count / totalMarket * 100 : 0}%;--th:${totalMarket ? (marketCounts[0].count + marketCounts[1].count) / totalMarket * 100 : 0}%"><div><strong>${totalMarket}</strong><span>Rate-ready accounts</span></div></div>
          <div class="legend">${marketCounts.map((item, index) => `<div><span><i class="dot market-${index}"></i>${item.market === "VN" ? "Vietnam" : item.market === "TH" ? "Thailand" : "Taiwan"}</span><strong>${item.count}</strong></div>`).join("")}</div>
        </article>
        <article class="panel schedule-panel"><div class="panel-head"><div><span class="eyebrow">SCHEDULE</span><h2>Upcoming milestones</h2></div><button class="btn btn-ghost" data-route="calendar">Calendar</button></div>
          <div class="milestone-list">${upcoming.length ? upcoming.map((event) => `<div class="milestone"><time><strong>${shortDate(event.date).split(" ")[0]}</strong><span>${shortDate(event.date).split(" ")[1]}</span></time><div><strong>${esc(event.title)}</strong><small>${esc(event.subtitle)}</small></div><span class="chip">${esc(event.type)}</span></div>`).join("") : emptyInline("No upcoming milestones")}</div>
        </article>
      </section>
      <section class="section-head"><div><h2>Active campaigns</h2><p>Progress, confirmed spend and booking health.</p></div><button data-route="campaigns">View all campaigns →</button></section>
      <section class="campaign-card-grid">${active.slice(0, 3).map(campaignCard).join("") || emptyBlock("No active campaigns", "Create or activate a campaign to see it here.")}</section>`;
  }

  function kpi(icon, tone, label, value, note) {
    const displayValue = typeof value === "number" ? formatNumber(value) : value;
    return `<article class="kpi-card"><div class="kpi-icon ${tone}">${icon}</div><div><span>${label}</span><strong>${esc(displayValue)}</strong><small>${note}</small></div></article>`;
  }

  function campaignStats(campaign) {
    const items = state.data.campaign_kols.filter((item) => item.campaign_id === campaign.id);
    const confirmed = items.filter((item) => item.booking_status === "Confirmed");
    const spend = confirmed.reduce((sum, item) => sum + num(item.final_fee || item.quoted_fee), 0);
    return { items, confirmed, spend, percent: campaign.budget ? Math.min(100, Math.round(spend / campaign.budget * 100)) : 0 };
  }

  function campaignCard(campaign) {
    const stats = campaignStats(campaign);
    return `<button class="campaign-card" data-campaign-id="${campaign.id}"><div class="campaign-card-top"><span class="app-icon">${esc(campaign.app[0])}</span><span class="status status-${statusTone(campaign.status)}">● ${esc(campaign.status)}</span></div><small>${esc(campaign.code || "CAMPAIGN")}</small><h3>${esc(campaign.app)} · ${esc(campaign.name)}</h3><p>${esc(campaign.market)} · ${esc((campaign.platforms || []).join(", "))} · ${shortDate(campaign.posting_start)} → ${shortDate(campaign.posting_end)}</p><div class="progress-label"><span>Confirmed</span><strong>${stats.confirmed.length}/${campaign.target_kols || 0}</strong></div><div class="progress"><i style="width:${Math.min(100, campaign.target_kols ? stats.confirmed.length / campaign.target_kols * 100 : 0)}%"></i></div><div class="campaign-budget"><span>Budget used</span><strong>${stats.percent}%</strong></div></button>`;
  }

  function renderCampaigns() {
    const actions = roleCanOperate() ? `<button class="btn btn-primary" data-action="new-campaign">+ New campaign</button>` : "";
    const items = filteredCampaigns();
    return `${pageHeader("CAMPAIGN MANAGEMENT", "Campaigns", "Plan campaigns, select creators and monitor delivery from one place.", actions)}
      <div class="segmented"><button class="active">All</button><button>Planning</button><button>Sourcing</button><button>Active</button><button>Completed</button></div>
      <section class="campaign-card-grid large">${items.map(campaignCard).join("") || emptyBlock("No campaigns found", "Try another market or search term.")}</section>`;
  }

  function renderCampaignDetail() {
    const campaign = state.data.campaigns.find((item) => item.id === state.campaignId);
    if (!campaign) { state.campaignId = null; return renderCampaigns(); }
    const stats = campaignStats(campaign);
    const tabs = ["overview", "kols", "content", "calendar", ...(roleCanOperate() ? ["contracts", "payments"] : [])];
    return `<button class="back-link" data-action="back-campaigns">← All campaigns</button>
      <section class="campaign-hero"><div><div class="hero-meta"><span class="app-icon">${esc(campaign.app[0])}</span><span class="status status-${statusTone(campaign.status)}">● ${esc(campaign.status)}</span><small>${esc(campaign.code)}</small></div><h1>${esc(campaign.app)} · ${esc(campaign.name)}</h1><p>${esc(campaign.market)} · ${(campaign.platforms || []).map((item) => esc(item)).join(" · ")} · ${fullDate(campaign.posting_start)} → ${fullDate(campaign.posting_end)}</p></div>${roleCanOperate() ? `<button class="btn btn-secondary" data-action="edit-campaign">Edit campaign</button>` : ""}</section>
      <div class="tabs">${tabs.map((tab) => `<button class="${state.campaignTab === tab ? "active" : ""}" data-campaign-tab="${tab}">${tab[0].toUpperCase() + tab.slice(1)}</button>`).join("")}</div>
      ${renderCampaignTab(campaign, stats)}`;
  }

  function renderCampaignTab(campaign, stats) {
    if (state.campaignTab === "kols") return renderCampaignKols(campaign, stats.items);
    if (state.campaignTab === "content") return renderCampaignContent(campaign);
    if (state.campaignTab === "calendar") return renderCalendar(campaign.id, true);
    if (state.campaignTab === "contracts") return renderOperations("contracts", campaign.id, true);
    if (state.campaignTab === "payments") return renderOperations("payments", campaign.id, true);
    return `<section class="kpi-grid compact">
      ${kpi("◎", "blue", "Selected KOLs", stats.items.length, `${stats.confirmed.length} confirmed`)}
      ${kpi("✓", "green", "Confirmed value", money(stats.spend, campaign.currency), "Counts toward campaign budget")}
      ${kpi("↗", "violet", "Awaiting confirmation", money(stats.items.filter((item) => item.booking_status !== "Confirmed").reduce((sum, item) => sum + num(item.quoted_fee), 0), campaign.currency), "Pipeline value")}
      ${kpi("◷", "amber", "Budget remaining", money(Math.max(0, campaign.budget - stats.spend), campaign.currency), `${stats.percent}% used`)}
    </section>
    <section class="detail-grid"><article class="panel"><div class="panel-head"><div><span class="eyebrow">CAMPAIGN BRIEF</span><h2>Campaign details</h2></div></div><dl class="info-list"><div><dt>Objective</dt><dd>${esc(campaign.objective || "—")}</dd></div><div><dt>Target KOLs</dt><dd>${formatNumber(campaign.target_kols)}</dd></div><div><dt>Platforms</dt><dd>${esc((campaign.platforms || []).join(", "))}</dd></div><div><dt>Marketing PIC</dt><dd>${esc((campaign.assigned_marketing || []).join(", ") || "—")}</dd></div></dl></article><article class="panel"><div class="panel-head"><div><span class="eyebrow">BOOKING PROGRESS</span><h2>Selection health</h2></div></div>${["Picked", "Contacted", "Negotiating", "Confirmed"].map((status) => `<div class="metric-line"><span>${status}</span><strong>${stats.items.filter((item) => item.booking_status === status).length}</strong></div>`).join("")}</article></section>`;
  }

  function renderCampaignKols(campaign, items) {
    const accounts = byId(state.data.accounts);
    const creators = byId(state.data.creators);
    const grouped = {};
    items.forEach((item) => {
      const key = item.creator_id || accounts[item.account_id]?.creator_id || item.id;
      (grouped[key] ||= []).push(item);
    });
    return `<section class="section-head"><div><h2>Campaign KOLs</h2><p>${items.length} platform account${items.length === 1 ? "" : "s"} selected.</p></div><button class="btn btn-primary" data-route="database">+ Pick KOLs</button></section>
      <div class="table-card"><table><thead><tr><th>Creator</th><th>Platform accounts</th><th>Status</th><th>Content</th><th>Posting</th><th class="align-right">Value</th></tr></thead><tbody>${Object.entries(grouped).map(([creatorId, group]) => { const creator = creators[creatorId] || {}; return `<tr><td><div class="creator-cell"><span class="avatar">${initials(creator.display_name)}</span><div><strong>${esc(creator.display_name || "Creator")}</strong><small>${esc(creator.market || campaign.market)}</small></div></div></td><td><div class="platform-stack">${group.map((item) => { const account = accounts[item.account_id] || {}; return `<span class="platform-pill tone-${platformTone(account.platform)}">${esc(account.platform || "Platform")} · @${esc(account.username || "account")}</span>`; }).join("")}</div></td><td><div class="platform-stack">${group.map((item) => `<span class="status status-${statusTone(item.booking_status)}">● ${esc(item.booking_status)}</span>`).join("")}</div></td><td>${group.map((item) => `<span class="plain-status">${esc(item.content_status || "Not started")}</span>`).join("<br>")}</td><td>${group.map((item) => `<span>${shortDate(item.posting_date)}</span>`).join("<br>")}</td><td class="align-right"><strong>${group.map((item) => money(item.final_fee || item.quoted_fee, item.currency || campaign.currency)).join("<br>")}</strong></td></tr>`; }).join("") || `<tr><td colspan="6">${emptyInline("No KOLs selected yet")}</td></tr>`}</tbody></table></div>`;
  }

  function renderCampaignContent(campaign) {
    const items = state.data.deliverables.filter((item) => item.campaign_id === campaign.id);
    const accounts = byId(state.data.accounts);
    const creators = byId(state.data.creators);
    return `<section class="section-head"><div><h2>Content delivery</h2><p>Drafts, approvals and live post links.</p></div></section><div class="table-card"><table><thead><tr><th>Creator</th><th>Deliverable</th><th>Draft due</th><th>Status</th><th>Posting date</th><th>Links</th></tr></thead><tbody>${items.map((item) => { const account = accounts[item.account_id] || {}; const creator = creators[account.creator_id] || {}; return `<tr><td><strong>${esc(creator.display_name)}</strong><small class="cell-sub">@${esc(account.username)}</small></td><td>${esc(item.type)} · ${esc(item.platform)}</td><td>${fullDate(item.draft_due)}</td><td><span class="status status-${statusTone(item.content_status)}">● ${esc(item.content_status)}</span></td><td>${fullDate(item.posting_date)}</td><td>${item.draft_url ? `<a href="${esc(item.draft_url)}" target="_blank">Draft ↗</a>` : "—"}</td></tr>`; }).join("") || `<tr><td colspan="6">${emptyInline("No deliverables yet")}</td></tr>`}</tbody></table></div>`;
  }

  function multiSelect(id, label, options, selected) {
    const summary = selected.length ? `${selected.length} selected` : "All";
    return `<details class="multi-filter" data-filter-details="${id}"><summary><span><small>${label}</small><strong>${summary}</strong></span><i>⌄</i></summary><div class="multi-options">${options.map((option) => { const value = typeof option === "string" ? option : option.id; const text = typeof option === "string" ? option : option.label; return `<label><input type="checkbox" data-filter-group="${id}" value="${esc(value)}" ${selected.includes(value) ? "checked" : ""}/><span>${esc(text)}</span></label>`; }).join("")}</div></details>`;
  }

  function databaseGroups() {
    const filters = state.databaseFilters;
    const creators = byId(state.data.creators);
    const query = state.search.toLowerCase().trim();
    const pricedAccounts = state.data.accounts.filter((account) => account.active !== false && num(account.starting_fee) > 0);
    const grouped = {};
    pricedAccounts.forEach((account) => {
      const creator = creators[account.creator_id];
      if (!creator || creator.active === false) return;
      if (state.market !== "All" && creator.market !== state.market) return;
      if (filters.platforms.length && !filters.platforms.includes(account.platform)) return;
      if (filters.app !== "All" && !(account.app_fit || []).includes(filters.app)) return;
      if (filters.categories.length && !filters.categories.some((category) => (creator.categories || []).includes(category))) return;
      if (num(account.engagement_rate) < num(filters.engagement)) return;
      if (filters.fee !== "All") {
        const [min, max] = filters.fee.split("-").map(Number);
        if (num(account.starting_fee) < min || (max && num(account.starting_fee) > max)) return;
      }
      if (filters.followers.length && !filters.followers.some((id) => { const range = FOLLOWER_RANGES.find((item) => item.id === id); return range && num(account.followers) >= range.min && num(account.followers) < range.max; })) return;
      const outreach = state.data.outreach_profiles.find((item) => item.creator_id === creator.id);
      if (filters.status !== "All" && outreach?.status !== filters.status) return;
      const haystack = [creator.display_name, creator.legal_name, creator.categories?.join(" "), account.username, account.platform, account.app_fit?.join(" ")].join(" ").toLowerCase();
      if (query && !haystack.includes(query)) return;
      (grouped[creator.id] ||= { creator, accounts: [], outreach }).accounts.push(account);
    });
    return Object.values(grouped).map((group) => ({ ...group, minFee: Math.min(...group.accounts.map((item) => num(item.starting_fee))), maxFollowers: Math.max(...group.accounts.map((item) => num(item.followers))), maxEngagement: Math.max(...group.accounts.map((item) => num(item.engagement_rate))) })).sort((a, b) => a.minFee - b.minFee || b.maxFollowers - a.maxFollowers || b.maxEngagement - a.maxEngagement);
  }

  function renderDatabase() {
    const groups = databaseGroups();
    const filterStatus = roleCanOperate() ? `<label class="field filter-field"><span>Status</span><select data-db-filter="status"><option>All</option>${["New", "Contacted", "Replied", "Negotiating", "Deal"].map((item) => `<option ${state.databaseFilters.status === item ? "selected" : ""}>${item}</option>`).join("")}</select></label>` : "";
    return `${pageHeader("CAMPAIGN SELECTION", "KOL Database", "Browse rate-ready creators and select the right platform accounts for a shortlist or campaign.")}
      <section class="filter-panel">
        <label class="search-field"><span>⌕</span><input data-search-sync value="${esc(state.search)}" placeholder="Search creator, username or category" /></label>
        <div class="market-tabs">${["All", "VN", "TH", "TW"].map((market) => `<button class="${state.market === market ? "active" : ""}" data-market="${market}">${market === "All" ? "All markets" : market}</button>`).join("")}</div>
        <div class="filter-grid">
          ${multiSelect("platforms", "Platform", PLATFORMS, state.databaseFilters.platforms)}
          <label class="field filter-field"><span>App fit</span><select data-db-filter="app"><option>All</option>${["SNOW", "B612", "EPIK", "SODA", "Foodie"].map((item) => `<option ${state.databaseFilters.app === item ? "selected" : ""}>${item}</option>`).join("")}</select></label>
          <label class="field filter-field"><span>Fee</span><select data-db-filter="fee"><option value="All">All</option><option value="0-3000000" ${state.databaseFilters.fee === "0-3000000" ? "selected" : ""}>Up to 3M</option><option value="3000000-6000000" ${state.databaseFilters.fee === "3000000-6000000" ? "selected" : ""}>3M – 6M</option><option value="6000000-0" ${state.databaseFilters.fee === "6000000-0" ? "selected" : ""}>6M+</option></select></label>
          <label class="field filter-field"><span>Min. engagement</span><select data-db-filter="engagement"><option value="0">All</option>${[3, 5, 8, 10].map((item) => `<option value="${item}" ${state.databaseFilters.engagement === String(item) ? "selected" : ""}>${item}%+</option>`).join("")}</select></label>
          ${multiSelect("categories", "Category", CATEGORIES, state.databaseFilters.categories)}
          ${multiSelect("followers", "Followers", FOLLOWER_RANGES, state.databaseFilters.followers)}
          ${filterStatus}
        </div>
        <div class="sort-note"><span>Sort priority</span><strong>1. Price ↑</strong><strong>2. Followers ↓</strong><strong>3. Engagement ↓</strong><button data-action="clear-db-filters">Clear filters</button></div>
      </section>
      <div class="table-card database-table"><div class="table-toolbar"><span><strong>${groups.length}</strong> creators · ${groups.reduce((sum, group) => sum + group.accounts.length, 0)} rate-ready accounts</span></div><table><thead><tr><th>Creator</th><th>Market</th><th>Platform accounts</th><th>Categories</th><th>Starting fee</th><th>Engagement</th></tr></thead><tbody>${groups.map(databaseRow).join("") || `<tr><td colspan="6">${emptyBlock("No KOL accounts found", "Try another keyword or combine fewer filters.")}</td></tr>`}</tbody></table></div>`;
  }

  function databaseRow(group) {
    const creator = group.creator;
    return `<tr><td><div class="creator-cell"><span class="avatar">${initials(creator.display_name)}</span><div><strong>${esc(creator.display_name)}</strong><small>${esc(creator.city || "Creator")}</small></div></div></td><td><span class="market-badge">${esc(creator.market)}</span></td><td><div class="account-cards">${group.accounts.map((account) => `<label class="account-card ${state.selectedAccounts.has(account.id) ? "selected" : ""}"><input type="checkbox" data-account-select="${account.id}" ${state.selectedAccounts.has(account.id) ? "checked" : ""}/><span class="platform-logo tone-${platformTone(account.platform)}">${esc(account.platform[0])}</span><span><strong>${esc(account.platform)} · @${esc(account.username || "account")}</strong><small>${compact(account.followers)} followers · ${account.engagement_rate || 0}% ER</small></span><a href="${esc(account.profile_url)}" target="_blank" rel="noopener" title="Open profile">↗</a></label>`).join("")}</div></td><td><div class="tag-list">${(creator.categories || []).slice(0, 3).map((item) => `<span>${esc(item)}</span>`).join("")}</div></td><td><div class="platform-values">${group.accounts.map((account) => `<span><small>${esc(account.platform)}</small><strong>${money(account.starting_fee, account.currency)}</strong></span>`).join("")}</div></td><td><div class="platform-values">${group.accounts.map((account) => `<span><small>${esc(account.platform)}</small><strong>${account.engagement_rate || 0}%</strong></span>`).join("")}</div></td></tr>`;
  }

  function renderSelectionBar() {
    if (!state.selectedAccounts.size || state.route !== "database") return "";
    return `<div class="selection-bar"><div><strong>${state.selectedAccounts.size}</strong><span>platform account${state.selectedAccounts.size === 1 ? "" : "s"} selected</span></div><button class="btn btn-secondary" data-action="selection-clear">Clear</button><button class="btn btn-secondary" data-action="selection-shortlist">Add to shortlist</button><button class="btn btn-primary" data-action="selection-campaign">Add to campaign</button></div>`;
  }

  function renderOutreach() {
    const creators = byId(state.data.creators);
    const outreach = byId(state.data.outreach_profiles.map((item) => ({ ...item, id: item.creator_id })));
    const query = state.search.toLowerCase().trim();
    const rows = state.data.accounts.filter((account) => {
      const creator = creators[account.creator_id] || {};
      const profile = outreach[account.creator_id] || {};
      if (state.market !== "All" && creator.market !== state.market) return false;
      if (state.outreachFilters.platform !== "All" && account.platform !== state.outreachFilters.platform) return false;
      if (state.outreachFilters.status !== "All" && profile.status !== state.outreachFilters.status) return false;
      return !query || [creator.display_name, creator.legal_name, account.username, account.platform, profile.status, profile.pic, profile.contact_value].join(" ").toLowerCase().includes(query);
    });
    return `${pageHeader("BOOKING WORKSPACE", "KOL Outreach", "Manage contact details, outreach status, PIC and platform-specific rates.", `<button class="btn btn-secondary" data-action="import-kols">⇧ Import KOLs</button><button class="btn btn-primary" data-action="new-kol">+ Add KOL</button>`)}
      <section class="filter-panel compact-panel"><label class="search-field"><span>⌕</span><input data-search-sync value="${esc(state.search)}" placeholder="Search creator, contact or username" /></label><label class="field filter-field"><span>Platform</span><select data-outreach-filter="platform"><option>All</option>${PLATFORMS.map((item) => `<option ${state.outreachFilters.platform === item ? "selected" : ""}>${item}</option>`).join("")}</select></label><label class="field filter-field"><span>Outreach status</span><select data-outreach-filter="status"><option>All</option>${["New", "Contacted", "Replied", "Negotiating", "Deal", "Not interested"].map((item) => `<option ${state.outreachFilters.status === item ? "selected" : ""}>${item}</option>`).join("")}</select></label><div class="market-tabs">${["All", "VN", "TH", "TW"].map((market) => `<button class="${state.market === market ? "active" : ""}" data-market="${market}">${market === "All" ? "All markets" : market}</button>`).join("")}</div></section>
      <div class="table-card"><div class="table-toolbar"><span><strong>${rows.length}</strong> outreach accounts</span><small>Any platform with a fee above 0 appears in KOL Database</small></div><table><thead><tr><th>Creator</th><th>Market</th><th>Platform</th><th>Status</th><th>Contact</th><th>PIC</th><th>Followers</th><th>Starting fee</th><th></th></tr></thead><tbody>${rows.map((account) => { const creator = creators[account.creator_id] || {}; const profile = outreach[account.creator_id] || {}; return `<tr><td><div class="creator-cell"><span class="avatar">${initials(creator.display_name)}</span><div><strong>${esc(creator.display_name)}</strong><small>@${esc(account.username || "account")} · <a href="${esc(account.profile_url)}" target="_blank">Profile ↗</a></small></div></div></td><td><span class="market-badge">${esc(creator.market)}</span></td><td><span class="platform-pill tone-${platformTone(account.platform)}">${esc(account.platform)}</span></td><td><span class="status status-${statusTone(profile.status)}">● ${esc(profile.status || "New")}</span></td><td><span class="contact-cell">${esc(profile.contact_channel || "—")}<small>${esc(profile.contact_value || "No contact yet")}</small></span></td><td>${esc(profile.pic || "—")}</td><td>${compact(account.followers)}</td><td><strong>${money(account.starting_fee, account.currency)}</strong></td><td><button class="btn btn-icon" data-edit-outreach="${creator.id}" aria-label="Edit creator">•••</button></td></tr>`; }).join("") || `<tr><td colspan="9">${emptyInline("No outreach accounts found")}</td></tr>`}</tbody></table></div>`;
  }

  function renderShortlists() {
    if (state.shortlistId) return renderShortlistDetail();
    return `${pageHeader("CAMPAIGN PLANNING", "Shortlists", "Review candidates together before moving selected platform accounts into a campaign.", `<button class="btn btn-primary" data-action="new-shortlist">+ New shortlist</button>`)}<section class="shortlist-grid">${state.data.shortlists.map((list) => { const members = state.data.shortlist_accounts.filter((item) => item.shortlist_id === list.id); return `<button class="shortlist-card" data-shortlist-id="${list.id}"><div><span class="status status-${statusTone(list.status)}">● ${esc(list.status)}</span><small>${esc(list.month || "No month")}</small></div><h3>${esc(list.name)}</h3><p>${esc(list.market)} · ${members.length} platform accounts</p><div><span>${members.filter((item) => item.review_status === "Approved").length} approved</span><strong>Open →</strong></div></button>`; }).join("") || emptyBlock("No shortlists yet", "Create a shortlist from KOL Database.")}</section>`;
  }

  function renderShortlistDetail() {
    const list = state.data.shortlists.find((item) => item.id === state.shortlistId);
    if (!list) { state.shortlistId = null; return renderShortlists(); }
    const accounts = byId(state.data.accounts);
    const creators = byId(state.data.creators);
    const members = state.data.shortlist_accounts.filter((item) => item.shortlist_id === list.id);
    return `<button class="back-link" data-action="back-shortlists">← All shortlists</button>${pageHeader("SHORTLIST REVIEW", esc(list.name), `${esc(list.market)} · ${esc(list.month || "No month")} · ${members.length} platform accounts`, `<button class="btn btn-primary" data-action="shortlist-to-campaign" ${state.selectedShortlistAccounts.size ? "" : "disabled"}>Add selected to campaign</button>`)}<div class="table-card"><table><thead><tr><th class="check-col"></th><th>Creator</th><th>Platform</th><th>Followers</th><th>Fee</th><th>Review status</th></tr></thead><tbody>${members.map((member) => { const account = accounts[member.account_id] || {}; const creator = creators[account.creator_id] || {}; return `<tr><td><input type="checkbox" data-shortlist-account="${account.id}" ${state.selectedShortlistAccounts.has(account.id) ? "checked" : ""}/></td><td><div class="creator-cell"><span class="avatar">${initials(creator.display_name)}</span><div><strong>${esc(creator.display_name)}</strong><small>@${esc(account.username)}</small></div></div></td><td><span class="platform-pill tone-${platformTone(account.platform)}">${esc(account.platform)}</span></td><td>${compact(account.followers)}</td><td><strong>${money(account.starting_fee, account.currency)}</strong></td><td><span class="status status-${statusTone(member.review_status)}">● ${esc(member.review_status)}</span></td></tr>`; }).join("") || `<tr><td colspan="6">${emptyInline("No accounts in this shortlist")}</td></tr>`}</tbody></table></div>`;
  }

  function calendarEvents(campaignId = null) {
    const campaigns = byId(state.data.campaigns);
    const accounts = byId(state.data.accounts);
    const creators = byId(state.data.creators);
    const events = [];
    state.data.campaign_kols.forEach((item) => {
      if (campaignId && item.campaign_id !== campaignId) return;
      if (!item.posting_date) return;
      const account = accounts[item.account_id] || {};
      const creator = creators[item.creator_id || account.creator_id] || {};
      const campaign = campaigns[item.campaign_id] || {};
      events.push({ date: String(item.posting_date).slice(0, 10), title: creator.display_name || account.username || "KOL post", subtitle: `${campaign.app || "Campaign"} · ${account.platform || "Post"}`, type: "Post", campaignId: item.campaign_id });
    });
    state.data.deliverables.forEach((item) => {
      if (campaignId && item.campaign_id !== campaignId) return;
      if (!item.draft_due) return;
      const account = accounts[item.account_id] || {};
      const creator = creators[account.creator_id] || {};
      events.push({ date: String(item.draft_due).slice(0, 10), title: creator.display_name || account.username || "Draft due", subtitle: `${item.platform || "Content"} draft`, type: "Draft", campaignId: item.campaign_id });
    });
    return events.sort((a, b) => a.date.localeCompare(b.date));
  }

  function renderCalendar(campaignId = null, embedded = false) {
    const events = calendarEvents(campaignId);
    const groups = {};
    events.forEach((event) => (groups[event.date] ||= []).push(event));
    const dates = Object.keys(groups).sort();
    const header = embedded ? `<section class="section-head"><div><h2>Posting schedule</h2><p>Compact daily view; expand busy days only when needed.</p></div></section>` : pageHeader("CONTENT PLANNING", "Calendar", "A compact view of draft deadlines and posting dates across active campaigns.");
    return `${header}<section class="calendar-shell"><div class="calendar-toolbar"><button class="btn btn-secondary">←</button><h2>Jul – Aug 2026</h2><button class="btn btn-secondary">→</button></div><div class="calendar-grid">${dates.map((date) => { const dayEvents = groups[date]; return `<article class="calendar-day"><div class="day-head"><time><strong>${shortDate(date).split(" ")[0]}</strong><span>${shortDate(date).split(" ")[1]}</span></time><small>${dayEvents.length} item${dayEvents.length === 1 ? "" : "s"}</small></div><div class="day-events">${dayEvents.slice(0, 3).map((event) => `<button data-campaign-id="${event.campaignId}"><span class="event-dot ${event.type.toLowerCase()}"></span><div><strong>${esc(event.title)}</strong><small>${esc(event.subtitle)}</small></div></button>`).join("")}${dayEvents.length > 3 ? `<button class="more-events" data-action="show-day" data-date="${date}">+${dayEvents.length - 3} more</button>` : ""}</div></article>`; }).join("") || emptyBlock("No dates scheduled", "Add posting dates or draft deadlines to see them here.")}</div></section>`;
  }

  function renderOperations(type, campaignId = null, embedded = false) {
    const rows = state.data[type].filter((item) => !campaignId || item.campaign_id === campaignId);
    const campaigns = byId(state.data.campaigns);
    const creators = byId(state.data.creators);
    const isPayments = type === "payments";
    const header = embedded ? `<section class="section-head"><div><h2>${isPayments ? "Payments" : "Contracts"}</h2><p>${rows.length} records for this campaign.</p></div></section>` : pageHeader("OPERATIONS", isPayments ? "Payments" : "Contracts", isPayments ? "Track due dates, processing and payment completion." : "Track contract preparation, signature and deadlines.");
    return `${header}<div class="table-card"><table><thead><tr><th>${isPayments ? "Payment" : "Contract"}</th><th>Campaign</th><th>Creator</th><th>Status</th><th>Due date</th>${isPayments ? "<th class=\"align-right\">Amount</th>" : "<th>Owner</th>"}</tr></thead><tbody>${rows.map((item) => `<tr><td><strong>${esc(isPayments ? item.id : item.contract_no || item.id)}</strong></td><td>${esc(campaigns[item.campaign_id]?.name || "—")}</td><td>${esc(creators[item.creator_id]?.display_name || "—")}</td><td><span class="status status-${statusTone(isPayments ? item.payment_status : item.sign_status)}">● ${esc(isPayments ? item.payment_status : item.sign_status)}</span></td><td>${fullDate(item.due_date)}</td>${isPayments ? `<td class="align-right"><strong>${money(item.amount, item.currency)}</strong></td>` : `<td>${esc(item.owner_email || "—")}</td>`}</tr>`).join("") || `<tr><td colspan="6">${emptyInline(`No ${type} found`)}</td></tr>`}</tbody></table></div>`;
  }

  function renderSettings() {
    return `${pageHeader("ADMINISTRATION", "Settings", "Manage access, roles and workspace configuration.")}<section class="settings-grid"><article class="panel"><div class="panel-head"><div><span class="eyebrow">TEAM ACCESS</span><h2>Users and roles</h2></div></div><div class="user-list">${state.data.profiles.map((profile) => `<div><span class="avatar">${initials(profile.name)}</span><span><strong>${esc(profile.name)}</strong><small>${esc(profile.email)}</small></span><span class="role-badge">${esc(profile.role)}</span><span class="status status-${profile.active ? "green" : "red"}">● ${profile.active ? "Active" : "Inactive"}</span></div>`).join("")}</div></article><article class="panel"><div class="panel-head"><div><span class="eyebrow">ENVIRONMENT</span><h2>Workspace status</h2></div></div><dl class="info-list"><div><dt>Data mode</dt><dd>${state.data.demo ? "Demo / browser storage" : "Supabase / shared"}</dd></div><div><dt>Timezone</dt><dd>${esc(window.KOL_CONFIG.timezone)}</dd></div><div><dt>Version</dt><dd>${esc(window.KOL_CONFIG.appVersion)}</dd></div></dl>${state.data.demo ? `<button class="btn btn-danger" data-action="reset-demo">Reset demo data</button>` : ""}</article></section>`;
  }

  function emptyInline(text) { return `<div class="empty-inline"><span>⌕</span><strong>${esc(text)}</strong></div>`; }
  function emptyBlock(title, text) { return `<div class="empty-block"><span>⌕</span><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`; }

  function showModal(content, size = "medium") {
    modalRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><div class="modal modal-${size}" role="dialog" aria-modal="true" onclick="event.stopPropagation()">${content}</div></div>`;
    $("input,select,button", modalRoot)?.focus();
  }

  function closeModal() { modalRoot.innerHTML = ""; }

  function field(label, name, type = "text", value = "", attrs = "") {
    return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${attrs}/></label>`;
  }

  function showCampaignForm(campaign = {}) {
    showModal(`<form id="campaign-form"><div class="modal-head"><div><span class="eyebrow">${campaign.id ? "UPDATE" : "NEW"} CAMPAIGN</span><h2>${campaign.id ? "Edit campaign" : "Create a campaign"}</h2></div><button type="button" class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body form-grid">${field("Campaign name", "name", "text", campaign.name, "required")}${field("App", "app", "text", campaign.app || "SNOW", "required")}<label class="field"><span>Market</span><select name="market"><option>VN</option><option>TH</option><option>TW</option><option>Global</option></select></label><label class="field"><span>Status</span><select name="status">${["Planning", "Sourcing", "Active", "Paused", "Completed", "Cancelled"].map((item) => `<option ${campaign.status === item ? "selected" : ""}>${item}</option>`).join("")}</select></label>${field("Objective", "objective", "text", campaign.objective)}${field("Platforms (comma-separated)", "platforms", "text", (campaign.platforms || ["TikTok"]).join(", "), "required")}${field("Posting start", "posting_start", "date", campaign.posting_start, "required")}${field("Posting end", "posting_end", "date", campaign.posting_end, "required")}${field("Target KOLs", "target_kols", "number", campaign.target_kols || 10, "min=1")}${field("Budget", "budget", "number", campaign.budget || 0, "min=0")}<label class="field"><span>Currency</span><select name="currency"><option>VND</option><option>THB</option><option>TWD</option><option>USD</option></select></label>${field("Marketing emails", "assigned_marketing", "text", (campaign.assigned_marketing || []).join(", "))}<input type="hidden" name="id" value="${esc(campaign.id || "")}" /></div><div class="modal-foot"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">${campaign.id ? "Save changes" : "Create campaign"}</button></div></form>`, "large");
  }

  function showNewKolForm() {
    showModal(`<form id="kol-form"><div class="modal-head"><div><span class="eyebrow">OUTREACH DATABASE</span><h2>Add a KOL</h2><p>Create the creator once, then add any platform accounts you know.</p></div><button type="button" class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body"><h3 class="form-section-title">Creator details</h3><div class="form-grid">${field("Display name", "display_name", "text", "", "required")}${field("Legal name", "legal_name")}
      <label class="field"><span>Market</span><select name="market"><option>VN</option><option>TH</option><option>TW</option></select></label>${field("Categories (comma-separated)", "categories")}${field("Contact value", "contact_value")}${field("Booking PIC", "pic")}</div><h3 class="form-section-title">Platform rates</h3><div class="platform-form-list">${["TikTok", "Instagram", "Threads"].map((platform, index) => `<div class="platform-form-row"><span class="platform-pill tone-${platformTone(platform)}">${platform}</span>${field("Profile link", `profile_url_${index}`, "url")}${field("Followers", `followers_${index}`, "number", 0, "min=0")}${field("Starting fee", `starting_fee_${index}`, "number", 0, "min=0")}<input type="hidden" name="platform_${index}" value="${platform}" /></div>`).join("")}<details class="optional-platforms"><summary>+ Add YouTube or Facebook</summary>${["YouTube", "Facebook"].map((platform, index) => { const n = index + 3; return `<div class="platform-form-row"><span class="platform-pill tone-${platformTone(platform)}">${platform}</span>${field("Profile link", `profile_url_${n}`, "url")}${field("Followers", `followers_${n}`, "number", 0, "min=0")}${field("Starting fee", `starting_fee_${n}`, "number", 0, "min=0")}<input type="hidden" name="platform_${n}" value="${platform}" /></div>`; }).join("")}</details></div></div><div class="modal-foot"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">Save KOL</button></div></form>`, "xlarge");
  }

  function showOutreachEdit(creatorId) {
    const creator = state.data.creators.find((item) => item.id === creatorId);
    const outreach = state.data.outreach_profiles.find((item) => item.creator_id === creatorId) || {};
    const accounts = state.data.accounts.filter((item) => item.creator_id === creatorId);
    if (!creator) return toast("Creator not found.", "error");
    showModal(`<form id="outreach-form"><div class="modal-head"><div><span class="eyebrow">OUTREACH PROFILE</span><h2>${esc(creator.display_name)}</h2><p>Update contact details and platform-level performance or rates.</p></div><button type="button" class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body"><input type="hidden" name="creator_id" value="${creator.id}"/><h3 class="form-section-title">Creator and contact</h3><div class="form-grid">${field("Display name", "display_name", "text", creator.display_name, "required")}${field("Categories (comma-separated)", "categories", "text", (creator.categories || []).join(", "))}<label class="field"><span>Outreach status</span><select name="status">${["New", "Contacted", "Replied", "Negotiating", "Deal", "Not interested", "Do not contact"].map((item) => `<option ${outreach.status === item ? "selected" : ""}>${item}</option>`).join("")}</select></label>${field("Booking PIC", "pic", "text", outreach.pic || "")}${field("Contact channel", "contact_channel", "text", outreach.contact_channel || "")}${field("Contact value", "contact_value", "text", outreach.contact_value || "")}${field("Email", "email", "email", outreach.email || "")}${field("Phone", "phone", "text", outreach.phone || "")}</div><h3 class="form-section-title platform-edit-title">Platform accounts</h3><div class="platform-form-list">${accounts.map((account, index) => `<div class="platform-form-row"><span class="platform-pill tone-${platformTone(account.platform)}">${esc(account.platform)}</span>${field("Profile link", `profile_url_${index}`, "url", account.profile_url)}${field("Followers", `followers_${index}`, "number", account.followers, "min=0")}${field("Starting fee", `starting_fee_${index}`, "number", account.starting_fee, "min=0")}<input type="hidden" name="account_id_${index}" value="${account.id}"/></div>`).join("")}</div><input type="hidden" name="account_count" value="${accounts.length}"/><label class="field outreach-note"><span>Internal note</span><textarea name="note" rows="3">${esc(outreach.note || "")}</textarea></label></div><div class="modal-foot"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">Save changes</button></div></form>`, "xlarge");
  }

  function showTargetModal(type, accountIds) {
    const isCampaign = type === "campaign";
    const targets = isCampaign ? state.data.campaigns.filter((item) => ACTIVE_CAMPAIGN_STATUSES.includes(item.status)) : state.data.shortlists;
    showModal(`<form id="target-form"><div class="modal-head"><div><span class="eyebrow">ADD ${accountIds.length} ACCOUNT${accountIds.length === 1 ? "" : "S"}</span><h2>${isCampaign ? "Choose a campaign" : "Choose a shortlist"}</h2></div><button type="button" class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body"><input type="hidden" name="type" value="${type}"/><input type="hidden" name="account_ids" value="${esc(accountIds.join(","))}"/><div class="target-list">${targets.map((item) => `<label><input type="radio" name="target_id" value="${item.id}" required/><span><strong>${esc(item.name)}</strong><small>${esc(item.market)} · ${isCampaign ? esc(item.status) : esc(item.status)}</small></span></label>`).join("") || emptyBlock(`No active ${isCampaign ? "campaigns" : "shortlists"}`, "Create one first, then try again.")}</div></div><div class="modal-foot"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit" ${targets.length ? "" : "disabled"}>Add accounts</button></div></form>`);
  }

  function showShortlistForm() {
    showModal(`<form id="shortlist-form"><div class="modal-head"><div><span class="eyebrow">CAMPAIGN PLANNING</span><h2>Create shortlist</h2></div><button type="button" class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body form-grid">${field("Shortlist name", "name", "text", "", "required")}<label class="field"><span>Market</span><select name="market"><option>VN</option><option>TH</option><option>TW</option></select></label>${field("Month", "month", "month", "2026-07")}<label class="field"><span>Campaign</span><select name="campaign_id"><option value="">Not assigned</option>${state.data.campaigns.map((item) => `<option value="${item.id}">${esc(item.name)}</option>`).join("")}</select></label></div><div class="modal-foot"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancel</button><button class="btn btn-primary">Create shortlist</button></div></form>`);
  }

  async function handleSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const submit = form.querySelector("button[type=submit],button:not([type])");
    if (submit) { submit.disabled = true; submit.textContent = "Saving…"; }
    try {
      if (form.id === "login-form") {
        await window.KOL_DATA.signIn(data.email, data.password);
        await reload();
        return;
      }
      if (form.id === "campaign-form") {
        const payload = { name: data.name, app: data.app, market: data.market, objective: data.objective, platforms: data.platforms.split(",").map((item) => item.trim()).filter(Boolean), posting_start: data.posting_start, posting_end: data.posting_end, target_kols: num(data.target_kols), budget: num(data.budget), currency: data.currency, status: data.status, owner_email: state.data.profile.email, assigned_marketing: data.assigned_marketing.split(",").map((item) => item.trim()).filter(Boolean) };
        data.id ? await window.KOL_DATA.update("campaigns", data.id, payload) : await window.KOL_DATA.insert("campaigns", { ...payload, code: `CMP-${new Date().getFullYear().toString().slice(-2)}-${data.market}-${String(state.data.campaigns.length + 1).padStart(3, "0")}` });
        toast(data.id ? "Campaign updated." : "Campaign created.");
      }
      if (form.id === "kol-form") {
        const accounts = [];
        for (let i = 0; i < 5; i += 1) accounts.push({ platform: data[`platform_${i}`], profile_url: data[`profile_url_${i}`], followers: num(data[`followers_${i}`]), starting_fee: num(data[`starting_fee_${i}`]), currency: "VND" });
        await window.KOL_DATA.createCreator({ display_name: data.display_name, legal_name: data.legal_name, market: data.market, categories: data.categories.split(",").map((item) => item.trim()).filter(Boolean), contact_value: data.contact_value, pic: data.pic, status: "New", accounts });
        toast("KOL saved. Rate-ready platforms are now available in KOL Database.");
      }
      if (form.id === "outreach-form") {
        await window.KOL_DATA.update("creators", data.creator_id, {
          display_name: data.display_name,
          categories: data.categories.split(",").map((item) => item.trim()).filter(Boolean),
        });
        await window.KOL_DATA.updateWhere("outreach_profiles", "creator_id", data.creator_id, {
          status: data.status,
          pic: data.pic,
          contact_channel: data.contact_channel,
          contact_value: data.contact_value,
          email: data.email,
          phone: data.phone,
          note: data.note,
          last_contacted_at: ["Contacted", "Replied", "Negotiating", "Deal"].includes(data.status) ? new Date().toISOString().slice(0, 10) : null,
        });
        for (let i = 0; i < num(data.account_count); i += 1) {
          await window.KOL_DATA.update("accounts", data[`account_id_${i}`], {
            profile_url: data[`profile_url_${i}`],
            followers: num(data[`followers_${i}`]),
            starting_fee: num(data[`starting_fee_${i}`]),
            last_verified: new Date().toISOString().slice(0, 10),
          });
        }
        toast("Outreach profile updated. KOL Database is synced automatically.");
      }
      if (form.id === "target-form") {
        const ids = data.account_ids.split(",").filter(Boolean);
        const result = data.type === "campaign" ? await window.KOL_DATA.addAccountsToCampaign(data.target_id, ids) : await window.KOL_DATA.addAccountsToShortlist(data.target_id, ids);
        toast(`${result.added} account${result.added === 1 ? "" : "s"} added${result.skipped ? `; ${result.skipped} skipped` : ""}.`);
        state.selectedAccounts.clear();
        state.selectedShortlistAccounts.clear();
      }
      if (form.id === "shortlist-form") {
        await window.KOL_DATA.insert("shortlists", { name: data.name, market: data.market, month: data.month, campaign_id: data.campaign_id || null, owner_email: state.data.profile.email, status: "Draft", notes: "" });
        toast("Shortlist created.");
      }
      closeModal();
      await reload();
    } catch (error) {
      toast(error.message, "error");
      if (submit) { submit.disabled = false; submit.textContent = "Save"; }
    }
  }

  document.addEventListener("submit", handleSubmit);

  document.addEventListener("click", async (event) => {
    const routeButton = event.target.closest("[data-route]");
    if (routeButton) { state.route = routeButton.dataset.route; state.campaignId = null; state.shortlistId = null; state.search = ""; render(); return; }
    const campaignButton = event.target.closest("[data-campaign-id]");
    if (campaignButton && !event.target.closest("a")) { state.route = "campaigns"; state.campaignId = campaignButton.dataset.campaignId; state.campaignTab = "overview"; render(); return; }
    const shortlistButton = event.target.closest("[data-shortlist-id]");
    if (shortlistButton) { state.route = "shortlists"; state.shortlistId = shortlistButton.dataset.shortlistId; render(); return; }
    const tab = event.target.closest("[data-campaign-tab]");
    if (tab) { state.campaignTab = tab.dataset.campaignTab; render(); return; }
    const outreachEdit = event.target.closest("[data-edit-outreach]");
    if (outreachEdit) { showOutreachEdit(outreachEdit.dataset.editOutreach); return; }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "retry") return boot();
    if (action === "toggle-sidebar") return $("#sidebar")?.classList.toggle("open");
    if (action === "close-modal") return closeModal();
    if (action === "back-campaigns") { state.campaignId = null; return render(); }
    if (action === "back-shortlists") { state.shortlistId = null; state.selectedShortlistAccounts.clear(); return render(); }
    if (action === "new-campaign") return showCampaignForm();
    if (action === "edit-campaign") return showCampaignForm(state.data.campaigns.find((item) => item.id === state.campaignId));
    if (action === "new-kol") return showNewKolForm();
    if (action === "new-shortlist") return showShortlistForm();
    if (action === "selection-clear") { state.selectedAccounts.clear(); return render(); }
    if (action === "selection-shortlist") return showTargetModal("shortlist", [...state.selectedAccounts]);
    if (action === "selection-campaign") return showTargetModal("campaign", [...state.selectedAccounts]);
    if (action === "shortlist-to-campaign") return showTargetModal("campaign", [...state.selectedShortlistAccounts]);
    if (action === "clear-db-filters") { state.databaseFilters = { platforms: [], app: "All", fee: "All", engagement: "0", categories: [], followers: [], status: "All" }; return render(); }
    if (action === "show-day") { const events = calendarEvents(state.campaignId).filter((item) => item.date === event.target.closest("[data-date]").dataset.date); return showModal(`<div class="modal-head"><div><span class="eyebrow">DAILY SCHEDULE</span><h2>${fullDate(events[0]?.date)}</h2></div><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body target-list">${events.map((item) => `<div class="day-modal-item"><span class="event-dot ${item.type.toLowerCase()}"></span><span><strong>${esc(item.title)}</strong><small>${esc(item.subtitle)}</small></span></div>`).join("")}</div>`); }
    if (action === "show-help") return showModal(`<div class="modal-head"><div><span class="eyebrow">QUICK GUIDE</span><h2>How this workspace works</h2></div><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body help-list"><div><strong>Booking/Admin</strong><p>Manage outreach, contact details and platform rates. Any account with a fee above 0 is synced into KOL Database.</p></div><div><strong>Marketing</strong><p>Browse rate-ready creators, select individual platforms, build shortlists and add KOLs to assigned campaigns.</p></div><div><strong>Budget</strong><p>Only Confirmed KOL value counts against campaign budget; selected and negotiating KOLs remain visible as pipeline value.</p></div></div>`);
    if (action === "profile-menu") return showModal(`<div class="modal-head"><div><span class="eyebrow">ACCOUNT</span><h2>${esc(state.data.profile.name)}</h2><p>${esc(state.data.profile.email)}</p></div><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body"><div class="profile-summary"><span class="avatar large">${initials(state.data.profile.name)}</span><div><strong>${esc(state.data.profile.role)}</strong><small>${esc(state.data.profile.market)} market access</small></div></div></div><div class="modal-foot"><button class="btn btn-danger" data-action="sign-out">Sign out</button></div>`);
    if (action === "sign-out") { await window.KOL_DATA.signOut(); closeModal(); return renderLogin(); }
    if (action === "reset-demo") { window.KOL_DATA.resetDemo(); toast("Demo data reset."); return reload(); }
    if (action === "import-kols") return toast("Use the CSV import template in the repository documentation.", "error");
  });

  document.addEventListener("change", async (event) => {
    const target = event.target;
    if (target.id === "global-market") { state.market = target.value; return render(); }
    if (target.id === "demo-role") { await window.KOL_DATA.switchDemoRole(target.value); state.route = "dashboard"; state.selectedAccounts.clear(); state.selectedShortlistAccounts.clear(); return reload(); }
    if (target.matches("[data-market]")) { state.market = target.dataset.market; return render(); }
    if (target.matches("[data-account-select]")) { target.checked ? state.selectedAccounts.add(target.dataset.accountSelect) : state.selectedAccounts.delete(target.dataset.accountSelect); return render(); }
    if (target.matches("[data-shortlist-account]")) { target.checked ? state.selectedShortlistAccounts.add(target.dataset.shortlistAccount) : state.selectedShortlistAccounts.delete(target.dataset.shortlistAccount); return render(); }
    if (target.matches("[data-db-filter]")) { state.databaseFilters[target.dataset.dbFilter] = target.value; return render(); }
    if (target.matches("[data-filter-group]")) { const group = target.dataset.filterGroup; const selected = new Set(state.databaseFilters[group]); target.checked ? selected.add(target.value) : selected.delete(target.value); state.databaseFilters[group] = [...selected]; return render(); }
    if (target.matches("[data-outreach-filter]")) { state.outreachFilters[target.dataset.outreachFilter] = target.value; return render(); }
  });

  let searchTimer;
  document.addEventListener("input", (event) => {
    if (!event.target.matches("#global-search,[data-search-sync]")) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.search = event.target.value.normalize("NFKC").trimStart(); render(); }, 180);
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("#global-search")?.focus(); }
    if (event.key === "Escape") closeModal();
  });

  boot();
})();
