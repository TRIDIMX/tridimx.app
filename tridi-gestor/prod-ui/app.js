/* Control de Producción · TRIDI MX Gestor (basado en tridi-scheduler v8) */
fetch('/api/me', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(me => {
  const a = document.getElementById('lnk-pantalla');
  if (a && (!me || (me.role !== 'admin' && !(me.modules || []).includes('taller')))) a.remove();
}).catch(() => {});
if (window.self !== window.top) document.documentElement.classList.add('embedded');
/* Clientes y proyectos del Gestor para las listas de «Nueva solicitud» */
window.GESTOR_CAT = { clientes: [], proyectos: [] };
fetch('/api/prod/catalog', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(c => { if (c) window.GESTOR_CAT = c; }).catch(() => {});

(function(){
  /* ---------- Constantes y valores por defecto ---------- */
  const PALETTE = ['#F26522','#2EC4A5','#B7791F','#5B6EE1','#E5484D','#8E6FF7'];
  const DAY_NAMES = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const DAY_ORDER = [1,2,3,4,5,6,0]; // el horario se guarda por getDay() (0 = domingo)
  // '3d' = Impresión 3D FDM (el valor interno se conserva para no migrar datos existentes).
  const TIPO_LABEL = {'3d':'Impresión 3D FDM','sla':'Impresión 3D SLA','laser':'Grabado láser','uvdtf':'Impresión UV DTF'};
  const TIPO_SHORT = {'3d':'3D FDM','sla':'3D SLA','laser':'Láser','uvdtf':'UV DTF'};
  const tipoClass = t => t === 'laser' ? 'laser' : (t === 'sla' ? 'sla' : (t === 'uvdtf' ? 'uvdtf' : 't3d'));
  const VISIBLE_DAYS = 3;

  // Los ids de las máquinas originales se conservan para no perder los trabajos ya guardados.
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
  // Índice = getDay(). Por defecto: lunes a viernes 09:00–18:00.
  const DEFAULT_HORARIO = [0,1,2,3,4,5,6].map(d => ({activo: d>=1 && d<=5, inicio:'09:00', fin:'18:00'}));

  /* ---------- Estado ---------- */
  let printers = [];
  let horario = [];
  let jobs = [];
  let viewDate = startOfDay(new Date());
  let editingJobId = null;
  let editingPrinterId = null;
  let dataReady = false; // evita sobrescribir datos del servidor si la carga falló

  /* ---------- Helpers ---------- */
  const el = id => document.getElementById(id);
  const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function startOfDay(d){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
  function addDays(d, n){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()+n); }
  function pad(n){ return String(n).padStart(2,'0'); }
  function fmtDate(d){ return pad(d.getDate())+'/'+pad(d.getMonth()+1)+'/'+d.getFullYear(); }
  function fmtDateTime(d){ return fmtDate(d)+' '+pad(d.getHours())+':'+pad(d.getMinutes()); }
  function toDateInputValue(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function toTimeInputValue(d){ return pad(d.getHours())+':'+pad(d.getMinutes()); }
  function parseHM(s){ const [h,m] = String(s||'0:0').split(':').map(Number); return (h||0)*60 + (m||0); }
  function displayName(p){
    const a = (p.alias||'').trim();
    if(a) return a;
    return [p.marca, p.modelo].filter(Boolean).join(' ').trim() || p.id;
  }
  const collator = new Intl.Collator('es', {sensitivity:'base', numeric:true});
  // Proyectos registrados = los que tienen al menos un trabajo (sin duplicar por mayúsculas/minúsculas).
  function projectNames(){
    const map = new Map();
    (window.GESTOR_CAT && GESTOR_CAT.proyectos || []).forEach(n => { n = String(n||'').trim(); if(n && !map.has(n.toLowerCase())) map.set(n.toLowerCase(), n); });
    jobs.forEach(j => {
      const n = (j.proyecto||'').trim();
      if(n && !map.has(n.toLowerCase())) map.set(n.toLowerCase(), n);
    });
    return [...map.values()].sort(collator.compare);
  }
  function projectOptions(selected){
    const sel = (selected||'').toLowerCase();
    return '<option value="">— Sin proyecto —</option>' +
      projectNames().map(n => '<option value="'+esc(n)+'"'+(n.toLowerCase()===sel?' selected':'')+'>'+esc(n)+'</option>').join('') +
      '<option value="__nuevo__">➕ Registrar proyecto nuevo…</option>';
  }
  // Devuelve {name} o {error}. Si el nombre nuevo ya existe (sin importar mayúsculas), reutiliza el existente.
  function resolveProject(selectEl, newEl){
    if(selectEl.value !== '__nuevo__') return {name: selectEl.value};
    const n = newEl.value.trim().replace(/\s+/g, ' ');
    if(!n) return {error:'Escribe el nombre del proyecto nuevo o elige uno de la lista.'};
    const existing = projectNames().find(x => x.toLowerCase() === n.toLowerCase());
    return {name: existing || n};
  }

  // Clientes: los ya registrados en los trabajos (para autocompletar y respetar mayúsculas).
  function clientNames(){
    const map = new Map();
    (window.GESTOR_CAT && GESTOR_CAT.clientes || []).forEach(n => { n = String(n||'').trim(); if(n && !map.has(n.toLowerCase())) map.set(n.toLowerCase(), n); });
    jobs.forEach(j => { const n = (j.cliente||'').trim(); if(n && !map.has(n.toLowerCase())) map.set(n.toLowerCase(), n); });
    return [...map.values()].sort((a,b) => collator.compare(a,b));
  }
  function clientOptions(selected){
    const sel = (selected||'').toLowerCase();
    return '<option value="">— Sin cliente —</option>' +
      clientNames().map(n => '<option value="'+esc(n)+'"'+(n.toLowerCase()===sel?' selected':'')+'>'+esc(n)+'</option>').join('') +
      '<option value="__nuevo__">➕ Registrar cliente nuevo…</option>';
  }
  // Devuelve {name} o {error}; si el nombre nuevo ya existe (sin importar mayúsculas) reutiliza el existente.
  function resolveClient(selectEl, newEl){
    if(selectEl.value !== '__nuevo__') return {name: selectEl.value};
    const n = newEl.value.trim().replace(/\s+/g, ' ');
    if(!n) return {error:'Escribe el nombre del cliente nuevo o elige uno de la lista.'};
    const existing = clientNames().find(x => x.toLowerCase() === n.toLowerCase());
    return {name: existing || n};
  }
  function syncFormClient(){ clienteNuevoWrap.classList.toggle('hidden', clienteEl.value !== '__nuevo__'); }
  // URL del presupuesto: acepta con o sin "https://"; solo http/https.
  function resolveUrl(raw){
    let v = String(raw||'').trim();
    if(!v) return {url:''};
    if(!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = 'https://' + v;
    try{
      const u = new URL(v);
      if(u.protocol !== 'http:' && u.protocol !== 'https:') return {error:'La URL del presupuesto debe empezar con http:// o https://'};
      if(!u.hostname.includes('.') && u.hostname !== 'localhost') return {error:'La URL del presupuesto no es válida.'};
      return {url:u.href};
    }catch(e){ return {error:'La URL del presupuesto no es válida.'}; }
  }
  function showMsgIn(node, text, kind){ node.textContent = text; node.className = 'msg show ' + kind; }
  function hideMsgIn(node){ node.className = 'msg'; }

  const archivoEl = el('f-archivo'), duracionEl = el('f-duracion'), repetirEl = el('f-repetir'),
        tipoEl = el('f-tipo'), multicolorEl = el('f-multicolor'), multicolorWrap = el('f-multicolor-wrap'),
        asignarEl = el('f-asignar'), impresoraWrap = el('f-impresora-wrap'), impresoraEl = el('f-impresora'),
        fechaEl = el('f-fecha'), horaEl = el('f-hora'), msgEl = el('msg'), jobsMsgEl = el('jobs-msg'),
        jobsListEl = el('jobs-list'), tlTable = el('tl-table'), tlDateLabel = el('tl-date-label'),
        clienteEl = el('f-cliente'), clienteNuevoEl = el('f-cliente-nuevo'), clienteNuevoWrap = el('f-cliente-nuevo-wrap'), presupuestoEl = el('f-presupuesto'), proyectoEl = el('f-proyecto'), proyectoNuevoEl = el('f-proyecto-nuevo'), proyectoNuevoWrap = el('f-proyecto-nuevo-wrap'),
        jobsSortEl = el('jobs-sort');

  const showMsg = (t,k) => showMsgIn(msgEl,t,k), hideMsg = () => hideMsgIn(msgEl);

  /* ---------- Persistencia ---------- */
  function normalizeJob(j){
    if(!Array.isArray(j.segments) || j.segments.length === 0){
      j.segments = [{start:j.start, end:j.end}];
    }
    if(!j.tipoTrabajo) j.tipoTrabajo = '3d';
    j.proyecto = typeof j.proyecto === 'string' ? j.proyecto.trim() : '';
    j.cliente = typeof j.cliente === 'string' ? j.cliente.trim() : '';
    j.presupuestoUrl = typeof j.presupuestoUrl === 'string' ? j.presupuestoUrl.trim() : '';
    return j;
  }

  async function loadAll(){
    let cfgOk = false, jobsOk = false;
    try{
      const r = await fetch('/api/prod/config');
      if(!r.ok) throw new Error('bad');
      const c = await r.json();
      const hasConfig = Array.isArray(c.printers) && Array.isArray(c.horario) && c.horario.length === 7;
      printers = hasConfig ? c.printers : DEFAULT_PRINTERS.map(p=>({...p}));
      horario = hasConfig ? c.horario : DEFAULT_HORARIO.map(h=>({...h}));
      sinSup = !!c.sinSupervision;
      cfgOk = true;
      if(!hasConfig) await saveConfig(); // primera vez: guarda los valores por defecto
    }catch(e){
      printers = DEFAULT_PRINTERS.map(p=>({...p}));
      horario = DEFAULT_HORARIO.map(h=>({...h}));
    }
    try{
      const r = await fetch('/api/prod/jobs');
      if(!r.ok) throw new Error('bad');
      jobs = (await r.json()).map(normalizeJob);
      jobsOk = true;
    }catch(e){
      jobs = [];
    }
    dataReady = cfgOk && jobsOk;
    if(!dataReady){
      showMsg('No se pudo conectar con el servidor de datos. Recarga la página; mientras tanto no se puede guardar nada.', 'err');
    }
  }

  let sinSup = false;
  function renderSup(){
    const t = el('sup-toggle'); if(!t) return;
    t.checked = sinSup;
    el('sup-label').classList.toggle('on', sinSup);
    el('sup-banner').classList.toggle('show', sinSup);
  }
  async function toggleSup(){
    const want = el('sup-toggle').checked;
    if(!dataReady){ el('sup-toggle').checked = sinSup; showMsg('Sin conexión con el servidor de datos. Recarga la página.', 'err'); return; }
    try{
      const r = await fetch('/api/prod/supervision', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({on:want})});
      if(!r.ok) throw new Error('bad');
      sinSup = want;
    }catch(e){ el('sup-toggle').checked = sinSup; showMsg('No se pudo cambiar el modo sin supervisión.', 'err'); return; }
    renderSup();
    await refreshFromServer(true);
  }

  async function saveJobs(){
    try{
      const r = await fetch('/api/prod/jobs', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(jobs)});
      return r.ok;
    }catch(e){ return false; }
  }
  async function saveConfig(){
    try{
      const r = await fetch('/api/prod/config', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({printers, horario})});
      return r.ok;
    }catch(e){ return false; }
  }

  /* ---------- Horario del taller y motor de asignación ---------- */
  // Ventana laboral de un día calendario (o null si no se trabaja).
  function windowFor(day){
    const cfg = horario[day.getDay()];
    if(!cfg || !cfg.activo) return null;
    const s = parseHM(cfg.inicio), e = parseHM(cfg.fin);
    if(!(e > s)) return null;
    const y = day.getFullYear(), m = day.getMonth(), d = day.getDate();
    return { start:new Date(y,m,d,Math.floor(s/60),s%60), end:new Date(y,m,d,Math.floor(e/60),e%60) };
  }
  function hasWorkTime(){
    return horario.some(h => h.activo && parseHM(h.fin) > parseHM(h.inicio));
  }
  // Primer instante >= t que cae dentro de horario de taller.
  function nextWorkTime(t){
    let d = startOfDay(t);
    for(let i=0; i<400; i++){
      const w = windowFor(d);
      if(w && t < w.end) return new Date(Math.max(t.getTime(), w.start.getTime()));
      d = addDays(d, 1);
    }
    return null;
  }
  // Reparte la duración en tramos de horario laboral, pausando fuera de horario.
  function buildSegments(start, durationMs){
    const segs = [];
    let remaining = durationMs;
    let cur = nextWorkTime(start);
    let guard = 0;
    while(cur && remaining > 0 && guard++ < 5000){
      const w = windowFor(startOfDay(cur));
      const take = Math.min(remaining, w.end.getTime() - cur.getTime());
      segs.push({start:new Date(cur), end:new Date(cur.getTime()+take)});
      remaining -= take;
      if(remaining > 0) cur = nextWorkTime(w.end);
    }
    return remaining > 0 ? null : segs;
  }
  // Primer hueco donde cabe el trabajo completo sin cruzarse con los intervalos ocupados (busy, en ms).
  function findSlotAmong(busy, requestedStart, durationMs){
    let candidate = nextWorkTime(requestedStart);
    for(let g=0; candidate && g<2000; g++){
      const segs = buildSegments(candidate, durationMs);
      if(!segs) return null;
      let conflictEnd = null;
      for(const s of segs){
        for(const b of busy){
          if(s.start.getTime() < b.end && s.end.getTime() > b.start){
            if(conflictEnd === null || b.end > conflictEnd) conflictEnd = b.end;
          }
        }
      }
      if(conflictEnd === null) return segs;
      candidate = nextWorkTime(new Date(conflictEnd));
    }
    return null;
  }
  // Primer hueco en la máquina donde cabe el trabajo completo sin cruzarse con otros.
  function findSlot(printerId, requestedStart, durationMs, excludeJobId){
    const busy = [];
    jobs.forEach(j=>{
      if(j.printerId !== printerId || j.id === excludeJobId) return;
      j.segments.forEach(s => busy.push({start:new Date(s.start).getTime(), end:new Date(s.end).getTime()}));
    });
    return findSlotAmong(busy, requestedStart, durationMs);
  }
  const jobStart = j => new Date(j.segments[0].start);
  const jobEnd = j => new Date(j.segments[j.segments.length-1].end);
  function applySegments(job, segs){
    job.segments = segs.map(s => ({start:s.start.toISOString(), end:s.end.toISOString()}));
    delete job.cierre; // reprogramado: vuelve a empezar su ciclo
    job.start = job.segments[0].start;
    job.end = job.segments[job.segments.length-1].end;
  }
  const jobDurationMs = j => j.segments.reduce((a, s) => a + (new Date(s.end) - new Date(s.start)), 0);
  const overlapsAny = (segs, busy) => segs.some(s => {
    const a = new Date(s.start).getTime(), b = new Date(s.end).getTime();
    return busy.some(x => a < x.end && b > x.start);
  });
  // Plan de edición "con recorrido": el trabajo editado conserva el horario pedido y los trabajos
  // que le siguen en la máquina se empujan hacia adelante solo si se empalman, en cadena y en orden,
  // respetando el horario del taller. Los huecos que quedan en blanco se respetan.
  // Los trabajos que iban antes del editado (o antes de la hora pedida, si cambia de máquina) no se tocan.
  function planEditWithShift(job, printerId, requestedStart, durationMs, pivotOverride){
    const sameMachine = job.printerId === printerId;
    const pivot = pivotOverride != null ? pivotOverride : (sameMachine ? jobStart(job).getTime() : requestedStart.getTime());
    const others = jobs.filter(o => o.printerId === printerId && o.id !== job.id)
                       .sort((a,b) => jobStart(a) - jobStart(b));
    const busy = [];
    const addBusy = segs => segs.forEach(s => busy.push({start:new Date(s.start).getTime(), end:new Date(s.end).getTime()}));
    others.filter(o => jobStart(o).getTime() < pivot).forEach(o => addBusy(o.segments));
    const edited = findSlotAmong(busy, requestedStart, durationMs);
    if(!edited) return null;
    addBusy(edited);
    let cursor = edited[edited.length-1].end.getTime();
    const moved = [];
    for(const m of others.filter(o => jobStart(o).getTime() >= pivot)){
      if(jobStart(m).getTime() >= cursor && !overlapsAny(m.segments, busy)){
        addBusy(m.segments);
        cursor = Math.max(cursor, jobEnd(m).getTime());
        continue;
      }
      const segs = findSlotAmong(busy, new Date(Math.max(cursor, jobStart(m).getTime())), jobDurationMs(m));
      if(!segs) return null;
      moved.push({job:m, segs});
      addBusy(segs);
      cursor = segs[segs.length-1].end.getTime();
    }
    return {editedSegs:edited, moved};
  }
  function nextBatchColorIndex(){
    return new Set(jobs.map(j=>j.batchId || j.id)).size % PALETTE.length;
  }
  function eligiblePrinters(tipo, multicolor){
    return printers.filter(p => p.tipo === tipo && !p.mantenimiento && (!multicolor || p.multicolor));
  }
  function requireReady(showFn){
    if(dataReady) return true;
    showFn('Sin conexión con el servidor de datos. Recarga la página antes de guardar cambios.', 'err');
    return false;
  }

  /* ---------- Formulario de nueva solicitud ---------- */
  function printerOptions(tipo, selectedId){
    const list = printers.filter(p => p.tipo === tipo);
    if(list.length === 0) return '<option value="">(no hay máquinas de este tipo)</option>';
    return list.map(p => {
      const mant = p.mantenimiento && p.id !== selectedId; // la máquina actual de un trabajo se conserva elegible
      return '<option value="'+esc(p.id)+'"'+(p.id===selectedId?' selected':'')+(mant?' disabled':'')+'>'+esc(displayName(p))+(p.multicolor?' (MC)':'')+(p.mantenimiento?' · en mantenimiento':'')+'</option>';
    }).join('');
  }
  function syncFormProject(){
    proyectoNuevoWrap.classList.toggle('hidden', proyectoEl.value !== '__nuevo__');
  }
  function refreshProjectSelects(){
    clienteEl.innerHTML = clientOptions(clienteEl.value === '__nuevo__' ? '' : clienteEl.value);
    eCliente.innerHTML = clientOptions(eCliente.value === '__nuevo__' ? '' : eCliente.value);
    syncFormClient();
    proyectoEl.innerHTML = projectOptions(proyectoEl.value === '__nuevo__' ? '' : proyectoEl.value);
    eProyecto.innerHTML = projectOptions(eProyecto.value === '__nuevo__' ? '' : eProyecto.value);
    syncFormProject();
  }
  const checkedMachineIds = () => [...impresoraEl.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value);
  function machineChecks(tipo, keep){
    const list = printers.filter(p => p.tipo === tipo);
    if(list.length === 0) return '<span class="empty">(no hay máquinas de este tipo)</span>';
    return list.map(p => {
      const mant = !!p.mantenimiento;
      return '<label class="'+(mant?'dis':'')+'" title="'+(mant?'En mantenimiento: no recibe trabajos':'')+'"><input type="checkbox" value="'+esc(p.id)+'"'+(mant?' disabled':(keep.includes(p.id)?' checked':''))+'>'+
        esc(displayName(p))+(p.multicolor?' (MC)':'')+(mant?' · en mantenimiento':'')+'</label>';
    }).join('');
  }
  function refreshFormPrinterSelect(){
    impresoraEl.innerHTML = machineChecks(tipoEl.value, checkedMachineIds());
  }
  function syncFormVisibility(){
    impresoraWrap.classList.toggle('hidden', asignarEl.value !== 'manual');
    const es3d = tipoEl.value === '3d';
    multicolorWrap.classList.toggle('hidden', !es3d);
    if(!es3d) multicolorEl.value = 'no';
  }
  function resetForm(){
    archivoEl.value = '';
    duracionEl.value = '';
    repetirEl.value = 1;
    tipoEl.value = '3d';
    multicolorEl.value = 'no';
    asignarEl.value = 'auto';
    proyectoEl.innerHTML = projectOptions('');
    proyectoNuevoEl.value = '';
    clienteEl.innerHTML = clientOptions('');
    clienteNuevoEl.value = '';
    presupuestoEl.value = '';
    syncFormClient();
    syncFormProject();
    syncFormVisibility();
    impresoraEl.innerHTML = machineChecks('3d', []);
    const now = new Date();
    fechaEl.value = toDateInputValue(now);
    horaEl.value = toTimeInputValue(now);
    hideMsg();
  }

  async function handleAceptar(){
    hideMsg();
    if(!requireReady(showMsg)) return;
    const tipoTrabajo = tipoEl.value;
    const archivo = archivoEl.value.trim();
    const duracion = parseFloat(duracionEl.value);
    const repetir = parseInt(repetirEl.value, 10) || 1;
    const multicolor = tipoTrabajo === '3d' && multicolorEl.value === 'si';
    const modoAuto = asignarEl.value === 'auto';
    const fecha = fechaEl.value, hora = horaEl.value;

    if(!archivo){ showMsg('Ingresa el nombre del archivo.', 'err'); return; }
    if(!duracion || duracion <= 0){ showMsg('Ingresa una duración válida.', 'err'); return; }
    if(!fecha || !hora){ showMsg('Ingresa fecha y hora de inicio.', 'err'); return; }
    const requestedStart = new Date(fecha + 'T' + hora);
    if(isNaN(requestedStart.getTime())){ showMsg('Fecha u hora inválida.', 'err'); return; }
    if(!hasWorkTime()){ showMsg('El horario del taller no tiene ningún día activo. Configúralo en "Horario del taller".', 'err'); return; }
    const proy = resolveProject(proyectoEl, proyectoNuevoEl);
    if(proy.error){ showMsg(proy.error, 'err'); return; }
    const cli = resolveClient(clienteEl, clienteNuevoEl);
    if(cli.error){ showMsg(cli.error, 'err'); return; }
    const cliente = cli.name;
    const presu = resolveUrl(presupuestoEl.value);
    if(presu.error){ showMsg(presu.error, 'err'); return; }

    const eligible = eligiblePrinters(tipoTrabajo, multicolor);
    if(eligible.length === 0){
      const enMant = printers.some(p => p.tipo === tipoTrabajo && p.mantenimiento && (!multicolor || p.multicolor));
      showMsg(enMant ? 'Todas las máquinas compatibles están en mantenimiento.' :
        (multicolor ? 'No hay impresoras 3D multicolor dadas de alta.' : 'No hay máquinas de tipo "' + TIPO_LABEL[tipoTrabajo] + '" dadas de alta.'), 'err');
      return;
    }

    let pool = eligible;
    if(!modoAuto){
      const ids = checkedMachineIds();
      if(ids.length === 0){ showMsg('Marca al menos una máquina.', 'err'); return; }
      pool = [];
      for(const id of ids){
        const p = printers.find(x => x.id === id);
        if(!p) continue;
        if(p.mantenimiento){ showMsg(displayName(p) + ' está en mantenimiento. Desmárcala o cambia a Automático.', 'err'); return; }
        if(p.tipo !== tipoTrabajo){ showMsg(displayName(p) + ' no es de tipo ' + TIPO_LABEL[tipoTrabajo] + '.', 'err'); return; }
        if(multicolor && !p.multicolor){ showMsg(displayName(p) + ' no soporta multicolor. Desmárcala o elige máquinas MC.', 'err'); return; }
        pool.push(p);
      }
      if(pool.length === 0){ showMsg('Marca al menos una máquina.', 'err'); return; }
    }

    // Cada copia va a la máquina del grupo con la disponibilidad más próxima (Automático: todas las elegibles;
    // Manual: solo las marcadas), así una tanda se reparte entre varias máquinas.
    const unitMs = duracion * 3600 * 1000;
    const batchId = 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
    const colorIdx = nextBatchColorIndex();
    const added = [];
    const assignments = [];
    let failed = false;

    for(let i=0; i<repetir; i++){
      let printerToUse = null, segs = null;
      for(const p of pool){
        const s2 = findSlot(p.id, requestedStart, unitMs, null);
        if(s2 && (!segs || s2[0].start.getTime() < segs[0].start.getTime())){ segs = s2; printerToUse = p; }
      }
      if(!segs){ failed = true; break; }
      const job = {
        id:'j_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
        batchId,
        archivo: repetir > 1 ? archivo + ' (' + (i+1) + '/' + repetir + ')' : archivo,
        tipoTrabajo, duracionHrs: duracion, repeatIndex:i+1, repeatTotal:repetir, multicolor,
        proyecto: proy.name, cliente, presupuestoUrl: presu.url,
        printerId: printerToUse.id, colorIdx
      };
      applySegments(job, segs);
      jobs.push(job);
      added.push(job);
      assignments.push({printerName: displayName(printerToUse), start: segs[0].start, end: segs[segs.length-1].end});
    }

    if(failed){
      jobs = jobs.filter(j => !added.includes(j));
      showMsg('No se encontró espacio en el horario del taller para este trabajo.', 'err');
      return;
    }
    if(!(await saveJobs())){
      jobs = jobs.filter(j => !added.includes(j));
      showMsg('No se pudo guardar. Verifica la conexión con el servidor.', 'err');
      return;
    }

    const names = [...new Set(assignments.map(a => a.printerName))];
    const lastEnd = new Date(Math.max(...assignments.map(a => a.end.getTime())));
    const firstStart = new Date(Math.min(...assignments.map(a => a.start.getTime())));
    const delayed = assignments.some(a => a.start.getTime() > requestedStart.getTime());
    let summary;
    if(names.length > 1){
      summary = 'Repartido en ' + names.length + ' máquinas (' + names.join(', ') + ') · entrega estimada ' + fmtDateTime(lastEnd);
    }else{
      summary = (delayed ? 'Reprogramado al siguiente espacio disponible en horario de taller. ' : '') +
        'Asignado a ' + names[0] + ' · inicia ' + fmtDateTime(firstStart) + ' · termina ' + fmtDateTime(lastEnd);
    }
    showMsg(summary + (proy.name ? ' · Proyecto: ' + proy.name : '') + (cliente ? ' · Cliente: ' + cliente : ''), 'ok');
    // El proyecto recién registrado ya aparece en las listas: se queda elegido para capturar más trabajos del mismo proyecto.
    proyectoNuevoEl.value = '';
    refreshProjectSelects();
    proyectoEl.value = proy.name;
    syncFormProject();
    viewDate = startOfDay(firstStart);
    renderTimeline();
    renderJobsList();
  }

  /* ---------- Eliminar ---------- */
  async function deleteJob(id){
    if(!requireReady(m => showMsgIn(jobsMsgEl, m, 'err'))) return;
    const prev = jobs;
    jobs = jobs.filter(j => j.id !== id);
    if(!(await saveJobs())){
      jobs = prev;
      showMsgIn(jobsMsgEl, 'No se pudo eliminar. Verifica la conexión con el servidor.', 'err');
      return;
    }
    hideMsgIn(jobsMsgEl);
    renderTimeline();
    renderJobsList();
  }
  async function clearAllJobs(){
    if(!requireReady(m => showMsgIn(jobsMsgEl, m, 'err'))) return;
    if(!confirm('¿Vaciar todos los trabajos programados? Esta acción no se puede deshacer.')) return;
    const prev = jobs;
    jobs = [];
    if(!(await saveJobs())){
      jobs = prev;
      showMsgIn(jobsMsgEl, 'No se pudo vaciar. Verifica la conexión con el servidor.', 'err');
      return;
    }
    renderTimeline();
    renderJobsList();
  }

  /* ---------- Edición de trabajos ---------- */
  const modalEl = el('modal-edit'), eMsgEl = el('e-msg'),
        eTipo = el('e-tipo'), eArchivo = el('e-archivo'), eDuracion = el('e-duracion'),
        eMulti = el('e-multicolor'), eMultiWrap = el('e-multicolor-wrap'), ePrinter = el('e-impresora'),
        eFecha = el('e-fecha'), eHora = el('e-hora'),
        eProyecto = el('e-proyecto'), eProyectoNuevo = el('e-proyecto-nuevo'), eProyectoNuevoWrap = el('e-proyecto-nuevo-wrap'),
        eCliente = el('e-cliente'), eClienteNuevo = el('e-cliente-nuevo'), eClienteNuevoWrap = el('e-cliente-nuevo-wrap'), ePresupuesto = el('e-presupuesto'), eLoteWrap = el('e-lote-wrap'), eLote = el('e-lote'), eLoteTxt = el('e-lote-txt'), eRecorrer = el('e-recorrer');

  // Muestra/oculta "proyecto nuevo" y la opción de aplicar el proyecto a todo el lote.
  function syncEditProject(){
    const isNew = eProyecto.value === '__nuevo__';
    eProyectoNuevoWrap.classList.toggle('hidden', !isNew);
    syncEditLote();
  }
  function syncEditClient(){ eClienteNuevoWrap.classList.toggle('hidden', eCliente.value !== '__nuevo__'); syncEditLote(); }
  function syncEditLote(){
    const isNew = eProyecto.value === '__nuevo__';
    const j = jobs.find(x => x.id === editingJobId);
    const others = j && j.batchId ? jobs.filter(o => o.batchId === j.batchId && o.id !== j.id).length : 0;
    const chosen = (isNew ? eProyectoNuevo.value.trim() : eProyecto.value).toLowerCase();
    const projDiffers = !!j && (isNew ? chosen !== '' : chosen !== (j.proyecto||'').toLowerCase());
    const cliChosen = (eCliente.value === '__nuevo__' ? eClienteNuevo.value.trim() : eCliente.value).toLowerCase();
    const cliDiffers = !!j && (eCliente.value === '__nuevo__' ? cliChosen !== '' : cliChosen !== (j.cliente||'').toLowerCase());
    const urlDiffers = !!j && ePresupuesto.value.trim() !== (j.presupuestoUrl||'');
    const show = others > 0 && (projDiffers || cliDiffers || urlDiffers);
    eLoteWrap.classList.toggle('hidden', !show);
    if(show) eLoteTxt.textContent = 'Aplicar también a las otras ' + others + (others === 1 ? ' copia' : ' copias') + ' del lote (proyecto, cliente y presupuesto que cambiaste)';
  }

  function syncEditVisibility(){
    const es3d = eTipo.value === '3d';
    eMultiWrap.classList.toggle('hidden', !es3d);
    if(!es3d) eMulti.value = 'no';
  }
  function openEdit(id){
    const j = jobs.find(x => x.id === id);
    if(!j) return;
    editingJobId = id;
    hideMsgIn(eMsgEl);
    eTipo.value = j.tipoTrabajo;
    eArchivo.value = j.archivo;
    eDuracion.value = j.duracionHrs;
    eMulti.value = j.multicolor ? 'si' : 'no';
    syncEditVisibility();
    ePrinter.innerHTML = printerOptions(j.tipoTrabajo, j.printerId);
    eProyecto.innerHTML = projectOptions(j.proyecto);
    eProyectoNuevo.value = '';
    eCliente.innerHTML = clientOptions(j.cliente || '');
    eClienteNuevo.value = '';
    syncEditClient();
    ePresupuesto.value = j.presupuestoUrl || '';
    eLote.checked = true;
    eRecorrer.checked = true;
    syncEditProject();
    const s = jobStart(j);
    eFecha.value = toDateInputValue(s);
    eHora.value = toTimeInputValue(s);
    modalEl.classList.add('show');
  }
  function closeEdit(){
    modalEl.classList.remove('show');
    editingJobId = null;
  }
  async function saveEdit(){
    hideMsgIn(eMsgEl);
    if(!requireReady(m => showMsgIn(eMsgEl, m, 'err'))) return;
    const j = jobs.find(x => x.id === editingJobId);
    if(!j){ closeEdit(); return; }

    const tipoTrabajo = eTipo.value;
    const archivo = eArchivo.value.trim();
    const duracion = parseFloat(eDuracion.value);
    const multicolor = tipoTrabajo === '3d' && eMulti.value === 'si';
    const printer = printers.find(p => p.id === ePrinter.value);
    const fecha = eFecha.value, hora = eHora.value;

    if(!archivo){ showMsgIn(eMsgEl, 'Ingresa el nombre del archivo.', 'err'); return; }
    if(!duracion || duracion <= 0){ showMsgIn(eMsgEl, 'Ingresa una duración válida.', 'err'); return; }
    if(!fecha || !hora){ showMsgIn(eMsgEl, 'Ingresa fecha y hora de inicio.', 'err'); return; }
    if(!printer){ showMsgIn(eMsgEl, 'Selecciona una máquina.', 'err'); return; }
    if(printer.tipo !== tipoTrabajo){ showMsgIn(eMsgEl, displayName(printer) + ' no es de tipo ' + TIPO_LABEL[tipoTrabajo] + '.', 'err'); return; }
    if(multicolor && !printer.multicolor){ showMsgIn(eMsgEl, displayName(printer) + ' no soporta multicolor.', 'err'); return; }
    if(printer.mantenimiento && printer.id !== j.printerId){ showMsgIn(eMsgEl, displayName(printer) + ' está en mantenimiento.', 'err'); return; }
    if(!hasWorkTime()){ showMsgIn(eMsgEl, 'El horario del taller no tiene ningún día activo.', 'err'); return; }

    const proy = resolveProject(eProyecto, eProyectoNuevo);
    if(proy.error){ showMsgIn(eMsgEl, proy.error, 'err'); return; }
    const cli = resolveClient(eCliente, eClienteNuevo);
    if(cli.error){ showMsgIn(eMsgEl, cli.error, 'err'); return; }
    const cliente = cli.name;
    const presu = resolveUrl(ePresupuesto.value);
    if(presu.error){ showMsgIn(eMsgEl, presu.error, 'err'); return; }
    const changed = {proyecto: proy.name !== (j.proyecto||''), cliente: cliente !== (j.cliente||''), presupuestoUrl: presu.url !== (j.presupuestoUrl||'')};

    const requestedStart = new Date(fecha + 'T' + hora);
    if(isNaN(requestedStart.getTime())){ showMsgIn(eMsgEl, 'Fecha u hora inválida.', 'err'); return; }
    const durMs = duracion * 3600 * 1000;
    const minute = t => Math.floor(t / 60000);
    // Si no cambió máquina, hora de inicio ni duración, los tramos se conservan tal cual (renombrar no mueve nada).
    const timeChanged = j.printerId !== printer.id ||
      minute(requestedStart.getTime()) !== minute(jobStart(j).getTime()) ||
      Math.abs(durMs - jobDurationMs(j)) > 1000;

    const prevJobs = JSON.parse(JSON.stringify(jobs));
    let segs = null, movedCount = 0;
    if(timeChanged){
      if(eRecorrer.checked){
        const plan = planEditWithShift(j, printer.id, requestedStart, durMs);
        if(!plan){ showMsgIn(eMsgEl, 'No se encontró espacio en el horario del taller.', 'err'); return; }
        segs = plan.editedSegs;
        plan.moved.forEach(m => applySegments(m.job, m.segs));
        movedCount = plan.moved.length;
      }else{
        segs = findSlot(printer.id, requestedStart, durMs, j.id);
        if(!segs){ showMsgIn(eMsgEl, 'No se encontró espacio en el horario del taller.', 'err'); return; }
      }
    }
    Object.assign(j, {archivo, tipoTrabajo, multicolor, duracionHrs:duracion, printerId:printer.id, proyecto:proy.name, cliente, presupuestoUrl:presu.url});
    if(segs) applySegments(j, segs);

    let batchCount = 0;
    if(j.batchId && !eLoteWrap.classList.contains('hidden') && eLote.checked){
      jobs.forEach(o => { if(o.id !== j.id && o.batchId === j.batchId){
        if(changed.proyecto) o.proyecto = proy.name;
        if(changed.cliente) o.cliente = cliente;
        if(changed.presupuestoUrl) o.presupuestoUrl = presu.url;
        batchCount++;
      } });
    }

    if(!(await saveJobs())){
      jobs = prevJobs;
      showMsgIn(eMsgEl, 'No se pudo guardar. Verifica la conexión con el servidor.', 'err');
      return;
    }
    const bumped = !!segs && segs[0].start.getTime() > requestedStart.getTime();
    closeEdit();
    refreshProjectSelects();
    viewDate = startOfDay(jobStart(j));
    renderTimeline();
    renderJobsList();
    let msg = (bumped ? 'Reprogramado al siguiente espacio disponible. ' : '') +
      '"' + archivo + '" ahora corre en ' + displayName(printer) + ' de ' + fmtDateTime(jobStart(j)) + ' a ' + fmtDateTime(jobEnd(j)) + '.';
    if(movedCount) msg += ' Se recorrieron ' + movedCount + (movedCount === 1 ? ' trabajo siguiente' : ' trabajos siguientes') + ' de la misma máquina.';
    if(batchCount) msg += ' Datos aplicados también a ' + batchCount + (batchCount === 1 ? ' copia' : ' copias') + ' del lote.';
    showMsgIn(jobsMsgEl, msg, 'ok');
  }

  /* ---------- Línea de tiempo ---------- */
  function renderTimeline(){
    const lastDay = addDays(viewDate, VISIBLE_DAYS-1);
    tlDateLabel.textContent = fmtDate(viewDate) + ' – ' + fmtDate(lastDay);

    const now = new Date(), nowMs = now.getTime();
    const days = [];
    for(let d=0; d<VISIBLE_DAYS; d++) days.push(addDays(viewDate, d));
    const windows = days.map(windowFor);

    let dayHead = '<tr><th class="printer-col" rowspan="2">Máquina</th>';
    let hourHead = '<tr>';
    days.forEach((day, di) => {
      const isToday = startOfDay(now).getTime() === day.getTime();
      const off = !windows[di];
      dayHead += '<th colspan="24" class="day-col'+(isToday?' day-col-today':'')+(off?' day-col-off':'')+'">'+DAY_NAMES[day.getDay()]+' '+fmtDate(day)+(isToday?' · hoy':'')+(off?' · sin labores':'')+'</th>';
      for(let h=0; h<24; h++){
        hourHead += '<th class="hour-col'+(isToday && h===now.getHours()?' now-col':'')+'">'+pad(h)+'</th>';
      }
    });
    dayHead += '</tr>'; hourHead += '</tr>';

    let body = '<tbody>';
    for(const p of printers){
      const busyNow = jobs.some(j => j.printerId===p.id && j.segments.some(s => new Date(s.start).getTime() <= nowMs && new Date(s.end).getTime() > nowMs));
      const dotColor = p.tipo==='laser' ? '#8E6FF7' : (p.tipo==='sla' ? '#B7791F' : (p.tipo==='uvdtf' ? '#FF7AB8' : (p.multicolor ? 'var(--teal)' : '#5A6C93')));
      body += '<tr data-printer="'+esc(p.id)+'"'+(p.mantenimiento?' class="mant"':'')+'><th><span class="dot" style="background:'+dotColor+'"></span>'+esc(displayName(p))+
        '<span class="status '+(p.mantenimiento?'mant':(busyNow?'busy':''))+'">'+TIPO_SHORT[p.tipo]+' · '+(p.mantenimiento?'🔧 Mantenimiento':(busyNow?'Ocupada':'Libre'))+'</span></th>';
      const pj = jobs.filter(j => j.printerId === p.id);
      days.forEach((day, di) => {
        const w = windows[di];
        for(let h=0; h<24; h++){
          const cs = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, 0, 0, 0);
          const csMs = cs.getTime(), ceMs = csMs + 3600*1000;
          const hit = pj.find(j => j.segments.some(s => new Date(s.start).getTime() < ceMs && new Date(s.end).getTime() > csMs));
          if(hit){
            const startsHere = hit.segments.some(s => { const t = new Date(s.start).getTime(); return t >= csMs && t < ceMs; });
            const tip = hit.archivo+(hit.proyecto ? ' ['+hit.proyecto+']' : '')+(hit.cliente ? ' · Cliente: '+hit.cliente : '')+' — '+fmtDateTime(jobStart(hit))+' a '+fmtDateTime(jobEnd(hit));
            body += '<td class="cell filled" data-job="'+esc(hit.id)+'" title="'+esc(tip)+'" style="background:'+PALETTE[hit.colorIdx % PALETTE.length]+'"><span class="lbl">'+(startsHere?esc(hit.archivo):'')+'</span></td>';
          }else{
            const inWork = w && csMs < w.end.getTime() && ceMs > w.start.getTime();
            body += '<td class="cell'+(inWork?'':' off')+'"></td>';
          }
        }
      });
      body += '</tr>';
    }
    body += '</tbody>';
    tlTable.innerHTML = '<thead>'+dayHead+hourHead+'</thead>'+body;

    tlTable.querySelectorAll('td.cell.filled').forEach(td => {
      td.addEventListener('click', () => {
        if(Date.now() < suppressClickUntil) return; // venía de arrastrar
        const job = jobs.find(j => j.id === td.getAttribute('data-job'));
        if(job) openEdit(job.id);
      });
      td.addEventListener('mousedown', e => startDrag(e, td));
    });
  }

  /* ---------- Arrastrar trabajos en la línea de tiempo ---------- */
  let drag = null, suppressClickUntil = 0;
  const tlMsgEl = el('tl-msg');
  const snap15 = ms => Math.round(ms / 900000) * 900000;
  // Instante y máquina que corresponden a una celda de la línea de tiempo (con posición dentro de la hora).
  function cellInfo(td, clientX){
    const tr = td.closest('tr[data-printer]');
    if(!tr) return null;
    const cells = [...tr.querySelectorAll('td.cell')];
    const idx = cells.indexOf(td);
    if(idx < 0) return null;
    const day = addDays(viewDate, Math.floor(idx / 24)), h = idx % 24;
    const r = td.getBoundingClientRect();
    const frac = r.width > 0 ? Math.min(0.999, Math.max(0, (clientX - r.left) / r.width)) : 0;
    const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, 0, 0, 0).getTime() + frac * 3600000;
    return {printerId: tr.getAttribute('data-printer'), t, tr, cells};
  }
  function startDrag(e, td){
    if(e.button !== 0) return;
    const job = jobs.find(j => j.id === td.getAttribute('data-job'));
    const info = cellInfo(td, e.clientX);
    if(!job || !info) return;
    // Referencia de agarre: tiempo trabajado desde el inicio del trabajo hasta el punto donde se tomó.
    let offset = 0, acc = 0, found = false;
    for(const sg of job.segments){
      const a = new Date(sg.start).getTime(), b = new Date(sg.end).getTime();
      if(!found && info.t >= a && info.t < b){ offset = acc + (info.t - a); found = true; }
      acc += b - a;
    }
    if(!found) offset = Math.max(0, info.t - jobStart(job).getTime());
    drag = {jobId: job.id, x0: e.clientX, y0: e.clientY, active:false, offset, target:null, ghost:null};
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
    document.addEventListener('keydown', onDragKey);
  }
  function clearDropMarks(){
    tlTable.querySelectorAll('tr.drop-ok, tr.drop-bad').forEach(r => r.classList.remove('drop-ok','drop-bad'));
    tlTable.querySelectorAll('td.drop-prev').forEach(c => c.classList.remove('drop-prev'));
  }
  // Valida a dónde se soltaría el trabajo; devuelve {printer, start, segs, error}.
  function evalDrop(job, printerId, t){
    const printer = printers.find(p => p.id === printerId);
    if(!printer) return {error:'Máquina desconocida.'};
    // A 15 min; si cae en el bloque de 15 min de "ahora", arranca ya (la máquina pasa a Ocupada de inmediato).
    const raw = t - drag.offset, nowMs = Date.now(), fl = Math.floor(raw / 900000) * 900000;
    const start = new Date(nowMs >= fl && nowMs < fl + 900000 ? Math.floor(nowMs / 60000) * 60000 : Math.round(raw / 900000) * 900000);
    let error = null;
    if(printer.tipo !== job.tipoTrabajo) error = displayName(printer) + ' es ' + TIPO_SHORT[printer.tipo] + ': este trabajo es ' + TIPO_SHORT[job.tipoTrabajo] + '.';
    else if(job.multicolor && !printer.multicolor) error = displayName(printer) + ' no soporta multicolor.';
    else if(printer.mantenimiento && printer.id !== job.printerId) error = displayName(printer) + ' está en mantenimiento.';
    const segs = buildSegments(start, jobDurationMs(job));
    if(!error && !segs) error = 'No hay espacio en el horario del taller.';
    return {printer, start, segs, error};
  }
  function onDragMove(e){
    if(!drag) return;
    if(!drag.active){
      if(Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
      drag.active = true;
      document.body.classList.add('dragging');
      const job = jobs.find(j => j.id === drag.jobId);
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'drag-ghost';
      drag.ghost.style.background = PALETTE[job.colorIdx % PALETTE.length];
      document.body.appendChild(drag.ghost);
      tlTable.querySelectorAll('td.cell.filled').forEach(c => { if(c.getAttribute('data-job') === job.id) c.classList.add('drag-src'); });
    }
    const job = jobs.find(j => j.id === drag.jobId);
    drag.ghost.style.left = (e.clientX + 14) + 'px';
    drag.ghost.style.top = (e.clientY + 14) + 'px';
    clearDropMarks();
    const td = e.target && e.target.closest ? e.target.closest('td.cell') : null;
    const info = td ? cellInfo(td, e.clientX) : null;
    drag.target = null;
    if(!info){ drag.ghost.classList.add('bad'); drag.ghost.innerHTML = esc(job.archivo) + '<small>Suéltalo sobre una máquina de la línea de tiempo</small>'; return; }
    const ev = evalDrop(job, info.printerId, info.t);
    drag.ghost.classList.toggle('bad', !!ev.error);
    info.tr.classList.add(ev.error ? 'drop-bad' : 'drop-ok');
    if(ev.error){
      drag.ghost.innerHTML = esc(job.archivo) + '<small>' + esc(ev.error) + '</small>';
      return;
    }
    drag.target = ev;
    drag.ghost.innerHTML = esc(job.archivo) + '<small>' + esc(displayName(ev.printer)) + ' · ' + fmtDateTime(ev.start) + '</small>';
    info.cells.forEach((c, i) => {
      const cs = new Date(addDays(viewDate, Math.floor(i / 24)).getFullYear(), addDays(viewDate, Math.floor(i / 24)).getMonth(), addDays(viewDate, Math.floor(i / 24)).getDate(), i % 24).getTime();
      if(ev.segs.some(sg => sg.start.getTime() < cs + 3600000 && sg.end.getTime() > cs)) c.classList.add('drop-prev');
    });
  }
  function endDragUI(){
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    document.removeEventListener('keydown', onDragKey);
    document.body.classList.remove('dragging');
    if(drag && drag.ghost) drag.ghost.remove();
    clearDropMarks();
    tlTable.querySelectorAll('td.drag-src').forEach(c => c.classList.remove('drag-src'));
  }
  function onDragKey(e){
    if(e.key === 'Escape'){ suppressClickUntil = Date.now() + 300; endDragUI(); drag = null; }
  }
  async function onDragEnd(){
    const d = drag;
    endDragUI();
    drag = null;
    if(!d || !d.active) return;
    suppressClickUntil = Date.now() + 300;
    const job = jobs.find(j => j.id === d.jobId);
    if(!job) return;
    if(!d.target){ return; }
    await dropJob(job, d.target);
  }

  function askMoveConflict(printer, names, start){
    return new Promise(resolve => {
      const modal = el('modal-move');
      el('move-txt').textContent = 'El horario elegido en ' + displayName(printer) + ' (desde ' + fmtDateTime(start) + ') se empalma con: ' + names.join(', ') + '. ¿Quieres recorrer los demás trabajos para hacer espacio?';
      modal.classList.add('show');
      const done = v => {
        modal.classList.remove('show');
        el('move-shift').onclick = el('move-next').onclick = el('move-cancel').onclick = modal.onclick = null;
        document.removeEventListener('keydown', onKey);
        resolve(v);
      };
      const onKey = e => { if(e.key === 'Escape') done('cancel'); };
      document.addEventListener('keydown', onKey);
      el('move-shift').onclick = () => done('shift');
      el('move-next').onclick = () => done('next');
      el('move-cancel').onclick = () => done('cancel');
      modal.onclick = e => { if(e.target === modal) done('cancel'); };
    });
  }
  async function dropJob(job, target){
    hideMsgIn(tlMsgEl);
    if(!requireReady(m => showMsgIn(tlMsgEl, m, 'err'))) return;
    const {printer, start, segs} = target;
    const sameSpot = printer.id === job.printerId && segs.length === job.segments.length &&
      segs.every((sg, i) => sg.start.getTime() === new Date(job.segments[i].start).getTime() && sg.end.getTime() === new Date(job.segments[i].end).getTime());
    if(sameSpot) return;
    const others = jobs.filter(o => o.printerId === printer.id && o.id !== job.id);
    const conflicts = others.filter(o => overlapsAny(segs, o.segments.map(sg => ({start:new Date(sg.start).getTime(), end:new Date(sg.end).getTime()}))));
    let finalSegs = segs, moved = [], mode = 'free';
    if(conflicts.length){
      const choice = await askMoveConflict(printer, conflicts.map(o => o.archivo), start);
      if(choice === 'cancel') return;
      if(choice === 'shift'){
        const pivot = Math.min(start.getTime(), ...conflicts.map(o => jobStart(o).getTime()));
        const plan = planEditWithShift(job, printer.id, start, jobDurationMs(job), pivot);
        if(!plan){ showMsgIn(tlMsgEl, 'No se encontró espacio en el horario del taller para recorrer los trabajos.', 'err'); return; }
        finalSegs = plan.editedSegs; moved = plan.moved; mode = 'shift';
      }else{
        const free = findSlot(printer.id, start, jobDurationMs(job), job.id);
        if(!free){ showMsgIn(tlMsgEl, 'No se encontró espacio en el horario del taller.', 'err'); return; }
        finalSegs = free; mode = 'next';
      }
    }
    const prevJobs = JSON.parse(JSON.stringify(jobs));
    job.printerId = printer.id;
    applySegments(job, finalSegs);
    moved.forEach(m => applySegments(m.job, m.segs));
    if(!(await saveJobs())){
      jobs = prevJobs;
      showMsgIn(tlMsgEl, 'No se pudo guardar. Verifica la conexión con el servidor.', 'err');
      renderTimeline(); renderJobsList();
      return;
    }
    renderTimeline();
    renderJobsList();
    let msg = '"' + job.archivo + '" ahora corre en ' + displayName(printer) + ' de ' + fmtDateTime(jobStart(job)) + ' a ' + fmtDateTime(jobEnd(job)) + '.';
    if(mode === 'shift') msg += ' Se recorrieron ' + moved.length + (moved.length === 1 ? ' trabajo' : ' trabajos') + ' para hacer espacio.';
    if(mode === 'next') msg += ' Se colocó en el siguiente espacio libre.';
    showMsgIn(tlMsgEl, msg, 'ok');
  }

  /* ---------- Lista de trabajos ---------- */
  function renderJobsList(){
    if(finNoteFor === null) renderFinished();
    if(jobs.length === 0){
      jobsListEl.innerHTML = '<div class="empty-note">Sin trabajos programados.</div>';
      return;
    }
    const byStart = (a,b) => jobStart(a) - jobStart(b);
    const rowHtml = (j, showProject) => {
      const p = printers.find(pp => pp.id === j.printerId);
      return '<div class="job-row">' +
        '<div class="job-main"><span class="swatch" style="background:'+PALETTE[j.colorIdx % PALETTE.length]+'"></span>' +
        '<span class="job-name">'+esc(j.archivo)+'</span></div>' +
        '<div class="job-meta">' +
        (showProject && j.proyecto ? '<span class="tag proj" title="Proyecto">'+esc(j.proyecto)+'</span> ' : '') +
                (j.cliente ? '<span class="tag cli" title="Cliente">👤 '+esc(j.cliente)+'</span> ' : '') +
        (j.presupuestoUrl ? '<a class="tag cli" style="text-decoration:none" href="'+esc(j.presupuestoUrl)+'" target="_blank" rel="noopener noreferrer" title="Abrir presupuesto">Presupuesto ↗</a> ' : '') +
        '<span class="tag '+tipoClass(j.tipoTrabajo)+'">'+TIPO_SHORT[j.tipoTrabajo]+'</span> ' +
        esc(p ? displayName(p) : '?')+' · '+fmtDateTime(jobStart(j))+' → '+fmtDateTime(jobEnd(j)) +
        ' <button class="btn-ghost" data-edit="'+esc(j.id)+'">Editar</button>' +
        '<button class="btn-ghost danger" data-del="'+esc(j.id)+'">Eliminar</button></div>' +
        '</div>';
    };
    if(jobsSortEl.value === 'proyecto'){
      const groups = new Map();
      jobs.forEach(j => {
        const name = (j.proyecto||'').trim(), key = name.toLowerCase();
        if(!groups.has(key)) groups.set(key, {name, items:[]});
        groups.get(key).items.push(j);
      });
      const ordered = [...groups.values()].sort((a,b) => !a.name ? 1 : (!b.name ? -1 : collator.compare(a.name, b.name)));
      jobsListEl.innerHTML = ordered.map(g => {
        g.items.sort(byStart);
        const first = jobStart(g.items[0]);
        const last = new Date(Math.max(...g.items.map(j => jobEnd(j).getTime())));
        return '<div class="group-head"><span>'+esc(g.name || 'Sin proyecto')+'</span>' +
          '<span class="gh-meta">'+g.items.length+(g.items.length===1?' trabajo':' trabajos')+' · '+fmtDateTime(first)+' → '+fmtDateTime(last)+'</span></div>' +
          g.items.map(j => rowHtml(j, false)).join('');
      }).join('');
    }else{
      jobsListEl.innerHTML = [...jobs].sort(byStart).map(j => rowHtml(j, true)).join('');
    }
    jobsListEl.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEdit(b.getAttribute('data-edit'))));
    jobsListEl.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteJob(b.getAttribute('data-del'))));
  }


  /* ---------- Finalizados: marcar listo / con problema ---------- */
  const finListEl = el('fin-list'), finCntEl = el('fin-cnt'), finMsgEl = el('fin-msg');
  let finNoteFor = null, finUndoTimer = null;
  const cierreEstado = j => (j.cierre && j.cierre.estado) || '';
  function finishedPending(){
    const n = Date.now();
    return jobs.filter(j => jobEnd(j).getTime() <= n && cierreEstado(j) !== 'ok')
      .sort((a,b) => ((cierreEstado(b) === 'problema') - (cierreEstado(a) === 'problema')) || (jobEnd(b) - jobEnd(a)));
  }
  function renderFinished(){
    const list = finishedPending();
    finCntEl.textContent = list.length;
    if(!list.length){ finListEl.innerHTML = '<div class="empty-note">No hay trabajos finalizados pendientes.</div>'; return; }
    finListEl.innerHTML = list.map(j => {
      const p = printers.find(pp => pp.id === j.printerId);
      const prob = cierreEstado(j) === 'problema';
      const editing = finNoteFor === j.id;
      return '<div class="fin-row'+(prob?' prob':'')+'" data-id="'+esc(j.id)+'">' +
        '<div class="fin-main"><span class="swatch" style="background:'+PALETTE[j.colorIdx % PALETTE.length]+'"></span><span class="job-name">'+esc(j.archivo)+'</span>' +
        (prob ? '<span class="tag warn">⚠ Problema</span>' : '') + '</div>' +
        '<div class="fin-meta">' + (j.proyecto ? '<span class="tag proj">'+esc(j.proyecto)+'</span> ' : '') + (j.cliente ? '<span class="tag cli">👤 '+esc(j.cliente)+'</span> ' : '') +
        '<span class="tag '+tipoClass(j.tipoTrabajo)+'">'+TIPO_SHORT[j.tipoTrabajo]+'</span> ' +
        esc(p ? displayName(p) : '?')+' · Terminó '+fmtDateTime(jobEnd(j)) + '</div>' +
        (prob && !editing && j.cierre.nota ? '<div class="fin-note">'+esc(j.cierre.nota)+'</div>' : '') +
        (editing
          ? '<textarea data-note placeholder="¿Qué pasó? (falla, reimpresión, pieza dañada…)" maxlength="500">'+esc(prob ? j.cierre.nota : '')+'</textarea>' +
            '<div class="fin-actions"><button class="prob" data-save-prob="'+esc(j.id)+'">Guardar problema</button><button data-cancel-note>Cancelar</button></div>'
          : '<div class="fin-actions"><button class="ok" data-ok="'+esc(j.id)+'">✔ Listo</button>' +
            '<button class="prob" data-prob="'+esc(j.id)+'">'+(prob ? '✎ Editar nota' : '⚠ Problema')+'</button></div>') +
        '</div>';
    }).join('');
    finListEl.querySelectorAll('[data-ok]').forEach(b => b.addEventListener('click', () => setCierre(b.getAttribute('data-ok'), 'ok', '')));
    finListEl.querySelectorAll('[data-prob]').forEach(b => b.addEventListener('click', () => { finNoteFor = b.getAttribute('data-prob'); renderFinished();
      const ta = finListEl.querySelector('[data-note]'); if(ta) ta.focus(); }));
    finListEl.querySelectorAll('[data-cancel-note]').forEach(b => b.addEventListener('click', () => { finNoteFor = null; renderFinished(); }));
    finListEl.querySelectorAll('[data-save-prob]').forEach(b => b.addEventListener('click', () => {
      const ta = b.closest('.fin-row').querySelector('[data-note]');
      setCierre(b.getAttribute('data-save-prob'), 'problema', ta ? ta.value : '');
    }));
  }
  async function setCierre(id, estado, nota){
    const j = jobs.find(x => x.id === id);
    if(!j) return;
    clearTimeout(finUndoTimer);
    try{
      const r = await fetch('/api/prod/jobs/' + encodeURIComponent(id) + '/cierre', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({estado, nota})});
      if(!r.ok) throw new Error('http ' + r.status);
      const out = await r.json();
      if(out.cierre) j.cierre = out.cierre; else delete j.cierre;
    }catch(e){
      finMsgEl.textContent = 'No se pudo guardar. Verifica la conexión con el servidor.';
      return;
    }
    finNoteFor = null;
    renderFinished();
    if(estado === 'ok'){
      finMsgEl.innerHTML = '"'+esc(j.archivo)+'" marcado como listo.<button type="button" id="fin-undo">Deshacer</button>';
      el('fin-undo').addEventListener('click', () => { finMsgEl.textContent = ''; setCierre(id, null, ''); });
      finUndoTimer = setTimeout(() => { finMsgEl.textContent = ''; }, 12000);
    }else if(estado === 'problema'){
      finMsgEl.textContent = 'Problema registrado: se queda pendiente en la lista.';
      finUndoTimer = setTimeout(() => { finMsgEl.textContent = ''; }, 6000);
    }else{
      finMsgEl.textContent = '';
    }
  }

  /* ---------- Gestión de máquinas ---------- */
  const mqTbody = el('mq-tbody'), mqMsg = el('mq-msg'), mqTipo = el('mq-tipo'), mqAlias = el('mq-alias'),
        mqMarca = el('mq-marca'), mqModelo = el('mq-modelo'), mqMulti = el('mq-multicolor'),
        mqMultiWrap = el('mq-multicolor-wrap'), mqTitle = el('mq-form-title');

  function syncMqVisibility(){
    const es3d = mqTipo.value === '3d';
    mqMultiWrap.classList.toggle('hidden', !es3d);
    if(!es3d) mqMulti.value = 'no';
  }
  function resetMqForm(){
    editingPrinterId = null;
    mqTipo.value = '3d'; mqAlias.value = ''; mqMarca.value = ''; mqModelo.value = ''; mqMulti.value = 'no';
    syncMqVisibility();
    mqTitle.textContent = 'Agregar máquina';
    hideMsgIn(mqMsg);
  }
  function renderPrinters(){
    if(printers.length === 0){
      mqTbody.innerHTML = '<tr><td colspan="7"><div class="empty-note">No hay máquinas. Agrega una abajo.</div></td></tr>';
    }else{
      mqTbody.innerHTML = printers.map(p =>
        '<tr><td><strong>'+esc(displayName(p))+'</strong>'+'</td>' +
        '<td><span class="tag '+tipoClass(p.tipo)+'">'+TIPO_SHORT[p.tipo]+'</span></td>' +
        '<td>'+esc(p.marca||'—')+'</td><td>'+esc(p.modelo||'—')+'</td>' +
        '<td>'+(p.tipo==='3d' ? (p.multicolor?'Sí':'No') : '—')+'</td>' +
        '<td>'+(p.mantenimiento ? '<span class="tag mant">🔧 En mantenimiento</span>' : '<span class="tag t3d">Operativa</span>')+'</td>' +
        '<td><button class="btn-ghost'+(p.mantenimiento ? '' : ' warn')+'" data-pmant="'+esc(p.id)+'">'+(p.mantenimiento ? '✔ Reactivar' : '🔧 Mantenimiento')+'</button>' +
        '<button class="btn-ghost" data-pedit="'+esc(p.id)+'">Editar</button>' +
        '<button class="btn-ghost danger" data-pdel="'+esc(p.id)+'">Eliminar</button></td></tr>'
      ).join('');
    }
    mqTbody.querySelectorAll('[data-pmant]').forEach(b => b.addEventListener('click', () => toggleMaintenance(b.getAttribute('data-pmant'))));
    mqTbody.querySelectorAll('[data-pedit]').forEach(b => b.addEventListener('click', () => startEditPrinter(b.getAttribute('data-pedit'))));
    mqTbody.querySelectorAll('[data-pdel]').forEach(b => b.addEventListener('click', () => deletePrinter(b.getAttribute('data-pdel'))));
  }
  function startEditPrinter(id){
    const p = printers.find(x => x.id === id);
    if(!p) return;
    editingPrinterId = id;
    mqTipo.value = p.tipo; mqAlias.value = p.alias||''; mqMarca.value = p.marca||''; mqModelo.value = p.modelo||'';
    mqMulti.value = p.multicolor ? 'si' : 'no';
    syncMqVisibility();
    mqTitle.textContent = 'Editar máquina: ' + displayName(p);
    hideMsgIn(mqMsg);
    mqTitle.scrollIntoView({behavior:'smooth', block:'center'});
  }
  async function savePrinter(){
    hideMsgIn(mqMsg);
    if(!requireReady(m => showMsgIn(mqMsg, m, 'err'))) return;
    const data = {
      tipo: mqTipo.value,
      alias: mqAlias.value.trim(),
      marca: mqMarca.value.trim(),
      modelo: mqModelo.value.trim(),
      multicolor: mqTipo.value === '3d' && mqMulti.value === 'si'
    };
    if(data.ip && !/^[A-Za-z0-9.\-]+$/.test(data.ip)){ showMsgIn(mqMsg, 'La IP no es válida (ej. 192.168.100.200).', 'err'); return; }
    if(data.ip && printers.some(x => x.id !== editingPrinterId && (x.ip||'').trim() === data.ip)){ showMsgIn(mqMsg, 'Esa IP ya está asignada a otra máquina.', 'err'); return; }
    if(!data.alias && !data.marca && !data.modelo){
      showMsgIn(mqMsg, 'Escribe al menos un alias, marca o modelo.', 'err');
      return;
    }
    const prev = JSON.parse(JSON.stringify(printers));
    let editedName;
    if(editingPrinterId){
      const p = printers.find(x => x.id === editingPrinterId);
      Object.assign(p, data);
      editedName = displayName(p);
    }else{
      const p = {id:'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5), ...data};
      printers.push(p);
      editedName = displayName(p);
    }
    if(!(await saveConfig())){
      printers = prev;
      showMsgIn(mqMsg, 'No se pudo guardar. Verifica la conexión con el servidor.', 'err');
      return;
    }
    const wasEditing = !!editingPrinterId;
    resetMqForm();
    refreshAfterPrinterChange();
    showMsgIn(mqMsg, (wasEditing ? 'Máquina actualizada: ' : 'Máquina agregada: ') + editedName, 'ok');
  }
  /* ---------- Mantenimiento: las máquinas en mantenimiento no reciben trabajos nuevos
     y sus trabajos pendientes se reparten entre las demás máquinas de su tipo ---------- */
  function pendingJobsOn(printerId){
    const now = Date.now();
    return jobs.filter(j => j.printerId === printerId && jobEnd(j).getTime() > now).sort((a,b) => jobStart(a) - jobStart(b));
  }
  // Cada trabajo pendiente (en orden) pasa a la máquina compatible que lo pueda iniciar antes.
  // Los que ya estaban en curso se reinician desde ahora. No se mueve ningún otro trabajo.
  function redistributeFrom(p){
    const now = Date.now();
    const moved = [], stuck = [];
    for(const j of pendingJobsOn(p.id)){
      const cands = printers.filter(q => q.id !== p.id && q.tipo === p.tipo && !q.mantenimiento && (!j.multicolor || q.multicolor));
      const dur = jobDurationMs(j);
      const earliest = new Date(Math.max(jobStart(j).getTime(), now));
      let best = null, bestP = null;
      for(const q of cands){
        const segs = findSlot(q.id, earliest, dur, j.id);
        if(!segs) continue;
        const better = !best || segs[0].start < best[0].start ||
          (segs[0].start.getTime() === best[0].start.getTime() && segs[segs.length-1].end < best[best.length-1].end);
        if(better){ best = segs; bestP = q; }
      }
      if(!best){ stuck.push(j); continue; }
      j.printerId = bestP.id;
      applySegments(j, best);
      moved.push({job:j, to:bestP});
    }
    return {moved, stuck};
  }
  async function toggleMaintenance(id){
    hideMsgIn(mqMsg);
    if(!requireReady(m => showMsgIn(mqMsg, m, 'err'))) return;
    const p = printers.find(x => x.id === id);
    if(!p) return;
    const prevPrinters = JSON.parse(JSON.stringify(printers)), prevJobs = JSON.parse(JSON.stringify(jobs));
    if(p.mantenimiento){
      p.mantenimiento = false;
      if(!(await saveConfig())){
        printers = prevPrinters;
        showMsgIn(mqMsg, 'No se pudo guardar. Verifica la conexión con el servidor.', 'err');
        return;
      }
      refreshAfterPrinterChange();
      showMsgIn(mqMsg, displayName(p) + ' ya está operativa y puede recibir trabajos nuevos. (Los trabajos que se reubicaron no regresan solos.)', 'ok');
      return;
    }
    const pending = pendingJobsOn(p.id);
    const peers = printers.filter(q => q.id !== p.id && q.tipo === p.tipo && !q.mantenimiento).length;
    let txt = 'Poner "' + displayName(p) + '" en mantenimiento: no recibirá trabajos nuevos.';
    if(pending.length){
      txt += '\n\nTiene ' + pending.length + (pending.length === 1 ? ' trabajo pendiente' : ' trabajos pendientes') + ' (el que esté en curso se reiniciaría desde ahora). ' +
        (peers ? 'Se repartirán automáticamente entre las demás máquinas ' + TIPO_SHORT[p.tipo] + ' disponibles.' :
                 'No hay otra máquina ' + TIPO_SHORT[p.tipo] + ' disponible, así que se quedarán asignados a esta.');
    }
    txt += '\n\n¿Continuar?';
    if(!confirm(txt)) return;
    p.mantenimiento = true;
    const res = pending.length ? redistributeFrom(p) : {moved:[], stuck:[]};
    let okSave = await saveConfig();
    if(okSave && res.moved.length) okSave = await saveJobs();
    if(!okSave){
      printers = prevPrinters; jobs = prevJobs;
      await saveConfig(); // deja el servidor como estaba
      showMsgIn(mqMsg, 'No se pudo guardar. Verifica la conexión con el servidor.', 'err');
      refreshAfterPrinterChange();
      return;
    }
    refreshAfterPrinterChange();
    const perMachine = {};
    res.moved.forEach(m => { const n = displayName(m.to); perMachine[n] = (perMachine[n]||0) + 1; });
    let msg = displayName(p) + ' está en mantenimiento.';
    if(res.moved.length) msg += ' Se redistribuyeron ' + res.moved.length + (res.moved.length === 1 ? ' trabajo' : ' trabajos') + ' → ' +
      Object.entries(perMachine).map(([n,c]) => n + ' (' + c + ')').join(', ') + '.';
    if(res.stuck.length) msg += ' ' + res.stuck.length + (res.stuck.length === 1 ? ' trabajo no se pudo reubicar' : ' trabajos no se pudieron reubicar') +
      ' (sin máquina compatible disponible o sin espacio) y siguen asignados a ' + displayName(p) + ': ' + res.stuck.map(j => j.archivo).join(', ') + '.';
    showMsgIn(mqMsg, msg, res.stuck.length ? 'err' : 'ok');
  }
  async function deletePrinter(id){
    if(!requireReady(m => showMsgIn(mqMsg, m, 'err'))) return;
    const p = printers.find(x => x.id === id);
    if(!p) return;
    const affected = jobs.filter(j => j.printerId === id);
    const text = affected.length
      ? '"' + displayName(p) + '" tiene ' + affected.length + ' trabajo(s) programado(s) que también se eliminarán. ¿Continuar?'
      : '¿Eliminar "' + displayName(p) + '"?';
    if(!confirm(text)) return;
    const prevPrinters = printers, prevJobs = jobs;
    printers = printers.filter(x => x.id !== id);
    jobs = jobs.filter(j => j.printerId !== id);
    const okCfg = await saveConfig();
    const okJobs = okCfg && (affected.length === 0 || await saveJobs());
    if(!okCfg || !okJobs){
      printers = prevPrinters; jobs = prevJobs;
      if(okCfg) await saveConfig(); // revierte la configuración si lo que falló fue guardar los trabajos
      showMsgIn(mqMsg, 'No se pudo eliminar. Verifica la conexión con el servidor.', 'err');
      return;
    }
    if(editingPrinterId === id) resetMqForm();
    refreshAfterPrinterChange();
    showMsgIn(mqMsg, 'Máquina eliminada: ' + displayName(p), 'ok');
  }
  function refreshAfterPrinterChange(){
    refreshFormPrinterSelect();
    renderPrinters();
    renderTimeline();
    renderJobsList();
  }

  /* ---------- Horario del taller (UI) ---------- */
  const horarioGrid = el('horario-grid'), hMsg = el('h-msg');
  function renderHorario(){
    horarioGrid.innerHTML = DAY_ORDER.map(d => {
      const h = horario[d];
      return '<div class="hrow" data-day="'+d+'">' +
        '<label class="chk"><input type="checkbox" class="h-activo"'+(h.activo?' checked':'')+'> '+DAY_NAMES[d]+'</label>' +
        '<input type="time" class="h-ini" value="'+esc(h.inicio)+'"'+(h.activo?'':' disabled')+'>' +
        '<span class="sep">a</span>' +
        '<input type="time" class="h-fin" value="'+esc(h.fin)+'"'+(h.activo?'':' disabled')+'></div>';
    }).join('');
    horarioGrid.querySelectorAll('.hrow').forEach(row => {
      const chk = row.querySelector('.h-activo');
      chk.addEventListener('change', () => {
        row.querySelector('.h-ini').disabled = !chk.checked;
        row.querySelector('.h-fin').disabled = !chk.checked;
      });
    });
  }
  async function saveHorario(){
    hideMsgIn(hMsg);
    if(!requireReady(m => showMsgIn(hMsg, m, 'err'))) return;
    const next = DEFAULT_HORARIO.map(h => ({...h}));
    let error = null;
    horarioGrid.querySelectorAll('.hrow').forEach(row => {
      const d = parseInt(row.getAttribute('data-day'), 10);
      const activo = row.querySelector('.h-activo').checked;
      const inicio = row.querySelector('.h-ini').value || '09:00';
      const fin = row.querySelector('.h-fin').value || '18:00';
      if(activo && !(parseHM(fin) > parseHM(inicio))) error = DAY_NAMES[d] + ': la hora de fin debe ser posterior a la de inicio.';
      next[d] = {activo, inicio, fin};
    });
    if(error){ showMsgIn(hMsg, error, 'err'); return; }
    if(!next.some(h => h.activo)){ showMsgIn(hMsg, 'Activa al menos un día de trabajo.', 'err'); return; }
    const prev = horario;
    horario = next;
    if(!(await saveConfig())){
      horario = prev;
      showMsgIn(hMsg, 'No se pudo guardar. Verifica la conexión con el servidor.', 'err');
      return;
    }
    renderTimeline();
    showMsgIn(hMsg, 'Horario guardado. Aplica a los trabajos nuevos y a los que edites.', 'ok');
  }

  /* ---------- Eventos ---------- */
  el('btn-limpiar').addEventListener('click', resetForm);
  el('btn-ahora').addEventListener('click', () => { const n = new Date(); fechaEl.value = toDateInputValue(n); horaEl.value = toTimeInputValue(n); });
  el('btn-aceptar').addEventListener('click', handleAceptar);
  el('btn-vaciar').addEventListener('click', clearAllJobs);
  el('sup-toggle').addEventListener('change', toggleSup);
  tipoEl.addEventListener('change', () => { syncFormVisibility(); refreshFormPrinterSelect(); });
  proyectoEl.addEventListener('change', syncFormProject);
  eProyecto.addEventListener('change', syncEditProject);
  eProyectoNuevo.addEventListener('input', syncEditProject);
  eCliente.addEventListener('change', syncEditClient);
  eClienteNuevo.addEventListener('input', syncEditLote);
  clienteEl.addEventListener('change', syncFormClient);
  ePresupuesto.addEventListener('input', syncEditLote);
  try{ const sv = localStorage.getItem('tridi.jobsSort'); if(sv === 'proyecto' || sv === 'inicio') jobsSortEl.value = sv; }catch(e){}
  jobsSortEl.addEventListener('change', () => {
    try{ localStorage.setItem('tridi.jobsSort', jobsSortEl.value); }catch(e){}
    renderJobsList();
  });
  asignarEl.addEventListener('change', syncFormVisibility);
  el('tl-prev').addEventListener('click', () => { viewDate = addDays(viewDate, -1); renderTimeline(); });
  el('tl-next').addEventListener('click', () => { viewDate = addDays(viewDate, 1); renderTimeline(); });
  el('tl-today').addEventListener('click', () => { viewDate = startOfDay(new Date()); renderTimeline(); });

  mqTipo.addEventListener('change', syncMqVisibility);
  el('mq-guardar').addEventListener('click', savePrinter);
  el('mq-cancelar').addEventListener('click', resetMqForm);
  el('h-guardar').addEventListener('click', saveHorario);

  eTipo.addEventListener('change', () => { syncEditVisibility(); ePrinter.innerHTML = printerOptions(eTipo.value, ePrinter.value); });
  el('e-guardar').addEventListener('click', saveEdit);
  el('e-cancelar').addEventListener('click', closeEdit);
  modalEl.addEventListener('click', e => { if(e.target === modalEl) closeEdit(); });
  document.addEventListener('keydown', e => { if(e.key === 'Escape' && modalEl.classList.contains('show')) closeEdit(); });

  /* ---------- Secciones minimizables (se recuerda el estado en este navegador) ---------- */
  function setupCollapsibles(){
    let saved = {};
    try{ saved = JSON.parse(localStorage.getItem('tridi.collapsed') || '{}') || {}; }catch(e){}
    document.querySelectorAll('.panel.collapsible').forEach(panel => {
      const key = panel.getAttribute('data-collapse');
      const h = panel.querySelector('h2');
      h.setAttribute('role', 'button'); h.setAttribute('tabindex', '0'); h.setAttribute('title', 'Clic para minimizar / expandir');
      const apply = c => { panel.classList.toggle('collapsed', c); h.setAttribute('aria-expanded', String(!c)); };
      apply(!!saved[key]);
      const toggle = () => {
        const c = !panel.classList.contains('collapsed');
        apply(c); saved[key] = c;
        try{ localStorage.setItem('tridi.collapsed', JSON.stringify(saved)); }catch(e){}
      };
      h.addEventListener('click', toggle);
      h.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggle(); } });
    });
  }

  /* ---------- Tiempo real: si otra pantalla o el agente de impresoras cambia algo, se recarga aquí ---------- */
  let pendingRefresh = false, bootSeen = null;
  const busyUI = () => typeof document === 'undefined' || !document || (drag && drag.active) || modalEl.classList.contains('show') || el('modal-move').classList.contains('show') || finNoteFor !== null;
  async function refreshFromServer(force){
    if(typeof document === 'undefined' || !document) return;
    if(!force && busyUI()){ pendingRefresh = true; return; }
    pendingRefresh = false;
    try{
      const [rc, rj] = await Promise.all([fetch('/api/prod/config', {cache:'no-store'}), fetch('/api/prod/jobs', {cache:'no-store'})]);
      if(!rc.ok || !rj.ok) return;
      const c = await rc.json(), j = await rj.json();
      if(Array.isArray(c.printers) && Array.isArray(c.horario) && c.horario.length === 7) printers = c.printers;
      sinSup = !!c.sinSupervision;
      jobs = j.map(normalizeJob);
    }catch(e){ return; }
    refreshProjectSelects(); refreshFormPrinterSelect(); renderSup(); renderPrinters(); renderTimeline(); renderJobsList();
  }
  function connectLive(){
    if(typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/prod/events');
    es.onmessage = ev => {
      let m = {}; try{ m = JSON.parse(ev.data); }catch(e){}
      if(m.type === 'hello'){ if(bootSeen !== null && m.boot !== bootSeen){ location.reload(); return; } bootSeen = m.boot; return; }
      refreshFromServer();
    };
  }
  setInterval(() => { if(pendingRefresh && !busyUI()) refreshFromServer(); }, 1500);

  async function init(){
    setupCollapsibles();
    connectLive();
    resetForm();
    await loadAll();
    refreshFormPrinterSelect();
    resetForm();
    refreshProjectSelects();
    renderSup();
    renderPrinters();
    renderHorario();
    renderTimeline();
    renderJobsList();
    setInterval(() => { if(finNoteFor === null) renderFinished(); }, 20000); // los trabajos pasan a Finalizados al llegar su hora de fin
    if(!dataReady) showMsg('No se pudo conectar con el servidor de datos. Recarga la página; mientras tanto no se puede guardar nada.', 'err');
  }
  init();
})();
