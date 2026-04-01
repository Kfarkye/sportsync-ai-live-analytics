-- Check the status of the last 10 attempts to trigger functions
SELECT 
    q.url,
    r.status,
    r.error_msg,
    r.body as response_body,
    q.created_at
FROM net.http_request_queue q
LEFT JOIN net.http_responses r ON q.id = r.id
ORDER BY q.created_at DESC
LIMIT 10;
