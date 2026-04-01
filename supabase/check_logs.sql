-- Check the last 10 logs from the net extension to see if functions are actually being called
SELECT 
    r.id,
    r.status,
    r.error_msg,
    q.url,
    q.created_at
FROM net.http_request_queue q
LEFT JOIN net.http_responses r ON q.id = r.id
ORDER BY q.created_at DESC
LIMIT 10;
