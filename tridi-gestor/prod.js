/* TRIDI MX · Gestor — Control de Producción (antes tridi-scheduler v8)
   API bajo /api/prod/* con permisos:
     produccion → ver y editar trabajos, máquinas, horario y modo «Taller sin Supervisión»
     taller     → solo lectura (pantalla del taller)                                     */
'use strict';
const TIPOS = ['3d', 'sla', 'laser', 'uvdtf'];
const HOLD_LEAD_MS = 2 * 60 * 1000;

module.exports = function createProd(store, getDb) {
  const readJobs = () => { const j = store.get('prod:jobs', []); return Array.isArray(j) ? j : []; };
  const readConfig = () => store.get('prod:config', {}) || {};
  const writeJobs = j => store.put('prod:jobs', j);
  const writeConfig = c => store.put('prod:config', c);

  /* ---- Tiempo real (SSE) ---- */
  const BOOT_ID = Date.now();
  const clients = new Set();
  function broadcast(type) {
    const msg = 'data: ' + JSON.stringify({ type, t: Date.now() }) + '\n\n';
    for (const c of clients) { try { c.write(msg); } catch (e) { clients.delete(c); } }
  }
  setInterval(() => { for (const c of clients) { try { c.write(': ping\n\n'); } catch (e) { clients.delete(c); } } }, 20000).unref();

  /* ---- Modo «Taller sin Supervisión» (idéntico a v8) ---- */
  const jS = j => new Date((j.segments && j.segments[0] ? j.segments[0].start : j.start)).getTime();
  const jE = j => new Date((j.segments && j.segments.length ? j.segments[j.segments.length - 1].end : j.end)).getTime();
  const jDur = j => (j.segments && j.segments.length ? j.segments : [{ start: j.start, end: j.end }])
    .reduce((a, s) => a + (new Date(s.end) - new Date(s.start)), 0);
  function dayWin(horario, day) {
    const cfg = horario[day.getDay()];
    if (!cfg || !cfg.activo) return null;
    const hm = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
    const s = hm(cfg.inicio), e = hm(cfg.fin);
    if (!(e > s)) return null;
    const y = day.getFullYear(), mo = day.getMonth(), d = day.getDate();
    return { start: new Date(y, mo, d, Math.floor(s / 60), s % 60).getTime(), end: new Date(y, mo, d, Math.floor(e / 60), e % 60).getTime() };
  }
  function nextWork(horario, t) {
    let d = new Date(t); d.setHours(0, 0, 0, 0);
    for (let i = 0; i < 400; i++) {
      const w = dayWin(horario, d);
      if (w && t < w.end) return Math.max(t, w.start);
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    }
    return null;
  }
  function buildSegs(horario, start, durMs) {
    const segs = []; let rem = durMs, cur = nextWork(horario, start), g = 0;
    while (cur !== null && rem > 0 && g++ < 5000) {
      const d0 = new Date(cur); d0.setHours(0, 0, 0, 0);
      const w = dayWin(horario, d0);
      const take = Math.min(rem, w.end - cur);
      segs.push({ start: new Date(cur).toISOString(), end: new Date(cur + take).toISOString() });
      rem -= take;
      if (rem > 0) cur = nextWork(horario, w.end);
    }
    return rem > 0 ? null : segs;
  }
  function holdTick() {
    const cfg = readConfig();
    if (!cfg.sinSupervision || !Array.isArray(cfg.horario) || cfg.horario.length !== 7) return false;
    if (!cfg.horario.some(h => h.activo)) return false;
    const protectedIds = new Set(cfg.sinSupervisionIds || []);
    const jobs = readJobs();
    const now = Date.now(), lead = now + HOLD_LEAD_MS;
    const byPrinter = new Map();
    jobs.forEach(j => { if (!byPrinter.has(j.printerId)) byPrinter.set(j.printerId, []); byPrinter.get(j.printerId).push(j); });
    let changed = false;
    for (const list of byPrinter.values()) {
      list.sort((a, b) => jS(a) - jS(b));
      let cursor = 0;
      for (const j of list) {
        const fixed = protectedIds.has(j.id) || jE(j) <= now;
        if (fixed) { cursor = Math.max(cursor, jE(j)); continue; }
        const want = Math.max(jS(j), lead, cursor);
        if (want === jS(j)) { cursor = Math.max(cursor, jE(j)); continue; }
        const segs = buildSegs(cfg.horario, want, jDur(j));
        if (!segs) { cursor = Math.max(cursor, jE(j)); continue; }
        j.segments = segs; j.start = segs[0].start; j.end = segs[segs.length - 1].end;
        delete j.cierre;
        cursor = new Date(j.end).getTime();
        changed = true;
      }
    }
    if (changed) { writeJobs(jobs); broadcast('jobs'); }
    return changed;
  }
  setInterval(() => { try { holdTick(); } catch (e) { console.error('holdTick', e.message); } }, 20000).unref();

  function validConfig(printers, horario) {
    if (!Array.isArray(printers) || printers.length > 200) return 'Se esperaba una lista de máquinas.';
    for (const p of printers) if (!p || typeof p.id !== 'string' || !TIPOS.includes(p.tipo)) return 'Máquina inválida.';
    if (!Array.isArray(horario) || horario.length !== 7) return 'Se esperaba el horario de los 7 días.';
    return null;
  }

  /* ---- Ruteo: devuelve true si atendió la petición ---- */
  async function handle(req, res, p, method, me, h) {
    if (!p.startsWith('/api/prod/')) return false;
    const edit = h.can(me, 'produccion'), view = edit || h.can(me, 'taller');
    if (!view) { h.send(req, res, 403, { error: 'Sin permiso para Control de Producción' }); return true; }
    const route = p.slice('/api/prod'.length);

    if (route === '/events' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n\n');
      res.write('data: ' + JSON.stringify({ type: 'hello', boot: BOOT_ID }) + '\n\n');
      clients.add(res); req.on('close', () => clients.delete(res));
      return true;
    }
    if (route === '/jobs' && method === 'GET') { h.send(req, res, 200, readJobs()); return true; }
    if (route === '/config' && method === 'GET') { h.send(req, res, 200, readConfig()); return true; }
    if (route === '/catalog' && method === 'GET') {
      const db = getDb ? getDb() : {};
      const act = p => !['cerrado', 'cancelado'].includes(p.estatus);
      h.send(req, res, 200, { clientes: (db.clientes || []).map(c => c.nombre).filter(Boolean), proyectos: (db.proyectos || []).filter(act).map(p => p.nombre).filter(Boolean) });
      return true;
    }
    if (route === '/me' && method === 'GET') { h.send(req, res, 200, { edit, view, name: me.name }); return true; }

    if (!edit) { h.send(req, res, 403, { error: 'Solo lectura' }); return true; }

    if (route === '/jobs' && method === 'PUT') {
      const body = await h.readBody(req, 4 * 1024 * 1024);
      if (!Array.isArray(body)) { h.send(req, res, 400, { error: 'Se esperaba una lista de trabajos.' }); return true; }
      const byId = new Map(readJobs().filter(j => j && j.cierre).map(j => [j.id, j]));
      body.forEach(j => { const o = j && byId.get(j.id); if (o && !j.cierre && o.end === j.end) j.cierre = o.cierre; });
      writeJobs(body); h.send(req, res, 200, { ok: true }); broadcast('jobs');
      try { holdTick(); } catch (e) { /* siguiente ciclo */ }
      return true;
    }
    const cm = /^\/jobs\/([^/]+)\/cierre$/.exec(route);
    if (cm && method === 'PUT') {
      const { estado, nota } = (await h.readBody(req, 20 * 1024)) || {};
      if (estado !== null && estado !== 'ok' && estado !== 'problema') { h.send(req, res, 400, { error: 'Estado inválido.' }); return true; }
      const jobs = readJobs(), job = jobs.find(j => j && j.id === cm[1]);
      if (!job) { h.send(req, res, 404, { error: 'No existe el trabajo.' }); return true; }
      if (estado === null) delete job.cierre;
      else job.cierre = { estado, nota: String(nota || '').trim().slice(0, 500), at: new Date().toISOString(), by: me.name || me.username };
      writeJobs(jobs); h.send(req, res, 200, { ok: true, cierre: job.cierre || null }); broadcast('jobs'); return true;
    }
    if (route === '/config' && method === 'PUT') {
      const { printers, horario } = (await h.readBody(req, 512 * 1024)) || {};
      const err = validConfig(printers, horario);
      if (err) { h.send(req, res, 400, { error: err }); return true; }
      const prev = readConfig(), next = { printers, horario };
      if (prev.sinSupervision) { next.sinSupervision = true; next.sinSupervisionIds = prev.sinSupervisionIds || []; next.sinSupervisionDesde = prev.sinSupervisionDesde; }
      writeConfig(next); h.send(req, res, 200, { ok: true }); broadcast('config'); return true;
    }
    if (route === '/supervision' && method === 'PUT') {
      const b = (await h.readBody(req, 4 * 1024)) || {};
      const on = b.on === true, cfg = readConfig();
      if (!Array.isArray(cfg.printers) || !Array.isArray(cfg.horario)) { h.send(req, res, 409, { error: 'Configura primero las máquinas y el horario.' }); return true; }
      if (on && !cfg.sinSupervision) {
        const now = Date.now();
        cfg.sinSupervision = true; cfg.sinSupervisionDesde = new Date(now).toISOString();
        cfg.sinSupervisionIds = readJobs().filter(j => jS(j) <= now && jE(j) > now).map(j => j.id);
      } else if (!on) { delete cfg.sinSupervision; delete cfg.sinSupervisionIds; delete cfg.sinSupervisionDesde; }
      writeConfig(cfg);
      if (on) holdTick();
      h.send(req, res, 200, { ok: true, sinSupervision: !!cfg.sinSupervision }); broadcast('config'); return true;
    }
    /* Importar datos del scheduler v8 (jobs.json y config.json) — solo administradores */
    if (route === '/import' && method === 'POST') {
      if (me.role !== 'admin') { h.send(req, res, 403, { error: 'Solo administradores' }); return true; }
      const b = (await h.readBody(req, 8 * 1024 * 1024)) || {};
      if (b.jobs !== undefined && !Array.isArray(b.jobs)) { h.send(req, res, 400, { error: 'jobs.json debe ser una lista' }); return true; }
      if (b.config) { const err = validConfig(b.config.printers, b.config.horario); if (err) { h.send(req, res, 400, { error: 'config.json: ' + err }); return true; } }
      store.tx(() => {
        store.put('prod:backup-pre-import', { jobs: readJobs(), config: readConfig(), at: new Date().toISOString() });
        if (b.jobs) writeJobs(b.jobs);
        if (b.config) writeConfig(b.config);
      });
      h.send(req, res, 200, { ok: true, jobs: (b.jobs || readJobs()).length }); broadcast('jobs'); broadcast('config'); return true;
    }
    h.send(req, res, 404, { error: 'No encontrado' }); return true;
  }

  return { handle };
};
