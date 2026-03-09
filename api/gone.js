export default function handler(req, res) {
  res.status(410).setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('410 Gone');
}
