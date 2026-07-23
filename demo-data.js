(function () {
  const now = new Date().toISOString();

  window.KOL_DEMO_DATA = {
    profiles: [
      { id: "usr-admin", email: "admin@snow.demo", name: "Nabi", role: "Admin", market: "Global", active: true },
      { id: "usr-booking", email: "booking@snow.demo", name: "Booking Team", role: "Booking", market: "VN", active: true },
      { id: "usr-marketing", email: "marketing@snow.demo", name: "Marketing Team", role: "Marketing", market: "VN", active: true },
    ],
    creators: [
      { id: "cre-1", display_name: "pobimatacc", legal_name: "Nguyen Minh Anh", market: "VN", city: "Ho Chi Minh City", languages: ["Vietnamese"], categories: ["Beauty", "Lifestyle", "Daily Vlog"], active: true },
      { id: "cre-2", display_name: "Linh Chérie", legal_name: "Tran Thuy Linh", market: "VN", city: "Hanoi", languages: ["Vietnamese", "English"], categories: ["Makeup", "Skincare", "Review"], active: true },
      { id: "cre-3", display_name: "Mây Đi Đâu", legal_name: "Le Ha My", market: "VN", city: "Da Nang", languages: ["Vietnamese"], categories: ["Travel", "Lifestyle", "Photographic"], active: true },
      { id: "cre-4", display_name: "Nana Studio", legal_name: "Phan Ngoc Na", market: "VN", city: "Ho Chi Minh City", languages: ["Vietnamese", "English"], categories: ["Fashion", "Selfie", "AI"], active: true },
      { id: "cre-5", display_name: "Tú Tech", legal_name: "Vo Minh Tu", market: "VN", city: "Hanoi", languages: ["Vietnamese"], categories: ["Tech", "Tips", "Review"], active: true },
      { id: "cre-6", display_name: "Mookmink", legal_name: "Mook Narin", market: "TH", city: "Bangkok", languages: ["Thai", "English"], categories: ["Beauty", "Dance", "Trend"], active: true },
      { id: "cre-7", display_name: "Yuki Daily", legal_name: "Lin Yu-Chi", market: "TW", city: "Taipei", languages: ["Mandarin"], categories: ["Daily Vlog", "Fashion", "Selfie"], active: true },
      { id: "cre-8", display_name: "Khoa Chill", legal_name: "Pham Dang Khoa", market: "VN", city: "Ho Chi Minh City", languages: ["Vietnamese"], categories: ["Funny", "Lipsync", "Couple"], active: true },
    ],
    accounts: [
      { id: "acc-1", creator_id: "cre-1", platform: "TikTok", username: "pobimatacc", profile_url: "https://tiktok.com/@pobimatacc", followers: 1200000, avg_views: 510000, engagement_rate: 6.8, starting_fee: 8000000, currency: "VND", app_fit: ["SNOW", "B612"], active: true },
      { id: "acc-2", creator_id: "cre-1", platform: "Instagram", username: "too.polang.3", profile_url: "https://instagram.com/too.polang.3", followers: 268000, avg_views: 118000, engagement_rate: 5.1, starting_fee: 0, currency: "VND", app_fit: ["SNOW"], active: true },
      { id: "acc-3", creator_id: "cre-1", platform: "Threads", username: "too.polang.3", profile_url: "https://threads.net/@too.polang.3", followers: 65800, avg_views: 47000, engagement_rate: 8.3, starting_fee: 3000000, currency: "VND", app_fit: ["SNOW", "EPIK"], active: true },
      { id: "acc-4", creator_id: "cre-2", platform: "TikTok", username: "linhcherie", profile_url: "https://tiktok.com/@linhcherie", followers: 745000, avg_views: 390000, engagement_rate: 7.4, starting_fee: 6500000, currency: "VND", app_fit: ["SODA", "SNOW"], active: true },
      { id: "acc-5", creator_id: "cre-2", platform: "Instagram", username: "linh.cherie", profile_url: "https://instagram.com/linh.cherie", followers: 187000, avg_views: 95000, engagement_rate: 4.9, starting_fee: 4200000, currency: "VND", app_fit: ["SODA", "EPIK"], active: true },
      { id: "acc-6", creator_id: "cre-3", platform: "TikTok", username: "maydidau", profile_url: "https://tiktok.com/@maydidau", followers: 432000, avg_views: 255000, engagement_rate: 9.1, starting_fee: 5000000, currency: "VND", app_fit: ["Foodie", "SNOW"], active: true },
      { id: "acc-7", creator_id: "cre-3", platform: "YouTube", username: "MayDiDau", profile_url: "https://youtube.com/@MayDiDau", followers: 82000, avg_views: 76000, engagement_rate: 6.2, starting_fee: 9000000, currency: "VND", app_fit: ["Foodie"], active: true },
      { id: "acc-8", creator_id: "cre-4", platform: "Instagram", username: "nana.studio", profile_url: "https://instagram.com/nana.studio", followers: 312000, avg_views: 142000, engagement_rate: 5.7, starting_fee: 3500000, currency: "VND", app_fit: ["EPIK", "SNOW"], active: true },
      { id: "acc-9", creator_id: "cre-5", platform: "TikTok", username: "tutech", profile_url: "https://tiktok.com/@tutech", followers: 156000, avg_views: 98000, engagement_rate: 4.6, starting_fee: 2800000, currency: "VND", app_fit: ["EPIK"], active: true },
      { id: "acc-10", creator_id: "cre-6", platform: "TikTok", username: "mookmink", profile_url: "https://tiktok.com/@mookmink", followers: 880000, avg_views: 474000, engagement_rate: 7.8, starting_fee: 18500, currency: "THB", app_fit: ["SNOW", "B612"], active: true },
      { id: "acc-11", creator_id: "cre-7", platform: "Threads", username: "yukidaily", profile_url: "https://threads.net/@yukidaily", followers: 205000, avg_views: 120000, engagement_rate: 8.8, starting_fee: 12000, currency: "TWD", app_fit: ["SNOW"], active: true },
      { id: "acc-12", creator_id: "cre-8", platform: "TikTok", username: "khoachill", profile_url: "https://tiktok.com/@khoachill", followers: 94500, avg_views: 61000, engagement_rate: 11.2, starting_fee: 0, currency: "VND", app_fit: ["B612"], active: true },
    ],
    outreach_profiles: [
      { creator_id: "cre-1", status: "Contacted", pic: "Tú", contact_channel: "Phone", contact_value: "947605753", email: "pobimatacc@example.com", phone: "947605753", line_id: "", note: "Asked for a bundled rate.", source_reference: "TikTok discovery", last_contacted_at: "2026-07-21" },
      { creator_id: "cre-2", status: "Deal", pic: "Iris", contact_channel: "Instagram", contact_value: "@linh.cherie", email: "linh@example.com", phone: "", line_id: "", note: "Rate confirmed for Q3.", source_reference: "Previous campaign", last_contacted_at: "2026-07-18" },
      { creator_id: "cre-3", status: "Negotiating", pic: "Nabi", contact_channel: "Email", contact_value: "hello@maydidau.vn", email: "hello@maydidau.vn", phone: "", line_id: "", note: "Waiting for revised YouTube bundle.", source_reference: "Referral", last_contacted_at: "2026-07-22" },
      { creator_id: "cre-4", status: "Deal", pic: "Iris", contact_channel: "Instagram", contact_value: "@nana.studio", email: "", phone: "", line_id: "", note: "Available in August.", source_reference: "Instagram search", last_contacted_at: "2026-07-16" },
      { creator_id: "cre-5", status: "Replied", pic: "Tú", contact_channel: "Email", contact_value: "booking@tutech.vn", email: "booking@tutech.vn", phone: "", line_id: "", note: "Need final brief before confirming.", source_reference: "Creator list", last_contacted_at: "2026-07-20" },
      { creator_id: "cre-6", status: "Deal", pic: "Pim", contact_channel: "LINE", contact_value: "mookmink.work", email: "", phone: "", line_id: "mookmink.work", note: "TH market rate confirmed.", source_reference: "Agency", last_contacted_at: "2026-07-19" },
      { creator_id: "cre-7", status: "Deal", pic: "Nabi", contact_channel: "Email", contact_value: "yuki@creator.tw", email: "yuki@creator.tw", phone: "", line_id: "", note: "Threads package available.", source_reference: "TW creator list", last_contacted_at: "2026-07-15" },
      { creator_id: "cre-8", status: "New", pic: "Tú", contact_channel: "TikTok", contact_value: "@khoachill", email: "", phone: "", line_id: "", note: "Not contacted yet.", source_reference: "Organic discovery", last_contacted_at: "" },
    ],
    campaigns: [
      { id: "cmp-1", code: "CMP-2607-VN-001", name: "AI Sunshine Magic", app: "SNOW", market: "VN", objective: "Drive feature adoption", platforms: ["TikTok", "Threads"], posting_start: "2026-07-23", posting_end: "2026-07-29", target_kols: 20, budget: 180000000, currency: "VND", status: "Active", owner_email: "admin@snow.demo", assigned_marketing: ["marketing@snow.demo"], brief_url: "", notes: "", created_at: now },
      { id: "cmp-2", code: "CMP-2607-VN-002", name: "Summer Retouch", app: "EPIK", market: "VN", objective: "Increase AI tool trials", platforms: ["TikTok", "Instagram"], posting_start: "2026-07-28", posting_end: "2026-08-04", target_kols: 12, budget: 120000000, currency: "VND", status: "Sourcing", owner_email: "admin@snow.demo", assigned_marketing: ["marketing@snow.demo"], brief_url: "", notes: "", created_at: now },
      { id: "cmp-3", code: "CMP-2608-TW-001", name: "AI Style", app: "SNOW", market: "TW", objective: "Launch AI style collection", platforms: ["Threads"], posting_start: "2026-08-06", posting_end: "2026-08-08", target_kols: 20, budget: 460000, currency: "TWD", status: "Planning", owner_email: "admin@snow.demo", assigned_marketing: [], brief_url: "", notes: "", created_at: now },
      { id: "cmp-4", code: "CMP-2606-VN-003", name: "Water Sparkle", app: "B612", market: "VN", objective: "Evergreen content", platforms: ["TikTok"], posting_start: "2026-06-18", posting_end: "2026-06-24", target_kols: 8, budget: 60000000, currency: "VND", status: "Completed", owner_email: "admin@snow.demo", assigned_marketing: ["marketing@snow.demo"], brief_url: "", notes: "", created_at: now },
    ],
    campaign_kols: [
      { id: "ck-1", campaign_id: "cmp-1", account_id: "acc-1", creator_id: "cre-1", role: "Primary", booking_status: "Picked", quoted_fee: 8000000, final_fee: 0, currency: "VND", content_status: "Not started", posting_date: "2026-07-23", post_url: "", notes: "" },
      { id: "ck-2", campaign_id: "cmp-1", account_id: "acc-3", creator_id: "cre-1", role: "Primary", booking_status: "Picked", quoted_fee: 3000000, final_fee: 0, currency: "VND", content_status: "Not started", posting_date: "2026-07-23", post_url: "", notes: "" },
      { id: "ck-3", campaign_id: "cmp-1", account_id: "acc-4", creator_id: "cre-2", role: "Primary", booking_status: "Confirmed", quoted_fee: 6500000, final_fee: 6200000, currency: "VND", content_status: "Draft submitted", posting_date: "2026-07-24", post_url: "", notes: "" },
      { id: "ck-4", campaign_id: "cmp-1", account_id: "acc-6", creator_id: "cre-3", role: "Primary", booking_status: "Negotiating", quoted_fee: 5000000, final_fee: 0, currency: "VND", content_status: "Not started", posting_date: "2026-07-24", post_url: "", notes: "" },
      { id: "ck-5", campaign_id: "cmp-1", account_id: "acc-8", creator_id: "cre-4", role: "Primary", booking_status: "Confirmed", quoted_fee: 3500000, final_fee: 3500000, currency: "VND", content_status: "Approved", posting_date: "2026-07-25", post_url: "", notes: "" },
      { id: "ck-6", campaign_id: "cmp-1", account_id: "acc-9", creator_id: "cre-5", role: "Backup", booking_status: "Contacted", quoted_fee: 2800000, final_fee: 0, currency: "VND", content_status: "Not started", posting_date: "2026-07-25", post_url: "", notes: "" },
      { id: "ck-7", campaign_id: "cmp-2", account_id: "acc-5", creator_id: "cre-2", role: "Primary", booking_status: "Confirmed", quoted_fee: 4200000, final_fee: 4000000, currency: "VND", content_status: "Not started", posting_date: "2026-08-01", post_url: "", notes: "" },
      { id: "ck-8", campaign_id: "cmp-2", account_id: "acc-8", creator_id: "cre-4", role: "Primary", booking_status: "Picked", quoted_fee: 3500000, final_fee: 0, currency: "VND", content_status: "Not started", posting_date: "2026-08-01", post_url: "", notes: "" },
      { id: "ck-9", campaign_id: "cmp-2", account_id: "acc-6", creator_id: "cre-3", role: "Primary", booking_status: "Picked", quoted_fee: 5000000, final_fee: 0, currency: "VND", content_status: "Not started", posting_date: "2026-08-01", post_url: "", notes: "" },
      { id: "ck-10", campaign_id: "cmp-2", account_id: "acc-1", creator_id: "cre-1", role: "Primary", booking_status: "Picked", quoted_fee: 8000000, final_fee: 0, currency: "VND", content_status: "Not started", posting_date: "2026-08-01", post_url: "", notes: "" },
      { id: "ck-11", campaign_id: "cmp-2", account_id: "acc-4", creator_id: "cre-2", role: "Primary", booking_status: "Picked", quoted_fee: 6500000, final_fee: 0, currency: "VND", content_status: "Not started", posting_date: "2026-08-01", post_url: "", notes: "" },
    ],
    shortlists: [
      { id: "sl-1", name: "SNOW Sunshine — final review", market: "VN", month: "2026-07", campaign_id: "cmp-1", owner_email: "marketing@snow.demo", status: "Reviewing", notes: "" },
      { id: "sl-2", name: "EPIK August candidates", market: "VN", month: "2026-08", campaign_id: "cmp-2", owner_email: "marketing@snow.demo", status: "Draft", notes: "" },
    ],
    shortlist_accounts: [
      { id: "sla-1", shortlist_id: "sl-1", account_id: "acc-1", picked: true, review_status: "Approved", notes: "" },
      { id: "sla-2", shortlist_id: "sl-1", account_id: "acc-3", picked: true, review_status: "Approved", notes: "" },
      { id: "sla-3", shortlist_id: "sl-1", account_id: "acc-4", picked: false, review_status: "Reviewing", notes: "" },
      { id: "sla-4", shortlist_id: "sl-2", account_id: "acc-5", picked: false, review_status: "New", notes: "" },
      { id: "sla-5", shortlist_id: "sl-2", account_id: "acc-8", picked: false, review_status: "New", notes: "" },
    ],
    deliverables: [
      { id: "dlv-1", campaign_kol_id: "ck-3", campaign_id: "cmp-1", account_id: "acc-4", type: "Short video", platform: "TikTok", draft_due: "2026-07-22", content_status: "Draft submitted", posting_date: "2026-07-24", draft_url: "", post_url: "" },
      { id: "dlv-2", campaign_kol_id: "ck-5", campaign_id: "cmp-1", account_id: "acc-8", type: "Photo post", platform: "Instagram", draft_due: "2026-07-23", content_status: "Approved", posting_date: "2026-07-25", draft_url: "", post_url: "" },
    ],
    contracts: [
      { id: "ctr-1", campaign_kol_id: "ck-3", campaign_id: "cmp-1", creator_id: "cre-2", contract_no: "SNVN-2607-018", sign_status: "Signed", due_date: "2026-07-20", owner_email: "booking@snow.demo" },
    ],
    payments: [
      { id: "pay-1", campaign_kol_id: "ck-3", campaign_id: "cmp-1", creator_id: "cre-2", amount: 6200000, currency: "VND", payment_status: "Ready", due_date: "2026-08-15", owner_email: "booking@snow.demo" },
    ],
  };
})();
