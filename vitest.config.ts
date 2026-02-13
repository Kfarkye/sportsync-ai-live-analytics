import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        // Ensure .js extension imports resolve to .ts files consistently.
        // Without this, vi.mock for a .js path can create a separate module
        // identity from the .ts import in the test file itself.
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    },
    test: {
        globals: false,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        testTimeout: 15_000,
        hookTimeout: 10_000,
    },
});
