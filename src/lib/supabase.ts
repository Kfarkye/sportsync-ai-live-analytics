import { createClient } from '@supabase/supabase-js';

// ====================================================================================
// CONFIGURATION
// ====================================================================================

// Retrieve configuration using static access only to prevent bundling of all VITE_ env vars
const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL || '';
// Check local storage for manual override, then env vars
const storedKey = typeof window !== 'undefined' ? localStorage.getItem('sharpedge_supabase_key') : null;
const supabaseAnonKey = storedKey || (import.meta as any).env.VITE_SUPABASE_ANON_KEY || '';

// Debug Logging
const isKeyValid = supabaseAnonKey && supabaseAnonKey.length > 20 && !supabaseAnonKey.startsWith('Missing');
const hasConfig = !!(supabaseUrl && isKeyValid);

// Initialize Client (fall back to a safe local URL when not configured)
const clientUrl = hasConfig ? supabaseUrl : 'http://localhost';
const clientKey = hasConfig ? supabaseAnonKey : 'public-anon-key-not-set';

export const supabase = createClient(
  clientUrl,
  clientKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Critical Fix for "Navigator LockManager returned a null lock"
      // @ts-ignore
      lock: false,
    }
  }
);

export const isSupabaseConfigured = () => {
  return hasConfig;
};

export const setSupabaseKey = (key: string) => {
  if (!key) return;
  localStorage.setItem('sharpedge_supabase_key', key);
  window.location.reload();
};

export const getSupabaseUrl = () => supabaseUrl;
