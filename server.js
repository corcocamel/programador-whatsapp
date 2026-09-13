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
const CONTACTS_FILE = path.join(__dirname, 'contacts.json');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
if (!fs.existsSync(SCHEDULES_FILE)) fs.writeFileSync(SCHEDULES_FILE, JSON.stringify([], null, 2));

// Almacenamiento y sincronización de contactos
const contactsMap = new Map();

function upsertContact(c) {
  if (!c || !c.id) return;
  // Ignorar difusiones de estado o canales
  if (c.id.includes('@broadcast') || c.id.includes('@newsletter')) return;

  const isGroup = c.id.endsWith('@g.us');
  let phone = '';
  let canonicalId = c.id;

  if (!isGroup) {
    if (c.phoneNumber) {
      phone = String(c.phoneNumber).replace(/[^0-9]/g, '');
    } else if (c.id.includes('@s.whatsapp.net')) {
      phone = c.id.split('@')[0].replace(/[^0-9]/g, '');
    } else if (c.phone) {
      phone = String(c.phone).replace(/[^0-9]/g, '');
    }

    // Si es un LID y conocemos el número, unificarlo en @s.whatsapp.net
    if (c.id.includes('@lid')) {
      if (phone) {
        canonicalId = `${phone}@s.whatsapp.net`;
      } else if (!c.name && !c.notify) {
        // LID interno sin teléfono ni nombre no es útil
        return;
      }
    }
  }

  const existing = contactsMap.get(canonicalId) || {};
  const savedName = (c.name || existing.name || '').trim();
  const notify = (c.notify || existing.notify || c.verifiedName || existing.verifiedName || '').trim();
  const finalPhone = phone || existing.phone || '';

  // Solo conservar contactos que tengan nombre, apodo de WhatsApp, teléfono o sean grupo
  if (!savedName && !notify && !finalPhone && !isGroup) return;

  contactsMap.set(canonicalId, {
    id: canonicalId,
    name: savedName,
    notify: notify,
    phone: finalPhone,
    isGroup: isGroup || existing.isGroup || false
  });
}

function loadContactsFromFile() {
  try {
    if (fs.existsSync(CONTACTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8'));
      if (Array.isArray(data)) {
        data.forEach(c => upsertContact(c));
        saveContactsToFile();
        console.log(`✓ Se cargaron y unificaron ${contactsMap.size} contactos.`);
      }
    }
  } catch (e) {
    console.error('Error al cargar contacts.json:', e.message);
  }
}
loadContactsFromFile();

function saveContactsToFile() {
  try {
    const list = Array.from(contactsMap.values());
    fs.writeFileSync(CONTACTS_FILE, JSON.stringify(list, null, 2));
  } catch (e) {
    console.error('Error al guardar contacts.json:', e.message);
  }
}

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

  // Sincronización de contactos e historial
  sock.ev.on('messaging-history.set', ({ contacts, chats }) => {
    let count = 0;
    if (contacts && Array.isArray(contacts)) {
      contacts.forEach(c => {
        upsertContact(c);
        count++;
      });
    }
    if (chats && Array.isArray(chats)) {
      chats.forEach(ch => {
        if (ch.id && (ch.name || ch.subject)) {
          upsertContact({ id: ch.id, name: ch.name || ch.subject });
          count++;
        }
      });
    }
    saveContactsToFile();
    console.log(`✓ Sincronizados contactos/chats desde historial de WhatsApp (Total: ${contactsMap.size}).`);
  });

  sock.ev.on('contacts.upsert', (newContacts) => {
    if (Array.isArray(newContacts)) {
      newContacts.forEach(upsertContact);
      saveContactsToFile();
    }
  });

  sock.ev.on('contacts.update', (updates) => {
    if (Array.isArray(updates)) {
      updates.forEach(u => {
        if (u.id && contactsMap.has(u.id)) {
          const existing = contactsMap.get(u.id);
          Object.assign(existing, u);
          contactsMap.set(u.id, existing);
        } else if (u.id) {
          upsertContact(u);
        }
      });
      saveContactsToFile();
    }
  });

  sock.ev.on('chats.upsert', (newChats) => {
    if (Array.isArray(newChats)) {
      newChats.forEach(ch => {
        if (ch.id && (ch.name || ch.subject)) {
          upsertContact({ id: ch.id, name: ch.name || ch.subject });
        }
      });
      saveContactsToFile();
    }
  });

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

      // Obtener grupos en los que participa
      setTimeout(async () => {
        try {
          if (sock && connectionStatus === 'connected') {
            const groups = await sock.groupFetchAllParticipating();
            for (const [id, grp] of Object.entries(groups)) {
              upsertContact({
                id,
                name: grp.subject,
                isGroup: true
              });
            }
            saveContactsToFile();
            console.log(`✓ Grupos participantes sincronizados.`);
          }
        } catch (e) {
          // Si falla fetch de grupos no interrumpe el flujo
        }
      }, 2500);
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

function hasLetters(name) {
  return typeof name === 'string' && /[a-zA-ZáéíóúÁÉÍÓÚñÑ]/.test(name);
}

function getSortKey(name) {
  if (!name) return 'zzzz';
  const clean = name.replace(/^[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ]+/, '').trim();
  return clean || name;
}

// Endpoint para listar contactos sincronizados
app.get('/api/contacts', (req, res) => {
  try {
    const list = Array.from(contactsMap.values())
      .filter(c => c && (c.name || c.notify || c.phone || c.isGroup))
      .map(c => {
        const savedName = (c.name || '').trim();
        const pushName = (c.notify || '').trim();
        const hasRealName = !!(c.isGroup ? savedName : hasLetters(savedName));
        const displayName = savedName || pushName || (c.isGroup ? 'Grupo de WhatsApp' : (c.phone ? `+${c.phone}` : 'Contacto'));

        return {
          id: c.id,
          name: displayName,
          savedName: savedName,
          notify: pushName,
          phone: c.phone || '',
          isGroup: !!c.isGroup,
          hasRealName: hasRealName
        };
      })
      .sort((a, b) => {
        // Prioridad 1: Los contactos con nombre de agenda van primero
        if (a.hasRealName && !b.hasRealName) return -1;
        if (!a.hasRealName && b.hasRealName) return 1;
        // Prioridad 2: Alfabéticamente por clave limpia
        return getSortKey(a.name).localeCompare(getSortKey(b.name), 'es', { sensitivity: 'base' });
      });

    const withRealName = list.filter(c => c.hasRealName && !c.isGroup);
    const groups = list.filter(c => c.isGroup);

    res.json({
      connected: connectionStatus === 'connected',
      total: list.length,
      contactsCount: withRealName.length,
      groupsCount: groups.length,
      contacts: list
    });
  } catch (err) {
    console.error('Error al obtener contactos:', err);
    res.status(500).json({ error: 'Error al obtener contactos' });
  }
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

    // Limpiar contactos guardados
    contactsMap.clear();
    if (fs.existsSync(CONTACTS_FILE)) {
      try { fs.unlinkSync(CONTACTS_FILE); } catch (e) {}
    }

    console.log('✓ Sesión de WhatsApp cerrada y credenciales/contactos eliminados.');
    res.json({ success: true, message: 'Sesión cerrada correctamente' });
  } catch (err) {
    console.error('Error al desconectar:', err);
    res.status(500).json({ error: 'Error al cerrar la sesión' });
  }
});

// Endpoint para programar un mensaje
// Función inteligente para resolver el JID de WhatsApp
async function resolveWhatsAppJid(client, phone) {
  // Si ya es un JID completo (ej. grupo @g.us o contacto @s.whatsapp.net), usarlo directamente
  if (typeof phone === 'string' && (phone.endsWith('@g.us') || phone.endsWith('@s.whatsapp.net'))) {
    return phone;
  }

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
    const { phone, message, date, time, scheduledTimestamp } = req.body;

    if (!phone || !message || !date || !time) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    let targetTime = scheduledTimestamp ? parseInt(scheduledTimestamp, 10) : NaN;
    if (isNaN(targetTime)) {
      const scheduledDateTime = new Date(`${date}T${time}:00`);
      targetTime = scheduledDateTime.getTime();
    }

    if (isNaN(targetTime)) {
      return res.status(400).json({ error: 'Fecha u hora inválida' });
    }

    // Permitir un margen de 15 segundos por latencia de red, pero evitar programaciones pasadas
    if (targetTime < Date.now() - 15000) {
      return res.status(400).json({ error: 'La hora programada ya pasó. Elige una fecha/hora futura.' });
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
      scheduledTime: targetTime,
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
