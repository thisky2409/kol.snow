/**
* KOL Campaign Manager — bộ test thủ công cho các hàm logic thuần.
* Apps Script không có framework test có sẵn, nên đây là cách đơn giản nhất:
* mở project trong Apps Script editor, chọn hàm runAllTests_ trong dropdown
* "Select function", bấm Run, rồi xem log (Ctrl+Enter / View > Logs).
*
* Nguyên tắc: chỉ test các hàm KHÔNG đụng tới Spreadsheet (không gọi
* SpreadsheetApp, không đọc/ghi sheet). Những hàm có side-effect (appendRecord_,
* updateRecord_, createCampaign...) nên test thủ công trên 1 bản sao spreadsheet
* riêng, không nên tự động hoá ở đây vì rủi ro ghi nhầm vào dữ liệu thật.
*/
function runAllTests_() {
const results = [];
[
test_cleanText_,
test_sanitizeSheetText_,
test_toNumber_,
test_isTrue_,
test_normalizeMarket_,
test_normalizePlatforms_,
test_currencyForMarket_,
test_normalizeSourceStatus_,
test_normalizeDirectUrl_,
test_canAccessMarket_,
test_numberFilter_,
test_canAccessCampaign_,
test_numberToVietnameseCurrencyContract_,
test_calculateContractTax_,
test_campaignKolNetAmount_,
test_campaignKolGrossAmount_,
test_campaignKolBudgetAmount_,
test_contractSplitLineAmounts_,
test_adminEmailDomains_,
test_contractSettleShouldStop_,
test_adminLatestByUpdatedAt_,
].forEach(function (fn) {
try {
fn();
results.push('PASS  ' + fn.name);
} catch (err) {
results.push('FAIL  ' + fn.name + '  ->  ' + err.message);
}
});
Logger.log(results.join('\n'));
const failed = results.filter(function (line) { return line.indexOf('FAIL') === 0; });
if (failed.length) {
throw new Error(failed.length + '/' + results.length + ' test thất bại. Xem Logger để biết chi tiết.');
}
Logger.log('Tất cả ' + results.length + ' test đều PASS.');
}
function assertEqual_(actual, expected, label) {
const a = JSON.stringify(actual);
const e = JSON.stringify(expected);
if (a !== e) {
throw new Error((label || 'assertEqual') + ': expected ' + e + ' but got ' + a);
}
}
function test_cleanText_() {
assertEqual_(cleanText_('  hello  '), 'hello');
assertEqual_(cleanText_(null), '');
assertEqual_(cleanText_(undefined), '');
assertEqual_(cleanText_(123), '123');
}
function test_sanitizeSheetText_() {
// Bốn ký tự Sheets coi là mở đầu công thức.
assertEqual_(sanitizeSheetText_('=IMPORTRANGE("x","A1")'), '\'=IMPORTRANGE("x","A1")');
assertEqual_(sanitizeSheetText_('+84901234567'), "'+84901234567");
assertEqual_(sanitizeSheetText_('-1'), "'-1");
assertEqual_(sanitizeSheetText_('@handle'), "'@handle");
// Văn bản thường KHÔNG được đổi — nếu không thì mọi tên/địa chỉ đều mọc dấu nháy.
assertEqual_(sanitizeSheetText_('Nguyễn Văn A'), 'Nguyễn Văn A');
assertEqual_(sanitizeSheetText_('123 Lê Lợi, Q1'), '123 Lê Lợi, Q1');
assertEqual_(sanitizeSheetText_('Vietcombank'), 'Vietcombank');
// Trim trước khi xét: ' =x' vẫn là công thức sau khi Sheets cắt khoảng trắng.
assertEqual_(sanitizeSheetText_('  =x  '), "'=x");
assertEqual_(sanitizeSheetText_(''), '');
assertEqual_(sanitizeSheetText_(null), '');
}
function test_toNumber_() {
assertEqual_(toNumber_('1,234.5'), 1234.5);
assertEqual_(toNumber_('abc'), 0);
assertEqual_(toNumber_(''), 0);
assertEqual_(toNumber_(42), 42);
assertEqual_(toNumber_('-15'), -15);
}
function test_isTrue_() {
assertEqual_(isTrue_('TRUE'), true);
assertEqual_(isTrue_('true'), true);
assertEqual_(isTrue_(true), true);
assertEqual_(isTrue_('1'), true);
assertEqual_(isTrue_('FALSE'), false);
assertEqual_(isTrue_(''), false);
}
function test_normalizeMarket_() {
assertEqual_(normalizeMarket_('vn'), 'VN');
assertEqual_(normalizeMarket_('global'), 'Global');
assertEqual_(normalizeMarket_(' th '), 'TH');
}
function test_normalizePlatforms_() {
assertEqual_(normalizePlatforms_('TikTok, Instagram, TikTok'), ['TikTok', 'Instagram']);
assertEqual_(normalizePlatforms_(['TikTok', 'NotARealPlatform']), ['TikTok']);
assertEqual_(normalizePlatforms_(''), []);
}
function test_currencyForMarket_() {
assertEqual_(currencyForMarket_('VN'), 'VND');
assertEqual_(currencyForMarket_('TH'), 'THB');
assertEqual_(currencyForMarket_('TW'), 'TWD');
assertEqual_(currencyForMarket_('Global'), 'USD');
}
function test_normalizeSourceStatus_() {
assertEqual_(normalizeSourceStatus_('No Respone'), 'No Response');
assertEqual_(normalizeSourceStatus_('cant contact'), "Can't contact");
assertEqual_(normalizeSourceStatus_('Black List'), 'Black List');
assertEqual_(normalizeSourceStatus_('Approved'), 'Approved');
}
function test_normalizeDirectUrl_() {
assertEqual_(
normalizeDirectUrl_('HTTPS://Tiktok.com/@abc/?ref=1'),
'https://tiktok.com/@abc'
);
assertEqual_(normalizeDirectUrl_('https://x.com/y/'), 'https://x.com/y');
}
function test_canAccessMarket_() {
const admin = { Role: 'Admin', Market: 'VN' };
const picVn = { Role: 'Marketing', Market: 'VN' };
const picGlobal = { Role: 'Marketing', Market: 'Global' };
assertEqual_(canAccessMarket_(admin, 'TH'), true);
assertEqual_(canAccessMarket_(picVn, 'VN'), true);
assertEqual_(canAccessMarket_(picVn, 'TH'), false);
assertEqual_(canAccessMarket_(picGlobal, 'TH'), true);
assertEqual_(canAccessMarket_(null, 'VN'), false);
}
function test_numberFilter_() {
assertEqual_(numberFilter_(''), null);
assertEqual_(numberFilter_(null), null);
assertEqual_(numberFilter_('1000'), 1000);
assertEqual_(numberFilter_(0), 0);
}
function test_canAccessCampaign_() {
const admin = { Role: 'Admin', Email: 'admin@co.com' };
const booking = { Role: 'Booking', Email: 'booking@co.com' };
const marketingAssigned = { Role: 'Marketing', Email: 'mkt1@co.com' };
const marketingNotAssigned = { Role: 'Marketing', Email: 'mkt2@co.com' };
const campaign = { Assigned_Marketing: 'mkt1@co.com, MKT3@co.com' };
assertEqual_(canAccessCampaign_(admin, campaign), true);
assertEqual_(canAccessCampaign_(booking, campaign), true);
assertEqual_(canAccessCampaign_(marketingAssigned, campaign), true);
assertEqual_(canAccessCampaign_(marketingNotAssigned, campaign), false);
assertEqual_(canAccessCampaign_(null, campaign), false);
assertEqual_(canAccessCampaign_(marketingAssigned, null), false);
}
function test_numberToVietnameseCurrencyContract_() {
assertEqual_(numberToVietnameseCurrencyContract_(0), 'Không đồng');
assertEqual_(numberToVietnameseCurrencyContract_(1000000), 'Một triệu đồng');
assertEqual_(numberToVietnameseCurrencyContract_(1500000), 'Một triệu năm trăm nghìn đồng');
assertEqual_(numberToVietnameseCurrencyContract_(105000), 'Một trăm lẻ năm nghìn đồng');
assertEqual_(numberToVietnameseCurrencyContract_(21000), 'Hai mươi mốt nghìn đồng');
assertEqual_(numberToVietnameseCurrencyContract_(25000), 'Hai mươi lăm nghìn đồng');
}
/**
* Net / Gross / budget trên một dòng CAMPAIGN_KOL. Đây là những con số đi thẳng vào
* hợp đồng, BBNT và budget campaign, nên mỗi quy tắc dưới đây khoá lại MỘT quyết định
* nghiệp vụ đã được xác nhận, không phải chỉ kiểm tra số học.
*/
function test_campaignKolNetAmount_() {
// Final_Fee = 0 là BARTER hợp lệ, không phải "chưa nhập". Dùng `||` ở đây sẽ âm thầm
// rơi về Quoted_Fee và thổi phồng cả budget lẫn giá trị hợp đồng.
assertEqual_(campaignKolNetAmount_({ Final_Fee: 0, Quoted_Fee: 9000000 }), 0);
// Chưa nhập Final_Fee -> lấy giá quote.
assertEqual_(campaignKolNetAmount_({ Final_Fee: '', Quoted_Fee: 6000000 }), 6000000);
assertEqual_(campaignKolNetAmount_({ Quoted_Fee: 6000000 }), 6000000);
// Đã nhập thì Final_Fee thắng.
assertEqual_(campaignKolNetAmount_({ Final_Fee: 5000000, Quoted_Fee: 9000000 }), 5000000);
// Không bao giờ âm.
assertEqual_(campaignKolNetAmount_({ Final_Fee: -100 }), 0);
assertEqual_(campaignKolNetAmount_({}), 0);
}
function test_campaignKolGrossAmount_() {
// Dưới ngưỡng: gross = net, không thuế.
assertEqual_(campaignKolGrossAmount_({ Final_Fee: 4000000 }), 4000000);
// Đúng ngưỡng và trên ngưỡng: gross-up.
assertEqual_(campaignKolGrossAmount_({ Final_Fee: 5000000 }), 5555556);
assertEqual_(campaignKolGrossAmount_({ Final_Fee: 6000000 }), 6666667);
// CA QUYẾT ĐỊNH (chủ project xác nhận 2026-07-30): ngưỡng xét trên SỐ TIỀN CHỊU
// THUẾ = net + code ad fee, không phải net một mình. 4.500.000 + 600.000 =
// 5.100.000 > 5.000.000 nên VẪN cộng thuế.
assertEqual_(campaignKolGrossAmount_({ Final_Fee: 4500000, Code_Ad_Fee: 600000 }), 5666667);
// Cùng logic nhưng cộng lại vẫn dưới ngưỡng -> không thuế.
assertEqual_(campaignKolGrossAmount_({ Final_Fee: 4000000, Code_Ad_Fee: 500000 }), 4500000);
// Code ad fee âm bị bỏ qua, không được làm giảm số tiền chịu thuế.
assertEqual_(campaignKolGrossAmount_({ Final_Fee: 6000000, Code_Ad_Fee: -1000 }), 6666667);
// Barter: net 0 thì không có gì để tính thuế.
assertEqual_(campaignKolGrossAmount_({ Final_Fee: 0, Quoted_Fee: 9000000 }), 0);
// Bất biến: gross luôn = net-chịu-thuế + tax.
[[4000000, 0], [4500000, 600000], [6000000, 0], [10000000, 2000000]].forEach(function (pair) {
const row = { Final_Fee: pair[0], Code_Ad_Fee: pair[1] };
const base = pair[0] + pair[1];
assertEqual_(campaignKolGrossAmount_(row), base + calculateContractTax_(base),
'gross = base + tax cho ' + JSON.stringify(pair));
});
}
function test_campaignKolBudgetAmount_() {
// VN trừ budget theo GROSS (đã gồm thuế).
assertEqual_(campaignKolBudgetAmount_({ Final_Fee: 6000000 }, { Market: 'VN' }), 6666667);
// Ngoài VN: net + Tax + Service_Fee đã nhập tay, không gross-up.
assertEqual_(
campaignKolBudgetAmount_({ Final_Fee: 6000000, Tax: 180000, Service_Fee: 20000 }, { Market: 'TH' }),
6200000);
// Market lấy từ campaign trước, rồi mới đến row.
assertEqual_(campaignKolBudgetAmount_({ Final_Fee: 6000000, Market: 'VN' }, {}), 6666667);
}
/**
* Chia tiền BBNT theo dòng. Bất biến DUY NHẤT phải đúng: tổng các dòng = net chính xác.
* Trước đây mọi dòng lấy round(net / số bài) nên tổng lệch net khi không chia hết.
*/
/**
* Allow-list tự suy ra cho ALLOW_UNLISTED_USERS (F38). Chỉ Admin ĐANG ACTIVE mới đóng
* góp domain — nếu không thì một Admin đã bị deactivate, hoặc một Marketing/Booking bất
* kỳ, sẽ mở lại đúng cái cửa mà việc này sinh ra để đóng.
*/
/**
* F12 bước 5 — điều kiện dừng của vòng chờ Drive trước khi export PDF.
*
* Đây là phần DUY NHẤT của phần chờ đó test được mà không cần Drive, và nó đúng là chỗ
* nguy hiểm: trả true quá sớm nghĩa là export chạy trước khi Drive thấy bản đã thay
* placeholder, tức PDF hợp đồng in ra nội dung template. Hai con số 800/1200 cũ chính là
* phỏng đoán cho việc này, và chúng không có một dòng chú thích nào.
*/
/**
* F18 luật C — dòng con Updated_At mới nhất thắng, hoà thì ID lớn nhất.
*
* Test phần chọn-dòng-thắng, tức phần thuần. Phần đọc sheet phải test tay trên bản COPY
* (checklist test 14). Hai thứ đáng test nhất ở đây: hoà PHẢI tiền định (appendRecords_
* ghi cả lô trong cùng một giây, và makeId_ chỉ mịn tới giây), và so sánh phải qua
* timeValue_ vì cột date trong sheet này có thể đang giữ ba dạng biểu diễn khác nhau.
*/
function test_adminLatestByUpdatedAt_() {
// Rỗng -> không có dòng thắng. Chỗ gọi dựa vào null để đặt về 'Not started'.
assertEqual_(adminLatestByUpdatedAt_([], 'Deliverable_ID'), null);
assertEqual_(adminLatestByUpdatedAt_(null, 'Deliverable_ID'), null);
// Một dòng thì thắng, kể cả khi không có Updated_At.
assertEqual_(adminLatestByUpdatedAt_([{ Deliverable_ID: 'D1' }], 'Deliverable_ID').Deliverable_ID, 'D1');
// Mới nhất thắng, không phụ thuộc thứ tự trong mảng.
const rows = [
{ Deliverable_ID: 'D1', Updated_At: new Date(2026, 0, 1), Content_Status: 'Posted' },
{ Deliverable_ID: 'D2', Updated_At: new Date(2026, 5, 1), Content_Status: 'Need edit' },
{ Deliverable_ID: 'D3', Updated_At: new Date(2026, 2, 1), Content_Status: 'Approved' },
];
assertEqual_(adminLatestByUpdatedAt_(rows, 'Deliverable_ID').Content_Status, 'Need edit');
assertEqual_(adminLatestByUpdatedAt_(rows.slice().reverse(), 'Deliverable_ID').Content_Status, 'Need edit');
// HOÀ -> ID lớn nhất, và phải ra CÙNG kết quả bất kể thứ tự dòng trong sheet.
// Không có tiebreak thì thứ tự sheet quyết định, mà thứ tự đó đổi sau mỗi lần xoá.
const same = new Date(2026, 3, 10, 8, 30, 0);
const tied = [
{ Deliverable_ID: 'DLV-A', Updated_At: same, Content_Status: 'Draft submitted' },
{ Deliverable_ID: 'DLV-C', Updated_At: same, Content_Status: 'Posted' },
{ Deliverable_ID: 'DLV-B', Updated_At: same, Content_Status: 'Approved' },
];
assertEqual_(adminLatestByUpdatedAt_(tied, 'Deliverable_ID').Deliverable_ID, 'DLV-C');
assertEqual_(adminLatestByUpdatedAt_(tied.slice().reverse(), 'Deliverable_ID').Deliverable_ID, 'DLV-C');
// Updated_At dạng CHUỖI — sheet này thật sự có cả ba dạng. Phải so qua timeValue_,
// không phải so chuỗi: '2026-02-01...' < '2026-11-...' theo chuỗi thì đúng, nhưng
// 'Sat Aug 01 2026' và ISO trộn lẫn thì so chuỗi xếp sai hoàn toàn.
const mixed = [
{ Payment_ID: 'P1', Updated_At: '2026-11-05', Payment_Status: 'Paid' },
{ Payment_ID: 'P2', Updated_At: 'Sat Aug 01 2026 00:00:00 GMT+0700', Payment_Status: 'Processing' },
];
assertEqual_(adminLatestByUpdatedAt_(mixed, 'Payment_ID').Payment_Status, 'Paid');
// Thiếu Updated_At -> timeValue_ trả 0, nên dòng CÓ ngày phải thắng.
const partial = [
{ Contract_ID: 'C1', Sign_Status: 'Signed', Updated_At: new Date(2026, 1, 1) },
{ Contract_ID: 'C2', Sign_Status: 'Draft' },
];
assertEqual_(adminLatestByUpdatedAt_(partial, 'Contract_ID').Sign_Status, 'Signed');
assertEqual_(adminLatestByUpdatedAt_(partial.slice().reverse(), 'Contract_ID').Sign_Status, 'Signed');
}
function test_contractSettleShouldStop_() {
const min = CONTRACT_PDF_SETTLE.MIN_WAIT_MS;
// Hai lần đọc giống nhau nhưng CHƯA tới mốc tối thiểu -> chưa được dừng.
// Đây là lá chắn cho trường hợp getLastUpdated() chỉ mịn tới giây.
assertEqual_(contractSettleShouldStop_(1000, 1000, 150), false);
assertEqual_(contractSettleShouldStop_(1000, 1000, min - 1), false);
// Giống nhau VÀ đã qua mốc -> dừng.
assertEqual_(contractSettleShouldStop_(1000, 1000, min), true);
assertEqual_(contractSettleShouldStop_(1000, 1000, min + 1000), true);
// Còn đang thay đổi -> không dừng, dù đã chờ rất lâu. Việc thoát khi hết hạn là
// nhiệm vụ của MAX_WAIT_MS trong vòng lặp, KHÔNG phải của hàm này.
assertEqual_(contractSettleShouldStop_(2000, 1000, min + 1000), false);
assertEqual_(contractSettleShouldStop_(2000, 1000, CONTRACT_PDF_SETTLE.MAX_WAIT_MS), false);
// Mốc tối thiểu phải nhỏ hơn cap, nếu không vòng lặp không bao giờ dừng đúng cách.
if (!(min < CONTRACT_PDF_SETTLE.MAX_WAIT_MS)) {
throw new Error('MIN_WAIT_MS phai nho hon MAX_WAIT_MS');
}
// Và fallback khi đọc metadata lỗi phải đúng bằng con số bảo thủ cũ (1200), không
// được nhỏ hơn — một lần Drive hiccup không được thành "không chờ gì cả".
assertEqual_(CONTRACT_PDF_SETTLE.FALLBACK_MS, 1200);
}
function test_adminEmailDomains_() {
const users = [
{ Email: 'admin@snowcorp.com', Role: 'Admin', Active: 'TRUE' },
{ Email: 'boss@partner.co', Role: 'Admin', Active: 'FALSE' },      // đã deactivate
{ Email: 'book@other.com', Role: 'Booking', Active: 'TRUE' },      // không phải Admin
{ Email: 'mkt@vendor.io', Role: 'Marketing', Active: 'TRUE' },     // không phải Admin
{ Email: 'ADMIN2@SNOWCORP.COM', Role: 'Admin', Active: 'TRUE' },   // hoa/thường
{ Email: 'second@snow.vn', Role: 'Admin', Active: true },          // boolean thật
{ Email: 'broken', Role: 'Admin', Active: 'TRUE' },                // không có @
{ Email: 'trailing@', Role: 'Admin', Active: 'TRUE' },             // @ ở cuối
{ Email: '', Role: 'Admin', Active: 'TRUE' },
];
const d = adminEmailDomains_(users);
assertEqual_(Object.keys(d).sort(), ['snow.vn', 'snowcorp.com']);
// Admin đã deactivate KHÔNG được đóng góp domain.
assertEqual_(Boolean(d['partner.co']), false);
// Role khác Admin KHÔNG được đóng góp domain.
assertEqual_(Boolean(d['other.com']), false);
assertEqual_(Boolean(d['vendor.io']), false);
// Email rác không sinh ra domain rỗng.
assertEqual_(Boolean(d['']), false);
// Không có Admin active nào -> allow-list RỖNG, tức cờ vô hiệu hoàn toàn.
assertEqual_(adminEmailDomains_([{ Email: 'a@b.com', Role: 'Admin', Active: 'FALSE' }]), {});
assertEqual_(adminEmailDomains_([]), {});
assertEqual_(adminEmailDomains_(null), {});
}
function test_contractSplitLineAmounts_() {
// Chia hết.
assertEqual_(contractSplitLineAmounts_(9000000, 3), [3000000, 3000000, 3000000]);
// KHÔNG chia hết: dòng cuối gánh phần dư, tổng vẫn đúng bằng net.
assertEqual_(contractSplitLineAmounts_(10000000, 3), [3333333, 3333333, 3333334]);
assertEqual_(contractSplitLineAmounts_(10, 3), [3, 3, 4]);
assertEqual_(contractSplitLineAmounts_(1, 2), [1, 0]);
// Một dòng thì lấy hết.
assertEqual_(contractSplitLineAmounts_(6000000, 1), [6000000]);
// Biên.
assertEqual_(contractSplitLineAmounts_(0, 3), [0, 0, 0]);
assertEqual_(contractSplitLineAmounts_(6000000, 0), []);
// Bất biến trên nhiều tổ hợp: Σ luôn bằng net, và không dòng nào âm.
[[10000000, 3], [7777777, 7], [123456789, 11], [5000001, 2], [999, 1000]].forEach(function (pair) {
const lines = contractSplitLineAmounts_(pair[0], pair[1]);
assertEqual_(lines.length, pair[1], 'so dong cho ' + JSON.stringify(pair));
const sum = lines.reduce(function (total, value) { return total + value; }, 0);
assertEqual_(sum, pair[0], 'tong phai bang net cho ' + JSON.stringify(pair));
if (lines.some(function (value) { return value < 0; })) {
throw new Error('co dong am cho ' + JSON.stringify(pair) + ': ' + JSON.stringify(lines));
}
});
}
/**
* Thuế TNCN VN. Mô hình chủ project xác nhận 2026-07-30: gross = net + tax, và tax
* là 10% của GROSS (gross-up), chỉ áp khi số tiền chịu thuế >= 5.000.000.
*
* Hai assert này TRƯỚC ĐÂY nằm lẫn trong test_numberToVietnameseCurrencyContract_ và
* assert calculateContractTax_(6000000) === 600000 — tức mô hình TRỪ 10% khỏi net,
* trái với gross-up mà code thực sự chạy. Cộng thêm việc calculateContractTax_ hồi đó
* KHÔNG TỒN TẠI, nên runAllTests_ throw ở mọi lần chạy và cả bộ test vô dụng.
*/
function test_calculateContractTax_() {
// Dưới ngưỡng: không thuế.
assertEqual_(calculateContractTax_(0), 0);
assertEqual_(calculateContractTax_(4000000), 0);
assertEqual_(calculateContractTax_(4999999), 0);
// Đúng ngưỡng thì đã áp thuế.
assertEqual_(calculateContractTax_(5000000), 555556);
// Ví dụ chuẩn của chủ project: net 6.000.000 -> tax 666.667 -> gross 6.666.667.
assertEqual_(calculateContractTax_(6000000), 666667);
// Bất biến: tax luôn đúng bằng gross - net, và bằng 10% của gross.
[5000000, 6000000, 10000000, 123456789].forEach(function (net) {
const tax = calculateContractTax_(net);
const gross = Math.round(net) + tax;
assertEqual_(gross, Math.round(net / 0.9), 'gross for net ' + net);
if (Math.abs(tax - gross * 0.1) > 1) {
throw new Error('tax phải là ~10% của gross, net=' + net + ' tax=' + tax + ' gross=' + gross);
}
});
// Đầu vào rác không được sinh thuế âm hay NaN.
assertEqual_(calculateContractTax_(-1), 0);
assertEqual_(calculateContractTax_('abc'), 0);
assertEqual_(calculateContractTax_(''), 0);
}