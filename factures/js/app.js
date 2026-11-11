/* ============================================================
   App — Main entry point, logging, and sources management
   ============================================================ */

// ---- Logging ----
const AppLog = (() => {
  function log(level, message) {
    const time = new Date().toLocaleTimeString();
    const entry = `[${time}] ${message}`;
    console.log(entry);

    const logEl = document.getElementById('log-content');
    if (logEl) {
      const div = document.createElement('div');
      div.className = 'log-entry ' + level;
      div.textContent = entry;
      logEl.insertBefore(div, logEl.firstChild);

      // Keep max 200 entries
      while (logEl.children.length > 200) {
        logEl.removeChild(logEl.lastChild);
      }
    }
  }

  return {
    info: (msg) => log('info', msg),
    success: (msg) => log('success', '✅ ' + msg),
    warn: (msg) => log('warn', '⚠️ ' + msg),
    error: (msg) => log('error', '❌ ' + msg)
  };
})();

// ---- External Sources Management ----
const Sources = (() => {
  const STORAGE_KEY = 'factures_tool_sources';

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function save() {
    const items = document.querySelectorAll('.source-item-input');
    const sources = [];
    for (const item of items) {
      const url = item.querySelector('.source-url')?.value?.trim();
      const name = item.querySelector('.source-name')?.value?.trim();
      if (url) {
        sources.push({ url, name: name || url });
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sources));
    Config.set('sources', sources);
    AppLog.info('Fonts externes guardades: ' + sources.length);
  }

  function addSource() {
    const list = document.getElementById('sources-list');
    if (!list) return;

    const div = document.createElement('div');
    div.className = 'source-item source-item-input';
    div.innerHTML = `
      <input class="source-name" type="text" placeholder="Nom (ex: Amazon)" style="width:120px" />
      <input class="source-url" type="text" placeholder="https://www.amazon.es/..." style="flex:1" />
      <button class="btn btn-sm btn-danger" onclick="this.parentElement.remove();Sources.save()">✕</button>
    `;
    list.appendChild(div);
  }

  function populateUI() {
    const list = document.getElementById('sources-list');
    if (!list) return;

    list.innerHTML = '';
    const sources = load();

    for (const src of sources) {
      const div = document.createElement('div');
      div.className = 'source-item source-item-input';
      div.innerHTML = `
        <input class="source-name" type="text" value="${src.name || ''}" placeholder="Nom" style="width:120px" />
        <input class="source-url" type="text" value="${src.url || ''}" placeholder="URL" style="flex:1" />
        <button class="btn btn-sm btn-danger" onclick="this.parentElement.remove();Sources.save()">✕</button>
      `;
      list.appendChild(div);
    }

    if (sources.length === 0) {
      list.innerHTML = '<p class="help-text">Cap font externa configurada. Afegeix URLs de portals de proveïdors on descarregues factures.</p>';
    }
  }

  return { load, save, addSource, populateUI };
})();

// ---- Configuration display ----
function mostrarConfiguracio() {
  UI.togglePanel('settings');
}

// ---- App initialization ----
document.addEventListener('DOMContentLoaded', async () => {
  AppLog.info('Factures Tool inicialitzant...');

  // Populate config UI from localStorage
  Config.populateUI();
  Suppliers.populateUI();

  // Try to init auth if client ID is configured
  const clientId = Config.get('clientId');
  if (clientId) {
    // Wait for Google scripts to load
    const waitForGoogle = () => new Promise(resolve => {
      const check = () => {
        if (typeof gapi !== 'undefined' && typeof google !== 'undefined' && google.accounts) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
      // Timeout after 10s
      setTimeout(resolve, 10000);
    });

    await waitForGoogle();

    try {
      await Auth.init();
    } catch (e) {
      AppLog.error('Error inicialitzant auth: ' + e.message);
    }
  } else {
    AppLog.info('No hi ha Client ID configurat. Ves a ⚙️ Configuració per començar.');
  }

  // Restore previous scan results if available
  if (UI.restoreFromStorage()) {
    UI.updateScanButtons();
  }

  AppLog.info('Factures Tool llest!');
});
