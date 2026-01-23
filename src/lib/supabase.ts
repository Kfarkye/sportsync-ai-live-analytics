
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


// Initialize Client
export const supabase = createClient(
  supabaseUrl || 'https://qffzvrnbzabcokqqrwbv.supabase.co',
  supabaseAnonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc',
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
  return !!(supabaseUrl && isKeyValid);
};

export const setSupabaseKey = (key: string) => {
  if (!key) return;
  localStorage.setItem('sharpedge_supabase_key', key);
  window.location.reload();
};

export const getSupabaseUrl = () => supabaseUrl;
