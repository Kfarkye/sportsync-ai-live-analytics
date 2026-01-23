
import fs from 'fs';

// Load env
const envContent = fs.readFileSync('.env', 'utf8');
const env: any = {};
envContent.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) env[key.trim()] = value.join('=').trim().replace(/"/g, '').replace(/'/g, '');
});

console.log('VITE_SUPABASE_SERVICE_ROLE_KEY Present:', !!env.VITE_SUPABASE_SERVICE_ROLE_KEY);
console.log('SUPABASE_SERVICE_ROLE_KEY Present:', !!env.SUPABASE_SERVICE_ROLE_KEY);
console.log('VITE_SUPABASE_ANON_KEY Present:', !!env.VITE_SUPABASE_ANON_KEY);
