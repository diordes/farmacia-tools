// ==UserScript==
// @name         FarmÃ cia Central BCN â Auto Devolucions
// @namespace    https://diordes.github.io/farmacia-tools
// @version      2.0.0
// @description  Automatitza les devolucions als portals dels majoristes (Alliance Healthcare)
// @author       FarmÃ cia Central BCN
// @match        https://my.alliance-healthcare.es/*
// @match        https://diordes.github.io/farmacia-tools/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';

  // ââââââââââââââââââââââââââââââââââââââââââââââ
  //  CONFIGURACIÃ
  // ââââââââââââââââââââââââââââââââââââââââââââââ

  const CONFIG = {
    POLL_INTERVAL: 500,       // ms entre comprovacions DOM
    MAX_WAIT: 20000,          // ms mÃ xim d'espera per un element
    ACTION_DELAY: 1000,       // ms pausa entre accions (SPA render)
    SEARCH_DELAY: 2000,       // ms pausa desprÃ©s d'una cerca
    LOADING_WAIT: 15000,      // ms mÃ xim d'espera per .tsfz-loading-modal
    PAGE_LOAD_DELAY: 6000,    // ms espera carrega "Solicitar devoluciÃ³n parcial"
    STALE_MS: 3600000,        // 1h â dades pendents caduquen
  };

  // ââââââââââââââââââââââââââââââââââââââââââââââ
  //  UTILITATS
  // ââââââââââââââââââââââââââââââââââââââââââââââ

  function log(msg, ...args) {
    console.log(`[AutoDevolucions v2] ${msg}`, ...args);
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /** Espera que aparegui un element (selector o funciÃ³). Retorna l'element o null. */
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
        if (!el || el.offsetParent === null || getComputedStyle(el).display === 'none') {
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
  }

  /** Posa valor a un select triggejant change per Angular. */
  function setSelectValue(select, value) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype, 'value'
    ).set;
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ââââââââââââââââââââââââââââââââââââââââââââââ
  //  GM STORAGE â dades cross-domain
  // ââââââââââââââââââââââââââââââââââââââââââââââ

  function storePending(products, wholesaler) {
    GM_setValue('pending_return', JSON.stringify({
      products, wholesaler, ts: Date.now()
    }));
    log(`Stored ${products.length} products for ${wholesaler}`);
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

  // ââââââââââââââââââââââââââââââââââââââââââââââ
  //  OVERLAY D'ESTAT
  // ââââââââââââââââââââââââââââââââââââââââââââââ

  function createOverlay() {
    const old = document.getElementById('farmacia-auto-status');
    if (old) old.remove();

    const ov = document.createElement('div');
    ov.id = 'farmacia-auto-status';
    ov.style.cssText = 'position:fixed;top:16px;right:16px;width:360px;background:#1e293b;color:#f1f5f9;border-radius:12px;padding:16px 20px;font-family:Inter,-apple-system,sans-serif;font-size:13px;line-height:1.5;z-index:99999;box-shadow:0 20px 40px rgba(0,0,0,0.3)';
    ov.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <span style="font-size:18px">ð</span>
        <strong style="font-size:14px">Auto Devolucions v2</strong>
        <span id="fa-badge" style="margin-left:auto;font-size:11px;padding:2px 8px;border-radius:10px;background:#3b82f6;color:white;font-weight:600">Processant...</span>
      </div>
      <div id="fa-log" style="max-height:220px;overflow-y:auto;font-size:12px;color:#94a3b8"></div>
      <div style="margin-top:12px;height:4px;background:#334155;border-radius:2px;overflow:hidden">
        <div id="fa-bar" style="height:100%;background:#3b82f6;border-radius:2px;width:0;transition:width 0.3s"></div>
      </div>`;
    document.body.appendChild(ov);
  }

  const ICONS = { info: 'â¹ï¸', ok: 'â', warn: 'â ï¸', error: 'â', search: 'ð' };

  function status(msg, type = 'info') {
    const el = document.getElementById('fa-log');
    if (!el) return;
    const d = document.createElement('div');
    d.style.marginBottom = '4px';
    d.innerHTML = `${ICONS[type] || 'Â·'} ${msg}`;
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
    btn.textContent = 'â Tancar';
    btn.style.cssText = 'margin-top:12px;width:100%;padding:8px;background:#334155;color:#f1f5f9;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600';
    btn.onclick = () => ov.remove();
    ov.appendChild(btn);
  }

  // ââââââââââââââââââââââââââââââââââââââââââââââ
  //  HELPERS PORTAL
  // ââââââââââââââââââââââââââââââââââââââââââââââ

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
    if (el && el.offsetParent !== null) {
      status('Esperant cÃ rrega...', 'info');
      await waitForElGone('.tsfz-loading-modal');
    }
    await sleep(500);
  }

  // ââââââââââââââââââââââââââââââââââââââââââââââ
  //  ALLIANCE HEALTHCARE â AUTOMATITZACIÃ
  // ââââââââââââââââââââââââââââââââââââââââââââââ

  async function allianceRun(products) {
    createOverlay();
    status(`Iniciant devoluciÃ³ de ${products.length} producte(s)...`);

    await dismissCookies();

    // ââ 1. Navegar a la pÃ gina de solÂ·licitud ââ
    const hash = window.location.hash;
    if (!hash || hash === '#/' || hash === '#') {
      status('Navegant a "Solicitar devoluciÃ³n parcial"...', 'info');

      // Buscar el botÃ³/link "Solicitar devoluciÃ³n parcial"
      const solBtn = await waitForEl(() => {
        const els = document.querySelectorAll('a, button, div.btn, span, li');
        for (const el of els) {
          if (el.textContent.trim().includes('Solicitar devoluciÃ³n parcial')) return el;
        }
        return null;
      }, CONFIG.MAX_WAIT);

      if (solBtn) {
        solBtn.click();
        status('Clic a "Solicitar devoluciÃ³n parcial"', 'ok');
        await sleep(CONFIG.PAGE_LOAD_DELAY);
      } else {
        status('No s\'ha trobat "Solicitar devoluciÃ³n parcial"', 'error');
        badge('Error', '#ef4444');
        addCloseBtn();
        return;
      }
    } else if (hash.includes('/requests/products')) {
      status('Ja som a la pÃ gina de productes', 'ok');
      await sleep(2000);
    } else {
      // Estem en un altre hash â esperem una mica
      await sleep(3000);
    }

    await dismissCookies();
    await waitLoading();

    // ââ 2. Afegir cada producte ââ
    let ok = 0, fail = 0;
    const added = []; // productes afegits correctament

    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      progress(i, products.length);
      status(`<strong>${i + 1}/${products.length}</strong>: CN ${p.cn} Ã${p.qty}`, 'search');

      try {
        const success = await allianceAddProduct(p, i === 0);
        if (success) {
          ok++;
          added.push(p);
          status(`CN ${p.cn} afegit â`, 'ok');
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

    // ââ 3. Ajustar quantitats i motius per lÃ­nia ââ
    if (added.length > 0) {
      status('Ajustant quantitats i motius per lÃ­nia...', 'info');
      await sleep(2000); // esperar que el DOM es renderitzi
      await allianceSetQtyAndReason(added);
    }

    // ââ 4. Resum final ââ
    if (fail === 0) {
      badge('Completat', '#22c55e');
      status(`â¨ ${ok} producte(s) llestos. Revisa i clica "Enviar devoluciÃ³n" manualment.`, 'ok');
    } else {
      badge('Parcial', '#f59e0b');
      status(`${ok} afegit(s), ${fail} error(s). Revisa la llista.`, 'warn');
    }

    addCloseBtn();
    clearPending();
  }

  // ââ Navegar fins al pas de cerca dins el modal ââ

  async function navigateToSearch() {
    // Cas 1: ja tenim l'input CN al modal
    let cnInput = document.querySelector('.modal #productCode');
    if (cnInput && cnInput.offsetParent !== null) return cnInput;

    // Cas 2: estem al modal perÃ² en un altre pas â "Seleccionar otro producto"
    const prevBtn = document.querySelector('div.btn[ng-click="previousStep()"]');
    if (prevBtn && prevBtn.offsetParent !== null) {
      prevBtn.click();
      log('Clicked "Seleccionar otro producto"');
      await sleep(CONFIG.ACTION_DELAY);
      cnInput = await waitForEl('.modal #productCode', 5000);
      if (cnInput) return cnInput;
    }

    // Cas 3: modal tancat â obrir amb el botÃ³ de cerca
    const searchBtn = await waitForEl(
      '#search-buttons button[ng-click="searchByProduct()"]',
      CONFIG.MAX_WAIT
    );
    if (!searchBtn) {
      // Fallback: qualsevol botÃ³ amb text "Buscar por producto"
      const fallback = await waitForEl(() => {
        const els = document.querySelectorAll('button, a, div.btn');
        for (const el of els) {
          if (el.textContent.trim().includes('Buscar por producto')) return el;
        }
        return null;
      }, 5000);
      if (fallback) {
        fallback.click();
      } else {
        return null;
      }
    } else {
      searchBtn.click();
    }

    log('Opened search modal');
    await sleep(CONFIG.ACTION_DELAY);
    return await waitForEl('.modal #productCode');
  }

  // ââ Afegir un producte (cerca â selecciÃ³ â albarÃ  â afegir) ââ

  async function allianceAddProduct(product, isFirst) {
    // ââ Pas A: Arribar a l'input de cerca ââ
    const cnInput = await navigateToSearch();
    if (!cnInput) {
      log('Cannot find product search input (#productCode)');
      return false;
    }

    // Netejar camp anterior
    cnInput.focus();
    cnInput.value = '';
    cnInput.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);

    // Escriure el CN
    setInputValue(cnInput, product.cn);
    await sleep(300);

    // ââ Pas B: Clicar "Buscar" (dins el modal) ââ
    const buscarBtn = document.querySelector(
      '.modal input[type="submit"][value="Buscar"]'
    );
    if (buscarBtn) {
      buscarBtn.click();
      log(`Search click for CN ${product.cn}`);
    } else {
      // Fallback: ng-enter="find()" â Enter key
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

    // ââ Pas C: Comprovar resultats ââ
    const modal = document.querySelector('.tsfz-lg-modal, .modal');
    if (modal && modal.textContent.includes('No existen resultados')) {
      log(`CN ${product.cn}: no results`);
      status(`CN ${product.cn}: no s'ha trobat al portal`, 'warn');
      // Tancar modal o tornar enrere
      const closeBtn = modal.querySelector('.close, button[aria-label="Close"], .modal-header button');
      if (closeBtn) closeBtn.click();
      return false;
    }

    // ââ Pas D: Clicar la fila del resultat ââ
    // Intentar trobar la fila amb el CN exacte
    const resultCell = await waitForEl(() => {
      const rows = document.querySelectorAll(
        '.modal tbody.table-data tr[ng-repeat="product in articleList"]'
      );
      // Primer: buscar coincidÃ¨ncia exacta de CN
      for (const row of rows) {
        const firstCell = row.querySelector('td');
        if (firstCell && firstCell.textContent.trim() === product.cn) {
          return row.querySelector('td[ng-click="nextStep(product)"]') || row;
        }
      }
      // Segon: primera fila amb td clicable
      const anyCell = document.querySelector(
        '.modal tbody.table-data tr[ng-repeat="product in articleList"] td[ng-click="nextStep(product)"]'
      );
      if (anyCell) return anyCell;
      // Tercer: primera fila del resultat
      return document.querySelector('.modal tbody.table-data tr');
    }, CONFIG.MAX_WAIT);

    if (!resultCell) {
      log(`CN ${product.cn}: no result rows found`);
      return false;
    }

    resultCell.click();
    log(`Clicked result for CN ${product.cn}`);

    // Esperar loading modal
    await waitLoading();

    // ââ Pas E: Seleccionar albarÃ  ââ
    // Esperar que aparegui la llista d'albarans
    const checkbox = await waitForEl(
      'tbody.table-data tr[ng-repeat="returnLine in returnLines"]:not(.error) input[type="checkbox"][ng-model="returnLine.$$checked"]:not([disabled])'
    );

    if (!checkbox) {
      log(`CN ${product.cn}: no valid albarÃ  checkbox found`);
      // Potser no hi ha albarans disponibles
      status(`CN ${product.cn}: cap albarÃ  disponible`, 'warn');
      return false;
    }

    if (!checkbox.checked) {
      checkbox.click();
      log('AlbarÃ  checkbox clicked');
      await sleep(CONFIG.ACTION_DELAY);
    }

    // ââ Pas F: Clicar "AÃ±adir productos a la lista" ââ
    // NOTA: Ã©s un DIV, no un button!
    const addDiv = await waitForEl(
      '.modal-footer div.btn.btn-primary[ng-click="nextStep()"]'
    );

    if (!addDiv) {
      // Fallback: qualsevol element amb text "AÃ±adir productos"
      const fallback = await waitForEl(() => {
        const els = document.querySelectorAll('.modal-footer div.btn, .modal-footer button');
        for (const el of els) {
          if (el.textContent.trim().includes('AÃ±adir productos')) return el;
        }
        return null;
      }, 5000);

      if (fallback) {
        fallback.click();
      } else {
        log('Cannot find "AÃ±adir productos" button/div');
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

    log('Clicked "AÃ±adir productos a la lista"');
    await sleep(CONFIG.ACTION_DELAY);
    await waitLoading();

    return true;
  }

  // ââ Ajustar quantitat i motiu per cada lÃ­nia de producte ââ

  async function allianceSetQtyAndReason(products) {
    // Les lÃ­nies de producte apareixen dins div.tsfz-product-section
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
      // Fallback mÃ©s ampli
      const anyRows = document.querySelectorAll('table.tsfz-products-table tbody tr');
      if (anyRows.length === 0) {
        status('No s\'han trobat lÃ­nies de producte a la pÃ gina', 'warn');
        return;
      }
    }

    const rows = allRows.length > 0
      ? allRows
      : document.querySelectorAll('table.tsfz-products-table tbody tr');

    log(`Found ${rows.length} product row(s) across sections`);

    for (const product of products) {
      // Trobar la fila que contÃ© el CN d'aquest producte
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

      // ââ Quantitat ââ
      const qtyInput = matchedRow.querySelector(
        'td[headers="returnedQuantity"] input[type="number"][ng-model="line.quantity"]'
      );
      if (qtyInput) {
        if (product.qty > 1 || qtyInput.value !== String(product.qty)) {
          setInputValue(qtyInput, product.qty);
          status(`CN ${product.cn}: quantitat â ${product.qty}`, 'ok');
        }
      } else {
        // Fallback: buscar qualsevol input number a la celÂ·la de quantitat
        const fallbackQty = matchedRow.querySelector(
          'td[headers="returnedQuantity"] input[type="number"]'
        );
        if (fallbackQty) {
          setInputValue(fallbackQty, product.qty);
          status(`CN ${product.cn}: quantitat â ${product.qty}`, 'ok');
        } else if (product.qty > 1) {
          // Pot ser un span (reasonCode=='01' amb extraQuantity>0)
          status(`CN ${product.cn}: camp de quantitat no editable`, 'warn');
        }
      }
      await sleep(300);

      // ââ Motiu ââ
      const reasonSelect = matchedRow.querySelector(
        'select[ng-model="line.reasonCode"]'
      );
      if (reasonSelect) {
        const matched = matchReasonToOption(reasonSelect, product.reason);
        if (matched) {
          status(`CN ${product.cn}: motiu â ${product.reason}`, 'ok');
        } else {
          status(`CN ${product.cn}: motiu "${product.reason}" no trobat al dropdown`, 'warn');
        }
      } else {
        // Fallback: buscar select amb name que comenÃ§a per "reason-"
        const fallbackSel = matchedRow.querySelector('select[name^="reason-"]');
        if (fallbackSel) {
          matchReasonToOption(fallbackSel, product.reason);
          status(`CN ${product.cn}: motiu â ${product.reason}`, 'ok');
        } else {
          status(`CN ${product.cn}: dropdown de motiu no trobat`, 'warn');
        }
      }
      await sleep(300);

      // Si el motiu Ã©s '02' (servido por error), pot haver-hi camp extra
      // input[ng-model="line.receivedArticle.articleCode"] â l'ignorem per ara
    }
  }

  /** Busca l'opciÃ³ del dropdown que coincideix amb el text del motiu i la selecciona. */
  function matchReasonToOption(select, reasonText) {
    if (!reasonText) return false;
    const norm = reasonText.toUpperCase().trim();

    // 1. CoincidÃ¨ncia exacta de text
    for (const opt of select.options) {
      if (opt.text.toUpperCase().trim() === norm) {
        setSelectValue(select, opt.value);
        return true;
      }
    }

    // 2. CoincidÃ¨ncia parcial (el text de l'opciÃ³ contÃ© el motiu o viceversa)
    for (const opt of select.options) {
      const t = opt.text.toUpperCase().trim();
      if (t.includes(norm) || norm.includes(t)) {
        setSelectValue(select, opt.value);
        return true;
      }
    }

    // 3. CoincidÃ¨ncia per paraules clau
    const KEYWORDS = {
      'NO INTERESA': ['no interesa'],
      'SERVIDO POR ERROR': ['servido', 'error'],
      'DEFECTUOSO': ['defectuoso', 'defecto'],
      'FECHA DE CADUCIDAD': ['caducidad', 'fecha'],
      'ERROR DE PRECIO': ['precio'],
      'OTROS': ['otros'],
    };
    const kws = KEYWORDS[norm] || [norm.toLowerCase()];
    for (const opt of select.options) {
      const t = opt.text.toLowerCase();
      if (kws.some(k => t.includes(k))) {
        setSelectValue(select, opt.value);
        return true;
      }
    }

    return false;
  }

  // ââââââââââââââââââââââââââââââââââââââââââââââ
  //  PÃGINA FARMÃCIA-TOOLS (diordes.github.io)
  // ââââââââââââââââââââââââââââââââââââââââââââââ

  function initFarmaciaPage() {
    // Anunciar presÃ¨ncia (per detecciÃ³ des de la pÃ gina)
    // Amb @grant, cal unsafeWindow per accedir al window de la pÃ gina
    unsafeWindow.__FARMACIA_DEVOLUCIONS_SCRIPT__ = true;
    unsafeWindow.dispatchEvent(new CustomEvent('farmacia-devolucions-ready'));
    log('Script v2.0 active on farmacia-tools page');

    // Escoltar peticions de devoluciÃ³ des de la pÃ gina
    unsafeWindow.addEventListener('farmacia-start-return', (e) => {
      const detail = e.detail;
      if (!detail || !detail.products || !detail.wholesaler) {
        log('Invalid event detail', detail);
        return;
      }

      log(`Return request: ${detail.products.length} products â ${detail.wholesaler}`);

      // Marcar que hem gestionat l'event (la pÃ gina ho comprova sincrÃ²nicament)
      unsafeWindow.__FARMACIA_RETURN_HANDLED__ = true;

      // Guardar dades a GM storage (sobreviu redirections ADFS)
      storePending(detail.products, detail.wholesaler);

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
    });
  }

  // ââââââââââââââââââââââââââââââââââââââââââââââ
  //  PÃGINA ALLIANCE HEALTHCARE
  // ââââââââââââââââââââââââââââââââââââââââââââââ

  function initAlliancePage() {
    const data = getPending();
    if (!data || data.wholesaler !== 'alliance') {
      log('No pending Alliance return â script idle');
      return;
    }

    log(`Pending return found: ${data.products.length} product(s)`);

    // Iniciar automatitzaciÃ³ amb un delay per deixar carregar la SPA
    (async () => {
      await sleep(3000);
      await allianceRun(data.products);
    })();
  }

  // ââââââââââââââââââââââââââââââââââââââââââââââ
  //  PUNT D'ENTRADA
  // ââââââââââââââââââââââââââââââââââââââââââââââ

  const host = window.location.hostname;

  if (host === 'diordes.github.io') {
    initFarmaciaPage();
  } else if (host === 'my.alliance-healthcare.es') {
    initAlliancePage();
  }

})();
