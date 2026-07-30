/**
 * SNOW Vietnam contract generator for KOL Manager.
 *
 * This module intentionally supports VN campaigns only. It reuses the
 * production Google Docs template and output folder from the existing
 * [SNOWVN] contract system while taking data from the KOL Manager tables.
 */
// ĐÃ NGHỈ HƯU (2026-07-30, F29) — bản thay thế là generateContractV2 trong
// ContractHub.gs, và UI đã trỏ sang đó. KHÔNG xoá được cả file: ContractHub.gs phụ
// thuộc numberToVietnameseCurrencyContract_ ở dưới.
// Hai lý do phải rút khỏi tầm với của client:
//   1. nextContractNumber_ cấp số bằng max(đã có)+1, không có counter đặt trước và
//      không đọc lại trong lock — hai lệnh gọi cách nhau vài giây sinh ra HAI hợp
//      đồng thật mang CÙNG một Contract_No.
//   2. dòng `fee = toNumber_(Final_Fee) || toNumber_(Quoted_Fee)` dùng `||`, nên một
//      deal barter hợp lệ (Final_Fee = 0) âm thầm rơi về giá quote — đúng cái bug mà
//      campaignKolNetAmount_ được viết ra để tránh.
function generateContract_(payload) {
const user = requireRole_(['Admin', 'Booking']);
payload = payload || {};
const campaignKolId = cleanText_(payload.Campaign_KOL_ID);
const campaignKol = findRecord_('CAMPAIGN_KOLS', 'Campaign_KOL_ID', campaignKolId);
if (!campaignKol) throw new Error('Campaign KOL not found: ' + campaignKolId);
const campaign = findRecord_('CAMPAIGNS', 'Campaign_ID', campaignKol.Campaign_ID);
if (!campaign) throw new Error('Campaign not found.');
assertCampaignAccess_(user, campaign);
if (normalizeMarket_(campaign.Market) !== 'VN') {
throw new Error('Contract generation is available for Vietnam campaigns only.');
}
const account = findRecord_('ACCOUNTS', 'Account_ID', campaignKol.Account_ID) || {};
const creator = findRecord_('CREATORS', 'Creator_ID', campaignKol.Creator_ID || account.Creator_ID);
if (!creator) throw new Error('Creator profile not found.');
const missing = CONTRACT_REQUIRED_CREATOR_FIELDS.filter(function (field) {
return !cleanText_(creator[field]);
});
if (missing.length) {
throw new Error('Creator legal information is incomplete: ' + missing.join(', ') + '. Update the KOL full profile before generating the contract.');
}
const fee = toNumber_(campaignKol.Final_Fee) || toNumber_(campaignKol.Quoted_Fee);
const codeAdFee = Math.max(0, toNumber_(campaignKol.Code_Ad_Fee));
const netWithCodeAd = fee + codeAdFee;
if (netWithCodeAd <= 0) throw new Error('Net amount plus Code ad fee must be greater than 0.');
return withDocumentLock_(function () {
const existing = readTable_('CONTRACTS').filter(function (row) {
return row.Campaign_KOL_ID === campaignKolId && cleanText_(row.Contract_URL);
});
if (existing.length) {
const latest = existing[existing.length - 1];
return publicValue_({
reused: true,
Contract_ID: latest.Contract_ID,
Contract_No: latest.Contract_No,
Contract_URL: latest.Contract_URL,
Contract_PDF_URL: latest.Contract_PDF_URL,
});
}
const now = new Date();
const gross = campaignKolGrossAmount_(campaignKol);
const tax = Math.max(0, gross - netWithCodeAd);
const serial = nextContractNumber_();
const year = now.getFullYear();
const contractNo = CONTRACT_CONFIG.CONTRACT_YEAR_PREFIX + serial + '/' + year;
const fields = {
'No': serial,
'Contract no': contractNo,
'Creator': account.Username || creator.Display_Name || '',
'Title': creator.Title || '',
'Full name': creator.Legal_Name || '',
'Link profile': account.Profile_URL || '',
'Apps': campaign.App || '',
'Platforms': account.Platform || campaign.Platforms || '',
'Day': padTwoDigitsContract_(now.getDate()),
'Month': padTwoDigitsContract_(now.getMonth() + 1),
'Year': String(year),
'Date': padTwoDigitsContract_(now.getDate()) + '/' + padTwoDigitsContract_(now.getMonth() + 1) + '/' + year,
'ID No': creator.ID_No || '',
'Date of issue': workspaceContractDate_(creator.Date_Of_Issue),
'Permanent address': creator.Permanent_Address || '',
'Bank account': creator.Bank_Account || '',
'Bank name': creator.Bank_Name || '',
'Qty': 1,
'Unit Price': formatMoneyContract_(netWithCodeAd),
'Net': formatMoneyContract_(netWithCodeAd),
'Net in words': numberToVietnameseCurrencyContract_(netWithCodeAd),
'Tax': formatMoneyContract_(tax),
'Tax in words': numberToVietnameseCurrencyContract_(tax),
'Gross': formatMoneyContract_(gross),
'Gross in words': numberToVietnameseCurrencyContract_(gross),
'Duedate': workspaceContractDate_(campaign.Posting_End || campaign.End_Date),
};
const folderName = sanitizeDriveNameContract_(serial + ' - ' + (creator.Legal_Name || creator.Display_Name || account.Username || 'Creator'));
const rootFolder = DriveApp.getFolderById(CONTRACT_CONFIG.OUTPUT_FOLDER_ID);
const folderMatches = rootFolder.getFoldersByName(folderName);
const folder = folderMatches.hasNext() ? folderMatches.next() : rootFolder.createFolder(folderName);
const fileName = sanitizeDriveNameContract_('[SNOWVN] ' + contractNo + '_' + (account.Username || creator.Display_Name || 'Creator'));
const docFile = DriveApp.getFileById(CONTRACT_CONFIG.TEMPLATE_ID).makeCopy(fileName, folder);
try {
const document = DocumentApp.openById(docFile.getId());
replaceContractPlaceholders_(document, fields);
document.saveAndClose();
Utilities.sleep(800);
const pdfName = fileName + '.pdf';
const previousPdfs = folder.getFilesByName(pdfName);
while (previousPdfs.hasNext()) previousPdfs.next().setTrashed(true);
const pdfFile = folder.createFile(docFile.getAs(MimeType.PDF).setName(pdfName));
const record = {
Contract_ID: makeId_('CTR'),
Campaign_KOL_ID: campaignKolId,
Campaign_ID: campaign.Campaign_ID,
Creator_ID: creator.Creator_ID,
Contract_No: contractNo,
Template_Name: 'SNOW VN Standard',
Contract_URL: docFile.getUrl(),
Sign_Status: 'Draft',
Sent_Date: '',
Signed_Date: '',
Due_Date: campaign.Posting_End || campaign.End_Date || '',
Owner_Email: user.Email,
Notes: '',
Created_At: now,
Updated_At: now,
Contract_PDF_URL: pdfFile.getUrl(),
Folder_URL: folder.getUrl(),
};
appendRecord_('CONTRACTS', record);
updateRecord_('CAMPAIGN_KOLS', 'Campaign_KOL_ID', campaignKolId, {
Contract_Status: 'Draft',
Updated_At: now,
});
logActivity_(user.Email, 'GENERATE_CONTRACT', 'CONTRACT', record.Contract_ID, contractNo + ' · ' + campaignKolId);
return publicValue_({
reused: false,
Contract_ID: record.Contract_ID,
Contract_No: contractNo,
Contract_URL: record.Contract_URL,
Contract_PDF_URL: record.Contract_PDF_URL,
});
} catch (error) {
try { docFile.setTrashed(true); } catch (ignored) {}
throw new Error('Contract generation failed: ' + (error.message || String(error)));
}
});
}

function nextContractNumber_() {
let maxNumber = 0;
readTable_('CONTRACTS').forEach(function (row) {
const match = cleanText_(row.Contract_No).match(/SNOWVN-(\d+)\//i);
if (match) maxNumber = Math.max(maxNumber, Number(match[1]) || 0);
});
// Keep numbering compatible with the existing [SNOWVN] contract tracker.
// A missing permission must not block generation; the local table remains the
// fallback source until the deployment owner authorizes the reference Sheet.
try {
const source = SpreadsheetApp.openById(CONTRACT_CONFIG.SOURCE_SPREADSHEET_ID);
const sheet = source.getSheetByName(CONTRACT_CONFIG.SOURCE_SHEET_NAME);
if (sheet && sheet.getLastRow() > 1 && sheet.getLastColumn() > 0) {
const values = sheet.getDataRange().getDisplayValues();
const headers = values.shift().map(function (value) { return cleanText_(value).toLowerCase(); });
const noIndex = headers.indexOf('no');
const contractNoIndex = headers.indexOf('contract no');
values.forEach(function (row) {
if (noIndex >= 0) maxNumber = Math.max(maxNumber, Number(String(row[noIndex] || '').replace(/\D/g, '')) || 0);
if (contractNoIndex >= 0) {
const match = cleanText_(row[contractNoIndex]).match(/SNOWVN-(\d+)\//i);
if (match) maxNumber = Math.max(maxNumber, Number(match[1]) || 0);
}
});
}
} catch (error) {
console.warn('Reference contract number lookup skipped: ' + (error.message || String(error)));
}
return String(maxNumber + 1).padStart(CONTRACT_CONFIG.NO_MIN_DIGITS, '0');
}

function padTwoDigitsContract_(value) {
return String(Math.max(0, Math.floor(Number(value) || 0))).padStart(2, '0');
}

function formatMoneyContract_(value) {
const number = Number(value);
return isNaN(number) ? '' : Math.round(number).toLocaleString('en-US');
}

function sanitizeDriveNameContract_(name) {
return String(name || '').replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 140);
}

function workspaceContractDate_(value) {
const date = parseDate_(value);
return date ? Utilities.formatDate(date, APP.TIMEZONE, 'dd/MM/yyyy') : cleanText_(value);
}

function replaceContractPlaceholders_(document, fields) {
const containers = [document.getBody(), document.getHeader(), document.getFooter()].filter(Boolean);
Object.keys(fields).forEach(function (name) {
const placeholder = ('{{' + name + '}}').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const replacement = fields[name] === null || fields[name] === undefined ? '' : String(fields[name]);
containers.forEach(function (container) { container.replaceText(placeholder, replacement); });
});
}

function numberToVietnameseCurrencyContract_(value) {
const number = Math.round(Number(value));
if (isNaN(number)) return '';
if (number === 0) return 'Không đồng';
const text = (number < 0 ? 'âm ' : '') + numberToVietnameseWordsContract_(Math.abs(number)) + ' đồng';
return text.charAt(0).toUpperCase() + text.slice(1);
}

function numberToVietnameseWordsContract_(number) {
const scales = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ', 'tỷ tỷ'];
const groups = [];
let remaining = number;
while (remaining > 0) {
groups.push(remaining % 1000);
remaining = Math.floor(remaining / 1000);
}
const parts = [];
for (let index = groups.length - 1; index >= 0; index -= 1) {
if (!groups[index]) continue;
const words = readThreeDigitsContract_(groups[index], parts.length > 0 && groups[index] < 100);
if (words) parts.push(words);
if (scales[index]) parts.push(scales[index]);
}
return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function readThreeDigitsContract_(number, useFullReading) {
const digits = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const hundreds = Math.floor(number / 100);
const tens = Math.floor((number % 100) / 10);
const units = number % 10;
const words = [];
if (hundreds > 0) words.push(digits[hundreds], 'trăm');
else if (useFullReading && (tens > 0 || units > 0)) words.push('không', 'trăm');
if (tens > 1) {
words.push(digits[tens], 'mươi');
if (units === 1) words.push('mốt');
else if (units === 4) words.push('tư');
else if (units === 5) words.push('lăm');
else if (units > 0) words.push(digits[units]);
} else if (tens === 1) {
words.push('mười');
if (units === 5) words.push('lăm');
else if (units > 0) words.push(digits[units]);
} else if (units > 0) {
if (hundreds > 0 || useFullReading) words.push('lẻ');
words.push(digits[units]);
}
return words.join(' ');
}
