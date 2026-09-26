module.exports = (error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
  if (error.status === 415) return res.status(415).json({ error: 'Unsupported request encoding or charset' });
  if (error instanceof URIError) return res.status(400).json({ error: 'Invalid URL encoding' });
  if (error.status === 400) return res.status(400).json({ error: error.message });
  console.error('Request failed:', error.message || error.code);
  return res.status(500).json({ error: 'Internal server error' });
};
