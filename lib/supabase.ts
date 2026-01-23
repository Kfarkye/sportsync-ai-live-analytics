
import { createClient } from '@supabase/supabase-js';

// ====================================================================================
// CONFIGURATION
// ====================================================================================

const getEnv = (key: string) => {
  // 1. Try Import Meta (Vite Standard)
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
      // @ts-ignore
      return import.meta.env[key];
    }
  } catch (e) { }

  // 2. Try Process Env (Vite Define / System)
  try {
    // @ts-ignore
    if (typeof process !== 'undefined' && process.env && process.env[key]) {
      // @ts-ignore
      return process.env[key];
    }
  } catch (e) { }

  return '';
};

// --- HARDCODED CREDENTIALS ---
const HARDCODED_URL = 'https://qffzvrnbzabcokqqrwbv.supabase.co';
const HARDCODED_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNTc2NjgsImV4cCI6MjA3MDkzMzY2OH0.PCSnC5E7sG7FvasHy_9DdwiN61xW0GzFROLzZ0bTVnc';

// Retrieve configuration (Env > Hardcoded)
const supabaseUrl = getEnv('VITE_SUPABASE_URL') || HARDCODED_URL;

// Check local storage for manual override, then env vars, then hardcoded
const storedKey = typeof window !== 'undefined' ? localStorage.getItem('sharpedge_supabase_key') : null;
const supabaseAnonKey = storedKey || getEnv('VITE_SUPABASE_ANON_KEY') || HARDCODED_KEY;

// Debug Logging
const isKeyValid = supabaseAnonKey && supabaseAnonKey.length > 20 && !supabaseAnonKey.startsWith('Missing');
console.log(`[Supabase Init] URL: ${supabaseUrl ? 'Present' : 'Missing'}, Key: ${isKeyValid ? 'Valid' : 'Missing/Invalid'}`);

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
