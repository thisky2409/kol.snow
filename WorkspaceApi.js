/**
* KOL Campaign Manager v1.5.0 — Campaign Workspace API
* Uses the existing v1.3.x schema and helpers from Setup.gs / Code.gs.
*/
function getCampaignWorkspace(campaignId) {
const syncUser = getCurrentUser_();
prefetchTables_(['CAMPAIGNS', 'CAMPAIGN_KOLS', 'ACCOUNTS', 'CREATORS', 'DELIVERABLES', 'CONTRACTS', 'PAYMENTS', 'CONTENT_FEEDBACK']);
const syncCampaign = findRecord_('CAMPAIGNS', 'Campaign_ID', campaignId);
if (syncCampaign && ['Admin', 'Booking'].indexOf(syncUser.Role) >= 0) {
const confirmedForSync = readTable_('CAMPAIGN_KOLS').filter(function (row) {
return row.Campaign_ID === campaignId && row.Booking_Status === 'Confirmed';
});
ensureDeliverablesForCampaignKols_(confirmedForSync, syncCampaign);
}
const base = getCampaignDetail(campaignId);
const accounts = accountLookup_();
const creators = creatorLookup_();
const campaignKols = indexBy_(readTable_('CAMPAIGN_KOLS'), 'Campaign_KOL_ID');
const today = startOfToday_(new Date());
const feedbackByDeliverable = {};
readOptionalWorkspaceTable_('CONTENT_FEEDBACK').forEach(function (feedback) {
if (feedback.Campaign_ID !== campaignId) return;
if (!feedbackByDeliverable[feedback.Deliverable_ID]) feedbackByDeliverable[feedback.Deliverable_ID] = [];
feedbackByDeliverable[feedback.Deliverable_ID].push(feedback);
});
Object.keys(feedbackByDeliverable).forEach(function (deliverableId) {
feedbackByDeliverable[deliverableId].sort(function (a, b) {
return toNumber_(a.Round) - toNumber_(b.Round);
});
});
base.deliverables = base.deliverables.map(function (row) {
const account = accounts[row.Account_ID] || {};
const creator = creators[account.Creator_ID] || {};
const feedback = feedbackByDeliverable[row.Deliverable_ID] || [];
return mergeObjects_(row, {
Username: account.Username || '',
Display_Name: creator.Display_Name || creator.Legal_Name || '',
Feedback_History: feedback,
Feedback_Count: feedback.length,
Latest_Feedback: feedback.length ? feedback[feedback.length - 1].Feedback : '',
});
});
base.contracts = base.contracts.map(function (row) {
const campaignKol = campaignKols[row.Campaign_KOL_ID] || {};
const account = accounts[campaignKol.Account_ID] || {};
const creator = creators[row.Creator_ID || campaignKol.Creator_ID || account.Creator_ID] || {};
return mergeObjects_(row, {
Account_ID: campaignKol.Account_ID || '',
Username: account.Username || '',
Display_Name: creator.Display_Name || creator.Legal_Name || '',
});
});
base.feedback = Object.keys(feedbackByDeliverable).reduce(function (items, deliverableId) {
return items.concat(feedbackByDeliverable[deliverableId]);
}, []);
base.payments = base.payments.map(function (row) {
const campaignKol = campaignKols[row.Campaign_KOL_ID] || {};
const account = accounts[campaignKol.Account_ID] || {};
const creator = creators[row.Creator_ID || campaignKol.Creator_ID || account.Creator_ID] || {};
return mergeObjects_(row, {
Account_ID: campaignKol.Account_ID || '',
Username: account.Username || '',
Display_Name: creator.Display_Name || creator.Legal_Name || '',
});
});
base.metrics.missingContracts = base.campaignKols.filter(function (row) {
return row.Booking_Status === 'Confirmed' && row.Contract_Status !== 'Signed';
}).length;
base.metrics.overdueDeliverables = base.deliverables.filter(function (row) {
const due = parseDate_(row.Draft_Due || row.Posting_Date);
return due && due < today && row.Content_Status !== 'Posted';
}).length;
const paymentStatusByCampaignKol = {};
base.payments.forEach(function (row) {
paymentStatusByCampaignKol[row.Campaign_KOL_ID] = row.Payment_Status;
});
base.metrics.pendingPayments = base.campaignKols.filter(function (row) {
if (row.Booking_Status !== 'Confirmed') return false;
const status = paymentStatusByCampaignKol[row.Campaign_KOL_ID] || row.Payment_Status || 'Not started';
return status !== 'Paid' && status !== 'Cancelled';
}).length;
// Lọc lại ở ĐÂY nữa, dù getCampaignDetail đã lọc: khối trên vừa map lại
// base.contracts và base.payments, và một lần sửa sau này ở đó có thể vô tình đưa
// field chứng từ trở lại. Hàm lọc là idempotent nên gọi hai lần không tốn gì.
if (syncUser.Role === 'Marketing') sanitizeCampaignFinancialsForMarketing_(base);
base.lists = {
campaignStatuses: LISTS.CAMPAIGN_STATUSES,
bookingStatuses: LISTS.BOOKING_STATUSES,
contractStatuses: LISTS.CONTRACT_STATUSES,
contentStatuses: LISTS.CONTENT_STATUSES,
paymentStatuses: LISTS.PAYMENT_STATUSES,
kolRoles: LISTS.KOL_ROLES,
platforms: LISTS.PLATFORMS,
currencies: LISTS.CURRENCIES,
};
return publicValue_(base);
}

/**
* Lightweight near-realtime endpoint for an open campaign.
* If nothing changed, only a revision token is returned. If data changed, the
* latest workspace is returned in the same request so the browser does not need
* a second round trip or a full-page reload.
*/
function getCampaignWorkspaceSync(payload) {
payload = payload || {};
getCurrentUser_();
const knownRevision = cleanText_(payload.revision);
const currentRevision = getDataRevision_();
if (knownRevision && knownRevision === currentRevision) {
return {
changed: false,
revision: currentRevision,
workspace: null,
};
}
const campaignId = cleanText_(payload.campaignId);
if (!campaignId) throw new Error('Campaign_ID is required.');
const workspace = getCampaignWorkspace(campaignId);
return {
changed: true,
revision: getDataRevision_(),
workspace: workspace,
};
}

/**
* Operations-ready contract data. Contracts, generation candidates and post
* performance are resolved from the same campaign/KOL records so the UI never
* needs a second manually maintained contract list.
*/
function getContractOperationsData(payload) {
const user = requireRole_(['Admin', 'Booking']);
prefetchTables_(['CAMPAIGNS', 'CAMPAIGN_KOLS', 'ACCOUNTS', 'CREATORS', 'CONTRACTS', 'ACCEPTANCES']);
const campaigns = listCampaigns_(user).filter(function (campaign) {
return normalizeMarket_(campaign.Market) === 'VN';
});
const visibleCampaignIds = {};
campaigns.forEach(function (campaign) { visibleCampaignIds[campaign.Campaign_ID] = true; });
const campaignIndex = indexBy_(campaigns, 'Campaign_ID');
const accounts = accountLookup_();
const creators = creatorLookup_();
const campaignKols = readTable_('CAMPAIGN_KOLS').filter(function (row) {
return Boolean(visibleCampaignIds[row.Campaign_ID]);
});
const campaignKolIndex = indexBy_(campaignKols, 'Campaign_KOL_ID');
const deliverablesByCampaignKol = {};
readTable_('DELIVERABLES').forEach(function (row) {
if (!visibleCampaignIds[row.Campaign_ID]) return;
if (!deliverablesByCampaignKol[row.Campaign_KOL_ID]) deliverablesByCampaignKol[row.Campaign_KOL_ID] = [];
deliverablesByCampaignKol[row.Campaign_KOL_ID].push(row);
});
const contractRows = readTable_('CONTRACTS').filter(function (row) {
return Boolean(visibleCampaignIds[row.Campaign_ID]);
});
const contractedCampaignKols = {};
contractRows.forEach(function (row) { contractedCampaignKols[row.Campaign_KOL_ID] = true; });
const contracts = contractRows.map(function (row) {
const campaignKol = campaignKolIndex[row.Campaign_KOL_ID] || {};
const account = accounts[campaignKol.Account_ID] || {};
const creator = creators[row.Creator_ID || campaignKol.Creator_ID || account.Creator_ID] || {};
const campaign = campaignIndex[row.Campaign_ID] || {};
const performance = deliverablesByCampaignKol[row.Campaign_KOL_ID] || [];
return mergeObjects_(row, {
Campaign_Name: campaign.Campaign_Name || '',
App: campaign.App || '',
Market: campaign.Market || '',
Account_ID: campaignKol.Account_ID || '',
Username: account.Username || '',
Platform: account.Platform || '',
Display_Name: creator.Display_Name || creator.Legal_Name || '',
Performance: performance,
Performance_Summary: summarizePerformanceRows_(performance),
});
}).reverse();
// Phân trang giống getOperations (F22) — trước đây cắt cứng 500 dòng và không nói ra.
const contractPage = operationsPageOf_(contracts, payload);
const candidates = campaignKols.filter(function (row) {
const fee = campaignKolNetAmount_(row);
return row.Booking_Status === 'Confirmed' && fee > 0 && !contractedCampaignKols[row.Campaign_KOL_ID];
}).map(function (row) {
const account = accounts[row.Account_ID] || {};
const creator = creators[row.Creator_ID || account.Creator_ID] || {};
const campaign = campaignIndex[row.Campaign_ID] || {};
const missing = CONTRACT_REQUIRED_CREATOR_FIELDS.filter(function (field) {
return !cleanText_(creator[field]);
});
return {
Campaign_KOL_ID: row.Campaign_KOL_ID,
Campaign_ID: row.Campaign_ID,
Campaign_Name: campaign.Campaign_Name || '',
App: campaign.App || '',
Market: campaign.Market || '',
Creator_ID: creator.Creator_ID || '',
Display_Name: creator.Display_Name || creator.Legal_Name || account.Username || '',
Username: account.Username || '',
Platform: account.Platform || '',
Fee: campaignKolNetAmount_(row),
Currency: row.Currency || campaign.Currency || '',
Ready: missing.length === 0,
Missing_Fields: missing,
};
});
return publicValue_({
contracts: contractPage.rows,
contractsTotal: contractPage.total,
offset: contractPage.offset,
pageSize: contractPage.pageSize,
candidates: candidates,
market: 'VN',
});
}

/**
* Cross-campaign performance view. Marketing can read it because it only
* contains campaign/post metrics for campaigns already assigned to that user.
*/
function getPerformanceOverview() {
const user = requireRole_(['Admin', 'Booking', 'Marketing']);
// Dat NGAY sau buoc kiem quyen de gom duoc ca CAMPAIGNS + CAMPAIGN_KOLS.
// Neu de xuong duoi thi listCampaigns_ va dong indexBy_(readTable_(...)) da doc
// le hai bang do roi, nen chung khong con nam trong lo nua.
prefetchTables_(['CAMPAIGNS', 'CAMPAIGN_KOLS', 'ACCOUNTS', 'CREATORS', 'DELIVERABLES']);
const campaigns = listCampaigns_(user);
const visibleCampaignIds = {};
campaigns.forEach(function (campaign) { visibleCampaignIds[campaign.Campaign_ID] = true; });
const campaignIndex = indexBy_(campaigns, 'Campaign_ID');
const campaignKols = indexBy_(readTable_('CAMPAIGN_KOLS'), 'Campaign_KOL_ID');
const accounts = accountLookup_();
const creators = creatorLookup_();
const rows = readTable_('DELIVERABLES').filter(function (row) {
return Boolean(visibleCampaignIds[row.Campaign_ID]);
}).map(function (row) {
const campaign = campaignIndex[row.Campaign_ID] || {};
const campaignKol = campaignKols[row.Campaign_KOL_ID] || {};
const account = accounts[row.Account_ID || campaignKol.Account_ID] || {};
const creator = creators[campaignKol.Creator_ID || account.Creator_ID] || {};
return mergeObjects_(row, {
Campaign_Name: campaign.Campaign_Name || '',
App: campaign.App || '',
Market: campaign.Market || '',
Username: account.Username || '',
Display_Name: creator.Display_Name || creator.Legal_Name || account.Username || '',
Engagement_Rate: calculatePerformanceRate_(row),
});
}).sort(function (a, b) {
return String(b.Posting_Date || b.Updated_At || '').localeCompare(String(a.Posting_Date || a.Updated_At || ''));
});
const campaignsSummary = {};
rows.forEach(function (row) {
if (!campaignsSummary[row.Campaign_ID]) {
campaignsSummary[row.Campaign_ID] = {
Campaign_ID: row.Campaign_ID,
Campaign_Name: row.Campaign_Name,
App: row.App,
Market: row.Market,
Rows: [],
};
}
campaignsSummary[row.Campaign_ID].Rows.push(row);
});
const campaignGroups = Object.keys(campaignsSummary).map(function (campaignId) {
const group = campaignsSummary[campaignId];
group.Summary = summarizePerformanceRows_(group.Rows);
delete group.Rows;
return group;
}).sort(function (a, b) {
return String(a.App + a.Campaign_Name).localeCompare(String(b.App + b.Campaign_Name));
});
return publicValue_({ rows: rows, summary: summarizePerformanceRows_(rows), campaigns: campaignGroups });
}

function summarizePerformanceRows_(rows) {
const summary = { Posts: rows.length, Live_Posts: 0, Views: 0, Likes: 0, Comments: 0, Reposts: 0, Shares: 0, Saves: 0, Engagements: 0, Engagement_Rate: 0, Updated_At: '' };
rows.forEach(function (row) {
if (row.Post_URL || row.Content_Status === 'Posted') summary.Live_Posts += 1;
summary.Views += toNumber_(row.Views);
summary.Likes += toNumber_(row.Likes);
summary.Comments += toNumber_(row.Comments);
summary.Reposts += toNumber_(row.Reposts);
summary.Shares += toNumber_(row.Shares);
summary.Saves += toNumber_(row.Saves);
const updated = cleanText_(row.Performance_Updated_At || row.Updated_At);
if (updated > summary.Updated_At) summary.Updated_At = updated;
});
summary.Engagements = summary.Likes + summary.Comments + summary.Reposts + summary.Shares + summary.Saves;
summary.Engagement_Rate = summary.Views ? summary.Engagements / summary.Views * 100 : 0;
return summary;
}

function calculatePerformanceRate_(row) {
const views = toNumber_(row.Views);
if (!views) return 0;
return (toNumber_(row.Likes) + toNumber_(row.Comments) + toNumber_(row.Reposts) + toNumber_(row.Shares) + toNumber_(row.Saves)) / views * 100;
}

function updateCampaign(payload) {
const user = requireRole_(['Admin', 'Booking']);
payload = payload || {};
const campaignId = cleanText_(payload.Campaign_ID);
if (!campaignId) throw new Error('Campaign_ID is required.');
const campaign = findRecord_('CAMPAIGNS', 'Campaign_ID', campaignId);
if (!campaign) throw new Error('Campaign not found.');
assertCampaignAccess_(user, campaign);
const changes = {};
const textFields = ['Campaign_Name', 'App', 'Objective', 'Start_Date', 'End_Date', 'Posting_Start', 'Posting_End', 'Currency', 'Status', 'Owner_Email', 'Brief_URL', 'Notes'];
textFields.forEach(function (field) {
if (Object.prototype.hasOwnProperty.call(payload, field)) changes[field] = cleanText_(payload[field]);
});
if (Object.prototype.hasOwnProperty.call(payload, 'Target_KOLs')) changes.Target_KOLs = Math.max(1, Math.round(toNumber_(payload.Target_KOLs)));
if (Object.prototype.hasOwnProperty.call(payload, 'Budget')) changes.Budget = Math.max(0, toNumber_(payload.Budget));
if (Object.prototype.hasOwnProperty.call(payload, 'Assigned_Marketing')) changes.Assigned_Marketing = normalizeEmailList_(payload.Assigned_Marketing);
if (Object.prototype.hasOwnProperty.call(payload, 'Platforms')) {
const platforms = normalizePlatforms_(payload.Platforms);
if (!platforms.length) throw new Error('Select at least one platform.');
changes.Platforms = platforms.join(', ');
}
const merged = mergeObjects_(campaign, changes);
if (!cleanText_(merged.Campaign_Name)) throw new Error('Enter a campaign name.');
if (!cleanText_(merged.App)) throw new Error('Select an app.');
if (changes.Status && LISTS.CAMPAIGN_STATUSES.indexOf(changes.Status) === -1) throw new Error('Invalid campaign status.');
validateCampaignDates_(merged);
changes.Updated_At = new Date();
return withDocumentLock_(function () {
const updated = updateRecord_('CAMPAIGNS', 'Campaign_ID', campaignId, changes);
logActivity_(user.Email, 'UPDATE', 'CAMPAIGN', campaignId, JSON.stringify(changes));
return publicValue_(updated);
});
}
function bulkUpdateCampaignKols(payload) {
const user = requireRole_(['Admin', 'Booking', 'Marketing']);
payload = payload || {};
const ids = uniqueWorkspaceText_((Array.isArray(payload.ids) ? payload.ids : String(payload.ids || '').split(',')).map(cleanText_).filter(String));
if (!ids.length) throw new Error('Select at least one Campaign KOL.');
const field = cleanText_(payload.field);
const value = cleanText_(payload.value);
const validators = {
Booking_Status: LISTS.BOOKING_STATUSES,
Contract_Status: LISTS.CONTRACT_STATUSES,
Content_Status: LISTS.CONTENT_STATUSES,
Payment_Status: LISTS.PAYMENT_STATUSES,
Role: LISTS.KOL_ROLES,
};
if (!validators[field]) throw new Error('This field cannot be updated in bulk.');
if (user.Role === 'Marketing' &&
field !== 'Content_Status' &&
!(field === 'Booking_Status' && value === 'Approved')) {
throw new Error('The Marketing team can update Content status and approve Campaign KOLs.');
}
if (validators[field].indexOf(value) === -1) throw new Error('Invalid status value.');
const rows = indexBy_(readTable_('CAMPAIGN_KOLS'), 'Campaign_KOL_ID');
const campaigns = indexBy_(readTable_('CAMPAIGNS'), 'Campaign_ID');
ids.forEach(function (id) {
const row = rows[id];
if (!row) throw new Error('Campaign KOL not found: ' + id);
const campaign = campaigns[row.Campaign_ID] || {};
assertCampaignAccess_(user, campaign);
});
return withDocumentLock_(function () {
const changesById = {};
ids.forEach(function (id) {
const changes = { Updated_At: new Date() };
changes[field] = value;
changesById[id] = changes;
});
const updatedById = updateRecordsById_('CAMPAIGN_KOLS', 'Campaign_KOL_ID', changesById);
const confirmedRows = ids.map(function (id) { return updatedById[id]; }).filter(function (row) {
return row && row.Booking_Status === 'Confirmed';
});
const generated = [];
const byCampaign = {};
confirmedRows.forEach(function (row) {
if (!byCampaign[row.Campaign_ID]) byCampaign[row.Campaign_ID] = [];
byCampaign[row.Campaign_ID].push(row);
});
Object.keys(byCampaign).forEach(function (campaignId) {
generated.push.apply(generated, ensureDeliverablesForCampaignKols_(byCampaign[campaignId], campaigns[campaignId] || {}));
});
logActivity_(user.Email, 'BULK_UPDATE', 'CAMPAIGN_KOL', ids.join(','), field + '=' + value);
return publicValue_({ updated: ids.length, records: updatedById, deliverables: generated });
});
}

function updateCampaignKolFee(payload) {
const user = requireRole_(['Admin', 'Booking']);
payload = payload || {};
const campaignKol = getAuthorizedCampaignKol_(user, payload.Campaign_KOL_ID);
const campaign = findRecord_('CAMPAIGNS', 'Campaign_ID', campaignKol.Campaign_ID) || {};
const finalFee = Math.max(0, toNumber_(payload.Final_Fee));
// Phải nằm trong lock như mọi hàm ghi khác. updateRecord_ ghi lại TOÀN BỘ dòng,
// nên nếu hàm này chạy song song với updateCampaignKol thì một bên sẽ ghi đè cột
// của bên kia — mất Final_Fee mới mà vẫn giữ After_PIT_Fee cũ, làm Net và Gross
// lệch nhau vĩnh viễn trong tính budget và trong hợp đồng.
return withDocumentLock_(function () {
invalidateTableCache_('CAMPAIGN_KOLS');
const fresh = findRecord_('CAMPAIGN_KOLS', 'Campaign_KOL_ID', campaignKol.Campaign_KOL_ID) || campaignKol;
const changes = {
Final_Fee: finalFee,
Updated_At: new Date(),
};
if (normalizeMarket_(campaign.Market) === 'VN') {
changes.After_PIT_Fee = campaignKolGrossAmount_(mergeObjects_(fresh, changes));
}
const updated = updateRecord_('CAMPAIGN_KOLS', 'Campaign_KOL_ID', campaignKol.Campaign_KOL_ID, changes);
updated.Fee_VND = feeToVnd_(finalFee, updated.Currency, getFxRates_());
if (normalizeMarket_(campaign.Market) === 'VN') updated.Gross_Amount = updated.After_PIT_Fee;
logActivity_(user.Email, 'UPDATE_FEE', 'CAMPAIGN_KOL', campaignKol.Campaign_KOL_ID, String(finalFee));
return publicValue_(updated);
});
}

function addContentFeedback(payload) {
const user = requireRole_(['Admin', 'Booking', 'Marketing']);
payload = payload || {};
const deliverableId = cleanText_(payload.Deliverable_ID);
const message = cleanText_(payload.Feedback);
if (!deliverableId) throw new Error('Deliverable_ID is required.');
if (!message) throw new Error('Please enter feedback.');
const deliverable = findRecord_('DELIVERABLES', 'Deliverable_ID', deliverableId);
if (!deliverable) throw new Error('Deliverable not found.');
const campaignKol = getAuthorizedCampaignKol_(user, deliverable.Campaign_KOL_ID);
const campaign = findRecord_('CAMPAIGNS', 'Campaign_ID', deliverable.Campaign_ID) || {};
const recipient = cleanText_(campaignKol.PIC_Email || campaign.Owner_Email);
return withDocumentLock_(function () {
const existing = readOptionalWorkspaceTable_('CONTENT_FEEDBACK').filter(function (row) {
return row.Deliverable_ID === deliverableId;
});
const round = existing.reduce(function (maxRound, row) {
return Math.max(maxRound, toNumber_(row.Round));
}, 0) + 1;
const now = new Date();
const record = {
Feedback_ID: makeId_('FBK'),
Deliverable_ID: deliverableId,
Campaign_KOL_ID: deliverable.Campaign_KOL_ID,
Campaign_ID: deliverable.Campaign_ID,
Round: round,
Feedback: message,
Created_By: user.Email,
Notified_To: recipient,
Created_At: now,
};
appendRecord_('CONTENT_FEEDBACK', record);
updateRecord_('DELIVERABLES', 'Deliverable_ID', deliverableId, {
Revision_Round: round,
Content_Status: 'Need edit',
Updated_At: now,
});
updateRecord_('CAMPAIGN_KOLS', 'Campaign_KOL_ID', deliverable.Campaign_KOL_ID, {
Content_Status: 'Need edit',
Updated_At: now,
});
if (recipient) {
createNotification_(recipient, {
Type: 'Content feedback',
Title: 'Round ' + round + ' feedback · ' + (campaign.Campaign_Name || deliverable.Campaign_ID),
Message: message,
Campaign_ID: deliverable.Campaign_ID,
Entity_ID: deliverableId,
Action_URL: '',
});
}
logActivity_(user.Email, 'ADD_FEEDBACK', 'DELIVERABLE', deliverableId, 'Round ' + round + ' · ' + recipient);
return publicValue_({
feedback: record,
Content_Status: 'Need edit',
Revision_Round: round,
});
});
}
function sendContentFeedbackEmail(payload) {
const user = requireRole_(['Admin', 'Booking', 'Marketing']);
payload = payload || {};
const feedbackId = cleanText_(payload.Feedback_ID);
const feedback = findRecord_('CONTENT_FEEDBACK', 'Feedback_ID', feedbackId);
if (!feedback) return { sent: false };
const deliverable = findRecord_('DELIVERABLES', 'Deliverable_ID', feedback.Deliverable_ID);
if (!deliverable) return { sent: false };
getAuthorizedCampaignKol_(user, deliverable.Campaign_KOL_ID);
const campaign = findRecord_('CAMPAIGNS', 'Campaign_ID', deliverable.Campaign_ID) || {};
const recipient = cleanText_(feedback.Notified_To);
if (!recipient) return { sent: false };
sendFeedbackEmail_(recipient, campaign, deliverable, feedback.Round, feedback.Feedback, feedback.Created_By);
return { sent: true };
}

function saveDeliverable(payload) {
const user = requireRole_(['Admin', 'Booking', 'Marketing']);
payload = payload || {};
const id = cleanText_(payload.Deliverable_ID);
const campaignKol = getAuthorizedCampaignKol_(user, payload.Campaign_KOL_ID);
const campaign = findRecord_('CAMPAIGNS', 'Campaign_ID', campaignKol.Campaign_ID);
const account = findRecord_('ACCOUNTS', 'Account_ID', campaignKol.Account_ID) || {};
const existing = id ? findRecord_('DELIVERABLES', 'Deliverable_ID', id) : null;
const allowed = ['Type', 'Platform', 'Brief_URL', 'Draft_Due', 'Draft_Submitted_At', 'Draft_URL', 'Revision_Round', 'Content_Status', 'Approved_At', 'Posting_Date', 'Post_URL', 'Views', 'Likes', 'Comments', 'Reposts', 'Shares', 'Saves'];
const changes = {};
allowed.forEach(function (field) {
if (Object.prototype.hasOwnProperty.call(payload, field)) changes[field] = payload[field];
});
changes.Type = cleanText_(changes.Type) || cleanText_(account.Platform) + ' post';
changes.Platform = cleanText_(changes.Platform) || cleanText_(account.Platform);
changes.Content_Status = cleanText_(changes.Content_Status) || cleanText_(existing && existing.Content_Status) || 'Not started';
['Brief_URL', 'Draft_Due', 'Draft_Submitted_At', 'Draft_URL', 'Approved_At', 'Posting_Date', 'Post_URL'].forEach(function (field) {
if (Object.prototype.hasOwnProperty.call(changes, field)) changes[field] = cleanText_(changes[field]);
});
if (cleanText_(changes.Draft_URL) && changes.Content_Status === 'Not started') {
changes.Content_Status = 'Draft submitted';
}
const draftUrlChanged = cleanText_(changes.Draft_URL) && cleanText_(changes.Draft_URL) !== cleanText_(existing && existing.Draft_URL);
if (draftUrlChanged && !cleanText_(payload.Draft_Submitted_At)) {
changes.Draft_Submitted_At = new Date();
}
const previousPostUrl = cleanText_(existing && existing.Post_URL);
const hadPostUrl = Boolean(previousPostUrl);
// Chỉ xét giá trị HIỆU LỰC sau khi lưu. Trước đây dùng
// `changes.Post_URL || existing.Post_URL`, nên khi người dùng XOÁ một Post URL
// nhập sai thì '' bị coi là falsy và rơi về URL cũ: hệ thống vẫn ép trạng thái
// 'Posted', đóng lại dấu Post_Submitted_At, rồi ghi URL đã xoá trở lại
// CAMPAIGN_KOLS — nên không thể un-post một deliverable từ UI.
const postUrlSubmitted = Object.prototype.hasOwnProperty.call(payload, 'Post_URL');
const nextPostUrl = postUrlSubmitted ? cleanText_(changes.Post_URL) : previousPostUrl;
if (nextPostUrl) {
changes.Content_Status = 'Posted';
if (nextPostUrl !== previousPostUrl) {
changes.Post_Submitted_At = new Date();
}
if (!Object.prototype.hasOwnProperty.call(payload, 'Posting_Date') && !hadPostUrl) {
changes.Posting_Date = Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM-dd');
}
} else if (postUrlSubmitted && hadPostUrl) {
// Vừa xoá Post URL: hạ trạng thái khỏi 'Posted' và bỏ dấu thời gian đăng, trừ
// khi người dùng chủ động chọn một trạng thái khác trong cùng lần lưu đó.
if (!cleanText_(payload.Content_Status) || changes.Content_Status === 'Posted') {
changes.Content_Status = cleanText_(changes.Draft_URL) ? 'Draft submitted' : 'Not started';
}
changes.Post_Submitted_At = '';
}
if (LISTS.CONTENT_STATUSES.indexOf(changes.Content_Status) === -1) throw new Error('Invalid content status.');
['Revision_Round', 'Views', 'Likes', 'Comments', 'Reposts', 'Shares', 'Saves'].forEach(function (field) {
if (Object.prototype.hasOwnProperty.call(changes, field)) changes[field] = Math.max(0, toNumber_(changes[field]));
});
changes.Updated_At = new Date();
return withDocumentLock_(function () {
let saved;
if (id) {
if (!existing || existing.Campaign_ID !== campaign.Campaign_ID) throw new Error('Deliverable not found.');
changes.Campaign_KOL_ID = campaignKol.Campaign_KOL_ID;
changes.Account_ID = campaignKol.Account_ID;
saved = updateRecord_('DELIVERABLES', 'Deliverable_ID', id, changes);
} else {
saved = mergeObjects_({
Deliverable_ID: makeId_('DLV'),
Campaign_KOL_ID: campaignKol.Campaign_KOL_ID,
Campaign_ID: campaign.Campaign_ID,
Account_ID: campaignKol.Account_ID,
}, changes);
appendRecord_('DELIVERABLES', saved);
}
// Chỉ xoá Post_URL trên CAMPAIGN_KOLS khi nó đang trỏ đúng URL vừa bị bỏ. Một
// campaign KOL có thể có nhiều deliverable ở nhiều platform, nên xoá vô điều kiện
// sẽ làm mất link do deliverable khác đặt.
const clearedThisPostUrl = postUrlSubmitted && hadPostUrl && !cleanText_(saved.Post_URL)
&& cleanText_(campaignKol.Post_URL) === previousPostUrl;
updateRecord_('CAMPAIGN_KOLS', 'Campaign_KOL_ID', campaignKol.Campaign_KOL_ID, {
Content_Status: saved.Content_Status,
Posting_Date: saved.Posting_Date || campaignKol.Posting_Date,
Post_URL: clearedThisPostUrl ? '' : (saved.Post_URL || campaignKol.Post_URL),
Updated_At: new Date(),
});
logActivity_(user.Email, id ? 'UPDATE' : 'CREATE', 'DELIVERABLE', saved.Deliverable_ID, saved.Type);
return publicValue_(saved);
});
}
/**
* Lấy view/like/comment... trực tiếp từ TikTok mà KHÔNG cần trình duyệt/tool
* Python. Cách làm: TikTok nhúng sẵn dữ liệu bài viết dưới dạng JSON ngay
* trong HTML của trang (để trang tải nhanh hơn), nên chỉ cần tải HTML về và
* đọc JSON đó ra — không cần chạy JavaScript như Playwright.
*
* LƯU Ý QUAN TRỌNG: TikTok có hệ thống chống bot dựa theo uy tín của địa chỉ
* IP gọi tới. Vì Apps Script luôn gọi từ dải IP của Google (rất dễ bị nhận
* diện), tính năng này có thể lúc chạy được lúc không, và có thể ngừng hoạt
* động bất cứ lúc nào nếu TikTok thay đổi cách chống bot — đây không phải lỗi
* trong code mà là giới hạn thực tế. Nếu bị chặn, dùng post_tracker.py rồi
* import CSV (importPerformanceCsv) làm phương án chắc chắn hơn.
* Instagram/Threads KHÔNG áp dụng được cách này vì 2 nền tảng đó yêu cầu đăng
* nhập để xem số liệu, không có cách nào đọc được nếu không có browser thật.
*/
// ĐÃ NGHỈ HƯU (2026-07-30, F13) — dấu gạch dưới cuối tên là tín hiệu DUY NHẤT
// đáng tin để một global không gọi được từ client. Bản thay thế là
// fetchDeliverablePerformanceV2 trong PerformanceAuto.gs, và UI đã trỏ sang đó.
// Vì sao phải rút khỏi tầm với của client: hàm này ghi thẳng kết quả của
// fetchTikTokMetrics_ mà không đi qua perfParseMetricValue_, nên khi TikTok đổi
// cấu trúc stats (trang vẫn trả HTTP 200, stats thành {}) thì cả 5 chỉ số bị ghi
// 0 đè lên số liệu thật. Giữ lại để chạy tay từ editor, không xoá.
function fetchDeliverablePerformance_(payload) {
const user = requireRole_(['Admin', 'Booking', 'Marketing']);
payload = payload || {};
const deliverableId = cleanText_(payload.Deliverable_ID);
const deliverable = findRecord_('DELIVERABLES', 'Deliverable_ID', deliverableId);
if (!deliverable) throw new Error('Deliverable not found.');
const campaignKol = getAuthorizedCampaignKol_(user, deliverable.Campaign_KOL_ID);
void campaignKol;
const url = cleanText_(deliverable.Post_URL);
if (!url) throw new Error('This deliverable does not have a Post URL yet.');
const platform = cleanText_(deliverable.Platform).toLowerCase();
if (platform !== 'tiktok') {
throw new Error('Automatic performance fetching currently supports TikTok only. Instagram and Threads block access without a real browser. Use post_tracker.py and import the CSV instead.');
}
const metrics = fetchTikTokMetrics_(url);
return withDocumentLock_(function () {
const changes = {
Views: metrics.Views, Likes: metrics.Likes, Comments: metrics.Comments,
Shares: metrics.Shares, Saves: metrics.Saves,
Performance_Updated_At: new Date(), Performance_Source: 'TikTok direct scan',
Updated_At: new Date(),
};
updateRecord_('DELIVERABLES', 'Deliverable_ID', deliverableId, changes);
logActivity_(user.Email, 'FETCH_PERFORMANCE', 'DELIVERABLE', deliverableId, 'TikTok auto-fetch');
return publicValue_({ success: true, metrics: changes });
});
}

/**
* Best-effort batch scan for TikTok posts visible to the current user.
* The batch is intentionally capped to keep one Apps Script execution within
* its runtime quota; the Performance screen reports failed URLs individually.
*/
// ĐÃ NGHỈ HƯU (2026-07-30, F13) — xem ghi chú ở fetchDeliverablePerformance_.
// Bản thay thế: scanPerformanceAll. Hàm này còn tệ hơn: nó gọi updateRecord_ trong
// vòng lặp tới 50 deliverable mà KHÔNG lấy lock lần nào.
function scanTikTokPerformance_(payload) {
const user = requireRole_(['Admin', 'Booking', 'Marketing']);
const campaigns = listCampaigns_(user);
const visibleCampaignIds = {};
campaigns.forEach(function (campaign) { visibleCampaignIds[campaign.Campaign_ID] = true; });
const limit = Math.min(50, Math.max(1, Math.round(toNumber_(payload && payload.limit) || 25)));
const campaignId = cleanText_(payload && payload.Campaign_ID);
if (campaignId && !visibleCampaignIds[campaignId]) throw new Error('Campaign is not available to this user.');
const targets = readTable_('DELIVERABLES').filter(function (row) {
return visibleCampaignIds[row.Campaign_ID] &&
(!campaignId || row.Campaign_ID === campaignId) &&
cleanText_(row.Platform).toLowerCase() === 'tiktok' &&
Boolean(cleanText_(row.Post_URL));
}).slice(0, limit);
let updated = 0;
const failed = [];
targets.forEach(function (row) {
try {
const metrics = fetchTikTokMetrics_(row.Post_URL);
updateRecord_('DELIVERABLES', 'Deliverable_ID', row.Deliverable_ID, {
Views: metrics.Views,
Likes: metrics.Likes,
Comments: metrics.Comments,
Shares: metrics.Shares,
Saves: metrics.Saves,
Performance_Updated_At: new Date(),
Performance_Source: 'TikTok direct scan',
Updated_At: new Date(),
});
updated += 1;
} catch (error) {
failed.push({ Deliverable_ID: row.Deliverable_ID, Post_URL: row.Post_URL, Error: error.message || String(error) });
}
});
logActivity_(user.Email, 'SCAN_PERFORMANCE', 'DELIVERABLES', '', updated + ' updated; ' + failed.length + ' failed');
return publicValue_({ scanned: targets.length, updated: updated, failed: failed.slice(0, 10), hasMore: targets.length === limit });
}

function fetchTikTokMetrics_(url) {
const options = {
muteHttpExceptions: true,
followRedirects: true,
headers: {
'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
'Accept-Language': 'en-US,en;q=0.9',
},
};
let response;
try {
response = UrlFetchApp.fetch(url, options);
} catch (error) {
throw new Error('Could not connect to TikTok: ' + error.message);
}
const status = response.getResponseCode();
if (status !== 200) {
throw new Error('TikTok returned status ' + status + '. Google Apps Script may be blocked, or the link may be invalid or removed. Use post_tracker.py and import the CSV instead.');
}
const html = response.getContentText();
const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/) ||
html.match(/<script id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/);
if (!match) {
throw new Error('No performance data was found in the TikTok response. Bot protection is likely blocking the request. Use post_tracker.py and import the CSV instead.');
}
let data;
try {
data = JSON.parse(match[1]);
} catch (error) {
throw new Error('Could not read JSON data from the TikTok page.');
}
const scope = data.__DEFAULT_SCOPE__ && data.__DEFAULT_SCOPE__['webapp.video-detail'];
const item = (scope && scope.itemInfo && scope.itemInfo.itemStruct) ||
(data.ItemModule && Object.keys(data.ItemModule).length ? data.ItemModule[Object.keys(data.ItemModule)[0]] : null);
if (!item) throw new Error('Post information was not found in the TikTok data. The post may have been removed or made private.');
const stats = item.statsV2 || item.stats || {};
return {
Views: toNumber_(stats.playCount),
Likes: toNumber_(stats.diggCount),
Comments: toNumber_(stats.commentCount),
Shares: toNumber_(stats.shareCount),
Saves: toNumber_(stats.collectCount),
};
}
/**
* Nạp file CSV xuất ra từ post_tracker.py (Threads/Instagram/TikTok) — khớp
* theo Post URL (đã chuẩn hoá bỏ tracking parameter) để cập nhật hàng loạt
* Views/Likes/Comments/Shares/Saves vào đúng deliverable tương ứng.
*/
// ĐÃ NGHỈ HƯU (2026-07-30, F13) — bản thay thế: importPerformanceCsvV2, dùng
// perfApplyMetricRows_ nên có perfParseMetricValue_ chặn "N/A"/"private" thành 0.
function importPerformanceCsv_(payload) {
const user = requireRole_(['Admin', 'Booking', 'Marketing']);
payload = payload || {};
const csvText = String(payload.csvText || '');
if (!csvText.trim()) throw new Error('Paste or select CSV content first.');
let rows;
try {
rows = Utilities.parseCsv(csvText);
} catch (error) {
throw new Error('Could not read the CSV: ' + error.message);
}
if (rows.length < 2) throw new Error('The CSV is empty or contains only a header row.');
const headers = rows[0].map(function (h) { return cleanText_(h); });
const col = function (name) { return headers.indexOf(name); };
const urlIndex = col('URL');
if (urlIndex === -1) throw new Error('The CSV must include a "URL" column in the format exported by post_tracker.py.');
const metricCols = {
Views: col('Views'), Likes: col('Likes'), Comments: col('Comments'),
Reposts: col('Reposts'), Shares: col('Shares'), Saves: col('Saves'),
};
const visibleCampaignIds = {};
listCampaigns_(user).forEach(function (campaign) { visibleCampaignIds[campaign.Campaign_ID] = true; });
const deliverables = readTable_('DELIVERABLES').filter(function (row) {
return Boolean(visibleCampaignIds[row.Campaign_ID]);
});
const byUrl = {};
deliverables.forEach(function (row) {
const norm = normalizeDirectUrl_(row.Post_URL);
if (norm) byUrl[norm] = row;
});
return withDocumentLock_(function () {
let matched = 0;
const unmatchedUrls = [];
for (let i = 1; i < rows.length; i += 1) {
const cols = rows[i];
if (!cols.length || !cleanText_(cols[urlIndex])) continue;
const norm = normalizeDirectUrl_(cols[urlIndex]);
const target = byUrl[norm];
if (!target) { unmatchedUrls.push(cols[urlIndex]); continue; }
const changes = {
Updated_At: new Date(),
Performance_Updated_At: new Date(),
Performance_Source: 'Post Tracker CSV',
};
Object.keys(metricCols).forEach(function (field) {
const index = metricCols[field];
if (index >= 0 && cleanText_(cols[index]) !== '') changes[field] = toNumber_(cols[index]);
});
updateRecord_('DELIVERABLES', 'Deliverable_ID', target.Deliverable_ID, changes);
matched += 1;
}
logActivity_(user.Email, 'IMPORT_PERFORMANCE_CSV', 'DELIVERABLES', '', matched + ' matched, ' + unmatchedUrls.length + ' unmatched');
return publicValue_({ matched: matched, unmatched: unmatchedUrls.length, unmatchedUrls: unmatchedUrls.slice(0, 10) });
});
}
function generateCampaignDeliverables(payload) {
const user = requireRole_(['Admin', 'Booking']);
payload = payload || {};
const campaignId = cleanText_(payload.Campaign_ID);
const campaign = findRecord_('CAMPAIGNS', 'Campaign_ID', campaignId);
if (!campaign) throw new Error('Campaign not found.');
assertCampaignAccess_(user, campaign);
const campaignKols = readTable_('CAMPAIGN_KOLS').filter(function (row) {
return row.Campaign_ID === campaignId && row.Booking_Status === 'Confirmed';
});
return withDocumentLock_(function () {
const generated = ensureDeliverablesForCampaignKols_(campaignKols, campaign);
const created = generated.length;
const skipped = campaignKols.length - created;
logActivity_(user.Email, 'GENERATE', 'DELIVERABLE', campaignId, created + ' created; ' + skipped + ' skipped');
return publicValue_({ created: created, skipped: skipped, confirmed: campaignKols.length, records: generated });
});
}
// Trả về danh sách (campaignKol, platform) còn chưa có deliverable tương ứng.
function deliverablesMissingFor_(campaignKols) {
const accounts = accountLookup_();
const existing = {};
readTable_('DELIVERABLES').forEach(function (row) {
existing[row.Campaign_KOL_ID + '|' + cleanText_(row.Platform).toLowerCase()] = true;
});
const missing = [];
campaignKols.forEach(function (campaignKol) {
const account = accounts[campaignKol.Account_ID] || {};
const platform = cleanText_(account.Platform) || 'Other';
const key = campaignKol.Campaign_KOL_ID + '|' + platform.toLowerCase();
if (existing[key]) return;
existing[key] = true;
missing.push({ campaignKol: campaignKol, platform: platform });
});
return missing;
}
function ensureDeliverablesForCampaignKols_(campaignKols, campaign) {
campaignKols = (campaignKols || []).filter(Boolean);
if (!campaignKols.length) return [];
// Kiểm tra rẻ trước, dùng cache. getCampaignWorkspace được client poll mỗi 3 giây
// và hầu như lần nào cũng không có gì phải tạo, nên đường đi thông thường không
// được lấy lock hay xoá cache — làm vậy sẽ khiến cả app chậm đi.
if (!deliverablesMissingFor_(campaignKols).length) return [];
// Có việc thật -> vào lock rồi ĐỌC LẠI. Thiếu bước đọc lại thì hai tab cùng mở
// một campaign sẽ cùng thấy "còn thiếu", cùng append, sinh deliverable trùng và
// làm summarizePerformanceRows_ đếm Posts/Views gấp đôi.
return withDocumentLock_(function () {
invalidateTableCache_('DELIVERABLES');
const missing = deliverablesMissingFor_(campaignKols);
if (!missing.length) return [];
// Chuẩn hoá về 'yyyy-MM-dd'. Trước đây Posting_Date lấy nguyên giá trị thô từ
// readTable_ nên có thể là Date hoặc chuỗi ISO tuỳ trạng thái cache, làm
// <input type="date"> hiện trống và phá thứ tự trong getCalendarData.
const postingSource = campaign.Posting_Start || campaign.Start_Date;
const postingDate = dateOffsetText_(postingSource, 0);
const draftDue = dateOffsetText_(postingSource, -3);
const now = new Date();
const records = missing.map(function (item) {
return {
Deliverable_ID: makeId_('DLV'),
Campaign_KOL_ID: item.campaignKol.Campaign_KOL_ID,
Campaign_ID: item.campaignKol.Campaign_ID || campaign.Campaign_ID,
Account_ID: item.campaignKol.Account_ID,
Type: item.platform + ' post',
Platform: item.platform,
Brief_URL: campaign.Brief_URL || '',
Draft_Due: draftDue,
Draft_URL: '',
Revision_Round: 0,
Content_Status: 'Not started',
Approved_At: '',
Posting_Date: postingDate,
Post_URL: '',
Views: 0,
Likes: 0,
Comments: 0,
Shares: 0,
Saves: 0,
Reposts: 0,
Performance_Updated_At: '',
Performance_Source: '',
Updated_At: now,
Draft_Submitted_At: '',
Post_Submitted_At: '',
};
});
appendRecords_('DELIVERABLES', records);
return records;
});
}
function saveContractRecord(payload) {
const user = requireRole_(['Admin', 'Booking']);
payload = payload || {};
const campaignKol = getAuthorizedCampaignKol_(user, payload.Campaign_KOL_ID);
const campaign = findRecord_('CAMPAIGNS', 'Campaign_ID', campaignKol.Campaign_ID);
const id = cleanText_(payload.Contract_ID);
// On an edit an omitted Sign_Status has to keep whatever the contract
// already has. Defaulting to 'Not started' here silently un-signed a
// signed contract; only a brand-new record falls back to the default.
const priorStatus = id
  ? cleanText_((findRecord_('CONTRACTS', 'Contract_ID', id) || {}).Sign_Status)
  : '';
const status = cleanText_(payload.Sign_Status) || priorStatus || 'Not started';
if (LISTS.CONTRACT_STATUSES.indexOf(status) === -1) throw new Error('Invalid contract status.');
const changes = {
Contract_No: cleanText_(payload.Contract_No),
Template_Name: cleanText_(payload.Template_Name),
Contract_URL: cleanText_(payload.Contract_URL),
Sign_Status: status,
Sent_Date: cleanText_(payload.Sent_Date),
Signed_Date: cleanText_(payload.Signed_Date),
Due_Date: cleanText_(payload.Due_Date),
Owner_Email: cleanText_(payload.Owner_Email) || user.Email,
Notes: cleanText_(payload.Notes),
Updated_At: new Date(),
};
return withDocumentLock_(function () {
let saved;
if (id) {
const existing = findRecord_('CONTRACTS', 'Contract_ID', id);
if (!existing || existing.Campaign_ID !== campaign.Campaign_ID) throw new Error('Contract not found.');
changes.Campaign_KOL_ID = campaignKol.Campaign_KOL_ID;
changes.Creator_ID = campaignKol.Creator_ID;
saved = updateRecord_('CONTRACTS', 'Contract_ID', id, changes);
} else {
saved = mergeObjects_({
Contract_ID: makeId_('CTR'),
Campaign_KOL_ID: campaignKol.Campaign_KOL_ID,
Campaign_ID: campaign.Campaign_ID,
Creator_ID: campaignKol.Creator_ID,
Created_At: new Date(),
}, changes);
appendRecord_('CONTRACTS', saved);
}
updateRecord_('CAMPAIGN_KOLS', 'Campaign_KOL_ID', campaignKol.Campaign_KOL_ID, { Contract_Status: status, Updated_At: new Date() });
logActivity_(user.Email, id ? 'UPDATE' : 'CREATE', 'CONTRACT', saved.Contract_ID, saved.Contract_No || status);
return publicValue_(saved);
});
}
/**
* Cảnh báo KHÔNG CHẶN khi số tiền thanh toán lệch so với chi phí đã chốt của KOL, hoặc
* so với tổng của một BBNT đã phát hành.
*
* Cố ý không hard-block: barter (Final_Fee = 0), trả từng phần, và điều chỉnh thủ công
* đều hợp lệ. Nhưng trước đây savePaymentRecord nhận Amount NGUYÊN VĂN từ client và
* không đối chiếu gì cả, nên tổng BBNT, gross hợp đồng và số thực trả có thể lệch nhau
* trên những chứng từ đã ký và đã thanh toán mà không có gì báo.
*/
function paymentAmountWarning_(campaignKol, campaign, amount) {
const paid = Math.round(toNumber_(amount));
const notes = [];
const booked = Math.round(campaignKolBudgetAmount_(campaignKol, campaign || {}));
if (booked > 0 && paid !== booked) {
notes.push('booked cost is ' + booked);
}
const issued = readTable_('ACCEPTANCES').filter(function (row) {
return cleanText_(row.Campaign_KOL_ID) === cleanText_(campaignKol.Campaign_KOL_ID) &&
['Generated', 'Signed'].indexOf(cleanText_(row.Status)) >= 0;
});
if (issued.length) {
const acceptance = issued[issued.length - 1];
const total = Math.round(toNumber_(acceptance.Total_Amount));
if (total > 0 && paid !== total) {
notes.push('acceptance ' + (cleanText_(acceptance.Acceptance_No) || acceptance.Acceptance_ID) +
' totals ' + total);
}
}
return notes.length ? 'Amount ' + paid + ' differs — ' + notes.join('; ') + '.' : '';
}
function savePaymentRecord(payload) {
const user = requireRole_(['Admin', 'Booking']);
payload = payload || {};
const campaignKol = getAuthorizedCampaignKol_(user, payload.Campaign_KOL_ID);
const campaign = findRecord_('CAMPAIGNS', 'Campaign_ID', campaignKol.Campaign_ID);
const id = cleanText_(payload.Payment_ID);
const status = cleanText_(payload.Payment_Status) || 'Not started';
if (LISTS.PAYMENT_STATUSES.indexOf(status) === -1) throw new Error('Invalid payment status.');
const changes = {
Amount: Math.max(0, toNumber_(payload.Amount)),
Currency: cleanText_(payload.Currency) || campaign.Currency,
Tax_Amount: Math.max(0, toNumber_(payload.Tax_Amount)),
Service_Fee: Math.max(0, toNumber_(payload.Service_Fee)),
Payment_Status: status,
Due_Date: cleanText_(payload.Due_Date),
Payment_Date: cleanText_(payload.Payment_Date),
Invoice_URL: cleanText_(payload.Invoice_URL),
Owner_Email: cleanText_(payload.Owner_Email) || user.Email,
Notes: cleanText_(payload.Notes),
Updated_At: new Date(),
};
return withDocumentLock_(function () {
let saved;
if (id) {
const existing = findRecord_('PAYMENTS', 'Payment_ID', id);
if (!existing || existing.Campaign_ID !== campaign.Campaign_ID) throw new Error('Payment record not found.');
changes.Campaign_KOL_ID = campaignKol.Campaign_KOL_ID;
changes.Creator_ID = campaignKol.Creator_ID;
saved = updateRecord_('PAYMENTS', 'Payment_ID', id, changes);
} else {
saved = mergeObjects_({
Payment_ID: makeId_('PAY'),
Campaign_KOL_ID: campaignKol.Campaign_KOL_ID,
Campaign_ID: campaign.Campaign_ID,
Creator_ID: campaignKol.Creator_ID,
Created_At: new Date(),
}, changes);
appendRecord_('PAYMENTS', saved);
}
updateRecord_('CAMPAIGN_KOLS', 'Campaign_KOL_ID', campaignKol.Campaign_KOL_ID, { Payment_Status: status, Updated_At: new Date() });
// Cảnh báo, không chặn. Gắn vào payload trả về để UI nói ra, và ghi vào ACTIVITY_LOG
// để một khoản lệch còn dấu vết kể cả khi người dùng bỏ qua toast.
const warning = paymentAmountWarning_(campaignKol, campaign, saved.Amount);
logActivity_(user.Email, id ? 'UPDATE' : 'CREATE', 'PAYMENT', saved.Payment_ID,
status + ' · ' + saved.Amount + (warning ? ' · MISMATCH: ' + warning : ''));
const result = publicValue_(saved);
result.Amount_Warning = warning;
return result;
});
}

function getNotifications(payload) {
const user = requireRole_(['Admin', 'Booking', 'Marketing']);
const limit = Math.min(50, Math.max(1, Math.round(toNumber_(payload && payload.limit) || 20)));
const email = cleanText_(user.Email).toLowerCase();
const rows = readOptionalWorkspaceTable_('NOTIFICATIONS').filter(function (row) {
return cleanText_(row.Recipient_Email).toLowerCase() === email;
}).sort(function (a, b) {
// String(Date) bắt đầu bằng tên thứ ("Mon Jul 27…"), nên localeCompare sắp theo
// thứ tự chữ cái của thứ chứ không theo thời gian — khiến "N thông báo mới nhất"
// thành một lát cắt ngẫu nhiên, bỏ sót cả thông báo tạo hôm nay.
return timeValue_(b.Created_At) - timeValue_(a.Created_At);
});
return publicValue_({
rows: rows.slice(0, limit),
unread: rows.filter(function (row) { return !isTrue_(row.Read); }).length,
});
}

function markNotificationRead(payload) {
const user = requireRole_(['Admin', 'Booking', 'Marketing']);
const id = cleanText_(payload && payload.Notification_ID);
if (!id) throw new Error('Notification_ID is required.');
const row = findRecord_('NOTIFICATIONS', 'Notification_ID', id);
if (!row || cleanText_(row.Recipient_Email).toLowerCase() !== cleanText_(user.Email).toLowerCase()) {
throw new Error('Notification not found.');
}
// Đây là đường GHI duy nhất trong codebase không lấy lock. updateRecord_ ghi lại
// toàn bộ dòng, nên một lần ghi song song vào cùng dòng NOTIFICATIONS là mất field.
// Rủi ro thực tế nhỏ (một dòng, một chủ sở hữu) nhưng nó là ngoại lệ duy nhất so với
// quy tắc "mọi ghi đều nằm trong lock", và ngoại lệ thì sẽ bị sao chép.
return withDocumentLock_(function () {
return publicValue_(updateRecord_('NOTIFICATIONS', 'Notification_ID', id, {
Read: 'TRUE',
Read_At: new Date(),
}));
});
}

function createNotification_(recipientEmail, payload) {
const recipient = cleanText_(recipientEmail);
if (!recipient) return null;
const record = {
Notification_ID: makeId_('NTF'),
Recipient_Email: recipient,
Type: cleanText_(payload.Type),
Title: cleanText_(payload.Title),
Message: cleanText_(payload.Message),
Campaign_ID: cleanText_(payload.Campaign_ID),
Entity_ID: cleanText_(payload.Entity_ID),
Action_URL: cleanText_(payload.Action_URL),
Read: 'FALSE',
Created_At: new Date(),
Read_At: '',
};
appendRecord_('NOTIFICATIONS', record);
return record;
}

function sendFeedbackEmail_(recipient, campaign, deliverable, round, feedback, author) {
try {
MailApp.sendEmail({
to: recipient,
subject: '[KOL Manager] Content feedback round ' + round + ' · ' + (campaign.Campaign_Name || campaign.Campaign_ID || ''),
htmlBody:
'<p>New feedback was added in KOL Manager.</p>'
+ '<p><strong>Campaign:</strong> ' + escapeEmailHtml_(campaign.App + ' · ' + campaign.Campaign_Name) + '<br>'
+ '<strong>Deliverable:</strong> ' + escapeEmailHtml_(deliverable.Type || deliverable.Platform || deliverable.Deliverable_ID) + '<br>'
+ '<strong>Round:</strong> ' + round + '<br>'
+ '<strong>From:</strong> ' + escapeEmailHtml_(author) + '</p>'
+ '<div style="border-left:4px solid #2764e7;padding:10px 14px;background:#f5f8ff">' + escapeEmailHtml_(feedback).replace(/\n/g, '<br>') + '</div>'
+ '<p>Please open the campaign Content tab to update the draft.</p>',
});
} catch (error) {
logActivity_(author, 'NOTIFICATION_EMAIL_FAILED', 'DELIVERABLE', deliverable.Deliverable_ID, error.message || String(error));
}
}

function escapeEmailHtml_(value) {
return String(value || '')
.replace(/&/g, '&amp;')
.replace(/</g, '&lt;')
.replace(/>/g, '&gt;')
.replace(/"/g, '&quot;')
.replace(/'/g, '&#39;');
}

function readOptionalWorkspaceTable_(sheetName) {
const sheet = SpreadsheetApp.openById(APP.SPREADSHEET_ID).getSheetByName(sheetName);
return sheet ? readTable_(sheetName) : [];
}

function getAuthorizedCampaignKol_(user, campaignKolId) {
const id = cleanText_(campaignKolId);
if (!id) throw new Error('Select a Campaign KOL.');
const campaignKol = findRecord_('CAMPAIGN_KOLS', 'Campaign_KOL_ID', id);
if (!campaignKol) throw new Error('Campaign KOL not found.');
const campaign = findRecord_('CAMPAIGNS', 'Campaign_ID', campaignKol.Campaign_ID);
if (!campaign) throw new Error('Campaign not found.');
assertCampaignAccess_(user, campaign);
return campaignKol;
}
function validateCampaignDates_(campaign) {
const start = parseDate_(campaign.Start_Date);
const end = parseDate_(campaign.End_Date);
const postingStart = parseDate_(campaign.Posting_Start);
const postingEnd = parseDate_(campaign.Posting_End);
if (start && end && start > end) throw new Error('The campaign end date must be after the start date.');
if (postingStart && postingEnd && postingStart > postingEnd) throw new Error('The posting end date must be after the posting start date.');
}
function dateOffsetText_(value, days) {
const date = parseDate_(value);
if (!date) return '';
date.setDate(date.getDate() + days);
return Utilities.formatDate(date, APP.TIMEZONE, 'yyyy-MM-dd');
}
function uniqueWorkspaceText_(items) {
const seen = {};
return (items || []).filter(function (item) {
const key = String(item || '');
if (!key || seen[key]) return false;
seen[key] = true;
return true;
});
}
