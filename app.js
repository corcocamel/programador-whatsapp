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

  // Elementos del selector y autocompletado de contactos
  const phoneInput = document.getElementById('phone');
  const openContactsBtn = document.getElementById('openContactsBtn');
  const contactsCountBadge = document.getElementById('contactsCountBadge');
  const clearPhoneBtn = document.getElementById('clearPhoneBtn');
  const contactsDropdown = document.getElementById('contactsDropdown');
  const contactsDropdownList = document.getElementById('contactsDropdownList');
  const selectedContactChip = document.getElementById('selectedContactChip');
  const chipAvatar = document.getElementById('chipAvatar');
  const chipName = document.getElementById('chipName');
  const chipSub = document.getElementById('chipSub');
  const removeSelectedContact = document.getElementById('removeSelectedContact');

  // Elementos del Modal de Contactos
  const contactsModal = document.getElementById('contactsModal');
  const closeContactsModal = document.getElementById('closeContactsModal');
  const contactSearchInput = document.getElementById('contactSearchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const contactsModalList = document.getElementById('contactsModalList');
  const contactsEmptyState = document.getElementById('contactsEmptyState');
  const contactsNotConnectedNotice = document.getElementById('contactsNotConnectedNotice');
  const tabBtns = document.querySelectorAll('.modal-filter-tabs .tab-btn');
  const countAll = document.getElementById('countAll');
  const countContacts = document.getElementById('countContacts');
  const countGroups = document.getElementById('countGroups');
  const modalBodyScroll = document.getElementById('modalBodyScroll');
  const modalSearchSummary = document.getElementById('modalSearchSummary');

  // Estado de Contactos
  let contactsData = [];
  let currentTabFilter = 'contacts'; // Por defecto muestra la agenda de contactos
  let isWhatsAppConnected = false;
  let currentFilteredList = [];
  let currentRenderOffset = 0;
  const CHUNK_SIZE = 50;

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

  // ========================================================
  // GESTIÓN Y SINCRONIZACIÓN DE CONTACTOS DE WHATSAPP
  // ========================================================

  function formatPhoneDisplay(phone) {
    if (!phone) return '';
    const clean = phone.replace(/[^0-9]/g, '');
    if (clean.startsWith('549') && clean.length >= 12) {
      const area = clean.substring(3, clean.length - 7);
      const mid = clean.substring(clean.length - 7, clean.length - 4);
      const end = clean.substring(clean.length - 4);
      return `+54 9 ${area} ${mid}-${end}`;
    } else if (clean.startsWith('54') && clean.length >= 10) {
      return `+54 ${clean.substring(2)}`;
    }
    return `+${clean}`;
  }

  function getAvatarColor(name) {
    const colors = [
      'linear-gradient(135deg, #128c7e 0%, #075e54 100%)',
      'linear-gradient(135deg, #00a884 0%, #005c4b 100%)',
      'linear-gradient(135deg, #34b7f1 0%, #128c7e 100%)',
      'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)',
      'linear-gradient(135deg, #e11d48 0%, #881337 100%)',
      'linear-gradient(135deg, #ea580c 0%, #9a3412 100%)',
      'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
      'linear-gradient(135deg, #059669 0%, #064e3b 100%)',
      'linear-gradient(135deg, #d97706 0%, #78350f 100%)'
    ];
    if (!name) return colors[0];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  }

  function getInitials(name, isGroup) {
    if (isGroup) return '👥';
    if (!name) return '👤';
    const clean = name.replace(/[^\p{L}\p{N}\s]/gu, '').trim();
    if (!clean) return '👤';
    const parts = clean.split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return clean.substring(0, 2).toUpperCase();
  }

  async function loadContacts(silent = false) {
    try {
      const res = await fetch('/api/contacts');
      if (!res.ok) return;
      const data = await res.json();
      contactsData = data.contacts || [];

      // Actualizar contadores
      const total = contactsData.length;
      const contactsCount = contactsData.filter(c => !c.isGroup && c.hasRealName).length;
      const groupsCount = contactsData.filter(c => c.isGroup).length;

      if (countAll) countAll.textContent = total;
      if (countContacts) countContacts.textContent = contactsCount;
      if (countGroups) countGroups.textContent = groupsCount;

      if (total > 0 && isWhatsAppConnected) {
        contactsCountBadge.textContent = contactsCount > 0 ? contactsCount : total;
        contactsCountBadge.classList.remove('hidden');
      } else {
        contactsCountBadge.classList.add('hidden');
      }

      if (!contactsModal.classList.contains('hidden')) {
        renderModalContacts();
      }
    } catch (err) {
      if (!silent) console.error('Error al cargar contactos:', err);
    }
  }

  function selectContact(contact) {
    const value = contact.isGroup ? contact.id : (contact.phone ? `+${contact.phone}` : contact.id.split('@')[0]);
    phoneInput.value = value;
    clearPhoneBtn.classList.remove('hidden');

    // Mostrar Chip informativo
    chipAvatar.textContent = getInitials(contact.name, contact.isGroup);
    chipAvatar.className = 'chip-avatar' + (contact.isGroup ? ' is-group' : '');
    chipAvatar.style.background = contact.isGroup ? 'linear-gradient(135deg, #34b7f1 0%, #128c7e 100%)' : getAvatarColor(contact.name);
    chipName.textContent = contact.name;
    chipSub.textContent = contact.isGroup ? 'Grupo de WhatsApp' : (contact.phone ? formatPhoneDisplay(contact.phone) : 'Contacto');
    selectedContactChip.classList.remove('hidden');

    // Cerrar sugerencias y modal
    closeDropdown();
    closeModal();
  }

  function clearSelectedContact() {
    selectedContactChip.classList.add('hidden');
    chipName.textContent = '';
    chipSub.textContent = '';
  }

  // Autocompletado rápido al escribir en el input
  function renderDropdown(query) {
    if (!query || contactsData.length === 0) {
      closeDropdown();
      return;
    }

    const q = query.toLowerCase().trim();
    const matches = contactsData.filter(c => {
      const nameMatch = c.name && c.name.toLowerCase().includes(q);
      const phoneMatch = c.phone && c.phone.includes(q);
      const notifyMatch = c.notify && c.notify.toLowerCase().includes(q);
      return nameMatch || phoneMatch || notifyMatch;
    }).slice(0, 6);

    if (matches.length === 0) {
      closeDropdown();
      return;
    }

    contactsDropdownList.innerHTML = '';
    matches.forEach(c => {
      const item = document.createElement('div');
      item.className = 'dropdown-contact-item';

      const avatar = document.createElement('div');
      avatar.className = 'contact-avatar-sm' + (c.isGroup ? ' is-group' : '');
      avatar.style.background = c.isGroup ? 'linear-gradient(135deg, #34b7f1 0%, #128c7e 100%)' : getAvatarColor(c.name);
      avatar.textContent = getInitials(c.name, c.isGroup);

      const details = document.createElement('div');
      details.className = 'dropdown-contact-details';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'dropdown-contact-name';
      nameSpan.textContent = c.name;

      const subSpan = document.createElement('span');
      subSpan.className = 'dropdown-contact-sub';
      subSpan.textContent = c.isGroup ? 'Grupo' : (c.phone ? formatPhoneDisplay(c.phone) : '');

      details.appendChild(nameSpan);
      details.appendChild(subSpan);
      item.appendChild(avatar);
      item.appendChild(details);

      item.addEventListener('click', () => {
        selectContact(c);
      });

      contactsDropdownList.appendChild(item);
    });

    contactsDropdown.classList.remove('hidden');
  }

  function closeDropdown() {
    contactsDropdown.classList.add('hidden');
  }

  phoneInput.addEventListener('input', (e) => {
    const val = e.target.value;
    if (val.trim()) {
      clearPhoneBtn.classList.remove('hidden');
      renderDropdown(val);
    } else {
      clearPhoneBtn.classList.add('hidden');
      clearSelectedContact();
      closeDropdown();
    }
  });

  clearPhoneBtn.addEventListener('click', () => {
    phoneInput.value = '';
    clearPhoneBtn.classList.add('hidden');
    clearSelectedContact();
    closeDropdown();
    phoneInput.focus();
  });

  removeSelectedContact.addEventListener('click', () => {
    clearSelectedContact();
    phoneInput.value = '';
    clearPhoneBtn.classList.add('hidden');
    phoneInput.focus();
  });

  // Cerrar dropdown al hacer click fuera
  document.addEventListener('click', (e) => {
    if (!phoneInput.contains(e.target) && !contactsDropdown.contains(e.target)) {
      closeDropdown();
    }
  });

  // ========================================================
  // MODAL SELECTOR DE CONTACTOS
  // ========================================================

  function openModal() {
    contactsModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    contactSearchInput.value = '';
    clearSearchBtn.classList.add('hidden');

    if (!isWhatsAppConnected && contactsData.length === 0) {
      contactsNotConnectedNotice.classList.remove('hidden');
      contactsEmptyState.classList.add('hidden');
      contactsModalList.innerHTML = '';
      if (modalSearchSummary) modalSearchSummary.textContent = 'WhatsApp desconectado';
    } else {
      contactsNotConnectedNotice.classList.add('hidden');
      renderModalContacts();
      setTimeout(() => contactSearchInput.focus(), 100);
    }
  }

  function closeModal() {
    contactsModal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  openContactsBtn.addEventListener('click', openModal);
  closeContactsModal.addEventListener('click', closeModal);

  contactsModal.addEventListener('click', (e) => {
    if (e.target === contactsModal) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !contactsModal.classList.contains('hidden')) {
      closeModal();
    }
  });

  // Filtros por pestaña
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTabFilter = btn.dataset.filter;
      renderModalContacts();
    });
  });

  // Búsqueda en modal
  contactSearchInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (val) {
      clearSearchBtn.classList.remove('hidden');
    } else {
      clearSearchBtn.classList.add('hidden');
    }
    renderModalContacts();
  });

  clearSearchBtn.addEventListener('click', () => {
    contactSearchInput.value = '';
    clearSearchBtn.classList.add('hidden');
    contactSearchInput.focus();
    renderModalContacts();
  });

  function createContactCardElement(c) {
    const card = document.createElement('div');
    card.className = 'contact-card-item';

    const left = document.createElement('div');
    left.className = 'contact-card-left';

    const avatar = document.createElement('div');
    avatar.className = 'contact-avatar-md' + (c.isGroup ? ' is-group' : '');
    avatar.style.background = c.isGroup ? 'linear-gradient(135deg, #34b7f1 0%, #128c7e 100%)' : getAvatarColor(c.name);
    avatar.textContent = getInitials(c.name, c.isGroup);

    const info = document.createElement('div');
    info.className = 'contact-card-info';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'contact-card-title';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'contact-card-name';
    nameSpan.textContent = c.name;
    titleWrap.appendChild(nameSpan);

    if (c.isGroup) {
      const groupBadge = document.createElement('span');
      groupBadge.className = 'badge-group';
      groupBadge.textContent = 'Grupo';
      titleWrap.appendChild(groupBadge);
    } else if (c.notify && c.notify !== c.name) {
      const notifyBadge = document.createElement('span');
      notifyBadge.className = 'badge-notify';
      notifyBadge.textContent = `~${c.notify}`;
      titleWrap.appendChild(notifyBadge);
    }

    const phoneSpan = document.createElement('span');
    phoneSpan.className = c.isGroup ? 'contact-card-sub' : 'contact-card-phone';
    phoneSpan.textContent = c.isGroup ? 'Grupo de WhatsApp' : (c.phone ? formatPhoneDisplay(c.phone) : 'Sin número');

    info.appendChild(titleWrap);
    info.appendChild(phoneSpan);

    left.appendChild(avatar);
    left.appendChild(info);

    const action = document.createElement('span');
    action.className = 'contact-card-action';
    action.textContent = 'Seleccionar';

    card.appendChild(left);
    card.appendChild(action);

    card.addEventListener('click', () => {
      selectContact(c);
    });

    return card;
  }

  function appendNextContactChunk() {
    if (currentRenderOffset >= currentFilteredList.length) return;
    const chunk = currentFilteredList.slice(currentRenderOffset, currentRenderOffset + CHUNK_SIZE);
    const fragment = document.createDocumentFragment();
    chunk.forEach(c => {
      fragment.appendChild(createContactCardElement(c));
    });
    contactsModalList.appendChild(fragment);
    currentRenderOffset += chunk.length;
  }

  // Scroll infinito en el modal
  if (modalBodyScroll) {
    modalBodyScroll.addEventListener('scroll', () => {
      if (modalBodyScroll.scrollTop + modalBodyScroll.clientHeight >= modalBodyScroll.scrollHeight - 150) {
        appendNextContactChunk();
      }
    });
  }

  function renderModalContacts() {
    const query = contactSearchInput.value.toLowerCase().trim();

    let filtered = contactsData;

    // Filtro por pestaña
    if (currentTabFilter === 'contacts') {
      filtered = filtered.filter(c => !c.isGroup && c.hasRealName);
    } else if (currentTabFilter === 'groups') {
      filtered = filtered.filter(c => c.isGroup);
    }

    // Filtro por texto
    if (query) {
      filtered = filtered.filter(c => {
        const nameMatch = c.name && c.name.toLowerCase().includes(query);
        const phoneMatch = c.phone && c.phone.includes(query);
        const notifyMatch = c.notify && c.notify.toLowerCase().includes(query);
        return nameMatch || phoneMatch || notifyMatch;
      });
    }

    currentFilteredList = filtered;
    currentRenderOffset = 0;
    contactsModalList.innerHTML = '';

    // Actualizar texto informativo de resumen
    if (modalSearchSummary) {
      if (query) {
        modalSearchSummary.textContent = `Encontrados ${filtered.length} contactos para "${query}"`;
      } else if (currentTabFilter === 'contacts') {
        modalSearchSummary.textContent = `Mostrando ${filtered.length} contactos guardados en tu agenda de WhatsApp`;
      } else if (currentTabFilter === 'groups') {
        modalSearchSummary.textContent = `Mostrando ${filtered.length} grupos de WhatsApp`;
      } else {
        modalSearchSummary.textContent = `Mostrando ${filtered.length} contactos y chats`;
      }
    }

    if (filtered.length === 0) {
      contactsEmptyState.classList.remove('hidden');
      return;
    } else {
      contactsEmptyState.classList.add('hidden');
    }

    // Renderizar primer bloque de contactos
    appendNextContactChunk();
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

        if (!isWhatsAppConnected) {
          isWhatsAppConnected = true;
          loadContacts();
        }
      } else if (data.status === 'qr_ready' && data.qr) {
        isWhatsAppConnected = false;
        connectionBadge.classList.add('status-qr');
        connectionText.textContent = 'Escanear QR';
        qrImage.src = data.qr;
        qrPanel.classList.remove('hidden');
        disconnectBtn.classList.add('hidden');
        contactsCountBadge.classList.add('hidden');
      } else if (data.status === 'connecting') {
        isWhatsAppConnected = false;
        connectionBadge.classList.add('status-connecting');
        connectionText.textContent = 'Iniciando...';
        qrPanel.classList.add('hidden');
        disconnectBtn.classList.add('hidden');
      } else {
        isWhatsAppConnected = false;
        connectionBadge.classList.add('status-disconnected');
        connectionText.textContent = 'Desconectado';
        qrPanel.classList.add('hidden');
        disconnectBtn.classList.add('hidden');
        contactsCountBadge.classList.add('hidden');
      }
    } catch (err) {
      isWhatsAppConnected = false;
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
        contactsData = [];
        clearSelectedContact();
        phoneInput.value = '';
        contactsCountBadge.classList.add('hidden');
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

  // Refrescar contactos periódicamente si WhatsApp está conectado
  setInterval(() => {
    if (isWhatsAppConnected) {
      loadContacts(true);
    }
  }, 10000);

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

    // Calcular el timestamp exacto en la zona horaria del usuario
    const localScheduledDate = new Date(`${date}T${time}:00`);
    const scheduledTimestamp = localScheduledDate.getTime();

    if (isNaN(scheduledTimestamp)) {
      showStatus('Fecha u hora seleccionada inválida.', 'error');
      return;
    }

    if (scheduledTimestamp <= Date.now()) {
      showStatus('La hora seleccionada ya pasó. Por favor elige una hora futura.', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.querySelector('span').textContent = 'Guardando programación...';

    const formData = new FormData();
    formData.append('phone', phone);
    formData.append('message', message);
    formData.append('date', date);
    formData.append('time', time);
    formData.append('scheduledTimestamp', scheduledTimestamp.toString());

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
        clearSelectedContact();
        clearPhoneBtn.classList.add('hidden');
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

