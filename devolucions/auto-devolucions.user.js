// ==UserScript==
// @name         Farmàcia Central BCN — Auto Devolucions
// @namespace    https://diordes.github.io/farmacia-tools
// @version      2.0.8
// @description  Automatitza les devolucions als portals dels majoristes (Alliance Healthcare)
// @author       Farmàcia Central BCN
// @match        https://my.alliance-healthcare.es/*
// @match        https://diordes.github.io/farmacia-tools/*
// @noframes
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/diordes/farmacia-tools/main/devolucions/auto-devolucions.user.js
// @downloadURL  https://raw.githubusercontent.com/diordes/farmacia-tools/main/devolucions/auto-devolucions.user.js
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';

  // ══════════════════════════════════════════════
  //  CONFIGURACIÓ
  // ══════════════════════════════════════════════

  const CONFIG = {
    POLL_INTERVAL: 500,       // ms entre comprovacions DOM
    MAX_WAIT: 20000,          // ms màxim d'espera per un element
    ACTION_DELAY: 1000,       // ms pausa entre accions (SPA render)
    SEARCH_DELAY: 2000,       // ms pausa després d'una cerca
    LOADING_WAIT: 15000,      // ms màxim d'espera per .tsfz-loading-modal
    PAGE_LOAD_DELAY: 6000,    // ms espera carrega "Solicitar devolución parcial"
    STALE_MS: 3600000,        // 1h — dades pendents caduquen
  };

  // ══════════════════════════════════════════════
  //  UTILITATS
  // ══════════════════════════════════════════════

  function log(msg, ...args) {
    console.log(`[AutoDevolucions v2.0.8] ${msg}`, ...args);
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function getAngular() {
    try { return (typeof unsafeWindow !== 'undefined' && unsafeWindow.angular) || window.angular || null; }
    catch (e) { return null; }
  }

  /** Línia de diagnòstic per quan alguna cosa falla */
  function debugState(where) {
    try {
      const btns = document.querySelectorAll('[ng-click="searchByProduct()"]');
      const vis = [...btns].filter(isVisible).length;
      const load = document.querySelector('.tsfz-loading-modal');
      const modals = [...document.querySelectorAll('.modal')].filter(isVisible).length;
      status(`🔧 [${where}] hash=<code>${location.hash || '(buit)'}</code> · #search-buttons=${document.querySelectorAll('#search-buttons').length} · searchByProduct=${btns.length} (visibles ${vis}) · #productCode=${document.querySelectorAll('#productCode').length} · loading=${load ? (isVisible(load) ? 'visible' : 'amagat') : 'no'} · modals visibles=${modals} · angular=${getAngular() ? 'sí' : 'no'}`, 'warn');
      const h = document.querySelector('h1, h2, .page-title');
      if (h) status(`🔧 títol pàgina: ${(h.textContent || '').trim().slice(0, 80)}`, 'warn');
    } catch (e) { log('debugState error', e); }
  }

  /** Visible de debò? (offsetParent és null per a elements position:fixed -> modals/overlays) */
  function isVisible(el) {
    if (!el) return false;
    if (!el.getClientRects || el.getClientRects().length === 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  /** Espera que aparegui un element (selector o funció). Retorna l'element o null. */
  function waitForEl(selectorOrFn, timeout = CONFIG.MAX_WAIT) {
    return new Promise(resolve => {
      const start = Date.now();
      const check = () => {
        const el = typeof selectorOrFn === 'function'
          ? selectorOrFn()
          : document.querySelector(selectorOrFn);
        if (el) return resolve(el);
        if (Date.now() - start > timeout) return resolve(null);
        setTimeout(check, CONFIG.POLL_INTERVAL);
      };
      check();
    });
  }

  /** Espera que un element desaparegui o es faci invisible. */
  function waitForElGone(selector, timeout = CONFIG.LOADING_WAIT) {
    return new Promise(resolve => {
      const start = Date.now();
      const check = () => {
        const el = document.querySelector(selector);
        if (!el || !isVisible(el)) {
          return resolve(true);
        }
        if (Date.now() - start > timeout) return resolve(false);
        setTimeout(check, CONFIG.POLL_INTERVAL);
      };
      check();
    });
  }

  /** Posa valor a un input triggejant events Angular (input + change). */
  function setInputValue(input, value) {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    setter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    // Fallback Angular: si el model no s'ha enterat, forçar-lo via ngModelController
    try {
      const ng = getAngular();
      if (ng) {
        const ctrl = ng.element(input).controller('ngModel');
        if (ctrl && String(ctrl.$viewValue) !== String(value)) {
          const scope = ng.element(input).scope();
          const apply = () => { ctrl.$setViewValue(String(value)); ctrl.$render(); };
          if (scope && scope.$root && !scope.$root.$$phase) scope.$apply(apply); else apply();
          log('setInputValue: Angular $setViewValue fallback used');
        }
      }
    } catch (e) { log('setInputValue Angular fallback error', e); }
  }

  /** Posa valor a un select triggejant change per Angular. */
  function setSelectValue(select, value) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype, 'value'
    ).set;
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ══════════════════════════════════════════════
  //  GM STORAGE — dades cross-domain
  // ══════════════════════════════════════════════

  function storePending(products, wholesaler, options = {}) {
    GM_setValue('pending_return', JSON.stringify({
      products, wholesaler, options, ts: Date.now()
    }));
    log(`Stored ${products.length} products for ${wholesaler} (options: ${JSON.stringify(options)})`);
  }

  function getPending() {
    const raw = GM_getValue('pending_return', null);
    if (!raw) return null;
    try {
      const d = JSON.parse(raw);
      if (Date.now() - d.ts > CONFIG.STALE_MS) {
        GM_deleteValue('pending_return');
        log('Pending return expired');
        return null;
      }
      // Assegurar que options existeix
      if (!d.options) d.options = {};
      return d;
    } catch (e) {
      GM_deleteValue('pending_return');
      return null;
    }
  }

  function clearPending() {
    GM_deleteValue('pending_return');
    log('Cleared pending return data');
  }

  // ══════════════════════════════════════════════
  //  OVERLAY D'ESTAT
  // ══════════════════════════════════════════════

  function createOverlay() {
    const old = document.getElementById('farmacia-auto-status');
    if (old) old.remove();

    const ov = document.createElement('div');
    ov.id = 'farmacia-auto-status';
    ov.style.cssText = 'position:fixed;top:16px;right:16px;width:360px;background:#1e293b;color:#f1f5f9;border-radius:12px;padding:16px 20px;font-family:Inter,-apple-system,sans-serif;font-size:13px;line-height:1.5;z-index:99999;box-shadow:0 20px 40px rgba(0,0,0,0.3)';
    ov.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <span style="font-size:18px">🔄</span>
        <strong style="font-size:14px">Auto Devolucions v2.0.8</strong>
        <span id="fa-badge" style="margin-left:auto;font-size:11px;padding:2px 8px;border-radius:10px;background:#3b82f6;color:white;font-weight:600">Processant...</span>
      </div>
      <div id="fa-log" style="max-height:220px;overflow-y:auto;font-size:12px;color:#94a3b8"></div>
      <div style="margin-top:12px;height:4px;background:#334155;border-radius:2px;overflow:hidden">
        <div id="fa-bar" style="height:100%;background:#3b82f6;border-radius:2px;width:0;transition:width 0.3s"></div>
      </div>`;
    document.body.appendChild(ov);
  }

  const ICONS = { info: 'ℹ️', ok: '✅', warn: '⚠️', error: '❌', search: '🔍', wait: '⏳' };

  function status(msg, type = 'info') {
    const el = document.getElementById('fa-log');
    if (!el) return;
    const d = document.createElement('div');
    d.style.marginBottom = '4px';
    d.innerHTML = `${ICONS[type] || '·'} ${msg}`;
    el.appendChild(d);
    el.scrollTop = el.scrollHeight;
    log(msg);
  }

  function progress(cur, total) {
    const b = document.getElementById('fa-bar');
    if (b) b.style.width = `${(cur / total) * 100}%`;
  }

  function badge(text, color) {
    const b = document.getElementById('fa-badge');
    if (b) { b.textContent = text; b.style.background = color; }
  }

  function addCloseBtn() {
    const ov = document.getElementById('farmacia-auto-status');
    if (!ov) return;
    const btn = document.createElement('button');
    btn.textContent = '✕ Tancar';
    btn.style.cssText = 'margin-top:12px;width:100%;padding:8px;background:#334155;color:#f1f5f9;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600';
    btn.onclick = () => ov.remove();
    ov.appendChild(btn);
  }

  // ══════════════════════════════════════════════
  //  HELPERS PORTAL
  // ══════════════════════════════════════════════

  /** Tanca el banner de cookies OneTrust si existeix. */
  async function dismissCookies() {
    const btn = document.querySelector(
      '#onetrust-reject-all-handler, .onetrust-close-btn-handler, #onetrust-accept-btn-handler'
    );
    if (btn) {
      btn.click();
      await sleep(500);
      log('Cookie banner dismissed');
    }
  }

  /** Espera que el loading modal (.tsfz-loading-modal) desaparegui. */
  async function waitLoading() {
    await sleep(300);
    const el = document.querySelector('.tsfz-loading-modal');
    if (el && isVisible(el)) {
      status('Esperant càrrega...', 'info');
      const gone = await waitForElGone('.tsfz-loading-modal');
      if (!gone) status('La càrrega ("Cargando") no acaba — continuo igualment', 'warn');
    }
    await sleep(500);
  }

  // ══════════════════════════════════════════════
  //  ALLIANCE HEALTHCARE — AUTOMATITZACIÓ
  // ══════════════════════════════════════════════

  // ── Assegurar que som a #/requests/products i que s'hi queda (el portal de vegades torna a #/) ──
  const onProducts = () => location.hash.includes('/requests/products');

  async function hashStable(ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (!onProducts()) return false; await sleep(250); }
    return true;
  }

  function findSolicitarBtn() {
    const all = [...document.querySelectorAll('a, button, div.btn, span, li')]
      .filter(el => isVisible(el) && el.textContent.includes('Solicitar devolución parcial'));
    const inner = all.find(el => !all.some(o => o !== el && el.contains(o)));
    return inner ? (inner.closest('a, button, [ng-click], [ui-sref]') || inner) : null;
  }

  async function ensureProductsPage() {
    for (let attempt = 1; attempt <= 4; attempt++) {
      await waitLoading();
      if (onProducts()) {
        if (await hashStable(3000)) {
          status('Pàgina de sol·licitud oberta', 'ok');
          await waitLoading();
          return true;
        }
        status(`🔧 El portal ha tornat a ${location.hash || '(buit)'} — ho torno a provar (${attempt}/4)`, 'warn');
        await sleep(2000);
        await waitLoading();
        continue;
      }
      if (attempt === 4) {
        // Últim recurs: canviar el hash directament (només navegació)
        status('🔧 Provo d\'obrir #/requests/products directament', 'warn');
        location.hash = '#/requests/products';
        await sleep(4000);
        await waitLoading();
        if (onProducts() && await hashStable(3000)) { status('Pàgina de sol·licitud oberta', 'ok'); return true; }
        break;
      }
      status(`Navegant a "Solicitar devolución parcial"... (${attempt}/4)`, 'info');
      const solBtn = await waitForEl(findSolicitarBtn, CONFIG.MAX_WAIT);
      if (!solBtn) {
        status('No s\'ha trobat "Solicitar devolución parcial"', 'warn');
        debugState('solicitar');
        if (location.hash && location.hash !== '#/') { location.hash = '#/'; await sleep(3000); }
        continue;
      }
      solBtn.click();
      await waitForEl(() => onProducts() ? document.body : null, 15000);
      await sleep(attempt === 1 ? 2000 : 1000);
    }
    status('No he pogut quedar-me a la pàgina "Solicitar devolución parcial"', 'error');
    debugState('navegació');
    return false;
  }

  async function allianceRun(products, options) {
    createOverlay();
    status(`Iniciant devolució de ${products.length} producte(s)...`);

    await dismissCookies();

    // ── 1. Navegar a la pàgina de sol·licitud ──
    if (!(await ensureProductsPage())) {
      badge('Error', '#ef4444'); addCloseBtn(); return;
    }
    await sleep(1500);

    await dismissCookies();
    await waitLoading();

    // ── 2. Afegir cada producte ──
    let ok = 0, fail = 0;
    const added = []; // productes afegits correctament

    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      progress(i, products.length);
      status(`<strong>${i + 1}/${products.length}</strong>: CN ${p.cn} ×${p.qty}`, 'search');

      try {
        const success = await allianceAddProduct(p, i === 0);
        if (success) {
          ok++;
          added.push(p);
          status(`CN ${p.cn} afegit ✓`, 'ok');
        } else {
          fail++;
          status(`CN ${p.cn}: no s'ha pogut afegir`, 'error');
        }
      } catch (e) {
        fail++;
        status(`CN ${p.cn}: ${e.message}`, 'error');
        log('Error:', e);
      }

      if (i < products.length - 1) await sleep(CONFIG.ACTION_DELAY);
    }

    progress(products.length, products.length);

    // ── 3. Ajustar quantitats i motius per línia ──
    if (added.length > 0) {
      const opts = options || {};
      if (opts.skipQtyReason) {
        status('⏸ Revisa quantitat i motiu de cada línia manualment', 'wait');
      } else {
        status('Ajustant quantitats i motius per línia...', 'info');
      }
      await sleep(2000); // esperar que el DOM es renderitzi
      await allianceSetQtyAndReason(added, opts);
    }

    // ── 4. Resum final ──
    if (fail === 0) {
      badge('Completat', '#22c55e');
      status(`✨ ${ok} producte(s) llestos. Revisa i clica "Enviar devolución" manualment.`, 'ok');
    } else {
      badge('Parcial', '#f59e0b');
      status(`${ok} afegit(s), ${fail} error(s). Revisa la llista.`, 'warn');
    }

    addCloseBtn();
    clearPending();
  }

  // ── Trobar el primer input visible dins un modal ──

  function findModalInput() {
    // 1. #productCode (visible) — els modals són position:fixed, no usar offsetParent
    const byId = document.querySelector('.modal #productCode') || document.querySelector('#productCode');
    if (byId && isVisible(byId)) return byId;
    // 2. Primer input de text d'un modal visible (camp "Código")
    const modals = [...document.querySelectorAll('.modal')].filter(isVisible);
    for (const modal of modals) {
      const inputs = modal.querySelectorAll(
        'input[type="text"], input[type="number"], input:not([type])'
      );
      for (const inp of inputs) {
        if (isVisible(inp) && !inp.disabled && !inp.readOnly) return inp;
      }
    }
    return null;
  }

  /** Troba el botó "Buscar por producto" (no exigeix que sigui visible). */
  function findSearchButton() {
    let b = document.querySelector('#search-buttons button[ng-click="searchByProduct()"]')
      || document.querySelector('[ng-click="searchByProduct()"]');
    if (b) return b;
    const els = document.querySelectorAll('button, a, div.btn, span.btn, [role="button"]');
    for (const el of els) {
      if (el.textContent.trim() === 'Buscar por producto') return el;
    }
    for (const el of els) {
      if (el.textContent.trim().includes('Buscar por producto')) return el;
    }
    return null;
  }

  /** Obre el modal de cerca per producte: clic real + fallback directe a Angular. */
  async function openSearchModal(btn) {
    // Intent 1: clic normal
    btn.click();
    log('Clicked "Buscar por producto"');
    status('Clic a "Buscar por producto"', 'ok');
    let inp = await waitForEl(findModalInput, 6000);
    if (inp) return inp;

    // Intent 2: seqüència de ratolí completa
    status('El modal no s\'ha obert amb el clic — provo events de ratolí', 'warn');
    try {
      for (const t of ['mousedown', 'mouseup', 'click']) {
        btn.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
      }
    } catch (e) { log('mouse events error', e); }
    inp = await waitForEl(findModalInput, 4000);
    if (inp) return inp;

    // Intent 3: cridar searchByProduct() directament des d'Angular
    const ng = getAngular();
    if (ng) {
      try {
        const host = document.querySelector('#search-buttons') || btn;
        let scope = ng.element(host).scope() || ng.element(btn).scope();
        if (scope && typeof scope.searchByProduct === 'function') {
          status('Crido searchByProduct() directament via Angular', 'warn');
          if (scope.$root && !scope.$root.$$phase) scope.$apply(() => scope.searchByProduct());
          else scope.searchByProduct();
          inp = await waitForEl(findModalInput, 6000);
          if (inp) return inp;
        } else {
          status('Angular: no he trobat searchByProduct() a l\'scope', 'warn');
        }
      } catch (e) {
        status(`Angular fallback ha fallat: ${e.message}`, 'warn');
      }
    }
    return null;
  }

  // ── Navegar fins al pas de cerca dins el modal ──

  async function navigateToSearch() {
    // Cas 1: ja tenim un input CN al modal obert
    let cnInput = findModalInput();
    if (cnInput) return cnInput;

    // Cas 2: estem al modal però en un altre pas → "Seleccionar otro producto"
    const prevBtn = document.querySelector('div.btn[ng-click="previousStep()"]');
    if (prevBtn && isVisible(prevBtn)) {
      prevBtn.click();
      log('Clicked "Seleccionar otro producto"');
      await sleep(CONFIG.ACTION_DELAY);
      cnInput = await waitForEl(findModalInput, 5000);
      if (cnInput) return cnInput;
    }

    // Cas 3: modal tancat → clicar "Buscar por producto"
    // 3a. Ens assegurem que som a la pàgina de productes i que no hi ha "Cargando"
    if (!onProducts()) {
      status(`Hash inesperat (${location.hash || 'buit'}) — torno a obrir la pàgina de sol·licitud`, 'warn');
      if (!(await ensureProductsPage())) {
        status('No som a la pàgina "Buscar productos" (#/requests/products)', 'error');
        debugState('hash');
        return null;
      }
    }
    await waitLoading();

    // 3b. Esperar que el botó existeixi al DOM (sense exigir visibilitat)
    const searchBtn = await waitForEl(findSearchButton, CONFIG.MAX_WAIT);
    if (!searchBtn) {
      log('Cannot find "Buscar por producto" button');
      status('No s\'ha trobat el botó "Buscar por producto"', 'error');
      debugState('botó');
      return null;
    }
    // Si hi ha un overlay de càrrega, esperar-lo; i que el botó no estigui desactivat
    await waitLoading();
    let tries = 0;
    while ((searchBtn.disabled || searchBtn.classList.contains('disabled')) && tries < 20) {
      await sleep(300); tries++;
    }
    if (!isVisible(searchBtn)) {
      status('El botó "Buscar por producto" existeix però no és visible — continuo igualment', 'warn');
    }

    cnInput = await openSearchModal(searchBtn);
    if (!cnInput) {
      log('Modal opened but no input found');
      status('El modal no s\'ha obert o no té camp de cerca (#productCode)', 'error');
      debugState('modal');
      return null;
    }
    // Esperar que "Cargando" desaparegui abans de teclejar
    await waitLoading();
    return findModalInput() || cnInput;
  }

    // ── Afegir un producte (cerca → selecció → albarà → afegir) ──

  async function allianceAddProduct(product, isFirst) {
    // ── Pas A: Arribar a l'input de cerca ──
    const cnInput = await navigateToSearch();
    if (!cnInput) {
      log('Cannot find product search input (#productCode)');
      status(`CN ${product.cn}: no s'ha trobat el camp de cerca al modal`, 'error');
      return false;
    }

    // Netejar camp anterior
    cnInput.focus();
    cnInput.value = '';
    cnInput.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);

    // Escriure el CN
    setInputValue(cnInput, product.cn);
      log(`Typed CN ${product.cn} into search field (id=${cnInput.id}, name=${cnInput.name})`);
    await sleep(300);

    // ── Pas B: Clicar "Buscar" (dins el modal) ──
    const buscarBtn = [...document.querySelectorAll('.modal input[type="submit"][value="Buscar"]')].find(isVisible)
      || document.querySelector('.modal input[type="submit"][value="Buscar"]')
      || document.querySelector('.modal button[type="submit"]')
      || (() => {
        const els = document.querySelectorAll('.modal button, .modal input[type="submit"], .modal .btn');
        for (const el of els) {
          const t = (el.textContent || el.value || '').trim();
          if (t === 'Buscar') return el;
        }
        return null;
      })();
    if (buscarBtn) {
      buscarBtn.click();
      log(`Search click for CN ${product.cn}`);
    } else {
      // Fallback: ng-enter="find()" → Enter key
      cnInput.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', keyCode: 13, which: 13, bubbles: true
      }));
      cnInput.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Enter', keyCode: 13, which: 13, bubbles: true
      }));
      log(`Search Enter for CN ${product.cn}`);
    }

    await sleep(CONFIG.SEARCH_DELAY);
    await waitLoading();

    // ── Pas C: Comprovar resultats ──
    const modal = [...document.querySelectorAll('.tsfz-lg-modal, .modal')].find(isVisible)
      || document.querySelector('.tsfz-lg-modal, .modal');
    if (modal) {
      // innerText només inclou el text visible (ng-show/ng-hide no donen falsos "sense resultats")
      const modalText = (modal.innerText || modal.textContent).toLowerCase();
      // Comprovar diversos textos possibles de "sense resultats"
      const noResultPatterns = [
        'no existen resultados',
        'no se han encontrado',
        'sin resultados',
        'no results',
        '0 resultados',
        'ningún resultado',
      ];
      const hasNoResults = noResultPatterns.some(p => modalText.includes(p));
      if (hasNoResults) {
        log(`CN ${product.cn}: no results`);
        status(`CN ${product.cn}: no s'ha trobat al portal`, 'warn');
        // Tancar modal o tornar enrere
        const closeBtn = modal.querySelector('.close, button[aria-label="Close"], .modal-header button');
        if (closeBtn) closeBtn.click();
        return false;
      }
    }

    // ── Pas D: Clicar la fila del resultat ──
    // NOMÉS clicar si hi ha coincidència exacta de CN (amb o sense dígit de control)
    const resultCell = await waitForEl(() => {
      let rows = document.querySelectorAll(
        '.modal tbody.table-data tr[ng-repeat="product in articleList"]'
      );
      // Fallback: qualsevol tr dins tbody del modal
      if (rows.length === 0) {
        rows = document.querySelectorAll('.modal tbody tr');
      }
      if (rows.length === 0) return null;

      // Buscar coincidència de CN: 6 xifres (sense dígit de control) o 7 (amb dígit de control)
      const want = String(product.cn).replace(/\D/g, '').replace(/^0+/, '');
      const cnMatches = (num) => {
        const n = num.replace(/^0+/, '');
        if (!n || !want) return false;
        if (n === want) return true;
        if (n.length === want.length + 1 && n.startsWith(want)) return true;   // 702850 ↔ 7028501
        if (want.length === n.length + 1 && want.startsWith(n)) return true;   // 7028501 ↔ 702850
        return false;
      };
      for (const row of rows) {
        // Mirar totes les cel·les i tots els números de la fila (el CN pot anar amb espais, punts o text)
        const cells = [...row.querySelectorAll('td')];
        const nums = [];
        for (const c of cells) {
          const t = (c.innerText || c.textContent || '');
          (t.match(/\d[\d.\s-]{4,9}\d/g) || []).forEach(m => nums.push(m.replace(/\D/g, '')));
          (t.match(/\d{5,8}/g) || []).forEach(m => nums.push(m));
        }
        if (nums.some(cnMatches)) {
          return row.querySelector('td[ng-click="nextStep(product)"]') || row.querySelector('td[ng-click]') || row.querySelector('td');
        }
      }
      try {
        const first = rows[0];
        status(`🔧 1a fila: <code>${[...first.querySelectorAll('td')].map(c => (c.innerText || c.textContent).trim().slice(0, 30)).join(' | ')}</code>`, 'warn');
      } catch (e) {}

      // Si hi ha resultats però cap coincideix, retornar un marcador especial
      // per distingir "no results" de "results but no match"
      return { __noExactMatch: true, rowCount: rows.length };
    }, CONFIG.MAX_WAIT);

    if (!resultCell) {
      log(`CN ${product.cn}: no result rows found`);
      status(`CN ${product.cn}: la cerca no ha tornat cap fila`, 'error');
      return false;
    }

    // Si hi ha resultats però cap coincideix exactament → NO clicar
    if (resultCell.__noExactMatch) {
      status(`CN ${product.cn}: ⚠ ${resultCell.rowCount} resultat(s) però cap coincideix exactament — revisa manualment`, 'warn');
      log(`CN ${product.cn}: ${resultCell.rowCount} results but no exact CN match — skipping`);
      // Tancar modal
      const closeBtn = document.querySelector('.modal .close, .modal button[aria-label="Close"], .modal-header button');
      if (closeBtn) closeBtn.click();
      return false;
    }

    resultCell.click();
    log(`Clicked result for CN ${product.cn}`);

    // Esperar loading modal
    await waitLoading();

    // ── Pas E: Seleccionar albarà ──
    // Esperar que aparegui la llista d'albarans
    const checkbox = await waitForEl(
      'tbody.table-data tr[ng-repeat="returnLine in returnLines"]:not(.error) input[type="checkbox"][ng-model="returnLine.$$checked"]:not([disabled])'
    );

    if (!checkbox) {
      log(`CN ${product.cn}: no valid albarà checkbox found`);
      // Potser no hi ha albarans disponibles
      status(`CN ${product.cn}: cap albarà disponible`, 'warn');
      return false;
    }

    // Comprovar si cal selecció manual d'albarà
    const pending = getPending();
    const manualAlbara = pending && pending.options && pending.options.manualAlbara;

    if (manualAlbara) {
      log(`CN ${product.cn}: waiting for manual albarà selection`);
      status(`CN ${product.cn}: <strong>selecciona l'albarà manualment</strong> i clica "Añadir productos"`, 'wait');
      // Esperar a que l'usuari seleccioni i avanci
      await new Promise(resolve => {
        const checkDone = () => {
          const stillOnAlbara = document.querySelector(
            'tbody.table-data tr[ng-repeat="returnLine in returnLines"]'
          );
          if (!stillOnAlbara || !isVisible(stillOnAlbara)) {
            resolve();
            return;
          }
          setTimeout(checkDone, CONFIG.POLL_INTERVAL);
        };
        checkDone();
      });
      log(`CN ${product.cn}: manual albarà selection done`);
      await sleep(CONFIG.ACTION_DELAY);
      await waitLoading();
      return true;
    }

    if (!checkbox.checked) {
      checkbox.click();
      log('Albarà checkbox clicked');
      await sleep(CONFIG.ACTION_DELAY);
    }

    // ── Pas F: Clicar "Añadir productos a la lista" ──
    // NOTA: és un DIV, no un button!
    const addDiv = await waitForEl(
      '.modal-footer div.btn.btn-primary[ng-click="nextStep()"]'
    );

    if (!addDiv) {
      // Fallback: qualsevol element amb text "Añadir productos"
      const fallback = await waitForEl(() => {
        const els = document.querySelectorAll('.modal-footer div.btn, .modal-footer button');
        for (const el of els) {
          if (el.textContent.trim().includes('Añadir productos')) return el;
        }
        return null;
      }, 5000);

      if (fallback) {
        fallback.click();
      } else {
        log('Cannot find "Añadir productos" button/div');
        status(`CN ${product.cn}: no s'ha trobat el botó "Añadir productos"`, 'error');
        return false;
      }
    } else {
      // Esperar que no estigui desactivat
      let tries = 0;
      while (addDiv.classList.contains('disabled') && tries < 15) {
        await sleep(300);
        tries++;
      }
      addDiv.click();
    }

    log('Clicked "Añadir productos a la lista"');
    await sleep(CONFIG.ACTION_DELAY);
    await waitLoading();

    return true;
  }

  // ── Ajustar quantitat i motiu per cada línia de producte ──

  async function allianceSetQtyAndReason(products, options = {}) {
    // Si skipQtyReason està actiu, no omplir quantitat ni motiu
    if (options.skipQtyReason) {
      log('skipQtyReason actiu: quantitat i motiu es deixen per revisió manual');
      status('⏸ Quantitat i motiu: revisa i omple manualment cada línia', 'wait');
      return;
    }

    // Les línies de producte apareixen dins div.tsfz-product-section
    const sections = document.querySelectorAll('div.tsfz-product-section');
    if (sections.length === 0) {
      // Fallback: buscar la taula directament
      status('Cercant taula de productes...', 'info');
      await sleep(2000);
    }

    // Recollir totes les files de productes de totes les seccions
    const allRows = document.querySelectorAll(
      'div.tsfz-product-section table.tsfz-products-table tbody tr'
    );

    if (allRows.length === 0) {
      // Fallback més ampli
      const anyRows = document.querySelectorAll('table.tsfz-products-table tbody tr');
      if (anyRows.length === 0) {
        status('No s\'han trobat línies de producte a la pàgina', 'warn');
        return;
      }
    }

    const rows = allRows.length > 0
      ? allRows
      : document.querySelectorAll('table.tsfz-products-table tbody tr');

    log(`Found ${rows.length} product row(s) across sections`);

    for (const product of products) {
      // Trobar la fila que conté el CN d'aquest producte
      let matchedRow = null;
      for (const row of rows) {
        const text = row.textContent || '';
        if (text.includes(product.cn)) {
          matchedRow = row;
          break;
        }
      }

      if (!matchedRow) {
        status(`CN ${product.cn}: fila no trobada a la llista`, 'warn');
        continue;
      }

      // ── Quantitat ──
      // Intentar selectors de més específic a més ampli
      const qtyInput = matchedRow.querySelector(
        'input[ng-model="line.quantity"]'
      ) || matchedRow.querySelector(
        'td[headers="returnedQuantity"] input[type="number"]'
      ) || matchedRow.querySelector(
        'td[headers="returnedQuantity"] input'
      );
      if (qtyInput) {
        if (product.qty > 1 || qtyInput.value !== String(product.qty)) {
          setInputValue(qtyInput, product.qty);
          status(`CN ${product.cn}: quantitat → ${product.qty}`, 'ok');
        }
      } else if (product.qty > 1) {
        status(`CN ${product.cn}: camp de quantitat no editable — revisa manualment`, 'warn');
      }
      await sleep(300);

      // ── Motiu ──
      const reasonSelect = matchedRow.querySelector(
        'select[ng-model="line.reasonCode"]'
      );
      if (reasonSelect) {
        const matched = matchReasonToOption(reasonSelect, product.reason);
        if (matched) {
          status(`CN ${product.cn}: motiu → ${product.reason}`, 'ok');
        } else {
          status(`CN ${product.cn}: motiu "${product.reason}" no trobat al dropdown`, 'warn');
        }
      } else {
        // Fallback: buscar select amb name que comença per "reason-"
        const fallbackSel = matchedRow.querySelector('select[name^="reason-"]');
        if (fallbackSel) {
          matchReasonToOption(fallbackSel, product.reason);
          status(`CN ${product.cn}: motiu → ${product.reason}`, 'ok');
        } else {
          status(`CN ${product.cn}: dropdown de motiu no trobat`, 'warn');
        }
      }
      await sleep(300);

      // Si el motiu és '02' (servido por error), el portal demana el codi de l'article rebut
      const isReason02 = (product.reason === '02' ||
        product.reason.toUpperCase().includes('SERVIDO POR ERROR'));
      if (isReason02) {
        const extraInput = matchedRow.querySelector(
          'input[ng-model="line.receivedArticle.articleCode"]'
        );
        if (extraInput && isVisible(extraInput)) {
          status(`CN ${product.cn}: ⚠ Motiu "Servido por error" requereix codi article rebut — revisa manualment`, 'warn');
        }
      }
    }
  }

  // Mapa de codis de motiu del portal Alliance → text esperat
  // Permet fer match per codi directe (més fiable que per text)
  const REASON_CODES = {
    '01': 'NO INTERESA',
    '02': 'SERVIDO POR ERROR',
    '03': 'DEFECTUOSO',
    '04': 'FECHA DE CADUCIDAD',
    '10': 'ERROR DE PRECIO',
    '99': 'OTROS',
  };

  // Mapa invers: text normalitzat → codi
  const TEXT_TO_CODE = {};
  for (const [code, text] of Object.entries(REASON_CODES)) {
    TEXT_TO_CODE[text] = code;
  }

  /** Busca l'opció del dropdown que coincideix amb el motiu i la selecciona.
   *  Accepta tant codi ('01') com text ('NO INTERESA').
   */
  function matchReasonToOption(select, reasonText) {
    if (!reasonText) return false;
    const norm = reasonText.toUpperCase().trim();

    // Filtrar opcions vàlides (descartar "Seleccione", opcions buides, etc.)
    const validOpts = [...select.options].filter(
      opt => opt.value && opt.text.trim()
    );

    // Angular pot posar values com "string:01" o "1: 01"
    const optCode = (opt) => String(opt.value).replace(/^(string:|\d+:\s*)/, '').trim();

    // 0. Si ens passen un codi directe ('01', '02'...), buscar per value
    if (/^\d{2}$/.test(norm)) {
      for (const opt of validOpts) {
        if (opt.value === norm || optCode(opt) === norm) {
          setSelectValue(select, opt.value);
          return true;
        }
      }
    }

    // 1. Buscar si tenim el codi corresponent al text
    const code = TEXT_TO_CODE[norm];
    if (code) {
      for (const opt of validOpts) {
        if (opt.value === code || optCode(opt) === code) {
          setSelectValue(select, opt.value);
          return true;
        }
      }
    }

    // 2. Coincidència exacta de text
    for (const opt of validOpts) {
      if (opt.text.toUpperCase().trim() === norm) {
        setSelectValue(select, opt.value);
        return true;
      }
    }

    // 3. Coincidència parcial segura (evitar falsos positius)
    for (const opt of validOpts) {
      const t = opt.text.toUpperCase().trim();
      // Només si el text complet de l'opció conté el motiu complet o viceversa
      // i el fragment té almenys 4 caràcters (evitar matches curts)
      if (t.length >= 4 && norm.length >= 4) {
        if (t === norm || t.includes(norm) || norm.includes(t)) {
          setSelectValue(select, opt.value);
          return true;
        }
      }
    }

    // 4. Coincidència per paraules clau (sense ambigüitat)
    const KEYWORDS = {
      'NO INTERESA': ['no interesa'],
      'SERVIDO POR ERROR': ['servido por error'],
      'DEFECTUOSO': ['defectuoso'],
      'FECHA DE CADUCIDAD': ['caducidad'],
      'ERROR DE PRECIO': ['error de precio', 'precio'],
      'OTROS': ['otros'],
    };
    const kws = KEYWORDS[norm] || [];
    if (kws.length > 0) {
      for (const opt of validOpts) {
        const t = opt.text.toLowerCase();
        if (kws.some(k => t.includes(k))) {
          setSelectValue(select, opt.value);
          return true;
        }
      }
    }

    return false;
  }

  // ══════════════════════════════════════════════
  //  PÀGINA FARMÀCIA-TOOLS (diordes.github.io)
  // ══════════════════════════════════════════════

  function initFarmaciaPage() {
    // Anunciar presència — DOM attribute (funciona sempre, compartit entre sandbox i pàgina)
    document.documentElement.setAttribute('data-farmacia-script', '2.0.8');
    log('Script v2.0.8 active on farmacia-tools page');

    // Fallback: unsafeWindow global (pot fallar en Chrome nou + Tampermonkey sandbox)
    try { unsafeWindow.__FARMACIA_DEVOLUCIONS_SCRIPT__ = true; } catch(e) {
      log('unsafeWindow global failed (sandbox issue):', e.message);
    }

    // Disparar event "ready" via document (robust) + unsafeWindow (fallback)
    document.dispatchEvent(new CustomEvent('farmacia-devolucions-ready'));
    try { unsafeWindow.dispatchEvent(new CustomEvent('farmacia-devolucions-ready')); } catch(e) {}

    // Handler per a peticions de devolució
    const handleStartReturn = (e) => {
      const detail = e.detail;
      if (!detail || !detail.products || !detail.wholesaler) {
        log('Invalid event detail', detail);
        return;
      }

      // Dedupe: el mateix event arriba per document I per window (i potser a 2 còpies de l'script)
      const nowTs = Date.now();
      const lastTs = parseInt(document.documentElement.getAttribute('data-farmacia-return-ts') || '0', 10);
      if (nowTs - lastTs < 5000) {
        log('Duplicate farmacia-start-return event ignored');
        return;
      }
      document.documentElement.setAttribute('data-farmacia-return-ts', String(nowTs));

      log(`Return request: ${detail.products.length} products → ${detail.wholesaler}`);

      // Marcar que hem gestionat l'event — DOM attribute (robust) + unsafeWindow (fallback)
      document.documentElement.setAttribute('data-farmacia-return-handled', 'true');
      try { unsafeWindow.__FARMACIA_RETURN_HANDLED__ = true; } catch(e) {}

      // Guardar dades a GM storage (sobreviu redirections ADFS)
      storePending(detail.products, detail.wholesaler, detail.options || {});

      // Obrir el portal en una nova pestanya
      const urls = {
        alliance: 'https://my.alliance-healthcare.es/group/pro/devoluciones'
      };
      const url = urls[detail.wholesaler];
      if (url) {
        window.open(url, '_blank');
        log(`Opened portal: ${url}`);
      } else {
        log(`Unknown wholesaler: ${detail.wholesaler}`);
      }
    };

    // Escoltar peticions des de la pàgina via document (robust) + unsafeWindow (fallback)
    document.addEventListener('farmacia-start-return', handleStartReturn);
    try { unsafeWindow.addEventListener('farmacia-start-return', handleStartReturn); } catch(e) {}
  }

  // ══════════════════════════════════════════════
  //  PÀGINA ALLIANCE HEALTHCARE
  // ══════════════════════════════════════════════

  // ── Bloqueig d'execució única ──
  const INSTANCE_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const LOCK_KEY = 'run_lock';
  const LOCK_STALE_MS = 15000;
  let lockTimer = null;
  let lockOwned = false;

  function readLock() {
    try { const raw = GM_getValue(LOCK_KEY, null); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function writeLock() {
    GM_setValue(LOCK_KEY, JSON.stringify({ id: INSTANCE_ID, ts: Date.now() }));
  }

  async function acquireRunLock() {
    const de = document.documentElement;
    // 1. Marca al DOM (compartida per totes les còpies de l'script a aquesta pàgina)
    if (de.getAttribute('data-fa-autodevo')) return false;
    de.setAttribute('data-fa-autodevo', INSTANCE_ID);
    // 2. Flag a window
    try {
      if (unsafeWindow.__FA_RUNNING__) { de.removeAttribute('data-fa-autodevo'); return false; }
      unsafeWindow.__FA_RUNNING__ = INSTANCE_ID;
    } catch (e) {}
    // 3. Bloqueig GM entre pestanyes (amb timestamp: caduca si l'altra pestanya ha mort)
    const cur = readLock();
    if (cur && cur.id !== INSTANCE_ID && Date.now() - cur.ts < LOCK_STALE_MS) {
      de.removeAttribute('data-fa-autodevo');
      try { unsafeWindow.__FA_RUNNING__ = null; } catch (e) {}
      return false;
    }
    writeLock();
    await sleep(400 + Math.floor(Math.random() * 300)); // resoldre curses (GM no és atòmic)
    const after = readLock();
    if (!after || after.id !== INSTANCE_ID) {
      de.removeAttribute('data-fa-autodevo');
      try { unsafeWindow.__FA_RUNNING__ = null; } catch (e) {}
      return false;
    }
    lockOwned = true;
    lockTimer = setInterval(writeLock, 3000);
    window.addEventListener('pagehide', releaseRunLock);
    return true;
  }

  function releaseRunLock() {
    if (lockTimer) { clearInterval(lockTimer); lockTimer = null; }
    if (!lockOwned) return;
    lockOwned = false;
    try {
      const cur = readLock();
      if (cur && cur.id === INSTANCE_ID) GM_deleteValue(LOCK_KEY);
    } catch (e) {}
    try { document.documentElement.removeAttribute('data-fa-autodevo'); unsafeWindow.__FA_RUNNING__ = null; } catch (e) {}
  }

  function initAlliancePage() {
    const data = getPending();
    if (!data || data.wholesaler !== 'alliance') {
      log('No pending Alliance return — script idle');
      return;
    }

    log(`Pending return found: ${data.products.length} product(s)`);

    // Comprovar si estem a la pàgina de devolucions (o si cal navegar-hi)
    const path = window.location.pathname;
    const hash = window.location.hash;
    const isDevoPage = path.includes('/devoluciones') || path.includes('/devolucions');

    if (!isDevoPage) {
      // Estem a una altra pàgina Alliance (home, login redirect, etc.)
      // Navegar a devolucions automàticament
      log(`Not on /devoluciones (path: ${path}) — redirecting...`);
      let redirs = 0;
      try { redirs = parseInt(sessionStorage.getItem('fa_redirs') || '0', 10); sessionStorage.setItem('fa_redirs', String(redirs + 1)); } catch (e) {}
      if (redirs >= 3) { log('Too many redirects to /devoluciones — giving up'); return; }
      window.location.href = 'https://my.alliance-healthcare.es/group/pro/devoluciones';
      return;
    }

    // Iniciar automatització amb un delay per deixar carregar la SPA
    (async () => {
      // Bloqueig d'execució única (aquesta pàgina, altres pestanyes, còpies duplicades de l'script)
      const gotLock = await acquireRunLock();
      if (!gotLock) {
        log('Another instance is already running — this one stays idle');
        return;
      }
      try {
        await sleep(3000);
        await allianceRun(data.products, data.options || {});
      } catch (e) {
        log('Error during allianceRun:', e);
        status(`Error inesperat: ${e.message}`, 'error');
        badge('Error', '#ef4444');
        addCloseBtn();
      } finally {
        // La feina (o l'error) ja s'ha mostrat: no reintentar sol a cada pàgina d'Alliance
        clearPending();
        releaseRunLock();
      }
    })();
  }

  // ══════════════════════════════════════════════
  //  PUNT D'ENTRADA
  // ══════════════════════════════════════════════

  const host = window.location.hostname;

  if (host === 'diordes.github.io') {
    initFarmaciaPage();
  } else if (host === 'my.alliance-healthcare.es') {
    initAlliancePage();
  }

})();
