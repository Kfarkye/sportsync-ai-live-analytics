
import fs from 'fs';
import path from 'path';

const envPath = path.join(process.cwd(), '.env');
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZnp2cm5iemFiY29rcXFyd2J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTM1NzY2OCwiZXhwIjoyMDcwOTMzNjY4fQ.jytFbYNCZVeMOM8dB7CDmfd5kEDkrIyc_eY9lKSrJjk';

if (fs.existsSync(envPath)) {
    let content = fs.readFileSync(envPath, 'utf8');
    if (content.includes('SUPABASE_SERVICE_ROLE_KEY')) {
        content = content.replace(/SUPABASE_SERVICE_ROLE_KEY=.*/, `SUPABASE_SERVICE_ROLE_KEY=${key}`);
    } else {
        content += `\nSUPABASE_SERVICE_ROLE_KEY=${key}\n`;
    }
    fs.writeFileSync(envPath, content);
    console.log('✅ Successfully updated SUPABASE_SERVICE_ROLE_KEY in .env');
} else {
    fs.writeFileSync(envPath, `SUPABASE_SERVICE_ROLE_KEY=${key}\n`);
    console.log('✅ Created .env with SUPABASE_SERVICE_ROLE_KEY');
}
