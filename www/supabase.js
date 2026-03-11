import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Initialize Supabase client
// The supabase variable is available globally via the CDN script
export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
