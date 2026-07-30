/**
* KOL Campaign Manager — web app API
* Requires Setup.gs in the same bound Apps Script project.
*/
function doGet(e) {
  const params = (e && e.parameter) || {};

  // Public, token-authenticated creator information form. Deliberately served
  // before any getCurrentUser_() call: the creator has no workspace account.
  if (String(params.form || '') === 'creator') {
    const template = HtmlService.createTemplateFromFile('CreatorForm');
    template.formToken = String(params.token || '');
    return template.evaluate()
      .setTitle('Creator information · SNOW')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('KOL Campaign Manager')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function include(filename) {
return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
function campaignKolNetAmount_(row) {
row = row || {};
// Xét theo "có nhập hay không", không theo truthy: Final_Fee = 0 là hợp lệ
// (barter / hợp tác miễn phí). Dùng `||` sẽ coi 0 là falsy và âm thầm quay về
// giá quote, làm Gross và budget bị thổi phồng.
const net = cleanText_(row.Final_Fee) !== '' ? toNumber_(row.Final_Fee) : toNumber_(row.Quoted_Fee);
return Math.max(0, net);
}
// MÔ HÌNH THUẾ TNCN CHO HỢP ĐỒNG VN — chủ project xác nhận 2026-07-30:
//   Net amount   = số tiền creator THỰC NHẬN            (vd. 6.000.000)
//   Tax (10%)    = thuế TNCN                            (vd.   666.667)
//   Gross amount = Net + Tax, tức đã bao gồm thuế       (vd. 6.666.667)
// Chỉ áp thuế khi số tiền chịu thuế >= 5.000.000; dưới ngưỡng thì Tax = 0.
//
// SỐ TIỀN CHỊU THUẾ = Net + Code_Ad_Fee, KHÔNG phải Net một mình. Chủ project xác
// nhận 2026-07-30: net 4.500.000 + code ad fee 600.000 = 5.100.000 > 5.000.000 nên
// VẪN phải cộng thuế -> gross 5.666.667, tax 566.667. Đây là điểm dễ đọc sai nhất
// của quy tắc, và đọc sai theo hướng "chỉ xét net" sẽ làm hụt 566.667 đồng mỗi KOL
// trong hợp đồng, BBNT và budget. test_campaignKolGrossAmount_ khoá đúng ca này lại.
//
// Đây là GROSS-UP, KHÔNG phải trừ 10% khỏi net: SNOW gánh phần thuế để creator
// nhận đủ net. Nên Tax là 10% của GROSS, không phải 10% của net:
//   gross = round(net / 0.9) = round(6.000.000 / 0.9) = 6.666.667
//   tax   = gross - net                                =   666.667
// Trừ 10% khỏi net sẽ ra 600.000 và creator chỉ còn nhận 5.400.000 — sai mô hình.
// Tests.gs từng assert đúng con số 600.000 đó; đã sửa cùng lúc với thay đổi này.
//
// Hai hằng số để nguyên trong source, KHÔNG đọc từ CONFIG: campaignKolGrossAmount_
// chạy trên TỪNG DÒNG trong getCampaignDetail, mà getConfigMap_ đọc sheet CONFIG —
// nơi có hai công thức GOOGLEFINANCE khiến mỗi lần đọc có thể phải chờ mạng. Xem
// ghi chú ở getCurrentUser_ về việc CONFIG đã bị đẩy ra khỏi đường nóng.
const CONTRACT_VN_PIT_RATE = 0.1;
const CONTRACT_VN_PIT_THRESHOLD = 5000000;
/**
* Thuế TNCN trên số tiền chịu thuế (net + code ad fee). Trả về 0 khi dưới ngưỡng.
* Luôn thoả: Math.round(base) + calculateContractTax_(base) === gross.
*/
function calculateContractTax_(baseAmount) {
const base = Math.max(0, toNumber_(baseAmount));
if (base < CONTRACT_VN_PIT_THRESHOLD) return 0;
return Math.round(base / (1 - CONTRACT_VN_PIT_RATE)) - Math.round(base);
}
function campaignKolGrossAmount_(row) {
row = row || {};
const baseAmount = campaignKolNetAmount_(row) + Math.max(0, toNumber_(row.Code_Ad_Fee));
return Math.round(baseAmount) + calculateContractTax_(baseAmount);
}
function campaignKolBudgetAmount_(row, campaign) {
row = row || {};
campaign = campaign || {};
if (normalizeMarket_(campaign.Market || row.Market) === 'VN') {
return campaignKolGrossAmount_(row);
}
return campaignKolNetAmount_(row) + toNumber_(row.Tax) + toNumber_(row.Service_Fee);
}
function getBootstrapData() {
const user = getCurrentUser_();
// Mot lenh goi thay vi 8. Khong lam gi neu doc theo lo chua duoc bat.
prefetchTables_(['CAMPAIGNS', 'CAMPAIGN_KOLS', 'ACCOUNTS', 'DELIVERABLES', 'SHORTLISTS', 'SHORTLIST_KOLS']);
const campaigns = listCampaigns_(user);
const campaignIds = {};
campaigns.forEach(function (campaign) { campaignIds[campaign.Campaign_ID] = true; });
return publicValue_({
user: user,
dashboard: buildDashboard_(user),
campaigns: campaigns,
shortlists: listShortlists_(user),
deliverables: readTable_('DELIVERABLES').filter(function (row) { return campaignIds[row.Campaign_ID]; }),
config: getPublicConfig_(user),
notifications: getNotifications({ limit: 12 }),
revision: getDataRevision_(),
});
}
function getWorkspaceSyncState() {
getCurrentUser_();
return {
revision: getDataRevision_(),
serverTime: Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM-dd\'T\'HH:mm:ss'),
};
}
function getDashboardData() {
const user = getCurrentUser_();
return publicValue_(buildDashboard_(user));
}
function listCampaigns(filters) {
const user = getCurrentUser_();
const items = listCampaigns_(user);
const status = filters && filters.status ? String(filters.status) : '';
const market = filters && filters.market ? String(filters.market) : '';
return publicValue_(items.filter(function (item) {
return (!status || item.Status === status) && (!market || item.Market === market);
}));
}
function createCampaign(payload) {
const user = requireRole_(['Admin', 'Booking']);
payload = payload || {};
requireFields_(payload, ['Campaign_Name', 'App', 'Market']);
return withDocumentLock_(function () {
// nextCampaignId_ đếm số campaign đã có để cấp số tiếp theo, tức là một chu trình
// đọc-sửa-ghi và nó PHẢI đọc thật trong lock. Hiện tại chưa có chỗ nào đọc
// CAMPAIGNS trước khi lock được lấy nên chưa vỡ, nhưng chỉ cần thêm MỘT lần đọc
// phía trên (kiểm tra trùng tên, đếm quota, tra template...) là hai campaign nhận
// CÙNG một Campaign_ID — mà đó là khoá ngoại của 8 bảng con, không có ràng buộc
// nào ở tầng database, nên KOL/deliverable/hợp đồng/thanh toán của hai campaign sẽ
// nhập vào nhau vĩnh viễn. Đây là đúng cái bẫy contractReserveSerial_ đã ghi lại.
invalidateTableCache_('CAMPAIGNS');
const now = new Date();
const market = normalizeMarket_(payload.Market);
if (LISTS.MARKETS.indexOf(market) === -1) throw new Error('Invalid market.');
assertMarketAccess_(user, market);
const config = getConfigMap_();
const template = getCampaignTemplates_(config)[market] || {};
const selectedPlatforms = normalizePlatforms_(payload.Platforms);
const platforms = selectedPlatforms.length ? selectedPlatforms : (template.platforms || []);
if (!platforms.length) throw new Error('Select at least one platform.');
const record = {
Campaign_ID: nextCampaignId_(market),
Campaign_Name: cleanText_(payload.Campaign_Name),
App: cleanText_(payload.App),
Market: market,
Objective: cleanText_(payload.Objective),
Start_Date: cleanText_(payload.Start_Date),
End_Date: cleanText_(payload.End_Date),
Posting_Start: cleanText_(payload.Posting_Start),
Posting_End: cleanText_(payload.Posting_End),
Target_KOLs: Math.max(1, Math.round(toNumber_(payload.Target_KOLs) || template.targetKols || 1)),
Budget: Math.max(0, toNumber_(payload.Budget)),
Currency: cleanText_(payload.Currency) || currencyForMarket_(market),
Status: cleanText_(payload.Status) || 'Planning',
Owner_Email: cleanText_(payload.Owner_Email) || user.Email,
Assigned_Marketing: normalizeEmailList_(payload.Assigned_Marketing),
Brief_URL: cleanText_(payload.Brief_URL),
Notes: cleanText_(payload.Notes),
Created_At: now,
Updated_At: now,
Platforms: platforms.join(', '),
};
if (LISTS.CAMPAIGN_STATUSES.indexOf(record.Status) === -1) throw new Error('Invalid campaign status.');
validateCampaignDates_(record);
appendRecord_('CAMPAIGNS', record);
logActivity_(user.Email, 'CREATE', 'CAMPAIGN', record.Campaign_ID, record.Campaign_Name);
return publicValue_(record);
});
}
function getCampaignDetail(campaignId) {
const user = getCurrentUser_();
prefetchTables_(['CAMPAIGNS', 'CAMPAIGN_KOLS', 'ACCOUNTS', 'CREATORS', 'DELIVERABLES']);
campaignId = cleanText_(campaignId);
const campaign = findRecord_('CAMPAIGNS', 'Campaign_ID', campaignId);
if (!campaign) throw new Error('Campaign not found: ' + campaignId);
assertCampaignAccess_(user, campaign);
const accounts = accountLookup_();
const creators = creatorLookup_();
const fxRates = getFxRates_();
const deliverables = readTable_('DELIVERABLES').filter(function (row) {
return row.Campaign_ID === campaignId;
});
// Với mỗi Campaign_KOL, lấy deliverable MỚI NHẤT (nếu có nhiều) để hiển thị
// nhanh link Draft/Post ngay trên bảng KOL chính, không cần mở từng KOL.
const latestDeliverableByCampaignKol = {};
deliverables.forEach(function (row) {
const existing = latestDeliverableByCampaignKol[row.Campaign_KOL_ID];
// So theo mốc thời gian thật. String(Date) bắt đầu bằng tên thứ ("Wed Jul 22…"),
// nên so sánh chuỗi sẽ sắp theo thứ tự chữ cái của thứ chứ không theo thời gian.
if (!existing || timeValue_(row.Updated_At) >= timeValue_(existing.Updated_At)) {
latestDeliverableByCampaignKol[row.Campaign_KOL_ID] = row;
}
});
const campaignKols = readTable_('CAMPAIGN_KOLS')
.filter(function (row) { return row.Campaign_ID === campaignId; })
.map(function (row) {
const account = accounts[row.Account_ID] || {};
const creator = creators[row.Creator_ID || account.Creator_ID] || {};
const deliverable = latestDeliverableByCampaignKol[row.Campaign_KOL_ID] || {};
const enriched = mergeObjects_(row, {
Username: account.Username || '',
Platform: account.Platform || '',
Profile_URL: account.Profile_URL || '',
Followers: account.Followers || 0,
Market: account.Market || campaign.Market,
Display_Name: creator.Display_Name || creator.Legal_Name || '',
Categories: creator.Categories || '',
Draft_URL: deliverable.Draft_URL || '',
Draft_Due: deliverable.Draft_Due || '',
Deliverable_Post_URL: deliverable.Post_URL || '',
Draft_Submitted_At: deliverable.Draft_Submitted_At || '',
Post_Submitted_At: deliverable.Post_Submitted_At || '',
Fee_VND: feeToVnd_(campaignKolNetAmount_(row), row.Currency || account.Currency || campaign.Currency, fxRates),
});
if (normalizeMarket_(campaign.Market) === 'VN') {
const grossAmount = campaignKolGrossAmount_(enriched);
enriched.After_PIT_Fee = grossAmount;
enriched.Gross_Amount = grossAmount;
}
return enriched;
});
const contracts = readTable_('CONTRACTS').filter(function (row) {
return row.Campaign_ID === campaignId;
});
const payments = readTable_('PAYMENTS').filter(function (row) {
return row.Campaign_ID === campaignId;
});
// Chỉ tính vào budget những KOL đã CONFIRMED. Với campaign VN, số bị trừ là
// Gross amount tự động; các trạng thái trước Confirmed chỉ nằm trong pipeline.
const confirmedKols = campaignKols.filter(function (item) { return item.Booking_Status === 'Confirmed'; });
const committed = confirmedKols.reduce(function (sum, item) {
return sum + campaignKolBudgetAmount_(item, campaign);
}, 0);
const pipelineTotal = campaignKols.reduce(function (sum, item) {
return sum + campaignKolBudgetAmount_(item, campaign);
}, 0);
const confirmed = confirmedKols.length;
const detail = {
campaign: campaign,
campaignKols: campaignKols,
deliverables: deliverables,
contracts: contracts,
payments: payments,
metrics: {
totalKols: campaignKols.length,
confirmed: confirmed,
committed: committed,
pipelineTotal: pipelineTotal,
remaining: Math.max(0, toNumber_(campaign.Budget) - committed),
postsLive: deliverables.filter(function (item) { return item.Content_Status === 'Posted'; }).length,
draftsInReview: deliverables.filter(function (item) { return item.Content_Status === 'Need edit'; }).length,
},
};
if (user.Role === 'Marketing') sanitizeCampaignFinancialsForMarketing_(detail);
return publicValue_(detail);
}
function searchAccounts(params) {
const user = getCurrentUser_();
params = params || {};
const query = cleanText_(params.query).toLowerCase();
const market = cleanText_(params.market);
const platform = cleanText_(params.platform);
const selectedPlatforms = Array.isArray(params.platforms)
? params.platforms.map(cleanText_).filter(function (item) { return LISTS.PLATFORMS.indexOf(item) >= 0; })
: (platform && platform !== 'All' ? [platform] : []);
const app = cleanText_(params.app);
const bookableOnly = user.Role === 'Marketing' ? true : Boolean(params.bookableOnly);
const status = bookableOnly ? 'Deal' : normalizeSourceStatus_(params.status);
const category = cleanText_(params.category).toLowerCase();
const selectedCategories = Array.isArray(params.categories) ? params.categories.map(function (c) { return cleanText_(c).toLowerCase(); }).filter(Boolean) : [];
const language = cleanText_(params.language).toLowerCase();
const contactChannel = cleanText_(params.contactChannel).toLowerCase();
const hasContact = cleanText_(params.hasContact);
const minFollowers = numberFilter_(params.minFollowers);
const maxFollowers = numberFilter_(params.maxFollowers);
const followerRangeIds = Array.isArray(params.followerRanges) ? params.followerRanges : [];
const followerRanges = FOLLOWER_RANGES.filter(function (range) { return followerRangeIds.indexOf(range.id) >= 0; });
const minFee = numberFilter_(params.minFee);
const maxFee = numberFilter_(params.maxFee);
const minEngagement = numberFilter_(params.minEngagement);
const offset = Math.max(0, toNumber_(params.offset));
const pageSize = Math.min(100, Math.max(10, toNumber_(params.pageSize) || 40));
const allowedSortFields = ['Date_Added', 'Followers', 'Starting_Fee', 'Engagement_Rate', 'Avg_Views', 'Username', 'Display_Name', 'Last_Verified'];
let sorts = Array.isArray(params.sorts) ? params.sorts : [];
if (!sorts.length) sorts = [{ field: params.sortBy || 'Followers', order: params.sortOrder || 'desc' }];
sorts = sorts.slice(0, 3).map(function (sort) {
const field = allowedSortFields.indexOf(sort.field) >= 0 ? sort.field : 'Followers';
return { field: field, order: sort.order === 'asc' ? 'asc' : 'desc' };
});
let accountRows = readTable_('ACCOUNTS').filter(function (account) {
if (!canAccessMarket_(user, account.Market)) return false;
if (account.Active !== '' && !isTrue_(account.Active)) return false;
if (market && market !== 'All' && account.Market !== market) return false;
if (selectedPlatforms.length && selectedPlatforms.indexOf(account.Platform) === -1) return false;
if (app && app !== 'All' && String(account.App_Fit || '').toLowerCase().indexOf(app.toLowerCase()) === -1) return false;
const followers = toNumber_(account.Followers);
const fee = toNumber_(account.Starting_Fee);
const engagement = toNumber_(account.Engagement_Rate);
if (minFollowers !== null && followers < minFollowers) return false;
if (maxFollowers !== null && followers > maxFollowers) return false;
if (followerRanges.length && !followerRanges.some(function (range) {
return followers >= range.min && (range.max === null || followers < range.max);
})) return false;
if (minFee !== null && fee < minFee) return false;
if (maxFee !== null && fee > maxFee) return false;
if (bookableOnly && fee <= 0) return false;
if (minEngagement !== null && engagement < minEngagement) return false;
return true;
});
const creators = indexBy_(readTable_('CREATORS'), 'Creator_ID');
const allAccountsByCreator = {};
readTable_('ACCOUNTS').forEach(function (acc) {
if (!acc.Creator_ID) return;
if (!allAccountsByCreator[acc.Creator_ID]) allAccountsByCreator[acc.Creator_ID] = [];
allAccountsByCreator[acc.Creator_ID].push({
Account_ID: acc.Account_ID,
Platform: acc.Platform,
Username: acc.Username,
Profile_URL: acc.Profile_URL,
Followers: toNumber_(acc.Followers),
Avg_Views: toNumber_(acc.Avg_Views),
Engagement_Rate: toNumber_(acc.Engagement_Rate),
Starting_Fee: toNumber_(acc.Starting_Fee),
Currency: acc.Currency,
App_Fit: acc.App_Fit,
Contact_Channel: acc.Contact_Channel,
Contact_Value: acc.Contact_Value,
});
});
let rows = accountRows.map(function (account) {
const view = accountView_(account, creators[account.Creator_ID] || {});
const siblings = (allAccountsByCreator[account.Creator_ID] || []).filter(function (acc) { return acc.Account_ID !== account.Account_ID; });
view.Other_Platforms = siblings;
return view;
});
rows = rows.filter(function (row) {
if (status && status !== 'All' && normalizeSourceStatus_(row.Source_Status) !== status) return false;
if (category && String(row.Categories || '').toLowerCase().indexOf(category) === -1) return false;
if (selectedCategories.length) {
const rowCategories = String(row.Categories || '').toLowerCase().split(/[,|]/).map(function (c) { return c.trim(); });
if (!selectedCategories.some(function (c) { return rowCategories.indexOf(c) >= 0; })) return false;
}
if (language && String(row.Languages || '').toLowerCase().indexOf(language) === -1) return false;
const contactAvailable = Boolean(cleanText_(row.Creator_Email) || cleanText_(row.Creator_Phone) || cleanText_(row.Creator_LINE_ID));
if (contactChannel && contactChannel !== 'all') {
const creatorContacts = {
email: cleanText_(row.Creator_Email),
phone: cleanText_(row.Creator_Phone),
line: cleanText_(row.Creator_LINE_ID),
};
if (!creatorContacts[contactChannel]) return false;
}
if (hasContact === 'Yes' && !contactAvailable) return false;
if (hasContact === 'No' && contactAvailable) return false;
if (!query) return true;
const haystack = [row.Username, row.Display_Name, row.Legal_Name, row.Categories, row.Platform, row.Profile_URL, row.App_Fit, row.Source_Status, row.Source_PIC]
.join(' ').toLowerCase();
return haystack.indexOf(query) >= 0;
});
if (params.groupByCreator) {
// Gộp nhiều tài khoản (nhiều nền tảng) của CÙNG 1 creator thành 1 dòng duy nhất.
// Chỉ tính các account ĐÃ QUA đủ bộ lọc ở trên (vd. bookableOnly) — account bị
// lọc bỏ (như fee = 0) sẽ không xuất hiện trong danh sách nền tảng của dòng đó.
const groups = {};
const order = [];
rows.forEach(function (row) {
const key = row.Creator_ID || row.Account_ID;
if (!groups[key]) { groups[key] = []; order.push(key); }
groups[key].push(row);
});
rows = order.map(function (key) {
const group = groups[key].slice().sort(function (a, b) { return toNumber_(b.Followers) - toNumber_(a.Followers); });
const primary = group[0];
const platformsList = group.map(function (row) {
return {
Account_ID: row.Account_ID,
Platform: row.Platform,
Username: row.Username,
Profile_URL: row.Profile_URL,
Followers: row.Followers,
Avg_Views: row.Avg_Views,
Engagement_Rate: row.Engagement_Rate,
Starting_Fee: row.Starting_Fee,
Currency: row.Currency,
App_Fit: row.App_Fit,
Contact_Channel: row.Contact_Channel,
Contact_Value: row.Contact_Value,
Source_Status: row.Source_Status,
};
});
const positiveFees = platformsList.map(function (row) { return toNumber_(row.Starting_Fee); }).filter(function (fee) { return fee > 0; });
const appFit = uniqueWorkspaceText_(platformsList.reduce(function (items, row) {
return items.concat(String(row.App_Fit || '').split(/[,|]/));
}, [])).join(', ');
return mergeObjects_(primary, {
Platforms_List: platformsList,
Date_Added: primary.Date_Added || primary.Created_At || '',
App_Fit: appFit,
Followers: Math.max.apply(null, platformsList.map(function (row) { return toNumber_(row.Followers); }).concat([0])),
Starting_Fee: positiveFees.length ? Math.min.apply(null, positiveFees) : 0,
Engagement_Rate: Math.max.apply(null, platformsList.map(function (row) { return toNumber_(row.Engagement_Rate); }).concat([0])),
});
});
}
rows.sort(function (a, b) {
for (let index = 0; index < sorts.length; index += 1) {
const sort = sorts[index];
const numeric = ['Followers', 'Starting_Fee', 'Engagement_Rate', 'Avg_Views'].indexOf(sort.field) >= 0;
const dateLike = ['Date_Added', 'Last_Verified'].indexOf(sort.field) >= 0;
const valA = numeric ? toNumber_(a[sort.field]) : (dateLike ? new Date(a[sort.field] || 0).getTime() : String(a[sort.field] || '').toLowerCase());
const valB = numeric ? toNumber_(b[sort.field]) : (dateLike ? new Date(b[sort.field] || 0).getTime() : String(b[sort.field] || '').toLowerCase());
if (valA < valB) return sort.order === 'asc' ? -1 : 1;
if (valA > valB) return sort.order === 'asc' ? 1 : -1;
}
return 0;
});
const pageRows = rows.slice(offset, offset + pageSize).map(function (row) {
return user.Role === 'Marketing' ? sanitizeDatabaseAccountView_(row) : row;
});
return publicValue_({
total: rows.length,
offset: offset,
pageSize: pageSize,
rows: pageRows,
sorts: sorts,
});
}
function updateKolDatabaseRecord(payload) {
const user = requireRole_(['Admin', 'Booking']);
payload = payload || {};
const accountId = cleanText_(payload.Account_ID);
const requestedAccountIds = Array.isArray(payload.Account_IDs) ? payload.Account_IDs.map(cleanText_).filter(Boolean) : [];
const platformUpdates = Array.isArray(payload.Platform_Updates) ? payload.Platform_Updates : [];
const newPlatforms = Array.isArray(payload.New_Platforms) ? payload.New_Platforms : [];
const accountIds = uniqueWorkspaceText_([accountId].concat(requestedAccountIds).filter(Boolean));
if (!accountIds.length) throw new Error('KOL account ID is missing.');
const account = findRecord_('ACCOUNTS', 'Account_ID', accountId);
if (!account) throw new Error('KOL account not found: ' + accountId);
const creatorId = cleanText_(payload.Creator_ID) || cleanText_(account.Creator_ID);
if (!creatorId) throw new Error('Creator ID is missing.');
assertMarketAccess_(user, account.Market);
return withDocumentLock_(function () {
const now = new Date();
const allAccounts = readTable_('ACCOUNTS');
const accountsById = indexBy_(allAccounts, 'Account_ID');
const responseAccountsById = indexBy_(allAccounts, 'Account_ID');
let targetAccounts = accountIds.map(function (id) {
const target = accountsById[id];
if (!target || target.Creator_ID !== creatorId) throw new Error('One or more selected platform accounts are invalid.');
assertMarketAccess_(user, target.Market);
return target;
});
if (payload.Apply_To_Creator_Accounts === true && payload.App_Fit !== undefined) {
targetAccounts = allAccounts.filter(function (target) {
return target.Creator_ID === creatorId && (target.Active === '' || isTrue_(target.Active)) && canAccessMarket_(user, target.Market);
});
}
const createdAccounts = [];
const activeCreatorPlatforms = {};
allAccounts.filter(function (row) {
return row.Creator_ID === creatorId && (row.Active === '' || isTrue_(row.Active));
}).forEach(function (row) {
activeCreatorPlatforms[cleanText_(row.Platform).toLowerCase()] = true;
});
const pendingPlatforms = {};
newPlatforms.forEach(function (item) {
const platform = cleanText_(item && item.Platform);
const profileUrl = cleanText_(item && item.Profile_URL);
const platformKey = platform.toLowerCase();
if (LISTS.PLATFORMS.indexOf(platform) === -1) throw new Error('Select a valid platform.');
if (!profileUrl) throw new Error('Profile URL is required for every new platform.');
if (!/^https?:\/\//i.test(profileUrl)) throw new Error('Enter a valid profile URL beginning with http:// or https://.');
if (activeCreatorPlatforms[platformKey] || pendingPlatforms[platformKey]) {
throw new Error('This creator already has an active ' + platform + ' account.');
}
const normalizedProfileUrl = normalizeDirectUrl_(profileUrl);
const username = extractUsernameFromUrl_(profileUrl);
const normalizedUsername = username.toLowerCase();
const duplicate = allAccounts.find(function (row) {
const sameUrl = normalizedProfileUrl && normalizeDirectUrl_(row.Profile_URL) === normalizedProfileUrl;
const sameHandle = normalizeMarket_(row.Market) === normalizeMarket_(account.Market) &&
cleanText_(row.Platform).toLowerCase() === platformKey &&
cleanText_(row.Username).replace(/^@/, '').toLowerCase() === normalizedUsername;
return sameUrl || sameHandle;
});
if (duplicate) throw new Error('This platform profile already exists: ' + duplicate.Account_ID);
pendingPlatforms[platformKey] = true;
createdAccounts.push({
Account_ID: makeId_('ACC'),
Creator_ID: creatorId,
Market: account.Market,
Platform: platform,
Username: username,
Profile_URL: profileUrl,
Followers: Math.max(0, toNumber_(item.Followers)),
Avg_Views: 0,
Engagement_Rate: 0,
Starting_Fee: Math.max(0, toNumber_(item.Starting_Fee)),
Currency: account.Currency || currencyForMarket_(account.Market),
Active: 'TRUE',
Created_At: now,
Updated_At: now,
App_Fit: payload.App_Fit !== undefined ? cleanText_(payload.App_Fit) : cleanText_(account.App_Fit),
});
});
const platformChangesById = {};
platformUpdates.forEach(function (update) {
const updateAccountId = cleanText_(update && update.Account_ID);
const target = accountsById[updateAccountId];
if (!target || target.Creator_ID !== creatorId) throw new Error('One or more platform accounts are invalid.');
assertMarketAccess_(user, target.Market);
platformChangesById[updateAccountId] = {
Profile_URL: cleanText_(update.Profile_URL),
Followers: Math.max(0, toNumber_(update.Followers)),
Starting_Fee: Math.max(0, toNumber_(update.Starting_Fee)),
Updated_At: now,
};
});
const accountChanges = {};
if (payload.Starting_Fee !== undefined) accountChanges.Starting_Fee = toNumber_(payload.Starting_Fee);
if (payload.Followers !== undefined) accountChanges.Followers = toNumber_(payload.Followers);
if (payload.App_Fit !== undefined) accountChanges.App_Fit = cleanText_(payload.App_Fit);
if (payload.Profile_URL !== undefined) accountChanges.Profile_URL = cleanText_(payload.Profile_URL);
if (payload.Platform !== undefined) {
const nextPlatform = cleanText_(payload.Platform);
if (LISTS.PLATFORMS.indexOf(nextPlatform) === -1) throw new Error('Invalid platform.');
if (targetAccounts.length !== 1) throw new Error('Platform can only be changed for one account at a time.');
const duplicate = allAccounts.some(function (row) {
return row.Account_ID !== accountId && row.Creator_ID === creatorId && row.Platform === nextPlatform && (row.Active === '' || isTrue_(row.Active));
});
if (duplicate) throw new Error('This creator already has an active ' + nextPlatform + ' account.');
accountChanges.Platform = nextPlatform;
}
// Gop platformChangesById va accountChanges thanh MOT lan ghi ACCOUNTS.
// Truoc day day la hai lan updateRecordsById_ rieng biet tren cung sheet, moi
// lan mot vong doc-sua-ghi. Ket qua cuoi cung khong doi: neu mot account xuat
// hien trong ca hai thi thu tu cu la ghi platform truoc roi accountChanges ghi
// de len, nen o day accountChanges cung duoc merge SAU.
const mergedAccountChanges = {};
Object.keys(platformChangesById).forEach(function (id) {
mergedAccountChanges[id] = mergeObjects_(platformChangesById[id], {});
});
if (Object.keys(accountChanges).length) {
accountChanges.Updated_At = now;
targetAccounts.forEach(function (target) {
mergedAccountChanges[target.Account_ID] = mergeObjects_(mergedAccountChanges[target.Account_ID] || {}, accountChanges);
});
}
let updatedAccount = account;
if (Object.keys(mergedAccountChanges).length) {
const updatedAccounts = updateRecordsById_('ACCOUNTS', 'Account_ID', mergedAccountChanges);
Object.keys(updatedAccounts).forEach(function (id) { responseAccountsById[id] = updatedAccounts[id]; });
if (updatedAccounts[accountId]) updatedAccount = updatedAccounts[accountId];
}
const creatorChanges = {};
if (payload.Categories !== undefined) creatorChanges.Categories = cleanText_(payload.Categories);
if (payload.Source_Status !== undefined) creatorChanges.Source_Status = normalizeSourceStatus_(payload.Source_Status);
if (payload.Display_Name !== undefined) creatorChanges.Display_Name = cleanText_(payload.Display_Name);
if (payload.Email !== undefined) creatorChanges.Email = cleanText_(payload.Email);
if (payload.Phone !== undefined) creatorChanges.Phone = cleanText_(payload.Phone);
if (payload.Title !== undefined) creatorChanges.Title = cleanText_(payload.Title);
if (payload.Legal_Name !== undefined) creatorChanges.Legal_Name = cleanText_(payload.Legal_Name);
if (payload.ID_No !== undefined) creatorChanges.ID_No = cleanText_(payload.ID_No);
if (payload.Date_Of_Issue !== undefined) creatorChanges.Date_Of_Issue = cleanText_(payload.Date_Of_Issue);
if (payload.Permanent_Address !== undefined) creatorChanges.Permanent_Address = cleanText_(payload.Permanent_Address);
if (payload.Bank_Account !== undefined) creatorChanges.Bank_Account = cleanText_(payload.Bank_Account);
if (payload.Bank_Name !== undefined) creatorChanges.Bank_Name = cleanText_(payload.Bank_Name);
let updatedCreator = findRecord_('CREATORS', 'Creator_ID', creatorId);
if (!updatedCreator) throw new Error('Creator not found: ' + creatorId);
if (Object.keys(creatorChanges).length) {
creatorChanges.Updated_At = now;
updatedCreator = updateRecord_('CREATORS', 'Creator_ID', creatorId, creatorChanges);
}
if (createdAccounts.length) appendRecords_('ACCOUNTS', createdAccounts);
logActivity_(
user.Email,
createdAccounts.length ? 'UPDATE_ADD_PLATFORM' : 'UPDATE',
'KOL_DATABASE',
accountId,
createdAccounts.length
? 'Updated profile and added ' + createdAccounts.length + ' platform account(s)'
: 'Updated directly from the KOL Database'
);
const responseIds = uniqueWorkspaceText_(allAccounts.filter(function (row) {
return row.Creator_ID === creatorId && (row.Active === '' || isTrue_(row.Active));
}).map(function (row) { return row.Account_ID; })
.concat(createdAccounts.map(function (row) { return row.Account_ID; }))
.filter(Boolean));
const createdAccountsById = indexBy_(createdAccounts, 'Account_ID');
const responseRecords = responseIds.map(function (id) {
return accountView_(createdAccountsById[id] || responseAccountsById[id] || accountsById[id], updatedCreator);
}).filter(Boolean);
return publicValue_({
success: true,
record: accountView_(responseAccountsById[accountId] || updatedAccount, updatedCreator),
records: responseRecords,
createdAccounts: createdAccounts.map(function (row) { return row.Account_ID; }),
});
});
}
function deleteKolProfile(payload) {
const user = requireRole_(['Admin', 'Booking']);
payload = payload || {};
const creatorId = cleanText_(payload.Creator_ID);
const accountId = cleanText_(payload.Account_ID);
if (!creatorId || !accountId) throw new Error('Creator or account ID is missing.');
return withDocumentLock_(function () {
const now = new Date();
const creator = findRecord_('CREATORS', 'Creator_ID', creatorId);
if (!creator) throw new Error('Creator not found: ' + creatorId);
const accounts = readTable_('ACCOUNTS').filter(function (row) {
return row.Creator_ID === creatorId && (row.Active === '' || isTrue_(row.Active));
});
const fallbackAccount = accounts.find(function (row) { return row.Account_ID === accountId; });
if (!fallbackAccount) throw new Error('Active KOL profile not found.');
accounts.forEach(function (row) { assertMarketAccess_(user, row.Market); });
const accountChanges = {};
accounts.forEach(function (row) {
accountChanges[row.Account_ID] = { Active: 'FALSE', Updated_At: now };
});
if (accounts.length) updateRecordsById_('ACCOUNTS', 'Account_ID', accountChanges);
updateRecord_('CREATORS', 'Creator_ID', creatorId, { Active: 'FALSE', Updated_At: now });
logActivity_(
user.Email,
'DELETE_PROFILE',
'KOL_DATABASE',
creatorId,
'Archived creator profile and ' + accounts.length + ' account(s); campaign history retained'
);
return publicValue_({
success: true,
Creator_ID: creatorId,
Account_IDs: accounts.map(function (row) { return row.Account_ID; }),
archived: true,
});
});
}
function updateKolContactInfo(payload) {
const user = requireRole_(['Admin', 'Booking']);
payload = payload || {};
const creatorId = cleanText_(payload.Creator_ID);
const fallbackAccountId = cleanText_(payload.Account_ID);
if (!creatorId || !fallbackAccountId) throw new Error('Creator or account ID is missing.');
return withDocumentLock_(function () {
const now = new Date();
const allAccounts = readTable_('ACCOUNTS');
const accountsById = indexBy_(allAccounts, 'Account_ID');
const fallbackAccount = accountsById[fallbackAccountId];
if (!fallbackAccount || fallbackAccount.Creator_ID !== creatorId) throw new Error('KOL account not found.');
assertMarketAccess_(user, fallbackAccount.Market);
const creatorChanges = {
Email: cleanText_(payload.Email),
Phone: cleanText_(payload.Phone),
LINE_ID: cleanText_(payload.LINE_ID),
Updated_At: now,
};
const updatedCreator = updateRecord_('CREATORS', 'Creator_ID', creatorId, creatorChanges);
const records = allAccounts.filter(function (account) {
return account.Creator_ID === creatorId && (account.Active === '' || isTrue_(account.Active));
}).map(function (account) {
return accountView_(account, updatedCreator);
});
logActivity_(user.Email, 'UPDATE_CONTACT', 'CREATOR', creatorId, 'Creator-level contact updated');
return publicValue_({ success: true, records: records });
});
}
function addAccountsToCampaign(payload) {
const user = requireRole_(['Admin', 'Booking', 'Marketing']);
payload = payload || {};
const campaignId = cleanText_(payload.campaignId);
const accountIds = Array.isArray(payload.accountIds) ? payload.accountIds.map(cleanText_) : [];
if (!campaignId || !accountIds.length) throw new Error('Select a campaign and at least one KOL account.');
const campaign = findRecord_('CAMPAIGNS', 'Campaign_ID', campaignId);
if (!campaign) throw new Error('Campaign not found.');
assertCampaignAccess_(user, campaign);
const role = cleanText_(payload.role) || 'Primary';
if (LISTS.KOL_ROLES.indexOf(role) === -1) throw new Error('Invalid KOL role.');
return withDocumentLock_(function () {
const accounts = accountLookup_();
const existing = {};
readTable_('CAMPAIGN_KOLS').forEach(function (row) {
existing[row.Campaign_ID + '|' + row.Account_ID] = true;
});
const now = new Date();
const added = [];
const skipped = [];
accountIds.forEach(function (accountId) {
const account = accounts[accountId];
if (!account || !canAccessMarket_(user, account.Market) || (campaign.Market !== 'Global' && account.Market !== campaign.Market)) {
skipped.push(accountId);
return;
}
const key = campaignId + '|' + accountId;
if (existing[key]) {
skipped.push(accountId);
return;
}
const record = {
Campaign_KOL_ID: makeId_('CK'),
Campaign_ID: campaignId,
Account_ID: accountId,
Creator_ID: account.Creator_ID,
Role: role,
PIC_Email: cleanText_(payload.picEmail) || user.Email,
Booking_Status: 'Picked',
Quoted_Fee: toNumber_(account.Starting_Fee),
Final_Fee: '',
Currency: account.Currency || campaign.Currency || currencyForMarket_(account.Market),
Tax: '',
Service_Fee: '',
Deliverable_Summary: '',
Contract_Status: 'Not started',
Content_Status: 'Not started',
Posting_Date: '',
Post_URL: '',
Payment_Status: 'Not started',
Notes: '',
Added_At: now,
Updated_At: now,
Code_Ad_Fee: 0,
After_PIT_Fee: '',
Ad_Timeline: '',
};
if (normalizeMarket_(campaign.Market) === 'VN') {
record.After_PIT_Fee = campaignKolGrossAmount_(record);
}
added.push(record);
existing[key] = true;
});
appendRecords_('CAMPAIGN_KOLS', added);
logActivity_(user.Email, 'ADD_KOLS', 'CAMPAIGN', campaignId, added.length + ' account(s) added; ' + skipped.length + ' skipped');
return publicValue_({ added: added.length, skipped: skipped.length, records: added });
});
}
function updateCampaignKol(payload) {
const user = requireRole_(['Admin', 'Booking', 'Marketing']);
payload = payload || {};
const id = cleanText_(payload.Campaign_KOL_ID);
if (!id) throw new Error('Campaign_KOL_ID is required.');
const campaignKol = findRecord_('CAMPAIGN_KOLS', 'Campaign_KOL_ID', id);
if (!campaignKol) throw new Error('Campaign KOL not found.');
const campaign = findRecord_('CAMPAIGNS', 'Campaign_ID', campaignKol.Campaign_ID);
if (!campaign) throw new Error('Campaign not found.');
assertCampaignAccess_(user, campaign);
const allowed = ['Role', 'PIC_Email', 'Booking_Status', 'Quoted_Fee', 'Final_Fee', 'Currency', 'Tax', 'Service_Fee', 'Deliverable_Summary', 'Contract_Status', 'Content_Status', 'Posting_Date', 'Post_URL', 'Payment_Status', 'Notes', 'Code_Ad_Fee', 'Ad_Timeline'];
const changes = {};
allowed.forEach(function (key) {
if (Object.prototype.hasOwnProperty.call(payload, key)) changes[key] = payload[key];
});
if (user.Role === 'Marketing') {
const forbidden = Object.keys(changes).filter(function (key) { return key !== 'Notes'; });
if (forbidden.length) throw new Error('The Marketing team can only edit Notes from this form.');
}
if (changes.Role && LISTS.KOL_ROLES.indexOf(changes.Role) === -1) throw new Error('Invalid KOL role.');
if (changes.Booking_Status && LISTS.BOOKING_STATUSES.indexOf(changes.Booking_Status) === -1) throw new Error('Invalid booking status.');
if (changes.Contract_Status && LISTS.CONTRACT_STATUSES.indexOf(changes.Contract_Status) === -1) throw new Error('Invalid contract status.');
if (changes.Content_Status && LISTS.CONTENT_STATUSES.indexOf(changes.Content_Status) === -1) throw new Error('Invalid content status.');
if (changes.Payment_Status && LISTS.PAYMENT_STATUSES.indexOf(changes.Payment_Status) === -1) throw new Error('Invalid payment status.');
['Quoted_Fee', 'Final_Fee', 'Tax', 'Service_Fee', 'Code_Ad_Fee'].forEach(function (field) {
if (Object.prototype.hasOwnProperty.call(changes, field)) changes[field] = Math.max(0, toNumber_(changes[field]));
});
['Role', 'PIC_Email', 'Currency', 'Deliverable_Summary', 'Posting_Date', 'Post_URL', 'Notes', 'Ad_Timeline'].forEach(function (field) {
if (Object.prototype.hasOwnProperty.call(changes, field)) changes[field] = cleanText_(changes[field]);
});
changes.Updated_At = new Date();
return withDocumentLock_(function () {
if (normalizeMarket_(campaign.Market) === 'VN' && user.Role !== 'Marketing') {
changes.After_PIT_Fee = campaignKolGrossAmount_(mergeObjects_(campaignKol, changes));
}
const updated = updateRecord_('CAMPAIGN_KOLS', 'Campaign_KOL_ID', id, changes);
// Dùng lại campaignKolNetAmount_ để Final_Fee = 0 (barter) không bị coi là falsy.
updated.Fee_VND = feeToVnd_(campaignKolNetAmount_(updated), updated.Currency, getFxRates_());
if (normalizeMarket_(campaign.Market) === 'VN') updated.Gross_Amount = updated.After_PIT_Fee;
const generated = updated.Booking_Status === 'Confirmed'
? ensureDeliverablesForCampaignKols_([updated], campaign)
: [];
logActivity_(user.Email, 'UPDATE', 'CAMPAIGN_KOL', id, JSON.stringify(changes));
updated.Generated_Deliverables = generated;
return publicValue_(updated);
});
}
function createShortlist(payload) {
const user = requireRole_(['Admin', 'Booking', 'Marketing']);
payload = payload || {};
requireFields_(payload, ['Shortlist_Name', 'Market']);
const market = normalizeMarket_(payload.Market);
if (LISTS.MARKETS.indexOf(market) === -1) throw new Error('Invalid market.');
assertMarketAccess_(user, market);
return withDocumentLock_(function () {
const now = new Date();
const record = {
Shortlist_ID: makeId_('SL'),
Shortlist_Name: cleanText_(payload.Shortlist_Name),
Market: market,
Month: cleanText_(payload.Month),
Campaign_ID: cleanText_(payload.Campaign_ID),
Owner_Email: cleanText_(payload.Owner_Email) || user.Email,
Status: cleanText_(payload.Status) || 'Draft',
Notes: cleanText_(payload.Notes),
Created_At: now,
Updated_At: now,
};
appendRecord_('SHORTLISTS', record);
logActivity_(user.Email, 'CREATE', 'SHORTLIST', record.Shortlist_ID, record.Shortlist_Name);
return publicValue_(record);
});
}
function addAccountsToShortlist(payload) {
const user = requireRole_(['Admin', 'Booking', 'Marketing']);
payload = payload || {};
const shortlistId = cleanText_(payload.shortlistId);
const accountIds = Array.isArray(payload.accountIds) ? payload.accountIds.map(cleanText_) : [];
if (!shortlistId || !accountIds.length) throw new Error('Select a shortlist and at least one KOL account.');
const shortlist = findRecord_('SHORTLISTS', 'Shortlist_ID', shortlistId);
if (!shortlist) throw new Error('Shortlist not found.');
assertMarketAccess_(user, shortlist.Market);
return withDocumentLock_(function () {
const accounts = accountLookup_();
const existing = {};
readTable_('SHORTLIST_KOLS').forEach(function (row) {
existing[row.Shortlist_ID + '|' + row.Account_ID] = true;
});
const now = new Date();
let added = 0;
let skipped = 0;
accountIds.forEach(function (accountId) {
const account = accounts[accountId];
if (!account || !canAccessMarket_(user, account.Market) || (shortlist.Market !== 'Global' && account.Market !== shortlist.Market)) {
skipped += 1;
return;
}
const key = shortlistId + '|' + accountId;
if (existing[key]) {
skipped += 1;
return;
}
appendRecord_('SHORTLIST_KOLS', {
Shortlist_KOL_ID: makeId_('SLK'),
Shortlist_ID: shortlistId,
Account_ID: accountId,
Picked: 'FALSE',
Review_Status: 'New',
Reviewer_Email: '',
Notes: '',
Added_At: now,
Updated_At: now,
});
existing[key] = true;
added += 1;
});
logActivity_(user.Email, 'ADD_KOLS', 'SHORTLIST', shortlistId, added + ' account(s) added; ' + skipped + ' skipped');
return { added: added, skipped: skipped };
});
}
// Giới hạn trang cho các danh sách Operations. Trước đây cả hai hàm dưới đây
// .reverse().slice(0, 500) và trả về MỘT MẢNG TRẦN, nên UI không có cách nào biết
// còn dòng nào bị cắt: ai đó tìm một hợp đồng cũ sẽ kết luận nó không tồn tại.
// Giờ trả về { rows, total, offset, pageSize } để UI nói rõ "đang xem X trên N".
const OPERATIONS_PAGE_SIZE = 100;
const OPERATIONS_MAX_PAGE_SIZE = 500;
function operationsPageOf_(rows, options) {
options = options || {};
const total = rows.length;
const pageSize = Math.min(OPERATIONS_MAX_PAGE_SIZE,
Math.max(10, Math.round(toNumber_(options.pageSize)) || OPERATIONS_PAGE_SIZE));
// Kẹp offset vào bên trong dữ liệu: một offset cũ còn sót lại sau khi bản ghi bị xoá
// sẽ cho ra trang trắng, trông y như "không có dữ liệu".
const offset = Math.max(0, Math.min(Math.max(0, total - 1),
Math.round(toNumber_(options.offset))));
return { rows: rows.slice(offset, offset + pageSize), total: total, offset: offset, pageSize: pageSize };
}
function getOperations(payload) {
const user = requireRole_(['Admin', 'Booking']);
prefetchTables_(['CAMPAIGNS', 'CAMPAIGN_KOLS', 'CONTRACTS', 'PAYMENTS', 'ACCOUNTS', 'CREATORS']);
// Chấp nhận cả chuỗi (dạng gọi cũ: server('getOperations', 'payments')) và object có
// phân trang, để một client chưa cập nhật không vỡ.
const options = payload && typeof payload === 'object' ? payload : { type: payload };
const normalized = cleanText_(options.type).toLowerCase();
const sheetName = normalized === 'payments' ? 'PAYMENTS' : 'CONTRACTS';
const visibleCampaigns = listCampaigns_(user);
const visibleCampaignIds = {};
visibleCampaigns.forEach(function (campaign) { visibleCampaignIds[campaign.Campaign_ID] = true; });
const rows = readTable_(sheetName).filter(function (row) { return visibleCampaignIds[row.Campaign_ID]; });
const campaigns = indexBy_(readTable_('CAMPAIGNS'), 'Campaign_ID');
const creators = creatorLookup_();
const enriched = rows.map(function (row) {
return mergeObjects_(row, {
Campaign_Name: (campaigns[row.Campaign_ID] || {}).Campaign_Name || '',
Creator_Name: (creators[row.Creator_ID] || {}).Display_Name || (creators[row.Creator_ID] || {}).Legal_Name || '',
});
}).reverse();
return publicValue_(operationsPageOf_(enriched, options));
}
function getCollaborationHistory(payload) {
const user = requireRole_(['Admin', 'Booking']);
prefetchTables_(['CAMPAIGNS', 'ACCOUNTS', 'CREATORS', 'CAMPAIGN_KOLS', 'DELIVERABLES']);
const campaigns = indexBy_(readTable_('CAMPAIGNS'), 'Campaign_ID');
const accounts = accountLookup_();
const creators = creatorLookup_();
const rows = readTable_('CAMPAIGN_KOLS').filter(function (row) {
const campaign = campaigns[row.Campaign_ID] || {};
return canAccessCampaign_(user, campaign) && (row.Content_Status === 'Posted' || row.Post_URL || row.Payment_Status === 'Paid');
}).map(function (row) {
const account = accounts[row.Account_ID] || {};
const creator = creators[row.Creator_ID || account.Creator_ID] || {};
const campaign = campaigns[row.Campaign_ID] || {};
return mergeObjects_(row, {
Username: account.Username || '',
Platform: account.Platform || '',
Market: account.Market || campaign.Market || '',
Creator_Name: creator.Display_Name || creator.Legal_Name || '',
Campaign_Name: campaign.Campaign_Name || '',
App: campaign.App || '',
});
});
return publicValue_(operationsPageOf_(rows.reverse(), payload));
}
function getSettingsData() {
const user = requireRole_(['Admin', 'Booking', 'Marketing']);
const data = { config: getPublicConfig_(user), currentUser: user };
if (['Admin', 'Booking'].indexOf(user.Role) >= 0) data.users = readTable_('USERS');
return publicValue_(data);
}
function updateCampaignTemplate(payload) {
const user = requireRole_(['Admin', 'Booking']);
payload = payload || {};
const market = normalizeMarket_(payload.Market);
if (['VN', 'TH', 'TW'].indexOf(market) === -1) throw new Error('Invalid market template.');
const platforms = normalizePlatforms_(payload.Platforms);
if (!platforms.length) throw new Error('Select at least one platform.');
const targetKols = Math.max(1, Math.round(toNumber_(payload.Target_KOLs) || 20));
return withDocumentLock_(function () {
upsertConfigValue_(
'TEMPLATE_' + market + '_PLATFORMS',
platforms.join(','),
'Default platforms for ' + market + ' campaigns'
);
upsertConfigValue_(
'TEMPLATE_' + market + '_TARGET_KOLS',
String(targetKols),
'Default KOL target for ' + market + ' campaigns'
);
logActivity_(user.Email, 'UPDATE', 'CAMPAIGN_TEMPLATE', market, platforms.join(', ') + ' · ' + targetKols + ' KOLs');
return publicValue_(getCampaignTemplates_(getConfigMap_())[market]);
});
}
// Dashboard duoc dung o trang chu VA trong getBootstrapData, tuc gan nhu moi
// phien deu goi. No doc ca ACCOUNTS (6.769 dong), CAMPAIGN_KOLS va DELIVERABLES
// chi de ra ~4 KB con so tong hop - do la chi phi lon nhat cua endpoint duoc
// goi nhieu nhat, va no tang tuyen tinh theo so KOL.
// Ket qua chi doi khi DU LIEU doi, ma moi duong ghi deu bump DATA_REVISION.
// Nen dung chinh revision lam mot phan khoa cache: co ghi la khoa doi, ban cu
// tu dong het hieu luc, khong can invalidate thu cong o dau ca.
// Cache theo TUNG NGUOI vi so lieu bi loc theo quyen truy cap thi truong.
// publicValue_ duoc ap TRUOC khi cache de ban lay tu cache va ban tinh moi ra
// CUNG mot dinh dang: JSON.stringify bien Date thanh ISO co mili giay va hau to
// Z, khac han dinh dang publicValue_ dung, neu khong se lech giua hai duong.
function buildDashboard_(user) {
user = user || getCurrentUser_();
const cacheKey = 'dashboard_v1_' + getDataRevision_() + '_' + String(user.Email || '').toLowerCase();
try {
const cached = CacheService.getScriptCache().get(cacheKey);
if (cached) return JSON.parse(cached);
} catch (error) { /* cache hong thi tinh lai */ }
const result = publicValue_(buildDashboardRaw_(user));
try {
CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), TABLE_CACHE_TTL_SECONDS);
} catch (error) { /* qua lon thi bo qua, van dung */ }
return result;
}
function buildDashboardRaw_(user) {
user = user || getCurrentUser_();
const campaigns = listCampaigns_(user);
const visibleCampaignIds = {};
campaigns.forEach(function (campaign) { visibleCampaignIds[campaign.Campaign_ID] = true; });
const accounts = readTable_('ACCOUNTS').filter(function (account) { return canAccessMarket_(user, account.Market); });
const campaignKols = readTable_('CAMPAIGN_KOLS').filter(function (row) { return visibleCampaignIds[row.Campaign_ID]; });
const deliverables = readTable_('DELIVERABLES').filter(function (row) { return visibleCampaignIds[row.Campaign_ID]; });
const now = new Date();
const activeCampaigns = campaigns.filter(function (item) {
return item.Status === 'Active';
});
const activeCampaignIds = {};
activeCampaigns.forEach(function (campaign) { activeCampaignIds[campaign.Campaign_ID] = true; });
const activeCampaignKols = campaignKols.filter(function (item) {
return Boolean(activeCampaignIds[item.Campaign_ID]);
});
const pipelineKols = activeCampaignKols.filter(function (item) {
return ['Declined', 'Cancelled'].indexOf(item.Booking_Status) === -1;
});
const confirmed = pipelineKols.filter(function (item) { return item.Booking_Status === 'Confirmed'; }).length;
const needsAttention = campaignKols.filter(function (item) {
return item.Content_Status === 'Need edit' || item.Contract_Status === 'Info pending' || item.Payment_Status === 'On hold';
}).length;
const marketCounts = { VN: 0, TH: 0, TW: 0 };
accounts.forEach(function (item) {
if (Object.prototype.hasOwnProperty.call(marketCounts, item.Market)) marketCounts[item.Market] += 1;
});
const statusCounts = {};
LISTS.BOOKING_STATUSES.forEach(function (status) { statusCounts[status] = 0; });
pipelineKols.forEach(function (item) {
if (!Object.prototype.hasOwnProperty.call(statusCounts, item.Booking_Status)) statusCounts[item.Booking_Status || 'Picked'] = 0;
statusCounts[item.Booking_Status || 'Picked'] += 1;
});
const kolsByCampaign = {};
campaignKols.forEach(function (item) {
if (!kolsByCampaign[item.Campaign_ID]) kolsByCampaign[item.Campaign_ID] = [];
kolsByCampaign[item.Campaign_ID].push(item);
});
const campaignCards = activeCampaigns.slice(0, 6).map(function (campaign) {
const items = kolsByCampaign[campaign.Campaign_ID] || [];
const committed = items.filter(function (item) { return item.Booking_Status === 'Confirmed'; }).reduce(function (sum, item) {
return sum + campaignKolBudgetAmount_(item, campaign);
}, 0);
return mergeObjects_(campaign, {
KOL_Count: items.length,
Confirmed_Count: items.filter(function (item) { return item.Booking_Status === 'Confirmed'; }).length,
Committed_Budget: committed,
});
});
const upcoming = [];
campaigns.forEach(function (campaign) {
const date = parseDate_(campaign.Posting_Start || campaign.Start_Date);
if (date && date >= startOfToday_(now)) {
upcoming.push({ date: date, type: 'Campaign', title: campaign.App + ' · ' + campaign.Campaign_Name, subtitle: campaign.Market });
}
});
deliverables.forEach(function (item) {
const date = parseDate_(item.Draft_Due || item.Posting_Date);
if (date && date >= startOfToday_(now)) {
upcoming.push({ date: date, type: item.Draft_Due ? 'Draft due' : 'Post', title: item.Type || 'Deliverable', subtitle: item.Campaign_ID });
}
});
upcoming.sort(function (a, b) { return a.date.getTime() - b.date.getTime(); });
return {
metrics: {
activeCampaigns: activeCampaigns.length,
kolsInPipeline: pipelineKols.length,
confirmedKols: confirmed,
needsAttention: needsAttention,
totalAccounts: accounts.length,
},
marketCounts: marketCounts,
bookingStatusCounts: statusCounts,
activeCampaigns: campaignCards,
upcoming: upcoming.slice(0, 8),
};
}
function listCampaigns_(user) {
const kols = readTable_('CAMPAIGN_KOLS');
const byCampaign = {};
kols.forEach(function (item) {
if (!byCampaign[item.Campaign_ID]) byCampaign[item.Campaign_ID] = [];
byCampaign[item.Campaign_ID].push(item);
});
return readTable_('CAMPAIGNS').filter(function (campaign) {
return !user || canAccessCampaign_(user, campaign);
}).map(function (campaign) {
const items = byCampaign[campaign.Campaign_ID] || [];
return mergeObjects_(campaign, {
KOL_Count: items.length,
Confirmed_Count: items.filter(function (item) { return item.Booking_Status === 'Confirmed'; }).length,
Committed_Budget: items.filter(function (item) { return item.Booking_Status === 'Confirmed'; }).reduce(function (sum, item) {
return sum + campaignKolBudgetAmount_(item, campaign);
}, 0),
});
}).reverse();
}
function listShortlists_(user) {
const members = readTable_('SHORTLIST_KOLS');
const counts = {};
members.forEach(function (item) {
if (!counts[item.Shortlist_ID]) counts[item.Shortlist_ID] = { total: 0, approved: 0 };
counts[item.Shortlist_ID].total += 1;
if (item.Review_Status === 'Approved') counts[item.Shortlist_ID].approved += 1;
});
return readTable_('SHORTLISTS').filter(function (item) {
return !user || canAccessMarket_(user, item.Market);
}).map(function (item) {
const count = counts[item.Shortlist_ID] || { total: 0, approved: 0 };
return mergeObjects_(item, { KOL_Count: count.total, Approved_Count: count.approved });
}).reverse();
}
// NGUYEN NHAN CHINH khien MOI thao tac o MOI tab deu cham:
// dong `const config = getConfigMap_()` truoc day nam ngay dau ham, tuc chay
// trong MOI lenh goi server (requireRole_ -> getCurrentUser_ duoc dung o 33
// cho trong Code.gs + WorkspaceApi.gs + Setup.gs). getConfigMap_ doc sheet
// CONFIG, ma CONFIG chua HAI cong thuc GOOGLEFINANCE (Setup.gs:351-352):
//   =IFERROR(GOOGLEFINANCE("CURRENCY:THBVND"),750)
//   =IFERROR(GOOGLEFINANCE("CURRENCY:TWDVND"),800)
// GOOGLEFINANCE la cong thuc bay hoi, lay du lieu qua mang, nen getValues()
// len vung do co the buoc Sheets tinh lai va cho mang.
// Gia tri config chi duoc dung DUY NHAT o nhanh "khong tim thay user" ben
// duoi, nen no da duoc doi xuong day: nguoi dung hop le khong con tra gia.
// Kem theo: ghi nho ket qua trong 1 lan thuc thi, vi mot request co the goi
// nhieu ham server long nhau, moi ham lai requireRole_ mot lan.
let __currentUserForExecution_ = null;
function getCurrentUser_() {
if (__currentUserForExecution_) return __currentUserForExecution_;
const activeEmail = (Session.getActiveUser().getEmail() || '').toLowerCase();
const users = readTable_('USERS');
const user = users.find(function (item) {
return String(item.Email || '').toLowerCase() === activeEmail && isTrue_(item.Active);
});
if (user) {
__currentUserForExecution_ = user;
return user;
}
const config = getConfigMap_();
if (String(config.ALLOW_UNLISTED_USERS).toUpperCase() === 'TRUE' && activeEmail) {
// F38 — ALLOW_UNLISTED_USERS chỉ còn hiệu lực với email CÙNG DOMAIN với một Admin
// đang active trong USERS.
//
// Trước đây cờ này bật là bất kỳ account Google nào mở URL cũng được cấp
// {Role:'Marketing', Market:'Global'}, mà Market 'Global' thoả canAccessMarket_ cho
// MỌI market. Và vì executeAs: USER_ACCESSING buộc mọi user phải có quyền edit
// spreadsheet, bất kỳ user nào cũng tự sửa được ô CONFIG đó — không cần Admin, không
// để lại dấu vết. Một ô cách việc mở app cho cả internet.
//
// Vì sao suy ra allow-list từ USERS chứ không hard-code domain hay thêm ô CONFIG mới:
// ô mới sẽ lại đúng vấn đề một-ô mà việc này sinh ra để bịt. Muốn nới rộng bằng cách
// này thì phải tự thêm mình thành Admin đang active — mà việc đó đã cần quyền Admin.
// `users` đã đọc ở trên nên không phát sinh lần đọc sheet nào.
const domain = activeEmail.slice(activeEmail.lastIndexOf('@') + 1);
if (!activeEmail.includes('@') || !adminEmailDomains_(users)[domain]) {
// Cùng thông báo với nhánh từ chối bên dưới, có chủ ý: không tiết lộ rằng cờ đang bật.
throw new Error('Access denied for ' + activeEmail + '. Add this email to the USERS sheet and set Active = TRUE.');
}
const unlistedUser = { User_ID: '', Email: activeEmail, Name: activeEmail.split('@')[0], Role: 'Marketing', Market: 'Global', Active: 'TRUE' };
logAutoProvisionedUser_(activeEmail);
__currentUserForExecution_ = unlistedUser;
return unlistedUser;
}
if (!activeEmail) {
throw new Error('Your Google account email could not be detected. Deploy the web app for users in the same Google Workspace domain.');
}
throw new Error('Access denied for ' + activeEmail + '. Add this email to the USERS sheet and set Active = TRUE.');
}
/**
* Domain của các Admin ĐANG ACTIVE trong USERS. Allow-list tự suy ra cho
* ALLOW_UNLISTED_USERS (F38). Hàm thuần — nhận sẵn mảng users, không đọc sheet.
*/
function adminEmailDomains_(users) {
const domains = {};
(users || []).forEach(function (row) {
if (!isTrue_(row.Active)) return;
if (cleanText_(row.Role) !== 'Admin') return;
const email = cleanText_(row.Email).toLowerCase();
const at = email.lastIndexOf('@');
if (at > 0 && at < email.length - 1) domains[email.slice(at + 1)] = true;
});
return domains;
}
/**
* Ghi ACTIVITY_LOG khi một user tổng hợp được cấp, để việc bật cờ có dấu vết thay vì
* im lặng.
*
* Hai điều bắt buộc ở đây, vì getCurrentUser_ nằm trên đường nóng của MỌI lệnh gọi:
*  1) Chặn tần suất qua CacheService. logActivity_ là một lần GHI; không chặn thì một
*     người click 10 phút sinh ra hàng trăm dòng ACTIVITY_LOG. 6 tiếng/email là đủ để
*     Admin thấy "những người này nên được thêm vào USERS cho đúng".
*  2) Bọc try/catch. Một lần ghi log thất bại KHÔNG được phép làm sập xác thực, tức
*     làm sập toàn bộ app.
*/
function logAutoProvisionedUser_(email) {
try {
const cache = CacheService.getScriptCache();
const key = 'autoprov_v1_' + email;
if (cache.get(key)) return;
cache.put(key, '1', 21600);
logActivity_(email, 'AUTO_PROVISION', 'USERS', '',
'Synthetic Marketing/Global user minted: ALLOW_UNLISTED_USERS=TRUE and the domain matches an active Admin');
} catch (error) { /* log hỏng thì bỏ qua — không được chặn đăng nhập */ }
}
function requireRole_(roles) {
const user = getCurrentUser_();
if (roles.indexOf(user.Role) === -1) throw new Error('Your role (' + user.Role + ') is not allowed to perform this action.');
return user;
}
function canAccessMarket_(user, market) {
if (!user) return false;
if (['Admin', 'Booking'].indexOf(user.Role) >= 0) return true;
const userMarket = cleanText_(user.Market).toUpperCase();
const recordMarket = cleanText_(market).toUpperCase();
return userMarket === 'GLOBAL' || userMarket === recordMarket;
}
// Marketing team chỉ thấy được CAMPAIGN mà họ được gán tên (Assigned_Marketing),
// không còn dựa theo Market nữa — cho phép Booking/Admin chỉ định chính xác ai
// được làm việc trên campaign nào, thay vì Marketing thấy hết mọi campaign
// cùng thị trường.
function canAccessCampaign_(user, campaign) {
if (!user || !campaign) return false;
if (['Admin', 'Booking'].indexOf(user.Role) >= 0) return true;
if (user.Role === 'Marketing') {
const assigned = String(campaign.Assigned_Marketing || '').split(',').map(function (email) { return email.trim().toLowerCase(); }).filter(Boolean);
const email = cleanText_(user.Email).toLowerCase();
return assigned.indexOf(email) >= 0;
}
return canAccessMarket_(user, campaign.Market);
}
function assertCampaignAccess_(user, campaign) {
if (!canAccessCampaign_(user, campaign)) {
throw new Error('You are not assigned to this campaign.');
}
}
function assertMarketAccess_(user, market) {
if (!canAccessMarket_(user, market)) {
throw new Error('You do not have access to the ' + cleanText_(market) + ' market.');
}
}
function getPublicConfig_(user) {
const config = getConfigMap_();
const canSeeSource = user && ['Admin', 'Booking'].indexOf(user.Role) >= 0;
return {
// Nguồn version DUY NHẤT là APP.VERSION trong Setup.gs (F31). Trước đây client tự giữ
// một hằng UI_VERSION riêng và hai bên lệch nhau (1.11.0 vs 1.10.0), nên con số hiện
// trên màn Settings không nói lên bản nào đang chạy — mà đó là công dụng duy nhất của
// nó. Không thể dùng scriptlet <?= ?> trong Scripts.html vì include() gọi
// createHtmlOutputFromFile, hàm này KHÔNG xử lý template; nên đưa qua config.
appVersion: APP.VERSION,
companyName: config.COMPANY_NAME || 'SNOW',
workspaceName: config.WORKSPACE_NAME || 'Creator Operations',
defaultMarket: config.DEFAULT_MARKET || 'VN',
apps: String(config.DEFAULT_APPS || 'SNOW,B612,Foodie,SODA,EPIK').split(',').map(function (item) { return item.trim(); }).filter(String),
markets: LISTS.MARKETS,
platforms: LISTS.PLATFORMS,
currencies: LISTS.CURRENCIES,
campaignStatuses: LISTS.CAMPAIGN_STATUSES,
followerRanges: FOLLOWER_RANGES,
categories: CATEGORIES,
categoryGroups: CATEGORY_GROUPS,
// Chỉ Admin / Booking mới thấy ID của Google Sheet nguồn dữ liệu KOL.
// Trước đây field này lộ cho mọi role kể cả Viewer.
kolSourceSpreadsheetId: canSeeSource ? (config.KOL_SOURCE_SPREADSHEET_ID || '') : '',
templates: getCampaignTemplates_(config),
// Danh sách Marketing team để Admin/Booking gán vào từng campaign. Chỉ trả về
// cho Admin/Booking vì đây là thao tác quản lý, Marketing không cần thấy.
marketingTeam: canSeeSource ? readTable_('USERS').filter(function (u) {
return cleanText_(u.Role) === 'Marketing' && isTrue_(u.Active);
}).map(function (u) {
return { Email: u.Email, Name: u.Name || u.Email };
}) : [],
};
}
function getCampaignTemplates_(config) {
const defaults = {
VN: ['TikTok', 'Threads'],
TH: ['TikTok', 'Instagram', 'X'],
TW: ['Instagram', 'Threads'],
};
const templates = {};
['VN', 'TH', 'TW'].forEach(function (market) {
const configured = normalizePlatforms_(config['TEMPLATE_' + market + '_PLATFORMS']);
templates[market] = {
market: market,
currency: currencyForMarket_(market),
platforms: configured.length ? configured : defaults[market],
targetKols: Math.max(1, Math.round(toNumber_(config['TEMPLATE_' + market + '_TARGET_KOLS']) || 20)),
};
});
return templates;
}
function getConfigMap_() {
const config = {};
readTable_('CONFIG').forEach(function (item) { config[item.Key] = item.Value; });
return config;
}
function upsertConfigValue_(key, value, description) {
const sheet = getSheet_('CONFIG');
const now = new Date();
if (sheet.getLastRow() > 1) {
const keys = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
for (let index = 0; index < keys.length; index += 1) {
if (String(keys[index][0]).trim() === key) {
sheet.getRange(index + 2, 2, 1, 3).setValues([[value, description || '', now]]);
invalidateTableCache_('CONFIG');
touchDataRevision_();
return;
}
}
}
sheet.appendRow([key, value, description || '', now]);
invalidateTableCache_('CONFIG');
touchDataRevision_();
}
function getDataRevision_() {
return PropertiesService.getScriptProperties().getProperty('DATA_REVISION') || '0';
}
let __dataRevisionForExecution_ = '';
function touchDataRevision_() {
if (__dataRevisionForExecution_) return __dataRevisionForExecution_;
const revision = String(Date.now()) + '-' + Utilities.getUuid().slice(0, 8);
PropertiesService.getScriptProperties().setProperty('DATA_REVISION', revision);
__dataRevisionForExecution_ = revision;
return revision;
}
// Cache đơn giản trong phạm vi 1 lần thực thi (1 lệnh gọi từ client).
// Apps Script khởi tạo lại toàn bộ biến global cho MỖI lệnh gọi server riêng biệt,
// nên biến này tự "reset" giữa các request — không cần dọn dẹp thủ công.
// Bên trong CÙNG một request, nếu 2 hàm khác nhau cùng cần đọc 1 sheet (ví dụ
// getCampaignWorkspace() gọi getCampaignDetail() rồi lại tự đọc ACCOUNTS/CREATORS),
// sheet đó chỉ được đọc từ Google Sheets đúng 1 lần thay vì nhiều lần.
let __tableCache_ = {};
// Cache 2 tầng để giảm độ trễ:
// 1) __tableCache_ (biến thường) — chỉ sống trong 1 lần gọi server, tránh đọc
// trùng 1 sheet nhiều lần trong CÙNG 1 request (đã có từ trước).
// 2) CacheService — sống được GIỮA các lần gọi khác nhau (kể cả của người
// khác), tối đa ~45 giây. Đây là điểm tối ưu tốc độ thực sự: nếu nhiều
// người cùng mở Dashboard/Database trong vài chục giây, chỉ lần đầu tiên
// phải đọc thật từ Google Sheet, những lần sau lấy từ cache.
// Sheet quá lớn (vượt giới hạn 100KB/key của CacheService) sẽ tự động bỏ qua
// tầng 2 một cách an toàn (try/catch), không ảnh hưởng tính đúng của dữ liệu.
// 45s -> 300s. Voi cache tang 2 gio moi that su hoat dong cho ACCOUNTS/CREATORS,
// 45 giay nghia la hau het request van truot cache va van tra 3,8 giay. Moi
// duong GHI cua app deu goi invalidateTableCache_ nen khong co rui ro du lieu cu
// tu chinh app. Rui ro con lai: sua TAY truc tiep tren Google Sheet thi cho toi
// 5 phut moi thay - chay kolClearCache() de thay ngay.
const TABLE_CACHE_TTL_SECONDS = 300;
// CONFIG duoc doi xu rieng. No chua hai cong thuc GOOGLEFINANCE, nen moi lan
// doc THAT tu Google Sheets deu co the buoc Sheets tinh lai va cho mang - day
// la thu lam cham nhat, chu khong phai ban than viec doc sheet.
// Giai phap o day KHONG dong gi den cong thuc: chi cache ket qua doc lau hon.
// An toan vi:
//   - moi duong GHI cua app vao CONFIG (upsertConfigValue_) deu goi
//     invalidateTableCache_ -> CacheService.remove, ma CacheService dung chung
//     cho CA script nen moi nguoi deu thay ngay;
//   - ty gia khong doi theo giay: mot ty gia cu 6 tieng van dung cho muc dich
//     uoc tinh ngan sach, va repairConfigFxFormulas van chay binh thuong.
// Danh doi duy nhat: neu ai do sua TAY truc tiep tren Google Sheet thi lau
// thay hon. 21600s = 6 gio, la muc TOI DA CacheService cho phep.
const TABLE_CACHE_TTL_OVERRIDES = { CONFIG: 21600 };
function tableCacheTtl_(sheetName) {
return TABLE_CACHE_TTL_OVERRIDES[sheetName] || TABLE_CACHE_TTL_SECONDS;
}
// Khoá cache lên v2: giá trị Date nay được mã hoá an toàn trước khi vào CacheService.
// JSON.stringify biến Date của Sheet thành chuỗi ISO theo UTC, nên khi đọc lại từ
// cache mọi mốc thời gian bị lùi 7 tiếng — tức lùi hẳn 1 ngày với giá trị nửa đêm —
// trong khi đọc trực tiếp từ Sheet lại trả về Date thật mà publicValue_ format theo
// giờ VN. Hai đường cho hai kết quả khác nhau, và modal sửa campaign ghi ngược cái
// ngày đã lệch trở lại Sheet, mỗi lần mở-lưu lùi thêm một ngày. Mã hoá Date thành
// epoch millis để cả hai đường luôn trả về đúng cùng một Date.
// v3: dinh dang luu doi tu mang-cac-object sang dang cot ({h: headers, r: [[...]]})
// va duoc cat thanh nhieu manh. Doi khoa de ban cu v2 khong bi doc nham.
function tableCacheKey_(sheetName) { return 'table_cache_v3_' + sheetName; }
const CACHE_DATE_TAG = '@@Date:';
// ============================================================================
// Cache tang 2 (CacheService, dung chung giua cac request).
//
// LOI TRUOC DAY: CacheService gioi han 100KB moi khoa. ACCOUNTS (6.769 dong x
// 20 cot) va CREATORS (4.222 x 24) vuot xa nguong do, nen `put` nem loi va bi
// catch nuot di - tang 2 AM THAM khong hoat dong cho dung hai bang nang nhat.
// Ket qua: MOI request deu doc lai ca hai tu Google Sheets, do duoc 2.669 ms
// + 1.137 ms, tuc phan lon cua 7,4 giay tong.
//
// Hai thay doi:
//  1) Luu theo DANG COT: {h: [ten cot], r: [[gia tri], ...]} thay vi lap lai
//     ten cot cho tung dong. Voi ACCOUNTS, rieng phan ten cot truoc day chiem
//     khoang mot nua so ky tu.
//  2) CAT THANH NHIEU MANH duoi nguong 100KB, moi manh mot khoa, kem mot khoa
//     chi muc ghi so manh.
// Neu van qua lon (vuot TABLE_CACHE_MAX_CHUNKS) thi bo qua tang 2 dung nhu cu:
// du lieu van dung, chi la khong duoc cache.
// ============================================================================
// 45.000 ky tu: an toan duoi nguong 100KB/khoa ke ca khi chuoi co nhieu ky tu
// 2 byte (vd. ten tieng Viet co dau trong Display_Name).
const TABLE_CACHE_CHUNK_CHARS = 45000;
const TABLE_CACHE_MAX_CHUNKS = 120;
// Nen truoc khi cat manh. JSON dang cot lap lai rat nhieu (ma ACC-/CRE-, ten
// thi truong, gia tri rong) nen gzip an rat tot. Do duoc: ACCOUNTS 6.769 dong
// o dang cot la ~2 MB = 47 manh, tuc chi can du lieu gap doi la vuot tran va
// cache lai am tham tat - dung cai loi vua sua. Nen xong thi con thua nhieu.
// base64 lam phinh lai ~33%, van loi lon.
// Neu Utilities.gzip loi vi ly do nao do, cachePutTable_ nem loi va readTable_
// da boc no trong try/catch san -> tu dong quay ve hanh vi "khong cache", du
// lieu van dung.
function cacheCompress_(payload) {
const blob = Utilities.newBlob(payload, 'text/plain', 'table.json');
return Utilities.base64Encode(Utilities.gzip(blob).getBytes());
}
function cacheDecompress_(encoded) {
const blob = Utilities.newBlob(Utilities.base64Decode(encoded), 'application/x-gzip', 'table.gz');
return Utilities.ungzip(blob).getDataAsString();
}
function cacheEncodeTable_(rows, headers) {
return {
h: headers,
r: rows.map(function (row) {
return headers.map(function (header) {
const value = row[header];
return value instanceof Date ? CACHE_DATE_TAG + value.getTime() : value;
});
}),
};
}
function cacheDecodeTable_(payload) {
const headers = (payload && payload.h) || [];
return ((payload && payload.r) || []).map(function (values) {
const out = {};
headers.forEach(function (header, index) {
const value = values[index];
if (typeof value === 'string' && value.lastIndexOf(CACHE_DATE_TAG, 0) === 0) {
const millis = Number(value.slice(CACHE_DATE_TAG.length));
out[header] = isNaN(millis) ? value : new Date(millis);
} else {
out[header] = value;
}
});
return out;
});
}
// Ba helper duoi day lam viec voi MOT chuoi bat ky, khong gan voi sheet nao.
// Truoc day logic nay nam trong cachePutTable_/cacheGetTable_ nen chi dung duoc
// cho bang; bang tra cuu rut gon (accountLookup_/creatorLookup_) can dung lai
// dung co che do nen chuoi cua no cung vuot 100KB.
function cachePutPayload_(key, payload, ttl) {
const count = Math.ceil(payload.length / TABLE_CACHE_CHUNK_CHARS) || 1;
if (count > TABLE_CACHE_MAX_CHUNKS) {
console.warn('Cache ' + key + ' qua lon (' + count + ' manh > ' + TABLE_CACHE_MAX_CHUNKS + '), bo qua.');
return false;
}
const cache = CacheService.getScriptCache();
if (count === 1) {
cache.put(key, 'inline:' + payload, ttl);
return true;
}
const entries = {};
for (let index = 0; index < count; index += 1) {
entries[key + ':' + index] = payload.slice(index * TABLE_CACHE_CHUNK_CHARS, (index + 1) * TABLE_CACHE_CHUNK_CHARS);
}
cache.putAll(entries, ttl);
// Ghi khoa chi muc SAU CUNG: neu ghi cac manh that bai thi lan doc sau khong
// thay chi muc tro vao nhung manh khong ton tai.
cache.put(key, String(count), ttl);
return true;
}
function cacheGetPayload_(key) {
const cache = CacheService.getScriptCache();
const head = cache.get(key);
if (!head) return null;
if (head.lastIndexOf('inline:', 0) === 0) return head.slice(7);
const count = Number(head);
if (!count || isNaN(count)) return null;
const keys = [];
for (let index = 0; index < count; index += 1) keys.push(key + ':' + index);
const parts = cache.getAll(keys);
let payload = '';
for (let index = 0; index < count; index += 1) {
const part = parts[key + ':' + index];
// Thieu mot manh thi bo CA BAN GHI - ghep thieu se ra JSON hong.
if (typeof part !== 'string') return null;
payload += part;
}
return payload;
}
function cacheRemovePayload_(key) {
const cache = CacheService.getScriptCache();
const head = cache.get(key);
const keys = [key];
const count = Number(head);
if (count && !isNaN(count)) {
for (let index = 0; index < count; index += 1) keys.push(key + ':' + index);
}
cache.removeAll(keys);
}
function cachePutTable_(sheetName, rows) {
const headers = SCHEMA[sheetName];
if (!headers) return false;
const payload = cacheCompress_(JSON.stringify(cacheEncodeTable_(rows, headers)));
return cachePutPayload_(tableCacheKey_(sheetName), payload, tableCacheTtl_(sheetName));
}
function cacheGetTable_(sheetName) {
const payload = cacheGetPayload_(tableCacheKey_(sheetName));
if (payload === null) return null;
return cacheDecodeTable_(JSON.parse(cacheDecompress_(payload)));
}
function cacheRemoveTable_(sheetName) {
cacheRemovePayload_(tableCacheKey_(sheetName));
}

function readTable_(sheetName) {
if (__tableCache_[sheetName]) {
return __tableCache_[sheetName].map(function (row) { return mergeObjects_(row, {}); });
}
let rows = null;
try {
rows = cacheGetTable_(sheetName);
} catch (err) {
rows = null;
}
if (!rows) {
const sheet = getSheet_(sheetName);
const lastRow = sheet.getLastRow();
const headers = SCHEMA[sheetName];
if (!headers) throw new Error('Schema not found: ' + sheetName);
if (lastRow < 2) {
rows = [];
} else {
const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
rows = values.filter(function (row) {
return row.some(function (value) { return value !== ''; });
}).map(function (row) {
const object = {};
headers.forEach(function (header, index) { object[header] = row[index]; });
return object;
});
}
rememberTableSize_(sheetName, rows.length);
try {
cachePutTable_(sheetName, rows);
} catch (err) {
// Dữ liệu quá lớn cho CacheService (>100KB) hoặc lỗi serialize (vd. Date) — bỏ qua tầng 2, vẫn đúng dữ liệu.
}
}
__tableCache_[sheetName] = rows;
return rows.map(function (row) { return mergeObjects_(row, {}); });
}
function invalidateTableCache_(sheetName) {
delete __tableCache_[sheetName];
try { cacheRemoveTable_(sheetName); } catch (err) { /* no-op */ }
}
// Chi so id -> so dong THAT trong sheet, dung dung MOT lan doc cot id cho moi
// sheet trong ca request. Truoc day updateRecordsById_ doc CA SHEET (moi cot,
// moi dong) chi de tim dong can sua, va mot lan luu KOL goi no HAI lan tren
// ACCOUNTS -> doc ca sheet 2 lan; updateRecord_ thi dung createTextFinder, mot
// lan goi API rieng nua. Doc 1 cot re hon doc 20 cot dung 20 lan.
// KHONG invalidate sau UPDATE: sua noi dung o khong lam doi so dong. CHI
// invalidate sau APPEND, vi luc do co dong moi chua nam trong chi so.
let __rowNumberIndexCache_ = {};
function rowNumberIndex_(sheetName, idField) {
const cacheKey = sheetName + '|' + idField;
if (__rowNumberIndexCache_[cacheKey]) return __rowNumberIndexCache_[cacheKey];
const sheet = getSheet_(sheetName);
const headers = SCHEMA[sheetName];
if (!headers) throw new Error('Schema not found: ' + sheetName);
const idIndex = headers.indexOf(idField);
if (idIndex < 0) throw new Error('ID field not found: ' + idField);
const index = {};
const lastRow = sheet.getLastRow();
if (lastRow >= 2) {
const ids = sheet.getRange(2, idIndex + 1, lastRow - 1, 1).getValues();
for (let position = 0; position < ids.length; position += 1) {
// Giu nguyen cach so sanh cu (String(value || ''), khong trim) de khong
// bong nhien khop them nhung id co khoang trang du trong sheet.
const id = String(ids[position][0] || '');
if (id && !Object.prototype.hasOwnProperty.call(index, id)) index[id] = position + 2;
}
}
__rowNumberIndexCache_[cacheKey] = index;
return index;
}
// ============================================================================
// DOC NHIEU BANG TRONG MOT LENH GOI (Advanced Sheets Service)
//
// Do duoc: moi lan doc mot sheet ton ~170-480 ms BAT KE so dong (CAMPAIGNS chi
// 7 dong van mat 368 ms). Do la chi phi round trip. Mot request cham 6-8 bang
// mat ~2 giay chi rieng tien round trip. Sheets.Spreadsheets.Values.batchGet
// doc nhieu dai trong MOT lenh goi HTTP.
//
// VI SAO MAC DINH TAT: getValues() tra ve doi tuong Date cho o ngay thang, con
// Sheets API tra ve so serial (SERIAL_NUMBER) - va mot so serial thi khong phan
// biet duoc voi mot cot so binh thuong nhu Followers. Phai dua vao TEN COT de
// biet cot nao la ngay, va phep doi serial -> Date phu thuoc mui gio.
// Doan mo la khong chap nhan duoc voi du lieu ngay thang, nen: chay
// kolVerifyBatchRead() mot lan, no so tung o cua MOI bang giua hai duong doc;
// chi khi KHOP HET no moi bat co. Khong khop thi in ra cho lech va khong bat.
// ============================================================================
// KET QUA DO CUOI CUNG - doc truoc khi bat lai.
// Do cong bang (best-of-3, xoa cache trong tung vong lap), 3 lan chay khac nhau:
//   A (theo lo) 4.393 / 5.424 / 7.518 ms
//   B (doc le)  5.987 / 4.500 / 8.115 ms
// A thang, B thang, roi A thang sat nut 7%. Tuc chenh lech NAM TRONG NHIEU: do
// dao dong giua cac lan chay len toi 2-3 lan, lon hon han khac biet giua hai
// cach lam. KHONG chung minh duoc doc theo lo nhanh hon.
//
// Khuyen nghi: de TAT - kolSetBatchRead(false). Khong phai vi no kem, ma vi no
// CHUA duoc chung minh la tot, trong khi keo theo chi phi that: hai luot render,
// nhan dien o ngay, mot ham kiem chung phai chay lai moi khi doi SCHEMA, va co
// che tu hoc kich thuoc. Chi nen tra gia do khi doi lai duoc toc do that.
//
// Ma van duoc GIU LAI va da kiem chung 244.901 o khop tuyet doi. Khi du lieu lon
// len dang ke, phan tiet kiem chi phi co dinh moi bang co the tro nen dang ke -
// luc do chay lai kolVerifyBatchRead(), roi kolSetBatchRead(true), roi xem lai
// hai dong A/B trong kolSpeedProfile().
const BATCH_READ_FLAG = 'BATCH_READ_ENABLED';
// Bang LON khong di theo lo.
// Ly do: cach doc theo lo phai goi batchGet HAI LUOT tren cung mot dai (mot luot
// SERIAL_NUMBER, mot luot FORMATTED_STRING) de nhan dien o ngay cho chinh xac.
// Voi bang nho thi khong sao - cai duoc lam la gop nhieu bang vao mot lenh goi,
// tiet kiem ~250 ms chi phi co dinh moi bang. Nhung voi ACCOUNTS (6.769 dong x
// 20 cot = 135.000 o) thi hai luot nghia la 270.000 o phai truyen ve duoi dang
// JSON - phan truyen du lieu at han phan tiet kiem duoc.
// Hai bang nay van duoc doc bang getValues() mot luot nhu cu, va van duoc cache
// binh thuong. Buoc 'A vs B' trong kolSpeedProfile() do dung dieu nay.
// Danh sach chan thu cong (de trong - gio da co nguong theo kich thuoc ben duoi).
// Van giu lai lam duong lui: neu mot bang nao do gay van de ma chua kip hieu vi
// sao, them ten vao day la no ngung di theo lo ngay.
const BATCH_READ_SKIP = {};
// Nguong theo KICH THUOC thay cho viec go cung ten bang.
// Vi sao khong go cung: do duoc, de ACCOUNTS (135.000 o) di theo lo lam buoc mo
// app tu 2,4 giay vot len 21,4 giay. Nhung ACCOUNTS khong phai bang duy nhat se
// lon len - DELIVERABLES sinh theo tung bai dang, ACTIVITY_LOG sinh theo tung
// thao tac. Go cung ten bang thi hom nao chung lon len se dinh lai dung cai bay
// do, va lan nay khong ai biet vi sao.
// 20.000 o ~ 1.000 dong x 20 cot. Duoi nguong nay thi phan tiet kiem tu viec gop
// lenh goi (~250 ms moi bang) van lon hon phan truyen du lieu bi nhan doi.
const BATCH_READ_MAX_CELLS = 20000;
// Kich thuoc duoc GHI NHO lai moi lan doc lanh, nen he thong tu hoc.
// Bang chua tung duoc do thi MAC DINH KHONG di theo lo - chon huong an toan:
// doan sai o phia "cho la nho" phai tra gia 19 giay, doan sai o phia "cho la
// lon" chi mat phan tiet kiem cua dung mot lan doc dau tien.
let __tableSizesForExecution_ = null;
function tableSizes_() {
if (__tableSizesForExecution_) return __tableSizesForExecution_;
let sizes = {};
try {
const raw = PropertiesService.getScriptProperties().getProperty('TABLE_ROW_COUNTS');
if (raw) sizes = JSON.parse(raw) || {};
} catch (error) { sizes = {}; }
__tableSizesForExecution_ = sizes;
return sizes;
}
function rememberTableSize_(sheetName, rowCount) {
try {
const sizes = tableSizes_();
const previous = sizes[sheetName];
// Chi ghi khi chua biet hoac lech dang ke, de khong dot han ngach ghi
// ScriptProperties chi vi bang tang them vai dong.
if (previous !== undefined && Math.abs(previous - rowCount) <= Math.max(50, previous * 0.1)) return;
sizes[sheetName] = rowCount;
__tableSizesForExecution_ = sizes;
PropertiesService.getScriptProperties().setProperty('TABLE_ROW_COUNTS', JSON.stringify(sizes));
} catch (error) { /* khong ghi nho duoc thi thoi, chi mat phan tu toi uu */ }
}
function batchReadWorthIt_(sheetName) {
if (BATCH_READ_SKIP[sheetName]) return false;
const headers = SCHEMA[sheetName];
if (!headers) return false;
const rowCount = tableSizes_()[sheetName];
if (rowCount === undefined) return false;
return rowCount * headers.length <= BATCH_READ_MAX_CELLS;
}
// Serial cua Sheets tinh tu 1899-12-30 theo mui gio cua bang tinh.
// Asia/Ho_Chi_Minh khong co DST nen do lech la hang so, phep doi la xac dinh.
const SHEETS_SERIAL_EPOCH_UTC = Date.UTC(1899, 11, 30);
function batchReadEnabled_() {
try { return PropertiesService.getScriptProperties().getProperty(BATCH_READ_FLAG) === 'TRUE'; }
catch (error) { return false; }
}
function columnLetter_(index) {
let letter = '';
let value = index;
while (value > 0) {
const remainder = (value - 1) % 26;
letter = String.fromCharCode(65 + remainder) + letter;
value = Math.floor((value - 1) / 26);
}
return letter;
}

function serialToDate_(serial) {
const offsetMinutes = Number(Utilities.formatDate(new Date(), APP.TIMEZONE, 'Z'));
const offsetMs = (Math.trunc(offsetMinutes / 100) * 60 + (offsetMinutes % 100)) * 60000;
return new Date(SHEETS_SERIAL_EPOCH_UTC + Math.round(serial * 86400000) - offsetMs);
}
// Doi mot dai gia tri tho tu Sheets API sang dung dinh dang ma readTable_ tra ve.
// Doc mot dai bang HAI LUOT render de nhan dien o ngay CHINH XAC TUNG O.
//
// Vi sao khong dung ten cot: kolVerifyBatchRead() da chung minh cach do sai ve
// nguyen tac. Hai vi du that trong du lieu nay:
//   - CONFIG.Value  la cot khoa/gia tri tu do: co dong la "1.11.0", co dong la
//     TRUE, va co dong la mot NGAY.
//   - CREATORS.Source_Note la ghi chu tu do, co dong nguoi dung go vao mot ngay
//     va Sheets tu dinh dang no thanh ngay.
// Cung mot cot ma dong nay la ngay dong kia la chuoi, nen KHONG ten cot nao noi
// len duoc dieu gi. Ngoai ra ten cot ngay that su cung khong theo quy uoc:
// Posting_Start, Posting_End, Month deu la ngay.
//
// Cach dung: goi batchGet hai lan tren CUNG mot dai.
//   - luot SERIAL_NUMBER : o ngay ra SO (chinh xac, dung de dung lai Date)
//   - luot FORMATTED_STRING: o ngay ra CHUOI, con o so van la SO
// Vay o nao ra so o luot 1 VA ra chuoi o luot 2 thi dung la o ngay. Khong phu
// thuoc ten cot, khong phu thuoc dinh dang hien thi.
// Hai lenh goi cho TAT CA cac bang van re hon mot lenh goi cho MOI bang.
function batchFetchRanges_(ranges) {
const asSerial = Sheets.Spreadsheets.Values.batchGet(APP.SPREADSHEET_ID, {
ranges: ranges,
valueRenderOption: 'UNFORMATTED_VALUE',
dateTimeRenderOption: 'SERIAL_NUMBER',
});
const asText = Sheets.Spreadsheets.Values.batchGet(APP.SPREADSHEET_ID, {
ranges: ranges,
valueRenderOption: 'UNFORMATTED_VALUE',
dateTimeRenderOption: 'FORMATTED_STRING',
});
return { serial: asSerial.valueRanges || [], text: asText.valueRanges || [] };
}
function batchRowsToRecords_(sheetName, serialValues, textValues) {
const headers = SCHEMA[sheetName];
const serialRows = serialValues || [];
const textRows = textValues || [];
const records = [];
for (let rowIndex = 0; rowIndex < serialRows.length; rowIndex += 1) {
const serialRow = serialRows[rowIndex] || [];
const textRow = textRows[rowIndex] || [];
const isBlank = serialRow.every(function (value) {
return value === '' || value === null || typeof value === 'undefined';
});
if (isBlank) continue;
const object = {};
for (let colIndex = 0; colIndex < headers.length; colIndex += 1) {
let value = colIndex < serialRow.length && serialRow[colIndex] !== null && typeof serialRow[colIndex] !== 'undefined'
? serialRow[colIndex] : '';
const shown = colIndex < textRow.length ? textRow[colIndex] : undefined;
if (typeof value === 'number' && typeof shown === 'string' && shown !== '') {
value = serialToDate_(value);
}
object[headers[colIndex]] = value;
}
records.push(object);
}
return records;
}
/**
 * Nap san nhieu bang bang MOT lenh goi. Khong lam gi neu co chua bat, neu chi
 * con duoi 2 bang chua co cache (mot bang thi batchGet khong loi gi), hoac neu
 * Advanced Service khong dung duoc - luc do readTable_ doc tung bang nhu cu.
 */
/**
 * Nap san nhieu bang bang HAI lenh goi (thay vi mot lenh goi cho moi bang).
 * Khong lam gi neu doc theo lo chua duoc bat, hoac neu con duoi 2 bang chua co
 * trong cache - luc do khong loi gi.
 */
function prefetchTables_(sheetNames) {
if (!batchReadEnabled_()) return;
const missing = (sheetNames || []).filter(function (name) {
return SCHEMA[name] && !__tableCache_[name] && batchReadWorthIt_(name);
});
if (missing.length < 2) return;
try {
const ranges = missing.map(function (name) {
return "'" + name + "'!A2:" + columnLetter_(SCHEMA[name].length);
});
const fetched = batchFetchRanges_(ranges);
missing.forEach(function (name, index) {
const rows = batchRowsToRecords_(name,
(fetched.serial[index] || {}).values,
(fetched.text[index] || {}).values);
__tableCache_[name] = rows;
try { cachePutTable_(name, rows); } catch (error) { /* khong cache duoc thi thoi */ }
});
} catch (error) {
// Bat ky truc trac nao (chua bat API, het quota, doi ten sheet) deu quay ve
// duong cu mot cach im lang va dung dan: readTable_ tu doc tung bang.
console.warn('prefetchTables_ that bai, quay ve doc tung bang: ' + (error && error.message ? error.message : error));
}
}
/**
 * KIEM CHUNG truoc khi bat doc theo lo. Chi doc, khong ghi du lieu.
 * Chay tu trinh chinh sua: chon kolVerifyBatchRead roi bam Run.
 * No doc MOI bang bang CA HAI duong roi so tung o. Chi khi khop het 100% no moi
 * bat co BATCH_READ_ENABLED. Lech o dau thi in ra dung o do va KHONG bat.
 */
function kolVerifyBatchRead() {
requireRole_(['Admin']);
const lines = ['', '=== Kiem chung doc theo lo (batchGet) vs getValues ==='];
const names = Object.keys(SCHEMA);
let mismatches = 0;
let checkedCells = 0;
names.forEach(function (name) {
let truth = null;
let viaApi = null;
try {
invalidateTableCache_(name);
truth = readTable_(name);
} catch (error) {
lines.push(name + ': KHONG doc duoc bang getValues - ' + error.message);
mismatches += 1;
return;
}
try {
const range = "'" + name + "'!A2:" + columnLetter_(SCHEMA[name].length);
const fetched = batchFetchRanges_([range]);
viaApi = batchRowsToRecords_(name, (fetched.serial[0] || {}).values, (fetched.text[0] || {}).values);
} catch (error) {
lines.push(name + ': KHONG goi duoc Sheets API - ' + (error && error.message ? error.message : error));
mismatches += 1;
return;
}
if (truth.length !== viaApi.length) {
lines.push(name + ': LECH SO DONG - getValues ' + truth.length + ' vs API ' + viaApi.length);
mismatches += 1;
return;
}
const headers = SCHEMA[name];
let sheetMismatch = 0;
for (let rowIndex = 0; rowIndex < truth.length; rowIndex += 1) {
for (let colIndex = 0; colIndex < headers.length; colIndex += 1) {
const header = headers[colIndex];
const a = truth[rowIndex][header];
const b = viaApi[rowIndex][header];
checkedCells += 1;
const same = (a instanceof Date && b instanceof Date)
? a.getTime() === b.getTime()
: String(a) === String(b);
if (!same) {
sheetMismatch += 1;
if (sheetMismatch <= 3) {
lines.push(name + ' dong ' + (rowIndex + 2) + ' cot ' + header +
': getValues=' + JSON.stringify(a) + ' vs API=' + JSON.stringify(b));
}
}
}
}
if (sheetMismatch) {
lines.push(name + ': ' + sheetMismatch + ' o LECH');
mismatches += sheetMismatch;
} else {
lines.push(name + ': khop (' + truth.length + ' dong)');
}
});
const properties = PropertiesService.getScriptProperties();
if (mismatches === 0) {
properties.setProperty(BATCH_READ_FLAG, 'TRUE');
lines.push('--- KHOP HET ' + checkedCells + ' o. Da BAT doc theo lo. ---');
} else {
properties.setProperty(BATCH_READ_FLAG, 'FALSE');
lines.push('--- Co ' + mismatches + ' cho lech. VAN TAT doc theo lo. ---');
}
const report = lines.join('\n');
console.log(report);
return report;
}
// ============================================================================
// BANG TRA CUU RUT GON cho cac cho JOIN
//
// KET QUA DO (cong bang, best-of-3, hai ben tra ve cung mot thu):
//   indexBy_(readTable_(ACCOUNTS)) 612 ms  ->  accountLookup_()  429 ms  (-30%)
//   indexBy_(readTable_(CREATORS)) 333 ms  ->  creatorLookup_()  216 ms  (-35%)
// Mot request cham ca hai bang: ~945 ms -> ~645 ms. Day la phan CO hieu qua.
//
// Van de: 27 cho doc NGUYEN bang ACCOUNTS (6.769 dong x 20 cot) va CREATORS
// (4.222 x 24). Vi du getCampaignWorkspace doc ca hai bang chi de tra ~143 ban
// ghi. Ngay ca khi da co cache, moi request van tra ~0,5 giay cho ACCOUNTS va
// ~0,4 giay cho CREATORS, va con so do tang tuyen tinh theo so KOL.
//
// Da doc ma tung cho de biet chinh xac chung dung nhung truong nao. Ket qua:
// cac cho JOIN chi dung 8/20 cot cua ACCOUNTS va 5/24 cot cua CREATORS.
// Nen thay vi nap ca bang, ta nap mot BANG TRA CUU RUT GON, cache theo
// DATA_REVISION giong nhu dashboard: co ghi la khoa doi, tu het hieu luc.
//
// CANH BAO KHI SUA VE SAU: doc mot truong KHONG nam trong danh sach duoi day tu
// ket qua cua accountLookup_/creatorLookup_ se ra `undefined` MOT CACH IM LANG.
// Them truong vao day truoc khi dung no. kolVerifyLookups() kiem tra tinh dung
// dan cua phep chieu, nhung KHONG the biet ban dinh doc them truong nao.
//
// searchAccounts CO Y khong dung bang rut gon: no truyen NGUYEN object creator
// vao accountView_ (Code.gs:288), ma ham do doc toi 16 truong cua creator.
// ============================================================================
const ACCOUNT_LOOKUP_FIELDS = ['Account_ID', 'Creator_ID', 'Username', 'Platform', 'Market', 'Profile_URL', 'Followers', 'Starting_Fee', 'Currency'];
const CREATOR_LOOKUP_FIELDS = ['Creator_ID', 'Display_Name', 'Legal_Name', 'Categories', 'Source_Status'];
let __lookupForExecution_ = {};
function projectedLookup_(sheetName, idField, fields, cacheName) {
if (__lookupForExecution_[cacheName]) return __lookupForExecution_[cacheName];
const cacheKey = 'lookup_v1_' + cacheName + '_' + getDataRevision_();
let rows = null;
try {
const payload = cacheGetPayload_(cacheKey);
if (payload !== null) rows = cacheDecodeTable_(JSON.parse(cacheDecompress_(payload)));
} catch (error) { rows = null; }
if (!rows) {
rows = readTable_(sheetName).map(function (row) {
const projected = {};
fields.forEach(function (field) { projected[field] = row[field]; });
return projected;
});
try {
cachePutPayload_(cacheKey, cacheCompress_(JSON.stringify(cacheEncodeTable_(rows, fields))), TABLE_CACHE_TTL_SECONDS);
} catch (error) { /* khong cache duoc thi van dung, chi cham hon */ }
}
const lookup = indexBy_(rows, idField);
__lookupForExecution_[cacheName] = lookup;
return lookup;
}
function accountLookup_() { return projectedLookup_('ACCOUNTS', 'Account_ID', ACCOUNT_LOOKUP_FIELDS, 'accounts'); }
function creatorLookup_() { return projectedLookup_('CREATORS', 'Creator_ID', CREATOR_LOOKUP_FIELDS, 'creators'); }
/**
 * Kiem chung bang tra cuu rut gon so voi bang day du. Chi doc.
 * Chay tu trinh chinh sua sau khi deploy, hoac sau khi doi danh sach truong.
 */
function kolVerifyLookups() {
requireRole_(['Admin']);
const lines = ['', '=== Kiem chung bang tra cuu rut gon ==='];
let mismatches = 0;
[
{ name: 'ACCOUNTS', idField: 'Account_ID', fields: ACCOUNT_LOOKUP_FIELDS, lookup: accountLookup_ },
{ name: 'CREATORS', idField: 'Creator_ID', fields: CREATOR_LOOKUP_FIELDS, lookup: creatorLookup_ },
].forEach(function (spec) {
const full = readTable_(spec.name);
const lookup = spec.lookup();
let bad = 0;
full.forEach(function (row) {
const id = String(row[spec.idField] || '');
if (!id) return;
const projected = lookup[id];
if (!projected) { bad += 1; if (bad <= 3) lines.push(spec.name + ': thieu ' + id); return; }
spec.fields.forEach(function (field) {
const a = row[field];
const b = projected[field];
const same = (a instanceof Date && b instanceof Date) ? a.getTime() === b.getTime() : String(a) === String(b);
if (!same) { bad += 1; if (bad <= 3) lines.push(spec.name + ' ' + id + '.' + field + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b)); }
});
});
mismatches += bad;
lines.push(spec.name + ': ' + (bad ? bad + ' cho LECH' : 'khop (' + full.length + ' dong x ' + spec.fields.length + ' truong)'));
});
lines.push(mismatches ? '--- Co ' + mismatches + ' cho lech ---' : '--- KHOP HET ---');
const report = lines.join('\n');
console.log(report);
return report;
}
function invalidateRowNumberIndex_(sheetName) {
Object.keys(__rowNumberIndexCache_).forEach(function (key) {
if (key.indexOf(sheetName + '|') === 0) delete __rowNumberIndexCache_[key];
});
}
// Doc dung nhung dong can thiet. Cac dong gan nhau (cach nhau <= 20 dong) duoc
// gop vao MOT lan getValues: mot range hoi rong van re hon nhieu lan goi API.
function readRowsByNumber_(sheet, columnCount, rowNumbers) {
const sorted = rowNumbers.slice().sort(function (a, b) { return a - b; });
const result = {};
let cursor = 0;
while (cursor < sorted.length) {
let end = cursor;
while (end + 1 < sorted.length && sorted[end + 1] - sorted[end] <= 20) end += 1;
const start = sorted[cursor];
const values = sheet.getRange(start, 1, sorted[end] - start + 1, columnCount).getValues();
for (let k = cursor; k <= end; k += 1) result[sorted[k]] = values[sorted[k] - start];
cursor = end + 1;
}
return result;
}
function appendRecord_(sheetName, record) {
const sheet = getSheet_(sheetName);
const headers = SCHEMA[sheetName];
const row = headers.map(function (header) {
return Object.prototype.hasOwnProperty.call(record, header) ? record[header] : '';
});
sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
invalidateTableCache_(sheetName);
invalidateRowNumberIndex_(sheetName);
touchDataRevision_();
return record;
}
function appendRecords_(sheetName, records) {
records = Array.isArray(records) ? records.filter(Boolean) : [];
if (!records.length) return [];
const sheet = getSheet_(sheetName);
const headers = SCHEMA[sheetName];
const values = records.map(function (record) {
return headers.map(function (header) {
return Object.prototype.hasOwnProperty.call(record, header) ? record[header] : '';
});
});
sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
invalidateTableCache_(sheetName);
invalidateRowNumberIndex_(sheetName);
touchDataRevision_();
return records;
}
function updateRecordsById_(sheetName, idField, changesById) {
changesById = changesById || {};
const requestedIds = Object.keys(changesById).filter(Boolean);
if (!requestedIds.length) return {};
const sheet = getSheet_(sheetName);
const headers = SCHEMA[sheetName];
const idIndex = headers.indexOf(idField);
if (idIndex < 0) throw new Error('ID field not found: ' + idField);
const rowNumberById = rowNumberIndex_(sheetName, idField);
const missing = requestedIds.filter(function (id) { return !rowNumberById[id]; });
if (missing.length) throw new Error('Record not found: ' + missing.join(', '));
const rowsByNumber = readRowsByNumber_(sheet, headers.length, requestedIds.map(function (id) { return rowNumberById[id]; }));
const found = {};
const changedRows = [];
requestedIds.forEach(function (id) {
const rowNumber = rowNumberById[id];
const row = rowsByNumber[rowNumber];
const changes = changesById[id] || {};
headers.forEach(function (header, columnIndex) {
if (Object.prototype.hasOwnProperty.call(changes, header)) row[columnIndex] = changes[header];
});
found[id] = row;
changedRows.push({ rowNumber: rowNumber, row: row });
});
writeChangedRows_(sheet, headers.length, changedRows);
invalidateTableCache_(sheetName);
touchDataRevision_();
const result = {};
Object.keys(found).forEach(function (id) {
const object = {};
headers.forEach(function (header, index) { object[header] = found[id][index]; });
result[id] = object;
});
return result;
}
function writeChangedRows_(sheet, columnCount, changedRows) {
if (!changedRows.length) return;
changedRows.sort(function (a, b) { return a.rowNumber - b.rowNumber; });
let start = changedRows[0].rowNumber;
let rows = [changedRows[0].row];
for (let index = 1; index < changedRows.length; index += 1) {
const item = changedRows[index];
const expected = start + rows.length;
if (item.rowNumber === expected) {
rows.push(item.row);
continue;
}
sheet.getRange(start, 1, rows.length, columnCount).setValues(rows);
start = item.rowNumber;
rows = [item.row];
}
sheet.getRange(start, 1, rows.length, columnCount).setValues(rows);
}
function updateRecord_(sheetName, idField, id, changes) {
const sheet = getSheet_(sheetName);
const headers = SCHEMA[sheetName];
const idIndex = headers.indexOf(idField);
if (idIndex < 0) throw new Error('ID field not found: ' + idField);
// Truoc day: createTextFinder (mot lan goi API rieng) tren ca cot id. Chi so
// rowNumberIndex_ cho ket qua tuong duong (khop tron o, phan biet hoa thuong =
// so sanh chuoi) va duoc dung chung voi updateRecordsById_ trong cung request.
const rowNumber = rowNumberIndex_(sheetName, idField)[String(id)];
if (!rowNumber) throw new Error('Record not found: ' + id);
const row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
headers.forEach(function (header, index) {
if (Object.prototype.hasOwnProperty.call(changes, header)) row[index] = changes[header];
});
sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
invalidateTableCache_(sheetName);
touchDataRevision_();
const result = {};
headers.forEach(function (header, index) { result[header] = row[index]; });
return result;
}
function findRecord_(sheetName, field, value) {
return readTable_(sheetName).find(function (item) { return String(item[field]) === String(value); }) || null;
}
function indexBy_(rows, field) {
const result = {};
rows.forEach(function (row) {
const key = row[field];
if (key !== '' && key !== null && typeof key !== 'undefined') result[String(key)] = row;
});
return result;
}
function logActivity_(email, action, entityType, entityId, details) {
appendRecord_('ACTIVITY_LOG', {
Log_ID: makeId_('LOG'),
Timestamp: new Date(),
User_Email: email || '',
Action: action,
Entity_Type: entityType,
Entity_ID: entityId,
Details: details || '',
});
}
function nextCampaignId_(market) {
const prefix = 'CMP-' + Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyMM') + '-' + market + '-';
const count = readTable_('CAMPAIGNS').filter(function (item) {
return String(item.Campaign_ID || '').indexOf(prefix) === 0;
}).length + 1;
return prefix + String(count).padStart(3, '0');
}
// An toàn khi lồng nhau. Nhiều hàm đã chạy trong lock rồi lại gọi tiếp một hàm
// khác cũng cần lock (vd. updateCampaignKol -> ensureDeliverablesForCampaignKols_);
// nếu lần thứ hai cũng waitLock thật thì rủi ro treo 30 giây rồi throw. Đếm độ sâu
// để chỉ lần ngoài cùng thực sự giữ lock.
let __documentLockDepth_ = 0;
function withDocumentLock_(callback) {
if (__documentLockDepth_ > 0) return callback();
const lock = LockService.getScriptLock();
lock.waitLock(30000);
__documentLockDepth_++;
try {
return callback();
} finally {
__documentLockDepth_--;
lock.releaseLock();
}
}
/**
 * CHAN DOAN TOC DO - CHI DOC, khong ghi bat cu gi vao Google Sheet.
 *
 * Cach chay: mo trinh chinh sua Apps Script, chon `kolSpeedProfile` o hop chon
 * ham tren thanh cong cu roi bam Run. Ket qua in o Nhat ky thuc thi.
 *
 * Vi sao can: da toi uu hai vong (duong ghi, va bo CONFIG khoi duong nong) ma
 * van cham. Doan tiep la lang phi - ham nay tach tung buoc ra de thay thoi gian
 * THAT SU nam o dau: mo spreadsheet, doc CONFIG (co GOOGLEFINANCE), doc tung
 * sheet, hay o chinh cac endpoint.
 *
 * Luu y: no xoa cache dung chung TRUOC khi do, de con so phan anh "lan doc dau
 * tien" chu khong phai lan da co cache. Vi vay request ngay sau do cua nguoi
 * dung se cham hon binh thuong mot chut. Khong dong gi den du lieu.
 */
/**
 * Xoa toan bo cache bang. Chay tu trinh chinh sua sau khi SUA TAY truc tiep
 * tren Google Sheet, de khong phai cho het han cache moi thay thay doi.
 * Khong dong gi den du lieu.
 */
/**
 * Bat/tat doc theo lo bang mot lenh, khong phai sua code.
 *   kolSetBatchRead(true)  / kolSetBatchRead(false)
 */
function kolSetBatchRead(enabled) {
requireRole_(['Admin']);
PropertiesService.getScriptProperties().setProperty(BATCH_READ_FLAG, enabled ? 'TRUE' : 'FALSE');
const message = 'Doc theo lo: ' + (enabled ? 'DA BAT' : 'DA TAT');
console.log(message);
return message;
}
function kolClearCache() {
requireRole_(['Admin']);
const names = Object.keys(SCHEMA);
names.forEach(function (name) { invalidateTableCache_(name); });
// Bang tra cuu rut gon duoc khoa theo revision nen tu het han, nhung khi xoa
// tay thi phai xoa luon, khong thi van con ban cu cua dung revision hien tai.
['accounts', 'creators'].forEach(function (name) {
try { cacheRemovePayload_('lookup_v1_' + name + '_' + getDataRevision_()); } catch (error) { /* no-op */ }
});
__lookupForExecution_ = {};
const message = 'Da xoa cache cua ' + names.length + ' bang va 2 bang tra cuu.';
console.log(message);
return message;
}
function kolSpeedProfile() {
requireRole_(['Admin']);
const rows = [];
function step(label, run, describe) {
const started = Date.now();
let result = null;
let note = '';
try {
result = run();
} catch (error) {
note = 'LOI: ' + (error && error.message ? error.message : String(error));
}
// Dung dong ho TRUOC khi mo ta ket qua, khong thi chi phi cua JSON.stringify
// lai bi tinh vao thoi gian cua buoc.
const elapsed = Date.now() - started;
if (!note) {
try { note = describe ? describe(result) : 'ok'; } catch (error) { note = 'ok'; }
}
rows.push({ label: label, ms: elapsed, note: note });
return result;
}

// Lay TOAN BO bang trong SCHEMA chu khong liet ke tay: lan do truoc chi lam
// nong 7 bang, nen getBootstrapData van phai doc lanh SHORTLISTS +
// SHORTLIST_KOLS va trong nhu no cham mot cach bi an.
// Do NHIEU LAN roi lay lan NHANH NHAT. Ly do: do dao dong giua cac lan chay rat
// lon - cung mot ban build, ACCOUNTS lanh do duoc 2.370 / 3.113 / 7.016 ms o ba
// lan khac nhau. Voi chenh lech kieu do thi so sanh hai cach lam bang mot lan
// chay la vo nghia. Lay lan nhanh nhat se loai duoc nhieu do tranh chap nhat
// thoi, va la cach so sanh hai cai dat cong bang hon ca.
function stepBest(label, run, describe, times) {
const attempts = times || 3;
let best = Infinity;
let result = null;
let note = '';
for (let attempt = 0; attempt < attempts; attempt += 1) {
const started = Date.now();
try {
result = run();
} catch (error) {
note = 'LOI: ' + (error && error.message ? error.message : String(error));
break;
}
const elapsed = Date.now() - started;
if (elapsed < best) best = elapsed;
}
if (!note) {
try { note = describe ? describe(result) : 'ok'; } catch (error) { note = 'ok'; }
note += '  (nhanh nhat trong ' + attempts + ' lan)';
}
rows.push({ label: label, ms: best === Infinity ? 0 : best, note: note });
return result;
}
const sheetNames = Object.keys(SCHEMA);
sheetNames.forEach(function (name) { invalidateTableCache_(name); });
__currentUserForExecution_ = null;

step('mo spreadsheet + lay sheet', function () { return getSheet_('ACCOUNTS').getName(); });
rows.push({ label: 'doc theo lo (batchGet)', ms: 0,
note: batchReadEnabled_() ? 'DANG BAT' : 'dang TAT - chay kolVerifyBatchRead() de bat' });
if (batchReadEnabled_()) {
const inBatch = Object.keys(SCHEMA).filter(batchReadWorthIt_);
const outBatch = Object.keys(SCHEMA).filter(function (name) { return !batchReadWorthIt_(name); });
rows.push({ label: '  bang DI theo lo', ms: 0, note: inBatch.length ? inBatch.join(', ') : '(chua bang nao - chay lan nua de he thong hoc kich thuoc)' });
rows.push({ label: '  bang doc RIENG (lon hoac chua do)', ms: 0, note: outBatch.join(', ') });
}
step('doc CONFIG lan 1 (co GOOGLEFINANCE)', function () { return getConfigMap_(); },
function (value) { return Object.keys(value).length + ' key'; });
step('doc CONFIG lan 2 (da cache)', function () { return getConfigMap_(); },
function (value) { return Object.keys(value).length + ' key'; });
step('getCurrentUser_', function () { return getCurrentUser_(); },
function (value) { return value.Email + ' / ' + value.Role; });
sheetNames.forEach(function (name) {
if (name === 'CONFIG') return;
invalidateTableCache_(name);
step('readTable_ ' + name + ' (lanh, tu Sheet)', function () { return readTable_(name); },
function (value) { return value.length + ' dong'; });
// Lan doc thu hai: chi xoa cache trong-1-lan-thuc-thi, GIU cache tang 2
// (CacheService) ma lan doc tren vua ghi vao. Con so nay chinh la thoi gian
// ma moi request THAT SU phai tra sau khi cache hoat dong. Truoc khi sua,
// ACCOUNTS/CREATORS vuot 100KB nen tang 2 khong bao gio ghi duoc va con so
// nay se bang con so 'lanh' o tren.
delete __tableCache_[name];
step('readTable_ ' + name + ' (tu cache tang 2)', function () { return readTable_(name); },
function (value) { return value.length + ' dong'; });
});

// ---- So sanh CONG BANG duong cu vs duong moi.
//
// Lan do truoc bi HAI loi do, ghi lai de khong lap:
//  1) 'creatorLookup_ (tu cache)' thuc ra la lan chay LANH: khoi nay xoa ca hai
//     khoa lookup o dau, nhung chi accountLookup_ duoc goi lai de nap cache,
//     con creatorLookup_ thi lan goi dau tien da la lan bi do -> dan nhan sai.
//  2) So 'accountLookup_()' voi 'readTable_ ACCOUNTS' la so KHONG cung khoi
//     luong: lookup lam ca indexBy_, readTable_ thi khong. Duong cu that su la
//     indexBy_(readTable_(...)), nen phai so voi dung cai do.
//
// Cach lam duoi day: nap DAY DU ca hai duong truoc, roi moi bam gio, va moi ben
// deu tra ve dung mot thu - mot map id -> ban ghi.
['accounts', 'creators'].forEach(function (name) {
try { cacheRemovePayload_('lookup_v1_' + name + '_' + getDataRevision_()); } catch (error) { /* no-op */ }
});
__lookupForExecution_ = {};
step('lookup: dung cache lan dau (lanh, ca 2 bang)', function () {
accountLookup_(); creatorLookup_(); return 'da nap';
});

// Tu day cache cua CA HAI duong deu day du. Xoa bo nho trong-1-lan-thuc-thi de
// moi ben deu phai di qua cache that.
__lookupForExecution_ = {};
// Viec xoa cache phai nam BEN TRONG ham chay: stepBest lap 3 lan, neu chi xoa
// mot lan o ngoai thi lan 2 va 3 lay tu __tableCache_ va do ra gan bang 0.
stepBest('CU  : indexBy_(readTable_(ACCOUNTS))', function () { delete __tableCache_.ACCOUNTS; return indexBy_(readTable_('ACCOUNTS'), 'Account_ID'); },
function (value) { return Object.keys(value).length + ' ban ghi'; }, 3);
stepBest('MOI : accountLookup_() rut gon', function () { __lookupForExecution_ = {}; return accountLookup_(); },
function (value) { return Object.keys(value).length + ' ban ghi'; }, 3);

stepBest('CU  : indexBy_(readTable_(CREATORS))', function () { delete __tableCache_.CREATORS; return indexBy_(readTable_('CREATORS'), 'Creator_ID'); },
function (value) { return Object.keys(value).length + ' ban ghi'; }, 3);
stepBest('MOI : creatorLookup_() rut gon', function () { __lookupForExecution_ = {}; return creatorLookup_(); },
function (value) { return Object.keys(value).length + ' ban ghi'; }, 3);

const describeSize = function (value) {
try { return Math.round(JSON.stringify(value).length / 1024) + ' KB JSON'; } catch (error) { return 'ok'; }
};
step('endpoint getBootstrapData()', function () { return getBootstrapData(); }, describeSize);
step('endpoint getDashboardData()', function () { return getDashboardData(); }, describeSize);
step('endpoint getPerformanceOverview()', function () { return getPerformanceOverview(); }, describeSize);
step('endpoint getCollaborationHistory()', function () { return getCollaborationHistory(); }, describeSize);

// SO DO QUAN TRONG NHAT: mo app khi CHUA co gi trong cache.
// Bon buoc endpoint o tren deu chay sau khi moi bang da nam san trong bo nho
// cua chinh lan thuc thi nay, nen chung KHONG phan anh luc nguoi dung mo app
// lan dau. Xoa sach ca hai tang roi do lai getBootstrapData - day dung la thu
// nguoi dung cho doi khi bam vao ung dung.
// (Cache dashboard theo revision van con, va dieu do la DUNG THUC TE: no cung
// song sot giua cac request tren production.)
// ---- Do doi dau: nap theo lo vs doc le, cung mot bo bang, deu tu cache trong.
// Buoc 'mo app ... CACHE TRONG' o lan do truoc ra 21.375 ms, trong khi tong moi
// lan doc lanh cong lai chi khoang 9 giay. Nghi van: hai luot render nhan DOI
// luong du lieu truyen ve, va voi bang lon (ACCOUNTS 6.769 x 20) thi phan truyen
// du lieu at han phan tiet kiem duoc tu viec gop lenh goi.
// Hai buoc duoi day tra loi dut khoat, khong phai suy doan.
const bootstrapTables = ['CAMPAIGNS', 'CAMPAIGN_KOLS', 'ACCOUNTS', 'DELIVERABLES', 'SHORTLISTS', 'SHORTLIST_KOLS'];

sheetNames.forEach(function (name) { invalidateTableCache_(name); });
const batchWasOn = batchReadEnabled_();
if (batchWasOn) {
stepBest('A. nap 6 bang duong MOI (lo + bang lon rieng)', function () {
// Phai xoa cache o TRONG ham chay, khong thi lan lap thu 2 va 3 lay tu cache
// va con so se dep mot cach gia tao.
sheetNames.forEach(function (name) { invalidateTableCache_(name); });
prefetchTables_(bootstrapTables);
// Bang nam trong BATCH_READ_SKIP khong duoc lo nap, nen doc o day. Nho vay
// buoc A do tron ven duong moi va so sanh duoc truc tiep voi buoc B.
bootstrapTables.forEach(function (name) { readTable_(name); });
return bootstrapTables.length + ' bang';
});
} else {
rows.push({ label: 'A. nap 6 bang THEO LO', ms: 0, note: 'bo qua - doc theo lo dang TAT' });
}

sheetNames.forEach(function (name) { invalidateTableCache_(name); });
stepBest('B. doc 6 bang LE (khong theo lo)', function () {
sheetNames.forEach(function (name) { invalidateTableCache_(name); });
bootstrapTables.forEach(function (name) { readTable_(name); });
return bootstrapTables.length + ' bang';
});

// Va day la con so that su quan trong: mo app khi khong co gi trong cache.
sheetNames.forEach(function (name) { invalidateTableCache_(name); });
step('mo app: getBootstrapData() CACHE TRONG', function () { return getBootstrapData(); }, describeSize);

let total = 0;
rows.forEach(function (row) { total += row.ms; });
const width = rows.reduce(function (max, row) { return Math.max(max, row.label.length); }, 0);
const lines = ['', '=== KOL Manager - do toc do (chi doc) ==='];
rows.forEach(function (row) {
const pad = row.label + new Array(Math.max(1, width - row.label.length + 2)).join(' ');
const ms = new Array(Math.max(1, 8 - String(row.ms).length)).join(' ') + row.ms + ' ms';
lines.push(pad + ms + '   ' + row.note);
});
lines.push('--- tong cong: ' + total + ' ms ---');
lines.push('Buoc nao chiem phan lon thoi gian thi do la cho can sua tiep.');
const report = lines.join('\n');
console.log(report);
return report;
}
function requireFields_(object, fields) {
const missing = fields.filter(function (field) { return !cleanText_(object[field]); });
if (missing.length) throw new Error('Missing required field(s): ' + missing.join(', '));
}
function publicValue_(value) {
if (value instanceof Date) return Utilities.formatDate(value, APP.TIMEZONE, 'yyyy-MM-dd\'T\'HH:mm:ss');
if (Array.isArray(value)) return value.map(publicValue_);
if (value && typeof value === 'object') {
const result = {};
Object.keys(value).forEach(function (key) { result[key] = publicValue_(value[key]); });
return result;
}
return value;
}
function mergeObjects_(a, b) {
const result = {};
Object.keys(a || {}).forEach(function (key) { result[key] = a[key]; });
Object.keys(b || {}).forEach(function (key) { result[key] = b[key]; });
return result;
}
function cleanText_(value) {
return value === null || typeof value === 'undefined' ? '' : String(value).trim();
}
// Range.setValues() coi chuỗi mở đầu bằng '=', '+', '-' hoặc '@' là CÔNG THỨC
// chứ không phải văn bản. Mọi giá trị đến từ NGOÀI hệ thống mà được ghi vào sheet
// phải đi qua đây trước: nếu không, người gửi lưu được một công thức SỐNG vào
// bảng tính production, và nó sẽ được tính dưới quyền của người mở sheet — đủ để
// đọc sang ô khác (bank account, PERF_API_KEY) rồi đẩy ra ngoài bằng IMPORTRANGE.
// Thêm dấu nháy đơn ở đầu là cách Sheets ép một ô về text; dấu nháy là chỉ dẫn
// định dạng, không nằm trong giá trị khi đọc lại, nên readTable_ và các placeholder
// hợp đồng vẫn thấy đúng văn bản gốc.
function sanitizeSheetText_(value) {
const text = cleanText_(value);
return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
}
function normalizeMarket_(value) {
const market = cleanText_(value).toUpperCase();
return market === 'GLOBAL' ? 'Global' : market;
}
function normalizePlatforms_(value) {
const source = Array.isArray(value) ? value : String(value || '').split(',');
const seen = {};
return source.map(function (item) { return cleanText_(item); }).filter(function (item) {
if (!item || LISTS.PLATFORMS.indexOf(item) === -1 || seen[item]) return false;
seen[item] = true;
return true;
});
}
function toNumber_(value) {
if (typeof value === 'number') return isNaN(value) ? 0 : value;
const normalized = String(value || '').replace(/[^0-9.-]/g, '');
const result = Number(normalized);
return isNaN(result) ? 0 : result;
}
function isTrue_(value) {
return value === true || String(value).toUpperCase() === 'TRUE' || String(value) === '1';
}
function currencyForMarket_(market) {
return market === 'VN' ? 'VND' : market === 'TH' ? 'THB' : market === 'TW' ? 'TWD' : 'USD';
}
function getFxRates_() {
const config = getConfigMap_();
return {
VND: 1,
THB: Math.max(0, toNumber_(config.FX_THB_VND)) || 750,
TWD: Math.max(0, toNumber_(config.FX_TWD_VND)) || 800,
};
}
function feeToVnd_(amount, currency, rates) {
const code = cleanText_(currency).toUpperCase();
if (code === 'VND') return Math.round(toNumber_(amount));
const rate = (rates || getFxRates_())[code];
return rate ? Math.round(toNumber_(amount) * rate) : 0;
}
function parseDate_(value) {
if (!value) return null;
if (value instanceof Date && !isNaN(value.getTime())) return value;
const date = new Date(value);
return isNaN(date.getTime()) ? null : date;
}
// Mốc thời gian dạng số để so sánh/sắp xếp. Luôn dùng hàm này thay cho
// String(date) — xem ghi chú ở latestDeliverableByCampaignKol.
function timeValue_(value) {
const date = parseDate_(value);
return date ? date.getTime() : 0;
}
function startOfToday_(date) {
return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
function createKolRecord(payload) {
const user = requireRole_(['Admin', 'Booking']);
payload = payload || {};
requireFields_(payload, ['Username', 'Platform', 'Market']);
return withDocumentLock_(function () {
const now = new Date();
const market = normalizeMarket_(payload.Market);
const platform = cleanText_(payload.Platform);
const username = cleanText_(payload.Username).replace(/^@/, '');
const normalizedUsername = username.toLowerCase();
const profileUrl = cleanText_(payload.Profile_URL);
const normalizedProfileUrl = normalizeDirectUrl_(profileUrl);
assertMarketAccess_(user, market);
if (LISTS.MARKETS.indexOf(market) === -1) throw new Error('Invalid market.');
if (LISTS.PLATFORMS.indexOf(platform) === -1) throw new Error('Invalid platform.');
const accounts = readTable_('ACCOUNTS');
const duplicate = accounts.find(function (account) {
const sameHandle = normalizeMarket_(account.Market) === market &&
cleanText_(account.Platform).toLowerCase() === platform.toLowerCase() &&
cleanText_(account.Username).replace(/^@/, '').toLowerCase() === normalizedUsername;
const sameUrl = normalizedProfileUrl && normalizeDirectUrl_(account.Profile_URL) === normalizedProfileUrl;
return sameHandle || sameUrl;
});
if (duplicate) throw new Error('This KOL account already exists: ' + duplicate.Account_ID);
const creators = readTable_('CREATORS');
const email = cleanText_(payload.Email).toLowerCase();
const phone = cleanText_(payload.Phone).replace(/[^0-9+]/g, '');
const existingCreator = creators.find(function (creator) {
const sameEmail = email && cleanText_(creator.Email).toLowerCase() === email;
const samePhone = phone && cleanText_(creator.Phone).replace(/[^0-9+]/g, '') === phone;
return sameEmail || samePhone;
});
const creatorId = existingCreator ? existingCreator.Creator_ID : makeId_('CRE');
const accountId = makeId_('ACC');
const countryByMarket = { VN: 'Vietnam', TH: 'Thailand', TW: 'Taiwan', Global: 'Global' };
const languageByMarket = { VN: 'Vietnamese', TH: 'Thai', TW: 'Traditional Chinese', Global: '' };
const creatorRecord = {
Creator_ID: creatorId,
Display_Name: cleanText_(payload.Display_Name) || username,
Legal_Name: cleanText_(payload.Legal_Name),
Country: countryByMarket[market] || market,
Languages: languageByMarket[market] || '',
Categories: cleanText_(payload.Categories),
Email: cleanText_(payload.Email),
Phone: cleanText_(payload.Phone),
Active: 'TRUE',
Created_At: now,
Updated_At: now,
Source_Status: normalizeSourceStatus_(payload.Source_Status) || 'Not contacted',
Source_PIC: user.Name || user.Email
};
const accountRecord = {
Account_ID: accountId,
Creator_ID: creatorId,
Market: market,
Platform: platform,
Username: username,
Profile_URL: profileUrl,
Followers: toNumber_(payload.Followers),
Starting_Fee: toNumber_(payload.Starting_Fee),
Currency: currencyForMarket_(payload.Market),
Active: 'TRUE',
Created_At: now,
Updated_At: now,
App_Fit: cleanText_(payload.App_Fit)
};
if (!existingCreator) appendRecord_('CREATORS', creatorRecord);
appendRecord_('ACCOUNTS', accountRecord);
logActivity_(user.Email, 'CREATE_KOLS_DIRECT', 'KOL_DATABASE', accountId, existingCreator ? 'Created account and linked existing creator' : 'Created account and creator from Web App');
return publicValue_({ success: true, Account_ID: accountId, Creator_ID: creatorId, Reused_Creator: Boolean(existingCreator) });
});
}
function extractUsernameFromUrl_(url) {
const cleaned = cleanText_(url).replace(/[?#].*$/, '').replace(/\/$/, '');
const segments = cleaned.split('/').filter(Boolean);
const last = segments[segments.length - 1] || '';
return last.replace(/^@/, '');
}
// Tạo 1 creator + nhiều account (mỗi platform 1 account) trong CÙNG 1 lần submit.
// Team chỉ cần dán link Threads/IG/TikTok/X (bắt buộc ít nhất 1) + YouTube/Facebook
// (tuỳ chọn) một lần duy nhất, thay vì phải bấm "Add KOL" lặp lại cho từng platform.
function createKolRecordMultiPlatform(payload) {
const user = requireRole_(['Admin', 'Booking']);
payload = payload || {};
const market = normalizeMarket_(payload.Market);
if (LISTS.MARKETS.indexOf(market) === -1) throw new Error('Invalid market.');
assertMarketAccess_(user, market);
const platformFields = {
Threads: { url: payload.Threads_URL, followers: payload.Threads_Followers, fee: payload.Threads_Starting_Fee },
Instagram: { url: payload.Instagram_URL, followers: payload.Instagram_Followers, fee: payload.Instagram_Starting_Fee },
TikTok: { url: payload.TikTok_URL, followers: payload.TikTok_Followers, fee: payload.TikTok_Starting_Fee },
X: { url: payload.X_URL, followers: payload.X_Followers, fee: payload.X_Starting_Fee },
YouTube: { url: payload.YouTube_URL, followers: payload.YouTube_Followers, fee: payload.YouTube_Starting_Fee },
Facebook: { url: payload.Facebook_URL, followers: payload.Facebook_Followers, fee: payload.Facebook_Starting_Fee },
};
const providedPlatforms = Object.keys(platformFields).filter(function (platform) { return cleanText_(platformFields[platform].url); });
if (!providedPlatforms.length) throw new Error('Enter at least one profile URL for Threads, Instagram, TikTok or X.');
return withDocumentLock_(function () {
const now = new Date();
const accounts = readTable_('ACCOUNTS');
const creators = readTable_('CREATORS');
const email = cleanText_(payload.Email).toLowerCase();
const phone = cleanText_(payload.Phone).replace(/[^0-9+]/g, '');
const contactMatchedCreator = creators.find(function (creator) {
const sameEmail = email && cleanText_(creator.Email).toLowerCase() === email;
const samePhone = phone && cleanText_(creator.Phone).replace(/[^0-9+]/g, '') === phone;
return sameEmail || samePhone;
});
const matchedAccountCreatorIds = uniqueWorkspaceText_(providedPlatforms.map(function (platform) {
const profileUrl = cleanText_(platformFields[platform].url);
const normalizedProfileUrl = normalizeDirectUrl_(profileUrl);
const normalizedUsername = extractUsernameFromUrl_(profileUrl).toLowerCase();
const matchedAccount = accounts.find(function (account) {
const sameHandle = normalizeMarket_(account.Market) === market &&
cleanText_(account.Platform).toLowerCase() === platform.toLowerCase() &&
cleanText_(account.Username).replace(/^@/, '').toLowerCase() === normalizedUsername;
const sameUrl = normalizedProfileUrl && normalizeDirectUrl_(account.Profile_URL) === normalizedProfileUrl;
return sameHandle || sameUrl;
});
return matchedAccount ? cleanText_(matchedAccount.Creator_ID) : '';
}).filter(Boolean));
if (matchedAccountCreatorIds.length > 1) {
throw new Error('These profile URLs belong to different creators. Check duplicate data before saving.');
}
if (contactMatchedCreator && matchedAccountCreatorIds.length &&
contactMatchedCreator.Creator_ID !== matchedAccountCreatorIds[0]) {
throw new Error('The email or phone and the profile URL point to different creators, so they cannot be merged automatically.');
}
const linkedCreator = matchedAccountCreatorIds.length
? creators.find(function (creator) { return creator.Creator_ID === matchedAccountCreatorIds[0]; })
: null;
const existingCreator = contactMatchedCreator || linkedCreator || null;
const creatorId = existingCreator ? existingCreator.Creator_ID : makeId_('CRE');
const countryByMarket = { VN: 'Vietnam', TH: 'Thailand', TW: 'Taiwan', Global: 'Global' };
const languageByMarket = { VN: 'Vietnamese', TH: 'Thai', TW: 'Traditional Chinese', Global: '' };
const creatorRecord = {
Creator_ID: creatorId,
Display_Name: cleanText_(payload.Display_Name) || extractUsernameFromUrl_(platformFields[providedPlatforms[0]].url),
Legal_Name: cleanText_(payload.Legal_Name),
Country: countryByMarket[market] || market,
Languages: languageByMarket[market] || '',
Categories: cleanText_(payload.Categories),
Email: cleanText_(payload.Email),
Phone: cleanText_(payload.Phone),
Active: 'TRUE',
Created_At: now,
Updated_At: now,
Source_Status: normalizeSourceStatus_(payload.Source_Status) || 'Not contacted',
Source_PIC: user.Name || user.Email,
};
const createdAccounts = [];
const accountRecords = [];
const skipped = [];
providedPlatforms.forEach(function (platform) {
const platformData = platformFields[platform];
const profileUrl = cleanText_(platformData.url);
const normalizedProfileUrl = normalizeDirectUrl_(profileUrl);
const username = extractUsernameFromUrl_(profileUrl);
const normalizedUsername = username.toLowerCase();
const duplicate = accounts.find(function (account) {
const sameHandle = normalizeMarket_(account.Market) === market &&
cleanText_(account.Platform).toLowerCase() === platform.toLowerCase() &&
cleanText_(account.Username).replace(/^@/, '').toLowerCase() === normalizedUsername;
const sameUrl = normalizedProfileUrl && normalizeDirectUrl_(account.Profile_URL) === normalizedProfileUrl;
return sameHandle || sameUrl;
});
if (duplicate) { skipped.push({ platform: platform, reason: 'Already exists: ' + duplicate.Account_ID }); return; }
const accountId = makeId_('ACC');
const accountRecord = {
Account_ID: accountId,
Creator_ID: creatorId,
Market: market,
Platform: platform,
Username: username,
Profile_URL: profileUrl,
Followers: Math.max(0, toNumber_(platformData.followers)),
Starting_Fee: Math.max(0, toNumber_(platformData.fee)),
Currency: currencyForMarket_(market),
Active: 'TRUE',
Created_At: now,
Updated_At: now,
App_Fit: cleanText_(payload.App_Fit),
};
accounts.push(accountRecord);
createdAccounts.push(accountId);
accountRecords.push(accountRecord);
});
if (!existingCreator) appendRecord_('CREATORS', creatorRecord);
appendRecords_('ACCOUNTS', accountRecords);
logActivity_(user.Email, 'CREATE_KOLS_MULTI', 'KOL_DATABASE', creatorId, createdAccounts.length + ' account(s) created, ' + skipped.length + ' skipped (duplicate)');
if (!createdAccounts.length) throw new Error('All profile links already exist in the system.');
return publicValue_({ success: true, Creator_ID: creatorId, Created_Accounts: createdAccounts, Skipped: skipped, Reused_Creator: Boolean(existingCreator) });
});
}
function normalizeEmailList_(value) {
const list = Array.isArray(value) ? value : String(value || '').split(',');
const seen = {};
const result = [];
list.map(function (item) { return cleanText_(item).toLowerCase(); }).filter(Boolean).forEach(function (email) {
if (!seen[email]) { seen[email] = true; result.push(email); }
});
return result.join(', ');
}
function normalizeDirectUrl_(value) {
return cleanText_(value).toLowerCase().replace(/[?#].*$/, '').replace(/\/$/, '');
}
function normalizeSourceStatus_(value) {
const text = cleanText_(value);
if (!text) return 'Not contacted';
const key = text.toLowerCase().replace(/[^a-z]/g, '');
const aliases = {
notcontacted: 'Not contacted',
norespone: 'No Response',
noresponse: 'No Response',
cantcontact: "Can't contact",
cannotcontact: "Can't contact",
blacklist: 'Black List',
};
return aliases[key] || text;
}
function numberFilter_(value) {
if (value === '' || value === null || value === undefined) return null;
const number = toNumber_(value);
return Number.isFinite(number) ? number : null;
}
function accountView_(account, creator) {
account = account || {};
creator = creator || {};
return mergeObjects_(account, {
Display_Name: creator.Display_Name || creator.Legal_Name || '',
Legal_Name: creator.Legal_Name || '',
Categories: creator.Categories || '',
Languages: creator.Languages || '',
Creator_Email: creator.Email || '',
Creator_Phone: creator.Phone || '',
Creator_LINE_ID: creator.LINE_ID || '',
Source_Status: creator.Source_Status || '',
Source_PIC: creator.Source_PIC || '',
Date_Added: creator.Created_At || account.Created_At || '',
Title: creator.Title || '',
ID_No: creator.ID_No || '',
Date_Of_Issue: creator.Date_Of_Issue || '',
Permanent_Address: creator.Permanent_Address || '',
Bank_Account: creator.Bank_Account || '',
Bank_Name: creator.Bank_Name || '',
});
}
function sanitizeDatabaseAccountView_(row) {
const safe = mergeObjects_({}, row || {});
[
'Contact_Channel', 'Contact_Value', 'Creator_Email', 'Creator_Phone', 'Creator_LINE_ID', 'Source_PIC',
'Title', 'Legal_Name', 'ID_No', 'Date_Of_Issue', 'Permanent_Address', 'Bank_Account', 'Bank_Name',
].forEach(function (field) { delete safe[field]; });
if (Array.isArray(safe.Platforms_List)) {
safe.Platforms_List = safe.Platforms_List.map(sanitizePlatformEntry_);
}
// Other_Platforms (các account cùng creator, do searchAccounts gắn vào ở trên)
// trước đây KHÔNG được lọc, nên mọi creator có từ 2 account trở lên sẽ lộ
// Contact_Channel/Contact_Value — số điện thoại/email/LINE/Zalo thật — đúng thứ
// hàm này sinh ra để che. Tab Picks của Marketing luôn gửi groupByCreator: true.
if (Array.isArray(safe.Other_Platforms)) {
safe.Other_Platforms = safe.Other_Platforms.map(sanitizePlatformEntry_);
}
return safe;
}
// Marketing ĐƯỢC đọc số liệu chi phí — chủ project quyết định 2026-07-30: họ cần
// xem chi phí từng KOL và tổng chi phí campaign để quản lý ngân sách dự án. Nên các
// field tiền (Quoted_Fee, Final_Fee, Code_Ad_Fee, Tax, Service_Fee, After_PIT_Fee /
// Gross_Amount, Fee_VND), campaign.Budget, và metrics committed/pipelineTotal/
// remaining đều GIỮ NGUYÊN, cùng Contract_Status và Payment_Status.
//
// Điều Marketing KHÔNG được nhận là bản thân CHỨNG TỪ và phần ghi chú quanh nó:
// link Doc/PDF hợp đồng, link invoice, notes pháp lý/tài chính, và email chủ sở hữu
// chứng từ. Lọc ở BACKEND, không phải ẩn trên UI — trước đây client che bằng
// canManageCampaignWorkspace() còn server vẫn gửi đủ, nên chỉ cần mở DevTools là
// thấy hết.
//
// Không đụng tới quyền GHI: Marketing vẫn không sửa được fee, contract hay payment
// (updateCampaignKol chỉ cho Notes, bulkUpdateCampaignKols chỉ cho Content_Status và
// Booking_Status='Approved', còn saveContractRecord/savePaymentRecord là Admin/Booking).
const MARKETING_HIDDEN_CONTRACT_FIELDS = Object.freeze([
'Contract_URL', 'Contract_PDF_URL', 'Folder_URL', 'Notes', 'Owner_Email',
]);
const MARKETING_HIDDEN_PAYMENT_FIELDS = Object.freeze([
'Invoice_URL', 'Notes', 'Owner_Email',
]);
function sanitizeDocumentRow_(row, hiddenFields) {
const safe = mergeObjects_(row || {}, {});
hiddenFields.forEach(function (field) { delete safe[field]; });
return safe;
}
/**
* Lọc payload workspace/campaign cho Marketing. Idempotent, nên gọi ở cả
* getCampaignDetail và getCampaignWorkspace đều an toàn.
* CHỈ đụng tới mảng lồng contracts/payments — số liệu chi phí giữ nguyên.
*/
function sanitizeCampaignFinancialsForMarketing_(payload) {
if (!payload || typeof payload !== 'object') return payload;
if (Array.isArray(payload.contracts)) {
payload.contracts = payload.contracts.map(function (row) {
return sanitizeDocumentRow_(row, MARKETING_HIDDEN_CONTRACT_FIELDS);
});
}
if (Array.isArray(payload.payments)) {
payload.payments = payload.payments.map(function (row) {
return sanitizeDocumentRow_(row, MARKETING_HIDDEN_PAYMENT_FIELDS);
});
}
return payload;
}
function sanitizePlatformEntry_(platform) {
platform = platform || {};
return {
Account_ID: platform.Account_ID,
Platform: platform.Platform,
Username: platform.Username,
Profile_URL: platform.Profile_URL,
Followers: platform.Followers,
Avg_Views: platform.Avg_Views,
Engagement_Rate: platform.Engagement_Rate,
Starting_Fee: platform.Starting_Fee,
Currency: platform.Currency,
App_Fit: platform.App_Fit,
};
}
function getShortlistDetail(shortlistId) {
const user = getCurrentUser_();
prefetchTables_(['SHORTLISTS', 'SHORTLIST_KOLS', 'ACCOUNTS', 'CREATORS']);
const shortlist = findRecord_('SHORTLISTS', 'Shortlist_ID', shortlistId);
if (!shortlist) throw new Error('Shortlist not found.');
assertMarketAccess_(user, shortlist.Market);
const accounts = accountLookup_();
const creators = creatorLookup_();
const kols = readTable_('SHORTLIST_KOLS').filter(function(r) { return r.Shortlist_ID === shortlistId; }).map(function(r) {
const acc = accounts[r.Account_ID] || {};
const cre = creators[acc.Creator_ID] || {};
return mergeObjects_(r, {
Username: acc.Username || '',
Platform: acc.Platform || '',
Market: acc.Market || '',
Followers: acc.Followers || 0,
Starting_Fee: acc.Starting_Fee || 0,
Currency: acc.Currency || '',
Profile_URL: acc.Profile_URL || '',
Display_Name: cre.Display_Name || cre.Legal_Name || '',
Categories: cre.Categories || '',
Source_Status: cre.Source_Status || ''
});
});
// Trước đây hàm này chỉ kiểm tra market, nên bỏ qua cả hai hạn chế mà mọi chỗ
// khác đều áp cho Marketing: lọc Source_Status === 'Deal' và sanitize. Kết quả
// là Marketing đọc được shortlist do Booking sở hữu, kèm Source_Status thật
// ('Black List', "Can't contact"…). Áp lại đúng hành vi của searchAccounts.
const visibleKols = user.Role === 'Marketing'
? kols.filter(function (row) { return normalizeSourceStatus_(row.Source_Status) === 'Deal'; })
.map(sanitizeDatabaseAccountView_)
: kols;
return publicValue_({ shortlist: shortlist, kols: visibleKols });
}
