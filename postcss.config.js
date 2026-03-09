import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tailwindPkg = require('tailwindcss/package.json');
const tailwindMajor = Number.parseInt(String(tailwindPkg.version || '').split('.')[0] || '0', 10);
const tailwindPostcssPlugin = tailwindMajor >= 4 ? '@tailwindcss/postcss' : 'tailwindcss';

export default {
  plugins: {
    [tailwindPostcssPlugin]: {},
    autoprefixer: {},
  },
};
