/**
 * ============================================================================
 * KOL Campaign Manager v1.11.0 — AdminApi.gs
 * ----------------------------------------------------------------------------
 * PASTE AS: new Apps Script file named  AdminApi.gs
 * (Bound project of spreadsheet APP.SPREADSHEET_ID, alongside Code.gs / Setup.gs)
 *
 * Adds two things the app was missing:
 *
 *   PHASE 1 — Safe delete / archive APIs
 *     deleteCampaign, deleteShortlist, deleteDeliverable,
 *     deleteContractRecord, deletePaymentRecord, removeCampaignKol
 *     Every delete is cascading, archived to DELETED_ARCHIVE, and logged.
 *
 *   PHASE 2 — User & role management + audit log
 *     getAdminData, createUser, updateUser, setUserActive, getActivityLog
 *
 * Depends only on helpers that already exist in Setup.gs / Code.gs / ExperienceApi.gs:
 *   APP, SCHEMA, LISTS, getSheet_, getSpreadsheet_, makeId_, readTable_,
 *   findRecord_, indexBy_, appendRecord_, updateRecord_, invalidateTableCache_,
 *   touchDataRevision_, withDocumentLock_, requireRole_, getCurrentUser_,
 *   canAccessCampaign_, assertCampaignAccess_, logActivity_, publicValue_,
 *   cleanText_, normalizeMarket_, isTrue_, toNumber_, requireFields_, mergeObjects_
 * ============================================================================
 */

/* ----------------------------------------------------------------------------
 * Configuration
 * -------------------------------------------------------------------------- */

const ADMIN_CONFIG = Object.freeze({
  ARCHIVE_SHEET: 'DELETED_ARCHIVE',
  ARCHIVE_HEADERS: Object.freeze([
    'Archive_ID', 'Deleted_At', 'Deleted_By', 'Entity_Type', 'Entity_ID',
    'Label', 'Child_Counts', 'Payload_JSON',
  ]),
  // Rows above this size are archived as a summary only, to stay under the
  // 50,000 character per-cell limit in Google Sheets.
  MAX_PAYLOAD_CHARS: 45000,
  ACTIVITY_PAGE_SIZE: 200,
});

/* Which child tables cascade from which parent, and on which foreign key. */
// ACCEPTANCES/ACCEPTANCE_LINES (v1.11.0) trước đây không có ở đây, nên xoá một
// campaign có BBNT sẽ để lại BBNT mồ côi trỏ vào Contract_ID/Campaign_ID không
// còn tồn tại: vô hình trên UI, làm generateAcceptance báo lỗi, vẫn tính vào
// contractHighestExistingSerial_, và KHÔNG nằm trong archive nên không phục hồi được.
//
// ACCEPTANCE_LINES không có Campaign_ID hay Campaign_KOL_ID — nó chỉ nối qua
// Acceptance_ID / Contract_ID / Deliverable_ID. Với những chỗ đó dùng `viaSheet`
// để xoá theo id gom được từ bảng con đã xoá ở bước trước (xem adminCascadeDelete_).
const ADMIN_CASCADE = Object.freeze({
  CAMPAIGNS: Object.freeze([
    { sheet: 'CONTENT_FEEDBACK', key: 'Campaign_ID' },
    { sheet: 'DELIVERABLES', key: 'Campaign_ID' },
    { sheet: 'ACCEPTANCES', key: 'Campaign_ID' },
    { sheet: 'ACCEPTANCE_LINES', key: 'Acceptance_ID', viaSheet: 'ACCEPTANCES', viaField: 'Acceptance_ID' },
    { sheet: 'CONTRACTS', key: 'Campaign_ID' },
    { sheet: 'PAYMENTS', key: 'Campaign_ID' },
    { sheet: 'CAMPAIGN_KOLS', key: 'Campaign_ID' },
    { sheet: 'NOTIFICATIONS', key: 'Campaign_ID' },
  ]),
  CAMPAIGN_KOLS: Object.freeze([
    { sheet: 'CONTENT_FEEDBACK', key: 'Campaign_KOL_ID' },
    { sheet: 'DELIVERABLES', key: 'Campaign_KOL_ID' },
    { sheet: 'ACCEPTANCES', key: 'Campaign_KOL_ID' },
    { sheet: 'ACCEPTANCE_LINES', key: 'Acceptance_ID', viaSheet: 'ACCEPTANCES', viaField: 'Acceptance_ID' },
    { sheet: 'CONTRACTS', key: 'Campaign_KOL_ID' },
    { sheet: 'PAYMENTS', key: 'Campaign_KOL_ID' },
  ]),
  SHORTLISTS: Object.freeze([
    { sheet: 'SHORTLIST_KOLS', key: 'Shortlist_ID' },
  ]),
  DELIVERABLES: Object.freeze([
    { sheet: 'CONTENT_FEEDBACK', key: 'Deliverable_ID' },
    { sheet: 'ACCEPTANCE_LINES', key: 'Deliverable_ID' },
  ]),
  CONTRACTS: Object.freeze([
    { sheet: 'ACCEPTANCES', key: 'Contract_ID' },
    { sheet: 'ACCEPTANCE_LINES', key: 'Contract_ID' },
  ]),
});

/* ============================================================================
 * SECTION 1 — Batch delete + archive plumbing
 * ========================================================================== */

/**
 * Deletes every row of `sheetName` whose `field` matches one of `values`.
 * Single batched pass: reads once, deletes bottom-up so row indexes stay valid.
 * Returns the deleted row objects (so callers can archive them).
 */
function adminDeleteRowsWhere_(sheetName, field, values) {
  const wanted = {};
  (Array.isArray(values) ? values : [values])
    .map(function (value) { return cleanText_(value); })
    .filter(Boolean)
    .forEach(function (value) { wanted[value] = true; });
  if (!Object.keys(wanted).length) return [];

  const headers = SCHEMA[sheetName];
  if (!headers) throw new Error('Schema not found: ' + sheetName);
  const fieldIndex = headers.indexOf(field);
  if (fieldIndex < 0) throw new Error('Field not found on ' + sheetName + ': ' + field);

  const sheet = getSheet_(sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const grid = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const removed = [];
  const rowNumbers = [];
  grid.forEach(function (row, index) {
    if (!wanted[cleanText_(row[fieldIndex])]) return;
    const object = {};
    headers.forEach(function (header, column) { object[header] = row[column]; });
    removed.push(object);
    rowNumbers.push(index + 2);
  });
  if (!rowNumbers.length) return [];

  // Delete contiguous blocks bottom-up: far fewer API calls than row-by-row.
  const blocks = [];
  rowNumbers.forEach(function (rowNumber) {
    const last = blocks[blocks.length - 1];
    if (last && rowNumber === last.start + last.count) last.count += 1;
    else blocks.push({ start: rowNumber, count: 1 });
  });
  blocks.reverse().forEach(function (block) {
    sheet.deleteRows(block.start, block.count);
  });

  invalidateTableCache_(sheetName);
  // deleteRows DỊCH mọi dòng bên dưới lên, nên chỉ số id -> số dòng đã sai ngay sau
  // đó; một updateRecord_ trên CÙNG sheet trong CÙNG lần thực thi sẽ ghi vào SAI
  // DÒNG. appendRecord_ xoá chỉ số này vì đúng lý do đó. Đã kiểm 7 đường xoá hiện
  // tại: không đường nào update lại cùng sheet sau khi xoá, nên đây là bịt trước
  // (giống F08), không phải sửa lỗi đang xảy ra.
  invalidateRowNumberIndex_(sheetName);
  touchDataRevision_();
  return removed;
}

/**
 * CAMPAIGN_KOLS phản chiếu trạng thái từ CONTRACTS / PAYMENTS / DELIVERABLES và
 * KHÔNG có job nào đối soát lại. Xoá bản ghi con mà không dọn phần phản chiếu thì
 * dòng KOL còn nói 'Paid' trong khi đã không còn payment nào — pendingPayments của
 * getCampaignWorkspace và danh sách Operations lệch nhau vĩnh viễn.
 *
 * HAI trường hợp, chủ project đã quyết 2026-07-30:
 *
 *  1. KHÔNG CÒN dòng con nào -> giá trị phản chiếu chắc chắn sai, đặt về trạng thái
 *     khởi tạo ('Not started').
 *  2. VẪN CÒN dòng con -> LUẬT C: dòng con có Updated_At MỚI NHẤT thắng.
 *
 * Vì sao luật C chứ không phải "trạng thái tiến xa nhất" hay "trạng thái kém nhất":
 * luật C là luật DUY NHẤT không đặt ra nghĩa nghiệp vụ mới. Cả 11 writer hiện tại đều
 * là ghi-sau-thắng, mà ghi-sau-thắng CHÍNH LÀ "Updated_At mới nhất" — nên ở đây chỉ
 * tính lại đúng câu trả lời cũ sau khi xoá, thay vì để một giá trị đã mồ côi.
 * "Tiến xa nhất" sẽ ẩn việc còn tồn đọng (một deliverable Posted + một Not started ra
 * Posted, làm hụt bộ đếm cần-xử-lý). "Kém nhất" thì ngược lại: một KOL đã trả xong hai
 * kỳ cộng một kỳ Not started sẽ thành Not started, và getCollaborationHistory lọc theo
 * Payment_Status === 'Paid' nên công việc đã hoàn thành sẽ BIẾN MẤT khỏi màn hình lịch
 * sử. Cả hai đều sai theo một chiều đoán trước được.
 * Phân tích đầy đủ: docs/f18-mirror-reconciliation-decision-note.md.
 *
 * NGOÀI phạm vi luật C, cố ý: Posting_Date và Post_URL. updateCampaignKol cho phép gõ
 * TRỰC TIẾP hai cột này trên dòng KOL, nên lấy giá trị từ một deliverable khác sẽ ghi
 * đè lên dữ liệu người dùng tự nhập. Chúng giữ hành vi hẹp cũ: chỉ xoá khi đang trỏ
 * đúng vào dòng vừa bị xoá.
 *
 * CŨNG ngoài phạm vi: đường EDIT. Mỗi writer chỉ nhìn dòng của chính nó, nên sửa (chứ
 * không xoá) một dòng con vẫn để lại lệch y như vậy. Sửa trọn nghĩa là gọi một
 * recompute từ CẢ 11 writer — rộng hơn F18 nhiều và nằm trên đường tiền, nên phải là
 * một thay đổi riêng. Ghi ở đây để đây là một quyết định, không phải chỗ bỏ sót.
 */
/**
 * LUẬT C, dạng thuần: trong `rows`, dòng nào có Updated_At mới nhất?
 *
 * Hoà thì lấy `idField` lớn nhất theo so sánh chuỗi — thuần để KẾT QUẢ TIỀN ĐỊNH.
 * Hoà là chuyện có thật, không phải giả định: appendRecords_ và updateRecordsById_ ghi
 * cả lô trong cùng một giây, và makeId_ chỉ mịn tới giây (PREFIX-yyMMddHHmmss-XXXXXX).
 * Không có tiebreak thì thứ tự dòng trong sheet quyết định, và nó đổi sau mỗi lần xoá.
 *
 * So sánh qua timeValue_ chứ KHÔNG so chuỗi trực tiếp: cột date-only trong sheet này
 * có thể đang giữ tới ba dạng biểu diễn khác nhau (Date thật, 'Sat Aug 01 2026...',
 * '2026-07-31T17:00:00.000Z'), nên so chuỗi sẽ xếp sai thứ tự.
 * Tách riêng thành hàm thuần để test_adminLatestByUpdatedAt_ phủ được.
 */
function adminLatestByUpdatedAt_(rows, idField) {
  let best = null;
  (rows || []).forEach(function (row) {
    if (!best) { best = row; return; }
    const a = timeValue_(row.Updated_At);
    const b = timeValue_(best.Updated_At);
    if (a > b) { best = row; return; }
    if (a === b && String(row[idField] || '') > String(best[idField] || '')) best = row;
  });
  return best;
}

function adminResyncCampaignKolMirrors_(tables) {
  const affected = {};
  ['CONTRACTS', 'PAYMENTS', 'DELIVERABLES'].forEach(function (sheetName) {
    (tables[sheetName] || []).forEach(function (row) {
      const id = cleanText_(row.Campaign_KOL_ID);
      if (id) affected[id] = true;
    });
  });
  const ids = Object.keys(affected);
  if (!ids.length) return {};

  // Đọc lại: adminDeleteRowsWhere_ vừa xoá cache, nhưng phải chắc chắn không lấy
  // bản đã nạp trước khi xoá.
  invalidateTableCache_('CAMPAIGN_KOLS');
  const survivors = indexBy_(readTable_('CAMPAIGN_KOLS'), 'Campaign_KOL_ID');
  const remaining = {
    CONTRACTS: readTable_('CONTRACTS'),
    PAYMENTS: readTable_('PAYMENTS'),
    DELIVERABLES: readTable_('DELIVERABLES'),
  };
  // Nhóm theo Campaign_KOL_ID một lần. Trước đây chỉ cần some() để trả lời "còn dòng
  // con nào không"; luật C cần chính DANH SÁCH dòng con để chọn dòng mới nhất.
  const childrenOf = {};
  Object.keys(remaining).forEach(function (sheetName) {
    const byId = {};
    remaining[sheetName].forEach(function (row) {
      const key = cleanText_(row.Campaign_KOL_ID);
      if (!key) return;
      if (!byId[key]) byId[key] = [];
      byId[key].push(row);
    });
    childrenOf[sheetName] = byId;
  });
  const childList = function (sheetName, id) { return childrenOf[sheetName][id] || []; };

  const changesById = {};
  ids.forEach(function (id) {
    const current = survivors[id];
    // Chính dòng KOL cũng bị xoá (vd. removeCampaignKol) -> không có gì để dọn.
    if (!current) return;
    const changes = {};

    // Một cột chỉ được xét khi lần xoá này thật sự đụng tới bảng cha của nó. Không có
    // dòng CONTRACTS nào bị xoá thì Contract_Status không phải chuyện của lần này.
    if ((tables.CONTRACTS || []).length) {
      const winner = adminLatestByUpdatedAt_(childList('CONTRACTS', id), 'Contract_ID');
      const target = winner ? cleanText_(winner.Sign_Status) || 'Not started' : 'Not started';
      if (cleanText_(current.Contract_Status) !== target) changes.Contract_Status = target;
    }
    if ((tables.PAYMENTS || []).length) {
      const winner = adminLatestByUpdatedAt_(childList('PAYMENTS', id), 'Payment_ID');
      const target = winner ? cleanText_(winner.Payment_Status) || 'Not started' : 'Not started';
      if (cleanText_(current.Payment_Status) !== target) changes.Payment_Status = target;
    }
    if ((tables.DELIVERABLES || []).length) {
      const winner = adminLatestByUpdatedAt_(childList('DELIVERABLES', id), 'Deliverable_ID');
      const target = winner ? cleanText_(winner.Content_Status) || 'Not started' : 'Not started';
      if (cleanText_(current.Content_Status) !== target) changes.Content_Status = target;
      // Chỉ xoá Post_URL khi nó đang trỏ đúng URL của một deliverable vừa bị xoá.
      // updateCampaignKol cho phép nhập Post_URL TRỰC TIẾP trên dòng KOL, nên xoá vô
      // điều kiện sẽ làm mất dữ liệu người dùng tự gõ. Cùng điều kiện mà
      // saveDeliverable đã dùng.
      const removedUrls = {};
      (tables.DELIVERABLES || []).forEach(function (row) {
        const url = cleanText_(row.Post_URL);
        if (url) removedUrls[url] = true;
      });
      if (cleanText_(current.Post_URL) && removedUrls[cleanText_(current.Post_URL)]) {
        changes.Post_URL = '';
      }
    }

    if (Object.keys(changes).length) {
      changes.Updated_At = new Date();
      changesById[id] = changes;
    }
  });

  if (!Object.keys(changesById).length) return {};
  updateRecordsById_('CAMPAIGN_KOLS', 'Campaign_KOL_ID', changesById);
  return changesById;
}

/** Lazily creates DELETED_ARCHIVE. Kept out of SCHEMA so Setup.gs stays untouched. */
function adminEnsureArchiveSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(ADMIN_CONFIG.ARCHIVE_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(ADMIN_CONFIG.ARCHIVE_SHEET);
    sheet.hideSheet();
  }
  const headers = ADMIN_CONFIG.ARCHIVE_HEADERS;
  const firstRow = sheet.getLastColumn()
    ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getDisplayValues()[0]
    : [];
  if (cleanText_(firstRow[0]) !== headers[0]) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers.slice()])
      .setFontWeight('bold').setBackground('#eef2fb');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Writes one archive row. `bundle` is { EntityType, EntityId, Label, tables }
 * where tables is { SHEET_NAME: [rowObject, ...] }.
 */
function adminCountsOf_(tables) {
  return Object.keys(tables || {}).map(function (name) {
    return name + '=' + ((tables[name] || []).length);
  }).join(', ');
}

/**
 * Gói tables thành từng phần vừa giới hạn ký tự của MỘT ô Sheets. Mỗi phần tự nó
 * là một bundle hợp lệ (một tập con các bảng), nên restore chỉ cần gộp lại.
 * Trước đây khi vượt giới hạn thì TOÀN BỘ payload bị thay bằng một stub
 * {"_truncated":true} — tức khả năng undo duy nhất của một lần xoá cascade bị bỏ
 * đi, mà hàm xoá vẫn trả về thành công nên Admin tin là còn phục hồi được.
 */
function adminChunkArchivePayload_(tables) {
  const limit = Math.max(1000, ADMIN_CONFIG.MAX_PAYLOAD_CHARS);
  const entries = [];
  Object.keys(tables || {}).forEach(function (name) {
    publicValue_(tables[name] || []).forEach(function (row) {
      entries.push({ sheet: name, row: row, size: JSON.stringify(row).length });
    });
  });
  if (!entries.length) return [{ payload: '{}', truncated: false, counts: '' }];

  const chunks = [];
  let current = {};
  let size = 2;

  function flush() {
    if (!Object.keys(current).length) return;
    chunks.push({ payload: JSON.stringify(current), truncated: false, counts: adminCountsOf_(current) });
    current = {};
    size = 2;
  }

  entries.forEach(function (entry) {
    const cost = entry.size + entry.sheet.length + 8;
    if (cost > limit) {
      // Một dòng đơn lẻ vượt giới hạn ô — không thể lưu nguyên văn.
      flush();
      chunks.push({
        payload: JSON.stringify({ _truncated: true, _sheet: entry.sheet, _chars: entry.size }),
        truncated: true,
        counts: entry.sheet + '=1 (single row exceeds the cell limit)',
      });
      return;
    }
    if (size + cost > limit) flush();
    if (!current[entry.sheet]) current[entry.sheet] = [];
    current[entry.sheet].push(entry.row);
    size += cost;
  });
  flush();
  return chunks;
}

function adminArchive_(user, bundle) {
  const sheet = adminEnsureArchiveSheet_();
  const tables = bundle.tables || {};
  const counts = adminCountsOf_(tables);
  const archiveId = makeId_('ARC');
  const now = new Date();
  const chunks = adminChunkArchivePayload_(tables);

  chunks.forEach(function (chunk, index) {
    sheet.appendRow([
      archiveId,
      now,
      (user && user.Email) || '',
      bundle.EntityType || '',
      bundle.EntityId || '',
      (bundle.Label || '') + (chunks.length > 1 ? ' · part ' + (index + 1) + '/' + chunks.length : ''),
      index === 0 ? counts : chunk.counts,
      chunk.payload,
    ]);
  });

  return {
    archiveId: archiveId,
    counts: counts,
    parts: chunks.length,
    truncated: chunks.some(function (chunk) { return chunk.truncated; }),
  };
}

/**
 * Deletes a parent row plus every cascading child, archives the whole bundle,
 * and writes an ACTIVITY_LOG entry. Must be called inside withDocumentLock_.
 */
function adminCascadeDelete_(user, options) {
  const sheetName = options.sheet;
  const idField = options.idField;
  const id = cleanText_(options.id);
  const tables = {};

  (ADMIN_CASCADE[sheetName] || []).forEach(function (child) {
    let ids = [id];
    if (child.viaSheet) {
      // Cấp cháu: khoá của nó không phải id của cha, nên lấy id từ bảng con vừa
      // xoá ở vòng trước. Thứ tự trong ADMIN_CASCADE vì thế có ý nghĩa — bảng
      // được tham chiếu qua viaSheet phải đứng trước.
      ids = (tables[child.viaSheet] || []).map(function (row) {
        return cleanText_(row[child.viaField]);
      }).filter(Boolean);
      if (!ids.length) {
        tables[child.sheet] = tables[child.sheet] || [];
        return;
      }
    }
    const removed = adminDeleteRowsWhere_(child.sheet, child.key, ids);
    // concat: cùng một bảng có thể bị nhắm tới hai lần (vd. ACCEPTANCE_LINES qua
    // cả Acceptance_ID lẫn Deliverable_ID), không được ghi đè kết quả trước.
    tables[child.sheet] = (tables[child.sheet] || []).concat(removed);
  });
  tables[sheetName] = adminDeleteRowsWhere_(sheetName, idField, [id]);
  if (!tables[sheetName].length) throw new Error('Record not found: ' + id);

  const archive = adminArchive_(user, {
    EntityType: sheetName,
    EntityId: id,
    Label: options.label || id,
    tables: tables,
  });
  // Sau khi đã lưu archive: dọn các cột trạng thái mà CAMPAIGN_KOLS phản chiếu từ
  // những bảng con vừa bị xoá. Đặt SAU adminArchive_ để archive giữ đúng ảnh chụp
  // lúc xoá, không lẫn với phần dọn dẹp.
  const resynced = adminResyncCampaignKolMirrors_(tables);
  logActivity_(user.Email, 'DELETE', sheetName, id, (options.label || '') + ' · ' + archive.counts +
    (archive.truncated ? ' · ARCHIVE INCOMPLETE' : '') +
    (Object.keys(resynced).length ? ' · resynced ' + Object.keys(resynced).length + ' campaign KOL mirror(s)' : ''));
  return {
    tables: tables,
    counts: archive.counts,
    archiveId: archive.archiveId,
    archiveParts: archive.parts,
    archiveTruncated: archive.truncated,
    resyncedCampaignKols: Object.keys(resynced),
  };
}

/** Requires the client to echo back the exact id, so misclicks cannot delete. */
function adminAssertConfirmation_(payload, expected) {
  const typed = cleanText_(payload && payload.confirm);
  if (typed !== cleanText_(expected)) {
    throw new Error('Type ' + expected + ' exactly to confirm this deletion.');
  }
}

/* ============================================================================
 * SECTION 2 — Delete APIs
 * ========================================================================== */

/**
 * Deletes a campaign and everything hanging off it.
 * payload: { Campaign_ID, confirm, force }
 * Blocked when signed contracts or paid payments exist, unless force = true
 * (force still requires Admin).
 */
function deleteCampaign(payload) {
  const user = requireRole_(['Admin']);
  payload = payload || {};
  const campaignId = cleanText_(payload.Campaign_ID);
  requireFields_({ Campaign_ID: campaignId }, ['Campaign_ID']);
  adminAssertConfirmation_(payload, campaignId);

  return withDocumentLock_(function () {
    const campaign = findRecord_('CAMPAIGNS', 'Campaign_ID', campaignId);
    if (!campaign) throw new Error('Campaign not found: ' + campaignId);

    const blockers = adminDeleteBlockers_({ Campaign_ID: campaignId });
    if (blockers.length && !isTrue_(payload.force)) {
      throw new Error('This campaign still has ' + blockers.join(' and ') +
        '. Re-run with force = true if you are certain, or void those records first.');
    }

    // Shortlists are shared assets — unlink instead of deleting them.
    const unlinked = [];
    readTable_('SHORTLISTS').forEach(function (row) {
      if (cleanText_(row.Campaign_ID) !== campaignId) return;
      updateRecord_('SHORTLISTS', 'Shortlist_ID', row.Shortlist_ID, {
        Campaign_ID: '',
        Notes: cleanText_(row.Notes),
        Updated_At: new Date(),
      });
      unlinked.push(row.Shortlist_ID);
    });

    const result = adminCascadeDelete_(user, {
      sheet: 'CAMPAIGNS',
      idField: 'Campaign_ID',
      id: campaignId,
      label: cleanText_(campaign.App) + ' · ' + cleanText_(campaign.Campaign_Name),
    });

    return publicValue_({
      deleted: campaignId,
      counts: result.counts,
      unlinkedShortlists: unlinked,
      forced: isTrue_(payload.force) && blockers.length > 0,
      archiveId: result.archiveId,
      archiveParts: result.archiveParts,
      // Nếu true thì có phần KHÔNG phục hồi được — UI cần nói ra, đừng để Admin
      // tưởng mọi thứ vẫn undo được như trước.
      archiveTruncated: result.archiveTruncated,
    });
  });
}

/** Returns human-readable reasons a delete should be blocked. */
function adminDeleteBlockers_(filter) {
  const matches = function (row) {
    return Object.keys(filter).every(function (key) {
      return cleanText_(row[key]) === cleanText_(filter[key]);
    });
  };
  const signed = readTable_('CONTRACTS').filter(function (row) {
    return matches(row) && cleanText_(row.Sign_Status) === 'Signed';
  }).length;
  const paid = readTable_('PAYMENTS').filter(function (row) {
    return matches(row) && cleanText_(row.Payment_Status) === 'Paid';
  }).length;

  const blockers = [];
  if (signed) blockers.push(signed + ' signed contract(s)');
  if (paid) blockers.push(paid + ' paid payment(s)');
  return blockers;
}

/**
 * Removes one KOL from a campaign, with its deliverables, feedback,
 * contract and payment rows.
 * payload: { Campaign_KOL_ID, force }
 * Booking/Admin only. Marketing cannot remove booked KOLs.
 */
function removeCampaignKol(payload) {
  const user = requireRole_(['Admin', 'Booking']);
  payload = payload || {};
  const id = cleanText_(payload.Campaign_KOL_ID);
  requireFields_({ Campaign_KOL_ID: id }, ['Campaign_KOL_ID']);

  return withDocumentLock_(function () {
    const campaignKol = findRecord_('CAMPAIGN_KOLS', 'Campaign_KOL_ID', id);
    if (!campaignKol) throw new Error('Campaign KOL not found: ' + id);
    const campaign = findRecord_('CAMPAIGNS', 'Campaign_ID', campaignKol.Campaign_ID);
    assertCampaignAccess_(user, campaign || {});

    const blockers = adminDeleteBlockers_({ Campaign_KOL_ID: id });
    if (blockers.length && !isTrue_(payload.force)) {
      throw new Error('This KOL still has ' + blockers.join(' and ') + '. Void those records first.');
    }

    const account = findRecord_('ACCOUNTS', 'Account_ID', campaignKol.Account_ID) || {};
    const result = adminCascadeDelete_(user, {
      sheet: 'CAMPAIGN_KOLS',
      idField: 'Campaign_KOL_ID',
      id: id,
      label: '@' + cleanText_(account.Username) + ' from ' + cleanText_(campaignKol.Campaign_ID),
    });
    return publicValue_({ deleted: id, campaignId: campaignKol.Campaign_ID, counts: result.counts });
  });
}

/**
 * Deletes a shortlist and its picks. Shortlists hold no financial data,
 * so Booking may delete their own; Admin may delete any.
 * payload: { Shortlist_ID, confirm }
 */
function deleteShortlist(payload) {
  const user = requireRole_(['Admin', 'Booking']);
  payload = payload || {};
  const id = cleanText_(payload.Shortlist_ID);
  requireFields_({ Shortlist_ID: id }, ['Shortlist_ID']);
  adminAssertConfirmation_(payload, id);

  return withDocumentLock_(function () {
    const shortlist = findRecord_('SHORTLISTS', 'Shortlist_ID', id);
    if (!shortlist) throw new Error('Shortlist not found: ' + id);
    if (user.Role !== 'Admin' &&
      cleanText_(shortlist.Owner_Email).toLowerCase() !== cleanText_(user.Email).toLowerCase()) {
      throw new Error('Only the shortlist owner or an Admin can delete this shortlist.');
    }
    const result = adminCascadeDelete_(user, {
      sheet: 'SHORTLISTS',
      idField: 'Shortlist_ID',
      id: id,
      label: cleanText_(shortlist.Shortlist_Name),
    });
    return publicValue_({ deleted: id, counts: result.counts });
  });
}

/**
 * Deletes a deliverable and its feedback thread.
 * payload: { Deliverable_ID }
 */
function deleteDeliverable(payload) {
  // Marketing KHÔNG được xoá deliverable (chủ project quyết định 2026-07-30). Trước
  // đây Marketing nằm trong danh sách này, và `force` — do chính người gọi truyền,
  // không có trong tài liệu UI — vượt qua chốt duy nhất. Cascade còn xoá luôn
  // ACCEPTANCE_LINES theo Deliverable_ID, nên một lệnh gọi thẳng từ console có thể
  // rút dòng ra khỏi một BBNT đã ký.
  const user = requireRole_(['Admin', 'Booking']);
  payload = payload || {};
  const id = cleanText_(payload.Deliverable_ID);
  requireFields_({ Deliverable_ID: id }, ['Deliverable_ID']);
  // `force` chỉ Admin. Booking truyền force cũng không có tác dụng.
  const forced = isTrue_(payload.force) && user.Role === 'Admin';

  return withDocumentLock_(function () {
    const deliverable = findRecord_('DELIVERABLES', 'Deliverable_ID', id);
    if (!deliverable) throw new Error('Deliverable not found: ' + id);
    const campaign = findRecord_('CAMPAIGNS', 'Campaign_ID', deliverable.Campaign_ID);
    assertCampaignAccess_(user, campaign || {});

    // CHẶN CỨNG, không có cửa force kể cả Admin: BBNT đã Generated/Signed là chứng từ
    // pháp lý, và các dòng của nó nối vào deliverable qua Deliverable_ID. Xoá đi là
    // BBNT còn tổng tiền không khớp các dòng còn lại — sai lệch trên giấy đã ký.
    const blocking = adminAcceptanceStatusesForDeliverable_(id)
      .filter(function (status) { return ['Generated', 'Signed'].indexOf(status) >= 0; });
    if (blocking.length) {
      throw new Error('This deliverable is on an acceptance certificate that is already ' +
        blocking.join('/') + '. Cancel that BBNT first — a signed acceptance cannot lose a line.');
    }

    // A live post is real published work — never silently drop its metrics.
    if (cleanText_(deliverable.Post_URL) && !forced) {
      throw new Error(user.Role === 'Admin'
        ? 'This deliverable already has a live post URL. Clear the post link first, or pass force = true.'
        : 'This deliverable already has a live post URL. Clear the post link first, or ask an Admin — only an Admin can force this.');
    }

    const result = adminCascadeDelete_(user, {
      sheet: 'DELIVERABLES',
      idField: 'Deliverable_ID',
      id: id,
      label: cleanText_(deliverable.Type) + ' · ' + cleanText_(deliverable.Platform),
    });
    // Dòng BBNT (Draft) vừa bị xoá theo cascade -> tổng của BBNT đó phải tính lại,
    // nếu không nó giữ một con số không còn khớp các dòng còn lại.
    const recalculated = [];
    uniqueWorkspaceText_((result.tables.ACCEPTANCE_LINES || []).map(function (row) {
      return cleanText_(row.Acceptance_ID);
    })).forEach(function (acceptanceId) {
      contractRecalculateAcceptanceTotal_(acceptanceId);
      recalculated.push(acceptanceId);
    });
    // Các cột trạng thái phản chiếu trên CAMPAIGN_KOLS đã được
    // adminResyncCampaignKolMirrors_ dọn bên trong adminCascadeDelete_ (F18).
    return publicValue_({
      deleted: id,
      campaignId: deliverable.Campaign_ID,
      counts: result.counts,
      forcedByAdmin: forced,
      recalculatedAcceptances: recalculated,
      resyncedCampaignKols: result.resyncedCampaignKols || [],
    });
  });
}

/** Trạng thái của mọi BBNT có dòng trỏ tới deliverable này. */
function adminAcceptanceStatusesForDeliverable_(deliverableId) {
  const id = cleanText_(deliverableId);
  const acceptanceIds = {};
  readTable_('ACCEPTANCE_LINES').forEach(function (row) {
    if (cleanText_(row.Deliverable_ID) === id) acceptanceIds[cleanText_(row.Acceptance_ID)] = true;
  });
  if (!Object.keys(acceptanceIds).length) return [];
  return uniqueWorkspaceText_(readTable_('ACCEPTANCES')
    .filter(function (row) { return acceptanceIds[cleanText_(row.Acceptance_ID)]; })
    .map(function (row) { return cleanText_(row.Status); })
    .filter(Boolean));
}

/**
 * Deletes a contract record from the registry. Does NOT delete the Drive
 * Doc/PDF — those stay as evidence; the archive keeps their URLs.
 * payload: { Contract_ID, confirm }
 */
function deleteContractRecord(payload) {
  const user = requireRole_(['Admin']);
  payload = payload || {};
  const id = cleanText_(payload.Contract_ID);
  requireFields_({ Contract_ID: id }, ['Contract_ID']);
  adminAssertConfirmation_(payload, id);

  return withDocumentLock_(function () {
    const contract = findRecord_('CONTRACTS', 'Contract_ID', id);
    if (!contract) throw new Error('Contract not found: ' + id);
    // Không còn cửa hậu `force`. Đây là quy tắc được ghi trong SOP, mà `force` lại
    // không nằm trong payload tài liệu hoá — nghĩa là chỉ cần gọi thẳng từ console
    // là xoá được một hợp đồng đã ký.
    if (cleanText_(contract.Sign_Status) === 'Signed') {
      throw new Error('Signed contracts cannot be deleted. Set Sign_Status to Cancelled instead.');
    }
    // Đi qua adminCascadeDelete_ để BBNT (ACCEPTANCES + ACCEPTANCE_LINES) cũng bị
    // xoá VÀ được lưu vào archive. Trước đây chỉ dòng CONTRACTS bị xoá.
    const result = adminCascadeDelete_(user, {
      sheet: 'CONTRACTS',
      idField: 'Contract_ID',
      id: id,
      label: cleanText_(contract.Contract_No),
    });
    return publicValue_({
      deleted: id,
      driveDocRetained: cleanText_(contract.Contract_URL),
      counts: result.counts,
      archiveId: result.archiveId,
      archiveTruncated: result.archiveTruncated,
    });
  });
}

/**
 * Deletes a payment record.
 * payload: { Payment_ID, confirm }
 */
function deletePaymentRecord(payload) {
  const user = requireRole_(['Admin']);
  payload = payload || {};
  const id = cleanText_(payload.Payment_ID);
  requireFields_({ Payment_ID: id }, ['Payment_ID']);
  adminAssertConfirmation_(payload, id);

  return withDocumentLock_(function () {
    const payment = findRecord_('PAYMENTS', 'Payment_ID', id);
    if (!payment) throw new Error('Payment not found: ' + id);
    // Không còn cửa hậu `force` — xem ghi chú ở deleteContractRecord. Kết hợp với
    // lỗi archive bị cắt trước đây, một payment đã Paid có thể bị xoá sạch mà chỉ
    // còn lại một dòng ACTIVITY_LOG.
    if (cleanText_(payment.Payment_Status) === 'Paid') {
      throw new Error('Paid payments cannot be deleted — they are financial records. Reverse the payment instead.');
    }
    const removed = adminDeleteRowsWhere_('PAYMENTS', 'Payment_ID', [id]);
    if (!removed.length) throw new Error('Payment not found: ' + id);
    const archive = adminArchive_(user, {
      EntityType: 'PAYMENTS',
      EntityId: id,
      Label: cleanText_(payment.Campaign_ID) + ' · ' + toNumber_(payment.Amount),
      tables: { PAYMENTS: removed },
    });
    logActivity_(user.Email, 'DELETE', 'PAYMENTS', id, archive.counts);
    return publicValue_({ deleted: id, archiveId: archive.archiveId, archiveTruncated: archive.truncated });
  });
}

/**
 * adminArchive_ ghi payload qua publicValue_, hàm này biến MỌI Date thành chuỗi
 * 'yyyy-MM-ddTHH:mm:ss'. Ghi thẳng chuỗi đó trở lại sheet là tái tạo đúng cái mớ
 * ba-định-dạng-ngày mà CLAUDE.md cảnh báo: <input type="date"> hiện trống, và
 * getCalendarData sắp sai thứ tự vì so sánh chuỗi.
 *
 * Nhận diện theo ĐỊNH DẠNG, không theo tên cột. Tên cột không đáng tin ở bảng tính
 * này — CONFIG.Value và CREATORS.Source_Note đều có dòng là ngày, dòng là text (xem
 * ghi chú dài ở batchRowsToRecords_ trong Code.gs). Ngược lại, chỉ một Date đi qua
 * publicValue_ mới ra đúng khuôn này.
 *
 * Dùng Utilities.parseDate với múi giờ tường minh thay vì new Date(chuỗi), để không
 * phụ thuộc vào cách engine suy luận múi giờ khi chuỗi không có hậu tố.
 */
const ARCHIVE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
function adminReviveArchivedValue_(value) {
  if (typeof value !== 'string' || !ARCHIVE_DATE_PATTERN.test(value)) return value;
  try {
    return Utilities.parseDate(value, APP.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
  } catch (error) {
    // Không parse được thì giữ nguyên chuỗi — thà lệch định dạng còn hơn mất dữ liệu.
    return value;
  }
}
function adminReviveArchivedRow_(row) {
  const out = {};
  Object.keys(row || {}).forEach(function (key) {
    out[key] = adminReviveArchivedValue_(row[key]);
  });
  return out;
}

/**
 * Restores a previously archived bundle back into its sheets.
 * payload: { Archive_ID }
 * Admin only. Skips rows whose id already exists again.
 */
function restoreArchivedRecord(payload) {
  const user = requireRole_(['Admin']);
  payload = payload || {};
  const archiveId = cleanText_(payload.Archive_ID);
  requireFields_({ Archive_ID: archiveId }, ['Archive_ID']);

  return withDocumentLock_(function () {
    const sheet = adminEnsureArchiveSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) throw new Error('Nothing has been archived yet.');
    const headers = ADMIN_CONFIG.ARCHIVE_HEADERS;
    const grid = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    const matches = grid.filter(function (row) { return cleanText_(row[0]) === archiveId; });
    if (!matches.length) throw new Error('Archive entry not found: ' + archiveId);
    const match = matches[0];

    // Một lần xoá lớn nay được lưu thành NHIỀU dòng cùng Archive_ID, nên phải gộp
    // hết lại; chỉ đọc dòng đầu sẽ phục hồi thiếu mà không báo gì.
    const payloadIndex = headers.indexOf('Payload_JSON');
    const bundle = {};
    let incomplete = false;
    matches.forEach(function (row) {
      let part = {};
      try {
        part = JSON.parse(String(row[payloadIndex] || '{}'));
      } catch (err) {
        throw new Error('This archive entry is not restorable (payload could not be parsed).');
      }
      if (part._truncated) { incomplete = true; return; }
      Object.keys(part).forEach(function (sheetName) {
        bundle[sheetName] = (bundle[sheetName] || []).concat(part[sheetName] || []);
      });
    });
    if (!Object.keys(bundle).length) {
      throw new Error('This archive entry was too large to store in full and cannot be restored automatically.');
    }

    const restored = {};
    Object.keys(bundle).forEach(function (sheetName) {
      const rows = bundle[sheetName] || [];
      if (!SCHEMA[sheetName] || !rows.length) return;
      const idField = SCHEMA[sheetName][0];
      const existing = indexBy_(readTable_(sheetName), idField);
      const fresh = rows
        .filter(function (row) { return !existing[cleanText_(row[idField])]; })
        .map(adminReviveArchivedRow_);
      // MỘT lần ghi cho cả sheet, không phải appendRecord_ từng dòng. Mỗi
      // appendRecord_ là một getRange + setValues + xoá cache + bump revision riêng;
      // phục hồi một campaign lớn là hàng trăm lượt như thế, tất cả nằm trong script
      // lock toàn cục và tiến sát trần 6 phút.
      appendRecords_(sheetName, fresh);
      restored[sheetName] = fresh.length;
    });

    logActivity_(user.Email, 'RESTORE', cleanText_(match[headers.indexOf('Entity_Type')]),
      cleanText_(match[headers.indexOf('Entity_ID')]), JSON.stringify(restored));
    return publicValue_({
      restored: restored,
      archiveId: archiveId,
      parts: matches.length,
      // Có phần bị cắt vì một dòng đơn lẻ quá lớn: phục hồi được phần còn lại,
      // nhưng phải nói rõ chứ không được im lặng báo thành công.
      incomplete: incomplete,
    });
  });
}

/* ============================================================================
 * SECTION 3 — User & role management
 * ========================================================================== */

/**
 * Everything the Settings > Team panel needs in one round trip.
 * payload: { activityLimit }
 */
function getAdminData(payload) {
  const user = requireRole_(['Admin', 'Booking']);
  payload = payload || {};
  const isAdmin = user.Role === 'Admin';
  const wantsActivity = isAdmin && isTrue_(payload.includeActivity);
  const users = readTable_('USERS').map(function (row) {
    return {
      User_ID: row.User_ID,
      Email: row.Email,
      Name: row.Name,
      Role: row.Role,
      Market: row.Market,
      Active: isTrue_(row.Active),
      Created_At: row.Created_At,
      Updated_At: row.Updated_At,
      Is_Self: cleanText_(row.Email).toLowerCase() === cleanText_(user.Email).toLowerCase(),
    };
  }).sort(function (a, b) {
    if (a.Active !== b.Active) return a.Active ? -1 : 1;
    return cleanText_(a.Name || a.Email).localeCompare(cleanText_(b.Name || b.Email));
  });

  return publicValue_({
    currentUser: { Email: user.Email, Role: user.Role, Market: user.Market },
    canEditUsers: isAdmin,
    users: users,
    roles: LISTS.USER_ROLES,
    markets: LISTS.MARKETS,
    // CHỈ đọc ACTIVITY_LOG khi được yêu cầu tường minh. Trước đây mọi lần Admin hoặc
    // Booking mở Settings đều kéo 200 dòng ACTIVITY_LOG, dù panel mặc định là tab
    // Users và tab Audit có thể không bao giờ được mở. Đó là một lần readTable_ trên
    // bảng chỉ-tăng-không-giảm, trả về cho mỗi lần render Settings.
    // Đường lấy audit riêng là getActivityLog (Admin-only, đã có sẵn).
    // Quyền KHÔNG đổi: vẫn requireRole_(['Admin','Booking']) ở đầu hàm, và activity
    // vẫn chỉ trả cho Admin.
    activity: wantsActivity ? adminReadActivity_(payload) : [],
    activityLoaded: wantsActivity,
    activeAdmins: users.filter(function (row) { return row.Active && row.Role === 'Admin'; }).length,
  });
}

/** Newest-first slice of ACTIVITY_LOG, optionally filtered. */
function adminReadActivity_(payload) {
  payload = payload || {};
  const limit = Math.min(1000, Math.max(20, toNumber_(payload.activityLimit) || ADMIN_CONFIG.ACTIVITY_PAGE_SIZE));
  const email = cleanText_(payload.activityEmail).toLowerCase();
  const action = cleanText_(payload.activityAction).toUpperCase();
  const entity = cleanText_(payload.activityEntity).toUpperCase();

  return readTable_('ACTIVITY_LOG').filter(function (row) {
    if (email && cleanText_(row.User_Email).toLowerCase() !== email) return false;
    if (action && cleanText_(row.Action).toUpperCase() !== action) return false;
    if (entity && cleanText_(row.Entity_Type).toUpperCase() !== entity) return false;
    return true;
  }).reverse().slice(0, limit);
}

/** Standalone audit-log endpoint so the UI can filter without reloading users. */
function getActivityLog(payload) {
  requireRole_(['Admin']);
  return publicValue_(adminReadActivity_(payload));
}

function adminValidateRole_(role) {
  const value = cleanText_(role);
  if (LISTS.USER_ROLES.indexOf(value) === -1) {
    throw new Error('Invalid role: ' + value + '. Allowed: ' + LISTS.USER_ROLES.join(', '));
  }
  return value;
}

function adminValidateMarket_(market) {
  const value = cleanText_(market) === 'Global' ? 'Global' : normalizeMarket_(market);
  if (LISTS.MARKETS.indexOf(value) === -1) {
    throw new Error('Invalid market: ' + cleanText_(market) + '. Allowed: ' + LISTS.MARKETS.join(', '));
  }
  return value;
}

function adminNormalizeEmail_(email) {
  const value = cleanText_(email).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) throw new Error('Invalid email address: ' + cleanText_(email));
  return value;
}

/**
 * Guards against locking everyone out: there must always be at least one
 * active Admin remaining after the change.
 */
function adminAssertAdminRemains_(users, changingUserId, nextRole, nextActive) {
  const remaining = users.filter(function (row) {
    const isTarget = cleanText_(row.User_ID) === cleanText_(changingUserId);
    const role = isTarget ? nextRole : cleanText_(row.Role);
    const active = isTarget ? nextActive : isTrue_(row.Active);
    return active && role === 'Admin';
  }).length;
  if (!remaining) {
    throw new Error('At least one active Admin must remain. Promote another user first.');
  }
}

/**
 * payload: { Email, Name, Role, Market }
 */
function createUser(payload) {
  const user = requireRole_(['Admin']);
  payload = payload || {};
  const email = adminNormalizeEmail_(payload.Email);
  const name = cleanText_(payload.Name) || email.split('@')[0];
  const role = adminValidateRole_(payload.Role);
  const market = adminValidateMarket_(payload.Market);

  return withDocumentLock_(function () {
    const duplicate = readTable_('USERS').find(function (row) {
      return cleanText_(row.Email).toLowerCase() === email;
    });
    if (duplicate) {
      throw new Error(email + ' is already in the USERS sheet' +
        (isTrue_(duplicate.Active) ? '.' : ' but deactivated — reactivate that row instead.'));
    }
    const now = new Date();
    const record = {
      User_ID: makeId_('USR'),
      Email: email,
      Name: name,
      Role: role,
      Market: market,
      Active: 'TRUE',
      Created_At: now,
      Updated_At: now,
    };
    appendRecord_('USERS', record);
    logActivity_(user.Email, 'CREATE', 'USERS', record.User_ID, email + ' · ' + role + ' · ' + market);
    return publicValue_(mergeObjects_(record, { Active: true }));
  });
}

/**
 * payload: { User_ID, Name, Role, Market }
 * Email is immutable — it is the identity key. Deactivate and re-invite instead.
 */
function updateUser(payload) {
  const user = requireRole_(['Admin']);
  payload = payload || {};
  const userId = cleanText_(payload.User_ID);
  requireFields_({ User_ID: userId }, ['User_ID']);

  return withDocumentLock_(function () {
    // BẮT BUỘC đọc lại từ sheet. requireRole_ -> getCurrentUser_ đã đọc USERS
    // TRƯỚC khi lock được lấy, nên __tableCache_.USERS (và bản CacheService dùng
    // chung, TTL 5 phút) đang ấm và readTable_ sẽ trả lại đúng ảnh chụp cũ đó.
    // Không xoá cache ở đây thì adminAssertAdminRemains_ kiểm tra trên dữ liệu cũ:
    // hai Admin hạ quyền nhau trong cùng cửa sổ cache đều thấy người kia vẫn là
    // Admin đang hoạt động, cả hai đều lọt, và workspace còn 0 Admin — đúng cái
    // mà guard này sinh ra để chặn. Cùng lý do như trong contractReserveSerial_.
    invalidateTableCache_('USERS');
    const users = readTable_('USERS');
    const target = users.find(function (row) { return cleanText_(row.User_ID) === userId; });
    if (!target) throw new Error('User not found: ' + userId);

    const changes = { Updated_At: new Date() };
    if (Object.prototype.hasOwnProperty.call(payload, 'Name')) {
      changes.Name = cleanText_(payload.Name) || cleanText_(target.Email).split('@')[0];
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'Role')) changes.Role = adminValidateRole_(payload.Role);
    if (Object.prototype.hasOwnProperty.call(payload, 'Market')) changes.Market = adminValidateMarket_(payload.Market);

    const nextRole = changes.Role || cleanText_(target.Role);
    adminAssertAdminRemains_(users, userId, nextRole, isTrue_(target.Active));

    // Demoting yourself out of Admin is the single easiest way to lose access.
    if (cleanText_(target.Email).toLowerCase() === cleanText_(user.Email).toLowerCase() && nextRole !== 'Admin') {
      throw new Error('You cannot remove your own Admin role. Ask another Admin to do it.');
    }

    const updated = updateRecord_('USERS', 'User_ID', userId, changes);
    logActivity_(user.Email, 'UPDATE', 'USERS', userId,
      cleanText_(target.Email) + ' → ' + nextRole + ' · ' + (changes.Market || target.Market));
    return publicValue_(mergeObjects_(updated, { Active: isTrue_(updated.Active) }));
  });
}

/**
 * Activate or deactivate a user. This is the "delete" for users — we never
 * remove the row, so ACTIVITY_LOG history keeps resolving to a real person.
 * payload: { User_ID, Active }
 */
function setUserActive(payload) {
  const user = requireRole_(['Admin']);
  payload = payload || {};
  const userId = cleanText_(payload.User_ID);
  requireFields_({ User_ID: userId }, ['User_ID']);
  const nextActive = isTrue_(payload.Active);

  return withDocumentLock_(function () {
    // Xem ghi chú trong updateUser: cache USERS đã được requireRole_ nạp trước lock,
    // nên adminAssertAdminRemains_ sẽ chạy trên dữ liệu cũ và có thể để lọt việc
    // deactivate người Admin cuối cùng.
    invalidateTableCache_('USERS');
    const users = readTable_('USERS');
    const target = users.find(function (row) { return cleanText_(row.User_ID) === userId; });
    if (!target) throw new Error('User not found: ' + userId);
    if (cleanText_(target.Email).toLowerCase() === cleanText_(user.Email).toLowerCase() && !nextActive) {
      throw new Error('You cannot deactivate your own account.');
    }
    adminAssertAdminRemains_(users, userId, cleanText_(target.Role), nextActive);

    const updated = updateRecord_('USERS', 'User_ID', userId, {
      Active: nextActive ? 'TRUE' : 'FALSE',
      Updated_At: new Date(),
    });
    logActivity_(user.Email, nextActive ? 'ACTIVATE' : 'DEACTIVATE', 'USERS', userId, cleanText_(target.Email));
    return publicValue_(mergeObjects_(updated, { Active: nextActive }));
  });
}

/**
 * Reassigns everything owned by one user to another — run this before
 * deactivating someone who is leaving.
 * payload: { fromEmail, toEmail, dryRun }
 */
function reassignUserWork(payload) {
  const user = requireRole_(['Admin']);
  payload = payload || {};
  const fromEmail = adminNormalizeEmail_(payload.fromEmail);
  const toEmail = adminNormalizeEmail_(payload.toEmail);
  if (fromEmail === toEmail) throw new Error('Source and target user must be different.');

  const target = readTable_('USERS').find(function (row) {
    return cleanText_(row.Email).toLowerCase() === toEmail && isTrue_(row.Active);
  });
  if (!target) throw new Error(toEmail + ' is not an active user. Add them first.');

  const plan = [
    { sheet: 'CAMPAIGNS', idField: 'Campaign_ID', fields: ['Owner_Email'] },
    { sheet: 'SHORTLISTS', idField: 'Shortlist_ID', fields: ['Owner_Email'] },
    { sheet: 'CAMPAIGN_KOLS', idField: 'Campaign_KOL_ID', fields: ['PIC_Email'] },
    { sheet: 'CONTRACTS', idField: 'Contract_ID', fields: ['Owner_Email'] },
    { sheet: 'PAYMENTS', idField: 'Payment_ID', fields: ['Owner_Email'] },
  ];

  const summary = {};
  const apply = !isTrue_(payload.dryRun);

  return withDocumentLock_(function () {
    plan.forEach(function (item) {
      const hits = readTable_(item.sheet).filter(function (row) {
        return item.fields.some(function (field) {
          return cleanText_(row[field]).toLowerCase() === fromEmail;
        });
      });
      summary[item.sheet] = hits.length;
      if (!apply || !hits.length) return;
      hits.forEach(function (row) {
        const changes = { Updated_At: new Date() };
        item.fields.forEach(function (field) {
          if (cleanText_(row[field]).toLowerCase() === fromEmail) changes[field] = toEmail;
        });
        updateRecord_(item.sheet, item.idField, row[item.idField], changes);
      });
    });

    // Assigned_Marketing is a comma-separated list, so it needs its own pass.
    let reassignedAssignments = 0;
    readTable_('CAMPAIGNS').forEach(function (row) {
      const list = String(row.Assigned_Marketing || '').split(',')
        .map(function (item) { return item.trim().toLowerCase(); }).filter(Boolean);
      if (list.indexOf(fromEmail) === -1) return;
      reassignedAssignments += 1;
      if (!apply) return;
      const next = list.map(function (item) { return item === fromEmail ? toEmail : item; })
        .filter(function (item, index, all) { return all.indexOf(item) === index; });
      updateRecord_('CAMPAIGNS', 'Campaign_ID', row.Campaign_ID, {
        Assigned_Marketing: next.join(', '),
        Updated_At: new Date(),
      });
    });
    summary.CAMPAIGNS_Assigned_Marketing = reassignedAssignments;

    if (apply) {
      logActivity_(user.Email, 'REASSIGN', 'USERS', fromEmail,
        'to ' + toEmail + ' · ' + JSON.stringify(summary));
    }
    return publicValue_({ dryRun: !apply, from: fromEmail, to: toEmail, summary: summary });
  });
}