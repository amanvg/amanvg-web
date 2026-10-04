// Frontier log API: Cloudflare Worker + D1.
// GET /log (public) · GET /auth · POST /fuel · PUT /fuel/:id · POST /services · DELETE /fuel/:id · DELETE /services/:id · PUT /truck (Bearer FRONTIER_KEY)

const ORIGINS = ['https://www.amanvg.com', 'https://amanvg.com', 'http://localhost:8765'];
const MAX_FUEL = 5000;
const MAX_SERVICES = 5000;
const MAX_VISIT_ITEMS = 25;

const isDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};
const isNum = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const isFlag = (v) => v === undefined || typeof v === 'boolean';
// Odometer = the highest reading across fill-ups and services.
const ODO_SQL = 'UPDATE truck SET odometer = COALESCE((SELECT MAX(m) FROM (SELECT MAX(miles) AS m FROM fuel UNION ALL SELECT MAX(miles) FROM services)), odometer) WHERE id = 1';

// A fill-up body for POST /fuel and PUT /fuel/:id: the clean row, or an error string.
function fuelRow(b) {
  if (!b || typeof b !== 'object') return 'Invalid body';
  if (!isDate(b.date)) return 'Invalid date';
  if (!Number.isInteger(b.miles) || !isNum(b.miles, 0, 2000000)) return 'Invalid odometer';
  if (!isNum(b.gallons, 0.001, 100)) return 'Invalid gallons';
  const cost = b.cost === undefined ? 0 : b.cost;
  if (!isNum(cost, 0, 10000)) return 'Invalid cost';
  if (!isFlag(b.partial) || !isFlag(b.missed)) return 'Invalid flag';
  return { date: b.date, miles: b.miles, gallons: b.gallons, cost, partial: b.partial ? 1 : 0, missed: b.missed ? 1 : 0 };
}

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
    env.DB.prepare('SELECT id, date, miles, gallons, cost, partial, missed FROM fuel ORDER BY date, miles'),
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
      headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
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
      const r = fuelRow(b);
      if (typeof r === 'string') return fail(400, r);
      const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM fuel').first();
      if (n >= MAX_FUEL) return fail(400, 'Log full');
      await env.DB.batch([
        env.DB.prepare('INSERT INTO fuel (id, date, miles, gallons, cost, partial, missed) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), r.date, r.miles, r.gallons, r.cost, r.partial, r.missed),
        env.DB.prepare('INSERT INTO truck (id, odometer) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET odometer = MAX(COALESCE(odometer, 0), excluded.odometer)').bind(r.miles),
      ]);
      return json(await readLog(env), 201);
    }

    const fuelId = pathname.match(/^\/fuel\/([\w-]{1,64})$/);
    if (req.method === 'PUT' && fuelId) {
      let b;
      try { b = await req.json(); } catch (e) { return fail(400, 'Invalid JSON'); }
      const r = fuelRow(b);
      if (typeof r === 'string') return fail(400, r);
      const [upd] = await env.DB.batch([
        env.DB.prepare('UPDATE fuel SET date = ?, miles = ?, gallons = ?, cost = ?, partial = ?, missed = ? WHERE id = ?').bind(r.date, r.miles, r.gallons, r.cost, r.partial, r.missed, fuelId[1]),
        env.DB.prepare(ODO_SQL),
      ]);
      if (!upd.meta.changes) return fail(404, 'Not found');
      return json(await readLog(env));
    }

    if (req.method === 'PUT' && pathname === '/truck') {
      let b;
      try { b = await req.json(); } catch (e) { return fail(400, 'Invalid JSON'); }
      if (!b || typeof b !== 'object') return fail(400, 'Invalid body');
      const cur = (await readLog(env)).truck;
      const year = 'year' in b ? b.year : cur.year;
      const drive = 'drive' in b ? b.drive : cur.drive;
      const use = 'use' in b ? b.use : cur.use;
      if (!(year === null || (Number.isInteger(year) && year >= 2022 && year <= 2100))) return fail(400, 'Invalid year');
      if (!(drive === null || drive === '2WD' || drive === '4WD')) return fail(400, 'Invalid drivetrain');
      if (use !== 'standard' && use !== 'severe') return fail(400, 'Invalid use');
      await env.DB.prepare('INSERT INTO truck (id, year, drive, use) VALUES (1, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET year = excluded.year, drive = excluded.drive, use = excluded.use').bind(year, drive, use).run();
      return json(await readLog(env));
    }

    if (req.method === 'POST' && pathname === '/services') {
      let b;
      try { b = await req.json(); } catch (e) { return fail(400, 'Invalid JSON'); }
      if (!b || typeof b !== 'object') return fail(400, 'Invalid body');
      const items = [...new Set(Array.isArray(b.items) ? b.items : [b.item])];
      if (!items.length || items.length > MAX_VISIT_ITEMS || !items.every((i) => typeof i === 'string' && /^[\w-]{1,80}$/.test(i))) return fail(400, 'Invalid item');
      if (!isDate(b.date)) return fail(400, 'Invalid date');
      if (!Number.isInteger(b.miles) || !isNum(b.miles, 0, 2000000)) return fail(400, 'Invalid odometer');
      const cost = b.cost === undefined ? 0 : b.cost;
      if (!isNum(cost, 0, 100000)) return fail(400, 'Invalid cost');
      if (b.by !== 'diy' && b.by !== 'shop') return fail(400, 'Invalid done by');
      const notes = b.notes === undefined ? '' : b.notes;
      if (typeof notes !== 'string' || notes.length > 200) return fail(400, 'Invalid notes');
      const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM services').first();
      if (n + items.length > MAX_SERVICES) return fail(400, 'Log full');
      await env.DB.batch([
        // One row per item; the visit cost sits on the first so totals stay right.
        ...items.map((item, i) => env.DB.prepare('INSERT INTO services (id, item, date, miles, cost, done_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), item, b.date, b.miles, i === 0 ? cost : 0, b.by, notes)),
        env.DB.prepare('INSERT INTO truck (id, odometer) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET odometer = MAX(COALESCE(odometer, 0), excluded.odometer)').bind(b.miles),
      ]);
      return json(await readLog(env), 201);
    }

    const del = pathname.match(/^\/(fuel|services)\/([\w-]{1,64})$/);
    if (req.method === 'DELETE' && del) {
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM ${del[1]} WHERE id = ?`).bind(del[2]),
        env.DB.prepare(ODO_SQL),
      ]);
      return json(await readLog(env));
    }

    return fail(404, 'Not found');
  },
};
