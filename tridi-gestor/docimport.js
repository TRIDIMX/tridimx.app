/* TRIDI MX · Gestor — Importar presupuestos y facturas (PDF o CFDI XML) a Proyectos
   - XML CFDI 3.3/4.0: lectura exacta de Emisor, Receptor, conceptos y totales
   - PDF con texto: reconstruye renglones (pdf.js vía unpdf) y busca etiquetas comunes
   - Empata el cliente por RFC → correo → nombre
   - Guarda el archivo original (kv doc:<id>) para descargarlo desde el proyecto          */
'use strict';
const crypto = require('crypto');

const RFC_RE = /\b([A-ZÑ&]{3,4})[ -]?(\d{6})[ -]?([A-Z0-9]{3})\b/g;
const RFC_GEN = ['XAXX010101000', 'XEXX010101000'];
const UUID_RE = /\b[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\b/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const MONEY = '\\$?\\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\\.[0-9]{2})|[0-9]+\\.[0-9]{2})(?!\\s*%|\\d)';
const MESES = { ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, may: 5, mayo: 5, jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8, sep: 9, sept: 9, septiembre: 9, oct: 10, octubre: 10, nov: 11, noviembre: 11, dic: 12, diciembre: 12 };
const REGIMENES = ['601', '603', '605', '606', '607', '608', '610', '611', '612', '614', '615', '616', '620', '621', '622', '623', '624', '625', '626'];
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').replace(/\b(s ?a|de|c ?v|s ?de ?r ?l|sapi|sas|sc|ac)\b/g, ' ').replace(/\s+/g, ' ').trim();
const num = s => { const n = parseFloat(String(s || '').replace(/[$,\s]/g, '')); return isFinite(n) ? Math.round(n * 100) / 100 : null; };
const pad = n => String(n).padStart(2, '0');

module.exports = function createImporter(store, getDb) {
  const OWN_RFC = String(process.env.TRIDI_RFC || '').toUpperCase().trim();
  const OWN_MAIL = String(process.env.MAIL_USER || 'contacto@tridimx.tech').toLowerCase();
  const OWN_TELS = ['5573352169', '5575966111', ...String(process.env.TRIDI_TEL || '').split(/[,;]/)].map(t => t.replace(/\D/g, '').slice(-10)).filter(Boolean);

  /* ---------- PDF → renglones ---------- */
  async function pdfLines(buf) {
    const { getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const lines = [];
    for (let p = 1; p <= Math.min(pdf.numPages, 8); p++) {
      const page = await pdf.getPage(p), tc = await page.getTextContent();
      const rows = [];
      tc.items.filter(i => i.str && i.str.trim()).forEach(i => {
        const x = i.transform[4], y = i.transform[5];
        let r = rows.find(r => Math.abs(r.y - y) < 2.5);
        if (!r) { r = { y, parts: [] }; rows.push(r); }
        r.parts.push({ x, s: i.str, w: i.width || 0 });
      });
      rows.sort((a, b) => b.y - a.y).forEach(r => {
        r.parts.sort((a, b) => a.x - b.x);
        let out = '', end = null;
        r.parts.forEach(pt => { if (end !== null && pt.x - end > 6) out += '   '; else if (end !== null && pt.x - end > 1.2) out += ' '; out += pt.s; end = pt.x + pt.w; });
        // texto con espaciado entre letras: "P R O P U E S T A" → "PROPUESTA"
        out = out.replace(/\b(?:[A-ZÁÉÍÓÚÑ0-9] ){2,}[A-ZÁÉÍÓÚÑ0-9]\b/g, m => m.replace(/ /g, '')).replace(/\s+$/, '');
        if (out.trim()) lines.push(out);
      });
    }
    return lines;
  }

  /* ---------- CFDI XML ---------- */
  function attrs(tag) { const o = {}; tag.replace(/([\w:]+)="([^"]*)"/g, (_, k, v) => { o[k.replace(/^.*:/, '')] = v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'"); }); return o; }
  function parseXml(xml) {
    const tag = n => { const m = new RegExp(`<(?:\\w+:)?${n}\\b[^>]*>`, 'i').exec(xml); return m ? attrs(m[0]) : null; };
    const comp = tag('Comprobante');
    if (!comp) throw Object.assign(new Error('El XML no es un CFDI'), { code: 400 });
    const em = tag('Emisor') || {}, re = tag('Receptor') || {}, tfd = tag('TimbreFiscalDigital') || {};
    const conceptos = [...xml.matchAll(/<(?:\w+:)?Concepto\b[^>]*>/gi)].map(m => attrs(m[0])).map(c => ({ descripcion: c.Descripcion || '', cantidad: num(c.Cantidad), unidad: c.Unidad || c.ClaveUnidad || '', precio: num(c.ValorUnitario), importe: num(c.Importe) }));
    const ivaTras = [...xml.matchAll(/<(?:\w+:)?Impuestos\b[^>]*TotalImpuestosTrasladados="([\d.]+)"/gi)].map(m => +m[1]);
    const retIsr = [...xml.matchAll(/<(?:\w+:)?Retencion\b[^>]*Impuesto="001"[^>]*Importe="([\d.]+)"/gi)].map(m => +m[1]);
    let cli = re, rol = 'receptor';
    if (OWN_RFC && re.Rfc === OWN_RFC && em.Rfc !== OWN_RFC) { cli = em; rol = 'emisor'; }
    return {
      fuente: 'xml', tipo: comp.TipoDeComprobante === 'P' ? 'complemento de pago' : rol === 'emisor' ? 'factura recibida' : 'factura',
      cliente: { nombre: cli.Nombre || '', razonSocial: cli.Nombre || '', rfc: (cli.Rfc || '').toUpperCase(), regimen: cli.RegimenFiscalReceptor || cli.RegimenFiscal || '', cp: cli.DomicilioFiscalReceptor || '', email: '', telefono: '', usoCfdi: re.UsoCFDI || '' },
      doc: { folio: [comp.Serie, comp.Folio].filter(Boolean).join('-'), uuid: (tfd.UUID || '').toUpperCase(), fecha: (comp.Fecha || '').slice(0, 10), moneda: comp.Moneda || 'MXN', subtotal: num(comp.SubTotal), iva: ivaTras.length ? num(ivaTras[ivaTras.length - 1]) : null, retIsr: retIsr.length ? num(retIsr[retIsr.length - 1]) : null, total: num(comp.Total), metodoPago: comp.MetodoPago || '', formaPago: comp.FormaPago || '', emisorRfc: em.Rfc || '', emisorNombre: em.Nombre || '' },
      proyecto: { nombre: '', obra: '', direccion: '' },
      conceptos
    };
  }

  /* ---------- Heurística sobre texto de PDF ---------- */
  function parseText(lines) {
    const text = lines.join('\n'), up = text.toUpperCase();
    /* valor junto a una etiqueta; si la etiqueta es encabezado de columna, toma la misma columna del renglón siguiente */
    const after = (re, { next = true, max = 120 } = {}) => {
      for (let i = 0; i < lines.length; i++) {
        const cols = lines[i].split(/ {3,}/);
        const ci = cols.findIndex(c => re.test(c));
        if (ci < 0) continue;
        const m = re.exec(cols[ci]);
        let v = cols[ci].slice(m.index + m[0].length).replace(/^[\s:.\-–]+/, '').trim();
        if (!v && next && lines[i + 1]) {
          const nc = lines[i + 1].split(/ {3,}/);
          v = (cols.length > 1 && nc.length === cols.length ? nc[ci] : nc[0] || '').trim();
        }
        if (v) return v.slice(0, max);
      }
      return '';
    };
    const isFactura = UUID_RE.test(text) || /folio fiscal|cfdi|comprobante fiscal|timbre fiscal/i.test(text);
    const isPres = /propuesta comercial|presupuesto|cotizaci[oó]n/i.test(text);
    // RFCs: separa el del emisor (etiqueta «Emisor» o el propio de TRIDI) del cliente
    const rfcs = []; let m; RFC_RE.lastIndex = 0;
    while ((m = RFC_RE.exec(up))) { const r = m[1] + m[2] + m[3]; if (!rfcs.includes(r)) rfcs.push(r); }
    const rfcIn = re => { for (const l of lines.filter(x => re.test(x))) { RFC_RE.lastIndex = 0; const mm = RFC_RE.exec(l.toUpperCase()); if (mm) return mm[1] + mm[2] + mm[3]; } return ''; };
    const emisorRfc = rfcIn(/emisor/i);
    let rfc = rfcIn(/receptor|cliente/i);
    if (!rfc) rfc = rfcs.find(r => r !== OWN_RFC && r !== emisorRfc && !(isFactura && rfcs.indexOf(r) === 0 && rfcs.length > 1 && !OWN_RFC)) || (rfcs.length === 1 && !isFactura ? rfcs[0] : '');
    if (rfc === OWN_RFC) rfc = '';
    let nombre = after(/(?:nombre|raz[oó]n social)(?: del)? receptor|receptor:|^\s*cliente\b|\bcliente:|atenci[oó]n(?: a)?:/i);
    nombre = nombre.replace(/\s*(?:·|\||RFC).*$/i, '').replace(RFC_RE, '').trim();
    if (/^(rfc|uso|r[eé]gimen|domicilio|moneda|fecha)\b/i.test(nombre)) nombre = '';
    if (!nombre && rfc) { const l = lines.find(x => x.toUpperCase().replace(/[ -]/g, '').includes(rfc)); if (l) { const pre = l.split(/\bRFC\b/i)[0].replace(/[·|:\-\s]+$/, '').trim(); if (pre.length > 2 && !/receptor|emisor|cliente/i.test(pre)) nombre = pre.split(/ {3,}/).pop(); } }
    const emails = (text.match(EMAIL_RE) || []).map(e => e.toLowerCase()).filter(e => e !== OWN_MAIL && !/tridimx\.tech$/.test(e));
    const tel = ([...text.matchAll(/(?:tel(?:[eé]fono)?|cel(?:ular)?|whats(?:app)?)\.?\s*:?\s*((?:\+?52\s*)?(?:\(?\d{2,3}\)?[\s.-]*)\d{3,4}[\s.-]*\d{4})/gi)].map(x => x[1]).find(t => !OWN_TELS.includes(t.replace(/\D/g, '').slice(-10))) || '');
    const cpLine = lines.find(l => /domicilio fiscal(?: del)? receptor|c[oó]digo postal(?: del)? receptor/i.test(l));
    const cp = ((cpLine && /\b(\d{5})\b/.exec(cpLine)) || /(?:C\.?\s?P\.?|c[oó]digo postal)\s*:?\s*(\d{5})\b/i.exec(text) || [])[1] || '';
    const regLine = lines.find(l => /r[eé]gimen fiscal(?: del)? receptor/i.test(l)) || (isFactura ? '' : lines.find(l => /r[eé]gimen fiscal/i.test(l)));
    const regimen = ((regLine && new RegExp(`\\b(${REGIMENES.join('|')})\\b`).exec(regLine)) || [])[1] || '';
    const uso = (/uso (?:de(?:l)? )?cfdi\s*:?\s*([GDIPS]\d{2}|CP01|CN01)/i.exec(text) || [])[1] || '';
    // documento
    const uuid = ((UUID_RE.exec(text) || [])[0] || '').toUpperCase();
    let folio = after(/\bfolio(?! fiscal)\b\s*(?:interno)?\s*:?/i, { next: true, max: 60 }).split(/\s{2,}| /)[0];
    if (!folio) { const fm = /\b([A-Z]{2,4}-\d{6}-[A-Z]{2,4}-\d{3}(?:-Rev\.\d+)?)\b/i.exec(text); if (fm) folio = fm[1]; }
    if (UUID_RE.test(folio)) folio = '';
    const fecha = (() => {
      const l = lines.find(x => /fecha(?: de)?(?: emisi[oó]n| expedici[oó]n)?\s*:?/i.test(x) && !/vigencia|vence|timbrado|certificaci/i.test(x)) || text;
      let d = /(\d{4})-(\d{2})-(\d{2})/.exec(l); if (d) return `${d[1]}-${d[2]}-${d[3]}`;
      d = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/.exec(l); if (d) return `${d[3]}-${pad(d[2])}-${pad(d[1])}`;
      d = /\b(\d{1,2})\s+(?:de\s+)?([a-záéíóú]{3,10})\.?\s+(?:de\s+)?(\d{4})\b/i.exec(l); if (d && MESES[d[2].toLowerCase()]) return `${d[3]}-${pad(MESES[d[2].toLowerCase()])}-${pad(d[1])}`;
      return '';
    })();
    const amount = re => { const all = [...text.matchAll(new RegExp(re.source + '[^\\n\\d$-]{0,40}' + MONEY, 'gi'))]; return all.length ? num(all[all.length - 1][1]) : null; };
    const subtotal = amount(/sub\s?-?total/);
    const iva = amount(/\bI\.?V\.?A\.?\b(?:\s*\(?\s*16\s*%\)?)?(?:\s*traslad\w*)?/);
    const retIsr = amount(/retenci[oó]n\s*(?:de\s*)?I\.?S\.?R\.?[^\n]{0,40}?/);
    const total = amount(/\btotal(?:\s+del\s+presupuesto)?(?!\s*impuestos)/);
    const moneda = /\bUSD\b|d[oó]lares/i.test(text) && !/\bMXN\b|pesos/i.test(text) ? 'USD' : 'MXN';
    const metodo = (/\b(PUE|PPD)\b/.exec(up) || [])[1] || '';
    const proyecto = after(/\b(?:proyecto|obra|asunto|referencia)\b\s*:?/i, { max: 90 }).replace(/^(?:fecha|moneda|cliente)\b.*$/i, '');
    const direccion = after(/\b(?:lugar(?: de entrega)?|direcci[oó]n(?: de entrega| del proyecto)?|domicilio de entrega)\b\s*:?/i, { max: 140 });
    // conceptos: renglones con importe al final entre el encabezado de la tabla y el subtotal
    const hi = lines.findIndex(l => /(concepto|descripci[oó]n)/i.test(l) && /(importe|precio|p\.\s*unit|cant)/i.test(l));
    const lo = lines.findIndex((l, i) => i > hi && /sub\s?-?total/i.test(l));
    const conceptos = [];
    if (hi >= 0) {
      for (let i = hi + 1; i < (lo > 0 ? lo : Math.min(lines.length, hi + 40)); i++) {
        const l = lines[i], am = [...l.matchAll(/\$?\s*([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})/g)];
        if (am.length >= 1) {
          const desc = l.slice(0, am[0].index).replace(/^\s*\d{1,4}(?:\.\d+)?\s+/, '').replace(/\b(PZA|PZ|PIEZA|SERVICIO|LOTE|H87|E48|ACT|KIT|JUEGO|HORA)\b/gi, ' ').replace(/\s+\d+(?:\.\d+)?\s*$/, '').replace(/\s{2,}/g, ' ').trim();
          if (desc.length > 2) conceptos.push({ descripcion: desc, importe: num(am[am.length - 1][1]) });
          else if (conceptos.length) conceptos[conceptos.length - 1].importe = num(am[am.length - 1][1]);
        } else if (conceptos.length && l.trim().length > 3 && !/^(notas|página|pagina)/i.test(l.trim())) {
          const c = conceptos[conceptos.length - 1]; if (c.descripcion.length < 400) c.descripcion += ' ' + l.trim().split(/ {3,}/)[0];
        } else if (!conceptos.length && l.trim().length > 6) conceptos.push({ descripcion: l.trim().split(/ {3,}/)[0], importe: null });
      }
    }
    return {
      fuente: 'pdf', tipo: isFactura ? 'factura' : isPres ? 'presupuesto' : 'documento',
      cliente: { nombre, razonSocial: isFactura ? nombre : '', rfc, regimen, cp, email: emails[0] || '', telefono: tel.trim(), usoCfdi: uso },
      doc: { folio, uuid, fecha, moneda, subtotal, iva, retIsr, total, metodoPago: metodo, formaPago: '', emisorRfc, emisorNombre: '' },
      proyecto: { nombre: proyecto, obra: '', direccion },
      conceptos: conceptos.slice(0, 30)
    };
  }

  /* ---------- Empate con clientes existentes ---------- */
  function matchClient(c) {
    const clientes = getDb().clientes || [];
    if (c.rfc && !RFC_GEN.includes(c.rfc)) { const x = clientes.find(k => (k.rfc || '').toUpperCase() === c.rfc); if (x) return { id: x.id, nombre: x.nombre, por: 'RFC' }; }
    if (c.email) { const x = clientes.find(k => String(k.email || '').toLowerCase().split(/[,;\s]+/).includes(c.email)); if (x) return { id: x.id, nombre: x.nombre, por: 'correo' }; }
    const n = norm(c.razonSocial || c.nombre);
    if (n.length >= 4) {
      const x = clientes.find(k => norm(k.nombre) === n || norm(k.razonSocial) === n) || clientes.find(k => { const a = norm(k.nombre), b = norm(k.razonSocial); return (a.length >= 5 && (n.includes(a) || a.includes(n))) || (b.length >= 5 && (n.includes(b) || b.includes(n))); });
      if (x) return { id: x.id, nombre: x.nombre, por: 'nombre' };
    }
    return null;
  }
  const LABELS = { nombre: 'Nombre del cliente', rfc: 'RFC', razonSocial: 'Razón social', regimen: 'Régimen fiscal', cp: 'C.P. fiscal', email: 'Correo', telefono: 'Teléfono' };
  const PLABELS = { nombre: 'Nombre del proyecto', fecha: 'Fecha del documento', total: 'Monto total', direccion: 'Dirección / lugar' };

  async function analyze(buf, filename) {
    const isXml = /\.xml$/i.test(filename) || /^\s*(<\?xml|<cfdi:)/.test(buf.slice(0, 200).toString('utf8'));
    let r;
    if (isXml) r = parseXml(buf.toString('utf8'));
    else {
      if (buf.slice(0, 5).toString() !== '%PDF-') throw Object.assign(new Error('El archivo no es un PDF ni un XML'), { code: 400 });
      const lines = await pdfLines(buf);
      if (lines.join('').replace(/\s/g, '').length < 40) throw Object.assign(new Error('El PDF no tiene texto (parece escaneado). Sube el PDF original o el XML de la factura.'), { code: 422 });
      r = parseText(lines);
    }
    if (!r.proyecto.nombre) r.proyecto.nombre = r.conceptos[0] ? r.conceptos[0].descripcion.split(/[.,;]/)[0].slice(0, 70) : '';
    r.match = matchClient(r.cliente);
    r.faltanCliente = Object.keys(LABELS).filter(k => !r.cliente[k]).map(k => LABELS[k]);
    r.faltanProyecto = [!r.proyecto.nombre && PLABELS.nombre, !r.doc.fecha && PLABELS.fecha, r.doc.total == null && PLABELS.total, !r.proyecto.direccion && PLABELS.direccion].filter(Boolean);
    // archivo original
    const id = crypto.randomBytes(9).toString('hex');
    store.put('doc:' + id, { nombre: String(filename || 'documento').slice(0, 140), mime: isXml ? 'application/xml' : 'application/pdf', data: buf.toString('base64'), at: new Date().toISOString() });
    r.docId = id; r.archivo = filename;
    return r;
  }

  async function handle(req, res, p, method, me, h) {
    if (p === '/api/import/doc' && method === 'POST') {
      if (!h.can(me, 'proyectos')) { h.send(req, res, 403, { error: 'Sin permiso para Proyectos' }); return true; }
      const b = (await h.readBody(req, 16 * 1024 * 1024)) || {};
      const buf = Buffer.from(String(b.data || ''), 'base64');
      if (!buf.length) { h.send(req, res, 400, { error: 'Archivo vacío' }); return true; }
      if (buf.length > 10 * 1024 * 1024) { h.send(req, res, 413, { error: 'El archivo no debe pasar de 10 MB' }); return true; }
      try { h.send(req, res, 200, await analyze(buf, String(b.filename || ''))); }
      catch (e) { h.send(req, res, e.code || 500, { error: e.code ? e.message : 'No se pudo leer el documento: ' + e.message }); }
      return true;
    }
    const m = /^\/api\/docs\/([a-f0-9]{18})$/.exec(p);
    if (m && method === 'GET') {
      if (!h.can(me, 'proyectos')) { h.send(req, res, 403, { error: 'Sin permiso' }); return true; }
      const d = store.get('doc:' + m[1], null);
      if (!d) { h.send(req, res, 404, { error: 'Documento no encontrado' }); return true; }
      const buf = Buffer.from(d.data, 'base64');
      res.writeHead(200, h.headers(req, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(d.nombre)}`, 'Content-Length': buf.length, 'Cache-Control': 'private, no-store' }));
      res.end(buf); return true;
    }
    return false;
  }
  return { handle, analyze, parseText, parseXml };
};
