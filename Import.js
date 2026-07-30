/**
* KOL Campaign Manager — Google Sheets importer
* Supports the Vietnam / Thailand / Taiwan source layout supplied with v1.3.0.
*/
const KOL_IMPORT_SPECS = Object.freeze({
VN: {
sheetNames: ['Vietnam', 'VN'],
country: 'Vietnam',
language: 'Vietnamese',
currency: 'VND',
platforms: [
{ platform: 'TikTok', link: ['Link Tiktok', 'Link TT'], followers: ['Followers TT'], fee: ['Fee TT (VND)'], apps: ['Apps'], range: ['Range TT'] },
{ platform: 'Instagram', link: ['Link IG'], followers: ['Followers IG'], fee: ['Fee IG (VND)'], apps: ['Apps 2'], range: ['Range IG'] },
{ platform: 'Threads', link: ['Link Threads'], followers: ['Followers Threads'], fee: ['Fee Threads (VND)'], apps: ['Apps 3'], range: ['Range Threads'] },
],
},
TH: {
sheetNames: ['Thailand', 'TH'],
country: 'Thailand',
language: 'Thai',
currency: 'THB',
platforms: [
{ platform: 'TikTok', link: ['Link TT', 'Link Tiktok'], followers: ['Followers TT'], fee: ['Fee TT (THB)'], apps: ['Apps'], range: ['Range TT'] },
{ platform: 'Instagram', link: ['Link IG'], followers: ['Followers IG'], fee: ['Fee IG (THB)'], apps: ['Apps 2'], range: ['Range IG'] },
{ platform: 'Threads', link: ['Link Threads'], followers: ['Followers Theads', 'Followers Threads'], fee: ['Fee Threads (THB)'], apps: ['Apps 3'], range: ['Range Threads'] },
{ platform: 'X', link: ['Link X'], followers: ['Followers X'], fee: ['Fee X (THB)'], apps: ['Apps 4'], range: ['Range X'] },
],
},
TW: {
sheetNames: ['Taiwan', 'TW'],
country: 'Taiwan',
language: 'Traditional Chinese',
currency: 'TWD',
platforms: [
{ platform: 'TikTok', link: ['Link Tiktok', 'Link TT'], followers: ['Followers Tiktok', 'Followers TT'], fee: ['Fee Tiktok (TWD)', 'Fee TT (TWD)'], apps: ['App request', 'Apps'], range: ['Range Tiktok', 'Range TT'] },
{ platform: 'Instagram', link: ['Link IG'], followers: ['Followers IG'], fee: ['Fee IG (TWD)'], apps: ['App request 2', 'Apps 2'], range: ['Range IG'] },
{ platform: 'Threads', link: ['Link Threads'], followers: ['Followers Threads'], fee: ['Fee Threads (TWD)'], apps: ['App request 3', 'Apps 3'], range: ['Range Threads'] },
],
},
});
function previewKolImport(payload) {
requireRole_(['Admin', 'Booking']);
const source = readKolImportSource_(payload || {});
const plan = buildKolImportPlan_(source.records, { preview: true, updateExisting: false });
return publicValue_({
sourceId: source.sourceId,
sourceName: source.sourceName,
sourceUrl: source.sourceUrl,
markets: source.markets,
warnings: source.warnings,
sample: source.records.slice(0, 5).map(function (record) {
return {
market: record.market,
displayName: record.displayName,
platforms: record.accounts.map(function (account) { return account.platform; }).join(', '),
status: record.status,
};
}),
totals: mergeObjects_(source.totals, plan.summary),
});
}
function importKolsFromGoogleSheet(payload) {
const user = requireRole_(['Admin', 'Booking']);
payload = payload || {};
const source = readKolImportSource_(payload);
const updateExisting = isTrue_(payload.updateExisting);
return withDocumentLock_(function () {
ensureImportSchema_();
const plan = buildKolImportPlan_(source.records, { preview: false, updateExisting: updateExisting });
const creatorUpdates = applyImportUpdates_('CREATORS', 'Creator_ID', plan.creatorUpdates);
const accountUpdates = applyImportUpdates_('ACCOUNTS', 'Account_ID', plan.accountUpdates);
appendImportRecords_('CREATORS', plan.newCreators);
appendImportRecords_('ACCOUNTS', plan.newAccounts);
// Hai helper trên chỉ gọi invalidateTableCache_ — nửa còn lại của giao kèo bị
// thiếu. Mọi đường ghi khác (appendRecord_, appendRecords_, updateRecord_,
// updateRecordsById_, upsertConfigValue_, adminDeleteRowsWhere_) đều bump
// revision cùng lúc.
// Vì sao quan trọng: buildDashboard_ và projectedLookup_ (accountLookup_ /
// creatorLookup_) khoá cache THEO revision. Không bump thì sau khi import xong,
// dashboard và các bảng JOIN vẫn trả ảnh chụp TRƯỚC import trong tối đa 5 phút —
// KOL mới hiện ra ở tìm kiếm database (đọc table cache đã bị xoá) nhưng thêm vào
// campaign lại trống Username/Platform. getCampaignWorkspaceSync cũng chỉ so
// revision để biết "có đổi", nên workspace đang mở không nhận ra gì cả.
touchDataRevision_();
if (plan.newCreators.length || plan.newAccounts.length) {
['CREATORS', 'ACCOUNTS'].forEach(function (sheetName) {
const sheet = getSheet_(sheetName);
formatSheet_(sheet, SCHEMA[sheetName]);
applyValidations_(sheet, SCHEMA[sheetName]);
});
}
const result = {
sourceName: source.sourceName,
markets: source.markets,
sourceRows: source.totals.sourceRows,
accountsFound: source.totals.accountsFound,
creatorsCreated: plan.newCreators.length,
creatorsUpdated: creatorUpdates,
accountsCreated: plan.newAccounts.length,
accountsUpdated: accountUpdates,
accountsSkipped: plan.summary.accountsSkipped,
sourceDuplicates: plan.summary.sourceDuplicates,
blacklistedRows: source.totals.blacklistedRows,
warnings: source.warnings,
};
logActivity_(
user.Email,
'IMPORT_KOLS',
'KOL_DATABASE',
source.sourceId,
result.accountsCreated + ' accounts created; ' + result.accountsUpdated + ' updated; ' + result.accountsSkipped + ' skipped'
);
return publicValue_(result);
});
}
function readKolImportSource_(payload) {
const config = getConfigMap_();
const input = cleanText_(payload.sourceUrl || payload.Source_URL || payload.sourceId || config.KOL_SOURCE_SPREADSHEET_ID);
const sourceId = extractSpreadsheetId_(input);
if (!sourceId) throw new Error('Paste a valid Google Sheets URL or spreadsheet ID. Open and save XLSX files as Google Sheets first.');
if (sourceId === APP.SPREADSHEET_ID) throw new Error('Select the source Google Sheet containing KOL data, not the destination campaign database.');
let sourceSpreadsheet;
try {
sourceSpreadsheet = SpreadsheetApp.openById(sourceId);
} catch (error) {
throw new Error('The source Google Sheet cannot be opened. Grant Viewer access to the app deployment owner and try again.');
}
const selectedMarkets = normalizeImportMarkets_(payload.markets || payload.Markets);
const sheetByName = {};
sourceSpreadsheet.getSheets().forEach(function (sheet) {
sheetByName[String(sheet.getName()).trim().toLowerCase()] = sheet;
});
const records = [];
const marketSummaries = [];
const warnings = [];
let accountsFound = 0;
let rowsSkippedNoAccount = 0;
let blacklistedRows = 0;
selectedMarkets.forEach(function (market) {
const spec = KOL_IMPORT_SPECS[market];
let sheet = null;
spec.sheetNames.some(function (name) {
sheet = sheetByName[name.toLowerCase()] || null;
return Boolean(sheet);
});
if (!sheet) {
warnings.push('No source tab found for ' + market + ' (expected ' + spec.sheetNames.join(' or ') + ').');
return;
}
const parsed = parseKolImportSheet_(sheet, market, spec);
Array.prototype.push.apply(records, parsed.records);
accountsFound += parsed.accountsFound;
rowsSkippedNoAccount += parsed.rowsSkippedNoAccount;
blacklistedRows += parsed.blacklistedRows;
marketSummaries.push({
market: market,
sheetName: sheet.getName(),
sourceRows: parsed.records.length,
accountsFound: parsed.accountsFound,
rowsSkippedNoAccount: parsed.rowsSkippedNoAccount,
});
Array.prototype.push.apply(warnings, parsed.warnings);
});
if (!records.length) throw new Error('No importable KOL accounts were found in the selected source tabs.');
if (rowsSkippedNoAccount) warnings.push(rowsSkippedNoAccount + ' row(s) had creator information but no platform link/follower and were skipped.');
return {
sourceId: sourceId,
sourceName: sourceSpreadsheet.getName(),
sourceUrl: 'https://docs.google.com/spreadsheets/d/' + sourceId + '/edit',
markets: marketSummaries,
records: records,
warnings: uniqueText_(warnings),
totals: {
sourceRows: records.length,
accountsFound: accountsFound,
rowsSkippedNoAccount: rowsSkippedNoAccount,
blacklistedRows: blacklistedRows,
},
};
}
function parseKolImportSheet_(sheet, market, spec) {
const range = sheet.getDataRange();
const values = range.getDisplayValues();
let richValues = null;
try {
richValues = range.getRichTextValues();
} catch (error) {
richValues = null;
}
let headerRowIndex = -1;
for (let rowIndex = 0; rowIndex < Math.min(values.length, 12); rowIndex += 1) {
if (values[rowIndex].some(function (value) { return normalizeImportHeader_(value) === 'account'; })) {
headerRowIndex = rowIndex;
break;
}
}
if (headerRowIndex < 0) throw new Error('Account column not found in source tab ' + sheet.getName() + '.');
const headerMap = {};
values[headerRowIndex].forEach(function (header, index) {
const key = normalizeImportHeader_(header);
if (key && !Object.prototype.hasOwnProperty.call(headerMap, key)) headerMap[key] = index;
});
const baseColumns = {
account: findImportColumn_(headerMap, ['Account']),
contact: findImportColumn_(headerMap, ['Contact info', 'Contact Info']),
category: findImportColumn_(headerMap, ['Category']),
status: findImportColumn_(headerMap, ['Status']),
pic: findImportColumn_(headerMap, ['PIC']),
note: findImportColumn_(headerMap, ['Note']),
benefits: findImportColumn_(headerMap, ['Benefits']),
};
const platformColumns = spec.platforms.map(function (platformSpec) {
return {
spec: platformSpec,
link: findImportColumn_(headerMap, platformSpec.link),
followers: findImportColumn_(headerMap, platformSpec.followers),
fee: findImportColumn_(headerMap, platformSpec.fee),
apps: findImportColumn_(headerMap, platformSpec.apps),
range: findImportColumn_(headerMap, platformSpec.range),
};
});
const warnings = [];
platformColumns.forEach(function (column) {
if (column.link < 0 && column.followers < 0) warnings.push(sheet.getName() + ': no columns found for ' + column.spec.platform + '.');
});
const records = [];
let accountsFound = 0;
let rowsSkippedNoAccount = 0;
let blacklistedRows = 0;
for (let rowIndex = headerRowIndex + 1; rowIndex < values.length; rowIndex += 1) {
const row = values[rowIndex];
const displayName = importCell_(row, richValues && richValues[rowIndex], baseColumns.account, false);
const contactRaw = importCell_(row, richValues && richValues[rowIndex], baseColumns.contact, true);
const categories = importCell_(row, richValues && richValues[rowIndex], baseColumns.category, false);
const status = importCell_(row, richValues && richValues[rowIndex], baseColumns.status, false);
const pic = importCell_(row, richValues && richValues[rowIndex], baseColumns.pic, false);
const note = importCell_(row, richValues && richValues[rowIndex], baseColumns.note, true);
const benefits = importCell_(row, richValues && richValues[rowIndex], baseColumns.benefits, false);
const sourceReference = sheet.getName() + '!' + (rowIndex + 1);
const accounts = [];
platformColumns.forEach(function (column) {
const profileUrl = importCell_(row, richValues && richValues[rowIndex], column.link, true);
const followers = toNumber_(importCell_(row, null, column.followers, false));
if (!profileUrl && followers <= 0) return;
const username = extractKolUsername_(column.spec.platform, profileUrl, displayName);
accounts.push({
market: market,
platform: column.spec.platform,
username: username,
profileUrl: profileUrl,
followers: followers,
startingFee: toNumber_(importCell_(row, null, column.fee, false)),
currency: spec.currency,
appFit: importCell_(row, null, column.apps, false),
followerRange: importCell_(row, null, column.range, false),
});
});
const hasCreatorData = Boolean(displayName || contactRaw || categories || status || note || benefits);
if (!accounts.length) {
if (hasCreatorData) rowsSkippedNoAccount += 1;
continue;
}
if (isBlacklistedStatus_(status)) blacklistedRows += 1;
accountsFound += accounts.length;
records.push({
market: market,
country: spec.country,
language: spec.language,
currency: spec.currency,
displayName: displayName || accounts[0].username,
contactRaw: contactRaw,
categories: categories,
status: status,
pic: pic,
note: note,
benefits: benefits,
sourceReference: sourceReference,
sourceLabel: 'KOL Database · ' + sourceReference,
accounts: accounts,
});
}
return {
records: records,
accountsFound: accountsFound,
rowsSkippedNoAccount: rowsSkippedNoAccount,
blacklistedRows: blacklistedRows,
warnings: warnings,
};
}
function buildKolImportPlan_(sourceRecords, options) {
options = options || {};
const preview = Boolean(options.preview);
const updateExisting = Boolean(options.updateExisting);
const now = new Date();
let previewCreatorNumber = 0;
let previewAccountNumber = 0;
const creatorEntriesById = {};
const creatorEntriesByKey = {};
readTable_('CREATORS').forEach(function (creator) {
const entry = { record: creator, isNew: false };
creatorEntriesById[creator.Creator_ID] = entry;
creatorIdentityKeys_(creator).forEach(function (key) {
if (!creatorEntriesByKey[key]) creatorEntriesByKey[key] = entry;
});
});
const accountEntriesByKey = {};
readTable_('ACCOUNTS').forEach(function (account) {
const entry = { record: account, isNew: false };
accountIdentityKeys_(account.Market, account.Platform, account.Username, account.Profile_URL).forEach(function (key) {
if (!accountEntriesByKey[key]) accountEntriesByKey[key] = entry;
});
});
const newCreators = [];
const newAccounts = [];
const creatorUpdates = {};
const accountUpdates = {};
const reusedCreatorIds = {};
let existingAccounts = 0;
let sourceDuplicates = 0;
sourceRecords.forEach(function (source) {
const contact = parseKolContact_(source.contactRaw);
const incomingCreator = creatorFromSource_(source, contact, now);
let creatorEntry = null;
source.accounts.some(function (account) {
const matchedAccount = findAccountEntry_(accountEntriesByKey, account);
if (!matchedAccount || !matchedAccount.record.Creator_ID) return false;
creatorEntry = creatorEntriesById[matchedAccount.record.Creator_ID] || null;
return Boolean(creatorEntry);
});
if (!creatorEntry) {
const keys = creatorIdentityKeys_(incomingCreator, source.market);
keys.some(function (key) {
creatorEntry = creatorEntriesByKey[key] || null;
return Boolean(creatorEntry);
});
}
if (!creatorEntry) {
incomingCreator.Creator_ID = preview
? 'PREVIEW-CRE-' + String(++previewCreatorNumber).padStart(5, '0')
: makeId_('CRE');
creatorEntry = { record: incomingCreator, isNew: true };
newCreators.push(incomingCreator);
creatorEntriesById[incomingCreator.Creator_ID] = creatorEntry;
creatorIdentityKeys_(incomingCreator, source.market).forEach(function (key) {
if (!creatorEntriesByKey[key]) creatorEntriesByKey[key] = creatorEntry;
});
} else {
reusedCreatorIds[creatorEntry.record.Creator_ID] = true;
if (updateExisting) {
if (creatorEntry.isNew) mergeCreatorImportRecord_(creatorEntry.record, incomingCreator);
else mergeImportUpdate_(creatorUpdates, creatorEntry.record.Creator_ID, creatorImportChanges_(creatorEntry.record, incomingCreator, now));
}
}
source.accounts.forEach(function (sourceAccount) {
const existingEntry = findAccountEntry_(accountEntriesByKey, sourceAccount);
const incomingAccount = accountFromSource_(sourceAccount, source, contact, creatorEntry.record.Creator_ID, now);
if (existingEntry) {
if (existingEntry.isNew) {
sourceDuplicates += 1;
if (updateExisting) mergeAccountImportRecord_(existingEntry.record, incomingAccount);
} else {
existingAccounts += 1;
if (updateExisting) mergeImportUpdate_(accountUpdates, existingEntry.record.Account_ID, accountImportChanges_(existingEntry.record, incomingAccount, now));
}
return;
}
incomingAccount.Account_ID = preview
? 'PREVIEW-ACC-' + String(++previewAccountNumber).padStart(5, '0')
: makeId_('ACC');
const newEntry = { record: incomingAccount, isNew: true };
newAccounts.push(incomingAccount);
accountIdentityKeys_(incomingAccount.Market, incomingAccount.Platform, incomingAccount.Username, incomingAccount.Profile_URL).forEach(function (key) {
if (!accountEntriesByKey[key]) accountEntriesByKey[key] = newEntry;
});
});
});
return {
newCreators: newCreators,
newAccounts: newAccounts,
creatorUpdates: creatorUpdates,
accountUpdates: accountUpdates,
summary: {
creatorsCreated: newCreators.length,
creatorsReused: Object.keys(reusedCreatorIds).length,
accountsCreated: newAccounts.length,
accountsAlreadyExisting: existingAccounts,
sourceDuplicates: sourceDuplicates,
accountsSkipped: existingAccounts + sourceDuplicates,
creatorUpdateCandidates: Object.keys(creatorUpdates).length,
accountUpdateCandidates: Object.keys(accountUpdates).length,
},
};
}
function creatorFromSource_(source, contact, now) {
const notes = [];
if (contact.raw && ['Email', 'Phone', 'Zalo', 'LINE'].indexOf(contact.channel) === -1) notes.push('Contact: ' + contact.raw);
if (source.benefits) notes.push('Benefits: ' + source.benefits);
return {
Creator_ID: '',
Legal_Name: '',
Display_Name: source.displayName,
Country: source.country,
City: '',
Languages: source.language,
Categories: source.categories,
Email: contact.email,
Phone: contact.phone,
LINE_ID: contact.lineId,
Notes: notes.join('\n'),
Active: isBlacklistedStatus_(source.status) ? 'FALSE' : 'TRUE',
Created_At: now,
Updated_At: now,
Source_Status: source.status,
Source_PIC: source.pic,
Source_Note: [source.note, source.benefits ? 'Benefits: ' + source.benefits : ''].filter(String).join('\n'),
Source_Reference: source.sourceReference,
};
}
function accountFromSource_(sourceAccount, source, contact, creatorId, now) {
return {
Account_ID: '',
Creator_ID: creatorId,
Market: sourceAccount.market,
Platform: sourceAccount.platform,
Username: sourceAccount.username,
Profile_URL: sourceAccount.profileUrl,
Followers: sourceAccount.followers,
Avg_Views: '',
Engagement_Rate: '',
Starting_Fee: sourceAccount.startingFee,
Currency: sourceAccount.currency,
Contact_Channel: contact.channel,
Contact_Value: contact.raw,
Source: source.sourceLabel,
Last_Verified: '',
Active: isBlacklistedStatus_(source.status) ? 'FALSE' : 'TRUE',
Created_At: now,
Updated_At: now,
App_Fit: sourceAccount.appFit,
Follower_Range: sourceAccount.followerRange,
};
}
function creatorImportChanges_(existing, incoming, now) {
const changes = {};
const mergedCategories = mergeListText_(existing.Categories, incoming.Categories);
if (mergedCategories !== cleanText_(existing.Categories)) changes.Categories = mergedCategories;
['Email', 'Phone', 'LINE_ID'].forEach(function (field) {
if (!cleanText_(existing[field]) && cleanText_(incoming[field])) changes[field] = incoming[field];
});
['Source_Status', 'Source_PIC', 'Source_Note', 'Source_Reference'].forEach(function (field) {
if (cleanText_(incoming[field]) && cleanText_(existing[field]) !== cleanText_(incoming[field])) changes[field] = incoming[field];
});
if (String(incoming.Active) === 'FALSE' && String(existing.Active) !== 'FALSE') changes.Active = 'FALSE';
if (Object.keys(changes).length) changes.Updated_At = now;
return changes;
}
function accountImportChanges_(existing, incoming, now) {
const changes = {};
['Username', 'Profile_URL', 'Currency', 'Contact_Channel', 'Contact_Value', 'Source', 'App_Fit', 'Follower_Range'].forEach(function (field) {
if (cleanText_(incoming[field]) && cleanText_(existing[field]) !== cleanText_(incoming[field])) changes[field] = incoming[field];
});
['Followers', 'Starting_Fee'].forEach(function (field) {
if (toNumber_(incoming[field]) > 0 && toNumber_(existing[field]) !== toNumber_(incoming[field])) changes[field] = incoming[field];
});
if (String(incoming.Active) === 'FALSE' && String(existing.Active) !== 'FALSE') changes.Active = 'FALSE';
if (Object.keys(changes).length) changes.Updated_At = now;
return changes;
}
function mergeCreatorImportRecord_(target, incoming) {
const changes = creatorImportChanges_(target, incoming, incoming.Updated_At || new Date());
Object.keys(changes).forEach(function (key) { target[key] = changes[key]; });
}
function mergeAccountImportRecord_(target, incoming) {
const changes = accountImportChanges_(target, incoming, incoming.Updated_At || new Date());
Object.keys(changes).forEach(function (key) { target[key] = changes[key]; });
}
function mergeImportUpdate_(updates, id, changes) {
if (!changes || !Object.keys(changes).length) return;
if (!updates[id]) updates[id] = {};
Object.keys(changes).forEach(function (key) { updates[id][key] = changes[key]; });
}
function ensureImportSchema_() {
['CREATORS', 'ACCOUNTS'].forEach(function (sheetName) {
ensureHeaders_(getSheet_(sheetName), SCHEMA[sheetName]);
});
}
function appendImportRecords_(sheetName, records) {
if (!records || !records.length) return 0;
const sheet = getSheet_(sheetName);
const headers = SCHEMA[sheetName];
const rows = records.map(function (record) {
return headers.map(function (header) {
return Object.prototype.hasOwnProperty.call(record, header) ? record[header] : '';
});
});
const startRow = sheet.getLastRow() + 1;
const requiredLastRow = startRow + rows.length - 1;
if (sheet.getMaxRows() < requiredLastRow) {
sheet.insertRowsAfter(sheet.getMaxRows(), requiredLastRow - sheet.getMaxRows());
}
sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
invalidateTableCache_(sheetName);
// Có dòng mới nên chỉ số id -> số dòng đã thiếu; appendRecord_ xoá chỉ số này vì
// đúng lý do đó. Hiện chưa có ai tra id trên cùng sheet sau bước này trong cùng lần
// thực thi, nên là bịt trước chứ không phải sửa lỗi đang xảy ra.
invalidateRowNumberIndex_(sheetName);
return rows.length;
}
/**
* Ghi các thay đổi của importer bằng updateRecordsById_ thay vì đọc-rồi-ghi-lại CẢ
* BẢNG.
*
* Cách cũ: getValues rồi setValues trên toàn vùng dữ liệu mỗi khi có ít nhất một
* dòng đổi. Theo số đo ghi trong Code.gs, ACCOUNTS ~6.769 dòng x 20 cột ≈ 135.000 ô
* và CREATORS ~4.222 x 24 ≈ 101.000 ô — nên sửa 3 dòng là ghi lại ~236.000 ô, trong
* khi đang giữ script lock TOÀN CỤC (mọi người khác timeout ở waitLock 30 giây). Nó
* còn ghi đè lại từng ô không liên quan, làm mọi công thức người dùng tự đặt trong
* hai sheet đó bị đóng băng thành giá trị cuối.
*
* updateRecordsById_ chỉ ghi những dòng thật sự đổi, gộp thành khối liền nhau
* (writeChangedRows_), và tự xử lý cache + revision.
*/
function applyImportUpdates_(sheetName, idField, updates) {
const requested = Object.keys(updates || {});
if (!requested.length) return 0;
// updateRecordsById_ THROW khi một id không tìm thấy. Cách cũ thì im lặng bỏ qua —
// và import hoàn toàn có thể mang theo id của bản ghi đã bị xoá tay khỏi sheet. Lọc
// trước theo chỉ số id có thật để giữ đúng hành vi cũ.
const rowNumberById = rowNumberIndex_(sheetName, idField);
const present = {};
let changed = 0;
requested.forEach(function (id) {
if (!rowNumberById[id]) return;
present[id] = updates[id];
changed += 1;
});
if (!changed) return 0;
updateRecordsById_(sheetName, idField, present);
return changed;
}
function parseKolContact_(value) {
const raw = cleanText_(value);
const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
const lineMatch = raw.match(/(?:line\.me[^\s]*\/|\bline\b[^@\w]*)(@[A-Z0-9._-]+)/i) || raw.match(/^(@[A-Z0-9._-]+)$/i);
const digits = /https?:\/\//i.test(raw) ? '' : raw.replace(/\D/g, '');
const phone = digits.length >= 8 && digits.length <= 15 ? digits : '';
let channel = 'Other';
if (!raw) channel = '';
else if (emailMatch) channel = 'Email';
else if (lineMatch || /line\.me/i.test(raw)) channel = 'LINE';
else if (phone) channel = /zalo/i.test(raw) ? 'Zalo' : 'Phone';
else if (/instagram\.com|\bIG\b/i.test(raw)) channel = 'Instagram';
else if (/\bDM\b/i.test(raw)) channel = 'DM';
return {
raw: raw,
channel: channel,
email: emailMatch ? emailMatch[0].toLowerCase() : '',
phone: phone,
lineId: lineMatch ? lineMatch[1] : '',
};
}
function creatorIdentityKeys_(creator, marketHint) {
const keys = [];
const email = cleanText_(creator.Email).toLowerCase();
const phone = cleanText_(creator.Phone).replace(/\D/g, '');
const lineId = normalizeIdentityText_(creator.LINE_ID);
const market = marketHint || marketFromCountry_(creator.Country);
const name = normalizeIdentityText_(creator.Display_Name || creator.Legal_Name);
if (market && name) keys.push('name|' + market + '|' + name);
// Agencies often reuse one email/LINE account for several creators. Contact-only
// matching is therefore used only when the creator has no usable display name.
if (!name && email) keys.push('email|' + email);
if (!name && phone) keys.push('phone|' + phone);
if (!name && lineId) keys.push('line|' + lineId);
return uniqueText_(keys);
}
function accountIdentityKeys_(market, platform, username, profileUrl) {
const keys = [];
const normalizedUsername = normalizeIdentityText_(username).replace(/^@/, '');
const normalizedUrl = normalizeProfileUrl_(profileUrl);
if (normalizedUsername) keys.push('handle|' + market + '|' + platform + '|' + normalizedUsername);
if (normalizedUrl) keys.push('url|' + platform + '|' + normalizedUrl);
return uniqueText_(keys);
}
function findAccountEntry_(index, account) {
let entry = null;
accountIdentityKeys_(account.market || account.Market, account.platform || account.Platform, account.username || account.Username, account.profileUrl || account.Profile_URL).some(function (key) {
entry = index[key] || null;
return Boolean(entry);
});
return entry;
}
function extractKolUsername_(platform, profileUrl, fallback) {
let url = cleanText_(profileUrl);
try { url = decodeURIComponent(url); } catch (error) { /* Keep the original URL. */ }
let match = null;
if (platform === 'TikTok') match = url.match(/tiktok\.com\/@([^/?#]+)/i);
else if (platform === 'Instagram') match = url.match(/instagram\.com\/([^/?#]+)/i);
else if (platform === 'Threads') match = url.match(/threads\.(?:com|net)\/@?([^/?#]+)/i);
else if (platform === 'X') match = url.match(/(?:x|twitter)\.com\/([^/?#]+)/i);
const candidate = match && match[1] ? match[1] : fallback;
return cleanText_(candidate).replace(/^@/, '').replace(/\/$/, '');
}
function normalizeProfileUrl_(value) {
const raw = cleanText_(value).toLowerCase();
if (!raw) return '';
return raw
.replace(/^https?:\/\//, '')
.replace(/^www\./, '')
.replace(/[?#].*$/, '')
.replace(/\/$/, '');
}
function extractSpreadsheetId_(value) {
const text = cleanText_(value);
const urlMatch = text.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
if (urlMatch) return urlMatch[1];
const idMatch = text.match(/^[A-Za-z0-9_-]{20,}$/);
return idMatch ? idMatch[0] : '';
}
function normalizeImportMarkets_(value) {
const raw = value === null || typeof value === 'undefined' ? 'VN,TH,TW' : value;
const source = Array.isArray(raw) ? raw : String(raw).split(',');
const seen = {};
const markets = source.map(function (item) {
const normalized = cleanText_(item).toUpperCase();
if (normalized === 'VIETNAM') return 'VN';
if (normalized === 'THAILAND') return 'TH';
if (normalized === 'TAIWAN') return 'TW';
return normalized;
}).filter(function (market) {
if (!KOL_IMPORT_SPECS[market] || seen[market]) return false;
seen[market] = true;
return true;
});
if (!markets.length) throw new Error('Select at least one market to import.');
return markets;
}
function normalizeImportHeader_(value) {
return cleanText_(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function findImportColumn_(headerMap, aliases) {
let column = -1;
aliases.some(function (alias) {
const key = normalizeImportHeader_(alias);
if (!Object.prototype.hasOwnProperty.call(headerMap, key)) return false;
column = headerMap[key];
return true;
});
return column;
}
function importCell_(row, richRow, columnIndex, preferLink) {
if (columnIndex < 0 || !row || columnIndex >= row.length) return '';
const displayed = cleanText_(row[columnIndex]);
if (!preferLink || !richRow || !richRow[columnIndex]) return displayed;
try {
return cleanText_(richRow[columnIndex].getLinkUrl()) || displayed;
} catch (error) {
return displayed;
}
}
function marketFromCountry_(country) {
const value = cleanText_(country).toLowerCase();
if (value.indexOf('viet') >= 0 || value === 'vn') return 'VN';
if (value.indexOf('thai') >= 0 || value === 'th') return 'TH';
if (value.indexOf('taiwan') >= 0 || value === 'tw') return 'TW';
return '';
}
function normalizeIdentityText_(value) {
return cleanText_(value).toLowerCase().replace(/\s+/g, '').replace(/[?#].*$/, '');
}
function mergeListText_(left, right) {
const seen = {};
return [left, right].join(',').split(/[,|]/).map(function (item) { return cleanText_(item); }).filter(function (item) {
const key = item.toLowerCase();
if (!item || seen[key]) return false;
seen[key] = true;
return true;
}).join(', ');
}
function isBlacklistedStatus_(value) {
return /black\s*list/i.test(cleanText_(value));
}
function uniqueText_(items) {
const seen = {};
return (items || []).filter(function (item) {
const key = cleanText_(item);
if (!key || seen[key]) return false;
seen[key] = true;
return true;
});
}
