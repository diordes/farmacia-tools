/* ============================================================
   Auth — Google OAuth2 multi-account management
   ============================================================ */
const Auth = (() => {
  const SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.labels',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/userinfo.email'
  ].join(' ');

  const STORAGE_KEY = 'factures_tool_accounts';
  let tokenClient = null;
  let gapiInited = false;
  let gisInited = false;
  let pendingResolve = null;

  // Load saved accounts (email → {email, accessToken, expiresAt})
  function loadAccounts() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveAccounts(accounts) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
    } catch (e) {
      console.warn('Failed to save accounts:', e);
    }
  }

  function getAccounts() {
    return Object.values(loadAccounts());
  }

  function getActiveTokens() {
    const accounts = loadAccounts();
    const now = Date.now();
    return Object.values(accounts).filter(a => a.accessToken && a.expiresAt > now);
  }

  async function init() {
    const clientId = Config.get('clientId');
    if (!clientId) {
      AppLog.info('No hi ha Client ID configurat. Ves a ⚙️ Configuració.');
      return;
    }

    // Init GAPI
    if (!gapiInited) {
      await new Promise((resolve, reject) => {
        if (typeof gapi === 'undefined') {
          reject(new Error('gapi not loaded'));
          return;
        }
        gapi.load('client', async () => {
          try {
            await gapi.client.init({
              // Don't set apiKey here — we use OAuth tokens
            });
            await gapi.client.load('gmail', 'v1');
            await gapi.client.load('drive', 'v3');
            gapiInited = true;
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    }

    // Init GIS token client
    if (typeof google !== 'undefined' && google.accounts) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: handleTokenResponse,
        error_callback: handleTokenError
      });
      gisInited = true;
    }

    UI.updateAccountsBar();
    UI.updateScanButtons();
    AppLog.info('Auth inicialitzat. ' + getActiveTokens().length + ' comptes actius.');
  }

  function handleTokenResponse(resp) {
    console.log('[Auth] Token response received:', Object.keys(resp));
    if (resp.error) {
      const msg = 'Error d\'autenticació: ' + resp.error + (resp.error_description ? ' — ' + resp.error_description : '');
      AppLog.error(msg);
      console.error('[Auth]', msg);
      if (pendingResolve) { pendingResolve(null); pendingResolve = null; }
      return;
    }

    AppLog.info('Token rebut! Obtenint info del compte...');

    // Get user email
    gapi.client.setToken({ access_token: resp.access_token });

    // Fetch user info to get email
    fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: 'Bearer ' + resp.access_token }
    })
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(info => {
      const email = info.email;
      const accounts = loadAccounts();
      accounts[email] = {
        email,
        accessToken: resp.access_token,
        expiresAt: Date.now() + (resp.expires_in * 1000)
      };
      saveAccounts(accounts);

      UI.updateAccountsBar();
      UI.updateScanButtons();
      UI.updateDriveAccountSelector && UI.updateDriveAccountSelector();
      AppLog.success('✅ Compte connectat: ' + email);

      if (pendingResolve) { pendingResolve(email); pendingResolve = null; }
    })
    .catch(e => {
      AppLog.error('Error obtenint info del compte: ' + e.message);
      console.error('[Auth] userinfo fetch failed:', e);
      if (pendingResolve) { pendingResolve(null); pendingResolve = null; }
    });
  }

  function handleTokenError(err) {
    const msg = typeof err === 'object' ? JSON.stringify(err) : String(err);
    console.error('[Auth] OAuth error callback:', err);
    if (err && err.type === 'popup_closed') {
      AppLog.warn('⚠️ S\'ha tancat la finestra d\'autenticació. Torna a provar.');
    } else {
      AppLog.error('Error OAuth: ' + msg);
    }
    if (pendingResolve) { pendingResolve(null); pendingResolve = null; }
  }

  async function addAccount() {
    const clientId = Config.get('clientId');
    if (!clientId) {
      alert('⚠️ Primer configura el Client ID de Google Cloud a ⚙️ Configuració');
      return;
    }

    if (!gisInited) {
      await init();
    }

    if (!tokenClient) {
      alert('⚠️ No s\'ha pogut inicialitzar l\'autenticació. Revisa el Client ID.');
      return;
    }

    AppLog.info('🔐 Obrint finestra d\'autenticació de Google...');

    return new Promise(resolve => {
      pendingResolve = resolve;
      // 'select_account' shows account picker without forcing re-consent
      // This avoids popup_closed errors on unverified apps where consent was already granted
      tokenClient.requestAccessToken({ prompt: 'select_account' });
    });
  }

  function removeAccount(email) {
    const accounts = loadAccounts();
    delete accounts[email];
    saveAccounts(accounts);
    UI.updateAccountsBar();
    UI.updateScanButtons();
    AppLog.info('Compte desconnectat: ' + email);
  }

  // Set gapi token for a specific account
  function useAccount(email) {
    const accounts = loadAccounts();
    const account = accounts[email];
    if (!account || !account.accessToken) return false;

    // Check expiry
    if (account.expiresAt < Date.now()) {
      AppLog.warn('Token expirat per ' + email + '. Torna a connectar.');
      return false;
    }

    gapi.client.setToken({ access_token: account.accessToken });
    return true;
  }

  async function refreshIfNeeded(email) {
    const accounts = loadAccounts();
    const account = accounts[email];
    if (!account) return false;

    // If token expires in less than 5 minutes, refresh
    if (account.expiresAt < Date.now() + 300000) {
      AppLog.info('Refrescant token per ' + email + '...');
      return new Promise(resolve => {
        pendingResolve = (result) => resolve(!!result);
        tokenClient.requestAccessToken({ prompt: '', login_hint: email });
      });
    }
    return true;
  }

  return { init, addAccount, removeAccount, getAccounts, getActiveTokens, useAccount, refreshIfNeeded, loadAccounts };
})();
