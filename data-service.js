(function () {
  "use strict";

  const config = window.KOL_CONFIG || {};
  const demoKey = "kol-manager-demo-v2";
  let client = null;
  let demoProfileId = "usr-marketing";

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const now = () => new Date().toISOString();

  function isConfigured() {
    return Boolean(
      !config.demoMode &&
      config.supabaseUrl &&
      config.supabaseAnonKey &&
      !String(config.supabaseUrl).includes("YOUR_") &&
      !String(config.supabaseAnonKey).includes("YOUR_") &&
      window.supabase
    );
  }

  function demoStore() {
    const saved = localStorage.getItem(demoKey);
    if (saved) {
      try { return JSON.parse(saved); } catch (_) { localStorage.removeItem(demoKey); }
    }
    const initial = clone(window.KOL_DEMO_DATA);
    localStorage.setItem(demoKey, JSON.stringify(initial));
    return initial;
  }

  function saveDemo(data) {
    localStorage.setItem(demoKey, JSON.stringify(data));
    return data;
  }

  function demoProfile(data) {
    return data.profiles.find((item) => item.id === demoProfileId) || data.profiles[0];
  }

  function assertOk(result, label) {
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
    return result.data || [];
  }

  async function init() {
    if (!isConfigured()) return { mode: "demo" };
    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    return { mode: "supabase" };
  }

  async function getSession() {
    if (!isConfigured()) {
      const data = demoStore();
      return { user: { id: demoProfile(data).id, email: demoProfile(data).email }, profile: demoProfile(data), demo: true };
    }
    const sessionResult = await client.auth.getSession();
    const session = assertOk(sessionResult, "Unable to read session").session;
    if (!session) return null;
    const profileResult = await client.from("profiles").select("*").eq("id", session.user.id).single();
    const profile = assertOk(profileResult, "Unable to load user profile");
    if (!profile.active) throw new Error("Your account is inactive. Contact an administrator.");
    return { user: session.user, profile, demo: false };
  }

  async function signIn(email, password) {
    if (!isConfigured()) return getSession();
    assertOk(await client.auth.signInWithPassword({ email, password }), "Sign in failed");
    return getSession();
  }

  async function signOut() {
    if (!isConfigured()) return true;
    assertOk(await client.auth.signOut(), "Sign out failed");
    return true;
  }

  async function switchDemoRole(role) {
    const data = demoStore();
    const profile = data.profiles.find((item) => item.role === role);
    if (profile) demoProfileId = profile.id;
    return getSession();
  }

  async function bootstrap() {
    if (!isConfigured()) {
      const data = demoStore();
      return { ...clone(data), profile: clone(demoProfile(data)), demo: true };
    }

    const session = await getSession();
    if (!session) return null;
    const role = session.profile.role;
    const requests = [
      client.from("creators").select("*"),
      client.from("accounts").select("*"),
      client.from("campaigns").select("*").order("created_at", { ascending: false }),
      client.from("campaign_kols").select("*"),
      client.from("shortlists").select("*"),
      client.from("shortlist_accounts").select("*"),
      client.from("deliverables").select("*"),
    ];
    if (["Admin", "Booking"].includes(role)) {
      requests.push(
        client.from("outreach_profiles").select("*"),
        client.from("contracts").select("*"),
        client.from("payments").select("*")
      );
    }
    if (role === "Admin") requests.push(client.from("profiles").select("*"));
    const results = await Promise.all(requests);
    let i = 0;
    const data = {
      creators: assertOk(results[i++], "Unable to load creators"),
      accounts: assertOk(results[i++], "Unable to load accounts"),
      campaigns: assertOk(results[i++], "Unable to load campaigns"),
      campaign_kols: assertOk(results[i++], "Unable to load campaign KOLs"),
      shortlists: assertOk(results[i++], "Unable to load shortlists"),
      shortlist_accounts: assertOk(results[i++], "Unable to load shortlist KOLs"),
      deliverables: assertOk(results[i++], "Unable to load deliverables"),
      outreach_profiles: ["Admin", "Booking"].includes(role) ? assertOk(results[i++], "Unable to load outreach") : [],
      contracts: ["Admin", "Booking"].includes(role) ? assertOk(results[i++], "Unable to load contracts") : [],
      payments: ["Admin", "Booking"].includes(role) ? assertOk(results[i++], "Unable to load payments") : [],
      profiles: role === "Admin" ? assertOk(results[i++], "Unable to load users") : [session.profile],
      profile: session.profile,
      demo: false,
    };
    return data;
  }

  async function insert(table, payload) {
    if (!isConfigured()) {
      const data = demoStore();
      const record = { id: payload.id || uid(table.slice(0, 3)), ...payload, created_at: payload.created_at || now(), updated_at: now() };
      data[table].push(record);
      saveDemo(data);
      return clone(record);
    }
    const result = await client.from(table).insert(payload).select().single();
    return assertOk(result, `Unable to create ${table}`);
  }

  async function update(table, id, changes) {
    return updateWhere(table, "id", id, changes);
  }

  async function updateWhere(table, column, value, changes) {
    if (!isConfigured()) {
      const data = demoStore();
      const index = data[table].findIndex((item) => item[column] === value);
      if (index < 0) throw new Error("Record not found.");
      data[table][index] = { ...data[table][index], ...changes, updated_at: now() };
      saveDemo(data);
      return clone(data[table][index]);
    }
    const result = await client.from(table).update({ ...changes, updated_at: now() }).eq(column, value).select().single();
    return assertOk(result, `Unable to update ${table}`);
  }

  async function remove(table, id) {
    if (!isConfigured()) {
      const data = demoStore();
      data[table] = data[table].filter((item) => item.id !== id);
      saveDemo(data);
      return true;
    }
    assertOk(await client.from(table).delete().eq("id", id), `Unable to delete ${table}`);
    return true;
  }

  async function createCreator(payload) {
    if (!isConfigured()) {
      const data = demoStore();
      const creator = { id: uid("cre"), display_name: payload.display_name, legal_name: payload.legal_name || "", market: payload.market, city: payload.city || "", languages: payload.languages || [], categories: payload.categories || [], active: true };
      data.creators.push(creator);
      data.outreach_profiles.push({ creator_id: creator.id, status: payload.status || "New", pic: payload.pic || "", contact_channel: payload.contact_channel || "", contact_value: payload.contact_value || "", email: payload.email || "", phone: payload.phone || "", line_id: payload.line_id || "", note: payload.note || "", source_reference: payload.source_reference || "", last_contacted_at: "" });
      (payload.accounts || []).filter((account) => account.profile_url).forEach((account) => {
        data.accounts.push({ id: uid("acc"), creator_id: creator.id, platform: account.platform, username: account.username || "", profile_url: account.profile_url, followers: Number(account.followers || 0), avg_views: Number(account.avg_views || 0), engagement_rate: Number(account.engagement_rate || 0), starting_fee: Number(account.starting_fee || 0), currency: account.currency || "VND", app_fit: account.app_fit || [], active: true });
      });
      saveDemo(data);
      return clone(creator);
    }

    const creator = await insert("creators", {
      display_name: payload.display_name,
      legal_name: payload.legal_name || null,
      market: payload.market,
      city: payload.city || null,
      languages: payload.languages || [],
      categories: payload.categories || [],
      active: true,
    });
    await insert("outreach_profiles", {
      creator_id: creator.id,
      status: payload.status || "New",
      pic: payload.pic || null,
      contact_channel: payload.contact_channel || null,
      contact_value: payload.contact_value || null,
      email: payload.email || null,
      phone: payload.phone || null,
      line_id: payload.line_id || null,
      note: payload.note || null,
      source_reference: payload.source_reference || null,
    });
    const accounts = (payload.accounts || []).filter((account) => account.profile_url);
    for (const account of accounts) {
      await insert("accounts", {
        creator_id: creator.id,
        platform: account.platform,
        username: account.username || null,
        profile_url: account.profile_url,
        followers: Number(account.followers || 0),
        avg_views: Number(account.avg_views || 0),
        engagement_rate: Number(account.engagement_rate || 0),
        starting_fee: Number(account.starting_fee || 0),
        currency: account.currency || "VND",
        app_fit: account.app_fit || [],
        active: true,
      });
    }
    return creator;
  }

  async function addAccountsToCampaign(campaignId, accountIds) {
    const data = await bootstrap();
    const campaign = data.campaigns.find((item) => item.id === campaignId);
    if (!campaign) throw new Error("Campaign not found.");
    const existing = new Set(data.campaign_kols.filter((item) => item.campaign_id === campaignId).map((item) => item.account_id));
    let added = 0;
    for (const accountId of accountIds) {
      if (existing.has(accountId)) continue;
      const account = data.accounts.find((item) => item.id === accountId);
      if (!account || Number(account.starting_fee) <= 0) continue;
      await insert("campaign_kols", {
        campaign_id: campaignId,
        account_id: accountId,
        creator_id: account.creator_id,
        role: "Primary",
        pic_email: data.profile.email,
        booking_status: "Picked",
        quoted_fee: Number(account.starting_fee),
        final_fee: 0,
        currency: account.currency || campaign.currency,
        content_status: "Not started",
      });
      added += 1;
    }
    return { added, skipped: accountIds.length - added };
  }

  async function addAccountsToShortlist(shortlistId, accountIds) {
    const data = await bootstrap();
    const existing = new Set(data.shortlist_accounts.filter((item) => item.shortlist_id === shortlistId).map((item) => item.account_id));
    let added = 0;
    for (const accountId of accountIds) {
      if (existing.has(accountId)) continue;
      const account = data.accounts.find((item) => item.id === accountId);
      if (!account || Number(account.starting_fee) <= 0) continue;
      await insert("shortlist_accounts", { shortlist_id: shortlistId, account_id: accountId, picked: false, review_status: "New" });
      added += 1;
    }
    return { added, skipped: accountIds.length - added };
  }

  function resetDemo() {
    localStorage.removeItem(demoKey);
    return true;
  }

  window.KOL_DATA = {
    init,
    isConfigured,
    getSession,
    signIn,
    signOut,
    switchDemoRole,
    bootstrap,
    insert,
    update,
    updateWhere,
    remove,
    createCreator,
    addAccountsToCampaign,
    addAccountsToShortlist,
    resetDemo,
  };
})();
