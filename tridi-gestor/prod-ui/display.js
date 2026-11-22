
(function(){
  const TZ = 'America/Mexico_City';
  const PALETTE = ['#F26522','#2EC4A5','#E8B84B','#5B6EE1','#E5484D','#8E6FF7'];
  const DAY_NAMES = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const DAY_SHORT = ['dom','lun','mar','mié','jue','vie','sáb'];
  // '3d' = Impresión 3D FDM (el valor interno se conserva para no migrar datos existentes).
  const TIPO_SHORT = {'3d':'3D FDM','sla':'3D SLA','laser':'Láser','uvdtf':'UV DTF'};
  const TIPO_ORDER = {'3d':0,'sla':1,'laser':2,'uvdtf':3};
  const tipoClass = t => t === 'laser' ? 'laser' : (t === 'sla' ? 'sla' : (t === 'uvdtf' ? 'uvdtf' : 't3d'));
  const VISIBLE_DAYS = 3;
  const HOUR = 3600*1000;
  const NBSP = ' ';
  const NONE_KEY = '__none__';          // clave de "Sin definir" en los filtros
  const FINISHED_MAX = 100;             // máximo de trabajos finalizados que se listan
  const PROJECT_RETENTION_MS = 7*86400000; // los proyectos completados se ocultan tras 7 días
  const FILTER_KEY = 'tridi.display.filters';

  // Mismos valores por defecto que la app principal, por si aún no se guardó configuración.
  const DEFAULT_PRINTERS = [
    {id:'c1', tipo:'3d', marca:'Elegoo', modelo:'Centauri Carbon', multicolor:false, alias:'Centauri 1'},
    {id:'c2', tipo:'3d', marca:'Elegoo', modelo:'Centauri Carbon', multicolor:false, alias:'Centauri 2'},
    {id:'c3', tipo:'3d', marca:'Elegoo', modelo:'Centauri Carbon', multicolor:false, alias:'Centauri 3'},
    {id:'c4', tipo:'3d', marca:'Elegoo', modelo:'Centauri Carbon', multicolor:false, alias:'Centauri 4'},
    {id:'c5', tipo:'3d', marca:'Elegoo', modelo:'Centauri Carbon', multicolor:false, alias:'Centauri 5'},
    {id:'mc6', tipo:'3d', marca:'Elegoo', modelo:'Centauri Carbon', multicolor:true, alias:'MC-Centauri 6'},
    {id:'h2d', tipo:'3d', marca:'Bambu Lab', modelo:'H2D', multicolor:true, alias:'MC-Bambu H2D'},
    {id:'a1', tipo:'3d', marca:'Bambu Lab', modelo:'A1', multicolor:true, alias:'MC-Bambu A1'},
    {id:'f2uv', tipo:'laser', marca:'xTool', modelo:'F2 Ultra UV', multicolor:false, alias:'xTool F2 Ultra UV'}
  ];
  const DEFAULT_HORARIO = [0,1,2,3,4,5,6].map(d => ({activo: d>=1 && d<=5, inicio:'09:00', fin:'18:00'}));

  const collator = new Intl.Collator('es', {sensitivity:'base', numeric:true});
  const clockParts = new Intl.DateTimeFormat('en-US', {timeZone:TZ, hourCycle:'h23', hour:'2-digit', minute:'2-digit', second:'2-digit'});
  const fmtDateLong = new Intl.DateTimeFormat('es-MX', {timeZone:TZ, weekday:'long', day:'numeric', month:'long', year:'numeric'});

  let printers = DEFAULT_PRINTERS, horario = DEFAULT_HORARIO, jobs = [];
  let viewDate = startOfDay(new Date());
  let sseOk = false, fetchOk = false, lastRefresh = null, bootId = null, loaded = false;
  let hiddenMachines = new Set(), hiddenProjects = new Set(), hiddenClients = new Set();

  const el = id => document.getElementById(id);
  const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function startOfDay(d){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
  function addDays(d, n){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()+n); }
  function pad(n){ return String(n).padStart(2,'0'); }
  // Formato de 12 horas con a.m. / p.m.
  const h12 = h => ((h + 11) % 12) + 1;
  const ampm = h => h < 12 ? 'a.m.' : 'p.m.';
  function hm(d){ return h12(d.getHours()) + ':' + pad(d.getMinutes()) + NBSP + ampm(d.getHours()); }
  function clock12(d){
    const p = {}; clockParts.formatToParts(d).forEach(x => { p[x.type] = x.value; });
    const h = (+p.hour) % 24;
    return {time: h12(h) + ':' + p.minute + ':' + p.second, ap: ampm(h)};
  }
  function parseHM(s){ const [h,m] = String(s||'0:0').split(':').map(Number); return (h||0)*60 + (m||0); }
  function displayName(p){
    const a = (p.alias||'').trim();
    if(a) return a;
    return [p.marca, p.modelo].filter(Boolean).join(' ').trim() || p.id;
  }
  function relLabel(d){
    const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
    if(diff === 0) return 'hoy ' + hm(d);
    if(diff === 1) return 'mañana ' + hm(d);
    if(diff === -1) return 'ayer ' + hm(d);
    return DAY_SHORT[d.getDay()] + ' ' + pad(d.getDate()) + '/' + pad(d.getMonth()+1) + ' ' + hm(d);
  }
  function normalizeJob(j){
    if(!Array.isArray(j.segments) || j.segments.length === 0) j.segments = [{start:j.start, end:j.end}];
    if(!j.tipoTrabajo) j.tipoTrabajo = '3d';
    j.proyecto = typeof j.proyecto === 'string' ? j.proyecto.trim() : '';
    j.cliente = typeof j.cliente === 'string' ? j.cliente.trim() : '';
    j.presupuestoUrl = typeof j.presupuestoUrl === 'string' ? j.presupuestoUrl.trim() : '';
    return j;
  }
  const segMs = j => j.segments.map(s => ({s:new Date(s.start).getTime(), e:new Date(s.end).getTime()}));
  const jobStart = j => new Date(j.segments[0].start);
  const jobEnd = j => new Date(j.segments[j.segments.length-1].end);
  const projName = j => (j.proyecto||'').trim();
  const projKey = j => projName(j) ? projName(j).toLowerCase() : NONE_KEY;
  const projLabel = j => projName(j) || 'Sin definir';
  const cliName = j => (j.cliente||'').trim();
  const cliKey = j => cliName(j) ? cliName(j).toLowerCase() : NONE_KEY;
  const cliLabel = j => cliName(j) || 'Sin cliente';
  const isRunning = (j, nowMs) => segMs(j).some(s => s.s <= nowMs && s.e > nowMs);

  // Máquinas ordenadas por tipo (3D FDM, 3D SLA, Láser) y después alfabéticamente.
  function sortedPrinters(){
    return [...printers].sort((a,b) =>
      ((TIPO_ORDER[a.tipo] ?? 9) - (TIPO_ORDER[b.tipo] ?? 9)) || collator.compare(displayName(a), displayName(b)));
  }

  /* ---- Filtros (se guardan en esta pantalla) ---- */
  function loadFilters(){
    try{
      const o = JSON.parse(localStorage.getItem(FILTER_KEY) || '{}');
      hiddenMachines = new Set(Array.isArray(o.m) ? o.m : []);
      hiddenProjects = new Set(Array.isArray(o.p) ? o.p : []);
      hiddenClients = new Set(Array.isArray(o.c) ? o.c : []);
    }catch(e){}
  }
  function saveFilters(){
    try{ localStorage.setItem(FILTER_KEY, JSON.stringify({m:[...hiddenMachines], p:[...hiddenProjects], c:[...hiddenClients]})); }catch(e){}
  }
  function projectList(){ // proyectos presentes en los trabajos: [{key, label}]
    const map = new Map();
    jobs.forEach(j => { const k = projKey(j); if(!map.has(k)) map.set(k, {key:k, label:projLabel(j), n:0}); map.get(k).n++; });
    return [...map.values()].sort((a,b) => a.key === NONE_KEY ? 1 : (b.key === NONE_KEY ? -1 : collator.compare(a.label, b.label)));
  }
  function clientList(){ // clientes presentes en los trabajos: [{key, label, n}]
    const map = new Map();
    jobs.forEach(j => { const k = cliKey(j); if(!map.has(k)) map.set(k, {key:k, label:cliLabel(j), n:0}); map.get(k).n++; });
    return [...map.values()].sort((a,b) => a.key === NONE_KEY ? 1 : (b.key === NONE_KEY ? -1 : collator.compare(a.label, b.label)));
  }
  function updateFilterChip(){
    const chip = el('filter-chip');
    const pl = projectList();
    const hiddenM = printers.filter(p => hiddenMachines.has(p.id)).length;
    const hiddenP = pl.filter(p => hiddenProjects.has(p.key)).length;
    const cl = clientList();
    const hiddenC = cl.filter(c => hiddenClients.has(c.key)).length;
    const parts = [];
    if(hiddenM) parts.push('Máquinas ' + (printers.length - hiddenM) + '/' + printers.length);
    if(hiddenP) parts.push('Proyectos ' + (pl.length - hiddenP) + '/' + pl.length);
    if(hiddenC) parts.push('Clientes ' + (cl.length - hiddenC) + '/' + cl.length);
    chip.style.display = parts.length ? 'inline-flex' : 'none';
    chip.textContent = parts.length ? '⚠ Filtros activos · ' + parts.join(' · ') : '';
  }
  let fmSig = '';
  function renderFilterPanel(force){
    const pl = projectList();
    const sp = sortedPrinters();
    const cl = clientList();
    const sig = sp.map(p => p.id + displayName(p) + p.tipo).join('|') + '#' + pl.map(p => p.key + p.n).join('|') + '#' + cl.map(c => c.key + c.n).join('|');
    if(!force && sig === fmSig) return;
    fmSig = sig;
    // Máquinas agrupadas por tipo
    let html = '';
    ['3d','sla','laser','uvdtf'].forEach(t => {
      const list = sp.filter(p => p.tipo === t);
      if(!list.length) return;
      html += '<div class="fm-group"><div class="fm-gh"><span>'+TIPO_SHORT[t]+'</span><span class="acts">' +
        '<button type="button" class="small" data-grp="'+t+'" data-act="all">Todas</button>' +
        '<button type="button" class="small" data-grp="'+t+'" data-act="none">Ninguna</button></span></div>' +
        list.map(p => '<label class="fm-item"><input type="checkbox" data-m="'+esc(p.id)+'"'+(hiddenMachines.has(p.id)?'':' checked')+'> '+esc(displayName(p))+'</label>').join('') + '</div>';
    });
    el('fm-machines').innerHTML = html || '<div class="empty">No hay máquinas dadas de alta.</div>';
    // Proyectos
    el('fm-clients').innerHTML = cl.length
      ? '<div class="fm-group"><div class="fm-gh"><span>Clientes</span><span class="acts">' +
        '<button type="button" class="small" data-grp="cli" data-act="all">Todos</button>' +
        '<button type="button" class="small" data-grp="cli" data-act="none">Ninguno</button></span></div>' +
        cl.map(c => '<label class="fm-item"><input type="checkbox" data-c="'+esc(c.key)+'"'+(hiddenClients.has(c.key)?'':' checked')+'> '+esc(c.label)+'<span class="n">'+c.n+(c.n===1?' trabajo':' trabajos')+'</span></label>').join('') + '</div>'
      : '<div class="empty">Aún no hay trabajos registrados.</div>';
    el('fm-projects').innerHTML = pl.length
      ? '<div class="fm-group"><div class="fm-gh"><span>Proyectos</span><span class="acts">' +
        '<button type="button" class="small" data-grp="proj" data-act="all">Todos</button>' +
        '<button type="button" class="small" data-grp="proj" data-act="none">Ninguno</button></span></div>' +
        pl.map(p => '<label class="fm-item"><input type="checkbox" data-p="'+esc(p.key)+'"'+(hiddenProjects.has(p.key)?'':' checked')+'> '+esc(p.label)+'<span class="n">'+p.n+(p.n===1?' trabajo':' trabajos')+'</span></label>').join('') + '</div>'
      : '<div class="empty">Aún no hay trabajos registrados.</div>';
  }
  let fmLast = 0;
  function openFilters(){ if(el('sup-lock').classList.contains('show')) return; renderFilterPanel(true); el('fmodal').classList.add('show'); fmLast = Date.now(); }
  function closeFilters(){ el('fmodal').classList.remove('show'); }
  function onFilterChange(){
    saveFilters();
    updateFilterChip();
    renderTimeline();
  }
  function setupFilters(){
    loadFilters();
    el('btn-filtros').addEventListener('click', openFilters);
    el('filter-chip').addEventListener('click', openFilters);
    el('fm-close').addEventListener('click', closeFilters);
    el('fmodal').addEventListener('click', e => { fmLast = Date.now(); if(e.target === el('fmodal')) closeFilters(); });
    el('fmodal').addEventListener('keydown', () => { fmLast = Date.now(); });
    document.addEventListener('keydown', e => { if(e.key === 'Escape') closeFilters(); });
    el('fm-all').addEventListener('click', () => {
      hiddenMachines.clear(); hiddenProjects.clear(); hiddenClients.clear();
      renderFilterPanel(true); onFilterChange();
    });
    el('fmodal').addEventListener('change', e => {
      const t = e.target;
      if(t.dataset.m){ t.checked ? hiddenMachines.delete(t.dataset.m) : hiddenMachines.add(t.dataset.m); }
      else if(t.dataset.p){ t.checked ? hiddenProjects.delete(t.dataset.p) : hiddenProjects.add(t.dataset.p); }
      else if(t.dataset.c){ t.checked ? hiddenClients.delete(t.dataset.c) : hiddenClients.add(t.dataset.c); }
      else return;
      onFilterChange();
    });
    el('fmodal').addEventListener('click', e => {
      const b = e.target.closest('button[data-act]');
      if(!b) return;
      const show = b.dataset.act === 'all';
      if(b.dataset.grp === 'cli'){
        clientList().forEach(c => show ? hiddenClients.delete(c.key) : hiddenClients.add(c.key));
      }else if(b.dataset.grp === 'proj'){
        projectList().forEach(p => show ? hiddenProjects.delete(p.key) : hiddenProjects.add(p.key));
      }else{
        printers.filter(p => p.tipo === b.dataset.grp).forEach(p => show ? hiddenMachines.delete(p.id) : hiddenMachines.add(p.id));
      }
      renderFilterPanel(true); onFilterChange();
    });
    // Si alguien deja el panel abierto, se cierra solo para no tapar la pantalla.
    setInterval(() => { if(el('fmodal').classList.contains('show') && Date.now() - fmLast > 90000) closeFilters(); }, 5000);
  }

  /* ---- Zona horaria: la línea de tiempo usa la hora de esta PC; el reloj, la de CDMX.
         Si no coinciden, se avisa en pantalla para que nadie lea una hora equivocada. ---- */
  function cdmxOffsetMin(d){
    const parts = new Intl.DateTimeFormat('en-US', {timeZone:TZ, hourCycle:'h23', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit'}).formatToParts(d);
    const p = {}; parts.forEach(x => { p[x.type] = x.value; });
    const asUTC = Date.UTC(+p.year, +p.month-1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
    return Math.round((asUTC - Math.floor(d.getTime()/1000)*1000) / 60000);
  }
  function checkTimezone(){
    const n = new Date();
    el('tz-warn').style.display = (cdmxOffsetMin(n) !== -n.getTimezoneOffset()) ? 'inline-flex' : 'none';
  }

  /* ---- Horario del taller (para el indicador abierto/cerrado) ---- */
  function windowFor(day){
    const cfg = horario[day.getDay()];
    if(!cfg || !cfg.activo) return null;
    const s = parseHM(cfg.inicio), e = parseHM(cfg.fin);
    if(!(e > s)) return null;
    const y = day.getFullYear(), m = day.getMonth(), d = day.getDate();
    return {start:new Date(y,m,d,Math.floor(s/60),s%60), end:new Date(y,m,d,Math.floor(e/60),e%60)};
  }
  function nextWorkTime(t){
    let d = startOfDay(t);
    for(let i=0; i<400; i++){
      const w = windowFor(d);
      if(w && t < w.end) return new Date(Math.max(t.getTime(), w.start.getTime()));
      d = addDays(d, 1);
    }
    return null;
  }
  function renderShopStatus(){
    const node = el('shop-status');
    const now = new Date();
    const w = windowFor(startOfDay(now));
    if(w && now >= w.start && now < w.end){
      node.className = 'chip open';
      node.textContent = 'Taller abierto · cierra ' + hm(w.end);
      return;
    }
    const nxt = nextWorkTime(now);
    node.className = 'chip closed';
    node.textContent = nxt ? 'Taller cerrado · abre ' + relLabel(nxt) : 'Taller cerrado';
  }

  /* ---- Línea de tiempo ---- */
  function bestJobInSlot(pj, csMs, ceMs){
    let best = null, bestOv = 0;
    for(const j of pj){
      let ov = 0;
      for(const s of segMs(j)) ov += Math.max(0, Math.min(s.e, ceMs) - Math.max(s.s, csMs));
      if(ov > bestOv){ bestOv = ov; best = j; }
    }
    return best;
  }
  function renderTimeline(){
    const now = new Date(), nowMs = now.getTime();
    const days = [];
    for(let i=0; i<VISIBLE_DAYS; i++) days.push(addDays(viewDate, i));
    const windows = days.map(windowFor);
    const nCols = VISIBLE_DAYS * 24;
    const rows = sortedPrinters().filter(p => !hiddenMachines.has(p.id));
    document.documentElement.style.setProperty('--rows', Math.max(1, rows.length));

    let dayRow = '<tr><th class="printer-col" rowspan="2">Máquina</th>';
    let hourRow = '<tr>';
    days.forEach((day, di) => {
      const isToday = startOfDay(now).getTime() === day.getTime();
      const off = !windows[di];
      dayRow += '<th colspan="24" class="day-col day-start'+(isToday?' day-today':'')+(off?' day-off':'')+'">'+
        DAY_NAMES[day.getDay()]+' '+pad(day.getDate())+'/'+MONTHS[day.getMonth()]+(isToday?' · hoy':'')+(off?' · sin labores':'')+'</th>';
      for(let h=0; h<24; h++){
        hourRow += '<th class="hour-col'+(h===0?' day-start':'')+(isToday && h===now.getHours()?' now':'')+'"><b>'+h12(h)+'</b><i>'+((h%6===0 || (isToday && h===now.getHours())) ? ampm(h) : '&nbsp;')+'</i></th>';
      }
    });
    dayRow += '</tr>'; hourRow += '</tr>';

    let body = '<tbody>';
    if(!rows.length){
      body += '<tr><td class="emptyrow" colspan="'+(nCols+1)+'">Sin máquinas seleccionadas. Revisa los filtros.</td></tr>';
    }
    let prevTipo = null;
    for(const p of rows){
      const allJobs = jobs.filter(j => j.printerId === p.id);
      const pj = allJobs.filter(j => !hiddenProjects.has(projKey(j)) && !hiddenClients.has(cliKey(j))); // los filtros de proyecto y cliente solo ocultan bloques
      const busyNow = allJobs.some(j => isRunning(j, nowMs));         // el estado de la máquina siempre es real
      const dotColor = p.tipo==='laser' ? '#8E6FF7' : (p.tipo==='sla' ? '#E8B84B' : (p.tipo==='uvdtf' ? '#FF7AB8' : (p.multicolor ? 'var(--teal)' : '#5A6C93')));
      const typeStart = prevTipo !== null && prevTipo !== p.tipo;
      prevTipo = p.tipo;
      body += '<tr class="'+(typeStart?'type-start':'')+(p.mantenimiento?' mant':'')+'"><th><span class="pd" style="background:'+dotColor+'"></span>'+esc(displayName(p))+
        '<span class="st'+(p.mantenimiento?' mant':(busyNow?' busy':''))+'">'+TIPO_SHORT[p.tipo]+' · '+(p.mantenimiento?'🔧 Mantenimiento':(busyNow?'Ocupada':'Libre'))+'</span></th>';

      // Una casilla por hora; las horas seguidas del mismo trabajo se unen en una sola
      // para que el nombre del archivo se lea completo sobre la barra.
      const slots = [];
      for(let di=0; di<VISIBLE_DAYS; di++){
        for(let h=0; h<24; h++){
          const cs = new Date(days[di].getFullYear(), days[di].getMonth(), days[di].getDate(), h).getTime();
          const job = bestJobInSlot(pj, cs, cs + HOUR);
          const w = windows[di];
          const inWork = !!w && cs < w.end.getTime() && cs + HOUR > w.start.getTime();
          slots.push({job, inWork});
        }
      }
      // Trabajo activo de la máquina: su tramo en curso se ilumina en la línea de tiempo.
      const activeJob = pj.find(j => isRunning(j, nowMs));
      const activeSeg = activeJob ? segMs(activeJob).find(sg => sg.s <= nowMs && sg.e > nowMs) : null;
      const cells = [];
      let i = 0;
      while(i < nCols){
        const sl = slots[i];
        const dayStart = (i % 24 === 0) ? ' day-start' : '';
        if(sl.job){
          let n = 1;
          while(i+n < nCols && (i+n) % 24 !== 0 && slots[i+n].job === sl.job) n++;
          const csMs = new Date(days[Math.floor(i/24)].getFullYear(), days[Math.floor(i/24)].getMonth(), days[Math.floor(i/24)].getDate(), i % 24).getTime();
          const live = !!activeSeg && sl.job === activeJob && csMs < activeSeg.e && csMs + n*HOUR > activeSeg.s;
          cells.push({job:sl.job, n, dayStart, live});
          i += n;
        }else{
          cells.push({job:null, n:1, dayStart, inWork:sl.inWork});
          i++;
        }
      }
      cells.forEach((c, k) => {
        if(!c.live) return;
        c.first = !(k > 0 && cells[k-1].live);
        c.last = !(k < cells.length-1 && cells[k+1].live);
      });
      cells.forEach(c => {
        if(c.job){
          const tip = c.job.archivo+(projName(c.job) ? ' ['+projName(c.job)+']' : '')+(cliName(c.job) ? ' · Cliente: '+cliName(c.job) : '')+' — '+relLabel(jobStart(c.job))+' → '+relLabel(jobEnd(c.job));
          body += '<td class="cell filled'+c.dayStart+(c.live ? ' neon'+(c.first?' neon-first':'')+(c.last?' neon-last':'') : '')+'" colspan="'+c.n+'" title="'+esc(tip)+'" style="background:'+PALETTE[c.job.colorIdx % PALETTE.length]+'">'+esc(c.job.archivo)+'</td>';
        }else{
          body += '<td class="cell'+(c.inWork?'':' off')+c.dayStart+'"></td>';
        }
      });
      body += '</tr>';
    }
    body += '</tbody>';
    el('tl').innerHTML = '<colgroup><col style="width:var(--pcol)">'+'<col>'.repeat(nCols)+'</colgroup><thead>'+dayRow+hourRow+'</thead>'+body;

    // Bandera de la hora actual
    const f = (nowMs - viewDate.getTime()) / (nCols * HOUR);
    const line = el('now-line');
    if(f >= 0 && f <= 1){
      line.style.display = 'block';
      line.style.left = 'calc(var(--pcol) + (100% - var(--pcol)) * ' + f.toFixed(5) + ')';
      el('now-flag').textContent = hm(now);
    }else{
      line.style.display = 'none';
    }
  }

  /* ---- Avance por proyecto ---- */
  function projectStats(nowMs){
    const map = new Map();
    jobs.forEach(j => {
      const key = projKey(j);
      let g = map.get(key);
      if(!g){ g = {key, name:projLabel(j), jobs:0, done:0, total:0, worked:0, start:Infinity, end:0}; map.set(key, g); }
      const segs = segMs(j);
      const total = segs.reduce((a,s) => a + (s.e - s.s), 0);
      const worked = segs.reduce((a,s) => a + Math.max(0, Math.min(s.e, nowMs) - s.s), 0);
      g.jobs++; g.total += total; g.worked += worked;
      if(segs[segs.length-1].e <= nowMs) g.done++;
      g.start = Math.min(g.start, segs[0].s);
      g.end = Math.max(g.end, segs[segs.length-1].e);
    });
    return [...map.values()].map(g => {
      const finished = g.done === g.jobs;
      let pct = g.total > 0 ? Math.round(g.worked / g.total * 100) : 0;
      pct = finished ? 100 : Math.min(99, pct);  // 100 % solo cuando todos los trabajos terminaron
      const status = finished ? 'done' : (g.worked > 0 ? 'running' : 'queued');
      return {...g, pct, status};
    });
  }
  const STATUS_TAG = {running:['run','En curso'], queued:['wait','Programado'], done:['ok','Completado']};
  function renderProjects(){
    const nowMs = Date.now();
    let list = projectStats(nowMs);
    const hiddenOld = list.filter(g => g.status === 'done' && nowMs - g.end > PROJECT_RETENTION_MS).length;
    list = list.filter(g => !(g.status === 'done' && nowMs - g.end > PROJECT_RETENTION_MS));
    const rank = {running:0, queued:1, done:2};
    list.sort((a,b) => (rank[a.status] - rank[b.status]) ||
      (a.status === 'done' ? b.end - a.end : (a.status === 'queued' ? a.start - b.start : a.end - b.end)) ||
      collator.compare(a.name, b.name));
    let html = list.map(g => {
      const [tc, tl] = STATUS_TAG[g.status];
      const endTxt = (g.status === 'done' ? 'Terminó ' : 'Termina ') + relLabel(new Date(g.end));
      const cls = 'card' + (g.status === 'running' ? ' running' : (g.status === 'done' ? ' done' : ' queued'));
      return '<div class="'+cls+'"><div class="cn"><span>'+g.done+'/'+g.jobs+(g.jobs===1?' trabajo':' trabajos')+'</span><span class="tag '+tc+'">'+tl+'</span></div>'+
        '<div class="cf'+(g.key === NONE_KEY ? ' free' : '')+'">'+esc(g.name)+'</div>'+
        '<div class="cs">'+esc(endTxt)+' · '+g.pct+'%</div>'+
        '<div class="bar"><i style="width:'+g.pct+'%"></i></div></div>';
    }).join('');
    if(!list.length) html = '<div class="empty">'+(jobs.length ? 'Sin proyectos activos.' : 'Aún no hay trabajos registrados.')+'</div>';
    if(hiddenOld > 0) html += '<div class="jnote" style="grid-column:1/-1">'+hiddenOld+(hiddenOld===1?' proyecto completado hace más de 7 días no se muestra':' proyectos completados hace más de 7 días no se muestran')+'</div>';
    el('projects').innerHTML = html;
  }

  // Título con hipervínculo al presupuesto (solo http/https).
  function titleHtml(j){
    const u = (j.presupuestoUrl||'').trim();
    if(/^https?:\/\//i.test(u)) return '<a class="plink" href="'+esc(u)+'" target="_blank" rel="noopener noreferrer" title="Abrir presupuesto">'+esc(j.archivo)+' <span class="ext">↗</span></a>';
    return esc(j.archivo);
  }
  /* ---- Trabajos programados (solo lectura): en curso y próximos ---- */
  function renderJobs(){
    const nowMs = Date.now();
    const upcoming = jobs.filter(j => jobEnd(j).getTime() > nowMs).sort((a,b) => jobStart(a) - jobStart(b));
    let html = upcoming.map(j => {
      const p = printers.find(pp => pp.id === j.printerId);
      const active = isRunning(j, nowMs);
      return '<div class="jrow'+(active?' active':'')+'">'+
        '<span class="sw" style="background:'+PALETTE[j.colorIdx % PALETTE.length]+'"></span>'+
        '<div class="jmain"><div class="jname">'+titleHtml(j)+'</div>'+
        '<div class="jmeta">'+(projName(j) ? '<span class="tag proj" title="Proyecto">'+esc(projName(j))+'</span> ' : '')+(cliName(j) ? '<span class="tag cli" title="Cliente">👤 '+esc(cliName(j))+'</span> ' : '')+
        '<span class="tag '+tipoClass(j.tipoTrabajo)+'">'+TIPO_SHORT[j.tipoTrabajo]+'</span> '+
        esc(p ? displayName(p) : '?')+' · '+esc(relLabel(jobStart(j)))+' → '+esc(relLabel(jobEnd(j)))+'</div></div>'+
        (active ? '<span class="jchip">En curso</span>' : '')+'</div>';
    }).join('');
    if(!upcoming.length) html = '<div class="empty">Sin trabajos en curso ni próximos.</div>';
    el('jobs').innerHTML = html;
  }

  /* ---- Finalizados (cola en tiempo real, solo lectura) ---- */
  let doneSeen = null;            // ids de trabajos ya finalizados que se han visto
  const freshUntil = new Map();   // id -> hasta cuándo se resalta como "recién terminado"
  function renderFinished(){
    const nowMs = Date.now();
    const isProb = j => !!(j.cierre && j.cierre.estado === 'problema');
    // Los trabajos marcados como "listo" desde control salen de la lista; los que tuvieron problema se quedan arriba hasta que se marquen listos.
    const done = jobs.filter(j => jobEnd(j).getTime() <= nowMs && !(j.cierre && j.cierre.estado === 'ok'))
      .sort((a,b) => (isProb(b) - isProb(a)) || (jobEnd(b) - jobEnd(a)));
    if(loaded){
      const ids = new Set(done.map(j => j.id));
      if(doneSeen !== null) ids.forEach(id => { if(!doneSeen.has(id)) freshUntil.set(id, nowMs + 8000); });
      doneSeen = ids; // la primera carga no resalta nada
    }
    const shown = done.slice(0, FINISHED_MAX);
    el('finished-cnt').textContent = done.length;
    let html = shown.map(j => {
      const p = printers.find(pp => pp.id === j.printerId);
      const fresh = (freshUntil.get(j.id) || 0) > nowMs;
      const prob = isProb(j);
      return '<div class="jrow'+(fresh?' fresh':'')+(prob?' prob':'')+'">'+
        '<span class="sw" style="background:'+PALETTE[j.colorIdx % PALETTE.length]+'"></span>'+
        '<div class="jmain"><div class="jname">'+esc(j.archivo)+'</div>'+
        '<div class="jmeta">'+(prob ? '<span class="tag warn">⚠ Problema</span> ' : '')+'<span class="tag '+tipoClass(j.tipoTrabajo)+'">'+TIPO_SHORT[j.tipoTrabajo]+'</span> '+esc(p ? displayName(p) : '?')+' · Terminó '+esc(relLabel(jobEnd(j)))+'</div>'+
        (projName(j) || cliName(j) ? '<div class="jmeta">'+(projName(j) ? 'Proyecto: '+esc(projName(j)) : '')+(projName(j) && cliName(j) ? ' · ' : '')+(cliName(j) ? 'Cliente: '+esc(cliName(j)) : '')+'</div>' : '')+(prob && j.cierre.nota ? '<div class="pnote">'+esc(j.cierre.nota)+'</div>' : '')+'</div></div>';
    }).join('');
    if(!shown.length) html = '<div class="empty">Aún no hay trabajos finalizados.</div>';
    if(done.length > shown.length) html += '<div class="jnote">+'+(done.length - shown.length)+' anteriores no se muestran</div>';
    el('finished').innerHTML = html;
  }

  function scrollBoxes(){ return [el('projects-scroll'), el('jobs'), el('finished')]; }
  function fitSide(){ const t = document.querySelector('header.top'); if(t) document.querySelector('.right').style.setProperty('--hdr', (t.offsetHeight + parseFloat(getComputedStyle(document.querySelector('.screen')).paddingTop) * 2 + parseFloat(getComputedStyle(document.querySelector('.screen')).rowGap || 0)) + 'px'); }
  window.addEventListener('resize', fitSide);
  function renderAll(){
    fitSide();
    const saved = scrollBoxes().map(n => n.scrollTop);
    renderShopStatus();
    renderTimeline();
    renderProjects();
    renderJobs();
    renderFinished();
    updateFilterChip();
    if(el('fmodal').classList.contains('show')) renderFilterPanel(false);
    scrollBoxes().forEach((n, i) => { n.scrollTop = saved[i]; }); // no saltar al inicio en cada actualización
  }

  /* Desplazamiento automático (la pantalla es solo de lectura): si hay más contenido del que
     cabe, baja despacio, hace una pausa al final y vuelve arriba. Si todo cabe, no se mueve. */
  function autoScroll(node){
    let pauseUntil = Date.now() + 5000, atBottom = false;
    setInterval(() => {
      const max = node.scrollHeight - node.clientHeight;
      if(max <= 2 || Date.now() < pauseUntil) return;
      if(atBottom){ node.scrollTop = 0; atBottom = false; pauseUntil = Date.now() + 5000; return; }
      const before = node.scrollTop;
      node.scrollTop = before + Math.max(1, Math.round(parseFloat(getComputedStyle(document.documentElement).fontSize) / 16));
      if(node.scrollTop >= max - 1 || node.scrollTop === before){ atBottom = true; pauseUntil = Date.now() + 5000; }
    }, 40);
  }

  /* ---- Estado de conexión ---- */
  function updateLive(){
    const ok = sseOk && fetchOk;
    el('live').className = 'chip live' + (ok ? '' : ' off');
    let txt = ok ? 'En vivo' : 'Reconectando…';
    if(ok && lastRefresh){ const c = clock12(lastRefresh); txt += ' · act. ' + c.time + NBSP + c.ap; }
    el('live-txt').textContent = txt;
  }

  /* ---- Modo Taller sin Supervisión: aviso bloqueante, solo se quita desde la pantalla de control ---- */
  function setSupLock(on){
    const lock = el('sup-lock');
    lock.classList.toggle('show', on);
    document.documentElement.style.overflow = on ? 'hidden' : '';
    if(on){ const fm = el('fmodal'); if(fm) fm.classList.remove('show'); }
  }
  ['keydown','wheel','touchmove'].forEach(t => window.addEventListener(t, e => {
    if(el('sup-lock').classList.contains('show')){ e.preventDefault(); e.stopPropagation(); }
  }, {capture:true, passive:false}));

  /* ---- Datos ---- */
  let inflight = false, pending = false;
  async function refresh(){
    if(inflight){ pending = true; return; }
    inflight = true;
    try{
      const [rc, rj] = await Promise.all([fetch('/api/prod/config', {cache:'no-store'}), fetch('/api/prod/jobs', {cache:'no-store'})]);
      if(!rc.ok || !rj.ok) throw new Error('bad response');
      const c = await rc.json(), j = await rj.json();
      const has = Array.isArray(c.printers) && Array.isArray(c.horario) && c.horario.length === 7;
      printers = has ? c.printers : DEFAULT_PRINTERS;
      horario = has ? c.horario : DEFAULT_HORARIO;
      jobs = j.map(normalizeJob);
      setSupLock(!!c.sinSupervision);
      lastRefresh = new Date();
      fetchOk = true; loaded = true;
      renderAll();
    }catch(e){
      fetchOk = false;
    }finally{
      inflight = false;
      updateLive();
      if(pending){ pending = false; refresh(); }
    }
  }

  // Tiempo real: el servidor avisa en cuanto alguien guarda algo desde la app de captura.
  function connect(){
    const es = new EventSource('/api/prod/events');
    es.onopen = () => { sseOk = true; updateLive(); refresh(); };
    es.onmessage = ev => {
      let msg = {};
      try{ msg = JSON.parse(ev.data); }catch(e){}
      if(msg.type === 'hello'){
        // El servidor se reinició (deploy): recarga para tomar la versión nueva de esta pantalla.
        if(bootId !== null && msg.boot !== bootId){ location.reload(); return; }
        bootId = msg.boot;
      }
      refresh();
    };
    es.onerror = () => { sseOk = false; updateLive(); }; // EventSource reintenta solo
  }

  /* ---- Reloj (hora de Ciudad de México, 12 h) ---- */
  let lastKey = null, lastSig = '';
  function stateSig(){ // cambia cuando un trabajo empieza o termina
    const n = Date.now(); let d = 0, r = 0;
    jobs.forEach(j => { if(jobEnd(j).getTime() <= n) d++; else if(isRunning(j, n)) r++; });
    return d + '/' + r;
  }
  function tick(){
    const n = new Date();
    const c = clock12(n);
    el('clock').innerHTML = esc(c.time) + '<span class="ap">' + c.ap + '</span>';
    el('date').textContent = fmtDateLong.format(n);
    const key = n.getFullYear()+'-'+n.getMonth()+'-'+n.getDate()+'-'+n.getHours()+'-'+n.getMinutes();
    const sig = loaded ? stateSig() : '';
    const minuteChanged = key !== lastKey;
    if(minuteChanged || (loaded && sig !== lastSig)){
      lastKey = key; lastSig = sig;
      if(startOfDay(n).getTime() !== viewDate.getTime()) viewDate = startOfDay(n); // cambio de día
      if(minuteChanged) checkTimezone();
      if(loaded) renderAll(); // la barra de "ahora" avanza cada minuto y los finalizados se actualizan al instante
    }
  }

  // Mantener la pantalla encendida
  let wake = null;
  async function keepAwake(){
    try{
      if('wakeLock' in navigator){
        wake = await navigator.wakeLock.request('screen');
        wake.addEventListener('release', () => { wake = null; });
      }
    }catch(e){}
  }
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') keepAwake(); });

  setupFilters();
  renderAll();
  scrollBoxes().forEach(autoScroll);
  tick();
  setInterval(tick, 1000);
  setInterval(refresh, 60000); // respaldo por si algún aviso en tiempo real se pierde
  window.addEventListener('online', refresh);
  connect();
  refresh();
  keepAwake();
})();
