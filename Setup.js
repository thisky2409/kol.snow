/**
* KOL Campaign Manager — database setup
* Bound spreadsheet: 1X0QcwrANGzbRxGC-e63Sez1O_WkuNMqisEYEedGXquQ
*/
const APP = Object.freeze({
SPREADSHEET_ID: '1X0QcwrANGzbRxGC-e63Sez1O_WkuNMqisEYEedGXquQ',
TIMEZONE: 'Asia/Ho_Chi_Minh',
VERSION: '1.11.0',
});
const SCHEMA = Object.freeze({
CONFIG: ['Key', 'Value', 'Description', 'Updated_At'],
USERS: ['User_ID', 'Email', 'Name', 'Role', 'Market', 'Active', 'Created_At', 'Updated_At'],
CREATORS: ['Creator_ID', 'Legal_Name', 'Display_Name', 'Country', 'City', 'Languages', 'Categories', 'Email', 'Phone', 'LINE_ID', 'Notes', 'Active', 'Created_At', 'Updated_At', 'Source_Status', 'Source_PIC', 'Source_Note', 'Source_Reference', 'Title', 'ID_No', 'Date_Of_Issue', 'Permanent_Address', 'Bank_Account', 'Bank_Name'],
ACCOUNTS: ['Account_ID', 'Creator_ID', 'Market', 'Platform', 'Username', 'Profile_URL', 'Followers', 'Avg_Views', 'Engagement_Rate', 'Starting_Fee', 'Currency', 'Contact_Channel', 'Contact_Value', 'Source', 'Last_Verified', 'Active', 'Created_At', 'Updated_At', 'App_Fit', 'Follower_Range'],
CAMPAIGNS: ['Campaign_ID', 'Campaign_Name', 'App', 'Market', 'Objective', 'Start_Date', 'End_Date', 'Posting_Start', 'Posting_End', 'Target_KOLs', 'Budget', 'Currency', 'Status', 'Owner_Email', 'Brief_URL', 'Notes', 'Created_At', 'Updated_At', 'Platforms', 'Assigned_Marketing'],
SHORTLISTS: ['Shortlist_ID', 'Shortlist_Name', 'Market', 'Month', 'Campaign_ID', 'Owner_Email', 'Status', 'Notes', 'Created_At', 'Updated_At'],
SHORTLIST_KOLS: ['Shortlist_KOL_ID', 'Shortlist_ID', 'Account_ID', 'Picked', 'Review_Status', 'Reviewer_Email', 'Notes', 'Added_At', 'Updated_At'],
// After_PIT_Fee is retained as the internal sheet key for backward compatibility.
// In the web UI it is the auto-calculated VN "Gross amount".
CAMPAIGN_KOLS: ['Campaign_KOL_ID', 'Campaign_ID', 'Account_ID', 'Creator_ID', 'Role', 'PIC_Email', 'Booking_Status', 'Quoted_Fee', 'Final_Fee', 'Currency', 'Tax', 'Service_Fee', 'Deliverable_Summary', 'Contract_Status', 'Content_Status', 'Posting_Date', 'Post_URL', 'Payment_Status', 'Notes', 'Added_At', 'Updated_At', 'Code_Ad_Fee', 'After_PIT_Fee', 'Ad_Timeline'],
DELIVERABLES: ['Deliverable_ID', 'Campaign_KOL_ID', 'Campaign_ID', 'Account_ID', 'Type', 'Platform', 'Brief_URL', 'Draft_Due', 'Draft_URL', 'Revision_Round', 'Content_Status', 'Approved_At', 'Posting_Date', 'Post_URL', 'Views', 'Likes', 'Comments', 'Shares', 'Saves', 'Updated_At', 'Draft_Submitted_At', 'Reposts', 'Performance_Updated_At', 'Performance_Source', 'Post_Submitted_At'],
CONTENT_FEEDBACK: ['Feedback_ID', 'Deliverable_ID', 'Campaign_KOL_ID', 'Campaign_ID', 'Round', 'Feedback', 'Created_By', 'Notified_To', 'Created_At'],
CONTRACTS: ['Contract_ID', 'Campaign_KOL_ID', 'Campaign_ID', 'Creator_ID', 'Contract_No', 'Template_Name', 'Contract_URL', 'Sign_Status', 'Sent_Date', 'Signed_Date', 'Due_Date', 'Owner_Email', 'Notes', 'Created_At', 'Updated_At', 'Contract_PDF_URL', 'Folder_URL'],
PAYMENTS: ['Payment_ID', 'Campaign_KOL_ID', 'Campaign_ID', 'Creator_ID', 'Amount', 'Currency', 'Tax_Amount', 'Service_Fee', 'Payment_Status', 'Due_Date', 'Payment_Date', 'Invoice_URL', 'Owner_Email', 'Notes', 'Created_At', 'Updated_At'],
NOTIFICATIONS: ['Notification_ID', 'Recipient_Email', 'Type', 'Title', 'Message', 'Campaign_ID', 'Entity_ID', 'Action_URL', 'Read', 'Created_At', 'Read_At'],
ACTIVITY_LOG: ['Log_ID', 'Timestamp', 'User_Email', 'Action', 'Entity_Type', 'Entity_ID', 'Details'],
  ACCEPTANCES: ['Acceptance_ID', 'Contract_ID', 'Campaign_ID', 'Campaign_KOL_ID', 'Creator_ID',
    'Acceptance_No', 'Market', 'Template_Name', 'Acceptance_URL', 'Acceptance_PDF_URL', 'Folder_URL',
    'Status', 'Image_Usage_Fee', 'Total_Amount', 'Currency', 'Signed_Date', 'Owner_Email', 'Notes',
    'Created_At', 'Updated_At'],
  ACCEPTANCE_LINES: ['Acceptance_Line_ID', 'Acceptance_ID', 'Contract_ID', 'Deliverable_ID',
    'Line_No', 'App', 'Platform', 'Post_URL', 'Qty', 'Unit_Price', 'Content_Amount',
    'Evidence_URLs', 'Status', 'Notes', 'Created_At', 'Updated_At'],
  CREATOR_FORM_TOKENS: ['Token_ID', 'Token', 'Creator_ID', 'Campaign_KOL_ID', 'Created_By',
    'Expires_At', 'Used_At', 'Status', 'Created_At'],
});
const CONTRACT_CONFIG = Object.freeze({
TEMPLATE_ID: '1tnQnTSlNsEp_CaMQf5IB7_gtHYHRGbfmGSxzDrUk5ig',
OUTPUT_FOLDER_ID: '1qAZ_K84vvn6lyEbuUb9XLAkFUgbw3Ila',
SOURCE_SPREADSHEET_ID: '1bBe0X8A2ca9m2rOEgsdb0C_NdU1INee1getUYHvzUF0',
SOURCE_SHEET_NAME: 'Contract',
CONTRACT_YEAR_PREFIX: 'HĐ-SNOWVN-',
NO_MIN_DIGITS: 2,
});
const CONTRACT_REQUIRED_CREATOR_FIELDS = Object.freeze([
'Title', 'Legal_Name', 'ID_No', 'Date_Of_Issue', 'Permanent_Address', 'Bank_Account', 'Bank_Name',
]);
// Danh sách category CHÍNH THỨC theo yêu cầu team — 6 nhóm màu như trong ảnh.
// Đổi/thêm/bớt category thì sửa trực tiếp ở đây (và bảng màu CATEGORY_GROUPS
// bên dưới nếu thêm category mới, để nó có màu đúng nhóm thay vì mặc định).
const CATEGORIES = Object.freeze([
'Beauty', 'Skincare', 'Makeup',
'Daily Vlog', 'Lifestyle', 'Travel',
'Cosplay', 'Photographic', 'Fashion',
'Funny', 'Dance', 'Performance', 'Lipsync',
'Couple', 'Tips', 'Trend', 'Tech',
'Review', 'Selfie', 'AI',
]);
// Tên nhóm chỉ dùng để tô màu hiển thị (UI), không lưu vào Sheet.
const CATEGORY_GROUPS = Object.freeze({
'Beauty': 'red', 'Skincare': 'red', 'Makeup': 'red',
'Daily Vlog': 'green', 'Lifestyle': 'green', 'Travel': 'green',
'Cosplay': 'blue', 'Photographic': 'blue', 'Fashion': 'blue',
'Funny': 'amber', 'Dance': 'amber', 'Performance': 'amber', 'Lipsync': 'amber',
'Couple': 'violet', 'Tips': 'violet', 'Trend': 'violet', 'Tech': 'violet',
'Review': 'grey', 'Selfie': 'grey', 'AI': 'grey',
});
const FOLLOWER_RANGES = Object.freeze([
{ id: 'lt10k', label: '< 10K', min: 0, max: 10000 },
{ id: '10k_30k', label: '10K - 30K', min: 10000, max: 30000 },
{ id: '30k_100k', label: '30K - 100K', min: 30000, max: 100000 },
{ id: '100k_300k', label: '100K - 300K', min: 100000, max: 300000 },
{ id: '300k_1m', label: '300K - 1M', min: 300000, max: 1000000 },
{ id: 'gt1m', label: '> 1M', min: 1000000, max: null },
]);
const LISTS = Object.freeze({
MARKETS: ['VN', 'TH', 'TW', 'Global'],
USER_ROLES: ['Admin', 'Booking', 'Marketing'],
PLATFORMS: ['TikTok', 'Instagram', 'Threads', 'X', 'YouTube', 'Facebook', 'Other'],
CURRENCIES: ['VND', 'THB', 'TWD', 'USD'],
CAMPAIGN_STATUSES: ['Planning', 'Sourcing', 'Active', 'Paused', 'Completed', 'Cancelled'],
SHORTLIST_STATUSES: ['Draft', 'Reviewing', 'Approved', 'Archived'],
REVIEW_STATUSES: ['New', 'Reviewing', 'Approved', 'Rejected', 'Backup'],
BOOKING_STATUSES: ['Picked', 'Approved', 'Contacted', 'Negotiating', 'Confirmed', 'Declined', 'Cancelled'],
CONTRACT_STATUSES: ['Not started', 'Info pending', 'Draft', 'Sent', 'Signed', 'Cancelled'],
ACCEPTANCE_STATUSES: ['Draft', 'Generated', 'Signed', 'Cancelled'],
ACCEPTANCE_LINE_STATUSES: ['Needs evidence', 'Ready'],
CONTENT_STATUSES: ['Not started', 'Draft submitted', 'Need edit', 'Approved', 'Posted'],
PAYMENT_STATUSES: ['Not started', 'Info pending', 'Ready', 'Processing', 'Paid', 'On hold', 'Cancelled'],
KOL_ROLES: ['Primary', 'Backup', 'Organic', 'Paid'],
BOOLEAN: ['TRUE', 'FALSE'],
});
const ID_PREFIX = Object.freeze({
USERS: 'USR',
CREATORS: 'CRE',
ACCOUNTS: 'ACC',
CAMPAIGNS: 'CMP',
SHORTLISTS: 'SL',
SHORTLIST_KOLS: 'SLK',
CAMPAIGN_KOLS: 'CK',
DELIVERABLES: 'DLV',
CONTENT_FEEDBACK: 'FBK',
CONTRACTS: 'CTR',
PAYMENTS: 'PAY',
NOTIFICATIONS: 'NTF',
ACTIVITY_LOG: 'LOG',
  ACCEPTANCES: 'ACP',
  ACCEPTANCE_LINES: 'ACL',
  CREATOR_FORM_TOKENS: 'CFT',
});
function onOpen() {
SpreadsheetApp.getUi()
.createMenu('KOL Manager')
.addItem('1. Initialize database', 'setupDatabase')
.addItem('2. Refresh formatting & dropdowns', 'refreshDatabaseRules')
.addItem('3. Generate missing IDs', 'generateMissingIds')
.addSeparator()
.addItem('Show deployment guide', 'showDeploymentGuide')
.addToUi();
}
/**
* Kiểm quyền cho các hàm khởi tạo/bảo trì cấu trúc sheet.
*
* KHÔNG gọi requireRole_ vô điều kiện được: setupDatabase chính là hàm TẠO RA
* sheet USERS, nên trên một bản cài mới getCurrentUser_ -> readTable_('USERS')
* -> getSheet_ sẽ throw 'Missing required sheet: USERS. Run setupDatabase()
* first.' và khoá cứng đúng bước khởi tạo đầu tiên.
*
* Vì vậy: đã có USERS kèm dữ liệu -> BẮT BUỘC Admin; chưa có -> đây là lần chạy
* đầu tiên và seedOwner_ ngay sau đó ghi chính người gọi thành Admin đầu tiên.
* Không mất gì về bảo mật: khi USERS còn rỗng thì getCurrentUser_ đã chặn mọi
* người khỏi dùng web app, nên không có ai để phân quyền cả.
*/
function requireSetupAdmin_() {
const users = getSpreadsheet_().getSheetByName('USERS');
if (!users || users.getLastRow() < 2) return null;
return requireRole_(['Admin']);
}
function setupDatabase() {
requireSetupAdmin_();
const ss = SpreadsheetApp.openById(APP.SPREADSHEET_ID);
ss.setSpreadsheetTimeZone(APP.TIMEZONE);
Object.keys(SCHEMA).forEach(function (sheetName) {
const headers = SCHEMA[sheetName];
let sheet = ss.getSheetByName(sheetName);
if (!sheet) sheet = ss.insertSheet(sheetName);
ensureHeaders_(sheet, headers);
formatSheet_(sheet, headers);
applyValidations_(sheet, headers);
});
seedConfig_();
seedOwner_();
migrateLegacyUserRoles_();
SpreadsheetApp.flush();
ss.toast('Database is ready. Next: deploy the web app.', 'KOL Campaign Manager', 8);
}
function refreshDatabaseRules() {
requireRole_(['Admin']);
const ss = SpreadsheetApp.openById(APP.SPREADSHEET_ID);
Object.keys(SCHEMA).forEach(function (sheetName) {
const sheet = ss.getSheetByName(sheetName);
if (!sheet) throw new Error('Missing sheet: ' + sheetName);
ensureHeaders_(sheet, SCHEMA[sheetName]);
formatSheet_(sheet, SCHEMA[sheetName]);
applyValidations_(sheet, SCHEMA[sheetName]);
});
migrateLegacyUserRoles_();
SpreadsheetApp.flush();
ss.toast('Formatting and dropdown rules refreshed.', 'KOL Campaign Manager', 5);
}

function migrateLegacyUserRoles_() {
const sheet = getSheet_('USERS');
const rowCount = sheet.getLastRow() - 1;
if (rowCount < 1) return;
const values = sheet.getRange(2, 4, rowCount, 3).getValues(); // Role, Market, Active
const mappings = { 'Campaign Admin': 'Booking', 'Market PIC': 'Booking', 'Finance': 'Booking', 'Viewer': 'Marketing' };
let changed = false;
values.forEach(function (row) {
const oldRole = cleanText_(row[0]);
if (!mappings[oldRole]) return;
row[0] = mappings[oldRole];
// Viewer cũ là chỉ-xem. Không tự động nâng quyền ghi; người quản trị phải bật
// lại Active sau khi xác nhận người đó nên trở thành Marketing.
if (oldRole === 'Viewer') row[2] = 'FALSE';
changed = true;
});
if (changed) sheet.getRange(2, 4, rowCount, 3).setValues(values);
}
function generateMissingIds() {
requireRole_(['Admin']);
const ss = SpreadsheetApp.openById(APP.SPREADSHEET_ID);
let changed = 0;
Object.keys(ID_PREFIX).forEach(function (sheetName) {
const sheet = ss.getSheetByName(sheetName);
if (!sheet || sheet.getLastRow() < 2) return;
const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(2, sheet.getLastColumn())).getValues();
const ids = [];
values.forEach(function (row) {
const hasData = row.slice(1).some(function (value) { return value !== ''; });
if (!row[0] && hasData) {
ids.push([makeId_(ID_PREFIX[sheetName])]);
changed += 1;
} else {
ids.push([row[0]]);
}
});
if (ids.length) sheet.getRange(2, 1, ids.length, 1).setValues(ids);
});
SpreadsheetApp.flush();
ss.toast(changed + ' missing IDs generated.', 'KOL Campaign Manager', 5);
}
function onEdit(e) {
if (!e || !e.range || e.range.getRow() < 2) return;
const sheet = e.range.getSheet();
const sheetName = sheet.getName();
const prefix = ID_PREFIX[sheetName];
if (!prefix || e.range.getColumn() === 1) return;
const idCell = sheet.getRange(e.range.getRow(), 1);
if (!idCell.getValue()) idCell.setValue(makeId_(prefix));
const headers = SCHEMA[sheetName] || [];
const updatedIndex = headers.indexOf('Updated_At');
if (updatedIndex >= 0) sheet.getRange(e.range.getRow(), updatedIndex + 1).setValue(new Date());
if (typeof invalidateTableCache_ === 'function') invalidateTableCache_(sheetName);
if (typeof touchDataRevision_ === 'function') touchDataRevision_();
}
function showDeploymentGuide() {
const html = HtmlService.createHtmlOutput(
'<div style="font:14px Arial;padding:18px;line-height:1.6">' +
'<h2 style="margin-top:0">Deploy KOL Campaign Manager</h2>' +
'<ol><li>Open Apps Script → Deploy → New deployment.</li>' +
'<li>Type: <b>Web app</b>.</li>' +
'<li>Execute as: <b>User accessing the web app</b>.</li>' +
'<li>Who has access: <b>Anyone</b>.</li>' +
'<li>Deploy and open the generated URL.</li></ol>' +
'<p>Add every team member to the <b>USERS</b> tab before they open the app.</p>' +
'<p><b>Both settings above matter — the older version of this guide had them wrong.</b></p>' +
'<ul><li><b>User accessing</b>, not <i>Me</i>: every permission check reads ' +
'<code>Session.getActiveUser().getEmail()</code> to find the caller in USERS. Deployed ' +
'as <i>Me</i> that value is unreliable and the app refuses everyone with ' +
'&ldquo;Your Google account email could not be detected&rdquo;. The trade-off is real ' +
'and deliberate: every user therefore needs edit access to this spreadsheet and to the ' +
'contract Drive folder, so the sheet is <b>not</b> a confidentiality boundary.</li>' +
'<li><b>Anyone</b>, not <i>Anyone within your organization</i>: the creator information ' +
'form is opened by KOLs who have no account here, and <code>doGet</code> serves it ' +
'before any permission check for exactly that reason. Restricting to the organization ' +
'makes Google block those visitors before the script runs, which breaks creator ' +
'onboarding. Access is still controlled — anyone not listed in USERS is refused by ' +
'<code>getCurrentUser_()</code>.</li></ul></div>'
).setWidth(480).setHeight(360);
SpreadsheetApp.getUi().showModalDialog(html, 'Deployment guide');
}
function ensureHeaders_(sheet, headers) {
if (sheet.getMaxColumns() < headers.length) {
sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
}

// Existing databases may use an older valid schema. Add newly introduced
// columns in the correct position instead of asking the user to delete row 1.
// Inserting a column shifts the complete column (including data) to the right,
// so no existing creator/campaign data is overwritten.
let current = sheet.getRange(1, 1, 1, sheet.getMaxColumns()).getDisplayValues()[0]
.map(function (value) { return String(value).trim(); });
const hasAnyHeader = current.some(function (value) { return value !== ''; });
if (!hasAnyHeader) {
sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
return;
}

const seen = {};
current.forEach(function (header) {
if (!header) return;
if (seen[header]) {
throw new Error('Duplicate header "' + header + '" in sheet ' + sheet.getName() + '. Rename the duplicate column, then run setup again.');
}
seen[header] = true;
});

headers.forEach(function (expectedHeader, index) {
current = sheet.getRange(1, 1, 1, sheet.getMaxColumns()).getDisplayValues()[0]
.map(function (value) { return String(value).trim(); });
if (current[index] === expectedHeader) return;

const existingIndex = current.indexOf(expectedHeader);
if (existingIndex >= 0) {
throw new Error(
'Header order mismatch in sheet ' + sheet.getName() +
' near "' + expectedHeader + '". Keep the existing data and restore the standard header order, then run setup again.'
);
}

const hasContentAtTarget = current[index] !== '';
const hasContentToRight = current.slice(index + 1).some(function (value) { return value !== ''; });
if (hasContentAtTarget || hasContentToRight) {
sheet.insertColumnBefore(index + 1);
}
sheet.getRange(1, index + 1).setValue(expectedHeader);
});

sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}
function formatSheet_(sheet, headers) {
const headerRange = sheet.getRange(1, 1, 1, headers.length);
headerRange
.setBackground('#E9EEF8')
.setFontColor('#27344D')
.setFontWeight('bold')
.setHorizontalAlignment('center')
.setVerticalAlignment('middle');
sheet.setFrozenRows(1);
sheet.setRowHeight(1, 34);
headers.forEach(function (header, index) {
const col = index + 1;
let width = 130;
if (/URL|Notes|Objective|Summary|Details|Description/.test(header)) width = 230;
if (/ID$|_ID$/.test(header)) width = 145;
if (/Email|Username|Name/.test(header)) width = 170;
if (/Date|_At|Month/.test(header)) width = 120;
sheet.setColumnWidth(col, width);
const range = sheet.getRange(2, col, Math.max(1, sheet.getMaxRows() - 1), 1);
if (/Date|_At|Month/.test(header)) range.setNumberFormat('yyyy-mm-dd');
if (/_At$|Timestamp/.test(header)) range.setNumberFormat('yyyy-mm-dd hh:mm');
if (/Fee|Budget|Amount|Followers|Views|Likes|Comments|Shares|Saves|Tax/.test(header)) range.setNumberFormat('#,##0.##');
if (/Engagement_Rate/.test(header)) range.setNumberFormat('0.00%');
});
const existingFilter = sheet.getFilter();
if (existingFilter && (
existingFilter.getRange().getNumColumns() !== headers.length ||
existingFilter.getRange().getNumRows() < Math.max(2, sheet.getLastRow())
)) {
existingFilter.remove();
}
if (!sheet.getFilter()) {
sheet.getRange(1, 1, Math.max(2, sheet.getLastRow()), headers.length).createFilter();
}
}
function applyValidations_(sheet, headers) {
const rules = {
Market: LISTS.MARKETS,
Role: sheet.getName() === 'USERS' ? LISTS.USER_ROLES : LISTS.KOL_ROLES,
Platform: LISTS.PLATFORMS,
Currency: LISTS.CURRENCIES,
Active: LISTS.BOOLEAN,
Picked: LISTS.BOOLEAN,
Status: sheet.getName() === 'CAMPAIGNS' ? LISTS.CAMPAIGN_STATUSES :
sheet.getName() === 'SHORTLISTS' ? LISTS.SHORTLIST_STATUSES :
sheet.getName() === 'ACCEPTANCES' ? LISTS.ACCEPTANCE_STATUSES :
sheet.getName() === 'ACCEPTANCE_LINES' ? LISTS.ACCEPTANCE_LINE_STATUSES : null,
Review_Status: LISTS.REVIEW_STATUSES,
Booking_Status: LISTS.BOOKING_STATUSES,
Contract_Status: LISTS.CONTRACT_STATUSES,
Sign_Status: LISTS.CONTRACT_STATUSES,
Content_Status: LISTS.CONTENT_STATUSES,
Payment_Status: LISTS.PAYMENT_STATUSES,
};
headers.forEach(function (header, index) {
const values = rules[header];
if (!values) return;
const rule = SpreadsheetApp.newDataValidation()
.requireValueInList(values, true)
.setAllowInvalid(false)
.setHelpText('Select a value from the approved list.')
.build();
sheet.getRange(2, index + 1, Math.max(1, sheet.getMaxRows() - 1), 1).setDataValidation(rule);
});
}
function seedConfig_() {
const sheet = getSheet_('CONFIG');
const now = new Date();
const defaults = [
['APP_VERSION', APP.VERSION, 'Installed database version', now],
['COMPANY_NAME', 'SNOW', 'Company displayed in the web app', now],
['WORKSPACE_NAME', 'Creator Operations', 'Workspace label', now],
['DEFAULT_MARKET', 'VN', 'Default market filter', now],
['TIMEZONE', APP.TIMEZONE, 'Spreadsheet and application timezone', now],
['ALLOW_UNLISTED_USERS', 'FALSE', 'Keep FALSE for internal security', now],
['DEFAULT_APPS', 'SNOW,B612,Foodie,SODA,EPIK,LINE Camera', 'Available app names', now],
['KOL_SOURCE_SPREADSHEET_ID', '1wDiBOJSKkTysgsjgRpeRExVaQQXhiHw_FviC0e9M-rc', 'Default Google Sheet used by the KOL importer', now],
['TEMPLATE_VN_PLATFORMS', 'TikTok,Threads', 'Default platforms for VN campaigns', now],
['TEMPLATE_TH_PLATFORMS', 'TikTok,Instagram,X', 'Default platforms for TH campaigns', now],
['TEMPLATE_TW_PLATFORMS', 'Instagram,Threads', 'Default platforms for TW campaigns', now],
['TEMPLATE_VN_TARGET_KOLS', '20', 'Default KOL target for VN campaigns', now],
['TEMPLATE_TH_TARGET_KOLS', '20', 'Default KOL target for TH campaigns', now],
['TEMPLATE_TW_TARGET_KOLS', '20', 'Default KOL target for TW campaigns', now],
['FX_THB_VND', '=IFERROR(GOOGLEFINANCE("CURRENCY:THBVND"),750)', 'Live THB to VND conversion rate used in Campaign KOLs', now],
['FX_TWD_VND', '=IFERROR(GOOGLEFINANCE("CURRENCY:TWDVND"),800)', 'Live TWD to VND conversion rate used in Campaign KOLs', now],
];
const existingRows = sheet.getLastRow() > 1
? sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues()
: [];
const rowByKey = {};
existingRows.forEach(function (row, index) {
const key = String(row[0] || '').trim();
if (key) rowByKey[key] = index + 2;
});
const missing = [];
defaults.forEach(function (row) {
const key = row[0];
if (!rowByKey[key]) {
missing.push(row);
return;
}
if (key === 'APP_VERSION') {
// Sheets tự đọc '1.11.0' thành ngày — đó là lý do ô này đang hiện '1.10.2000'
// thay vì '1.10.0'. Ghim ô giá trị về dạng text trước khi ghi.
sheet.getRange(rowByKey[key], 2).setNumberFormat('@');
sheet.getRange(rowByKey[key], 2, 1, 3).setValues([[APP.VERSION, row[2], now]]);
}
});
if (missing.length) {
sheet.getRange(sheet.getLastRow() + 1, 1, missing.length, 4).setValues(missing);
}
}
function seedOwner_() {
const sheet = getSheet_('USERS');
if (sheet.getLastRow() > 1) return;
const email = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
if (!email) throw new Error('The owner email could not be determined. Add your email to USERS before deployment.');
const now = new Date();
sheet.appendRow([makeId_('USR'), email.toLowerCase(), 'Workspace Owner', 'Admin', 'Global', 'TRUE', now, now]);
}
// Ghi nho trong pham vi MOT lan thuc thi. Truoc day moi lan goi getSheet_ deu
// openById + getSheetByName lai tu dau; rieng mot lan luu KOL goi getSheet_ 5-6
// lan (2 lan cho ACCOUNTS trong updateRecordsById_, 1 cho CREATORS, 1 cho
// appendRecords_, 1 cho ACTIVITY_LOG). Apps Script tao lai bien global cho MOI
// request nen hai bien nay tu reset, khong can don thu cong.
// Dieu kien de dung: khong ham nao XOA roi tao lai sheet giua mot lan thuc thi.
// Da kiem: khong co deleteSheet o dau, va cac cho tao sheet (setupDatabase o
// day, ARCHIVE_SHEET, PERF_AUTO.LOG_SHEET) dung getSheetByName rieng chu khong
// qua getSheet_. Neu sau nay them cho xoa sheet thi phai reset hai bien nay.
let __spreadsheetForExecution_ = null;
let __sheetHandleCache_ = {};
function getSpreadsheet_() {
if (!__spreadsheetForExecution_) __spreadsheetForExecution_ = SpreadsheetApp.openById(APP.SPREADSHEET_ID);
return __spreadsheetForExecution_;
}
function getSheet_(sheetName) {
if (__sheetHandleCache_[sheetName]) return __sheetHandleCache_[sheetName];
const sheet = getSpreadsheet_().getSheetByName(sheetName);
if (!sheet) throw new Error('Missing required sheet: ' + sheetName + '. Run setupDatabase() first.');
__sheetHandleCache_[sheetName] = sheet;
return sheet;
}
function makeId_(prefix) {
const stamp = Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyMMddHHmmss');
const suffix = Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
return prefix + '-' + stamp + '-' + suffix;
}
/* ============================================================================
* BẢO TRÌ — chạy tay từ editor. Không phải API cho client.
* ========================================================================== */
/**
* Ghi lại công thức tỷ giá vào CONFIG. Chạy khi FX_THB_VND / FX_TWD_VND báo #ERROR!.
*
* Nguyên nhân gốc của #ERROR!: locale của spreadsheet này dùng dấu phẩy làm dấu
* thập phân, nên khi gõ tay Sheets đòi dấu phân cách đối số là ';'. Công thức cũ
* được gõ với ',' nên là lỗi PHÂN TÍCH CÚ PHÁP, không phải GOOGLEFINANCE hỏng —
* nếu GOOGLEFINANCE lỗi thì IFERROR đã bắt và trả về số dự phòng.
*
* setFormula() của Apps Script LUÔN nhận công thức theo locale US (dấu phẩy) và tự
* chuyển sang locale hiển thị, nên viết dấu phẩy ở đây là đúng và tránh hẳn cái bẫy.
*/
function repairConfigFxFormulas() {
requireRole_(['Admin']);
// Thử lần lượt từng biến thể và GIỮ cái đầu tiên không ra lỗi. Cần làm vậy vì
// biến thể dấu phẩy đã được chứng minh là vẫn #ERROR! trên sheet này, nên không
// thể đoán tiếp — phải đo. Ba biến thể cô lập được ba nguyên nhân khác nhau:
// dấu phân cách đối số, IFERROR, hay chính GOOGLEFINANCE.
const variants = {
FX_THB_VND: [
'=IFERROR(GOOGLEFINANCE("CURRENCY:THBVND"),750)',
'=IFERROR(GOOGLEFINANCE("CURRENCY:THBVND");750)',
'=GOOGLEFINANCE("CURRENCY:THBVND")',
'=GOOGLEFINANCE("CURRENCY:THBVND";"price")',
],
FX_TWD_VND: [
'=IFERROR(GOOGLEFINANCE("CURRENCY:TWDVND"),800)',
'=IFERROR(GOOGLEFINANCE("CURRENCY:TWDVND");800)',
'=GOOGLEFINANCE("CURRENCY:TWDVND")',
'=GOOGLEFINANCE("CURRENCY:TWDVND";"price")',
],
};
const sheet = getSheet_('CONFIG');
const lastRow = sheet.getLastRow();
if (lastRow < 2) throw new Error('CONFIG is empty.');
const keys = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
const report = { locale: getSpreadsheet_().getSpreadsheetLocale(), results: {} };

keys.forEach(function (row, index) {
const key = cleanText_(row[0]);
if (!variants[key]) return;
const cell = sheet.getRange(index + 2, 2);
const attempts = [];
let winner = null;
for (let i = 0; i < variants[key].length; i += 1) {
const formula = variants[key][i];
try {
cell.setFormula(formula);
SpreadsheetApp.flush();
} catch (error) {
attempts.push({ formula: formula, error: 'setFormula threw: ' + (error.message || String(error)) });
continue;
}
const shown = cleanText_(cell.getDisplayValue());
attempts.push({ formula: formula, shown: shown });
// Ô lỗi của Sheets luôn bắt đầu bằng '#'. Giá trị khác (kể cả "Loading…")
// nghĩa là công thức đã parse được.
if (shown && shown.charAt(0) !== '#') { winner = formula; break; }
}
if (winner) {
cell.setNumberFormat('0.##');
cell.setFormula(winner);
SpreadsheetApp.flush();
// CONFIG duoc cache toi 6 tieng, nen khong xoa cache thi ty gia vua sua se
// khong hien ra trong suot thoi gian do.
invalidateTableCache_('CONFIG');
} else {
// Không biến thể nào chạy: để lại ô TRỐNG chứ không để #ERROR!. Code đã có
// số dự phòng (750 / 800) và một ô trống thì toNumber_ đọc ra 0 rồi rơi về
// đúng số dự phòng đó — sạch hơn là để một ô lỗi gây hiểu nhầm.
cell.clearContent();
}
report.results[key] = {
winner: winner,
shown: cleanText_(cell.getDisplayValue()),
attempts: attempts,
};
});
SpreadsheetApp.flush();
invalidateTableCache_('CONFIG');
Logger.log(JSON.stringify(report, null, 1));
return report;
}
/**
* Các cột chỉ chứa NGÀY (không giờ). Cố ý loại các cột timestamp
* (Created_At, Updated_At, *_Submitted_At, Approved_At, Performance_Updated_At)
* vì chuẩn hoá về yyyy-MM-dd sẽ làm mất phần giờ.
*/
const REPAIR_DATE_COLUMNS = Object.freeze({
CAMPAIGNS: Object.freeze(['Start_Date', 'End_Date', 'Posting_Start', 'Posting_End']),
CAMPAIGN_KOLS: Object.freeze(['Posting_Date']),
DELIVERABLES: Object.freeze(['Draft_Due', 'Posting_Date']),
CONTRACTS: Object.freeze(['Sent_Date', 'Signed_Date', 'Due_Date']),
PAYMENTS: Object.freeze(['Due_Date', 'Payment_Date']),
ACCEPTANCES: Object.freeze(['Signed_Date']),
});
/**
* Chuẩn hoá các ô ngày đang lưu dưới dạng chuỗi về 'yyyy-MM-dd'.
*
* Dọn hậu quả của lỗi cũ: Posting_Date/Draft_Due từng được ghi bằng
* cleanText_(giá trị thô từ readTable_), nên tuỳ trạng thái cache mà ra
* "Sat Aug 01 2026 00:00:00 GMT+0700" hoặc ISO UTC "2026-07-31T17:00:00.000Z".
* Cả hai đều parse được và format lại theo giờ VN cho ra đúng ngày ban đầu.
*
* Chỉ sửa giá trị dạng CHUỖI. Ô đang là Date thật thì không mơ hồ, để nguyên.
* Ghi theo từng ô (không setValues cả vùng) để không đụng tới ô nào khác.
*/
function repairSheetDates_(apply) {
requireRole_(['Admin']);
const report = { apply: Boolean(apply), tables: {}, totalChanged: 0, samples: [] };
Object.keys(REPAIR_DATE_COLUMNS).forEach(function (sheetName) {
const headers = SCHEMA[sheetName];
if (!headers) return;
const sheet = getSheet_(sheetName);
const lastRow = sheet.getLastRow();
if (lastRow < 2) return;
const grid = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
const edits = [];
REPAIR_DATE_COLUMNS[sheetName].forEach(function (column) {
const index = headers.indexOf(column);
if (index < 0) return;
grid.forEach(function (row, rowIndex) {
const value = row[index];
if (typeof value !== 'string') return;
const text = value.trim();
if (!text) return;
if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return;
const parsed = parseDate_(text);
if (!parsed) return;
const normalized = Utilities.formatDate(parsed, APP.TIMEZONE, 'yyyy-MM-dd');
if (normalized === text) return;
if (report.samples.length < 15) {
report.samples.push(sheetName + '.' + column + ' row ' + (rowIndex + 2) + ': "' + text + '" -> ' + normalized);
}
edits.push({ row: rowIndex + 2, col: index + 1, value: normalized });
});
});
if (!edits.length) return;
report.tables[sheetName] = edits.length;
report.totalChanged += edits.length;
if (apply) {
edits.forEach(function (edit) {
const cell = sheet.getRange(edit.row, edit.col);
cell.setNumberFormat('yyyy-mm-dd');
cell.setValue(edit.value);
});
invalidateTableCache_(sheetName);
}
});
if (apply && report.totalChanged) {
SpreadsheetApp.flush();
touchDataRevision_();
}
Logger.log(JSON.stringify(report, null, 1));
return report;
}
/** XEM TRƯỚC — không ghi gì. Chạy hàm này trước. */
function previewSheetDateRepair() { return repairSheetDates_(false); }
/** ÁP DỤNG — ghi lại các ô ngày đã chuẩn hoá. Chỉ chạy sau khi đã xem preview. */
function applySheetDateRepair() { return repairSheetDates_(true); }
