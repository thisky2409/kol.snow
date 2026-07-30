/**
 * ============================================================================
 * KOL Campaign Manager v1.11.0 — ContractHub.gs
 * ----------------------------------------------------------------------------
 * PASTE AS: new Apps Script file named  ContractHub.gs
 *
 * PHASE 4 — Unified contract system
 *
 * Before: contracts existed twice. The legacy [SNOWVN] project owned templates,
 * acceptance certificates (BBNT) and the creator info form on spreadsheet
 * 1bBe0X…, while ContractGenerator.gs in this project produced VN-only
 * contracts into its own CONTRACTS tab. Two registries, drifting numbering,
 * hardcoded Drive IDs, no TH/TW support.
 *
 * After:
 *   1. ONE registry — CONTRACTS in this workspace. Legacy rows import once via
 *      migrateLegacyContracts().
 *   2. Templates, folders, prefixes and tax rules move to the CONFIG sheet,
 *      per market. VN/TH/TW all supported; adding a market is a config change.
 *   3. Contract numbering is a single reserved counter in CONFIG — no more
 *      best-effort max() scans that silently collide.
 *   4. Acceptance certificates (BBNT) live here, in ACCEPTANCES +
 *      ACCEPTANCE_LINES, generated from real deliverables with evidence images.
 *   5. Creator info form: tokenised link the creator opens themselves to submit
 *      legal name, ID, address and bank details straight into CREATORS.
 *
 * REQUIRES the Setup.gs and Code.gs patches in 11_PATCHES.md:
 *   - SCHEMA gains ACCEPTANCES, ACCEPTANCE_LINES, CREATOR_FORM_TOKENS
 *   - ID_PREFIX gains ACP, ACL, CFT
 *   - doGet(e) becomes parameter-aware so the creator form can be served
 * ============================================================================
 */

/* ----------------------------------------------------------------------------
 * Configuration — defaults only. Real values live in the CONFIG sheet so the
 * Drive IDs are never hardcoded in source again.
 * -------------------------------------------------------------------------- */

const CONTRACT_HUB = Object.freeze({
  MARKETS: Object.freeze(['VN', 'TH', 'TW']),

  /* CONFIG key pattern: CONTRACT_<MARKET>_<FIELD> */
  FIELDS: Object.freeze([
    'TEMPLATE_ID', 'ACCEPTANCE_TEMPLATE_ID', 'FOLDER_ID',
    'PREFIX', 'ACCEPTANCE_PREFIX', 'TAX_RATE', 'TAX_THRESHOLD',
    'NO_MIN_DIGITS', 'TEMPLATE_NAME', 'LANGUAGE',
  ]),

  DEFAULTS: Object.freeze({
    VN: Object.freeze({
      PREFIX: 'HĐ-SNOWVN-',
      ACCEPTANCE_PREFIX: 'BBNT-SNOWVN-',
      TAX_RATE: 0.1,
      TAX_THRESHOLD: 5000000,
      NO_MIN_DIGITS: 2,
      TEMPLATE_NAME: 'SNOW VN Standard',
      LANGUAGE: 'vi',
    }),
    TH: Object.freeze({
      PREFIX: 'AGR-SNOWTH-',
      ACCEPTANCE_PREFIX: 'ACC-SNOWTH-',
      TAX_RATE: 0.03,
      TAX_THRESHOLD: 0,
      NO_MIN_DIGITS: 3,
      TEMPLATE_NAME: 'SNOW TH Standard',
      LANGUAGE: 'en',
    }),
    TW: Object.freeze({
      PREFIX: 'AGR-SNOWTW-',
      ACCEPTANCE_PREFIX: 'ACC-SNOWTW-',
      TAX_RATE: 0.1,
      TAX_THRESHOLD: 0,
      NO_MIN_DIGITS: 3,
      TEMPLATE_NAME: 'SNOW TW Standard',
      LANGUAGE: 'en',
    }),
  }),

  COUNTER_KEY_PREFIX: 'CONTRACT_SEQ_',
  ACCEPTANCE_COUNTER_PREFIX: 'ACCEPTANCE_SEQ_',
  FORM_TOKEN_TTL_DAYS: 30,
  EVIDENCE_MAX_WIDTH: 460,
  EVIDENCE_MAX_HEIGHT: 500,
  LEGACY_SPREADSHEET_KEY: 'LEGACY_CONTRACT_SPREADSHEET_ID',
  LEGACY_SHEET_NAME: 'Contract',
});

/**
 * Resolves the effective settings for a market: CONFIG first, then the
 * per-market defaults above, then the legacy CONTRACT_CONFIG for VN so an
 * unconfigured workspace keeps working exactly as it does today.
 */
function contractSettingsFor_(market) {
  const key = normalizeMarket_(market);
  if (CONTRACT_HUB.MARKETS.indexOf(key) === -1) {
    throw new Error('Contracts are not configured for market: ' + cleanText_(market) +
      '. Supported: ' + CONTRACT_HUB.MARKETS.join(', ') + '.');
  }
  const config = getConfigMap_();
  const defaults = CONTRACT_HUB.DEFAULTS[key] || {};
  const settings = { Market: key };

  CONTRACT_HUB.FIELDS.forEach(function (field) {
    const configured = cleanText_(config['CONTRACT_' + key + '_' + field]);
    settings[field] = configured || (defaults[field] === undefined ? '' : defaults[field]);
  });

  // VN falls back to the original hardcoded constants so existing deployments
  // keep generating contracts before anyone touches CONFIG.
  if (key === 'VN' && typeof CONTRACT_CONFIG !== 'undefined') {
    if (!settings.TEMPLATE_ID) settings.TEMPLATE_ID = CONTRACT_CONFIG.TEMPLATE_ID;
    if (!settings.FOLDER_ID) settings.FOLDER_ID = CONTRACT_CONFIG.OUTPUT_FOLDER_ID;
    if (!settings.PREFIX) settings.PREFIX = CONTRACT_CONFIG.CONTRACT_YEAR_PREFIX;
    if (!settings.NO_MIN_DIGITS) settings.NO_MIN_DIGITS = CONTRACT_CONFIG.NO_MIN_DIGITS;
  }

  settings.TAX_RATE = toNumber_(settings.TAX_RATE);
  settings.TAX_THRESHOLD = toNumber_(settings.TAX_THRESHOLD);
  settings.NO_MIN_DIGITS = Math.max(1, Math.round(toNumber_(settings.NO_MIN_DIGITS) || 2));
  settings.CURRENCY = currencyForMarket_(key);
  return settings;
}

/**
 * Hợp đồng và BBNT CHỈ áp dụng cho VN — chủ project quyết định 2026-07-30: TH và TW
 * không cần làm hợp đồng.
 *
 * Mã cho TH/TW vẫn được GIỮ trong file này (template, mô hình thuế, số bằng chữ tiếng
 * Anh): không xoá được mà không đụng vào helper dùng chung, và dữ liệu TH/TW đã tồn
 * tại phải để nguyên. Nhưng mọi đường TẠO MỚI phải bị chặn ở BACKEND — ẩn trên UI thì
 * một lệnh google.script.run vẫn phát hành được hợp đồng ngoài phạm vi.
 */
const CONTRACT_ENABLED_MARKETS = Object.freeze(['VN']);
// Thuế VN cố định trong source, không cấu hình được nữa (F06b). Hai key CONFIG tương
// ứng vẫn còn trên sheet và contractSettingsFor_ vẫn đọc chúng vào settings.TAX_RATE /
// TAX_THRESHOLD — nhưng calculateContractTax_ KHÔNG dùng settings, nên giá trị đó chỉ
// còn để hiển thị. Chưa xoá dòng CONFIG production: đó là xoá dữ liệu thật, cần quyết
// định riêng.
//
// SỬA 2026-07-30: bản trước của ghi chú này nói "contractAmountsFor_ vẫn dùng
// settings.TAX_RATE cho TH/TW". Điều đó đúng lúc viết nhưng SAI sau khi F25 vào cùng
// batch. Cả hai caller của contractAmountsFor_ (generateContractV2, prepareAcceptance)
// giờ đều đi qua contractAssertMarketInScope_, và hàm đó chỉ cho VN — nên nhánh
// non-VN trong contractAmountsFor_ (net * settings.TAX_RATE) đã thành CODE CHẾT.
// Chỗ đọc TAX_RATE còn lại duy nhất là field taxRate của getContractHubData, mà UI nay
// hiển thị "10% (fixed)" cố định. Nói cách khác: không còn code nào dùng hai key đó để
// TÍNH nữa — điều kiện "xác minh không còn code đọc" của F06b coi như đã thoả.
const CONTRACT_FIXED_TAX_FIELDS = Object.freeze(['TAX_RATE', 'TAX_THRESHOLD']);
function contractAssertMarketInScope_(market) {
  const key = normalizeMarket_(market);
  if (CONTRACT_ENABLED_MARKETS.indexOf(key) === -1) {
    throw new Error('Contracts and acceptance certificates are issued for ' +
      CONTRACT_ENABLED_MARKETS.join('/') + ' campaigns only — ' +
      (cleanText_(market) || 'this market') + ' campaigns do not use them.');
  }
  return key;
}

/**
 * Chia `total` thành `count` dòng sao cho TỔNG BẰNG ĐÚNG `total`.
 *
 * Mọi dòng lấy round(total / count), dòng CUỐI gánh phần dư. Trước đây mỗi dòng BBNT
 * đều lấy round(net / số bài) rồi Total = unitPrice × số bài, nên net 10.000.000 chia
 * 3 bài ra tổng 9.999.999 — lệch net một đồng trên một chứng từ được ký và mang đi
 * thanh toán. Hàm thuần để test_contractSplitLineAmounts_ khoá bất biến đó lại.
 */
function contractSplitLineAmounts_(total, count) {
  const lines = Math.max(0, Math.round(toNumber_(count)));
  if (!lines) return [];
  const amount = Math.round(toNumber_(total));
  const each = Math.round(amount / lines);
  const out = [];
  for (let index = 0; index < lines - 1; index += 1) out.push(each);
  out.push(amount - each * (lines - 1));
  return out;
}

function contractAssertConfigured_(settings, needAcceptance) {
  if (!cleanText_(settings.TEMPLATE_ID)) {
    throw new Error('No contract template is configured for ' + settings.Market +
      '. Set CONTRACT_' + settings.Market + '_TEMPLATE_ID in the CONFIG sheet ' +
      '(the Google Docs file ID of the template).');
  }
  if (!cleanText_(settings.FOLDER_ID)) {
    throw new Error('No output folder is configured for ' + settings.Market +
      '. Set CONTRACT_' + settings.Market + '_FOLDER_ID in the CONFIG sheet.');
  }
  if (needAcceptance && !cleanText_(settings.ACCEPTANCE_TEMPLATE_ID)) {
    throw new Error('No acceptance (BBNT) template is configured for ' + settings.Market +
      '. Set CONTRACT_' + settings.Market + '_ACCEPTANCE_TEMPLATE_ID in the CONFIG sheet.');
  }
}

/* ============================================================================
 * SECTION 1 — Numbering. One reserved counter per market and per year.
 * ========================================================================== */

/**
 * Atomically reserves the next serial. Must be called inside
 * withDocumentLock_ so two simultaneous generations cannot take the same one.
 */
function contractReserveSerial_(counterPrefix, market, year, minDigits) {
  const key = counterPrefix + market + '_' + year;
  // BẮT BUỘC đọc lại từ sheet. getConfigMap_ -> readTable_ ưu tiên __tableCache_,
  // và cache đó đã được contractSettingsFor_ nạp TRƯỚC khi lock được lấy. Không
  // xoá cache ở đây thì read-modify-write không còn atomic dù đang nằm trong lock:
  // hai người bấm Generate cách nhau vài giây sẽ cùng đọc counter cũ, cùng cấp một
  // số, và tạo ra hai hợp đồng đã ký mang cùng số.
  invalidateTableCache_('CONFIG');
  const config = getConfigMap_();
  let current = Math.round(toNumber_(config[key]));

  // First run for this market/year: seed from whatever already exists so we
  // never reissue a number that is already on a signed document.
  if (!current) current = contractHighestExistingSerial_(counterPrefix, market, year);

  const next = current + 1;
  upsertConfigValue_(key, String(next),
    'Last issued ' + (counterPrefix === CONTRACT_HUB.ACCEPTANCE_COUNTER_PREFIX ? 'acceptance' : 'contract') +
    ' serial for ' + market + ' ' + year);
  return String(next).padStart(minDigits, '0');
}

/**
 * Serial cao nhất đã phát hành cho ĐÚNG một chuỗi số, dùng để seed counter lần đầu
 * của mỗi market/năm.
 *
 * Trước đây hàm này quét CẢ CONTRACTS lẫn ACCEPTANCES bất kể đang seed counter nào,
 * nên hai chuỗi số độc lập dùng chung một bể: BBNT đã tới 12 thì hợp đồng VN đầu năm
 * ra 13/2026 thay vì 01/2026, và ngược lại. Chỉ bùng ở lần phát hành ĐẦU TIÊN mỗi
 * market mỗi năm — tức mỗi tháng Một — và con số đó nằm trên giấy đã ký, không sửa
 * được. Giờ mỗi chuỗi chỉ đọc bảng của chính nó.
 */
function contractHighestExistingSerial_(counterPrefix, market, year) {
  const isAcceptance = counterPrefix === CONTRACT_HUB.ACCEPTANCE_COUNTER_PREFIX;
  const sheetName = isAcceptance ? 'ACCEPTANCES' : 'CONTRACTS';
  const numberField = isAcceptance ? 'Acceptance_No' : 'Contract_No';
  let highest = 0;
  const pattern = new RegExp('-(\\d+)\\s*/\\s*' + year + '\\s*$');

  readTable_(sheetName).forEach(function (row) {
    const match = cleanText_(row[numberField]).match(pattern);
    if (match) highest = Math.max(highest, Number(match[1]) || 0);
  });

  // Sheet legacy [SNOWVN] chỉ chứa HỢP ĐỒNG, nên chỉ seed chuỗi hợp đồng.
  if (!isAcceptance && market === 'VN') {
    highest = Math.max(highest, contractLegacyHighestSerial_(year));
  }
  return highest;
}

/** Reads the legacy [SNOWVN] Contract sheet so VN numbering stays continuous. */
function contractLegacyHighestSerial_(year) {
  const config = getConfigMap_();
  const spreadsheetId = cleanText_(config[CONTRACT_HUB.LEGACY_SPREADSHEET_KEY]) ||
    (typeof CONTRACT_CONFIG !== 'undefined' ? CONTRACT_CONFIG.SOURCE_SPREADSHEET_ID : '');
  if (!spreadsheetId) return 0;

  let highest = 0;
  try {
    const sheet = SpreadsheetApp.openById(spreadsheetId)
      .getSheetByName(cleanText_(config.LEGACY_CONTRACT_SHEET_NAME) || CONTRACT_HUB.LEGACY_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return 0;
    const values = sheet.getDataRange().getDisplayValues();
    const headers = values.shift().map(function (value) { return cleanText_(value).toLowerCase(); });
    const noIndex = headers.indexOf('no');
    const contractNoIndex = headers.indexOf('contract no');
    const pattern = new RegExp('-(\\d+)\\s*/\\s*' + year);
    values.forEach(function (row) {
      // Chỉ xét dòng thuộc ĐÚNG năm đang hỏi. Trước đây cột 'No' được max() vô
      // điều kiện, khác với mọi nguồn seed khác đều lọc theo năm — nên counter của
      // năm mới bị seed từ serial cao nhất mọi thời của sheet legacy: sheet kết
      // thúc 2025 ở No = 240 thì hợp đồng VN đầu tiên của 2026 thành 241/2026 thay
      // vì 01/2026, và lặp lại như vậy mỗi tháng Một.
      const contractNo = contractNoIndex >= 0 ? cleanText_(row[contractNoIndex]) : '';
      const match = contractNo.match(pattern);
      if (!match) return;
      highest = Math.max(highest, Number(match[1]) || 0);
      if (noIndex >= 0) {
        highest = Math.max(highest, Number(String(row[noIndex] || '').replace(/\D/g, '')) || 0);
      }
    });
  } catch (error) {
    // A missing permission must never block generation — the local counter wins.
    console.warn('Legacy contract number lookup skipped: ' + (error.message || String(error)));
  }
  return highest;
}

/* ============================================================================
 * SECTION 2 — Money formatting, per language
 * ========================================================================== */

function contractFormatMoney_(value) {
  const number = Number(value);
  return isNaN(number) ? '' : Math.round(number).toLocaleString('en-US');
}

/** Dispatches to the right in-words renderer for the market's language. */
function contractAmountInWords_(value, settings) {
  if (cleanText_(settings.LANGUAGE) === 'vi') {
    return numberToVietnameseCurrencyContract_(value);
  }
  return contractEnglishCurrency_(value, settings.CURRENCY);
}

const CONTRACT_EN_ONES = Object.freeze([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
]);
const CONTRACT_EN_TENS = Object.freeze([
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
]);
const CONTRACT_EN_SCALES = Object.freeze(['', 'thousand', 'million', 'billion', 'trillion']);

function contractEnglishThreeDigits_(number) {
  const words = [];
  const hundreds = Math.floor(number / 100);
  const remainder = number % 100;
  if (hundreds) words.push(CONTRACT_EN_ONES[hundreds], 'hundred');
  if (remainder) {
    if (hundreds) words.push('and');
    if (remainder < 20) {
      words.push(CONTRACT_EN_ONES[remainder]);
    } else {
      const tens = Math.floor(remainder / 10);
      const units = remainder % 10;
      words.push(units ? CONTRACT_EN_TENS[tens] + '-' + CONTRACT_EN_ONES[units] : CONTRACT_EN_TENS[tens]);
    }
  }
  return words.join(' ');
}

function contractEnglishWords_(number) {
  if (number === 0) return 'zero';
  const groups = [];
  let remaining = Math.abs(Math.round(number));
  while (remaining > 0) {
    groups.push(remaining % 1000);
    remaining = Math.floor(remaining / 1000);
  }
  const parts = [];
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    if (!groups[index]) continue;
    parts.push(contractEnglishThreeDigits_(groups[index]));
    if (CONTRACT_EN_SCALES[index]) parts.push(CONTRACT_EN_SCALES[index]);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function contractEnglishCurrency_(value, currency) {
  const number = Math.round(Number(value));
  if (isNaN(number)) return '';
  const text = (number < 0 ? 'minus ' : '') + contractEnglishWords_(Math.abs(number)) +
    ' ' + cleanText_(currency);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* ============================================================================
 * SECTION 3 — Tax model per market
 * ========================================================================== */

/**
 * VN: personal income tax is grossed up — the creator receives the net amount
 *     and SNOW absorbs the tax, but only from the threshold upwards.
 *
 * TH/TW: DEAD BRANCH since F25 (2026-07-30). Contracts and acceptance
 *     certificates are VN-only now, and both callers of this function
 *     (generateContractV2, prepareAcceptance) go through
 *     contractAssertMarketInScope_ first, which admits VN alone. The branch is
 *     kept rather than deleted because it is the only written record of the TH/TW
 *     model — withholding is deducted, and the team enters Tax and Service_Fee on
 *     the campaign KOL row, so those numbers are trusted and a default is only
 *     suggested when they are blank. If TH/TW contracts ever come back into
 *     scope, this is what to restore; until then nothing reaches it.
 *
 * Returns { net, tax, serviceFee, gross }.
 */
function contractAmountsFor_(campaignKol, settings) {
  // campaignKolNetAmount_ tests whether Final_Fee was *entered*, not whether it
  // is truthy. With `||`, a barter deal (Final_Fee = 0) fell back to the quoted
  // price and the contract was issued for a fee nobody had agreed to.
  const net = campaignKolNetAmount_(campaignKol) +
    Math.max(0, toNumber_(campaignKol.Code_Ad_Fee));
  if (net <= 0) {
    throw new Error('Net amount plus code ad fee must be greater than 0. ' +
      'A barter collaboration has no fee to put in a contract: either record the ' +
      'agreed fee, or clear Final_Fee to fall back to the quoted amount.');
  }

  if (settings.Market === 'VN') {
    const gross = campaignKolGrossAmount_(campaignKol);
    return { net: net, tax: Math.max(0, gross - net), serviceFee: 0, gross: gross };
  }

  const serviceFee = Math.max(0, toNumber_(campaignKol.Service_Fee));
  const enteredTax = toNumber_(campaignKol.Tax);
  const tax = enteredTax > 0
    ? enteredTax
    : Math.round(net * (settings.TAX_RATE || 0));
  return { net: net, tax: tax, serviceFee: serviceFee, gross: net + tax + serviceFee };
}

/* ============================================================================
 * SECTION 4 — Shared Drive + Docs helpers
 * ========================================================================== */

function contractSanitizeName_(name) {
  return String(name || '').replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 140);
}

function contractFormatDate_(value) {
  const date = parseDate_(value);
  return date ? Utilities.formatDate(date, APP.TIMEZONE, 'dd/MM/yyyy') : cleanText_(value);
}

function contractPadTwo_(value) {
  return String(Math.max(0, Math.floor(Number(value) || 0))).padStart(2, '0');
}

/** One folder per contract, reused by the contract and its acceptance doc. */
function contractGetFolder_(settings, folderName) {
  const root = DriveApp.getFolderById(cleanText_(settings.FOLDER_ID));
  const name = contractSanitizeName_(folderName);
  const existing = root.getFoldersByName(name);
  return existing.hasNext() ? existing.next() : root.createFolder(name);
}

/** Replaces {{Placeholder}} everywhere, including header and footer. */
function contractReplacePlaceholders_(document, fields) {
  const containers = [document.getBody(), document.getHeader(), document.getFooter()]
    .filter(Boolean);
  Object.keys(fields).forEach(function (name) {
    const placeholder = ('{{' + name + '}}').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const value = fields[name] === null || fields[name] === undefined ? '' : String(fields[name]);
    containers.forEach(function (container) { container.replaceText(placeholder, value); });
  });
}

// ---------------------------------------------------------------------------
// F12 bước 5 — thay sleep đoán mò bằng một điều kiện ĐO ĐƯỢC.
//
// Trước đây: document.saveAndClose() rồi Utilities.sleep(800) (hợp đồng) hoặc 1200
// (BBNT) rồi mới docFile.getAs(MimeType.PDF). Hai con số đó KHÔNG có một dòng chú thích
// nào ở bất kỳ đâu — không trong ContractHub, không trong ContractGenerator, không trong
// bản export cũ. Chúng là phỏng đoán, và một phỏng đoán cố định sai theo cả hai chiều:
// quá lâu khi Drive nhanh, quá ngắn đúng lúc Drive chậm — mà lúc đó hậu quả là PDF
// render nội dung TRƯỚC khi thay placeholder, tức một hợp đồng pháp lý sai.
//
// Điều kiện thật cần chờ: Drive đã thấy lần sửa cuối. Nên thay vì đoán, đọc
// getLastUpdated() và chờ tới khi HAI lần đọc liên tiếp giống nhau — file đã lắng.
// Không so với giờ của server Apps Script: lệch giờ giữa hai bên có thể vài giây và sẽ
// làm vòng lặp hoặc thoát ngay hoặc chờ hết cap. So hai mốc thời gian đều do Drive cấp
// thì không có vấn đề lệch giờ.
//
// Thường: chờ tới mốc tối thiểu 400ms, thấy đã lắng, cộng sàn 100ms -> ~500ms thay vì
// 800 (hợp đồng) hoặc 1200 (BBNT). Khi Drive thật sự còn đang ghi: vòng lặp chờ tiếp,
// tới cap 4000ms — LÂU HƠN trước, và đó mới là điều đúng.
// Đây không phải tối ưu tốc độ; đây là bỏ phỏng đoán.
//
// Nếu đọc metadata lỗi: quay về đúng hành vi cũ, sleep(1200), tức con số bảo thủ hơn
// trong hai con số cũ. Một lần Drive hiccup không được biến thành "không chờ gì cả".
// ---------------------------------------------------------------------------
const CONTRACT_PDF_SETTLE = Object.freeze({
  POLL_MS: 150,
  // Không được thoát trước mốc này dù hai lần đọc đã giống nhau. Lý do: không có gì
  // đảm bảo getLastUpdated() mịn tới millisecond — nếu Drive trả về độ chính xác một
  // giây thì hai lần đọc cách nhau 150ms sẽ giống nhau NGAY CẢ KHI file còn đang ghi,
  // và "điều kiện đo được" lại thành thoát sớm, tệ hơn cả sleep(800) cũ. Mốc này chặn
  // đúng trường hợp đó: xấu nhất là 400+100ms, vẫn nhanh hơn 800/1200, và không bao
  // giờ thoát sớm một cách vô lý.
  MIN_WAIT_MS: 400,
  MAX_WAIT_MS: 4000,
  FLOOR_MS: 100,
  FALLBACK_MS: 1200,
});

function contractLastUpdatedMs_(fileId) {
  return DriveApp.getFileById(fileId).getLastUpdated().getTime();
}

/**
 * Pure: given two consecutive Drive lastUpdated readings and how long we have waited,
 * has the file settled? Split out of the loop below precisely because it is the one
 * part of the PDF wait that can be tested without Drive — and an early `true` here is
 * the failure that produces a stale PDF on a real contract. Covered by
 * test_contractSettleShouldStop_.
 */
function contractSettleShouldStop_(current, previous, waitedMs) {
  return current === previous && waitedMs >= CONTRACT_PDF_SETTLE.MIN_WAIT_MS;
}

/**
 * Saves the document, then waits until Drive reports it settled, then returns.
 * Call this instead of `document.saveAndClose(); Utilities.sleep(n);` before any
 * `getAs(MimeType.PDF)`. Returns the milliseconds actually waited, for logging.
 */
function contractSaveAndSettle_(document, docFile) {
  document.saveAndClose();
  try {
    const fileId = docFile.getId();
    let previous = contractLastUpdatedMs_(fileId);
    let waited = 0;
    while (waited < CONTRACT_PDF_SETTLE.MAX_WAIT_MS) {
      Utilities.sleep(CONTRACT_PDF_SETTLE.POLL_MS);
      waited += CONTRACT_PDF_SETTLE.POLL_MS;
      const current = contractLastUpdatedMs_(fileId);
      if (contractSettleShouldStop_(current, previous, waited)) break;
      previous = current;
    }
    // Metadata thấy rồi không đồng nghĩa pipeline export đã sẵn sàng. Một khoảng sàn
    // nhỏ là bảo hiểm rẻ, và vẫn nhanh hơn nhiều so với 800/1200 cố định.
    Utilities.sleep(CONTRACT_PDF_SETTLE.FLOOR_MS);
    return waited + CONTRACT_PDF_SETTLE.FLOOR_MS;
  } catch (error) {
    Utilities.sleep(CONTRACT_PDF_SETTLE.FALLBACK_MS);
    return CONTRACT_PDF_SETTLE.FALLBACK_MS;
  }
}

function contractExportPdf_(docFile, folder, pdfName) {
  const stale = folder.getFilesByName(pdfName);
  while (stale.hasNext()) stale.next().setTrashed(true);
  return folder.createFile(docFile.getAs(MimeType.PDF).setName(pdfName));
}

/* ============================================================================
 * SECTION 5 — Contract generation, all markets
 * ========================================================================== */

// ---------------------------------------------------------------------------
// F12 — cờ "đang generate", sống trong CacheService chứ không trong sheet.
//
// Vì sao CacheService: không cần cột mới, không cần migration, và TTL tự dọn khi
// một execution bị giết ở mốc 6 phút. Vì sao KHÔNG dùng một dòng CONTRACTS làm cờ:
// Contract_URL rỗng đã mang nghĩa "hợp đồng ghi tay", xem khối chú thích trong
// generateContractV2.
//
// TTL 300 giây < mốc 6 phút của Apps Script, nên cờ mồ côi không thể chặn vĩnh viễn.
// Cache lỗi thì coi như "không đang chạy" — cờ này là lớp bảo vệ thêm, không phải
// điều kiện tiên quyết, và nó không được tự biến thành lý do chặn generate.
//
// Dùng chung cho cả hợp đồng (khoá theo Campaign_KOL_ID) và BBNT (khoá theo
// Acceptance_ID). Không đụng nhau vì makeId_ cho hai bảng hai tiền tố khác nhau, nên
// hai không gian ID không bao giờ trùng.
// ---------------------------------------------------------------------------
const CONTRACT_GEN_FLAG_TTL_SECONDS = 300;

function contractGenerationFlagKey_(campaignKolId) {
  return 'ctrgen_v1_' + cleanText_(campaignKolId);
}

function contractGenerationInProgress_(campaignKolId) {
  try {
    return !!CacheService.getScriptCache().get(contractGenerationFlagKey_(campaignKolId));
  } catch (error) {
    return false;
  }
}

function contractSetGenerationInProgress_(campaignKolId) {
  try {
    CacheService.getScriptCache().put(
      contractGenerationFlagKey_(campaignKolId), '1', CONTRACT_GEN_FLAG_TTL_SECONDS);
  } catch (error) { /* cache hỏng thì bỏ qua, xem chú thích ở trên */ }
}

function contractClearGenerationInProgress_(campaignKolId) {
  try {
    CacheService.getScriptCache().remove(contractGenerationFlagKey_(campaignKolId));
  } catch (error) { /* no-op */ }
}

/**
 * payload: { Campaign_KOL_ID, regenerate }
 * Replaces the VN-only generateContract(). Point the UI at this.
 */
function generateContractV2(payload) {
  const user = requireRole_(['Admin', 'Booking']);
  payload = payload || {};
  const campaignKolId = cleanText_(payload.Campaign_KOL_ID);
  requireFields_({ Campaign_KOL_ID: campaignKolId }, ['Campaign_KOL_ID']);

  const campaignKol = findRecord_('CAMPAIGN_KOLS', 'Campaign_KOL_ID', campaignKolId);
  if (!campaignKol) throw new Error('Campaign KOL not found: ' + campaignKolId);
  const campaign = findRecord_('CAMPAIGNS', 'Campaign_ID', campaignKol.Campaign_ID);
  if (!campaign) throw new Error('Campaign not found.');
  assertCampaignAccess_(user, campaign);
  contractAssertMarketInScope_(campaign.Market);

  const settings = contractSettingsFor_(campaign.Market);
  contractAssertConfigured_(settings, false);

  const account = findRecord_('ACCOUNTS', 'Account_ID', campaignKol.Account_ID) || {};
  const creator = findRecord_('CREATORS', 'Creator_ID', campaignKol.Creator_ID || account.Creator_ID);
  if (!creator) throw new Error('Creator profile not found.');

  const missing = contractMissingCreatorFields_(creator);
  if (missing.length) {
    throw new Error('Creator legal information is incomplete: ' + missing.join(', ') +
      '. Update the KOL full profile, or send the creator an info form link, before generating.');
  }

  const amounts = contractAmountsFor_(campaignKol, settings);

  // ==========================================================================
  // F12 — ba pha, HAI lock ngắn, mọi việc chậm nằm NGOÀI lock.
  //
  // Trước đây một lock duy nhất bao cả makeCopy, DocumentApp, ~35 replaceText,
  // sleep(800) và export PDF. LockService.getScriptLock() dùng chung cho MỌI người,
  // nên một lần generate giữ nó hàng chục giây và mọi người khác timeout ở
  // waitLock(30000) khi chỉ đang lưu một fee hay một deliverable.
  //
  // Chỉ ba thứ thật sự cần loại trừ lẫn nhau: cấp số serial (đọc-sửa-ghi trên counter
  // CONFIG), quyết định "đã có / đã ký chưa", và các lần GHI cuối. Drive/Docs/PDF không
  // đụng tới state dùng chung nào.
  //
  // KHÔNG ghi "pending row": Contract_URL rỗng ĐÃ có nghĩa "hợp đồng ghi tay, tài liệu
  // ở ngoài Drive" (saveContractRecord cho phép), nên không thể gán thêm nghĩa "đang
  // generate". Thay vào đó chỉ giữ số và ghi ACTIVITY_LOG — khoảng trống số hiệu tự
  // tường thuật, và registry chỉ chứa hợp đồng thật sự tồn tại.
  // Xem docs/f12-contract-lock-refactor-plan.md.
  // ==========================================================================
  const now = new Date();
  const year = now.getFullYear();
  const dueDate = campaign.Posting_End || campaign.End_Date || '';

  // ---- PHA 1: lock ngắn — kiểm tra lại, cấp số, ghi log. ----
  const reserved = withDocumentLock_(function () {
    const existing = readTable_('CONTRACTS').filter(function (row) {
      return cleanText_(row.Campaign_KOL_ID) === campaignKolId && cleanText_(row.Contract_URL);
    });
    if (existing.length && !isTrue_(payload.regenerate)) {
      const latest = existing[existing.length - 1];
      return { reuse: publicValue_({
        reused: true,
        Contract_ID: latest.Contract_ID,
        Contract_No: latest.Contract_No,
        Contract_URL: latest.Contract_URL,
        Contract_PDF_URL: latest.Contract_PDF_URL,
        Folder_URL: latest.Folder_URL,
      }) };
    }
    if (existing.length && isTrue_(payload.regenerate)) {
      const signed = existing.filter(function (row) { return cleanText_(row.Sign_Status) === 'Signed'; });
      if (signed.length) {
        throw new Error('A signed contract already exists (' + cleanText_(signed[0].Contract_No) +
          '). Cancel it before issuing a replacement.');
      }
    }
    // Trước đây lock dài tự động chống double-click: lần gọi thứ hai chờ ở waitLock rồi
    // thấy dòng của lần đầu và trả về reuse. Với lock ngắn thì lần thứ hai vào pha 1 khi
    // lần đầu còn đang dựng tài liệu, không thấy dòng nào, và sẽ cấp một số THỨ HAI —
    // hai hợp đồng, hai số, cho cùng một KOL. Cờ này thay thế tác dụng phụ đó.
    if (contractGenerationInProgress_(campaignKolId)) {
      throw new Error('A contract for this KOL is already being generated. ' +
        'Wait a few seconds, refresh, and check the contract list before trying again.');
    }
    const issued = contractReserveSerial_(
      CONTRACT_HUB.COUNTER_KEY_PREFIX, settings.Market, year, settings.NO_MIN_DIGITS);
    const no = cleanText_(settings.PREFIX) + issued + '/' + year;
    contractSetGenerationInProgress_(campaignKolId);
    // Số đã bị tiêu thụ ngay tại đây. Nếu pha 2 thất bại thì dãy số sẽ có một khoảng
    // trống, và dòng log này là thứ giải thích khoảng trống đó.
    logActivity_(user.Email, 'RESERVE_CONTRACT_SERIAL', 'CONTRACT', campaignKolId,
      no + ' reserved; document not built yet');
    return { serial: issued, contractNo: no };
  });
  if (reserved.reuse) return reserved.reuse;
  const serial = reserved.serial;
  const contractNo = reserved.contractNo;

  const fields = {
    'No': serial,
    'Contract no': contractNo,
    'Market': settings.Market,
    'Currency': settings.CURRENCY,
    'Creator': account.Username || creator.Display_Name || '',
    'Title': creator.Title || '',
    'Full name': creator.Legal_Name || '',
    'Link profile': account.Profile_URL || '',
    'Apps': campaign.App || '',
    'Platforms': account.Platform || campaign.Platforms || '',
    'Campaign': campaign.Campaign_Name || '',
    'Day': contractPadTwo_(now.getDate()),
    'Month': contractPadTwo_(now.getMonth() + 1),
    'Year': String(year),
    'Date': contractPadTwo_(now.getDate()) + '/' + contractPadTwo_(now.getMonth() + 1) + '/' + year,
    'ID No': creator.ID_No || '',
    'Date of issue': contractFormatDate_(creator.Date_Of_Issue),
    'Permanent address': creator.Permanent_Address || '',
    'Bank account': creator.Bank_Account || '',
    'Bank name': creator.Bank_Name || '',
    'Account holder': creator.Legal_Name || '',
    'Qty': 1,
    'Unit Price': contractFormatMoney_(amounts.net),
    'Net': contractFormatMoney_(amounts.net),
    'Net in words': contractAmountInWords_(amounts.net, settings),
    'Tax': contractFormatMoney_(amounts.tax),
    'Tax in words': contractAmountInWords_(amounts.tax, settings),
    'Service fee': contractFormatMoney_(amounts.serviceFee),
    'Gross': contractFormatMoney_(amounts.gross),
    'Gross in words': contractAmountInWords_(amounts.gross, settings),
    'Duedate': contractFormatDate_(dueDate),
    'Deliverables': campaignKol.Deliverable_Summary || '',
  };

  const creatorLabel = creator.Legal_Name || creator.Display_Name || account.Username || 'Creator';
  const fileName = contractSanitizeName_(
    '[SNOW' + settings.Market + '] ' + contractNo + '_' + (account.Username || creatorLabel));

  // ---- PHA 2: KHÔNG lock. Toàn bộ Drive/Docs/PDF nằm ở đây. ----
  const folder = contractGetFolder_(settings, serial + ' - ' + creatorLabel);
  const docFile = DriveApp.getFileById(cleanText_(settings.TEMPLATE_ID)).makeCopy(fileName, folder);
  try {
    const document = DocumentApp.openById(docFile.getId());
    contractReplacePlaceholders_(document, fields);
    contractSaveAndSettle_(document, docFile);
    const pdfFile = contractExportPdf_(docFile, folder, fileName + '.pdf');

    const record = {
      Contract_ID: makeId_('CTR'),
      Campaign_KOL_ID: campaignKolId,
      Campaign_ID: campaign.Campaign_ID,
      Creator_ID: creator.Creator_ID,
      Contract_No: contractNo,
      Template_Name: cleanText_(settings.TEMPLATE_NAME) || settings.Market + ' Standard',
      Contract_URL: docFile.getUrl(),
      Sign_Status: 'Draft',
      Sent_Date: '',
      Signed_Date: '',
      Due_Date: dueDate,
      Owner_Email: user.Email,
      Notes: '',
      Created_At: now,
      Updated_At: now,
      Contract_PDF_URL: pdfFile.getUrl(),
      Folder_URL: folder.getUrl(),
    };
    // ---- PHA 3: lock ngắn thứ hai, CHỈ quanh các lần ghi. ----
    withDocumentLock_(function () {
      appendRecord_('CONTRACTS', record);
      updateRecord_('CAMPAIGN_KOLS', 'Campaign_KOL_ID', campaignKolId, {
        Contract_Status: 'Draft',
        Updated_At: now,
      });
      logActivity_(user.Email, 'GENERATE_CONTRACT', 'CONTRACT', record.Contract_ID,
        settings.Market + ' · ' + contractNo);
      return null;
    });
    contractClearGenerationInProgress_(campaignKolId);

    return publicValue_({
      reused: false,
      Market: settings.Market,
      Contract_ID: record.Contract_ID,
      Contract_No: contractNo,
      Contract_URL: record.Contract_URL,
      Contract_PDF_URL: record.Contract_PDF_URL,
      Folder_URL: record.Folder_URL,
    });
  } catch (error) {
    try { docFile.setTrashed(true); } catch (ignored) { /* nothing to clean up */ }
    contractClearGenerationInProgress_(campaignKolId);
    // Số đã tiêu thụ nhưng không có hợp đồng nào ra đời — ghi lại để khoảng trống
    // trong dãy số không thành một câu hỏi không ai trả lời được. Bọc try/catch:
    // một lần ghi log thất bại không được che mất lỗi thật bên dưới.
    try {
      logActivity_(user.Email, 'CONTRACT_SERIAL_ABANDONED', 'CONTRACT', campaignKolId,
        contractNo + ' — ' + (error.message || String(error)));
    } catch (ignored) { /* no-op */ }
    throw new Error('Contract generation failed: ' + (error.message || String(error)));
  }
}

const CONTRACT_HUB_REQUIRED_CREATOR_FIELDS = Object.freeze([
  'Title', 'Legal_Name', 'ID_No', 'Date_Of_Issue',
  'Permanent_Address', 'Bank_Account', 'Bank_Name',
]);

function contractMissingCreatorFields_(creator) {
  const required = typeof CONTRACT_REQUIRED_CREATOR_FIELDS !== 'undefined'
    ? CONTRACT_REQUIRED_CREATOR_FIELDS
    : CONTRACT_HUB_REQUIRED_CREATOR_FIELDS;
  return required.filter(function (field) { return !cleanText_(creator[field]); });
}

/* ============================================================================
 * SECTION 6 — Acceptance certificates (BBNT)
 * ========================================================================== */

/**
 * Builds acceptance lines from the campaign KOL's posted deliverables, so the
 * BBNT always reflects what actually went live instead of being retyped.
 * payload: { Contract_ID, Image_Usage_Fee, Notes }
 */
function prepareAcceptance(payload) {
  const user = requireRole_(['Admin', 'Booking']);
  payload = payload || {};
  const contractId = cleanText_(payload.Contract_ID);
  requireFields_({ Contract_ID: contractId }, ['Contract_ID']);

  const contract = findRecord_('CONTRACTS', 'Contract_ID', contractId);
  if (!contract) throw new Error('Contract not found: ' + contractId);
  const campaign = findRecord_('CAMPAIGNS', 'Campaign_ID', contract.Campaign_ID);
  assertCampaignAccess_(user, campaign || {});
  contractAssertMarketInScope_((campaign || {}).Market);

  const campaignKol = findRecord_('CAMPAIGN_KOLS', 'Campaign_KOL_ID', contract.Campaign_KOL_ID) || {};
  const settings = contractSettingsFor_((campaign || {}).Market);

  const posted = readTable_('DELIVERABLES').filter(function (row) {
    return cleanText_(row.Campaign_KOL_ID) === cleanText_(contract.Campaign_KOL_ID) &&
      cleanText_(row.Post_URL);
  });
  if (!posted.length) {
    throw new Error('This KOL has no deliverable with a post URL yet. ' +
      'An acceptance certificate can only be issued for content that is live.');
  }

  const amounts = contractAmountsFor_(campaignKol, settings);
  // Dồn phần dư làm tròn vào DÒNG CUỐI để Σ Content_Amount === net CHÍNH XÁC.
  // Trước đây mọi dòng đều lấy round(net / số bài) rồi Total = unitPrice × số bài,
  // nên net 10.000.000 chia 3 bài ra tổng 9.999.999 — lệch net một đồng trên một
  // chứng từ được ký và đem đi thanh toán.
  const lineAmounts = contractSplitLineAmounts_(amounts.net, posted.length);

  return withDocumentLock_(function () {
    const existing = readTable_('ACCEPTANCES').find(function (row) {
      return cleanText_(row.Contract_ID) === contractId;
    });
    if (existing && cleanText_(existing.Acceptance_URL)) {
      throw new Error('An acceptance document already exists for this contract (' +
        cleanText_(existing.Acceptance_No) + ').');
    }

    const now = new Date();
    const acceptanceId = existing ? existing.Acceptance_ID : makeId_('ACP');
    const imageUsageFee = Math.max(0, toNumber_(payload.Image_Usage_Fee));

    const record = {
      Acceptance_ID: acceptanceId,
      Contract_ID: contractId,
      Campaign_ID: contract.Campaign_ID,
      Campaign_KOL_ID: contract.Campaign_KOL_ID,
      Creator_ID: contract.Creator_ID,
      Acceptance_No: '',
      Market: settings.Market,
      Template_Name: cleanText_(settings.TEMPLATE_NAME) || settings.Market + ' Acceptance',
      Acceptance_URL: '',
      Acceptance_PDF_URL: '',
      Folder_URL: cleanText_(contract.Folder_URL),
      Status: 'Draft',
      Image_Usage_Fee: imageUsageFee,
      // Σ lineAmounts === amounts.net theo cách xây ở trên, nên tổng khớp net tuyệt đối.
      Total_Amount: amounts.net + imageUsageFee,
      Currency: settings.CURRENCY,
      Signed_Date: '',
      Owner_Email: user.Email,
      Notes: cleanText_(payload.Notes),
      Created_At: existing ? existing.Created_At : now,
      Updated_At: now,
    };

    if (existing) updateRecord_('ACCEPTANCES', 'Acceptance_ID', acceptanceId, record);
    else appendRecord_('ACCEPTANCES', record);

    // Rebuild the lines from scratch — the deliverable list is the truth.
    adminDeleteRowsWhere_('ACCEPTANCE_LINES', 'Acceptance_ID', [acceptanceId]);
    const lines = posted.map(function (deliverable, index) {
      return {
        Acceptance_Line_ID: makeId_('ACL'),
        Acceptance_ID: acceptanceId,
        Contract_ID: contractId,
        Deliverable_ID: deliverable.Deliverable_ID,
        Line_No: index + 1,
        App: cleanText_((campaign || {}).App),
        Platform: cleanText_(deliverable.Platform),
        Post_URL: cleanText_(deliverable.Post_URL),
        Qty: 1,
        // Qty = 1 nên Unit_Price phải bằng Content_Amount, kể cả ở dòng cuối đã gánh
        // phần dư — nếu không thì Qty × Unit_Price ≠ Content_Amount ngay trên bảng BBNT.
        Unit_Price: lineAmounts[index],
        Content_Amount: lineAmounts[index],
        Evidence_URLs: '',
        Status: 'Needs evidence',
        Notes: '',
        Created_At: now,
        Updated_At: now,
      };
    });
    appendRecords_('ACCEPTANCE_LINES', lines);

    logActivity_(user.Email, 'PREPARE_ACCEPTANCE', 'ACCEPTANCE', acceptanceId,
      lines.length + ' line(s) from posted deliverables');
    return publicValue_({ acceptance: record, lines: lines });
  });
}

/**
 * payload: { Acceptance_Line_ID, Evidence_URLs, Unit_Price, Content_Amount, Notes }
 * Evidence_URLs is a comma or newline separated list of Drive file/folder links
 * or direct image URLs — screenshots of the live posts.
 */
function saveAcceptanceLine(payload) {
  const user = requireRole_(['Admin', 'Booking']);
  payload = payload || {};
  const lineId = cleanText_(payload.Acceptance_Line_ID);
  requireFields_({ Acceptance_Line_ID: lineId }, ['Acceptance_Line_ID']);

  const line = findRecord_('ACCEPTANCE_LINES', 'Acceptance_Line_ID', lineId);
  if (!line) throw new Error('Acceptance line not found: ' + lineId);
  const campaign = findRecord_('CAMPAIGNS', 'Campaign_ID',
    (findRecord_('ACCEPTANCES', 'Acceptance_ID', line.Acceptance_ID) || {}).Campaign_ID);
  assertCampaignAccess_(user, campaign || {});

  return withDocumentLock_(function () {
    const evidence = contractNormalizeEvidenceList_(payload.Evidence_URLs);
    const changes = { Updated_At: new Date() };
    if (Object.prototype.hasOwnProperty.call(payload, 'Evidence_URLs')) {
      changes.Evidence_URLs = evidence.join('\n');
      changes.Status = evidence.length ? 'Ready' : 'Needs evidence';
    }
    ['Unit_Price', 'Content_Amount'].forEach(function (field) {
      if (Object.prototype.hasOwnProperty.call(payload, field)) {
        changes[field] = Math.max(0, toNumber_(payload[field]));
      }
    });
    if (Object.prototype.hasOwnProperty.call(payload, 'Notes')) changes.Notes = cleanText_(payload.Notes);

    const updated = updateRecord_('ACCEPTANCE_LINES', 'Acceptance_Line_ID', lineId, changes);
    contractRecalculateAcceptanceTotal_(line.Acceptance_ID);
    logActivity_(user.Email, 'UPDATE', 'ACCEPTANCE_LINE', lineId, evidence.length + ' evidence link(s)');
    return publicValue_(updated);
  });
}

/**
 * Advances a contract along Not started -> Info pending -> Draft -> Sent ->
 * Signed -> Cancelled. Before this, Sign_Status could only be changed by hand
 * through saveContractRecord, and Sent_Date / Signed_Date were typed in
 * manually, so the dates routinely disagreed with the status.
 *
 * A milestone date is stamped only while it is still empty, so moving the
 * status back and forth to fix a mistake never overwrites the real date.
 */
function setContractSignStatus(payload) {
  const user = requireRole_(['Admin', 'Booking']);
  payload = payload || {};
  const contractId = cleanText_(payload.Contract_ID);
  const status = cleanText_(payload.Sign_Status);
  requireFields_({ Contract_ID: contractId, Sign_Status: status }, ['Contract_ID', 'Sign_Status']);
  if (LISTS.CONTRACT_STATUSES.indexOf(status) === -1) {
    throw new Error('Invalid contract status: ' + status +
      '. Expected one of ' + LISTS.CONTRACT_STATUSES.join(', ') + '.');
  }

  const contract = findRecord_('CONTRACTS', 'Contract_ID', contractId);
  if (!contract) throw new Error('Contract not found: ' + contractId);
  const campaign = findRecord_('CAMPAIGNS', 'Campaign_ID', contract.Campaign_ID);
  assertCampaignAccess_(user, campaign || {});

  return withDocumentLock_(function () {
    const now = new Date();
    const today = Utilities.formatDate(now, APP.TIMEZONE, 'yyyy-MM-dd');
    const changes = { Sign_Status: status, Updated_At: now };
    if (status === 'Sent' && !cleanText_(contract.Sent_Date)) changes.Sent_Date = today;
    if (status === 'Signed' && !cleanText_(contract.Signed_Date)) changes.Signed_Date = today;

    const updated = updateRecord_('CONTRACTS', 'Contract_ID', contractId, changes);
    // Mirror onto CAMPAIGN_KOLS the same way generateContractV2 does, so the
    // campaign KOLs tab and the contract hub never disagree.
    if (cleanText_(contract.Campaign_KOL_ID)) {
      updateRecord_('CAMPAIGN_KOLS', 'Campaign_KOL_ID', contract.Campaign_KOL_ID, {
        Contract_Status: status,
        Updated_At: now,
      });
    }
    logActivity_(user.Email, 'SET_CONTRACT_STATUS', 'CONTRACT', contractId,
      (cleanText_(contract.Sign_Status) || 'blank') + ' -> ' + status);
    return publicValue_(updated);
  });
}

/**
 * Moves an acceptance (BBNT) between Draft -> Generated -> Signed / Cancelled.
 * ACCEPTANCES.Signed_Date has existed on the sheet since v1.11 but the only
 * write anywhere in the codebase set it to '' — nothing ever filled it in.
 * This is that missing step.
 */
function setAcceptanceStatus(payload) {
  const user = requireRole_(['Admin', 'Booking']);
  payload = payload || {};
  const acceptanceId = cleanText_(payload.Acceptance_ID);
  const status = cleanText_(payload.Status);
  requireFields_({ Acceptance_ID: acceptanceId, Status: status }, ['Acceptance_ID', 'Status']);
  if (LISTS.ACCEPTANCE_STATUSES.indexOf(status) === -1) {
    throw new Error('Invalid acceptance status: ' + status +
      '. Expected one of ' + LISTS.ACCEPTANCE_STATUSES.join(', ') + '.');
  }

  const acceptance = findRecord_('ACCEPTANCES', 'Acceptance_ID', acceptanceId);
  if (!acceptance) throw new Error('Acceptance not found: ' + acceptanceId);
  const campaign = findRecord_('CAMPAIGNS', 'Campaign_ID', acceptance.Campaign_ID);
  assertCampaignAccess_(user, campaign || {});
  if (status === 'Signed' && !cleanText_(acceptance.Acceptance_URL)) {
    throw new Error('Generate the BBNT document before marking it signed.');
  }

  return withDocumentLock_(function () {
    const now = new Date();
    const changes = { Status: status, Updated_At: now };
    if (status === 'Signed' && !cleanText_(acceptance.Signed_Date)) {
      changes.Signed_Date = Utilities.formatDate(now, APP.TIMEZONE, 'yyyy-MM-dd');
    }
    const updated = updateRecord_('ACCEPTANCES', 'Acceptance_ID', acceptanceId, changes);
    logActivity_(user.Email, 'SET_ACCEPTANCE_STATUS', 'ACCEPTANCE', acceptanceId,
      (cleanText_(acceptance.Status) || 'blank') + ' -> ' + status);
    return publicValue_(updated);
  });
}

function contractNormalizeEvidenceList_(value) {
  return String(value || '')
    .split(/[\n,;\s]+/)
    .map(function (item) { return cleanText_(item); })
    .filter(function (item) { return /^https?:\/\//i.test(item); })
    .filter(function (item, index, all) { return all.indexOf(item) === index; });
}

function contractRecalculateAcceptanceTotal_(acceptanceId) {
  const acceptance = findRecord_('ACCEPTANCES', 'Acceptance_ID', acceptanceId);
  if (!acceptance) return;
  const total = readTable_('ACCEPTANCE_LINES')
    .filter(function (row) { return cleanText_(row.Acceptance_ID) === cleanText_(acceptanceId); })
    .reduce(function (sum, row) { return sum + toNumber_(row.Content_Amount); }, 0);
  updateRecord_('ACCEPTANCES', 'Acceptance_ID', acceptanceId, {
    Total_Amount: total + toNumber_(acceptance.Image_Usage_Fee),
    Updated_At: new Date(),
  });
}

/**
 * Renders the BBNT document: expands the template's post table to one row per
 * line, fills the totals row, and inserts the evidence screenshots.
 * payload: { Acceptance_ID }
 */
function generateAcceptance(payload) {
  const user = requireRole_(['Admin', 'Booking']);
  payload = payload || {};
  const acceptanceId = cleanText_(payload.Acceptance_ID);
  requireFields_({ Acceptance_ID: acceptanceId }, ['Acceptance_ID']);

  const acceptance = findRecord_('ACCEPTANCES', 'Acceptance_ID', acceptanceId);
  if (!acceptance) throw new Error('Acceptance not found: ' + acceptanceId);
  if (cleanText_(acceptance.Acceptance_URL)) {
    throw new Error('This acceptance document has already been generated.');
  }
  // Lần kiểm tra này chỉ để trả lời sớm; lần có thẩm quyền nằm trong lock ở pha 1,
  // sau khi invalidate cache.
  const contract = findRecord_('CONTRACTS', 'Contract_ID', acceptance.Contract_ID);
  if (!contract) throw new Error('The linked contract no longer exists.');
  const campaign = findRecord_('CAMPAIGNS', 'Campaign_ID', acceptance.Campaign_ID);
  assertCampaignAccess_(user, campaign || {});
  contractAssertMarketInScope_(acceptance.Market || (campaign || {}).Market);

  const settings = contractSettingsFor_(acceptance.Market || (campaign || {}).Market);
  contractAssertConfigured_(settings, true);

  const lines = readTable_('ACCEPTANCE_LINES')
    .filter(function (row) { return cleanText_(row.Acceptance_ID) === acceptanceId; })
    .sort(function (a, b) { return toNumber_(a.Line_No) - toNumber_(b.Line_No); });
  if (!lines.length) throw new Error('This acceptance has no lines. Run prepareAcceptance first.');

  const withoutEvidence = lines.filter(function (row) {
    return !contractNormalizeEvidenceList_(row.Evidence_URLs).length;
  });
  if (withoutEvidence.length) {
    throw new Error(withoutEvidence.length + ' line(s) still have no evidence screenshot: ' +
      withoutEvidence.map(function (row) { return '#' + row.Line_No; }).join(', ') + '.');
  }

  const creator = findRecord_('CREATORS', 'Creator_ID', acceptance.Creator_ID) || {};
  const account = findRecord_('ACCOUNTS', 'Account_ID',
    (findRecord_('CAMPAIGN_KOLS', 'Campaign_KOL_ID', acceptance.Campaign_KOL_ID) || {}).Account_ID) || {};

  // ==========================================================================
  // F12 — ba pha, hai lock ngắn. Giống generateContractV2, nhưng ĐÂY là ca tệ nhất:
  // contractInsertEvidence_ → contractEvidenceBlobs_ gọi UrlFetchApp.fetch cho TỪNG
  // ảnh bằng chứng, cộng appendInlineImage và resize cho mỗi ảnh, cộng sleep(1200).
  // Một BBNT mười ảnh giữ script lock hàng phút — và lock đó dùng chung cho MỌI người,
  // nên trong khoảng đó mọi lần lưu của người khác chết ở waitLock(30000).
  //
  // Khác với hợp đồng: dòng ACCEPTANCES ĐÃ tồn tại (prepareAcceptance tạo nó với
  // Acceptance_URL rỗng), nên pha 3 là updateRecord_ chứ không phải append, và
  // Acceptance_URL rỗng ở đây KHÔNG nhập nhằng — BBNT không có đường "ghi tay".
  // Xem docs/f12-contract-lock-refactor-plan.md.
  // ==========================================================================
  const now = new Date();
  const year = now.getFullYear();

  const contentTotal = lines.reduce(function (sum, row) {
    return sum + toNumber_(row.Content_Amount);
  }, 0);
  const imageUsageFee = toNumber_(acceptance.Image_Usage_Fee);
  const total = contentTotal + imageUsageFee;
  const creatorLabel = creator.Legal_Name || creator.Display_Name || account.Username || 'Creator';

  // ---- PHA 1: lock ngắn — kiểm tra lại, cấp số, ghi log. ----
  const reserved = withDocumentLock_(function () {
    // Bắt buộc đọc lại: findRecord_ ở trên đã làm nóng cache ACCEPTANCES TRƯỚC khi lấy
    // lock, nên nếu không invalidate thì lần đọc trong lock vẫn là dữ liệu cũ và cái
    // "đã generate rồi" sẽ vô hiệu. Cùng một lý do khiến contractReserveSerial_ phải
    // invalidate CONFIG bên trong lock.
    invalidateTableCache_('ACCEPTANCES');
    const fresh = findRecord_('ACCEPTANCES', 'Acceptance_ID', acceptanceId);
    if (!fresh) throw new Error('Acceptance not found: ' + acceptanceId);
    if (cleanText_(fresh.Acceptance_URL)) {
      throw new Error('This acceptance document has already been generated.');
    }
    if (contractGenerationInProgress_(acceptanceId)) {
      throw new Error('This acceptance document is already being generated. ' +
        'Wait a few seconds, refresh, and check it before trying again.');
    }
    const issued = contractReserveSerial_(
      CONTRACT_HUB.ACCEPTANCE_COUNTER_PREFIX, settings.Market, year, settings.NO_MIN_DIGITS);
    const no = cleanText_(settings.ACCEPTANCE_PREFIX) + issued + '/' + year;
    contractSetGenerationInProgress_(acceptanceId);
    logActivity_(user.Email, 'RESERVE_ACCEPTANCE_SERIAL', 'ACCEPTANCE', acceptanceId,
      no + ' reserved; document not built yet');
    return { serial: issued, no: no };
  });
  const serial = reserved.serial;
  const acceptanceNo = reserved.no;

  const fileName = contractSanitizeName_(
    '[SNOW' + settings.Market + '] ' + acceptanceNo + '_' + (account.Username || creatorLabel));

  // ---- PHA 2: KHÔNG lock. Drive, Docs, UrlFetch cho từng ảnh, PDF. ----
  // Reuse the contract's folder so the pair lives together.
  const folder = contractGetFolder_(settings,
    cleanText_(contract.Contract_No).replace(/[^\dA-Za-z]+/g, '-') + ' - ' + creatorLabel);
  const docFile = DriveApp.getFileById(cleanText_(settings.ACCEPTANCE_TEMPLATE_ID))
    .makeCopy(fileName, folder);
  try {
    const document = DocumentApp.openById(docFile.getId());

    contractFillAcceptanceTable_(document, {
      creatorName: account.Username || creator.Display_Name || creatorLabel,
      lines: lines,
      imageUsageFee: imageUsageFee,
    });

    contractReplacePlaceholders_(document, {
      'No': serial,
      'Acceptance no': acceptanceNo,
      'Contract no': cleanText_(contract.Contract_No),
      'Creator': account.Username || creator.Display_Name || '',
      'Full name': creator.Legal_Name || '',
      'Title': creator.Title || '',
      'ID No': creator.ID_No || '',
      'Permanent address': creator.Permanent_Address || '',
      'Bank account': creator.Bank_Account || '',
      'Bank name': creator.Bank_Name || '',
      'Market': settings.Market,
      'Currency': settings.CURRENCY,
      'Day': contractPadTwo_(now.getDate()),
      'Month': contractPadTwo_(now.getMonth() + 1),
      'Year': String(year),
      'Date': contractPadTwo_(now.getDate()) + '/' + contractPadTwo_(now.getMonth() + 1) + '/' + year,
      'Qty': lines.length,
      'Image usage fee': contractFormatMoney_(imageUsageFee),
      'Content total': contractFormatMoney_(contentTotal),
      'Total': contractFormatMoney_(total),
      'Total in words': contractAmountInWords_(total, settings),
    });

    contractInsertEvidence_(document, lines);
    contractSaveAndSettle_(document, docFile);
    const pdfFile = contractExportPdf_(docFile, folder, fileName + '.pdf');

    const changes = {
      Acceptance_No: acceptanceNo,
      Acceptance_URL: docFile.getUrl(),
      Acceptance_PDF_URL: pdfFile.getUrl(),
      Folder_URL: folder.getUrl(),
      Status: 'Generated',
      Total_Amount: total,
      Updated_At: now,
    };
    // ---- PHA 3: lock ngắn thứ hai, CHỈ quanh các lần ghi. ----
    withDocumentLock_(function () {
      updateRecord_('ACCEPTANCES', 'Acceptance_ID', acceptanceId, changes);
      logActivity_(user.Email, 'GENERATE_ACCEPTANCE', 'ACCEPTANCE', acceptanceId, acceptanceNo);
      return null;
    });
    contractClearGenerationInProgress_(acceptanceId);
    return publicValue_(mergeObjects_(acceptance, changes));
  } catch (error) {
    try { docFile.setTrashed(true); } catch (ignored) { /* nothing to clean up */ }
    contractClearGenerationInProgress_(acceptanceId);
    // Số BBNT đã tiêu thụ nhưng không có tài liệu nào ra đời — ghi lại để khoảng
    // trống trong dãy số tự giải thích. Bọc try/catch: log hỏng không được che lỗi thật.
    try {
      logActivity_(user.Email, 'ACCEPTANCE_SERIAL_ABANDONED', 'ACCEPTANCE', acceptanceId,
        acceptanceNo + ' — ' + (error.message || String(error)));
    } catch (ignored) { /* no-op */ }
    throw new Error('Acceptance generation failed: ' + (error.message || String(error)));
  }
}

/**
 * Finds the template table holding {{No 2}} (one row per post) and
 * {{Image usage fee}} (the totals row), then duplicates the post row.
 * Ported from the legacy [SNOWVN] engine so existing templates keep working.
 */
function contractFillAcceptanceTable_(document, context) {
  const info = contractFindAcceptanceTable_(document.getBody());
  if (!info) {
    throw new Error('The acceptance template must contain a table with {{No 2}} on the post row ' +
      'and {{Image usage fee}} on the totals row.');
  }
  const table = info.table;
  const templateRow = table.getRow(info.postRowIndex).copy();
  let feeRowIndex = info.feeRowIndex;

  contractFillAcceptanceRow_(table.getRow(info.postRowIndex), context.creatorName, context.lines[0]);
  for (let index = 1; index < context.lines.length; index += 1) {
    const row = table.insertTableRow(feeRowIndex, templateRow.copy());
    contractFillAcceptanceRow_(row, context.creatorName, context.lines[index]);
    feeRowIndex += 1;
  }

  const feeRow = table.getRow(feeRowIndex);
  const feeNo = contractPadTwo_(context.lines.length + 1);
  contractReplaceInRow_(feeRow, '{{Image fee No}}', feeNo);
  contractReplaceInRow_(feeRow, '{{Image usage fee}}', contractFormatMoney_(context.imageUsageFee));
  if (feeRow.getNumCells() > 0) {
    const firstCell = feeRow.getCell(0);
    const text = firstCell.getText().trim();
    if (!text || text === '{{Image fee No}}') firstCell.setText(feeNo);
  }
}

function contractFindAcceptanceTable_(body) {
  for (let index = 0; index < body.getNumChildren(); index += 1) {
    const child = body.getChild(index);
    if (child.getType() !== DocumentApp.ElementType.TABLE) continue;
    const table = child.asTable();
    let postRowIndex = -1;
    let feeRowIndex = -1;
    for (let rowIndex = 0; rowIndex < table.getNumRows(); rowIndex += 1) {
      const text = table.getRow(rowIndex).getText();
      if (text.indexOf('{{No 2}}') >= 0) postRowIndex = rowIndex;
      if (text.indexOf('{{Image usage fee}}') >= 0) feeRowIndex = rowIndex;
    }
    if (postRowIndex >= 0 && feeRowIndex >= 0) {
      return { table: table, postRowIndex: postRowIndex, feeRowIndex: feeRowIndex };
    }
  }
  return null;
}

function contractFillAcceptanceRow_(tableRow, creatorName, line) {
  contractReplaceInRow_(tableRow, '{{No 2}}', contractPadTwo_(line.Line_No));
  contractReplaceInRow_(tableRow, '{{Creator}}', cleanText_(creatorName));
  contractReplaceInRow_(tableRow, '{{App}}', cleanText_(line.App));
  contractReplaceInRow_(tableRow, '{{Platform}}', cleanText_(line.Platform));
  contractReplaceInRow_(tableRow, '{{Link post}}', cleanText_(line.Post_URL));
  contractReplaceInRow_(tableRow, '{{Qty}}', String(toNumber_(line.Qty) || 1));
  contractReplaceInRow_(tableRow, '{{Unit Price}}', contractFormatMoney_(line.Unit_Price));
  contractReplaceInRow_(tableRow, '{{Content amount}}', contractFormatMoney_(line.Content_Amount));
}

function contractReplaceInRow_(tableRow, placeholder, value) {
  const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (let index = 0; index < tableRow.getNumCells(); index += 1) {
    tableRow.getCell(index).replaceText(escaped, value === null || value === undefined ? '' : String(value));
  }
}

/**
 * Replaces {{Evidence image}} / {{Evidence images}} with the screenshots,
 * grouped and labelled per post.
 */
function contractInsertEvidence_(document, lines) {
  const body = document.getBody();
  const found = body.findText('\\{\\{Evidence images?\\}\\}');
  if (!found) {
    throw new Error('The acceptance template must contain {{Evidence image}} or {{Evidence images}} ' +
      'inside a paragraph, marking where screenshots go.');
  }

  const textElement = found.getElement().asText();
  const start = found.getStartOffset();
  const end = found.getEndOffsetInclusive();
  if (start >= 0 && end >= start) textElement.deleteText(start, end);

  const parent = textElement.getParent();
  let container;
  if (parent.getType() === DocumentApp.ElementType.PARAGRAPH) container = parent.asParagraph();
  else if (parent.getType() === DocumentApp.ElementType.LIST_ITEM) container = parent.asListItem();
  else throw new Error('The evidence placeholder must sit inside a paragraph or list item.');

  let inserted = 0;
  lines.forEach(function (line) {
    const urls = contractNormalizeEvidenceList_(line.Evidence_URLs);
    const blobs = contractEvidenceBlobs_(urls);
    if (!blobs.length) {
      throw new Error('Line #' + line.Line_No + ': no readable image was found at ' +
        urls.join(', ') + '. Check the link is a Drive image you have access to.');
    }
    const heading = [contractPadTwo_(line.Line_No) + '.', cleanText_(line.App),
      line.Platform ? '- ' + cleanText_(line.Platform) : ''].filter(Boolean).join(' ');
    container.appendText(heading + '\n');
    blobs.forEach(function (blob) {
      const image = container.appendInlineImage(blob.copyBlob());
      contractResizeImage_(image, CONTRACT_HUB.EVIDENCE_MAX_WIDTH, CONTRACT_HUB.EVIDENCE_MAX_HEIGHT);
      container.appendText('\n');
      inserted += 1;
    });
    container.appendText('\n');
  });

  if (!inserted) throw new Error('No evidence images could be inserted.');
}

/** Accepts Drive file links, Drive folder links, or direct image URLs. */
function contractEvidenceBlobs_(urls) {
  const blobs = [];
  urls.forEach(function (url) {
    const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/) ||
      url.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
    const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]{20,})/);
    try {
      if (fileMatch) {
        const blob = DriveApp.getFileById(fileMatch[1]).getBlob();
        if (String(blob.getContentType() || '').indexOf('image/') === 0) blobs.push(blob);
        return;
      }
      if (folderMatch) {
        const files = DriveApp.getFolderById(folderMatch[1]).getFiles();
        while (files.hasNext()) {
          const blob = files.next().getBlob();
          if (String(blob.getContentType() || '').indexOf('image/') === 0) blobs.push(blob);
        }
        return;
      }
      const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
      if (response.getResponseCode() !== 200) return;
      const blob = response.getBlob();
      if (String(blob.getContentType() || '').indexOf('image/') === 0) blobs.push(blob);
    } catch (error) {
      // A bad link must not abort the whole document — the caller reports the
      // line as having no readable image.
    }
  });
  return blobs;
}

function contractResizeImage_(image, maxWidth, maxHeight) {
  const width = image.getWidth();
  const height = image.getHeight();
  if (!width || !height) return;
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  if (scale >= 1) return;
  image.setWidth(Math.round(width * scale));
  image.setHeight(Math.round(height * scale));
}

/**
 * Contract + acceptance detail for the workspace Contracts tab.
 * payload: { Campaign_ID }
 */
function getContractHubData(payload) {
  const user = requireRole_(['Admin', 'Booking']);
  payload = payload || {};
  const campaignId = cleanText_(payload.Campaign_ID);

  const visible = {};
  listCampaigns_(user).forEach(function (campaign) { visible[campaign.Campaign_ID] = true; });
  if (campaignId && !visible[campaignId]) throw new Error('Campaign is not available to this user.');

  const inScope = function (row) {
    return visible[cleanText_(row.Campaign_ID)] && (!campaignId || cleanText_(row.Campaign_ID) === campaignId);
  };

  const creators = indexBy_(readTable_('CREATORS'), 'Creator_ID');
  const contracts = readTable_('CONTRACTS').filter(inScope);
  const acceptances = readTable_('ACCEPTANCES').filter(inScope);
  const linesByAcceptance = {};
  readTable_('ACCEPTANCE_LINES').forEach(function (row) {
    const key = cleanText_(row.Acceptance_ID);
    linesByAcceptance[key] = linesByAcceptance[key] || [];
    linesByAcceptance[key].push(row);
  });

  const acceptanceByContract = {};
  acceptances.forEach(function (row) {
    acceptanceByContract[cleanText_(row.Contract_ID)] = mergeObjects_(row, {
      Lines: (linesByAcceptance[cleanText_(row.Acceptance_ID)] || [])
        .sort(function (a, b) { return toNumber_(a.Line_No) - toNumber_(b.Line_No); }),
    });
  });

  // Chỉ trả về market còn trong phạm vi (VN). Trước đây trả cả TH/TW nên Settings hiện
  // ba thẻ template, mời người dùng cấu hình thứ backend nay từ chối phát hành.
  const markets = {};
  CONTRACT_ENABLED_MARKETS.forEach(function (market) {
    let settings;
    try {
      settings = contractSettingsFor_(market);
    } catch (error) {
      markets[market] = { configured: false, error: error.message };
      return;
    }
    markets[market] = {
      configured: Boolean(cleanText_(settings.TEMPLATE_ID) && cleanText_(settings.FOLDER_ID)),
      acceptanceConfigured: Boolean(cleanText_(settings.ACCEPTANCE_TEMPLATE_ID)),
      prefix: settings.PREFIX,
      currency: settings.CURRENCY,
      taxRate: settings.TAX_RATE,
      templateName: settings.TEMPLATE_NAME,
    };
  });

  return publicValue_({
    markets: markets,
    contracts: contracts.map(function (row) {
      const creator = creators[cleanText_(row.Creator_ID)] || {};
      return mergeObjects_(row, {
        Creator_Name: creator.Display_Name || creator.Legal_Name || '',
        Creator_Complete: contractMissingCreatorFields_(creator).length === 0,
        Missing_Creator_Fields: contractMissingCreatorFields_(creator),
        Acceptance: acceptanceByContract[cleanText_(row.Contract_ID)] || null,
      });
    }).reverse(),
  });
}

/* ============================================================================
 * SECTION 7 — Creator information form
 * ========================================================================== */

/**
 * Issues a single-use link the creator opens themselves. Replaces chasing
 * people over LINE for ID numbers and bank details.
 * payload: { Creator_ID, Campaign_KOL_ID, days }
 */
function createCreatorFormLink(payload) {
  const user = requireRole_(['Admin', 'Booking']);
  payload = payload || {};
  const creatorId = cleanText_(payload.Creator_ID);
  requireFields_({ Creator_ID: creatorId }, ['Creator_ID']);
  const creator = findRecord_('CREATORS', 'Creator_ID', creatorId);
  if (!creator) throw new Error('Creator not found: ' + creatorId);

  const days = Math.min(90, Math.max(1, Math.round(toNumber_(payload.days) || CONTRACT_HUB.FORM_TOKEN_TTL_DAYS)));

  return withDocumentLock_(function () {
    const now = new Date();
    const token = Utilities.getUuid().replace(/-/g, '') +
      Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    const expiresAt = new Date(now.getTime() + days * 86400 * 1000);

    // Retire any outstanding link so only one is ever live per creator.
    readTable_('CREATOR_FORM_TOKENS').forEach(function (row) {
      if (cleanText_(row.Creator_ID) !== creatorId) return;
      if (cleanText_(row.Status) !== 'Active') return;
      updateRecord_('CREATOR_FORM_TOKENS', 'Token_ID', row.Token_ID, { Status: 'Superseded' });
    });

    const record = {
      Token_ID: makeId_('CFT'),
      Token: token,
      Creator_ID: creatorId,
      Campaign_KOL_ID: cleanText_(payload.Campaign_KOL_ID),
      Created_By: user.Email,
      Expires_At: expiresAt,
      Used_At: '',
      Status: 'Active',
      Created_At: now,
    };
    appendRecord_('CREATOR_FORM_TOKENS', record);
    logActivity_(user.Email, 'CREATE_FORM_LINK', 'CREATOR', creatorId, 'expires ' +
      Utilities.formatDate(expiresAt, APP.TIMEZONE, 'yyyy-MM-dd'));

    return publicValue_({
      url: ScriptApp.getService().getUrl() + '?form=creator&token=' + token,
      expiresAt: expiresAt,
      creatorName: creator.Display_Name || creator.Legal_Name || '',
    });
  });
}

/** Validates a token. Returns the token row or throws a user-facing message. */
function contractResolveFormToken_(token) {
  const value = cleanText_(token);
  if (!value) throw new Error('This link is missing its access token.');
  const row = readTable_('CREATOR_FORM_TOKENS').find(function (item) {
    return cleanText_(item.Token) === value;
  });
  if (!row) throw new Error('This link is not valid. Ask the SNOW team for a new one.');
  if (cleanText_(row.Status) === 'Used') throw new Error('This form has already been submitted. Thank you!');
  if (cleanText_(row.Status) !== 'Active') throw new Error('This link has been replaced. Ask the SNOW team for the latest one.');
  const expires = parseDate_(row.Expires_At);
  if (expires && expires.getTime() < Date.now()) {
    throw new Error('This link expired on ' +
      Utilities.formatDate(expires, APP.TIMEZONE, 'dd/MM/yyyy') + '. Ask the SNOW team for a new one.');
  }
  return row;
}

/**
 * Called by the public creator form page. NO requireRole_ — the token is the
 * authorisation, and the function only ever writes the seven legal fields of
 * the one creator the token points at.
 * payload: { token, Title, Legal_Name, ID_No, Date_Of_Issue,
 *            Permanent_Address, Bank_Account, Bank_Name, Email, Phone }
 */
function submitCreatorForm(payload) {
  payload = payload || {};
  const tokenRow = contractResolveFormToken_(payload.token);

  const allowed = ['Title', 'Legal_Name', 'ID_No', 'Date_Of_Issue',
    'Permanent_Address', 'Bank_Account', 'Bank_Name', 'Email', 'Phone'];
  const changes = {};
  allowed.forEach(function (field) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) return;
    changes[field] = cleanText_(payload[field]);
  });

  const required = ['Legal_Name', 'ID_No', 'Permanent_Address', 'Bank_Account', 'Bank_Name'];
  const missing = required.filter(function (field) { return !cleanText_(changes[field]); });
  if (missing.length) {
    throw new Error('Please complete: ' + missing.map(function (field) {
      return field.replace(/_/g, ' ');
    }).join(', ') + '.');
  }

  // CreatorForm.html is a public page, so everything it checks is advisory.
  // The same rules run here, and the normalised value is what gets stored — the
  // sheet should hold digits only, whatever the creator pasted in.
  changes.ID_No = cleanText_(changes.ID_No).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{6,20}$/.test(changes.ID_No)) {
    throw new Error('The ID or passport number must be 6-20 letters or digits.');
  }
  changes.Bank_Account = cleanText_(changes.Bank_Account).replace(/[^0-9]/g, '');
  if (!/^[0-9]{6,20}$/.test(changes.Bank_Account)) {
    throw new Error('The bank account number must be 6-20 digits.');
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'Phone')) {
    changes.Phone = cleanText_(changes.Phone).replace(/[^0-9+]/g, '');
  }

  // Chặn formula injection NGAY TRƯỚC khi ghi, và phải là bước cuối: các bước
  // chuẩn hoá riêng ở trên đều dùng replace() nên sẽ ăn mất dấu nháy nếu bọc
  // trước chúng. Phone chính là ví dụ — '+84…' là một chuỗi Sheets diễn giải
  // thành số, và replace(/[^0-9+]/g) sẽ xoá đúng cái dấu nháy vừa thêm.
  // Chạy trên toàn bộ `changes` để không phải nhớ liệt kê từng field khi thêm
  // field mới; Updated_At là Date và được gán bên trong lock, sau bước này.
  Object.keys(changes).forEach(function (field) {
    changes[field] = sanitizeSheetText_(changes[field]);
  });

  return withDocumentLock_(function () {
    const now = new Date();
    changes.Updated_At = now;
    updateRecord_('CREATORS', 'Creator_ID', tokenRow.Creator_ID, changes);
    updateRecord_('CREATOR_FORM_TOKENS', 'Token_ID', tokenRow.Token_ID, {
      Status: 'Used',
      Used_At: now,
    });
    logActivity_(cleanText_(changes.Email) || 'creator-form', 'SUBMIT_CREATOR_FORM',
      'CREATOR', tokenRow.Creator_ID, 'Self-service submission');

    // Tell whoever asked for the information that it has arrived.
    try {
      const creator = findRecord_('CREATORS', 'Creator_ID', tokenRow.Creator_ID) || {};
      createNotification_(cleanText_(tokenRow.Created_By), {
        Type: 'Creator form',
        Title: 'Creator information received',
        Message: (creator.Display_Name || creator.Legal_Name || 'A creator') +
          ' submitted their legal and bank details. The contract can be generated now.',
        Entity_ID: tokenRow.Creator_ID,
      });
    } catch (error) {
      // Notification failure must not roll back a successful submission.
    }
    return publicValue_({ success: true });
  });
}

/**
 * Read-only prefill for the public form. Returns only what the creator already
 * gave us — never fees, campaigns or other creators.
 */
function getCreatorFormContext(token) {
  const tokenRow = contractResolveFormToken_(token);
  const creator = findRecord_('CREATORS', 'Creator_ID', tokenRow.Creator_ID) || {};
  return publicValue_({
    token: cleanText_(tokenRow.Token),
    Display_Name: creator.Display_Name || '',
    Country: creator.Country || '',
    Title: creator.Title || '',
    Legal_Name: creator.Legal_Name || '',
    ID_No: creator.ID_No || '',
    Date_Of_Issue: creator.Date_Of_Issue || '',
    Permanent_Address: creator.Permanent_Address || '',
    Bank_Account: creator.Bank_Account || '',
    Bank_Name: creator.Bank_Name || '',
    Email: creator.Email || '',
    Phone: creator.Phone || '',
  });
}

/* ============================================================================
 * SECTION 8 — One-time migration from the legacy [SNOWVN] registry
 * ========================================================================== */

/**
 * Imports the legacy Contract sheet into CONTRACTS so there is a single
 * registry. Matches to campaign KOLs by creator name / profile link where
 * possible; unmatched rows are still imported with a note so the history is
 * complete and nothing is silently dropped.
 *
 * payload: { spreadsheetId, sheetName, dryRun }
 * Run with dryRun first and read the report.
 */
function migrateLegacyContracts(payload) {
  const user = requireRole_(['Admin']);
  payload = payload || {};
  const config = getConfigMap_();
  const spreadsheetId = cleanText_(payload.spreadsheetId) ||
    cleanText_(config[CONTRACT_HUB.LEGACY_SPREADSHEET_KEY]) ||
    (typeof CONTRACT_CONFIG !== 'undefined' ? CONTRACT_CONFIG.SOURCE_SPREADSHEET_ID : '');
  if (!spreadsheetId) {
    throw new Error('No legacy spreadsheet configured. Pass spreadsheetId, or set ' +
      CONTRACT_HUB.LEGACY_SPREADSHEET_KEY + ' in CONFIG.');
  }
  const sheetName = cleanText_(payload.sheetName) || CONTRACT_HUB.LEGACY_SHEET_NAME;
  const dryRun = isTrue_(payload.dryRun);

  let grid;
  try {
    const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
    if (!sheet) throw new Error('Sheet "' + sheetName + '" not found.');
    if (sheet.getLastRow() < 2) throw new Error('Sheet "' + sheetName + '" has no data rows.');
    grid = sheet.getDataRange().getDisplayValues();
  } catch (error) {
    throw new Error('Could not read the legacy spreadsheet: ' + (error.message || String(error)) +
      '. Make sure your account has at least view access.');
  }

  const headers = grid.shift().map(function (value) { return cleanText_(value); });
  const at = function (row, name) {
    const index = headers.indexOf(name);
    return index >= 0 ? cleanText_(row[index]) : '';
  };

  const existingNos = {};
  readTable_('CONTRACTS').forEach(function (row) {
    const no = cleanText_(row.Contract_No);
    if (no) existingNos[no.toLowerCase()] = true;
  });

  const accounts = readTable_('ACCOUNTS');
  const creators = readTable_('CREATORS');
  const campaignKols = readTable_('CAMPAIGN_KOLS');

  const report = { total: grid.length, imported: 0, skipped: 0, matched: 0, unmatched: 0, rows: [] };
  const toAppend = [];
  const now = new Date();

  grid.forEach(function (row, index) {
    const contractNo = at(row, 'Contract no');
    if (!contractNo) {
      report.skipped += 1;
      return;
    }
    if (existingNos[contractNo.toLowerCase()]) {
      report.skipped += 1;
      report.rows.push({ row: index + 2, Contract_No: contractNo, result: 'already in registry' });
      return;
    }

    const legacyCreator = at(row, 'Creator');
    const profileUrl = at(row, 'Link profile');
    const idNo = at(row, 'ID No');

    // Best match order: ID number, then profile URL, then username.
    let creator = idNo
      ? creators.find(function (item) { return cleanText_(item.ID_No) === idNo; })
      : null;
    let account = null;
    if (!creator && profileUrl) {
      account = accounts.find(function (item) {
        return normalizeDirectUrl_(item.Profile_URL) === normalizeDirectUrl_(profileUrl);
      });
    }
    if (!account && legacyCreator) {
      account = accounts.find(function (item) {
        return cleanText_(item.Username).toLowerCase() === legacyCreator.toLowerCase();
      });
    }
    if (!creator && account) {
      creator = creators.find(function (item) {
        return cleanText_(item.Creator_ID) === cleanText_(account.Creator_ID);
      });
    }

    const campaignKol = account
      ? campaignKols.find(function (item) {
          return cleanText_(item.Account_ID) === cleanText_(account.Account_ID);
        })
      : null;

    if (campaignKol) report.matched += 1;
    else report.unmatched += 1;

    // Cột 'Contract Status' của sheet legacy là văn bản TỰ DO. Trước đây bất cứ giá
    // trị nào không khớp /signed|đã ký/ đều được ghi NGUYÊN VĂN vào
    // CONTRACTS.Sign_Status. setValues bỏ qua data validation, nên sheet giữ lại
    // những giá trị không code path nào hiểu ("Pending", "Chờ ký", ""). Hệ quả nặng
    // nhất: adminDeleteBlockers_ chỉ chặn đúng chuỗi 'Signed', nên một hợp đồng ĐÃ KÝ
    // mà chữ trạng thái không khớp regex sẽ trở thành XOÁ ĐƯỢC.
    // Giờ luôn ép về LISTS.CONTRACT_STATUSES, và giữ nguyên văn trong Notes để không
    // mất thông tin gốc.
    const rawSignStatus = at(row, 'Contract Status');
    const signStatus = /signed|đã ký/i.test(rawSignStatus)
      ? 'Signed'
      : (LISTS.CONTRACT_STATUSES.indexOf(rawSignStatus) >= 0 ? rawSignStatus : 'Draft');
    const legacyStatusNote = rawSignStatus && rawSignStatus !== signStatus
      ? ' · legacy status: ' + rawSignStatus
      : '';
    const record = {
      Contract_ID: makeId_('CTR'),
      Campaign_KOL_ID: campaignKol ? campaignKol.Campaign_KOL_ID : '',
      Campaign_ID: campaignKol ? campaignKol.Campaign_ID : '',
      Creator_ID: creator ? creator.Creator_ID : '',
      Contract_No: contractNo,
      Template_Name: 'Legacy [SNOWVN]',
      Contract_URL: at(row, 'Link contract'),
      Sign_Status: signStatus,
      Sent_Date: '',
      Signed_Date: at(row, 'Date'),
      Due_Date: at(row, 'Duedate'),
      Owner_Email: user.Email,
      Notes: 'Imported from ' + sheetName + ' row ' + (index + 2) +
        (campaignKol ? '' : ' · no matching campaign KOL — link manually') +
        ' · creator: ' + legacyCreator + legacyStatusNote,
      Created_At: now,
      Updated_At: now,
      Contract_PDF_URL: at(row, 'Link PDF Contract'),
      Folder_URL: at(row, 'Contract Folder'),
    };

    report.rows.push({
      row: index + 2,
      Contract_No: contractNo,
      Creator: legacyCreator,
      matchedCampaignKol: campaignKol ? campaignKol.Campaign_KOL_ID : '',
      result: dryRun ? 'would import' : 'imported',
    });
    toAppend.push(record);
    report.imported += 1;
  });

  if (!dryRun && toAppend.length) {
    withDocumentLock_(function () {
      appendRecords_('CONTRACTS', toAppend);
      // Seed the counter past everything imported so the next generated
      // contract cannot collide with a legacy number.
      const year = now.getFullYear();
      const highest = contractHighestExistingSerial_(CONTRACT_HUB.COUNTER_KEY_PREFIX, 'VN', year);
      // Cùng lý do như trong contractReserveSerial_: đọc counter phải là đọc thật.
      invalidateTableCache_('CONFIG');
      const currentCounter = Math.round(toNumber_(getConfigMap_()[
        CONTRACT_HUB.COUNTER_KEY_PREFIX + 'VN_' + year]));
      if (highest > currentCounter) {
        upsertConfigValue_(CONTRACT_HUB.COUNTER_KEY_PREFIX + 'VN_' + year, String(highest),
          'Last issued contract serial for VN ' + year + ' (seeded by legacy migration)');
      }
      return null;
    });
    logActivity_(user.Email, 'MIGRATE_CONTRACTS', 'CONTRACTS', '',
      report.imported + ' imported, ' + report.skipped + ' skipped, ' +
      report.unmatched + ' unmatched');
  }

  report.dryRun = dryRun;
  report.rows = report.rows.slice(0, 100);
  return publicValue_(report);
}

/**
 * Writes the market contract settings. Admin only.
 * payload: { Market, TEMPLATE_ID, ACCEPTANCE_TEMPLATE_ID, FOLDER_ID, PREFIX,
 *            ACCEPTANCE_PREFIX, TEMPLATE_NAME, LANGUAGE }
 * TAX_RATE and TAX_THRESHOLD are accepted but IGNORED — VN tax is fixed in code
 * (F06b). VN only; other markets are refused by contractAssertMarketInScope_.
 */
function saveContractSettings(payload) {
  const user = requireRole_(['Admin']);
  payload = payload || {};
  const market = contractAssertMarketInScope_(payload.Market);

  return withDocumentLock_(function () {
    const written = [];
    CONTRACT_HUB.FIELDS.forEach(function (field) {
      if (!Object.prototype.hasOwnProperty.call(payload, field)) return;
      // Thuế VN KHÔNG còn cấu hình được (F06b, chủ project quyết định 2026-07-30):
      // rate = 10% và threshold = 5.000.000 cố định trong calculateContractTax_
      // (Code.gs). Hai field này từng sửa được trong Settings mà KHÔNG có tác dụng gì,
      // nên bỏ qua ở đây để không ai ghi vào CONFIG một giá trị vô nghĩa nữa. Các dòng
      // CONFIG cũ được GIỮ NGUYÊN — chưa xoá dữ liệu production.
      if (CONTRACT_FIXED_TAX_FIELDS.indexOf(field) >= 0) return;
      const value = cleanText_(payload[field]);
      upsertConfigValue_('CONTRACT_' + market + '_' + field, value,
        market + ' contract ' + field.toLowerCase().replace(/_/g, ' '));
      written.push(field);
    });
    logActivity_(user.Email, 'UPDATE', 'CONTRACT_SETTINGS', market, written.join(', '));
    return publicValue_(contractSettingsFor_(market));
  });
}