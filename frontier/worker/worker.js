// Frontier log API: Cloudflare Worker + D1.
// GET /log (public) · GET /auth · POST /fuel · DELETE /fuel/:id (Bearer FRONTIER_KEY)

const ORIGINS = ['https://www.amanvg.com', 'https://amanvg.com', 'http://localhost:8765'];
const MAX_FUEL = 5000;

const isDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};
const isNum = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;

async function authorized(req, env) {
  const given = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
  if (!given || !env.FRONTIER_KEY) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, env.FRONTIER_KEY].map((v) => crypto.subtle.digest('SHA-256', enc.encode(v))));
  return crypto.subtle.timingSafeEqual(a, b);
}

async function readLog(env) {
  const [truck, fuel, services] = await env.DB.batch([
    env.DB.prepare('SELECT year, drive, odometer, use FROM truck WHERE id = 1'),
    env.DB.prepare('SELECT id, date, miles, gallons, cost FROM fuel ORDER BY date, miles'),
    env.DB.prepare('SELECT id, item, date, miles, cost, done_by AS by, notes FROM services ORDER BY date, miles'),
  ]);
  const t = truck.results[0] || { year: null, drive: null, odometer: null, use: 'standard' };
  return { version: 1, truck: t, services: services.results, fuel: fuel.results, exportedOn: null };
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin');
    const headers = { Vary: 'Origin', 'Cache-Control': 'no-store' };
    if (origin && ORIGINS.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
      headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS';
      headers['Access-Control-Max-Age'] = '86400';
    }
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
    const fail = (status, error) => json({ error }, status);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const { pathname } = new URL(req.url);

    if (req.method === 'GET' && pathname === '/log') return json(await readLog(env));

    // Everything below needs the key.
    if (!(await authorized(req, env))) return fail(401, 'Unauthorized');
    if (req.method === 'GET' && pathname === '/auth') return new Response(null, { status: 204, headers });

    if (req.method === 'POST' && pathname === '/fuel') {
      let b;
      try { b = await req.json(); } catch (e) { return fail(400, 'Invalid JSON'); }
      if (!b || typeof b !== 'object') return fail(400, 'Invalid body');
      if (!isDate(b.date)) return fail(400, 'Invalid date');
      if (!Number.isInteger(b.miles) || !isNum(b.miles, 0, 2000000)) return fail(400, 'Invalid odometer');
      if (!isNum(b.gallons, 0.001, 100)) return fail(400, 'Invalid gallons');
      const cost = b.cost === undefined ? 0 : b.cost;
      if (!isNum(cost, 0, 10000)) return fail(400, 'Invalid cost');
      const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM fuel').first();
      if (n >= MAX_FUEL) return fail(400, 'Log full');
      await env.DB.batch([
        env.DB.prepare('INSERT INTO fuel (id, date, miles, gallons, cost) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), b.date, b.miles, b.gallons, cost),
        env.DB.prepare('INSERT INTO truck (id, odometer) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET odometer = MAX(COALESCE(odometer, 0), excluded.odometer)').bind(b.miles),
      ]);
      return json(await readLog(env), 201);
    }

    const del = pathname.match(/^\/fuel\/([\w-]{1,64})$/);
    if (req.method === 'DELETE' && del) {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM fuel WHERE id = ?').bind(del[1]),
        env.DB.prepare('UPDATE truck SET odometer = COALESCE((SELECT MAX(m) FROM (SELECT MAX(miles) AS m FROM fuel UNION ALL SELECT MAX(miles) FROM services)), odometer) WHERE id = 1'),
      ]);
      return json(await readLog(env));
    }

    return fail(404, 'Not found');
  },
};
