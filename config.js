/**
 * Runtime configuration for GitHub Pages.
 *
 * Supabase's anonymous key is designed to be used in a browser. Security is
 * enforced by the Row Level Security policies in supabase/schema.sql.
 */
window.KOL_CONFIG = Object.freeze({
  supabaseUrl: "YOUR_SUPABASE_URL",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
  demoMode: true,
  defaultCurrency: "VND",
  timezone: "Asia/Ho_Chi_Minh",
  appVersion: "2.0.0",
});
