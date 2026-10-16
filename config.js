// =====================================================================
//  ORDER PULSE — CONFIGURATION
//  Paste your two Supabase values below (Supabase → Project Settings → API).
//  While these still contain "PASTE_", the app runs in DEMO MODE
//  (data is stored only in this browser — good for trying it out).
// =====================================================================
const CONFIG = {
  SUPABASE_URL: 'https://uxzmjpushmbuhqjynflj.supabase.co', // e.g. https://abcdxyz.supabase.co
  SUPABASE_ANON_KEY: 'sb_publishable_9EfPXvRgmNUcLPuJhNP4Xg_T-4UjeGB',

  APP_NAME: 'Order Pulse',
  CURRENCY: '₹',
  TIMEZONE: 'Asia/Kolkata',
};

const DEMO = !/^https:\/\//.test(CONFIG.SUPABASE_URL);
