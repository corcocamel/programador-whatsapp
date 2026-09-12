document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('schedule-form');
  const fileInput = document.getElementById('attachment');
  const fileDropArea = document.getElementById('fileDropArea');
  const filePreview = document.getElementById('filePreview');
  const fileName = document.getElementById('fileName');
  const fileSize = document.getElementById('fileSize');
  const removeFileBtn = document.getElementById('removeFileBtn');
  const dateInput = document.getElementById('date');
  const timeInput = document.getElementById('time');
  const submitBtn = document.getElementById('submitBtn');
  const statusMessage = document.getElementById('statusMessage');

  // Elementos de estado WhatsApp y QR
  const connectionBadge = document.getElementById('connectionBadge');
  const connectionText = document.getElementById('connectionText');
  const qrPanel = document.getElementById('qrPanel');
  const qrImage = document.getElementById('qrImage');
  const disconnectBtn = document.getElementById('disconnectBtn');

  // Ajustar fecha y hora por defecto
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  dateInput.min = today;
  dateInput.value = today;

  // Siguiente intervalo de 15 minutos para la hora inicial
  now.setMinutes(now.getMinutes() + 15);
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  timeInput.value = `${hours}:${minutes}`;

  // Manejador para arrastrar y soltar archivos
  ['dragenter', 'dragover'].forEach(eventName => {
    fileDropArea.addEventListener(eventName, (e) => {
      e.preventDefault();
      fileDropArea.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    fileDropArea.addEventListener(eventName, (e) => {
      e.preventDefault();
      fileDropArea.classList.remove('drag-over');
    });
  });

  fileDropArea.addEventListener('drop', (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      fileInput.files = e.dataTransfer.files;
      updateFilePreview(fileInput.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      updateFilePreview(fileInput.files[0]);
    } else {
      clearFilePreview();
    }
  });

  removeFileBtn.addEventListener('click', () => {
    clearFilePreview();
  });

  function updateFilePreview(file) {
    if (!file) return;
    fileName.textContent = file.name;
    fileSize.textContent = formatBytes(file.size);
    filePreview.classList.remove('hidden');
  }

  function clearFilePreview() {
    fileInput.value = '';
    fileName.textContent = '';
    fileSize.textContent = '';
    filePreview.classList.add('hidden');
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Polling para verificar el estado de WhatsApp y QR
  async function checkWhatsAppStatus() {
    try {
      const response = await fetch('/api/status');
      if (!response.ok) throw new Error('Servidor no disponible');

      const data = await response.json();

      connectionBadge.className = 'connection-badge';

      if (data.status === 'connected') {
        connectionBadge.classList.add('status-connected');
        connectionText.textContent = 'Conectado';
        qrPanel.classList.add('hidden');
        disconnectBtn.classList.remove('hidden');
      } else if (data.status === 'qr_ready' && data.qr) {
        connectionBadge.classList.add('status-qr');
        connectionText.textContent = 'Escanear QR';
        qrImage.src = data.qr;
        qrPanel.classList.remove('hidden');
        disconnectBtn.classList.add('hidden');
      } else if (data.status === 'connecting') {
        connectionBadge.classList.add('status-connecting');
        connectionText.textContent = 'Iniciando...';
        qrPanel.classList.add('hidden');
        disconnectBtn.classList.add('hidden');
      } else {
        connectionBadge.classList.add('status-disconnected');
        connectionText.textContent = 'Desconectado';
        qrPanel.classList.add('hidden');
        disconnectBtn.classList.add('hidden');
      }
    } catch (err) {
      connectionBadge.className = 'connection-badge status-disconnected';
      connectionText.textContent = 'Servidor sin conexión';
      qrPanel.classList.add('hidden');
      disconnectBtn.classList.add('hidden');
    }
  }

  // Botón de desconexión
  disconnectBtn.addEventListener('click', async () => {
    if (!confirm('¿Estás seguro de que deseas cerrar la sesión de WhatsApp?\nNecesitarás escanear el código QR nuevamente para reconectarte.')) return;

    disconnectBtn.disabled = true;
    disconnectBtn.querySelector('span').textContent = 'Cerrando...';

    try {
      const res = await fetch('/api/disconnect', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        showStatus('✓ Sesión de WhatsApp cerrada correctamente.', 'success');
      } else {
        showStatus(data.error || 'No se pudo cerrar la sesión.', 'error');
      }
    } catch (e) {
      showStatus('Error al conectar con el servidor.', 'error');
    } finally {
      disconnectBtn.disabled = false;
      disconnectBtn.querySelector('span').textContent = 'Desconectar';
    }
  });

  // Comprobar estado cada 3 segundos
  checkWhatsAppStatus();
  setInterval(checkWhatsAppStatus, 3000);

  // Envío del formulario al servidor
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const phone = document.getElementById('phone').value.trim();
    const message = document.getElementById('message').value.trim();
    const date = dateInput.value;
    const time = timeInput.value;

    if (!phone || !message || !date || !time) {
      showStatus('Por favor, completa todos los campos requeridos.', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.querySelector('span').textContent = 'Guardando programación...';

    const formData = new FormData();
    formData.append('phone', phone);
    formData.append('message', message);
    formData.append('date', date);
    formData.append('time', time);

    if (fileInput.files && fileInput.files[0]) {
      formData.append('attachment', fileInput.files[0]);
    }

    try {
      const res = await fetch('/api/schedule', {
        method: 'POST',
        body: formData
      });

      const result = await res.json();

      if (res.ok && result.success) {
        showStatus(
          `✓ Mensaje programado exitosamente para el ${date} a las ${time} hacia ${phone}.`,
          'success'
        );
        form.reset();
        clearFilePreview();
        dateInput.value = today;
        await loadSchedules();
      } else {
        showStatus(result.error || 'No se pudo programar el mensaje.', 'error');
      }
    } catch (err) {
      console.error(err);
      showStatus('Error de conexión con el servidor. ¿Está el servidor iniciado?', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.querySelector('span').textContent = 'Programar Mensaje';
    }
  });

  function showStatus(text, type) {
    statusMessage.textContent = text;
    statusMessage.className = `status-message ${type}`;
    statusMessage.classList.remove('hidden');

    setTimeout(() => {
      statusMessage.classList.add('hidden');
    }, 8000);
  }

  // ========================================================
  // GESTIÓN DE MENSAJES PROGRAMADOS Y CUENTA REGRESIVA
  // ========================================================
  const scheduledCardsContainer = document.getElementById('scheduledCardsContainer');
  const scheduledCountBadge = document.getElementById('scheduledCountBadge');
  let currentSchedules = [];

  async function loadSchedules() {
    try {
      const res = await fetch('/api/schedules');
      if (!res.ok) return;
      const data = await res.json();
      currentSchedules = data || [];
      renderSchedules();
    } catch (e) {
      console.error('Error cargando mensajes programados:', e);
    }
  }

  function renderSchedules() {
    if (!scheduledCardsContainer) return;

    // Filtrar y ordenar: primero los pendientes más próximos, luego los enviados
    const sorted = [...currentSchedules].sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;
      return a.scheduledTime - b.scheduledTime;
    });

    const activeCount = sorted.filter(s => s.status === 'pending').length;
    scheduledCountBadge.textContent = `${activeCount} activo${activeCount === 1 ? '' : 's'}`;

    if (sorted.length === 0) {
      scheduledCardsContainer.innerHTML = `
        <div class="empty-scheduled">
          <p>No tienes mensajes programados en este momento.</p>
        </div>
      `;
      return;
    }

    scheduledCardsContainer.innerHTML = sorted.map(item => createScheduleCardHTML(item)).join('');

    // Asignar eventos de cancelación
    document.querySelectorAll('.btn-cancel-schedule').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        if (confirm('¿Estás seguro de cancelar este mensaje programado?')) {
          await cancelSchedule(id);
        }
      });
    });

    // Asignar eventos de eliminación (mensajes enviados / fallidos)
    document.querySelectorAll('.btn-delete-schedule').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        if (confirm('¿Eliminar este registro del historial?')) {
          await cancelSchedule(id);
        }
      });
    });

    // Actualizar inmediatamente la cuenta regresiva visual
    updateCountdowns();
  }

  function createScheduleCardHTML(item) {
    const isPending = item.status === 'pending';
    const isSent = item.status === 'sent';

    let statusTagHTML = '';
    if (isPending) {
      statusTagHTML = `<span class="countdown-status-tag tag-pending">En espera</span>`;
    } else if (isSent) {
      statusTagHTML = `<span class="countdown-status-tag tag-sent">✓ Enviado</span>`;
    } else {
      statusTagHTML = `<span class="countdown-status-tag tag-failed">✕ Error</span>`;
    }

    const cancelBtnHTML = isPending ? `
      <button type="button" class="btn-cancel-schedule" data-id="${item.id}" title="Cancelar envío">
        ✕ Cancelar
      </button>
    ` : `
      <button type="button" class="btn-delete-schedule" data-id="${item.id}" title="Eliminar registro">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/>
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
        Eliminar
      </button>
    `;

    let attachmentHTML = '';
    if (item.file) {
      attachmentHTML = `
        <div class="card-attachment-badge">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
          </svg>
          <span>${escapeHTML(item.file.originalName)}</span>
        </div>
      `;
    }

    return `
      <div class="scheduled-card ${item.status}" id="card-${item.id}" data-target-time="${item.scheduledTime}" data-status="${item.status}">
        <div class="card-top">
          <div class="card-phone-badge">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
            <span>${escapeHTML(item.phone)}</span>
          </div>
          <div class="card-top-right">
            <span class="card-datetime-badge">📅 ${item.date} ${item.time} hs</span>
            ${cancelBtnHTML}
          </div>
        </div>

        <div class="card-message-bubble">${escapeHTML(item.message)}</div>

        ${attachmentHTML}

        <!-- Temporizador de cuenta regresiva -->
        <div class="countdown-box">
          <div class="countdown-label-wrap">
            <span class="countdown-label">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              ${isPending ? 'Tiempo restante para el envío' : 'Estado del envío'}
            </span>
            ${statusTagHTML}
          </div>

          ${isPending ? `
            <div class="countdown-digits" id="timer-${item.id}">
              <div class="digit-card">
                <span class="digit-value" id="days-${item.id}">00</span>
                <span class="digit-unit">Días</span>
              </div>
              <span class="digit-sep">:</span>
              <div class="digit-card">
                <span class="digit-value" id="hours-${item.id}">00</span>
                <span class="digit-unit">Horas</span>
              </div>
              <span class="digit-sep">:</span>
              <div class="digit-card">
                <span class="digit-value" id="mins-${item.id}">00</span>
                <span class="digit-unit">Min</span>
              </div>
              <span class="digit-sep">:</span>
              <div class="digit-card">
                <span class="digit-value" id="secs-${item.id}">00</span>
                <span class="digit-unit">Seg</span>
              </div>
            </div>
          ` : `
            <div class="countdown-completed">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span>${isSent ? 'Mensaje enviado exitosamente a WhatsApp' : (item.error || 'Error en el envío')}</span>
            </div>
          `}
        </div>
      </div>
    `;
  }

  function updateCountdowns() {
    const now = Date.now();
    let hasExpiredPending = false;

    document.querySelectorAll('.scheduled-card[data-status="pending"]').forEach(card => {
      const targetTime = parseInt(card.dataset.targetTime, 10);
      const diff = targetTime - now;
      const cardId = card.id.replace('card-', '');

      if (diff <= 0) {
        hasExpiredPending = true;
        const timerContainer = document.getElementById(`timer-${cardId}`);
        if (timerContainer) {
          timerContainer.innerHTML = `
            <div class="countdown-completed" style="color: var(--accent-green);">
              <span class="pulse-indicator"></span>
              <span>Enviando ahora mismo por WhatsApp...</span>
            </div>
          `;
        }
      } else {
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const mins = Math.floor((diff / 1000 / 60) % 60);
        const secs = Math.floor((diff / 1000) % 60);

        const daysEl = document.getElementById(`days-${cardId}`);
        const hoursEl = document.getElementById(`hours-${cardId}`);
        const minsEl = document.getElementById(`mins-${cardId}`);
        const secsEl = document.getElementById(`secs-${cardId}`);

        if (daysEl) daysEl.textContent = String(days).padStart(2, '0');
        if (hoursEl) hoursEl.textContent = String(hours).padStart(2, '0');
        if (minsEl) minsEl.textContent = String(mins).padStart(2, '0');
        if (secsEl) secsEl.textContent = String(secs).padStart(2, '0');
      }
    });

    if (hasExpiredPending) {
      setTimeout(loadSchedules, 4000);
    }
  }

  async function cancelSchedule(id) {
    try {
      const res = await fetch(`/api/schedule/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) {
        showStatus('✓ Mensaje cancelado correctamente', 'success');
        await loadSchedules();
      } else {
        showStatus(data.error || 'No se pudo cancelar el mensaje', 'error');
      }
    } catch (e) {
      showStatus('Error al conectar con el servidor', 'error');
    }
  }

  function escapeHTML(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Cargar lista de programados de inmediato y refrescar
  loadSchedules();
  setInterval(loadSchedules, 5000);
  setInterval(updateCountdowns, 1000);
});

