import { createClient } from '@supabase/supabase-js';

// ====================================================================================
// CONFIGURATION
// ====================================================================================

// Retrieve configuration using static access only to prevent bundling of all VITE_ env vars
const supabaseUrl = ((import.meta as any).env.VITE_SUPABASE_URL || '').trim();
const supabaseAnonKey = ((import.meta as any).env.VITE_SUPABASE_ANON_KEY || '').trim();

// Debug Logging
const isKeyValid = supabaseAnonKey && supabaseAnonKey.length > 20 && !supabaseAnonKey.startsWith('Missing');
const hasConfig = !!(supabaseUrl && isKeyValid);

// Initialize Client (fall back to a safe local URL when not configured)
const clientUrl = hasConfig ? supabaseUrl : 'http://localhost';
const clientKey = hasConfig ? supabaseAnonKey : 'public-anon-key-not-set';
type SupabaseClientOptions = Parameters<typeof createClient>[2];
type SupabaseLock = NonNullable<NonNullable<SupabaseClientOptions>['auth']>['lock'];

const noOpLock: Exclude<SupabaseLock, undefined> = async (_name, _acquireTimeout, fn) => fn();

export const supabase = createClient(
  clientUrl,
  clientKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Safari-safe lock fallback for environments where LockManager is unavailable.
      lock: noOpLock,
    }
  }
);

export const isSupabaseConfigured = () => {
  return hasConfig;
};

export const getSupabaseUrl = () => supabaseUrl;
