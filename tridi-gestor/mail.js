/* TRIDI MX · Gestor — Correo (Hostinger IMAP/SMTP)
   - Sincroniza encabezados de Recibidos y Enviados a SQLite cada 2 min (el cuerpo se descarga al abrir)
   - Agrupa por cliente: correo registrado en Clientes → dominio de la empresa → dominio → «Sin asignar»
   - Envía por SMTP y guarda copia en Enviados
   Variables: MAIL_USER, MAIL_PASS (obligatorias) · MAIL_IMAP_HOST/PORT · MAIL_SMTP_HOST/PORT · MAIL_FROM_NAME · MAIL_DAYS */
'use strict';
const { ImapFlow } = require('imapflow');
const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const { simpleParser } = require('mailparser');

const GENERIC = new Set(['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'outlook.es', 'live.com', 'live.com.mx', 'msn.com', 'yahoo.com', 'yahoo.com.mx', 'icloud.com', 'me.com', 'mac.com', 'prodigy.net.mx', 'aol.com', 'protonmail.com', 'proton.me', 'gmx.com', 'zoho.com']);
const lc = s => String(s || '').trim().toLowerCase();
const domOf = a => lc(a).split('@')[1] || '';

module.exports = function createMail(store, getDb) {
  const env = process.env;
  const cfg = {
    user: (env.MAIL_USER || '').trim(), pass: env.MAIL_PASS || '',
    imapHost: env.MAIL_IMAP_HOST || 'imap.hostinger.com', imapPort: +env.MAIL_IMAP_PORT || 993, imapSecure: env.MAIL_IMAP_SECURE !== '0',
    smtpHost: env.MAIL_SMTP_HOST || 'smtp.hostinger.com', smtpPort: +env.MAIL_SMTP_PORT || 465,
    fromName: env.MAIL_FROM_NAME || 'TRIDI MX', days: +env.MAIL_DAYS || 365,
    insecure: env.MAIL_TLS_INSECURE === '1' // solo para pruebas locales
  };
  const enabled = !!(cfg.user && cfg.pass);
  const sql = store.raw;
  sql.exec(`CREATE TABLE IF NOT EXISTS mail_msg (
      id TEXT PRIMARY KEY, folder TEXT NOT NULL, uid INTEGER NOT NULL, dir TEXT NOT NULL,
      msgid TEXT, date INTEGER, from_addr TEXT, from_name TEXT, to_json TEXT, cc_json TEXT,
      subject TEXT, seen INTEGER DEFAULT 0, flagged INTEGER DEFAULT 0, has_att INTEGER DEFAULT 0, size INTEGER, refs TEXT);
    CREATE INDEX IF NOT EXISTS mail_msg_date ON mail_msg(date DESC);
    CREATE TABLE IF NOT EXISTS mail_state (folder TEXT PRIMARY KEY, path TEXT, uidvalidity TEXT, lastuid INTEGER);`);
  const q = {
    ins: sql.prepare(`INSERT OR REPLACE INTO mail_msg (id, folder, uid, dir, msgid, date, from_addr, from_name, to_json, cc_json, subject, seen, flagged, has_att, size, refs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    flags: sql.prepare('UPDATE mail_msg SET seen = ?, flagged = ? WHERE id = ?'),
    del: sql.prepare('DELETE FROM mail_msg WHERE id = ?'),
    delFolder: sql.prepare('DELETE FROM mail_msg WHERE folder = ?'),
    get: sql.prepare('SELECT * FROM mail_msg WHERE id = ?'),
    all: sql.prepare('SELECT id, folder, uid, dir, msgid, date, from_addr, from_name, to_json, cc_json, subject, seen, flagged, has_att FROM mail_msg ORDER BY date DESC'),
    recent: sql.prepare('SELECT id, uid FROM mail_msg WHERE folder = ? AND date >= ?'),
    st: sql.prepare('SELECT * FROM mail_state WHERE folder = ?'),
    stPut: sql.prepare('INSERT OR REPLACE INTO mail_state (folder, path, uidvalidity, lastuid) VALUES (?, ?, ?, ?)')
  };
  const status = { enabled, user: cfg.user, lastSync: null, error: null, syncing: false };

  const client = () => new ImapFlow({ host: cfg.imapHost, port: cfg.imapPort, secure: cfg.imapSecure, auth: { user: cfg.user, pass: cfg.pass }, logger: false, tls: cfg.insecure ? { rejectUnauthorized: false } : undefined, socketTimeout: 60000 });
  async function withImap(fn) {
    const c = client();
    await c.connect();
    try { return await fn(c); } finally { try { await c.logout(); } catch (e) { c.close(); } }
  }
  async function folders(c) {
    const list = await c.list();
    const sent = list.find(b => b.specialUse === '\\Sent') || list.find(b => /^(inbox[./])?(sent|enviados|sent items|sent messages)$/i.test(b.path));
    return { in: 'INBOX', out: sent ? sent.path : null };
  }

  /* ---- Sincronización ---- */
  const addrs = list => (list || []).map(a => ({ name: a.name || '', address: lc(a.address) })).filter(a => a.address);
  const hasAttachment = bs => { if (!bs) return false; if (bs.disposition === 'attachment' || (bs.dispositionParameters && bs.dispositionParameters.filename)) return true; return (bs.childNodes || []).some(hasAttachment); };
  async function syncFolder(c, key, path) {
    if (!path) return 0;
    const lock = await c.getMailboxLock(path);
    let added = 0;
    try {
      const box = c.mailbox, uv = String(box.uidValidity);
      let st = q.st.get(key);
      if (!st || st.uidvalidity !== uv || st.path !== path) { q.delFolder.run(key); st = { lastuid: 0 }; }
      let range;
      if (!st.lastuid) {
        const since = new Date(Date.now() - cfg.days * 864e5);
        const uids = await c.search({ since }, { uid: true });
        range = uids && uids.length ? uids.join(',') : null;
      } else range = `${st.lastuid + 1}:*`;
      let maxUid = st.lastuid || 0;
      if (range) {
        const rows = [];
        for await (const m of c.fetch(range, { uid: true, envelope: true, flags: true, bodyStructure: true, internalDate: true, size: true }, { uid: true })) {
          if (m.uid <= (st.lastuid || 0)) continue;
          rows.push(m); maxUid = Math.max(maxUid, m.uid);
        }
        store.tx(() => rows.forEach(m => {
          const e = m.envelope || {}, from = addrs(e.from)[0] || { name: '', address: '' };
          const fl = m.flags || new Set();
          q.ins.run(`${key}:${m.uid}`, key, m.uid, key, e.messageId || null, (e.date || m.internalDate || new Date()).getTime(), from.address, from.name,
            JSON.stringify(addrs(e.to)), JSON.stringify(addrs(e.cc)), e.subject || '', fl.has('\\Seen') ? 1 : 0, fl.has('\\Flagged') ? 1 : 0, hasAttachment(m.bodyStructure) ? 1 : 0, m.size || 0, e.inReplyTo || null);
          added++;
        }));
      }
      // banderas y borrados de los últimos 30 días (por si se leyó o borró en otro cliente)
      const recent = q.recent.all(key, Date.now() - 30 * 864e5);
      if (recent.length) {
        const seen = new Map();
        const minUid = Math.min(...recent.map(r => r.uid));
        for await (const m of c.fetch(`${minUid}:*`, { uid: true, flags: true }, { uid: true })) seen.set(m.uid, m.flags || new Set());
        store.tx(() => recent.forEach(r => {
          const fl = seen.get(r.uid);
          if (!fl) q.del.run(r.id); else q.flags.run(fl.has('\\Seen') ? 1 : 0, fl.has('\\Flagged') ? 1 : 0, r.id);
        }));
      }
      q.stPut.run(key, path, uv, maxUid);
    } finally { lock.release(); }
    return added;
  }
  let running = null;
  function sync() {
    if (!enabled) return Promise.resolve({ ok: false, error: 'Correo no configurado' });
    if (running) return running;
    status.syncing = true;
    running = withImap(async c => {
      const f = await folders(c);
      const a = await syncFolder(c, 'in', f.in), b = await syncFolder(c, 'out', f.out);
      status.lastSync = new Date().toISOString(); status.error = null; status.sentFolder = f.out;
      return { ok: true, nuevos: a + b };
    }).catch(e => { status.error = humanError(e); console.error('Correo · sync:', e.message); return { ok: false, error: status.error }; })
      .finally(() => { status.syncing = false; running = null; });
    return running;
  }
  function humanError(e) {
    const m = String((e && (e.responseText || e.message)) || e);
    if (/auth|login|credentials|AUTHENTICATIONFAILED/i.test(m)) return 'Usuario o contraseña de correo incorrectos (MAIL_USER / MAIL_PASS)';
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH/i.test(m)) return 'No se pudo conectar con el servidor de correo';
    return m.slice(0, 200);
  }
  if (enabled) { setTimeout(sync, 3000); setInterval(sync, 120e3).unref(); }

  /* ---- Agrupación por cliente ---- */
  function clientIndex() {
    const byAddr = new Map(), byDom = new Map();
    (getDb().clientes || []).forEach(c => {
      String(c.email || '').split(/[,;\s]+/).map(lc).filter(x => x.includes('@')).forEach(a => {
        byAddr.set(a, c);
        const d = domOf(a); if (d && !GENERIC.has(d) && !byDom.has(d)) byDom.set(d, c);
      });
    });
    return { byAddr, byDom };
  }
  const own = a => lc(a) === lc(cfg.user);
  function groupOf(row, idx) {
    let peer = row.from_addr;
    if (row.dir === 'out' || own(peer)) { const to = JSON.parse(row.to_json || '[]'); peer = (to.find(t => !own(t.address)) || to[0] || {}).address || ''; }
    const c = idx.byAddr.get(peer) || idx.byDom.get(domOf(peer));
    if (c) return { key: 'c:' + c.id, label: c.nombre, type: 'cliente', peer };
    const d = domOf(peer);
    if (d && !GENERIC.has(d)) return { key: 'd:' + d, label: d, type: 'dominio', peer };
    return { key: 'sin', label: 'Sin asignar', type: 'sin', peer };
  }
  function listing() {
    const idx = clientIndex();
    return q.all.all().map(r => ({ ...r, g: groupOf(r, idx) }));
  }
  function groups() {
    const map = new Map();
    let total = 0, unread = 0;
    listing().forEach(r => {
      const g = map.get(r.g.key) || { key: r.g.key, label: r.g.label, type: r.g.type, count: 0, unread: 0, last: 0 };
      g.count++; if (!r.seen && r.dir === 'in') g.unread++; g.last = Math.max(g.last, r.date || 0);
      map.set(r.g.key, g); total++; if (!r.seen && r.dir === 'in') unread++;
    });
    return { total, unread, groups: [...map.values()].sort((a, b) => b.last - a.last) };
  }
  const pub = r => ({ id: r.id, dir: r.dir, date: r.date, from: { name: r.from_name, address: r.from_addr }, to: JSON.parse(r.to_json || '[]'), cc: JSON.parse(r.cc_json || '[]'), subject: r.subject, seen: !!r.seen, flagged: !!r.flagged, att: !!r.has_att, group: r.g });
  function list({ group, dir, q: text, limit, before }) {
    const t = lc(text);
    let rows = listing();
    if (group && group !== 'all') rows = rows.filter(r => r.g.key === group);
    if (dir === 'in' || dir === 'out') rows = rows.filter(r => r.dir === dir);
    if (dir === 'unread') rows = rows.filter(r => !r.seen && r.dir === 'in');
    if (t) rows = rows.filter(r => lc([r.subject, r.from_name, r.from_addr, r.to_json, r.g.label].join(' ')).includes(t));
    if (before) rows = rows.filter(r => r.date < +before);
    const lim = Math.min(200, +limit || 60);
    return { items: rows.slice(0, lim).map(pub), more: rows.length > lim };
  }

  /* ---- Lectura de un mensaje (con caché corta) ---- */
  const cache = new Map();
  async function parsed(id) {
    if (cache.has(id)) return cache.get(id);
    const row = q.get.get(id); if (!row) throw Object.assign(new Error('Mensaje no encontrado'), { code: 404 });
    const st = q.st.get(row.folder);
    const p = await withImap(async c => {
      const lock = await c.getMailboxLock(st.path);
      try {
        const m = await c.fetchOne(String(row.uid), { source: true }, { uid: true });
        if (!m || !m.source) throw Object.assign(new Error('El mensaje ya no está en el servidor'), { code: 404 });
        if (!row.seen && row.dir === 'in') { await c.messageFlagsAdd(String(row.uid), ['\\Seen'], { uid: true }); q.flags.run(1, row.flagged, id); }
        return simpleParser(m.source);
      } finally { lock.release(); }
    });
    cache.set(id, p); if (cache.size > 15) cache.delete(cache.keys().next().value);
    return p;
  }
  async function read(id) {
    const p = await parsed(id);
    let html = p.html || '';
    const atts = (p.attachments || []).map((a, i) => ({ i, filename: a.filename || `adjunto-${i + 1}`, size: a.size, type: a.contentType, cid: a.cid || null, inline: a.contentDisposition === 'inline' && !!a.cid }));
    if (html) {
      (p.attachments || []).forEach(a => { if (a.cid && a.size < 1.5e6 && /^image\//.test(a.contentType)) html = html.split(`cid:${a.cid}`).join(`data:${a.contentType};base64,${a.content.toString('base64')}`); });
      html = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    }
    const row = q.get.get(id);
    return { id, subject: p.subject || '', date: p.date ? p.date.getTime() : row.date, from: p.from ? p.from.value : [], to: p.to ? [].concat(p.to).flatMap(x => x.value) : [], cc: p.cc ? [].concat(p.cc).flatMap(x => x.value) : [],
      messageId: p.messageId || null, references: [].concat(p.references || []), html, text: p.text || '', attachments: atts.filter(a => !a.inline || !html) };
  }
  async function attachment(id, i) {
    const p = await parsed(id), a = (p.attachments || [])[+i];
    if (!a) throw Object.assign(new Error('Adjunto no encontrado'), { code: 404 });
    return { filename: a.filename || `adjunto-${+i + 1}`, content: a.content, type: a.contentType };
  }
  async function setFlag(id, flag, on) {
    const row = q.get.get(id); if (!row) throw Object.assign(new Error('Mensaje no encontrado'), { code: 404 });
    const st = q.st.get(row.folder), f = flag === 'flagged' ? '\\Flagged' : '\\Seen';
    await withImap(async c => { const lock = await c.getMailboxLock(st.path); try { await c[on ? 'messageFlagsAdd' : 'messageFlagsRemove'](String(row.uid), [f], { uid: true }); } finally { lock.release(); } });
    q.flags.run(flag === 'seen' ? (on ? 1 : 0) : row.seen, flag === 'flagged' ? (on ? 1 : 0) : row.flagged, id);
  }

  /* ---- Firma de correo por usuario (kv sig:<usuario>) ---- */
  const SIG_MAX = 1.5 * 1024 * 1024;
  const sigKey = u => 'sig:' + lc(u);
  const getSig = u => store.get(sigKey(u), null);
  function saveSig(u, b) {
    if (b === null || b.remove) { store.put(sigKey(u), null); return null; }
    const prev = getSig(u) || {};
    const out = { text: String(b.text || '').slice(0, 600), width: Math.max(80, Math.min(700, +b.width || prev.width || 400)), updated: new Date().toISOString() };
    if (b.image) {
      const m = /^data:image\/(gif|png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.image));
      if (!m) throw Object.assign(new Error('La imagen debe ser GIF, PNG o JPG'), { code: 400 });
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > SIG_MAX) throw Object.assign(new Error('La imagen de la firma no debe pasar de 1.5 MB'), { code: 413 });
      const magic = { gif: buf.slice(0, 4).toString() === 'GIF8', png: buf.slice(0, 4).toString('hex') === '89504e47', jpeg: buf.slice(0, 2).toString('hex') === 'ffd8' }[m[1]];
      if (!magic) throw Object.assign(new Error('El archivo no coincide con su formato'), { code: 400 });
      out.mime = 'image/' + m[1]; out.data = m[2];
    } else if (!b.dropImage && prev.data) { out.mime = prev.mime; out.data = prev.data; }
    if (!out.text && !out.data) { store.put(sigKey(u), null); return null; }
    store.put(sigKey(u), out); return out;
  }
  const sigPublic = s => s ? { text: s.text, width: s.width, hasImage: !!s.data, mime: s.mime || null, updated: s.updated } : null;

  /* ---- Envío ---- */
  const transport = () => nodemailer.createTransport({ host: cfg.smtpHost, port: cfg.smtpPort, secure: cfg.smtpPort === 465, auth: { user: cfg.user, pass: cfg.pass }, tls: cfg.insecure ? { rejectUnauthorized: false } : undefined });
  const cleanList = v => [].concat(v || []).join(',').split(/[,;]+/).map(s => s.trim()).filter(Boolean);
  const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
  async function send(b, me) {
    if (!enabled) throw Object.assign(new Error('Correo no configurado'), { code: 400 });
    const to = cleanList(b.to), cc = cleanList(b.cc), bcc = cleanList(b.bcc);
    const bad = [...to, ...cc, ...bcc].find(a => !EMAIL_RE.test(a.replace(/^.*<([^>]+)>$/, '$1')));
    if (!to.length) throw Object.assign(new Error('Falta el destinatario'), { code: 400 });
    if (bad) throw Object.assign(new Error('Correo inválido: ' + bad), { code: 400 });
    const subject = String(b.subject || '').slice(0, 300), text = String(b.text || '');
    const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const sig = b.firma === false ? null : getSig(me.username);
    const sigCid = sig && sig.data ? `firma-${lc(me.username).replace(/[^a-z0-9]/g, '')}@tridimx` : null;
    const sigHtml = sig ? `<div style="margin-top:18px;font-family:Arial,sans-serif;font-size:13px;line-height:1.45;color:#1b2d4f">${sig.text ? esc(sig.text).replace(/\n/g, '<br>') : ''}${sigCid ? `${sig.text ? '<br>' : ''}<img src="cid:${sigCid}" width="${sig.width}" alt="${esc(cfg.fromName)}" style="max-width:100%;height:auto;border:0;display:block;margin-top:6px">` : ''}</div>` : '';
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1b2d4f">${esc(text).replace(/\n/g, '<br>')}</div>` + sigHtml + (b.quoteHtml ? `<br><blockquote style="margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex;color:#555">${String(b.quoteHtml).replace(/<script[\s\S]*?<\/script>/gi, '')}</blockquote>` : '');
    const attachments = (Array.isArray(b.attachments) ? b.attachments : []).slice(0, 10).map(a => ({ filename: String(a.filename || 'adjunto').slice(0, 120), content: Buffer.from(String(a.data || ''), 'base64'), contentType: a.contentType || 'application/octet-stream' }));
    if (attachments.reduce((s, a) => s + a.content.length, 0) > 20 * 1024 * 1024) throw Object.assign(new Error('Los adjuntos superan 20 MB'), { code: 413 });
    let inReplyTo, references;
    if (b.replyTo) { const orig = q.get.get(String(b.replyTo)); if (orig && orig.msgid) { inReplyTo = orig.msgid; references = [orig.refs, orig.msgid].filter(Boolean).join(' '); } }
    if (sigCid) attachments.push({ filename: 'firma.' + sig.mime.split('/')[1].replace('jpeg', 'jpg'), content: Buffer.from(sig.data, 'base64'), contentType: sig.mime, cid: sigCid, contentDisposition: 'inline' });
    const textFull = sig && sig.text ? `${text}\n\n-- \n${sig.text}` : text;
    const mail = { from: { name: cfg.fromName, address: cfg.user }, to, cc, bcc, subject, text: textFull, html, attachments, inReplyTo, references, headers: { 'X-Enviado-Por': `Gestor TRIDI MX (${me.username})` } };
    const raw = await new MailComposer(mail).compile().build();
    await transport().sendMail({ envelope: { from: cfg.user, to: [...to, ...cc, ...bcc].map(a => a.replace(/^.*<([^>]+)>$/, '$1')) }, raw });
    // copia en Enviados (Hostinger no la guarda sola al enviar por SMTP)
    try { await withImap(async c => { const f = await folders(c); if (f.out) await c.append(f.out, raw, ['\\Seen']); }); } catch (e) { console.error('Correo · copia en Enviados:', e.message); }
    sync();
    return { ok: true };
  }

  /* ---- Ruteo /api/mail/* (permiso «correo») ---- */
  async function handle(req, res, p, method, me, h) {
    if (!p.startsWith('/api/mail/')) return false;
    if (!h.can(me, 'correo')) { h.send(req, res, 403, { error: 'Sin permiso para Correo' }); return true; }
    const route = p.slice('/api/mail'.length), url = new URL(req.url, 'http://x');
    try {
      if (route === '/status' && method === 'GET') { h.send(req, res, 200, status); return true; }
      let sm = /^\/signature(?:\/([a-z0-9._-]+))?(\/image)?$/.exec(route);
      if (sm) {
        if (sm[1] === 'image' && !sm[2]) { sm[1] = undefined; sm[2] = '/image'; }
        const who = lc(sm[1] || me.username);
        if (who !== lc(me.username) && me.role !== 'admin') { h.send(req, res, 403, { error: 'Solo un administrador puede editar la firma de otro usuario' }); return true; }
        if (sm[2] && method === 'GET') {
          const sg = getSig(who); if (!sg || !sg.data) { h.send(req, res, 404, { error: 'Sin imagen' }); return true; }
          const buf = Buffer.from(sg.data, 'base64');
          res.writeHead(200, h.headers(req, { 'Content-Type': sg.mime, 'Cache-Control': 'private, no-cache', 'Content-Length': buf.length })); res.end(buf); return true;
        }
        if (method === 'GET') { h.send(req, res, 200, sigPublic(getSig(who))); return true; }
        if (method === 'PUT') { h.send(req, res, 200, sigPublic(saveSig(who, (await h.readBody(req, 3 * 1024 * 1024)) || {}))); return true; }
        if (method === 'DELETE') { saveSig(who, null); h.send(req, res, 200, { ok: true }); return true; }
      }
      if (!enabled) { h.send(req, res, 400, { error: 'Correo no configurado: define MAIL_USER y MAIL_PASS en Easypanel' }); return true; }
      if (route === '/sync' && method === 'POST') { h.send(req, res, 200, await sync()); return true; }
      if (route === '/groups' && method === 'GET') { h.send(req, res, 200, groups()); return true; }
      if (route === '/list' && method === 'GET') { h.send(req, res, 200, list(Object.fromEntries(url.searchParams))); return true; }
      if (route === '/send' && method === 'POST') { h.send(req, res, 200, await send(await h.readBody(req, 30 * 1024 * 1024), me)); return true; }
      let m = /^\/msg\/((?:in|out):\d+)$/.exec(route);
      if (m && method === 'GET') { h.send(req, res, 200, await read(m[1])); return true; }
      m = /^\/msg\/((?:in|out):\d+)\/flag$/.exec(route);
      if (m && method === 'POST') { const b = (await h.readBody(req, 2048)) || {}; await setFlag(m[1], b.flag === 'flagged' ? 'flagged' : 'seen', !!b.on); h.send(req, res, 200, { ok: true }); return true; }
      m = /^\/msg\/((?:in|out):\d+)\/att\/(\d+)$/.exec(route);
      if (m && method === 'GET') {
        const a = await attachment(m[1], m[2]);
        res.writeHead(200, h.headers(req, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`, 'Cache-Control': 'private, no-store', 'Content-Length': a.content.length }));
        res.end(a.content); return true;
      }
      h.send(req, res, 404, { error: 'No encontrado' }); return true;
    } catch (e) {
      if (!res.headersSent) h.send(req, res, e.code === 404 ? 404 : e.code === 400 ? 400 : e.code === 413 ? 413 : 502, { error: e.code ? e.message : humanError(e) });
      return true;
    }
  }
  return { handle, status };
};
