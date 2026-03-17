
import { supabase } from '../lib/supabase';
import { updateSystemGates } from '../config/gates';

/**
 * Remote Config Service
 * Fetches "Magic Numbers" from Supabase `app_config` table and hot-swaps them into the running engine.
 * This allows tuning physics constants (like Hockey P3 Inflation) without redeploying code.
 */

type GatePrimitive = number | string | boolean | null;
type GateValue = GatePrimitive | GateValue[] | { [key: string]: GateValue };
type GateOverrides = Partial<Record<'NHL' | 'NBA' | 'NFL', GateValue>>;
type AppConfigRow = { key: string; value: GateValue };

const APP_CONFIG_TABLE = 'app_config';
let appConfigTableAvailable: boolean | null = null;

function isConfigTableUnavailableError(error: { code?: string; message?: string; details?: string } | null | undefined) {
  if (!error) return false;
  const text = `${error.code || ''} ${error.message || ''} ${error.details || ''}`.toLowerCase();
  return text.includes('does not exist') || text.includes('404') || text.includes('relation') || text.includes('42p01');
}

export const configService = {

    /**
     * Initializes the engine with remote configuration.
     * Should be called at app startup (App.tsx).
     */
    async init() {
        try {
            if (appConfigTableAvailable === false) return;

            console.log('[Remote Config] Fetching latest gates...');
            const { data, error } = await supabase
                .from(APP_CONFIG_TABLE)
                .select('key, value');

            if (error) {
                if (isConfigTableUnavailableError(error)) {
                    console.info('[Remote Config] Remote config table unavailable. Running with default gates.');
                    appConfigTableAvailable = false;
                    return;
                }
                appConfigTableAvailable = true;
                throw error;
            }

            appConfigTableAvailable = true;
            if (data) {
                const overrides: GateOverrides = {};

                // Map DB keys to System Gate keys
                // DB: NHL_GATES -> Engine: NHL
                data.forEach(row => {
                    if (row.key === 'NHL_GATES') overrides.NHL = row.value;
                    if (row.key === 'NBA_GATES') overrides.NBA = row.value;
                    if (row.key === 'NFL_GATES') overrides.NFL = row.value;
                    // Add more mappings as needed
                });

                if (Object.keys(overrides).length > 0) {
                    updateSystemGates(overrides);
                    console.log('[Remote Config] Engine gates updated successfully.', overrides);
                }
            }
        } catch (err) {
            console.warn('[Remote Config] Failed to fetch config. Using hardcoded defaults.', err);
        }
    },

    /**
     * Real-time subscription to config changes.
     * Enables "Hot-Swapping" while the user is using the app.
     */
    subscribe() {
        try {
            if (appConfigTableAvailable === false) return;

            const channel = supabase
            .channel('app_config_changes')
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: APP_CONFIG_TABLE },
                (payload) => {
                    console.log('[Remote Config] Hot-swap update received!', payload);
                    const row = payload.new;
                    const overrides: GateOverrides = {};
                    if (row.key === 'NHL_GATES') overrides.NHL = row.value;
                    if (row.key === 'NBA_GATES') overrides.NBA = row.value;
                    if (row.key === 'NFL_GATES') overrides.NFL = row.value;

                    if (Object.keys(overrides).length > 0) {
                        updateSystemGates(overrides);
                    }
                }
            )
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR') {
                    console.info('[Remote Config] Live config channel unavailable. Continuing with static defaults.');
                }
            });

            if (channel === null) {
                appConfigTableAvailable = false;
                return;
            }

            appConfigTableAvailable = true;
        } catch (err) {
            if (isConfigTableUnavailableError(err as { code?: string; message?: string; details?: string } | null | undefined)) {
                appConfigTableAvailable = false;
                console.info('[Remote Config] Remote config table unavailable. Live updates disabled.');
                return;
            }

            console.warn('[Remote Config] Failed to subscribe to live config updates.', err);
        }
    }
};
