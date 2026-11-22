# TRIDI MX · Gestor (v6.1 · Correo)

## Novedades v6.1 — Correo (Hostinger)
- Módulo **Correo** (permiso `correo`): bandeja de `contacto@tridimx.tech` agrupada por cliente
  (correo registrado en Clientes → dominio de la empresa del cliente → otros dominios → «Sin asignar»).
- Leer (HTML en marco aislado, sin scripts ni imágenes externas), adjuntos, responder, responder a todos, reenviar,
  redactar con adjuntos y **adjuntar presupuestos en PDF**. «Enviar por correo» desde Presupuesto.
- «Asignar a cliente»: agrega la dirección del remitente al cliente y desde ahí sus correos se agrupan solos.
- Sincroniza encabezados cada 2 min (último año, `MAIL_DAYS`); el contenido se descarga al abrir. Los enviados se guardan
  también en la carpeta Enviados del buzón, así que se ven en el webmail y en el celular.
- Variables en Easypanel: `MAIL_USER=contacto@tridimx.tech`, `MAIL_PASS=…` (opcional `MAIL_FROM_NAME`, `MAIL_DAYS`).
  Servidores por defecto: imap.hostinger.com:993 y smtp.hostinger.com:465.
- Ahora el proyecto tiene dependencias (imapflow, nodemailer, mailparser): el Dockerfile ejecuta `npm ci`.

# Fase 2 (v6.0)

Base: dashboard Arquitechtura AGIS v4.3, con marca y módulos de TRIDI MX.

## Novedades v6.0 (fase 2)
- **SQLite** (`/data/tridi.db`, módulo `node:sqlite` de Node 22, sin dependencias). Al primer arranque importa
  `db.json`, `users.json` y `notifications.json` de la v5.0 y los renombra a `*.importado`.
  Respaldo diario en `/data/backups/tridi-AAAA-MM-DD.db` (30 días).
- **Sesiones persistentes**: un redeploy ya no cierra la sesión.
- **Cobranza**: presupuestos aprobados → pagos/anticipos, PUE/PPD, con/sin factura, fecha límite, saldo, días vencidos,
  alerta en el menú y en Inicio, exportar CSV. El saldo de Clientes/Proyectos ahora sale de Cobranza.
- **Control Producción**: scheduler v8 integrado (tema claro) en `/produccion`, con login y permiso `produccion`.
  Pantalla del taller en `/produccion/pantalla` con permiso `taller`. Importador de `jobs.json`/`config.json` (admin).
  Las listas de cliente/proyecto del scheduler incluyen los del Gestor.
- **Clientes con RFC**, razón social, régimen fiscal y C.P. (listos para CFDI 4.0). RFC de 12 caracteres marca persona moral
  y activa la retención 1.25 % en el presupuesto.
- **PDF de presupuesto** con el diseño limpio del presupuesto AGIS y la marca TRIDI. Teléfono: 55 7335 2169.
- Instalación sin datos de demostración; si quedaron los de AGIS, se limpian solos.

## Easypanel
- Imagen `node:22-alpine` con `TZ=America/Mexico_City` (el horario del taller depende de la hora local).
- Volumen en `/data` (mismo de la v5.0: no cambiar). Variables `AUTH_USER`, `AUTH_PASS`.

---
## Notas heredadas de AGIS v4.3

Módulos: **Home** (banda de botones flotantes), **Clientes**, **Actividades** (tablero tipo Trello) y **Reporte Visita** (formulario → PDF con firmas).

## Estructura
```
server.js        Servidor Node ≥18 sin dependencias (estáticos + API JSON)
public/          index.html · app.css · app.js · pdf.js · pdf-fonts.js (Manrope, OFL) · logos.js
Dockerfile       Imagen para Easypanel
data/            (se crea solo) db.json, users.json, notifications.json, uploads/ y backups/ diarios (30 días)
```

## Despliegue en Easypanel (VPS Hostinger)
1. Sube esta carpeta a un repo de GitHub (o usa "Upload" en Easypanel).
2. Easypanel → tu proyecto → **+ Service → App** → origen: el repo, build: **Dockerfile**.
3. **Environment**:
   ```
   AUTH_USER=admin              # administrador principal (no se puede borrar desde la app)
   AUTH_PASS=una-contraseña-fuerte
   AUTH_NAME=Luis Gómez         # opcional: nombre que se muestra
   SESSION_DAYS=7               # opcional: duración de la sesión
   ```
   Sin AUTH_USER/AUTH_PASS nadie puede entrar (el servidor lo avisa en el log).
4. **Mounts** → Volume: nombre `tridi-data`, mount path `/data`  ← sin esto se pierden los datos en cada deploy.
5. **Domains** → puerto `3000`, agrega tu dominio/subdominio (Easypanel genera HTTPS).
6. Deploy. Prueba: `https://tu-dominio/api/health` → `{"ok":true}`.

## Local
```
node server.js        # http://localhost:3000
```

## Seguridad
- Login con sesión (cookie HttpOnly, SameSite=Lax, Secure bajo HTTPS).
- **5 intentos fallidos por IP → bloqueo de 15 minutos** (la IP se toma de `X-Forwarded-For` que pone Easypanel/Traefik; si expones el puerto directo sin proxy define `TRUST_PROXY=0`).
- Contraseñas de usuarios guardadas con scrypt + sal en `/data/users.json`.
- Permisos por módulo validados en el servidor (no solo en la pantalla).
- Rechaza peticiones de escritura desde otros dominios; encabezados CSP, X-Frame-Options, HSTS.

## Usuarios
Menú del usuario (arriba a la derecha) → **Administrar usuarios** (solo administradores).
Perfil *Administrador* = todos los módulos + gestión de usuarios. *Colaborador* = solo los módulos marcados.
**Cambiar de usuario** / **Cerrar sesión** en el mismo menú.

## API
- `POST /api/login` · `POST /api/logout` · `GET /api/me`
- `GET /api/db` (filtrado por permisos) · `PUT /api/db/{clientes|board|config|reportes|colPrefs}`
- `POST /api/upload` (fotos del reporte → `/data/uploads`, servidas solo con sesión)
- `GET|POST /api/users` · `PUT|DELETE /api/users/{usuario}` (admin)
- `GET /api/directory` (usuarios activos, para elegir a quién notificar)
- `GET|POST|DELETE /api/notifications` · `DELETE /api/notifications/{id}`
- `PUT /api/db/presupuestos` (Presupuesto) · `PUT /api/db/proyectos` (Proyectos) · `PUT /api/db/catalogos` (solo admin)
- Monitor: solo administradores

Sin servidor (vista previa) la app trabaja en modo local con usuario `admin` / `admin`.

## Notas
- ID de cliente: `ddmmaa-##` con la fecha de creación y consecutivo del día.
- Folio sugerido del reporte: `XXX-TIPO-###` (p. ej. `TRU-IDO-001`).
- Arrastrar tarjetas: mouse (clic y arrastra) o touch (mantén presionado ~0.3 s y arrastra).
- Siguientes pasos sugeridos: importación desde Trello (API), usuarios/roles, módulos Proyectos y Monitor.

## Migración Clientes → Clientes + Proyectos (v4.1)
- Al entrar a **Clientes** un administrador ve el aviso **"Revisar migración"**: vista previa, respaldo descargable y botón **Aplicar**.
- Cliente = contacto principal, teléfono, correo. Proyecto = nombre, estatus, origen, dirección, servicios, saldo y notas.
- Mismo contacto → un cliente con varios proyectos. Sin contacto → nombre provisional + "Por completar".
- El servidor guarda `data/backups/pre-migracion-<fecha>.json` antes de aplicar (`POST /api/migrate`).
- Para revertir: detener el servicio, copiar ese respaldo sobre `data/db.json` y volver a iniciar.

## Cambios v4.3
- **Saldo automático**: saldo de proyecto = suma de sus presupuestos vinculados; saldo de cliente = suma de sus proyectos (MXN y USD por separado). Clic en el saldo → desglose por proyecto.
- **Clientes**: clic en los proyectos de la tabla → lista para ir directo a cada uno.
- **Servicios contratados → Sistemas**: se migran solos al abrir la app (sin duplicados). Al agregar sistema se usa la lista; el admin la edita (agregar/editar/borrar).
- **Actividades**: responsables = usuarios del sistema (fijos) + otros sin usuario (editables). Al asignar a un usuario le llega notificación con liga a la actividad.
- **Presupuesto**: al entrar siempre abre uno nuevo en blanco; si sales con cambios sin guardar pide Guardar / Descartar / Cancelar.
