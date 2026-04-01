
-- Check the status of the HTTP requests we just sent
SELECT 
    id, 
    status, 
    error_msg, 
    created_at,
    url
FROM net.http_request_queue
ORDER BY created_at DESC
LIMIT 10;
