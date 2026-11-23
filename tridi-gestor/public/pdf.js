/* PDFs TRIDI MX
   buildReportPDF(data, libs)  → Reporte de visita
   buildBudgetPDF(data, libs)  → Propuesta comercial TRIDI MX
   libs: { jsPDF, autoTable?, logos, fonts }                                       */
(function (root) {
  'use strict';

  var C = {
    ink: [31, 35, 41], body: [58, 64, 73], muted: [128, 135, 146], faint: [176, 182, 191],
    hair: [227, 230, 235], soft: [246, 247, 249], red: [242, 101, 34], white: [255, 255, 255], navy: [27, 45, 79], teal: [26, 143, 121], neg: [200, 40, 40],
    pill: {
      OK: { bg: [230, 244, 236], fg: [21, 115, 71] },
      FALLA: { bg: [253, 231, 234], fg: [192, 21, 48] },
      'OBSERVACIÓN': { bg: [255, 243, 220], fg: [168, 98, 0] },
      PENDIENTE: { bg: [255, 243, 220], fg: [168, 98, 0] },
      'N/A': { bg: [238, 240, 243], fg: [107, 114, 128] }
    }
  };
  var MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function fmt(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : (iso || ''); }
  function fmtLong(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? (+m[3]) + ' de ' + MES[+m[2] - 1] + ' de ' + m[1] : (iso || ''); }
  function money(n) { n = Math.round((+n || 0) * 100) / 100; var p = n.toFixed(2).split('.'); return p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + p[1]; }

  /* ---- Número a letras (español) ---- */
  var U = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
  var D = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  var CE = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
  function menorMil(n) {
    if (n === 0) return '';
    if (n === 100) return 'CIEN';
    var c = Math.floor(n / 100), r = n % 100, out = CE[c];
    if (r) {
      var t = r < 30 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? ' Y ' + U[r % 10] : '');
      out = (out ? out + ' ' : '') + t;
    }
    return out;
  }
  function enteroLetras(n) {
    if (n === 0) return 'CERO';
    var mill = Math.floor(n / 1e6), mil = Math.floor((n % 1e6) / 1000), resto = n % 1000, parts = [];
    if (mill) parts.push(mill === 1 ? 'UN MILLÓN' : apocope(enteroLetras(mill)) + ' MILLONES');
    if (mil) parts.push(mil === 1 ? 'MIL' : apocope(menorMil(mil)) + ' MIL');
    if (resto) parts.push(menorMil(resto));
    return parts.join(' ');
  }
  function apocope(s) { return s.replace(/VEINTIUNO$/, 'VEINTIÚN').replace(/UNO$/, 'UN'); }
  function importeLetras(n, moneda) {
    n = Math.round((+n || 0) * 100) / 100;
    var ent = Math.floor(n), cent = Math.round((n - ent) * 100);
    var unidad = moneda === 'USD' ? (ent === 1 ? 'DÓLAR' : 'DÓLARES') + ' (USD)' : (ent === 1 ? 'PESO' : 'PESOS') + ' (MXN)';
    var letras = apocope(enteroLetras(ent));
    return '(* SON ' + letras + ', CON ' + (cent < 10 ? '0' : '') + cent + '/100 ' + unidad + ' *)';
  }

  /* ================= Núcleo compartido ================= */
  function setup(libs, meta) {
    var doc = new libs.jsPDF({ unit: 'mm', format: 'letter' });
    var logos = libs.logos || root.AGIS_LOGOS || {};
    var fonts = libs.fonts || root.AGIS_PDF_FONTS || null;
    var FAM = { r: ['helvetica', 'normal'], s: ['helvetica', 'bold'], b: ['helvetica', 'bold'] };
    if (fonts && fonts.regular) {
      try {
        doc.addFileToVFS('Manrope-Regular.ttf', fonts.regular); doc.addFont('Manrope-Regular.ttf', 'Manrope', 'normal');
        doc.addFileToVFS('Manrope-SemiBold.ttf', fonts.semibold); doc.addFont('Manrope-SemiBold.ttf', 'ManropeSB', 'normal');
        doc.addFileToVFS('Manrope-ExtraBold.ttf', fonts.extrabold); doc.addFont('Manrope-ExtraBold.ttf', 'ManropeXB', 'normal');
        FAM = { r: ['Manrope', 'normal'], s: ['ManropeSB', 'normal'], b: ['ManropeXB', 'normal'] };
      } catch (e) {}
    }
    var K = {
      doc: doc, FAM: FAM, C: C, W: 215.9, H: 279.4, L: 18, y: 0, secN: 0,
      table: function (o) { return libs.autoTable ? libs.autoTable(doc, o) : doc.autoTable(o); }
    };
    K.R = K.W - 18; K.CW = K.R - K.L; K.TOP_NEXT = 36; K.BOTTOM = K.H - 26;
    K.F = function (w, size, color) { doc.setFont(FAM[w][0], FAM[w][1]); doc.setFontSize(size); var c = color || C.ink; doc.setTextColor(c[0], c[1], c[2]); };
    K.fill = function (c) { doc.setFillColor(c[0], c[1], c[2]); };
    K.draw = function (c) { doc.setDrawColor(c[0], c[1], c[2]); };
    K.hair = function (x1, yy, x2, c, lw) { K.draw(c || C.hair); doc.setLineWidth(lw || 0.25); doc.line(x1, yy, x2, yy); };
    K.caps = function (t) { return String(t || '').toUpperCase(); };
    K.header = function () {
      if (logos.wordmark) { var lw = 44; try { lw = 40; doc.addImage(logos.wordmark, 'PNG', K.L, 11.5, lw, lw / (logos.wordmarkRatio || 5.94), 'wordmark', 'FAST'); } catch (e) {} }
      else { K.F('r', 18); doc.text('arquitechtura', K.L, 20); }
      K.F('s', 7, C.red); doc.text(K.caps(meta.kind), K.R, 15.6, { align: 'right', charSpace: 0.55 });
      var fs = 12.5; K.F('b', fs);
      while (fs > 8 && doc.getTextWidth(meta.folio || 'Sin folio') > 100) { fs -= 0.5; K.F('b', fs); }
      doc.text(meta.folio || 'Sin folio', K.R, 22.2, { align: 'right' });
      K.hair(K.L, 27.5, K.R, C.hair, 0.3);
    };
    K.footer = function (p, n) {
      var fy = K.H - 15.5, x = K.L;
      K.hair(K.L, fy - 4.5, K.R);
      if (logos.mark) { try { doc.addImage(logos.mark, 'PNG', K.L, fy - 3, 7, 7, 'mark', 'FAST'); x = K.L + 9; } catch (e) {} }
      K.F('s', 7); doc.text(meta.empresa || 'TRIDI MX', x, fy, { charSpace: 0.3 });
      K.F('r', 6.6, C.muted); doc.text(meta.pie || 'Impresión 3D · Grabado Láser · Artículos Promocionales', x, fy + 3.4);
      K.F('r', 6.8, C.muted); doc.text('Página ' + p + ' de ' + n, K.R, fy, { align: 'right' });
      if (meta.folio) { K.F('r', 6.6, C.faint); doc.text(meta.folio, K.R, fy + 3.4, { align: 'right' }); }
    };
    K.newPage = function () { doc.addPage(); K.header(); K.y = K.TOP_NEXT; };
    K.ensure = function (h) { if (K.y + h > K.BOTTOM) K.newPage(); };
    K.section = function (name, need) {
      K.ensure((need || 0) + 14);
      K.secN++;
      var num = (K.secN < 10 ? '0' : '') + K.secN;
      K.F('b', 8.6, C.red); doc.text(num, K.L, K.y);
      K.F('s', 8.6); doc.text(K.caps(name), K.L + 7.5, K.y, { charSpace: 0.7 });
      var tw = doc.getTextWidth(K.caps(name)) + K.caps(name).length * 0.7;
      K.hair(Math.min(K.R, K.L + 7.5 + tw + 4), K.y - 1.2, K.R);
      K.y += 7;
    };
    K.lines = function (text, w, size, lh, color, weight, x) {
      K.F(weight || 'r', size, color || C.body);
      doc.splitTextToSize(String(text || ''), w).forEach(function (ln) { K.ensure(lh); doc.text(ln, x == null ? K.L : x, K.y); K.y += lh; });
    };
    /* Título grande con etiqueta */
    K.titleBlock = function (label, title, sub) {
      K.y = 40;
      K.F('s', 7, C.muted); doc.text(label, K.L, K.y, { charSpace: 0.6 }); K.y += 6.2;
      K.F('b', 17);
      doc.splitTextToSize(title || '—', K.CW).forEach(function (ln) { doc.text(ln, K.L, K.y); K.y += 7.4; });
      if (sub) { K.y -= 1.2; K.F('s', 10.5, C.body); doc.text(sub, K.L, K.y); K.y += 4; }
      K.y += 5;
    };
    /* Banda gris de datos: rows = [[{l,v},{l,v},{l,v}], [{l,v,full:true}]] */
    K.metaBand = function (rows) {
      var pad = 6, cw3 = (K.CW - pad * 2) / 3, heights = [];
      rows.forEach(function (row) {
        K.F('r', 9);
        var h = Math.max.apply(null, row.map(function (c) { return doc.splitTextToSize(c.v || '—', c.full ? K.CW - pad * 2 : cw3 - 4).length; })) * 4.4;
        heights.push(h);
      });
      var bandH = pad + rows.reduce(function (a, r, i) { return a + 4.6 + heights[i]; }, 0) + (rows.length - 1) * 6 + pad - 2.5;
      K.fill(C.soft); doc.roundedRect(K.L, K.y, K.CW, bandH, 2.5, 2.5, 'F');
      var by = K.y + pad + 1;
      rows.forEach(function (row, ri) {
        row.forEach(function (c, i) {
          var x = K.L + pad + i * cw3;
          K.F('s', 6.4, C.muted); doc.text(c.l, x, by, { charSpace: 0.5 });
          K.F('r', 9); doc.text(doc.splitTextToSize(c.v || '—', c.full ? K.CW - pad * 2 : cw3 - 4), x, by + 4.6);
        });
        by += 4.6 + heights[ri];
        if (ri < rows.length - 1) { K.hair(K.L + pad, by + 0.3, K.R - pad, [232, 234, 238]); by += 6; }
      });
      K.y += bandH + 11;
    };
    K.finish = function () { var n = doc.getNumberOfPages(); for (var p = 1; p <= n; p++) { doc.setPage(p); K.footer(p, n); } return doc; };
    return K;
  }

  /* ================= Reporte de visita ================= */
  function buildReportPDF(d, libs) {
    var K = setup(libs, { kind: d.tipo || 'Reporte de Visita Técnica', folio: d.folio });
    var doc = K.doc, F = K.F, L = K.L, R = K.R, CW = K.CW;
    K.header();
    K.titleBlock('ASUNTO', d.asunto, d.codigo);
    K.metaBand([
      [{ l: 'FECHA', v: fmtLong(d.fecha) }, { l: 'PREPARADO POR', v: d.preparado }, { l: 'DISTRIBUCIÓN', v: d.distribucion }],
      [{ l: 'PARTICIPANTES', v: d.participantes, full: true }]
    ]);

    K.section('Descripción de la falla', 10);
    K.lines(d.descripcion || '—', CW, 9.6, 5, C.body);
    K.y += 8;

    K.section('Diagnóstico por componente', 24);
    var comps = (d.componentes || []).map(function (c) { return [c.sistema || '', K.caps(c.estado), c.observacion || '']; });
    if (!comps.length) comps = [['—', '', '']];
    var fR = K.FAM.r, fS = K.FAM.s;
    K.table({
      startY: K.y, theme: 'plain', margin: { left: L, right: K.W - R, top: K.TOP_NEXT + 2, bottom: K.H - K.BOTTOM },
      head: [['SISTEMA / COMPONENTE', 'ESTADO', 'OBSERVACIÓN / HALLAZGO']], body: comps,
      styles: { font: fR[0], fontStyle: fR[1], fontSize: 8.8, textColor: C.body, cellPadding: { top: 3.4, bottom: 3.4, left: 2, right: 3 }, valign: 'middle', lineWidth: 0 },
      headStyles: { font: fS[0], fontStyle: fS[1], fontSize: 6.4, textColor: C.muted, cellPadding: { top: 1, bottom: 2.6, left: 2, right: 3 } },
      columnStyles: { 0: { cellWidth: 50, font: fS[0], fontStyle: fS[1], textColor: C.ink }, 1: { cellWidth: 30 } },
      didParseCell: function (h) { if (h.section === 'body' && h.column.index === 1) { h.cell._estado = String(h.cell.raw || ''); h.cell.text = ['']; } },
      didDrawCell: function (h) {
        var c = h.cell;
        if (h.section === 'head') K.hair(c.x, c.y + c.height, c.x + c.width, C.ink, 0.35);
        if (h.section === 'body') {
          K.hair(c.x, c.y + c.height, c.x + c.width, C.hair, 0.25);
          if (h.column.index === 1 && c._estado) {
            var st = C.pill[c._estado] || C.pill['N/A'];
            F('s', 6.6, st.fg);
            var pw = doc.getTextWidth(c._estado) + c._estado.length * 0.25 + 6, ph = 5.2, px = c.x + 2, py = c.y + (c.height - ph) / 2;
            K.fill(st.bg); doc.roundedRect(px, py, pw, ph, 2.6, 2.6, 'F');
            doc.text(c._estado, px + 3, py + 3.55, { charSpace: 0.25 });
          }
        }
      },
      didDrawPage: function (h) { if (h.pageNumber > 1) K.header(); }
    });
    K.y = doc.lastAutoTable.finalY + 10;

    /* Evidencia fotográfica: una foto por componente marcado (o fotos antiguas) */
    var fotos = [];
    (d.componentes || []).forEach(function (c) { if (c.conFoto && c.foto && c.foto.src) fotos.push({ src: c.foto.src, w: c.foto.w, h: c.foto.h, comp: c.sistema, caption: c.fotoDesc }); });
    if (!fotos.length) (d.fotos || []).forEach(function (f) { if (f && f.src) fotos.push({ src: f.src, w: f.w, h: f.h, caption: f.caption }); });
    if (fotos.length) {
      var gapF = 6, cellW = fotos.length === 1 ? Math.min(118, CW) : (CW - gapF) / 2;
      var baseH = fotos.length === 1 ? 80 : 58, capH = 11;
      var avail = K.BOTTOM - K.y - 14 - capH - 2, firstH = (avail < baseH && avail >= 46) ? avail : baseH;
      K.section('Evidencia fotográfica', firstH + capH);
      for (var i = 0; i < fotos.length; i += 2) {
        var rowH = i === 0 ? firstH : baseH;
        if (i > 0) K.ensure(rowH + capH + 2);
        var top0 = K.y;
        for (var j = i; j < Math.min(i + 2, fotos.length); j++) {
          var f = fotos[j], cellX = fotos.length === 1 ? L : L + (j - i) * (cellW + gapF);
          K.fill(C.soft); doc.roundedRect(cellX, top0, cellW, rowH, 2.2, 2.2, 'F');
          var ratio = (f.w && f.h) ? f.w / f.h : 4 / 3, iw = cellW - 4, ih = iw / ratio;
          if (ih > rowH - 4) { ih = rowH - 4; iw = ih * ratio; }
          try { doc.addImage(f.src, /^data:image\/png/.test(f.src) ? 'PNG' : 'JPEG', cellX + (cellW - iw) / 2, top0 + (rowH - ih) / 2, iw, ih, undefined, 'MEDIUM'); } catch (e) {}
          var cy = top0 + rowH + 4.6, label = 'FOTO ' + (j + 1) + (f.comp ? '  ·  ' + K.caps(f.comp) : '');
          F('s', 6.6, C.red); var lab = doc.splitTextToSize(label, cellW)[0]; doc.text(lab, cellX, cy, { charSpace: 0.4 });
          if (f.caption) { F('r', 8, C.body); doc.text(doc.splitTextToSize(f.caption, cellW).slice(0, 1), cellX, cy + 4.2); }
        }
        K.y = top0 + rowH + capH + 3;
      }
      K.y += 2;
    }

    var bullets = (d.conclusiones || []).filter(function (s) { return s && s.trim(); });
    F('r', 9.4, C.body);
    var estH = 6 + bullets.reduce(function (a, b) { return a + doc.splitTextToSize(b, CW - 7).length * 4.9 + 2; }, 0);
    K.section('Conclusión y dictamen', Math.min(60, estH));
    K.lines(d.concIntro || 'Con base en las pruebas realizadas, se concluye lo siguiente:', CW, 9.4, 4.9, C.body);
    K.y += 2.2;
    bullets.forEach(function (b) {
      var ls = (F('r', 9.4), doc.splitTextToSize(b.trim(), CW - 7));
      K.ensure(5.9);
      K.fill(C.red); doc.circle(L + 1.6, K.y - 1.25, 0.75, 'F');
      ls.forEach(function (ln) { K.ensure(4.9); F('r', 9.4); doc.text(ln, L + 6, K.y); K.y += 4.9; });
      K.y += 1.8;
    });
    if (d.recomendacion && d.recomendacion.trim()) {
      F('r', 9.2);
      var rl = doc.splitTextToSize(d.recomendacion.trim(), CW - 16), rh = 6 + 4 + rl.length * 4.7 + 4;
      K.y += 3; K.ensure(rh + 2);
      K.fill(C.soft); doc.roundedRect(L, K.y, CW, rh, 2.2, 2.2, 'F');
      K.fill(C.red); doc.rect(L, K.y + 3, 1.1, rh - 6, 'F');
      F('s', 6.4, C.red); doc.text('RECOMENDACIÓN', L + 7, K.y + 6.2, { charSpace: 0.5 });
      F('r', 9.2); doc.text(rl, L + 7, K.y + 11.4);
      K.y += rh;
    }
    K.y += 9;

    F('r', 8.6, C.body);
    var nl = d.nota ? doc.splitTextToSize(d.nota, CW - 72) : [];
    K.section('Acciones y seguimiento', Math.max(14, nl.length * 4.4 + 6));
    var ay = K.y;
    F('s', 6.4, C.muted); doc.text('RESPONSABLE DEL SEGUIMIENTO', L, ay, { charSpace: 0.5 });
    F('s', 10); var resL = doc.splitTextToSize(d.responsable || '—', 62); doc.text(resL, L, ay + 5.2);
    if (nl.length) {
      K.draw(C.hair); doc.setLineWidth(0.25); doc.line(L + 66, ay - 2.5, L + 66, ay + Math.max(resL.length * 4.6 + 3, nl.length * 4.4) + 1);
      F('r', 8.6, C.body); doc.text(nl, L + 72, ay + 0.6);
    }
    K.y = ay + Math.max(resL.length * 4.6 + 5, nl.length * 4.4 + 2) + 8;

    K.section('Firmas de conformidad', 40);
    var gap = 16, bw = (CW - gap) / 2, top = K.y;
    function sig(x, label, img, name, cargo, fecha) {
      F('s', 6.4, C.muted); doc.text(label, x, top, { charSpace: 0.5 });
      if (img) { try { doc.addImage(img, 'PNG', x + (bw - 46) / 2, top + 2, 46, 17, undefined, 'FAST'); } catch (e) {} }
      var ly = top + 21;
      K.hair(x, ly, x + bw, C.ink, 0.3);
      F('s', 9.6); doc.text(name || ' ', x, ly + 5.4);
      F('r', 8.2, C.muted); doc.text(doc.splitTextToSize(cargo || 'Nombre y cargo', bw).slice(0, 2), x, ly + 9.8);
      F('r', 7.8, C.muted); doc.text('Fecha: ' + (fmt(fecha) || '____ / ____ / ________'), x, ly + 17.6);
    }
    sig(L, 'PRESTADOR DE SERVICIO', d.prestFirma, d.prestNombre, d.prestCargo, d.prestFecha);
    sig(L + bw + gap, 'RECIBE CONFORME', d.recFirma, d.recNombre, d.recCargo || 'Nombre y cargo del cliente', d.recFecha);
    K.y = top + 44;
    return K.finish();
  }

  /* ================= Presupuesto de obra ================= */
  /* Totales: subtotal + IVA − retención ISR RESICO (1.25 % solo si el cliente es persona moral) */
  function budgetTotals(b) {
    var subtotal = Math.round((b.partidas || []).reduce(function (a, p) { return a + Math.round((+p.cantidad || 0) * (+p.precio || 0) * 100) / 100; }, 0) * 100) / 100;
    var iva = Math.round(subtotal * (+b.iva || 0)) / 100;
    var retIsr = b.personaMoral ? Math.round(subtotal * 1.25) / 100 : 0;
    return { subtotal: subtotal, iva: iva, retIsr: retIsr, total: Math.round((subtotal + iva - retIsr) * 100) / 100 };
  }

  /* ================= Propuesta comercial TRIDI MX (diseño limpio) ================= */
  function buildBudgetPDF(b, libs) {
    var bank = b.banco || {};
    var K = setup(libs, { kind: 'Propuesta comercial', folio: b.folio, empresa: 'TRIDI MX', pie: 'Impresión 3D · Grabado Láser · Artículos Promocionales  ·  ' + (bank.correo || '') + '  ·  ' + (bank.tel || '') });
    var doc = K.doc, F = K.F, L = K.L, R = K.R, CW = K.CW;
    var cur = b.moneda === 'USD' ? 'USD' : 'MXN';
    var t = budgetTotals(b), parts = b.partidas || [];
    var hasFoto = parts.some(function (p) { return p.foto && p.foto.src; });
    K.header();
    K.titleBlock('PROPUESTA COMERCIAL', b.obra, b.clienteNombre + (b.clienteRfc ? '  ·  RFC ' + b.clienteRfc : ''));
    K.metaBand([
      [{ l: 'FECHA', v: fmtLong(b.fecha) }, { l: 'VIGENCIA HASTA', v: fmtLong(b.vigenciaHasta) }, { l: 'LUGAR', v: b.lugar }],
      [{ l: 'PROYECTO', v: b.obra }, { l: 'MONEDA', v: cur === 'USD' ? 'Dólares (USD)' : 'Pesos mexicanos (MXN)' }, { l: 'CLIENTE', v: b.clienteNombre }]
    ]);

    /* Conceptos */
    K.section('Conceptos', 30);
    var fR = K.FAM.r, fS = K.FAM.s;
    var body = parts.map(function (p, i) {
      var row = [String(i + 1).padStart(3, '0'), (p.concepto || '') + (p.nota ? '\n' + p.nota : ''), p.unidad || '', money(p.cantidad).replace(/\.00$/, ''), money(p.precio), money(Math.round((+p.cantidad || 0) * (+p.precio || 0) * 100) / 100)];
      if (hasFoto) row.push('');
      return row;
    });
    if (!body.length) body.push([{ content: 'Sin conceptos', colSpan: hasFoto ? 7 : 6 }]);
    var head = ['#', 'CONCEPTO', 'UNIDAD', 'CANT.', 'P. UNITARIO', 'IMPORTE']; if (hasFoto) head.push('REFERENCIA');
    var cs = { 0: { cellWidth: 12, font: fS[0], fontStyle: fS[1], textColor: C.ink }, 2: { cellWidth: 17 }, 3: { cellWidth: 14, halign: 'right' }, 4: { cellWidth: 23, halign: 'right' }, 5: { cellWidth: 25, halign: 'right', font: fS[0], fontStyle: fS[1], textColor: C.ink } };
    if (hasFoto) cs[6] = { cellWidth: 28 };
    K.table({
      startY: K.y, theme: 'plain', margin: { left: L, right: K.W - R, top: K.TOP_NEXT + 2, bottom: K.H - K.BOTTOM },
      head: [head], body: body,
      styles: { font: fR[0], fontStyle: fR[1], fontSize: 8.4, textColor: C.body, cellPadding: { top: 3, bottom: 3, left: 2, right: 2 }, valign: 'top', lineWidth: 0 },
      headStyles: { font: fS[0], fontStyle: fS[1], fontSize: 6.4, textColor: C.muted, cellPadding: { top: 1, bottom: 2.6, left: 2, right: 2 } },
      columnStyles: cs,
      didParseCell: function (h) {
        if (h.section === 'head' && h.column.index >= 3 && h.column.index <= 5) h.cell.styles.halign = 'right';
        if (h.section === 'body' && hasFoto && h.column.index === 6) { var p = parts[h.row.index]; if (p && p.foto && p.foto.src) h.cell.styles.minCellHeight = 21; }
      },
      didDrawCell: function (h) {
        var c = h.cell;
        if (h.section === 'head') { K.hair(c.x, c.y + c.height, c.x + c.width, C.ink, 0.35); return; }
        K.hair(c.x, c.y + c.height, c.x + c.width, C.hair, 0.25);
        if (hasFoto && h.column.index === 6) {
          var p = parts[h.row.index]; if (!p || !p.foto || !p.foto.src) return;
          var mw = c.width - 3, mh = 18, r = (p.foto.w || 4) / (p.foto.h || 3), iw = mw, ih = iw / r;
          if (ih > mh) { ih = mh; iw = ih * r; }
          try { doc.addImage(p.foto.src, 'JPEG', c.x + c.width - iw - 1.5, c.y + 1.8, iw, ih, undefined, 'FAST'); } catch (e) {}
        }
      },
      didDrawPage: function (h) { if (h.pageNumber > 1) K.header(); }
    });
    K.y = doc.lastAutoTable.finalY + 6;

    /* Totales */
    var rowsT = [['Subtotal', money(t.subtotal), C.body]];
    if (b.personaMoral) rowsT.push(['Retención ISR 1.25% (RESICO)', '-' + money(t.retIsr), C.neg]);
    rowsT.push(['IVA ' + (+b.iva || 0) + '%', money(t.iva), C.body]);
    K.ensure(rowsT.length * 5.6 + 30);
    var tx = R - 86;
    rowsT.forEach(function (r) {
      F('r', 8.8, C.body); doc.text(r[0], tx, K.y);
      F('s', 8.8, r[2] === C.neg ? C.neg : C.ink); doc.text(r[1], R, K.y, { align: 'right' });
      K.y += 5.6;
    });
    K.y += 1;
    K.fill(C.navy); doc.roundedRect(tx - 4, K.y - 4.6, R - tx + 4, 10, 2, 2, 'F');
    F('s', 7, C.white); doc.text('TOTAL DEL PRESUPUESTO', tx, K.y + 1.6, { charSpace: 0.5 });
    F('b', 11.5, C.white); doc.text('$' + money(t.total) + ' ' + cur, R - 3, K.y + 1.9, { align: 'right' });
    K.y += 11;
    F('s', 7.8, C.muted); doc.text(doc.splitTextToSize(importeLetras(t.total, cur), CW), R, K.y, { align: 'right' });
    K.y += 12;

    /* Notas y condiciones */
    var notas = (b.observaciones || []).filter(function (s) { return s && s.trim(); });
    notas = notas.concat(['Para personas morales favor de considerar la retención del 1.25% de ISR para RESICO.']);
    F('r', 8.6);
    K.section('Notas y condiciones', Math.min(50, notas.reduce(function (a, o) { return a + doc.splitTextToSize(o, CW - 7).length * 4.4 + 1.6; }, 0)));
    notas.forEach(function (o, i) {
      var last = i === notas.length - 1;
      F(last ? 's' : 'r', 8.6, last ? C.ink : C.body);
      var ls = doc.splitTextToSize(o.trim(), CW - 7);
      K.ensure(5);
      K.fill(C.red); doc.circle(L + 1.6, K.y - 1.15, 0.65, 'F');
      ls.forEach(function (ln) { K.ensure(4.4); F(last ? 's' : 'r', 8.6, last ? C.ink : C.body); doc.text(ln, L + 6, K.y); K.y += 4.4; });
      K.y += 1.6;
    });
    K.y += 6;

    /* Datos bancarios */
    K.section('Datos bancarios', 34);
    var bh = 30, by = K.y;
    K.fill(C.soft); doc.roundedRect(L, by, CW, bh, 2.5, 2.5, 'F');
    var c3 = (CW - 12) / 3;
    [
      { l: 'BANCO Y TITULAR', v: [bank.banco || '', bank.titular || ''] },
      { l: 'MONEDA NACIONAL (MXN)', v: ['Cuenta: ' + (bank.mxnCuenta || ''), 'CLABE: ' + (bank.mxnClabe || '')] },
      { l: 'CONTACTO', v: [bank.correo || '', 'Tel. ' + (bank.tel || '')] }
    ].forEach(function (c, i) {
      var x = L + 6 + i * c3;
      F('s', 6.4, C.muted); doc.text(c.l, x, by + 7, { charSpace: 0.5 });
      F('r', 8.6, C.ink); c.v.forEach(function (ln, k) { doc.text(doc.splitTextToSize(ln, c3 - 4)[0] || '', x, by + 12 + k * 4.4); });
    });
    K.hair(L + 6, by + 22.2, R - 6, [232, 234, 238]);
    F('r', 7.8, C.body); doc.text('Precios en ' + (cur === 'USD' ? 'Dólares (USD)' : 'Pesos MXN') + ' · Favor de enviar comprobante de pago a ' + (bank.correo || ''), L + 6, by + 26.6);
    K.y = by + bh + 8;
    return K.finish();
  }

  /* ================= Reporte Fiscal (entradas / salidas) ================= */
  function buildFiscalPDF(R0, libs) {
    var K = setup(libs, { kind: 'Reporte fiscal', folio: R0.periodo, empresa: 'TRIDI MX', pie: 'Impresión 3D · Grabado Láser · Artículos Promocionales  ·  Estimados informativos; confirmar con el contador' });
    var doc = K.doc, F = K.F, L = K.L, R = K.R, CW = K.CW;
    var m$ = function (n) { return (n < 0 ? '-$' : '$') + money(Math.abs(n || 0)); };
    var TEAL = [26, 143, 121], TEAL_L = [143, 224, 205], ORA = [194, 65, 12], ORA_L = [248, 180, 141], GOOD = [21, 128, 61], BAD = [190, 30, 30];
    K.header();
    K.titleBlock('REPORTE FISCAL', R0.periodo, 'Generado el ' + fmtLong(R0.hoy) + ' por ' + (R0.usuario || ''));
    K.metaBand([[{ l: 'PERIODO', v: R0.periodo }, { l: 'FACTURACIÓN', v: R0.filtroFac }, { l: 'INCLUYE', v: R0.incluye }]]);

    /* KPIs */
    K.section('Resumen', 30);
    var kw = (CW - 8) / 3, ky = K.y;
    [['INGRESOS', R0.kpi.ti, GOOD, R0.kpi.si], ['EGRESOS', R0.kpi.te, BAD, R0.kpi.se], ['FLUJO NETO', R0.kpi.ut, R0.kpi.ut < 0 ? BAD : K.C.ink, R0.kpi.margen]].forEach(function (k, i) {
      var x = L + i * (kw + 4);
      K.fill(K.C.soft); doc.roundedRect(x, ky, kw, 25, 2, 2, 'F');
      F('s', 6.4, K.C.muted); doc.text(k[0], x + 4, ky + 6, { charSpace: 0.5 });
      F('b', 13, k[2]); doc.text(m$(k[1]), x + 4, ky + 14);
      F('r', 6.8, K.C.muted); doc.text(doc.splitTextToSize(k[3], kw - 8).slice(0, 2), x + 4, ky + 19);
    });
    K.y = ky + 33;

    /* Gráfica mensual */
    K.section('Flujo mensual ' + R0.anioGrafica, 72);
    var gy = K.y, gh = 52, gx = L + 12, gw = CW - 12, data = R0.mensual;
    var max = 1; data.forEach(function (d) { max = Math.max(max, d.iF + d.iN, d.eF + d.eN); });
    var base = gy + gh, sc = function (v) { return (gh - 4) * v / max; };
    [0, 0.5, 1].forEach(function (f) { var yy = base - sc(max * f); K.hair(gx, yy, R, [232, 234, 238], 0.2); F('r', 6, K.C.faint); doc.text(max * f >= 1000 ? Math.round(max * f / 1000) + 'k' : String(Math.round(max * f)), gx - 2, yy + 1.5, { align: 'right' }); });
    var cw = gw / 12, bw = cw * 0.3;
    data.forEach(function (d, i) {
      var x = gx + i * cw + cw * 0.17;
      if (d.sel) { K.fill([230, 248, 243]); doc.rect(gx + i * cw, gy - 2, cw, gh + 2, 'F'); }
      var stack = function (x0, a, b, cA, cB) { var ha = sc(a), hb = sc(b); if (ha > 0) { K.fill(cA); doc.rect(x0, base - ha, bw, ha, 'F'); } if (hb > 0) { K.fill(cB); doc.rect(x0, base - ha - hb, bw, hb, 'F'); } };
      stack(x, d.iF, d.iN, TEAL, TEAL_L); stack(x + bw + 0.8, d.eF, d.eN, ORA, ORA_L);
      F('r', 6.4, K.C.muted); doc.text(d.l, gx + i * cw + cw / 2, base + 4.5, { align: 'center' });
    });
    var ly = base + 10, lx = L;
    [[TEAL, 'Ingresos con factura'], [TEAL_L, 'Ingresos sin factura'], [ORA, 'Egresos con factura'], [ORA_L, 'Egresos sin factura']].forEach(function (it) { K.fill(it[0]); doc.rect(lx, ly - 2.4, 3, 3, 'F'); F('r', 6.8, K.C.body); doc.text(it[1], lx + 4.5, ly); lx += doc.getTextWidth(it[1]) + 12; });
    K.y = ly + 10;

    /* Impuestos estimados */
    var t = R0.tax;
    K.section('Estimado de impuestos (informativo)', 46);
    var col = (CW - 10) / 2, ty0 = K.y;
    var block = function (x, title, rows) {
      var y = ty0; F('s', 7, K.C.muted); doc.text(title, x, y, { charSpace: 0.5 }); y += 5.5;
      rows.forEach(function (r) {
        if (r.tot) { K.hair(x, y - 3.6, x + col, K.C.hair, 0.3); }
        F(r.tot ? 's' : 'r', 8.2, r.c || (r.tot ? K.C.ink : K.C.body)); doc.text(doc.splitTextToSize(r.l, col - 32)[0], x, y);
        F(r.tot ? 'b' : 's', 8.2, r.c || K.C.ink); doc.text(r.v, x + col, y, { align: 'right' }); y += 5.2;
      });
      return y;
    };
    var y1 = block(L, 'IVA', [{ l: 'Trasladado (ingresos facturados)', v: m$(t.ivaT) }].concat(t.ivaR ? [{ l: 'Retenido por clientes', v: '-' + m$(t.ivaR) }] : []).concat([{ l: 'Acreditable (gastos con factura)', v: '-' + m$(t.ivaA) }, { l: t.iva >= 0 ? 'IVA a pagar' : 'IVA a favor', v: m$(Math.abs(t.iva)), tot: 1 }]));
    var y2 = block(L + col + 10, 'ISR RESICO', [{ l: 'Ingresos facturados cobrados (sin IVA)', v: m$(t.baseF) }, { l: 'Tasa', v: t.tasaTxt }, { l: 'ISR retenido por personas morales', v: '-' + m$(t.ret) }, { l: 'ISR estimado (solo facturado)', v: m$(t.isrPagarF), tot: 1 }].concat(t.baseN > 0 ? [{ l: 'Sumando ingresos sin factura (' + m$(t.baseN) + ')', v: m$(t.isrPagarA), c: ORA }] : []));
    K.y = Math.max(y1, y2) + 2;
    F('r', 7, K.C.muted); var nt = doc.splitTextToSize('En RESICO el ISR se calcula sobre todos los ingresos cobrados del mes (tasas de 1% a 2.5%); las ventas sin factura se amparan con factura global a público en general. Cifras estimadas; confirmar con el contador antes de declarar.', CW);
    doc.text(nt, L, K.y); K.y += nt.length * 3.4 + 8;

    /* Categorías */
    var catBlock = function (title, rows, cA, cB) {
      K.section(title, 14 + Math.min(rows.length, 6) * 7);
      if (!rows.length) { F('r', 8, K.C.muted); doc.text('Sin movimientos en el periodo.', L, K.y); K.y += 8; return; }
      var tot = rows.reduce(function (a, r) { return a + r.f + r.n; }, 0) || 1;
      rows.forEach(function (r) {
        K.ensure(8);
        F('r', 8, K.C.body); doc.text(doc.splitTextToSize(r.k, CW - 40)[0], L, K.y);
        F('s', 8, K.C.ink); doc.text(m$(r.f + r.n), R, K.y, { align: 'right' });
        var by = K.y + 1.6; K.fill([242, 244, 247]); doc.rect(L, by, CW, 1.8, 'F');
        var wf = CW * r.f / tot, wn = CW * r.n / tot; if (wf > 0) { K.fill(cA); doc.rect(L, by, wf, 1.8, 'F'); } if (wn > 0) { K.fill(cB); doc.rect(L + wf, by, wn, 1.8, 'F'); }
        K.y += 7.2;
      });
      K.y += 4;
    };
    catBlock('Ingresos por categoría', R0.catI, TEAL, TEAL_L);
    catBlock('Egresos por categoría', R0.catE, ORA, ORA_L);

    /* Movimientos */
    if (R0.movs && R0.movs.length) {
      K.section('Movimientos (' + R0.movs.length + ')', 30);
      var fR = K.FAM.r, fS = K.FAM.s;
      K.table({
        startY: K.y, theme: 'plain', margin: { left: L, right: K.W - R, top: K.TOP_NEXT + 2, bottom: K.H - K.BOTTOM },
        head: [['FECHA', 'TIPO', 'CONCEPTO', 'CATEGORÍA', 'FACTURA', 'SUBTOTAL', 'IVA', 'TOTAL']],
        body: R0.movs.map(function (m) { return [fmt(m.fecha), m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso', (m.descripcion || '') + (m.contraparte ? '\n' + m.contraparte : ''), m.categoria || '', m.fac, money(m.subtotal), m.iva ? money(m.iva) : '—', (m.tipo === 'egreso' ? '-' : '') + money(m.total)]; }),
        styles: { font: fR[0], fontStyle: fR[1], fontSize: 7.2, textColor: K.C.body, cellPadding: { top: 2, bottom: 2, left: 1.5, right: 1.5 }, valign: 'top', lineWidth: 0 },
        headStyles: { font: fS[0], fontStyle: fS[1], fontSize: 6, textColor: K.C.muted },
        columnStyles: { 0: { cellWidth: 17 }, 1: { cellWidth: 14 }, 3: { cellWidth: 30 }, 4: { cellWidth: 19 }, 5: { cellWidth: 21, halign: 'right' }, 6: { cellWidth: 17, halign: 'right' }, 7: { cellWidth: 22, halign: 'right', font: fS[0], fontStyle: fS[1], textColor: K.C.ink } },
        didParseCell: function (h) { if (h.section === 'head' && h.column.index >= 5) h.cell.styles.halign = 'right'; if (h.section === 'body' && h.column.index === 7) h.cell.styles.textColor = R0.movs[h.row.index].tipo === 'egreso' ? BAD : GOOD; },
        didDrawCell: function (h) { var c = h.cell; K.hair(c.x, c.y + c.height, c.x + c.width, h.section === 'head' ? K.C.ink : K.C.hair, h.section === 'head' ? 0.35 : 0.2); },
        didDrawPage: function (h) { if (h.pageNumber > 1) K.header(); }
      });
      K.y = doc.lastAutoTable.finalY + 6;
    }
    return K.finish();
  }
  root.buildFiscalPDF = buildFiscalPDF;

  root.buildReportPDF = buildReportPDF;
  root.buildBudgetPDF = buildBudgetPDF;
  root.AGIS_budgetTotals = budgetTotals;
  root.AGIS_importeLetras = importeLetras;
  root.AGIS_money = money;
  if (typeof module !== 'undefined' && module.exports) module.exports = { buildReportPDF: buildReportPDF, buildFiscalPDF: buildFiscalPDF, buildBudgetPDF: buildBudgetPDF, budgetTotals: budgetTotals, importeLetras: importeLetras, money: money };
})(typeof window !== 'undefined' ? window : globalThis);
