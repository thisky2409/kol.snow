/**
 * KOL Campaign Manager v1.5.1 — Experience, Shortlist and Calendar API.
 */

function updateShortlistKol(payload) {
  const user = requireRole_(['Admin', 'Booking', 'Marketing']);
  payload = payload || {};
  const id = cleanText_(payload.Shortlist_KOL_ID);
  const member = findRecord_('SHORTLIST_KOLS', 'Shortlist_KOL_ID', id);
  if (!member) throw new Error('KOL not found in shortlist.');
  const shortlist = findRecord_('SHORTLISTS', 'Shortlist_ID', member.Shortlist_ID);
  if (!shortlist) throw new Error('Shortlist not found.');
  assertMarketAccess_(user, shortlist.Market);
  const status = cleanText_(payload.Review_Status) || member.Review_Status || 'New';
  if (LISTS.REVIEW_STATUSES.indexOf(status) === -1) throw new Error('Invalid shortlist review status.');
  const changes = {
    Review_Status: status,
    Picked: status === 'Approved' ? 'TRUE' : (Object.prototype.hasOwnProperty.call(payload, 'Picked') ? (isTrue_(payload.Picked) ? 'TRUE' : 'FALSE') : member.Picked),
    Reviewer_Email: cleanText_(payload.Reviewer_Email) || user.Email,
    Notes: cleanText_(payload.Notes),
    Updated_At: new Date(),
  };
  return withDocumentLock_(function () {
    const updated = updateRecord_('SHORTLIST_KOLS', 'Shortlist_KOL_ID', id, changes);
    logActivity_(user.Email, 'UPDATE', 'SHORTLIST_KOL', id, status);
    return publicValue_(updated);
  });
}

function removeShortlistKol(payload) {
  const user = requireRole_(['Admin', 'Booking', 'Marketing']);
  payload = payload || {};
  const id = cleanText_(payload.Shortlist_KOL_ID);
  const member = findRecord_('SHORTLIST_KOLS', 'Shortlist_KOL_ID', id);
  if (!member) throw new Error('KOL not found in shortlist.');
  const shortlist = findRecord_('SHORTLISTS', 'Shortlist_ID', member.Shortlist_ID);
  if (!shortlist) throw new Error('Shortlist not found.');
  assertMarketAccess_(user, shortlist.Market);
  return withDocumentLock_(function () {
    deleteRecordById_('SHORTLIST_KOLS', 'Shortlist_KOL_ID', id);
    logActivity_(user.Email, 'REMOVE', 'SHORTLIST_KOL', id, member.Shortlist_ID);
    return { removed: true, Shortlist_KOL_ID: id };
  });
}

function getCalendarData(payload) {
  const user = getCurrentUser_();
  payload = payload || {};
  const now = new Date();
  const year = Math.max(2000, Math.min(2100, Math.round(toNumber_(payload.year) || now.getFullYear())));
  const month = Math.max(1, Math.min(12, Math.round(toNumber_(payload.month) || now.getMonth() + 1)));
  const rangeStart = new Date(year, month - 1, 1);
  const rangeEnd = new Date(year, month, 0, 23, 59, 59, 999);
  const campaigns = listCampaigns_(user).filter(function (campaign) {
    const start = parseDate_(campaign.Start_Date || campaign.Posting_Start);
    const end = parseDate_(campaign.End_Date || campaign.Posting_End || campaign.Start_Date || campaign.Posting_Start);
    return start && end && start <= rangeEnd && end >= rangeStart;
  });
  const campaignById = indexBy_(campaigns, 'Campaign_ID');
  const campaignIds = {};
  campaigns.forEach(function (campaign) { campaignIds[campaign.Campaign_ID] = true; });
  const accounts = indexBy_(readTable_('ACCOUNTS'), 'Account_ID');
  const creators = indexBy_(readTable_('CREATORS'), 'Creator_ID');
  const campaignKols = readTable_('CAMPAIGN_KOLS').filter(function (row) {
    return campaignIds[row.Campaign_ID];
  });
  const campaignKolById = indexBy_(campaignKols, 'Campaign_KOL_ID');
  const used = {};
  const posts = [];

  readTable_('DELIVERABLES').forEach(function (row) {
    const postingDate = parseDate_(row.Posting_Date);
    if (!campaignIds[row.Campaign_ID] || !postingDate || postingDate < rangeStart || postingDate > rangeEnd) return;
    const campaignKol = campaignKolById[row.Campaign_KOL_ID] || {};
    const account = accounts[row.Account_ID || campaignKol.Account_ID] || {};
    const creator = creators[campaignKol.Creator_ID || account.Creator_ID] || {};
    const key = row.Campaign_KOL_ID + '|' + Utilities.formatDate(postingDate, APP.TIMEZONE, 'yyyy-MM-dd');
    used[key] = true;
    posts.push({
      Deliverable_ID: row.Deliverable_ID,
      Campaign_KOL_ID: row.Campaign_KOL_ID,
      Campaign_ID: row.Campaign_ID,
      Campaign_Name: (campaignById[row.Campaign_ID] || {}).Campaign_Name || '',
      App: (campaignById[row.Campaign_ID] || {}).App || '',
      Market: (campaignById[row.Campaign_ID] || {}).Market || account.Market || '',
      Creator_Name: creator.Display_Name || creator.Legal_Name || account.Username || '',
      Username: account.Username || '',
      Platform: row.Platform || account.Platform || '',
      Posting_Date: row.Posting_Date,
      Content_Status: row.Content_Status || campaignKol.Content_Status || 'Not started',
      Post_URL: row.Post_URL || campaignKol.Post_URL || '',
    });
  });

  campaignKols.forEach(function (row) {
    const postingDate = parseDate_(row.Posting_Date);
    if (!postingDate || postingDate < rangeStart || postingDate > rangeEnd) return;
    const key = row.Campaign_KOL_ID + '|' + Utilities.formatDate(postingDate, APP.TIMEZONE, 'yyyy-MM-dd');
    if (used[key]) return;
    const account = accounts[row.Account_ID] || {};
    const creator = creators[row.Creator_ID || account.Creator_ID] || {};
    posts.push({
      Deliverable_ID: '',
      Campaign_KOL_ID: row.Campaign_KOL_ID,
      Campaign_ID: row.Campaign_ID,
      Campaign_Name: (campaignById[row.Campaign_ID] || {}).Campaign_Name || '',
      App: (campaignById[row.Campaign_ID] || {}).App || '',
      Market: (campaignById[row.Campaign_ID] || {}).Market || account.Market || '',
      Creator_Name: creator.Display_Name || creator.Legal_Name || account.Username || '',
      Username: account.Username || '',
      Platform: account.Platform || '',
      Posting_Date: row.Posting_Date,
      Content_Status: row.Content_Status || 'Not started',
      Post_URL: row.Post_URL || '',
    });
  });
  posts.sort(function (a, b) { return String(a.Posting_Date).localeCompare(String(b.Posting_Date)); });
  campaigns.sort(function (a, b) {
    return String(a.Start_Date || a.Posting_Start).localeCompare(String(b.Start_Date || b.Posting_Start));
  });
  return publicValue_({ year: year, month: month, campaigns: campaigns, posts: posts });
}

/**
 * Tự giữ lock thay vì tin mọi caller sẽ bọc hộ: deleteRow DỊCH mọi dòng bên dưới
 * lên một bậc, nên nếu chạy song song với một writer khác thì chỉ số dòng mà
 * writer đó đang giữ (rowNumberIndex_) trỏ sai và nó ghi vào ĐÚNG dòng khác.
 * withDocumentLock_ đếm độ sâu nên lồng trong lock của caller là miễn phí.
 */
function deleteRecordById_(sheetName, idField, id) {
  return withDocumentLock_(function () {
    const sheet = getSheet_(sheetName);
    if (sheet.getLastRow() < 2) throw new Error('Record not found.');
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    const column = headers.indexOf(idField) + 1;
    if (!column) throw new Error('Missing ID column: ' + idField);
    const values = sheet.getRange(2, column, sheet.getLastRow() - 1, 1).getDisplayValues();
    for (let index = 0; index < values.length; index += 1) {
      if (cleanText_(values[index][0]) === id) {
        sheet.deleteRow(index + 2);
        invalidateTableCache_(sheetName);
        // Xoá dòng làm mọi dòng bên dưới đổi số, nên chỉ số id -> số dòng đã cũ.
        // appendRecord_ xoá chỉ số này vì đúng lý do đó; ở đây trước giờ bị thiếu.
        invalidateRowNumberIndex_(sheetName);
        // Thiếu bước này thì dashboard và accountLookup_/creatorLookup_ (khoá cache
        // theo revision) vẫn còn đếm bản ghi vừa xoá tới 5 phút, và
        // getCampaignWorkspaceSync báo "không có gì đổi".
        touchDataRevision_();
        return true;
      }
    }
    throw new Error('Record not found: ' + id);
  });
}
