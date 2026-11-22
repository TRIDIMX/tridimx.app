/* PDFs TRIDI MX
   buildReportPDF(data, libs)  → Reporte de visita
   buildBudgetPDF(data, libs)  → Propuesta comercial TRIDI MX
   libs: { jsPDF, autoTable?, logos, fonts }                                       */
(function (root) {
  'use strict';

  var C = {
    ink: [31, 35, 41], body: [58, 64, 73], muted: [128, 135, 146], faint: [176, 182, 191],
    hair: [227, 230, 235], soft: [246, 247, 249], red: [228, 25, 55], white: [255, 255, 255],
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
      if (logos.wordmark) { var lw = 44; try { doc.addImage(logos.wordmark, 'PNG', K.L, 13.2, lw, lw / (logos.wordmarkRatio || 5.94), 'wordmark', 'FAST'); } catch (e) {} }
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
      if (logos.mark) { try { doc.addImage(logos.mark, 'PNG', K.L, fy - 2.6, 6.2, 6.2, 'mark', 'FAST'); x = K.L + 8.4; } catch (e) {} }
      K.F('s', 7); doc.text('ARQUITECHTURA AGIS S.A. DE C.V.', x, fy, { charSpace: 0.3 });
      K.F('r', 6.6, C.muted); doc.text('Lago Estefanía 31, Granada, Miguel Hidalgo, 11520, CDMX  ·  55 5255 1687  ·  55 5545 5054', x, fy + 3.4);
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

  /* ================= Propuesta comercial TRIDI MX ================= */
  function buildBudgetPDF(b, libs) {
    var doc = new libs.jsPDF({ unit: 'mm', format: 'letter' });
    var logos = libs.logos || root.AGIS_LOGOS || {};
    var W = 215.9, H = 279.4, L = 8, R = W - 8, CW = R - L;
    var NAVY = [27, 45, 79], TEAL = [26, 143, 121], TEAL_L = [46, 196, 165], ORANGE = [242, 101, 34], INK = [25, 28, 33], MUTED = [110, 116, 126];
    var GRID = [200, 205, 212], ROW = [244, 245, 247], PEACH = [255, 236, 224], NEG = [214, 48, 49], WHITE = [255, 255, 255];
    var cur = b.moneda === 'USD' ? 'USD' : 'MXN';
    var t = budgetTotals(b), bank = b.banco || {};
    var F = function (style, size, c) { doc.setFont('helvetica', style); doc.setFontSize(size); c = c || INK; doc.setTextColor(c[0], c[1], c[2]); };
    var fill = function (c) { doc.setFillColor(c[0], c[1], c[2]); };
    var draw = function (c) { doc.setDrawColor(c[0], c[1], c[2]); };
    var BOTTOM = H - 18, y;

    function header() {
      var x = L + 10;
      if (logos.mark) { try { doc.addImage(logos.mark, 'PNG', x, 7.5, 15, 15, 'tmark', 'FAST'); x += 16; } catch (e) {} }
      if (logos.wordmark) { try { var lw = 34; doc.addImage(logos.wordmark, 'PNG', x, 15 - lw / (logos.wordmarkRatio || 4.08) / 2, lw, lw / (logos.wordmarkRatio || 4.08), 'twm', 'FAST'); } catch (e) {} }
      else { F('bold', 16, NAVY); doc.text('TRIDI MX', x, 17); }
      fill(NAVY); doc.rect(98, 6, R - 98, 17, 'F');
      F('bolditalic', 10.5, ORANGE); doc.text('Impresión 3D · Grabado Láser · Artículos Promocionales', (98 + R) / 2, 16, { align: 'center' });
    }
    function newPage() { doc.addPage(); header(); y = 30; }
    function ensure(h) { if (y + h > BOTTOM) newPage(); }
    function bar(text, color, h) {
      h = h || 6.2; ensure(h + 4); fill(color); doc.rect(L, y, CW, h, 'F');
      F('bold', 8.6, WHITE); doc.text(text, L + 2, y + h / 2 + 1.1); y += h;
    }

    /* Encabezado + banda */
    header();
    fill(TEAL); doc.rect(L, 25, CW, 6.6, 'F');
    F('bold', 11, WHITE); doc.text('PROPUESTA COMERCIAL', W / 2, 29.6, { align: 'center' });

    /* Datos generales */
    y = 38.5;
    var lx = L + 26, vx = lx + 2, ux = 138;
    [['Folio:', b.folio || ''], ['Cliente:', b.clienteNombre || ''], ['Proyecto:', b.obra || ''], ['Fecha:', fmt(b.fecha)], ['Vigencia hasta:', fmt(b.vigenciaHasta)], ['Lugar:', b.lugar || '']].forEach(function (r) {
      F('bold', 9, INK); doc.text(r[0], lx, y, { align: 'right' });
      F('normal', 9, INK); doc.text(doc.splitTextToSize(String(r[1]), ux - vx - 1)[0] || '', vx, y);
      draw([215, 219, 225]); doc.setLineWidth(0.25); doc.line(vx - 1, y + 2, ux, y + 2);
      y += 6.3;
    });
    F('bold', 8.4, MUTED); doc.text('Moneda:', 158, 38.5, { align: 'right' });
    F('normal', 8.4, INK); doc.text(cur === 'USD' ? 'Dólares (USD)' : 'Pesos Mexicanos (MXN)', 165, 38.5);
    y += 3;

    /* Conceptos */
    var parts = b.partidas || [];
    var body = parts.map(function (p, i) {
      var desc = String(p.concepto || '').toUpperCase() + (p.nota ? '\n' + p.nota : '');
      return [String(i + 1).padStart(3, '0'), desc, p.unidad || '', money(p.cantidad).replace(/\.00$/, ''), '$' + money(p.precio), '$' + money(Math.round((+p.cantidad || 0) * (+p.precio || 0) * 100) / 100), ''];
    });
    if (!body.length) body.push([{ content: 'Sin conceptos', colSpan: 7, styles: { halign: 'center' } }]);
    var auto = function (o) { return libs.autoTable ? libs.autoTable(doc, o) : doc.autoTable(o); };
    auto({
      startY: y, theme: 'grid', margin: { left: L, right: W - R, top: 30, bottom: H - BOTTOM },
      head: [['#', 'CONCEPTO / DESCRIPCIÓN', 'UNIDAD', 'CANT.', 'P. UNITARIO', 'IMPORTE', 'NOTAS']], body: body,
      styles: { font: 'helvetica', fontSize: 7.6, textColor: INK, lineColor: GRID, lineWidth: 0.2, cellPadding: 1.8, valign: 'middle', halign: 'center' },
      headStyles: { fillColor: TEAL, textColor: WHITE, fontStyle: 'bold', fontSize: 7.8, minCellHeight: 8.5, valign: 'middle', halign: 'center', lineColor: WHITE, lineWidth: 0.3 },
      bodyStyles: { minCellHeight: 22, fillColor: ROW },
      columnStyles: { 0: { cellWidth: 17, fontStyle: 'bold' }, 1: { cellWidth: 'auto', halign: 'left' }, 2: { cellWidth: 17 }, 3: { cellWidth: 17 }, 4: { cellWidth: 25, halign: 'right' }, 5: { cellWidth: 25, halign: 'right' }, 6: { cellWidth: 25 } },
      didParseCell: function (h) { if (h.section === 'body' && h.column.index === 6) { var p = parts[h.row.index]; if (p && p.foto && p.foto.src) h.cell.styles.minCellHeight = 22; } },
      didDrawCell: function (h) {
        if (h.section !== 'body' || h.column.index !== 6) return;
        var p = parts[h.row.index]; if (!p || !p.foto || !p.foto.src) return;
        var c = h.cell, mw = c.width - 2, mh = c.height - 2, r = (p.foto.w || 4) / (p.foto.h || 3), iw = mw, ih = iw / r;
        if (ih > mh) { ih = mh; iw = ih * r; }
        try { doc.addImage(p.foto.src, 'JPEG', c.x + (c.width - iw) / 2, c.y + (c.height - ih) / 2, iw, ih, undefined, 'FAST'); } catch (e) {}
      },
      didDrawPage: function (h) { if (h.pageNumber > 1) header(); }
    });
    y = doc.lastAutoTable.finalY + 7;

    /* Totales */
    var rows = [['SUBTOTAL:', '$' + money(t.subtotal), INK]];
    if (b.personaMoral) rows.push(['RETENCIÓN ISR (1.25%) PARA RESICO:', '-$' + money(t.retIsr), NEG]);
    rows.push(['IVA (' + (+b.iva || 0) + '%):', '$' + money(t.iva), INK]);
    ensure(rows.length * 6 + 18);
    var bx = 147, bw = R - bx;
    rows.forEach(function (r) {
      F('bold', 8.6, INK); doc.text(r[0], bx - 2, y + 4, { align: 'right' });
      draw(GRID); doc.setLineWidth(0.2); doc.rect(bx, y, bw, 6);
      F('normal', 8.6, r[2]); doc.text(r[1], R - 1.5, y + 4, { align: 'right' });
      y += 6;
    });
    fill(NAVY); doc.rect(L, y, CW, 7.5, 'F');
    fill(ORANGE); doc.rect(bx, y, bw, 7.5, 'F');
    F('bold', 10, WHITE); doc.text('TOTAL DEL PRESUPUESTO:', bx - 2, y + 5.1, { align: 'right' });
    F('bold', 11.5, WHITE); doc.text('$' + money(t.total), R - 1.5, y + 5.2, { align: 'right' });
    y += 7.5;
    fill(NAVY); doc.rect(L, y, CW, 6.4, 'F');
    F('bold', 8.6, WHITE); doc.text(doc.splitTextToSize(importeLetras(t.total, cur).replace(/^\(\* /, '* ').replace(/ \*\)$/, ' *'), CW - 4)[0], R - 2, y + 4.3, { align: 'right' });
    y += 13;

    /* Notas y condiciones */
    var notas = (b.observaciones || []).filter(function (s) { return s && s.trim(); });
    bar('NOTAS Y CONDICIONES', TEAL);
    notas.forEach(function (n, i) {
      var ls = doc.splitTextToSize('• ' + n.trim(), CW - 4), h = ls.length * 3.6 + 2.6;
      ensure(h); fill(i % 2 ? WHITE : ROW); doc.rect(L, y, CW, h, 'F');
      F('normal', 7.6, INK); doc.text(ls, L + 2, y + 3.7); y += h;
    });
    ensure(7); draw(GRID); doc.setLineWidth(0.2); doc.line(L, y, R, y);
    F('bold', 8, INK); doc.text('PARA PERSONAS MORALES FAVOR DE CONSIDERAR LA RETENCIÓN DEL 1.25% DE ISR PARA RESICO', L + 2, y + 4.4);
    y += 6.4; doc.line(L, y, R, y);
    y += 10;

    /* Datos bancarios */
    var bl = [
      'Banco: ' + (bank.banco || '') + '  |  Titular: ' + (bank.titular || ''),
      'Moneda Nacional Cuenta: ' + (bank.mxnCuenta || '') + ' / Clabe Interbancaria: ' + (bank.mxnClabe || ''),
      'Correo: ' + (bank.correo || '') + '  |  Tel: ' + (bank.tel || '')
    ];
    ensure(6.2 + bl.length * 5.6);
    bar('DATOS BANCARIOS', NAVY);
    bl.forEach(function (ln) {
      fill(PEACH); doc.rect(L, y, CW, 5.6, 'F'); draw(WHITE); doc.setLineWidth(0.3); doc.line(L, y + 5.6, R, y + 5.6);
      F('normal', 7.6, INK); doc.text(ln, L + 2, y + 3.8); y += 5.6;
    });

    /* Pie */
    var n = doc.getNumberOfPages();
    for (var p = 1; p <= n; p++) {
      doc.setPage(p);
      F('normal', 8.4, INK); doc.text('TRIDI MX', W / 2, H - 9, { align: 'center' });
      doc.text('Página ' + p + (n > 1 ? ' de ' + n : ''), R, H - 9, { align: 'right' });
      if (b.folio) { F('normal', 6.8, MUTED); doc.text(b.folio, L, H - 9); }
    }
    return doc;
  }

  root.buildReportPDF = buildReportPDF;
  root.buildBudgetPDF = buildBudgetPDF;
  root.AGIS_budgetTotals = budgetTotals;
  root.AGIS_importeLetras = importeLetras;
  root.AGIS_money = money;
  if (typeof module !== 'undefined' && module.exports) module.exports = { buildReportPDF: buildReportPDF, buildBudgetPDF: buildBudgetPDF, budgetTotals: budgetTotals, importeLetras: importeLetras, money: money };
})(typeof window !== 'undefined' ? window : globalThis);
