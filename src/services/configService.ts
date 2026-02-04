
import { supabase } from '../lib/supabase';
import { updateSystemGates } from '../config/gates';

/**
 * Remote Config Service
 * Fetches "Magic Numbers" from Supabase `app_config` table and hot-swaps them into the running engine.
 * This allows tuning physics constants (like Hockey P3 Inflation) without redeploying code.
 */

export const configService = {

    /**
     * Initializes the engine with remote configuration.
     * Should be called at app startup (App.tsx).
     */
    async init() {
        try {
            console.log('[Remote Config] Fetching latest gates...');
            const { data, error } = await supabase
                .from('app_config')
                .select('key, value');

            if (error) throw error;

            if (data) {
                const overrides: unknown = {};

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
        supabase
            .channel('app_config_changes')
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'app_config' },
                (payload) => {
                    console.log('[Remote Config] Hot-swap update received!', payload);
                    const row = payload.new;
                    const overrides: unknown = {};
                    if (row.key === 'NHL_GATES') overrides.NHL = row.value;
                    if (row.key === 'NBA_GATES') overrides.NBA = row.value;
                    if (row.key === 'NFL_GATES') overrides.NFL = row.value;

                    if (Object.keys(overrides).length > 0) {
                        updateSystemGates(overrides);
                    }
                }
            )
            .subscribe();
    }
};
