/**
 * ============================================================================
 * KOL Campaign Manager v1.11.0 — PerformanceAuto.gs
 * ----------------------------------------------------------------------------
 * PASTE AS: new Apps Script file named  PerformanceAuto.gs
 *
 * PHASE 3 — Performance automation
 *
 *   1. doPost() webhook  — post_tracker.py pushes results straight into
 *      DELIVERABLES. No more copy-paste CSV. Authenticated by a shared key
 *      stored in Script Properties, not by Google account.
 *
 *   2. Instagram / Threads metrics  — best-effort Open Graph scrape so the
 *      in-app "Fetch" button is no longer TikTok-only. Honest about limits:
 *      IG/Threads expose likes and comments but not view counts, and they
 *      block datacentre IPs often. Post Tracker stays the reliable path.
 *
 *   3. Scheduled refresh  — a time-driven trigger that keeps live posts fresh
 *      automatically, prioritising recent posts and the stalest data first.
 *
 *   4. Run log + status API for the Performance screen.
 *
 * IMPORTANT — deployment note for the webhook:
 *   doPost only receives requests if the web app is deployed with
 *   "Who has access: Anyone". The main UI is still protected: every UI call
 *   goes through getCurrentUser_(), and doPost itself checks the shared key
 *   and never returns campaign data. See 12_INSTALL.md.
 *
 * Depends on existing helpers: APP, SCHEMA, getSheet_, getSpreadsheet_,
 * makeId_, readTable_, findRecord_, updateRecord_, withDocumentLock_,
 * requireRole_, logActivity_, publicValue_, cleanText_, toNumber_, isTrue_,
 * normalizeDirectUrl_, listCampaigns_, getAuthorizedCampaignKol_,
 * fetchTikTokMetrics_, parseDate_
 * ============================================================================
 */

const PERF_AUTO = Object.freeze({
  LOG_SHEET: 'PERF_RUN_LOG',
  LOG_HEADERS: Object.freeze([
    'Run_ID', 'Started_At', 'Finished_At', 'Trigger', 'Source',
    'Scanned', 'Updated', 'Failed', 'Notes',
  ]),
  // One Apps Script execution has ~6 minutes. 40 fetches at ~2-4s each leaves
  // comfortable headroom even when several time out.
  SCHEDULED_BATCH: 40,
  // Posts older than this stop being refreshed — their metrics have plateaued
  // and every fetch costs quota.
  ACTIVE_WINDOW_DAYS: 45,
  // Do not re-fetch anything updated more recently than this.
  MIN_REFRESH_HOURS: 8,
  SUPPORTED_PLATFORMS: Object.freeze(['tiktok', 'instagram', 'threads']),
  // The team Post Tracker API (a colleague's service). Read-only — this app
  // pulls; it cannot register a URL for tracking. Someone pastes the link into
  // the tracker's own web UI, numbers appear about 20 minutes later, then a
  // sync here picks them up.
  TEAM_API_BASE_CONFIG: 'PERF_API_BASE_URL',
  TEAM_API_KEY_CONFIG: 'PERF_API_KEY',
  // A SECOND, separately scoped key. Confirmed by probe: the read key gets 401 on
  // POST /api/v1/sync/posts, and the sync key gets 401 on the v1 read routes.
  TEAM_API_SYNC_KEY_CONFIG: 'PERF_API_SYNC_KEY',
  // Used only when the tracker has to CREATE a campaign. Must be @snowcorp.com.
  TEAM_API_OWNER_EMAIL: 'tranthinh244@snowcorp.com',
  TEAM_API_LIMIT: 20000,
  // Metrics the platform genuinely does not expose. The API sends 0 for these —
  // 309 of 539 tracked posts came back with saves: 0 on platforms that have no
  // saves at all — and writing that 0 would fabricate data and skew
  // Engagement_Rate. Keys match the DELIVERABLES column names.
  TEAM_API_UNSUPPORTED: Object.freeze({
    threads: Object.freeze(['Saves']),
    x: Object.freeze(['Shares', 'Saves']),
    twitter: Object.freeze(['Shares', 'Saves']),
    facebook: Object.freeze(['Reposts', 'Saves']),
    instagram: Object.freeze(['Reposts', 'Shares', 'Saves']),
    tiktok: Object.freeze([]),
  }),
  // Dừng lô sớm để không bị Apps Script kill ở mốc ~6 phút. Bị kill thì
  // perfWriteRunLog_ không bao giờ chạy và cả lần chạy đó mất dấu hoàn toàn.
  MAX_RUN_MS: 4 * 60 * 1000,
  // Ghi lại ai đã cài trigger. ScriptApp.getProjectTriggers() chỉ trả về trigger
  // của chính người gọi, nên không lưu chỗ này thì Admin thứ hai sẽ tưởng chưa ai
  // bật và tạo thêm một trigger nữa.
  TRIGGER_OWNER_KEY: 'PERF_TRIGGER_OWNER',
});

/* ============================================================================
 * SECTION 1 — Shared metric writer
 * ========================================================================== */

/**
 * The single place that writes metrics into DELIVERABLES. Used by the webhook,
 * the CSV import and the scheduled scan so the three paths can never drift.
 *
 * rows: [{ URL, Views, Likes, Comments, Reposts, Shares, Saves, Post_Date }]
 * options: { source, allowedCampaignIds (null = all), actorEmail }
 * Returns { matched, unmatched, unmatchedUrls, skipped }
 */
/**
 * Trả về số nếu value thực sự là một con số, ngược lại null.
 * Chấp nhận dạng có dấu phân cách nghìn ("1,234,567" hoặc "1.234.567") nhưng từ
 * chối mọi text khác. Cần thiết vì toNumber_ trả về 0 cho "N/A", "private", v.v.
 */
function perfParseMetricValue_(value) {
  if (typeof value === 'number') return isFinite(value) && value >= 0 ? value : null;
  const text = cleanText_(value);
  if (!text) return null;
  if (!/^\d+$/.test(text) && !/^\d{1,3}(?:[.,]\d{3})+$/.test(text)) return null;
  const parsed = Number(text.replace(/[.,]/g, ''));
  return isFinite(parsed) ? parsed : null;
}

function perfApplyMetricRows_(rows, options) {
  options = options || {};
  const source = cleanText_(options.source) || 'External import';
  const allowed = options.allowedCampaignIds || null;

  const deliverables = readTable_('DELIVERABLES').filter(function (row) {
    return !allowed || allowed[cleanText_(row.Campaign_ID)];
  });
  const byUrl = {};
  deliverables.forEach(function (row) {
    const key = normalizeDirectUrl_(row.Post_URL);
    if (key) byUrl[key] = row;
  });

  const metricFields = ['Views', 'Likes', 'Comments', 'Reposts', 'Shares', 'Saves'];
  const unmatchedUrls = [];
  let matched = 0;
  let skipped = 0;
  let rejected = 0;

  (rows || []).forEach(function (row) {
    const rawUrl = cleanText_(row && row.URL);
    if (!rawUrl) return;
    const target = byUrl[normalizeDirectUrl_(rawUrl)];
    if (!target) {
      unmatchedUrls.push(rawUrl);
      return;
    }

    const changes = {};
    metricFields.forEach(function (field) {
      const value = row[field];
      if (value === '' || value === null || typeof value === 'undefined') return;
      // Chỉ ghi khi ĐỌC ĐƯỢC một con số thật. toNumber_ trả về 0 cho mọi text lạ,
      // nên nếu không lọc thì một lần scrape thất bại (Post Tracker đẩy "N/A" hay
      // "private") sẽ ghi 0 đè lên số liệu thật mà vẫn được tính là "matched".
      const parsed = perfParseMetricValue_(value);
      if (parsed === null) { rejected += 1; return; }
      changes[field] = parsed;
    });
    if (!Object.keys(changes).length) {
      skipped += 1;
      return;
    }

    // Only fill Posting_Date when we do not already have one — the tracker's
    // scraped date is less trustworthy than what the team entered.
    const postDate = parseDate_(row.Post_Date);
    if (postDate && !cleanText_(target.Posting_Date)) changes.Posting_Date = postDate;

    changes.Performance_Updated_At = new Date();
    changes.Performance_Source = source;
    changes.Updated_At = new Date();

    updateRecord_('DELIVERABLES', 'Deliverable_ID', target.Deliverable_ID, changes);
    matched += 1;
  });

  return {
    matched: matched,
    unmatched: unmatchedUrls.length,
    unmatchedUrls: unmatchedUrls.slice(0, 15),
    skipped: skipped,
    // Số ô bị bỏ vì không phải con số — hiện ra để một lần push toàn "N/A" không
    // còn im lặng trôi qua như trước.
    rejected: rejected,
  };
}

/* ============================================================================
 * SECTION 2 — Team Post Tracker API (pull)
 * ----------------------------------------------------------------------------
 * Replaces the old doPost webhook, which could never work: appsscript.json runs
 * this deployment as USER_ACCESSING with access ANYONE, which forces a sign-in,
 * so an anonymous POST from post_tracker.py was always rejected. Pulling has no
 * such problem — an outbound UrlFetchApp call needs no deployment change — and
 * it also covers TikTok, X and Facebook, which this app's own OpenGraph scraper
 * cannot read at all.
 *
 * Configure two rows in the CONFIG sheet:
 *   PERF_API_BASE_URL   https://…/api/v1
 *   PERF_API_KEY        the shared team key
 * ========================================================================== */

/**
 * Reads a CONFIG row tolerantly. getConfigMap_ keys the map on the raw cell value,
 * so a key pasted as " PERF_API_KEY" or "perf_api_key" silently never matches —
 * and pasting is exactly how these two rows get added. Trim and case-fold both
 * sides instead of trusting the cell to be clean.
 */
function perfConfigValue_(config, wanted) {
  const target = cleanText_(wanted).toUpperCase();
  const names = Object.keys(config || {});
  for (let i = 0; i < names.length; i++) {
    if (cleanText_(names[i]).toUpperCase() === target) return cleanText_(config[names[i]]);
  }
  return '';
}

/**
 * Đọc TRỰC TIẾP vài key từ sheet CONFIG, không qua getConfigMap_ và KHÔNG xoá cache
 * CONFIG.
 *
 * Vì sao cần đọc thật: hai key API được DÁN TAY vào sheet nên không có đường nào gọi
 * invalidateTableCache_, và bản cache sẽ không thấy giá trị mới.
 *
 * Vì sao KHÔNG được xoá cả cache CONFIG để làm việc đó: CONFIG chứa hai công thức
 * GOOGLEFINANCE, và TABLE_CACHE_TTL_OVERRIDES cho riêng nó TTL 6 tiếng CHÍNH VÌ mỗi
 * lần đọc thật có thể buộc Sheets tính lại qua mạng — xem ghi chú dài ở
 * getCurrentUser_ và ở TABLE_CACHE_TTL_OVERRIDES trong Code.gs. Cách cũ
 * (invalidateTableCache_ + getConfigMap_) nghĩa là mỗi lần mở tab Performance là ném
 * đi cache 6 tiếng đó, và request kế tiếp của BẤT KỲ AI phải trả tiền đọc lạnh.
 *
 * Cách làm ở đây: đọc cột Key (A) một lần, rồi đọc riêng từng ô Value cần đến. Nhờ
 * vậy KHÔNG hề chạm vào ô nào chứa GOOGLEFINANCE — chúng nằm ở cột B của các dòng
 * khác. Khớp key theo trim + không phân biệt hoa thường, giữ đúng sự khoan dung mà
 * perfConfigValue_ đã có (một key dán thành " PERF_API_KEY" vẫn nhận ra).
 */
function perfReadConfigKeys_(wanted) {
  const targets = {};
  (wanted || []).forEach(function (name) { targets[cleanText_(name).toUpperCase()] = true; });
  const found = {};
  const sheet = getSheet_('CONFIG');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return found;
  const keys = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  keys.forEach(function (row, index) {
    const key = cleanText_(row[0]).toUpperCase();
    if (!targets[key] || Object.prototype.hasOwnProperty.call(found, key)) return;
    found[key] = cleanText_(sheet.getRange(index + 2, 2).getDisplayValue());
  });
  return found;
}

function perfTeamApiSettings_() {
  const config = perfReadConfigKeys_([
    PERF_AUTO.TEAM_API_BASE_CONFIG, PERF_AUTO.TEAM_API_KEY_CONFIG,
  ]);
  const base = cleanText_(config[PERF_AUTO.TEAM_API_BASE_CONFIG.toUpperCase()]).replace(/\/+$/, '');
  const key = cleanText_(config[PERF_AUTO.TEAM_API_KEY_CONFIG.toUpperCase()]);
  if (!base || !key) {
    throw new Error('The team performance API is not configured. The CONFIG sheet needs a row ' +
      'with Key = ' + PERF_AUTO.TEAM_API_BASE_CONFIG + ' and another with Key = ' +
      PERF_AUTO.TEAM_API_KEY_CONFIG + ', values in the Value column. ' +
      'Run debugTeamApiConfig() from the editor to see what the app can actually read.');
  }
  return { base: base, key: key };
}

/**
 * Run this from the Apps Script editor when the app says "not configured" but the
 * rows look present. Reports exactly what it can read, without printing the key.
 */
function debugTeamApiConfig() {
  requireRole_(['Admin']);
  invalidateTableCache_('CONFIG');
  const rows = readTable_('CONFIG');
  const config = getConfigMap_();
  const base = perfConfigValue_(config, PERF_AUTO.TEAM_API_BASE_CONFIG);
  const key = perfConfigValue_(config, PERF_AUTO.TEAM_API_KEY_CONFIG);
  const report = {
    configRowsVisible: rows.length,
    keysContainingPERF: rows
      .filter(function (row) { return String(row.Key || '').toUpperCase().indexOf('PERF') >= 0; })
      .map(function (row) {
        return { keyExactly: JSON.stringify(String(row.Key)), valueLength: cleanText_(row.Value).length };
      }),
    baseUrlFound: base || '(nothing)',
    keyFound: key ? 'yes, ' + key.length + ' chars' : 'no',
    verdict: (base && key) ? 'CONFIGURED — the sync should work' : 'NOT CONFIGURED',
  };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

/** Raw GET against the team API. The key goes in the header, never the URL. */
function perfTeamApiGet_(path, params) {
  const settings = perfTeamApiSettings_();
  const query = Object.keys(params || {})
    .filter(function (name) { return params[name] !== '' && params[name] != null; })
    .map(function (name) { return encodeURIComponent(name) + '=' + encodeURIComponent(params[name]); })
    .join('&');
  const url = settings.base + path + (query ? '?' + query : '');
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: { 'X-Api-Key': settings.key },
  });
  const status = response.getResponseCode();
  if (status === 401) throw new Error('The team API rejected the key (401). Check ' + PERF_AUTO.TEAM_API_KEY_CONFIG + ' in CONFIG.');
  if (status !== 200) throw new Error('The team API returned HTTP ' + status + '.');
  const parsed = JSON.parse(response.getContentText());
  return parsed && parsed.data ? parsed.data : [];
}

/**
 * One row per post URL, keeping the freshest scrape.
 *
 * The same post legitimately appears several times — it can belong to more than
 * one of the tracker's campaigns — so without deduping, whichever copy happened
 * to come last would win regardless of age.
 *
 * Keyed with normalizeDirectUrl_, the same helper DELIVERABLES is indexed by, so
 * both sides normalise identically: lower-cased, query string and fragment
 * stripped, trailing slash removed. Verified against real data — Threads links
 * carrying a long ?xmt=… and shortened vt.tiktok.com links both match.
 */
function perfTeamApiIndex_(rows) {
  const index = {};
  (rows || []).forEach(function (row) {
    const key = normalizeDirectUrl_(row && row.url);
    if (!key) return;
    const current = index[key];
    if (!current || cleanText_(row.last_scraped) > cleanText_(current.last_scraped)) {
      index[key] = row;
    }
  });
  return index;
}

/**
 * Converts tracker rows into the shape perfApplyMetricRows_ expects, dropping
 * anything that would write a fabricated number.
 */
function perfTeamApiMetricRows_(index) {
  const mapping = {
    Views: 'views', Likes: 'likes', Comments: 'comments',
    Reposts: 'reposts', Shares: 'shares', Saves: 'saves',
  };
  const out = [];
  let failed = 0;
  Object.keys(index).forEach(function (key) {
    const row = index[key];
    // A non-null error means the last scrape failed; its metrics are null or
    // stale, so the row is reported rather than written.
    if (cleanText_(row.error)) { failed += 1; return; }

    const platform = cleanText_(row.platform).toLowerCase();
    const unsupported = PERF_AUTO.TEAM_API_UNSUPPORTED[platform] || [];
    const metricRow = { URL: cleanText_(row.url), Post_Date: row.post_date || row.air_date || '' };

    Object.keys(mapping).forEach(function (field) {
      if (unsupported.indexOf(field) >= 0) return;
      const value = row[mapping[field]];
      if (value === null || typeof value === 'undefined') return;
      metricRow[field] = value;
    });

    // A post with engagement but zero views has not been read correctly — that
    // is Instagram's usual failure. Zero views alongside zero engagement is
    // plausible for something just posted, so only the contradiction is dropped.
    const engagement = ['Likes', 'Comments', 'Reposts', 'Shares', 'Saves'].reduce(function (total, field) {
      return total + (Number(metricRow[field]) || 0);
    }, 0);
    if (Number(metricRow.Views) === 0 && engagement > 0) delete metricRow.Views;

    out.push(metricRow);
  });
  return { rows: out, failed: failed };
}

/**
 * Post_URLs in DELIVERABLES that the tracker does not know about. These are the
 * ones someone still has to paste into the tracker's web UI, so they are worth
 * showing as a worklist instead of leaving as silently empty metric cells.
 */
function perfTeamApiUntracked_(index) {
  const campaigns = indexBy_(readTable_('CAMPAIGNS'), 'Campaign_ID');
  const accounts = indexBy_(readTable_('ACCOUNTS'), 'Account_ID');
  const seen = {};
  const untracked = [];
  readTable_('DELIVERABLES').forEach(function (row) {
    const url = cleanText_(row.Post_URL);
    if (!url) return;
    const key = normalizeDirectUrl_(url);
    if (index[key] || seen[key]) return;
    seen[key] = true;
    const campaign = campaigns[cleanText_(row.Campaign_ID)] || {};
    const account = accounts[cleanText_(row.Account_ID)] || {};
    const posting = parseDate_(row.Posting_Date);
    untracked.push({
      url: url,
      platform: cleanText_(row.Platform),
      campaignId: cleanText_(row.Campaign_ID),
      campaignName: cleanText_(campaign.Campaign_Name),
      app: cleanText_(campaign.App),
      market: normalizeMarket_(campaign.Market),
      displayName: cleanText_(account.Username) || cleanText_(row.Account_ID),
      airDate: posting ? Utilities.formatDate(posting, APP.TIMEZONE, 'yyyy-MM-dd') : '',
    });
  });
  return untracked;
}

/**
 * The tracker campaign a KOL Manager campaign maps onto, one-to-one. The name is
 * the contract between the two systems: POST /api/v1/sync/posts reuses an active
 * campaign matching the name exactly and creates one otherwise, so this must be
 * derived deterministically — never with a timestamp or a counter — or every push
 * would spawn another campaign in the colleague's tracker.
 */
function perfTrackerCampaignName_(item) {
  const id = cleanText_(item.campaignId);
  const app = cleanText_(item.app);
  const name = cleanText_(item.campaignName);
  // Campaign_Name usually already opens with the app ("SNOW - NƯỚC LẤP LÁNH"), so
  // prefixing it again produced "SNOW SNOW - …". Only prefix when it adds something.
  const alreadyPrefixed = app && name.toUpperCase().indexOf(app.toUpperCase()) === 0;
  const label = [alreadyPrefixed ? '' : app, name].filter(Boolean).join(' ');
  return [id, label].filter(Boolean).join(' · ');
}

/** POST to the team tracker. Uses the sync key, not the read key. */
function perfTeamApiPost_(path, body) {
  // Đọc đúng hai key cần, không xoá cache CONFIG — xem ghi chú ở perfReadConfigKeys_.
  const config = perfReadConfigKeys_([
    PERF_AUTO.TEAM_API_BASE_CONFIG, PERF_AUTO.TEAM_API_SYNC_KEY_CONFIG,
  ]);
  const base = cleanText_(config[PERF_AUTO.TEAM_API_BASE_CONFIG.toUpperCase()]).replace(/\/+$/, '');
  const key = cleanText_(config[PERF_AUTO.TEAM_API_SYNC_KEY_CONFIG.toUpperCase()]);
  if (!base) throw new Error('Missing ' + PERF_AUTO.TEAM_API_BASE_CONFIG + ' in CONFIG.');
  if (!key) {
    throw new Error('Pushing needs a second key. Add ' + PERF_AUTO.TEAM_API_SYNC_KEY_CONFIG +
      ' to the CONFIG sheet — the read key (' + PERF_AUTO.TEAM_API_KEY_CONFIG + ') cannot write.');
  }
  const response = UrlFetchApp.fetch(base + path, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { 'X-Api-Key': key },
    payload: JSON.stringify(body),
  });
  const status = response.getResponseCode();
  const text = response.getContentText();
  if (status === 401) throw new Error('The tracker rejected the sync key (401). Check ' + PERF_AUTO.TEAM_API_SYNC_KEY_CONFIG + '.');
  if (status === 422) throw new Error('The tracker rejected the payload (422): ' + text.slice(0, 300));
  if (status < 200 || status >= 300) throw new Error('The tracker returned HTTP ' + status + ': ' + text.slice(0, 200));
  return JSON.parse(text || '{}');
}

/**
 * Registers post URLs the tracker does not have yet, one request per KOL Manager
 * campaign because each maps to its own tracker campaign. Also fills in app,
 * market, display name and air date, which are null on most tracker rows today.
 * scrape: true queues the scrape immediately, so numbers land in ~20 minutes.
 */
function pushPostsToTeamTracker(payload) {
  const user = requireRole_(['Admin', 'Booking']);
  payload = payload || {};
  const onlyCampaign = cleanText_(payload.Campaign_ID);

  const index = perfTeamApiIndex_(perfTeamApiGet_('/metrics', { limit: PERF_AUTO.TEAM_API_LIMIT }));
  let untracked = perfTeamApiUntracked_(index);
  if (onlyCampaign) {
    untracked = untracked.filter(function (item) { return item.campaignId === onlyCampaign; });
  }
  if (!untracked.length) {
    return publicValue_({ pushed: 0, campaigns: [], message: 'Nothing to push — the tracker already has every post URL.' });
  }

  const groups = {};
  untracked.forEach(function (item) {
    const name = perfTrackerCampaignName_(item);
    groups[name] = groups[name] || { name: name, market: item.market, items: [] };
    groups[name].items.push(item);
  });

  const results = [];
  let pushed = 0;
  Object.keys(groups).forEach(function (name) {
    const group = groups[name];
    try {
      const response = perfTeamApiPost_('/sync/posts', {
        campaign: {
          name: group.name,
          market: group.market || null,
          description: 'Synced from KOL Manager',
          owner_email: PERF_AUTO.TEAM_API_OWNER_EMAIL,
        },
        posts: group.items.map(function (item) {
          const post = { url: item.url };
          if (item.displayName) post.display_name = item.displayName;
          if (item.app) post.app = item.app;
          if (item.market) post.market = item.market;
          if (item.airDate) post.air_date = item.airDate;
          // price is deliberately omitted: the tracker documents it as USD and
          // every fee in this workspace is VND.
          return post;
        }),
        scrape: true,
      });
      pushed += group.items.length;
      results.push({ campaign: group.name, posts: group.items.length, ok: true, response: response });
    } catch (error) {
      results.push({ campaign: group.name, posts: group.items.length, ok: false, error: error.message });
    }
  });

  logActivity_(user.Email, 'PUSH_TEAM_TRACKER', 'DELIVERABLES', '',
    pushed + ' post URL(s) pushed across ' + results.length + ' tracker campaign(s)');

  return publicValue_({ pushed: pushed, campaigns: results });
}

/** Pulls the tracker and writes what it can. Admin / Booking. */
function syncPerformanceFromTeamApi(payload) {
  const user = requireRole_(['Admin', 'Booking']);
  payload = payload || {};
  const startedAt = new Date();

  const raw = perfTeamApiGet_('/metrics', { limit: PERF_AUTO.TEAM_API_LIMIT });
  const index = perfTeamApiIndex_(raw);
  const converted = perfTeamApiMetricRows_(index);
  // Phải nằm trong lock như importPerformanceCsvV2 vẫn làm với CÙNG hàm này.
  // perfApplyMetricRows_ gọi updateRecord_ cho từng dòng khớp, mà updateRecord_ ghi
  // lại TOÀN BỘ dòng — chạy không lock song song với một saveDeliverable là mất
  // luôn Post_URL hoặc Content_Status mà người kia vừa lưu. Với TEAM_API_LIMIT =
  // 20.000 dòng tracker thì cửa sổ chồng lấn không hề nhỏ.
  const applied = withDocumentLock_(function () {
    return perfApplyMetricRows_(converted.rows, { source: 'Team API' });
  });
  const untracked = perfTeamApiUntracked_(index);

  perfWriteRunLog_({
    startedAt: startedAt,
    finishedAt: new Date(),
    trigger: 'team-api-sync',
    source: user.Email,
    scanned: converted.rows.length,
    updated: applied.matched,
    failed: converted.failed,
    notes: 'tracked=' + Object.keys(index).length + ' untracked=' + untracked.length +
      ' unmatched=' + applied.unmatched + ' rejected=' + applied.rejected,
  });
  logActivity_(user.Email, 'SYNC_TEAM_API', 'DELIVERABLES', '',
    applied.matched + ' deliverable(s) updated from the team tracker');

  return publicValue_({
    trackedPosts: Object.keys(index).length,
    scanned: converted.rows.length,
    matched: applied.matched,
    scrapeFailed: converted.failed,
    rejected: applied.rejected,
    skipped: applied.skipped,
    notInApp: applied.unmatched,
    untracked: untracked,
  });
}

/** The worklist on its own, so the UI can refresh it without a full sync. */
function getUntrackedPostUrls() {
  requireRole_(['Admin', 'Booking']);
  const index = perfTeamApiIndex_(perfTeamApiGet_('/metrics', { limit: PERF_AUTO.TEAM_API_LIMIT }));
  return publicValue_({ untracked: perfTeamApiUntracked_(index) });
}

/* ============================================================================
 * SECTION 3 — Instagram and Threads metrics (best effort)
 * ========================================================================== */

function perfFetchHtml_(url) {
  const options = {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  };
  let response;
  try {
    response = UrlFetchApp.fetch(url, options);
  } catch (error) {
    throw new Error('Could not connect: ' + (error.message || String(error)));
  }
  const status = response.getResponseCode();
  if (status !== 200) {
    throw new Error('Server returned status ' + status +
      '. Google servers are frequently blocked by Meta — use Post Tracker for this platform.');
  }
  return response.getContentText();
}

/** Pulls the og:description meta tag, which is where Meta puts the counters. */
function perfReadOgDescription_(html) {
  const patterns = [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([\s\S]*?)["']/i,
    /<meta[^>]+content=["']([\s\S]*?)["'][^>]+property=["']og:description["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i,
  ];
  for (let index = 0; index < patterns.length; index += 1) {
    const match = html.match(patterns[index]);
    if (match && match[1]) {
      return match[1]
        .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ').trim();
    }
  }
  return '';
}

/**
 * Turns "12.3K likes, 456 comments" into numbers. Handles K/M/B suffixes and
 * both 1,234 and 1.234 thousand separators.
 */
function perfParseCountText_(text) {
  const raw = cleanText_(text).replace(/,/g, '');
  const match = raw.match(/^([0-9]*\.?[0-9]+)\s*([KMB])?$/i);
  if (!match) return null;
  const base = Number(match[1]);
  if (!isFinite(base)) return null;
  const suffix = (match[2] || '').toUpperCase();
  const factor = suffix === 'B' ? 1e9 : suffix === 'M' ? 1e6 : suffix === 'K' ? 1e3 : 1;
  return Math.round(base * factor);
}

/**
 * Extracts whatever counters the og:description exposes.
 * Instagram/Threads do NOT publish view counts here, so Views stays absent —
 * we never write a zero over a real number.
 */
function perfMetricsFromDescription_(description) {
  const metrics = {};
  const patterns = [
    { field: 'Likes', regex: /([0-9][0-9.,]*\s*[KMB]?)\s*likes?/i },
    { field: 'Comments', regex: /([0-9][0-9.,]*\s*[KMB]?)\s*comments?/i },
    { field: 'Views', regex: /([0-9][0-9.,]*\s*[KMB]?)\s*(?:views|plays)/i },
    { field: 'Reposts', regex: /([0-9][0-9.,]*\s*[KMB]?)\s*reposts?/i },
    { field: 'Shares', regex: /([0-9][0-9.,]*\s*[KMB]?)\s*shares?/i },
  ];
  patterns.forEach(function (item) {
    const match = description.match(item.regex);
    if (!match) return;
    const value = perfParseCountText_(match[1]);
    if (value !== null) metrics[item.field] = value;
  });
  return metrics;
}

/** Instagram post / reel. Returns {} when nothing could be read. */
function perfFetchInstagramMetrics_(url) {
  const html = perfFetchHtml_(url);
  const description = perfReadOgDescription_(html);
  if (!description) {
    throw new Error('Instagram returned a login wall instead of post data. Use Post Tracker for Instagram.');
  }
  const metrics = perfMetricsFromDescription_(description);
  if (!Object.keys(metrics).length) {
    throw new Error('No counters were present in the Instagram response. Use Post Tracker for Instagram.');
  }
  return metrics;
}

/** Threads post. Same approach; Threads is slightly more permissive than IG. */
function perfFetchThreadsMetrics_(url) {
  const html = perfFetchHtml_(url);
  const description = perfReadOgDescription_(html);
  const metrics = description ? perfMetricsFromDescription_(description) : {};

  // Threads sometimes embeds counts as JSON instead of in the meta tag.
  if (!Object.keys(metrics).length) {
    const likeMatch = html.match(/"like_count"\s*:\s*([0-9]+)/);
    const replyMatch = html.match(/"(?:reply_count|text_post_app_reply_count)"\s*:\s*([0-9]+)/);
    const repostMatch = html.match(/"(?:repost_count|text_post_app_repost_count)"\s*:\s*([0-9]+)/);
    if (likeMatch) metrics.Likes = toNumber_(likeMatch[1]);
    if (replyMatch) metrics.Comments = toNumber_(replyMatch[1]);
    if (repostMatch) metrics.Reposts = toNumber_(repostMatch[1]);
  }
  if (!Object.keys(metrics).length) {
    throw new Error('No counters were found in the Threads response. Use Post Tracker for Threads.');
  }
  return metrics;
}

/** Dispatches to the right scraper. Throws for unsupported platforms. */
function perfFetchMetricsForPlatform_(platform, url) {
  const key = cleanText_(platform).toLowerCase();
  if (key === 'tiktok') {
    return { metrics: fetchTikTokMetrics_(url), source: 'TikTok direct scan' };
  }
  if (key === 'instagram') {
    return { metrics: perfFetchInstagramMetrics_(url), source: 'Instagram meta scan' };
  }
  if (key === 'threads') {
    return { metrics: perfFetchThreadsMetrics_(url), source: 'Threads meta scan' };
  }
  throw new Error('Automatic fetching is not available for ' + cleanText_(platform) +
    '. Supported: ' + PERF_AUTO.SUPPORTED_PLATFORMS.join(', ') + '.');
}

/**
 * Replaces the TikTok-only fetchDeliverablePerformance for one deliverable.
 * Called from the UI as 'fetchDeliverablePerformanceV2'.
 * payload: { Deliverable_ID }
 */
function fetchDeliverablePerformanceV2(payload) {
  const user = requireRole_(['Admin', 'Booking', 'Marketing']);
  payload = payload || {};
  const deliverableId = cleanText_(payload.Deliverable_ID);
  const deliverable = findRecord_('DELIVERABLES', 'Deliverable_ID', deliverableId);
  if (!deliverable) throw new Error('Deliverable not found.');
  getAuthorizedCampaignKol_(user, deliverable.Campaign_KOL_ID);

  const url = cleanText_(deliverable.Post_URL);
  if (!url) throw new Error('This deliverable does not have a Post URL yet.');

  const fetched = perfFetchMetricsForPlatform_(deliverable.Platform, url);
  return withDocumentLock_(function () {
    const changes = {};
    Object.keys(fetched.metrics).forEach(function (field) {
      changes[field] = toNumber_(fetched.metrics[field]);
    });
    changes.Performance_Updated_At = new Date();
    changes.Performance_Source = fetched.source;
    changes.Updated_At = new Date();
    updateRecord_('DELIVERABLES', 'Deliverable_ID', deliverableId, changes);
    logActivity_(user.Email, 'FETCH_PERFORMANCE', 'DELIVERABLE', deliverableId, fetched.source);
    return publicValue_({
      success: true,
      metrics: changes,
      source: fetched.source,
      partial: typeof changes.Views === 'undefined',
    });
  });
}

/**
 * Multi-platform batch scan. Replaces scanTikTokPerformance in the UI.
 * payload: { Campaign_ID, limit, platforms }
 */
function scanPerformanceAll(payload) {
  const user = requireRole_(['Admin', 'Booking', 'Marketing']);
  payload = payload || {};

  const visibleCampaignIds = {};
  listCampaigns_(user).forEach(function (campaign) {
    visibleCampaignIds[campaign.Campaign_ID] = true;
  });
  const campaignId = cleanText_(payload.Campaign_ID);
  if (campaignId && !visibleCampaignIds[campaignId]) {
    throw new Error('Campaign is not available to this user.');
  }

  const requested = Array.isArray(payload.platforms) && payload.platforms.length
    ? payload.platforms.map(function (item) { return cleanText_(item).toLowerCase(); })
    : PERF_AUTO.SUPPORTED_PLATFORMS.slice();
  const limit = Math.min(60, Math.max(1, Math.round(toNumber_(payload.limit) || 25)));

  const targets = perfSelectRefreshTargets_({
    allowedCampaignIds: visibleCampaignIds,
    campaignId: campaignId,
    platforms: requested,
    limit: limit,
    minRefreshHours: 0,
    activeWindowDays: 0,
  });

  const startedAt = new Date();
  const outcome = perfRunBatch_(targets);
  perfWriteRunLog_({
    startedAt: startedAt,
    trigger: 'manual',
    source: user.Email,
    scanned: targets.length,
    updated: outcome.updated,
    failed: outcome.failed.length,
    notes: outcome.failed.slice(0, 3).map(function (item) { return item.Error; }).join(' | '),
  });
  logActivity_(user.Email, 'SCAN_PERFORMANCE', 'DELIVERABLES', '',
    outcome.updated + ' updated; ' + outcome.failed.length + ' failed');

  return publicValue_({
    scanned: targets.length,
    updated: outcome.updated,
    partial: outcome.partial,
    failed: outcome.failed.slice(0, 10),
    hasMore: targets.length === limit,
    byPlatform: outcome.byPlatform,
  });
}

/**
 * Picks which deliverables to refresh, stalest-first inside the active window.
 * options: { allowedCampaignIds, campaignId, platforms, limit,
 *            minRefreshHours, activeWindowDays }
 */
function perfSelectRefreshTargets_(options) {
  const now = Date.now();
  const platforms = {};
  (options.platforms || []).forEach(function (item) { platforms[cleanText_(item).toLowerCase()] = true; });
  const minRefreshMs = Math.max(0, toNumber_(options.minRefreshHours)) * 3600 * 1000;
  const activeWindowMs = Math.max(0, toNumber_(options.activeWindowDays)) * 86400 * 1000;

  return readTable_('DELIVERABLES').filter(function (row) {
    if (options.allowedCampaignIds && !options.allowedCampaignIds[cleanText_(row.Campaign_ID)]) return false;
    if (options.campaignId && cleanText_(row.Campaign_ID) !== options.campaignId) return false;
    if (!platforms[cleanText_(row.Platform).toLowerCase()]) return false;
    if (!cleanText_(row.Post_URL)) return false;

    if (minRefreshMs) {
      const lastUpdated = parseDate_(row.Performance_Updated_At);
      if (lastUpdated && now - lastUpdated.getTime() < minRefreshMs) return false;
    }
    if (activeWindowMs) {
      const posted = parseDate_(row.Posting_Date) || parseDate_(row.Post_Submitted_At);
      // No posting date means we cannot judge age — keep it in, it is probably new.
      if (posted && now - posted.getTime() > activeWindowMs) return false;
    }
    return true;
  }).sort(function (a, b) {
    // Never refreshed first, then oldest refresh first.
    const aTime = (parseDate_(a.Performance_Updated_At) || new Date(0)).getTime();
    const bTime = (parseDate_(b.Performance_Updated_At) || new Date(0)).getTime();
    return aTime - bTime;
  }).slice(0, Math.max(1, toNumber_(options.limit) || PERF_AUTO.SCHEDULED_BATCH));
}

/** Fetches and writes a batch. Never throws — every failure is collected. */
function perfRunBatch_(targets) {
  let updated = 0;
  let partial = 0;
  let skippedForTime = 0;
  const failed = [];
  const byPlatform = {};
  const startedMs = Date.now();
  const metricFields = ['Views', 'Likes', 'Comments', 'Shares', 'Saves', 'Reposts'];

  (targets || []).forEach(function (row) {
    // Hết thời gian an toàn thì bỏ phần còn lại thay vì để Apps Script kill giữa
    // đường — bị kill thì không có dòng log nào được ghi.
    if (Date.now() - startedMs > PERF_AUTO.MAX_RUN_MS) { skippedForTime += 1; return; }

    const platform = cleanText_(row.Platform).toLowerCase();
    byPlatform[platform] = byPlatform[platform] || { updated: 0, failed: 0 };
    try {
      const fetched = perfFetchMetricsForPlatform_(row.Platform, row.Post_URL);
      const changes = {};
      let positive = 0;
      Object.keys(fetched.metrics).forEach(function (field) {
        const value = toNumber_(fetched.metrics[field]);
        changes[field] = value;
        if (value > 0) positive += 1;
      });
      if (!Object.keys(changes).length) throw new Error('No metrics returned.');
      // fetchTikTokMetrics_ đọc item.statsV2 || item.stats || {} rồi bọc mọi field
      // qua toNumber_, nên khi TikTok đổi cấu trúc stats thì stats = {} và cả 5
      // field thành 0 trong khi trang vẫn trả HTTP 200 — không có gì báo lỗi. Một
      // bài TỪNG có số liệu thật mà nay trả về toàn 0 gần như chắc chắn là fetch
      // thất bại, nên coi là lỗi để không ghi 0 đè lên số thật, và để ngưỡng cảnh
      // báo email thực sự nổ.
      if (!positive && metricFields.some(function (f) { return toNumber_(row[f]) > 0; })) {
        throw new Error('Every metric came back zero for a post that already had real numbers — treated as a failed fetch instead of overwriting it.');
      }
      if (typeof changes.Views === 'undefined') partial += 1;
      changes.Performance_Updated_At = new Date();
      changes.Performance_Source = fetched.source;
      changes.Updated_At = new Date();
      // Chỉ giữ lock quanh lần GHI. Trước đây cả lô — gồm toàn bộ UrlFetch — nằm
      // trong một lock duy nhất, giữ script lock 100-200 giây và làm mọi người
      // khác bị lock-timeout khi lưu record hay tạo hợp đồng.
      withDocumentLock_(function () {
        updateRecord_('DELIVERABLES', 'Deliverable_ID', row.Deliverable_ID, changes);
      });
      updated += 1;
      byPlatform[platform].updated += 1;
    } catch (error) {
      failed.push({
        Deliverable_ID: row.Deliverable_ID,
        Platform: row.Platform,
        Post_URL: row.Post_URL,
        Error: error.message || String(error),
      });
      byPlatform[platform].failed += 1;
    }
  });

  return {
    updated: updated,
    partial: partial,
    failed: failed,
    byPlatform: byPlatform,
    skippedForTime: skippedForTime,
  };
}

/* ============================================================================
 * SECTION 4 — Scheduled refresh
 * ========================================================================== */

/**
 * Time-driven entry point. Do NOT call requireRole_ here — a trigger runs as
 * the installing user with no active session in the usual sense.
 */
/**
 * Có ĐÚNG là một trigger thời gian đang gọi hay không — kiểm bằng thứ người gọi
 * KHÔNG thể tự bịa.
 *
 * Cách cũ suy ra từ chính argument: `Boolean(e && (e.triggerUid || e.authMode || …))`.
 * Nhưng google.script.run truyền argument của client vào đúng chỗ `e`, nên
 * runScheduledPerformanceRefresh({authMode: 1}) làm cờ đó thành true và requireRole_
 * không bao giờ chạy. Bất kỳ ai mở được app đều đốt được 40 lượt UrlFetch dưới danh
 * nghĩa chủ script, và ghi DELIVERABLES của MỌI campaign đang chạy — bỏ qua hẳn
 * canAccessCampaign_.
 *
 * Cách mới: đối chiếu e.triggerUid với danh sách trigger THẬT của project. Client bịa
 * được chuỗi, nhưng không bịa được một uid khớp trigger đang tồn tại cho đúng handler
 * này. getProjectTriggers() chỉ trả về trigger của chính người gọi — khi trigger nổ thì
 * "người gọi" là người đã cài, nên trigger của họ nhìn thấy được; còn muốn tự tạo một
 * trigger như vậy thì phải qua installPerformanceAutoTrigger, mà hàm đó Admin-only.
 *
 * Quan trọng: cách này KHÔNG cần đổi tên handler, nên KHÔNG cần cài lại trigger. Đổi
 * tên thì Apps Script không đi theo tên mới và automation chết âm thầm.
 */
function perfIsGenuineTrigger_(e) {
  const uid = cleanText_(e && e.triggerUid);
  if (!uid) return false;
  try {
    return ScriptApp.getProjectTriggers().some(function (trigger) {
      return trigger.getUniqueId() === uid &&
        trigger.getHandlerFunction() === 'runScheduledPerformanceRefresh';
    });
  } catch (error) {
    // Không đọc được danh sách trigger thì coi như KHÔNG phải trigger, và để
    // requireRole_ quyết định. Chọn hướng an toàn: thà chặn một lần chạy tự động còn
    // hơn mở lại đúng cái lỗ vừa bịt.
    return false;
  }
}

/**
 * Điểm vào của trigger thời gian. Cũng gọi tay được, nhưng chỉ Admin.
 * Toàn bộ phần việc nằm ở runScheduledPerformanceRefresh_ (private) để không có
 * đường nào chạy được nó mà bỏ qua cửa này.
 */
function runScheduledPerformanceRefresh(e) {
  if (!perfIsGenuineTrigger_(e)) requireRole_(['Admin']);
  return runScheduledPerformanceRefresh_();
}

function runScheduledPerformanceRefresh_() {
  const startedAt = new Date();

  // Only refresh posts belonging to campaigns that are still running; a closed
  // campaign's numbers no longer move.
  const activeCampaignIds = {};
  readTable_('CAMPAIGNS').forEach(function (campaign) {
    const status = cleanText_(campaign.Status);
    if (['Cancelled', 'Completed', 'Closed', 'Archived'].indexOf(status) >= 0) return;
    activeCampaignIds[cleanText_(campaign.Campaign_ID)] = true;
  });

  const targets = perfSelectRefreshTargets_({
    allowedCampaignIds: activeCampaignIds,
    campaignId: '',
    platforms: PERF_AUTO.SUPPORTED_PLATFORMS.slice(),
    limit: PERF_AUTO.SCHEDULED_BATCH,
    minRefreshHours: PERF_AUTO.MIN_REFRESH_HOURS,
    activeWindowDays: PERF_AUTO.ACTIVE_WINDOW_DAYS,
  });

  if (!targets.length) {
    perfWriteRunLog_({
      startedAt: startedAt, trigger: 'scheduled', source: 'trigger',
      scanned: 0, updated: 0, failed: 0, notes: 'Nothing due for refresh.',
    });
    return;
  }

  let outcome = { updated: 0, partial: 0, failed: [], byPlatform: {} };
  try {
    // perfRunBatch_ tự lấy lock quanh từng lần ghi, nên không bọc cả lô ở đây nữa.
    outcome = perfRunBatch_(targets);
  } catch (error) {
    perfWriteRunLog_({
      startedAt: startedAt, trigger: 'scheduled', source: 'trigger',
      scanned: targets.length, updated: 0, failed: targets.length,
      notes: 'ERROR: ' + (error.message || String(error)),
    });
    return;
  }

  perfWriteRunLog_({
    startedAt: startedAt,
    trigger: 'scheduled',
    source: 'trigger',
    scanned: targets.length,
    updated: outcome.updated,
    failed: outcome.failed.length,
    notes: outcome.failed.slice(0, 3).map(function (item) {
      return cleanText_(item.Platform) + ': ' + item.Error;
    }).join(' | '),
  });

  // Only shout when the run mostly failed — a couple of blocked URLs is normal.
  const failureRate = targets.length ? outcome.failed.length / targets.length : 0;
  if (failureRate >= 0.6 && outcome.failed.length >= 5) {
    perfNotifyAdmins_(outcome, targets.length);
  }
}

function perfNotifyAdmins_(outcome, scanned) {
  const admins = readTable_('USERS').filter(function (row) {
    return isTrue_(row.Active) && cleanText_(row.Role) === 'Admin' && cleanText_(row.Email);
  }).map(function (row) { return cleanText_(row.Email); });
  if (!admins.length) return;

  const lines = outcome.failed.slice(0, 10).map(function (item) {
    return '<li>' + cleanText_(item.Platform) + ' — ' + cleanText_(item.Post_URL) +
      '<br><small>' + cleanText_(item.Error) + '</small></li>';
  }).join('');

  try {
    MailApp.sendEmail({
      to: admins.join(','),
      subject: '[KOL Manager] Scheduled performance refresh is mostly failing',
      htmlBody: '<p>The scheduled performance refresh scanned <strong>' + scanned +
        '</strong> posts and failed on <strong>' + outcome.failed.length + '</strong>.</p>' +
        '<p>This usually means the platform started blocking Google servers. ' +
        'Sync from the team tracker instead — Performance → Sync from team API.</p>' +
        '<ul>' + lines + '</ul>',
    });
  } catch (error) {
    // Mail quota exhausted — the run log already recorded the failure.
  }
}

/**
 * Installs (or reinstalls) the recurring refresh.
 * payload: { everyHours } — 1, 2, 4, 6, 8 or 12. Default 6.
 */
function installPerformanceAutoTrigger(payload) {
  const user = requireRole_(['Admin']);
  payload = payload || {};
  const allowed = [1, 2, 4, 6, 8, 12];
  const requested = Math.round(toNumber_(payload.everyHours) || 6);
  const everyHours = allowed.indexOf(requested) >= 0 ? requested : 6;

  // ScriptApp.getProjectTriggers() chỉ trả về trigger do CHÍNH người gọi tạo, nên
  // Admin thứ hai không thấy trigger của Admin thứ nhất, bật thêm một cái nữa, và
  // hai trigger chạy song song: gấp đôi quota fetch, tranh nhau script lock, và
  // không ai xoá được của người kia. Ghi lại chủ sở hữu để chặn đúng trường hợp đó.
  const props = PropertiesService.getScriptProperties();
  const owner = cleanText_(props.getProperty(PERF_AUTO.TRIGGER_OWNER_KEY)).toLowerCase();
  const mine = cleanText_(user.Email).toLowerCase();
  if (owner && owner !== mine) {
    throw new Error('The refresh schedule is already installed by ' + owner +
      '. Ask that account to turn it off or change the interval — Apps Script only lets a user manage their own triggers.');
  }

  perfRemoveAutoTrigger_();
  ScriptApp.newTrigger('runScheduledPerformanceRefresh')
    .timeBased()
    .everyHours(everyHours)
    .create();
  props.setProperty(PERF_AUTO.TRIGGER_OWNER_KEY, mine);

  logActivity_(user.Email, 'INSTALL_TRIGGER', 'CONFIG', 'runScheduledPerformanceRefresh',
    'every ' + everyHours + 'h');
  return publicValue_({ installed: true, everyHours: everyHours });
}

/** Client-facing, Admin-guarded entry point for turning the schedule off. */
function disablePerformanceAutoTrigger() {
  const user = requireRole_(['Admin']);
  const props = PropertiesService.getScriptProperties();
  const owner = cleanText_(props.getProperty(PERF_AUTO.TRIGGER_OWNER_KEY)).toLowerCase();
  const mine = cleanText_(user.Email).toLowerCase();
  const removed = perfRemoveAutoTrigger_();
  // Không xoá được gì mà chủ sở hữu lại là người khác -> nói rõ, đừng báo thành công
  // rồi để status vẫn hiện "đang bật" một cách bí ẩn.
  if (!removed && owner && owner !== mine) {
    throw new Error('The schedule belongs to ' + owner +
      ' — only that account can turn it off, because Apps Script exposes only the triggers a user created themselves.');
  }
  if (removed) props.deleteProperty(PERF_AUTO.TRIGGER_OWNER_KEY);
  logActivity_(user.Email, 'REMOVE_TRIGGER', 'CONFIG', 'runScheduledPerformanceRefresh',
    removed + ' trigger(s) removed');
  return publicValue_({ removed: removed });
}

/**
 * Removes the recurring refresh. Safe to call when nothing is installed.
 * PRIVATE (dấu gạch dưới cuối) là có chủ ý: khi còn là global thường thì hàm này
 * client gọi được mà không hề kiểm tra quyền, nên bất kỳ ai có URL /exec đều tắt
 * được toàn bộ automation. Mọi lối vào từ UI phải qua disablePerformanceAutoTrigger.
 */
function perfRemoveAutoTrigger_() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() !== 'runScheduledPerformanceRefresh') return;
    ScriptApp.deleteTrigger(trigger);
    removed += 1;
  });
  return removed;
}

/* ============================================================================
 * SECTION 5 — Run log + status API
 * ========================================================================== */

function perfEnsureLogSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(PERF_AUTO.LOG_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(PERF_AUTO.LOG_SHEET);
    sheet.hideSheet();
  }
  const headers = PERF_AUTO.LOG_HEADERS;
  const firstCell = sheet.getLastColumn() ? cleanText_(sheet.getRange(1, 1).getDisplayValue()) : '';
  if (firstCell !== headers[0]) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers.slice()])
      .setFontWeight('bold').setBackground('#eef2fb');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function perfWriteRunLog_(entry) {
  try {
    const sheet = perfEnsureLogSheet_();
    sheet.appendRow([
      makeId_('RUN'),
      entry.startedAt || new Date(),
      new Date(),
      entry.trigger || '',
      entry.source || '',
      toNumber_(entry.scanned),
      toNumber_(entry.updated),
      toNumber_(entry.failed),
      String(entry.notes || '').slice(0, 2000),
    ]);
    // Keep the log bounded so it never becomes the biggest sheet in the file.
    const lastRow = sheet.getLastRow();
    if (lastRow > 501) sheet.deleteRows(2, lastRow - 501);
  } catch (error) {
    // Logging must never break the work it is logging.
  }
}

/**
 * Everything the Performance screen's automation panel needs.
 * Booking/Admin only — Marketing does not manage automation.
 */
function getPerformanceAutomationStatus() {
  const user = requireRole_(['Admin', 'Booking']);
  const isAdmin = user.Role === 'Admin';

  const triggers = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === 'runScheduledPerformanceRefresh';
  });

  const sheet = perfEnsureLogSheet_();
  const lastRow = sheet.getLastRow();
  const headers = PERF_AUTO.LOG_HEADERS;
  let runs = [];
  if (lastRow > 1) {
    const take = Math.min(25, lastRow - 1);
    runs = sheet.getRange(lastRow - take + 1, 1, take, headers.length).getValues()
      .map(function (row) {
        const object = {};
        headers.forEach(function (header, index) { object[header] = row[index]; });
        return object;
      })
      .reverse();
  }

  const deliverables = readTable_('DELIVERABLES').filter(function (row) {
    return Boolean(cleanText_(row.Post_URL));
  });
  const now = Date.now();
  const staleCutoff = 24 * 3600 * 1000;
  const coverage = { total: deliverables.length, never: 0, stale: 0, fresh: 0 };
  const platformCoverage = {};

  deliverables.forEach(function (row) {
    const platform = cleanText_(row.Platform) || 'Unknown';
    platformCoverage[platform] = platformCoverage[platform] || { total: 0, automatable: 0 };
    platformCoverage[platform].total += 1;
    if (PERF_AUTO.SUPPORTED_PLATFORMS.indexOf(platform.toLowerCase()) >= 0) {
      platformCoverage[platform].automatable += 1;
    }
    const updated = parseDate_(row.Performance_Updated_At);
    if (!updated) coverage.never += 1;
    else if (now - updated.getTime() > staleCutoff) coverage.stale += 1;
    else coverage.fresh += 1;
  });

  const scriptProps = PropertiesService.getScriptProperties();
  const scheduleOwner = cleanText_(scriptProps.getProperty(PERF_AUTO.TRIGGER_OWNER_KEY));

  return publicValue_({
    canManage: isAdmin,
    // triggers[] chỉ chứa trigger của CHÍNH người gọi, nên trước đây Admin thứ hai
    // luôn thấy scheduled: false dù lịch vẫn đang chạy — rồi bật thêm một cái nữa.
    // Kết hợp với chủ sở hữu đã lưu để trả về trạng thái đúng sự thật.
    scheduled: triggers.length > 0 || Boolean(scheduleOwner),
    scheduleOwner: scheduleOwner,
    scheduleOwnedByMe: triggers.length > 0,
    // Trước đây dòng này xoá cache CONFIG mỗi lần render tab Performance, tức ném đi
    // TTL 6 tiếng vốn tồn tại để tránh đọc lại hai công thức GOOGLEFINANCE. Giờ chỉ
    // đọc đúng hai ô cần — xem perfReadConfigKeys_.
    teamApiConfigured: (function () {
      const config = perfReadConfigKeys_([
        PERF_AUTO.TEAM_API_BASE_CONFIG, PERF_AUTO.TEAM_API_KEY_CONFIG,
      ]);
      return Boolean(cleanText_(config[PERF_AUTO.TEAM_API_BASE_CONFIG.toUpperCase()]) &&
        cleanText_(config[PERF_AUTO.TEAM_API_KEY_CONFIG.toUpperCase()]));
    })(),
    supportedPlatforms: PERF_AUTO.SUPPORTED_PLATFORMS,
    coverage: coverage,
    platformCoverage: platformCoverage,
    runs: runs,
    settings: {
      batchSize: PERF_AUTO.SCHEDULED_BATCH,
      minRefreshHours: PERF_AUTO.MIN_REFRESH_HOURS,
      activeWindowDays: PERF_AUTO.ACTIVE_WINDOW_DAYS,
    },
  });
}

/**
 * CSV import that reuses the shared writer. Kept alongside the original
 * importPerformanceCsv so nothing breaks; point the UI at this one.
 * payload: { csvText }
 */
function importPerformanceCsvV2(payload) {
  const user = requireRole_(['Admin', 'Booking', 'Marketing']);
  payload = payload || {};
  const csvText = String(payload.csvText || '');
  if (!csvText.trim()) throw new Error('Paste or select CSV content first.');

  let grid;
  try {
    grid = Utilities.parseCsv(csvText);
  } catch (error) {
    throw new Error('Could not read the CSV: ' + (error.message || String(error)));
  }
  if (grid.length < 2) throw new Error('The CSV is empty or contains only a header row.');

  const headers = grid[0].map(function (header) { return cleanText_(header); });
  const index = function (name) { return headers.indexOf(name); };
  const urlIndex = index('URL');
  if (urlIndex === -1) {
    throw new Error('The CSV must include a "URL" column, as exported by post_tracker.py.');
  }
  const map = {
    Views: index('Views'), Likes: index('Likes'), Comments: index('Comments'),
    Reposts: index('Reposts'), Shares: index('Shares'), Saves: index('Saves'),
    Post_Date: index('Post Date'),
  };

  const rows = grid.slice(1).filter(function (cols) {
    return cols.length && cleanText_(cols[urlIndex]);
  }).map(function (cols) {
    const row = { URL: cols[urlIndex] };
    Object.keys(map).forEach(function (field) {
      if (map[field] >= 0) row[field] = cols[map[field]];
    });
    return row;
  });

  const allowedCampaignIds = {};
  listCampaigns_(user).forEach(function (campaign) {
    allowedCampaignIds[cleanText_(campaign.Campaign_ID)] = true;
  });

  const startedAt = new Date();
  const result = withDocumentLock_(function () {
    return perfApplyMetricRows_(rows, {
      source: 'Post Tracker CSV',
      allowedCampaignIds: allowedCampaignIds,
    });
  });

  perfWriteRunLog_({
    startedAt: startedAt, trigger: 'csv', source: user.Email,
    scanned: rows.length, updated: result.matched, failed: result.unmatched,
    notes: result.unmatchedUrls.join(' | '),
  });
  logActivity_(user.Email, 'IMPORT_PERFORMANCE_CSV', 'DELIVERABLES', '',
    result.matched + ' matched, ' + result.unmatched + ' unmatched');
  return publicValue_(result);
}