/* ============================================================
   Config — localStorage persistence for settings
   ============================================================ */
const Config = (() => {
  const STORAGE_KEY = 'factures_tool_config';

  const DEFAULTS = {
    clientId: '549787827669-0bp6nfh8rg518hn2q3uj8l92dbk67s42.apps.googleusercontent.com',
    apiKey: '',
    driveAccount: '',  // email del compte Drive destí (buit = mateixa que l'origen)
    driveFolderName: 'Factures {YEAR}',
    monthsBack: 3,
    sources: [],  // external web sources
    accounts: []  // {email, token} — tokens stored separately
  };

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function persist(cfg) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch (e) {
      console.warn('Config save failed:', e);
    }
  }

  function save() {
    const cfg = load();
    const clientId = document.getElementById('input-client-id')?.value?.trim();
    const apiKey = document.getElementById('input-api-key')?.value?.trim();
    const driveFolder = document.getElementById('input-drive-folder')?.value?.trim();
    const monthsBack = parseInt(document.getElementById('input-months-back')?.value) || 3;

    const driveAccount = document.getElementById('input-drive-account')?.value?.trim();

    if (clientId) cfg.clientId = clientId;
    if (apiKey !== undefined) cfg.apiKey = apiKey;
    if (driveAccount !== undefined) cfg.driveAccount = driveAccount;
    if (driveFolder) cfg.driveFolderName = driveFolder;
    cfg.monthsBack = monthsBack;

    persist(cfg);

    // Reload auth if clientId changed
    if (clientId && clientId !== load().clientId) {
      Auth.init();
    }

    AppLog.info('Configuració guardada');
    alert('✅ Configuració guardada!');
  }

  function get(key) {
    return load()[key];
  }

  function set(key, value) {
    const cfg = load();
    cfg[key] = value;
    persist(cfg);
  }

  function populateUI() {
    const cfg = load();
    const el = (id) => document.getElementById(id);
    if (el('input-client-id')) el('input-client-id').value = cfg.clientId || '';
    if (el('input-api-key')) el('input-api-key').value = cfg.apiKey || '';
    if (el('input-drive-account')) el('input-drive-account').value = cfg.driveAccount || '';
    if (el('input-drive-folder')) el('input-drive-folder').value = cfg.driveFolderName || 'Factures_Comptabilitat';
    if (el('input-months-back')) el('input-months-back').value = cfg.monthsBack || 3;
  }

  return { load, save, get, set, persist, populateUI, DEFAULTS };
})();
