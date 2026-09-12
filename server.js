const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;

// Directorios necesarios
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const AUTH_DIR = path.join(__dirname, 'auth_session');
const SCHEDULES_FILE = path.join(__dirname, 'schedules.json');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
if (!fs.existsSync(SCHEDULES_FILE)) fs.writeFileSync(SCHEDULES_FILE, JSON.stringify([], null, 2));

// Almacenamiento de archivos con Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Estado de WhatsApp
let sock = null;
let connectionStatus = 'disconnected'; // 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
let currentQR = null;
let intentionalDisconnect = false; // evita auto-reconexión al cerrar sesión manualmente

// Inicializar cliente Baileys de WhatsApp
async function connectToWhatsApp() {
  connectionStatus = 'connecting';
  currentQR = null;

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    auth: state,
    browser: ['Programador Web', 'Chrome', '1.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = await QRCode.toDataURL(qr);
      connectionStatus = 'qr_ready';
      console.log('Nuevo código QR generado. Escanéalo en la web o terminal.');
    }

    if (connection === 'close') {
      const shouldReconnect =
        !intentionalDisconnect &&
        (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Conexión cerrada. ¿Reconectar?:', shouldReconnect);
      connectionStatus = 'disconnected';
      currentQR = null;
      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 5000);
      }
    } else if (connection === 'open') {
      console.log('✓ ¡WhatsApp conectado exitosamente!');
      connectionStatus = 'connected';
      currentQR = null;
    }
  });
}

// Iniciar WhatsApp
connectToWhatsApp();

// Endpoint para estado y código QR
app.get('/api/status', (req, res) => {
  res.json({
    status: connectionStatus,
    qr: currentQR
  });
});

// Endpoint para desconectar WhatsApp y borrar sesión
app.post('/api/disconnect', async (req, res) => {
  try {
    intentionalDisconnect = true;
    connectionStatus = 'disconnected';
    currentQR = null;

    if (sock) {
      try {
        await sock.logout();
      } catch (e) {
        // Si ya estaba desconectado o falló el logout, igual continuamos
      }
      try {
        sock.end();
      } catch (e) {}
      sock = null;
    }

    // Borrar archivos de sesión para forzar nuevo QR la próxima vez
    if (fs.existsSync(AUTH_DIR)) {
      fs.readdirSync(AUTH_DIR).forEach(file => {
        try { fs.unlinkSync(path.join(AUTH_DIR, file)); } catch (e) {}
      });
    }

    console.log('✓ Sesión de WhatsApp cerrada y credenciales eliminadas.');
    res.json({ success: true, message: 'Sesión cerrada correctamente' });
  } catch (err) {
    console.error('Error al desconectar:', err);
    res.status(500).json({ error: 'Error al cerrar la sesión' });
  }
});

// Endpoint para programar un mensaje
// Función inteligente para resolver el JID de WhatsApp
async function resolveWhatsAppJid(client, phone) {
  let clean = phone.replace(/[^0-9]/g, '');

  // Manejo de prefijo local 0
  if (clean.startsWith('0')) {
    clean = clean.substring(1);
  }

  const candidates = [];

  if (clean.startsWith('549')) {
    candidates.push(clean);
    candidates.push('54' + clean.substring(3));
  } else if (clean.startsWith('54')) {
    candidates.push('549' + clean.substring(2));
    candidates.push(clean);
  } else if (clean.length === 10) {
    // 10 dígitos (típico celular argentino sin prefijo internacional, ej. 3834522117)
    candidates.push('549' + clean);
    candidates.push('54' + clean);
    candidates.push(clean);
  } else {
    candidates.push('549' + clean);
    candidates.push(clean);
  }

  // Si WhatsApp está conectado, consultamos directamente qué número existe registrado
  if (client && connectionStatus === 'connected') {
    for (const num of candidates) {
      try {
        const results = await client.onWhatsApp(num);
        if (results && results.length > 0) {
          const matched = results.find(r => r.exists);
          if (matched && matched.jid) {
            console.log(`✓ Destinatario verificado en WhatsApp: ${matched.jid} (entrada: ${phone})`);
            return matched.jid;
          }
        }
      } catch (err) {
        // continuar
      }
    }
  }

  // Fallback
  return `${candidates[0]}@s.whatsapp.net`;
}

// Endpoint para programar un mensaje
app.post('/api/schedule', upload.single('attachment'), async (req, res) => {
  try {
    const { phone, message, date, time } = req.body;

    if (!phone || !message || !date || !time) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    const scheduledDateTime = new Date(`${date}T${time}:00`);
    if (isNaN(scheduledDateTime.getTime())) {
      return res.status(400).json({ error: 'Fecha u hora inválida' });
    }

    // Resolver JID correcto en WhatsApp
    const jid = await resolveWhatsAppJid(sock, phone);

    const newSchedule = {
      id: Date.now().toString(),
      phone,
      jid,
      message,
      date,
      time,
      scheduledTime: scheduledDateTime.getTime(),
      file: req.file ? {
        originalName: req.file.originalname,
        filename: req.file.filename,
        path: req.file.path,
        mimetype: req.file.mimetype
      } : null,
      status: 'pending', // 'pending' | 'sent' | 'failed'
      createdAt: new Date().toISOString()
    };

    const schedules = JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'));
    schedules.push(newSchedule);
    fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));

    console.log(`Mensaje programado para ${phone} (${jid}) el ${date} a las ${time}`);
    res.json({ success: true, schedule: newSchedule });
  } catch (err) {
    console.error('Error al programar:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Endpoint para listar mensajes programados
app.get('/api/schedules', (req, res) => {
  try {
    const schedules = JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'));
    res.json(schedules);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener mensajes' });
  }
});

// Endpoint para cancelar/eliminar un mensaje programado
app.delete('/api/schedule/:id', (req, res) => {
  try {
    const { id } = req.params;
    let schedules = JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'));
    const index = schedules.findIndex(s => s.id === id);
    if (index === -1) {
      return res.status(404).json({ error: 'Mensaje no encontrado' });
    }
    const removed = schedules.splice(index, 1)[0];
    if (removed.file && fs.existsSync(removed.file.path)) {
      try { fs.unlinkSync(removed.file.path); } catch (e) {}
    }
    fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
    res.json({ success: true, message: 'Mensaje cancelado correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al cancelar mensaje' });
  }
});

// Motor de verificación y envío automático de mensajes
setInterval(async () => {
  if (connectionStatus !== 'connected' || !sock) return;

  try {
    const schedules = JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'));
    const now = Date.now();
    let updated = false;

    for (const item of schedules) {
      if (item.status === 'pending' && now >= item.scheduledTime) {
        console.log(`Enviando mensaje programado a ${item.phone}...`);
        try {
          if (item.file && fs.existsSync(item.file.path)) {
            const mime = item.file.mimetype;
            const fileBuffer = fs.readFileSync(item.file.path);

            if (mime.startsWith('image/')) {
              await sock.sendMessage(item.jid, {
                image: fileBuffer,
                caption: item.message
              });
            } else if (mime.startsWith('video/')) {
              await sock.sendMessage(item.jid, {
                video: fileBuffer,
                caption: item.message
              });
            } else if (mime.startsWith('audio/')) {
              await sock.sendMessage(item.jid, {
                audio: fileBuffer,
                mimetype: mime,
                ptt: false
              });
              if (item.message) {
                await sock.sendMessage(item.jid, { text: item.message });
              }
            } else {
              await sock.sendMessage(item.jid, {
                document: fileBuffer,
                mimetype: mime,
                fileName: item.file.originalName,
                caption: item.message
              });
            }
          } else {
            // Solo texto
            await sock.sendMessage(item.jid, { text: item.message });
          }

          item.status = 'sent';
          item.sentAt = new Date().toISOString();
          console.log(`✓ Enviado con éxito a ${item.phone}`);
        } catch (sendError) {
          console.error(`Error enviando a ${item.phone}:`, sendError);
          item.status = 'failed';
          item.error = sendError.message;
        }
        updated = true;
      }
    }

    if (updated) {
      fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
    }
  } catch (loopError) {
    console.error('Error en el ciclo de envío:', loopError);
  }
}, 5000);

app.listen(PORT, () => {
  console.log(`\n==============================================`);
  console.log(`Servidor activo en: http://localhost:${PORT}`);
  console.log(`==============================================\n`);
});
