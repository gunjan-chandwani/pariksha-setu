const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '15mb' }));
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const users = {
  'faculty@mru.edu.in': { password: process.env.DEMO_PASSWORD || 'demo123', role: 'Faculty' },
  'coe@mru.edu.in': { password: process.env.DEMO_PASSWORD || 'demo123', role: 'COE' },
  'moderator@mru.edu.in': { password: process.env.DEMO_PASSWORD || 'demo123', role: 'Moderator' }
};
function sign(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const [body, sig] = token.split('.');
  if (!body || !sig) return res.status(401).json({ error: 'Sign in required' });
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest();
  let actual; try { actual = Buffer.from(sig, 'base64url'); } catch { return res.status(401).json({ error: 'Invalid session' }); }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return res.status(401).json({ error: 'Invalid session' });
  try { req.user = JSON.parse(Buffer.from(body, 'base64url').toString()); if (req.user.exp < Date.now()) throw new Error('expired'); next(); }
  catch { return res.status(401).json({ error: 'Session expired; sign in again' }); }
}
app.get('/api/health', async (_req, res) => {
  if (!supabase) return res.status(503).json({ ok: false, database: 'not-configured', hint: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' });
  const { error } = await supabase.from('portal_state').select('id').eq('id', 'main').maybeSingle();
  res.status(error ? 503 : 200).json({ ok: !error, database: error ? 'error' : 'connected', detail: error?.message });
});
app.post('/api/login', (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  const password = String(req.body?.password || '');
  const role = String(req.body?.role || '');
  const user = users[email];
  if (!user || user.password !== password || user.role !== role) return res.status(401).json({ error: 'Invalid demo credentials or role' });
  res.json({ token: sign({ email, role }), user: { email, role } });
});
app.get('/api/state', auth, async (_req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase is not configured. See README.md.' });
  const { data, error } = await supabase.from('portal_state').select('data,updated_at').eq('id', 'main').maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data: data?.data || null, updated_at: data?.updated_at || null });
});
app.put('/api/state', auth, async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase is not configured. See README.md.' });
  const data = req.body?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return res.status(400).json({ error: 'Expected a JSON object in data.' });
  if (JSON.stringify(data).length > 12_000_000) return res.status(413).json({ error: 'Portal data exceeds the allowed size.' });
  const row = { id: 'main', data, updated_at: new Date().toISOString(), updated_by: req.user.email };
  const { error } = await supabase.from('portal_state').upsert(row, { onConflict: 'id' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, updated_at: row.updated_at });
});
app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: '1h' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Pariksha Setu listening on ${PORT}; Supabase ${supabase ? 'configured' : 'NOT configured'}`));
