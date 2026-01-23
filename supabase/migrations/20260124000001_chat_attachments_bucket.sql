-- ═══════════════════════════════════════════════════════════════════════════
-- CHAT ATTACHMENTS STORAGE BUCKET
-- For persisting sportsbook screenshots and other chat uploads
-- ═══════════════════════════════════════════════════════════════════════════

-- Create the storage bucket for chat attachments
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'chat-attachments',
    'chat-attachments',
    true,  -- Public URLs for simplicity (no signed URL overhead)
    5242880,  -- 5MB limit per file
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS POLICIES FOR CHAT ATTACHMENTS
-- ═══════════════════════════════════════════════════════════════════════════

-- Allow anyone to upload (anon users can attach screenshots)
DROP POLICY IF EXISTS "Allow public uploads" ON storage.objects;
CREATE POLICY "Allow public uploads" ON storage.objects
    FOR INSERT
    WITH CHECK (bucket_id = 'chat-attachments');

-- Allow anyone to read (public URLs)
DROP POLICY IF EXISTS "Allow public reads" ON storage.objects;
CREATE POLICY "Allow public reads" ON storage.objects
    FOR SELECT
    USING (bucket_id = 'chat-attachments');

-- Only service role can delete (cleanup via cron)
DROP POLICY IF EXISTS "Service role delete" ON storage.objects;
CREATE POLICY "Service role delete" ON storage.objects
    FOR DELETE
    USING (bucket_id = 'chat-attachments' AND auth.role() = 'service_role');

COMMENT ON TABLE storage.buckets IS 
'chat-attachments bucket stores sportsbook screenshots for OCR analysis.
Files are public for fast AI inference. Cleanup via scheduled job.';
