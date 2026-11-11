// ==UserScript==
// @name         Farmàcia Central BCN — Auto Devolucions
// @namespace    https://diordes.github.io/farmacia-tools
// @version      1.0.0
// @description  Automatitza les devolucions als portals dels majoristes (Alliance Healthcare, Fedefarma, Cofares)
// @author       Farmàcia Central BCN
// @match        https://my.alliance-healthcare.es/*
// @match        https://diordes.github.io/farmacia-tools/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';

  // ── Configuration ──
  const CONFIG = {
    POLL_INTERVAL: 500,      // ms between DOM checks
    MAX_WAIT: 15000,         // max ms to wait for an element
    ACTION_DELAY: 800,       // ms delay between actions (let SPA render)
    SEARCH_DELAY: 1500,      // ms to wait after a search for results
  };

  // ── Utilities ──

  function log(msg, ...args) {
    console.log(`[AutoDevolucions] ${msg}`, ...args);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function waitForElement(selectorOrFn, timeout = CONFIG.MAX_WAIT) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        let el;
        if (typeof selectorOrFn === 'function') {
          el = selectorOrFn();
        } else {
          el = document.querySelector(selectorOrFn);
        }
        if (el) return resolve(el);
        if (Date.now() - start > timeout) return resolve(null);
        setTimeout(check, CONFIG.POLL_INTERVAL);
      };
      check();
    });
  }

  function waitForElementWithText(tag, text, timeout = CONFIG.MAX_WAIT) {
    return waitForElement(() => {
      const els = document.querySelectorAll(tag);
      for (const el of els) {
        if (el.textContent.trim().includes(text)) return el;
      }
      return null;
    }, timeout);
  }

  async function clickButtonWithText(text, tag = 'button, a, span') {
    const el = await waitForElementWithText(tag, text);
    if (!el) {
      log(`ERROR: No s'ha trobat el botó amb text "${text}"`);
      return false;
    }
    el.click();
    log(`Clic a: "${text}"`);
    await sleep(CONFIG.ACTION_DELAY);
    return true;
  }

  function setInputValue(input, value) {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }

  function parseReturnParams() {
    const url = new URL(window.location.href);
    const param = url.searchParams.get('farmacia_auto_return');
    if (!param) return null;
    try {
      return param.split(',').map(item => {
        const [cn, qty, ...reasonParts] = item.split(':');
        return {
          cn: cn.trim(),
          qty: parseInt(qty) || 1,
          reason: reasonParts.join(':').trim() || 'NO INTERESA'
        };
      });
    } catch (e) {
      log("ERROR: No s'han pogut parsejar els paràmetres", e);
      return null;
    }
  }

  // ── Status overlay ──

  function createStatusOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'farmacia-auto-status';
    overlay.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      width: 360px;
      background: #1e293b;
      color: #f1f5f9;
      border-radius: 12px;
      padding: 16px 20px;
      font-family: 'Inter', -apple-system, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      z-index: 99999;
      box-shadow: 0 20px 40px rgba(0,0,0,0.3);
    `;
    overlay.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <span style="font-size:18px;">🔄</span>
        <strong style="font-size:14px;">Auto Devolucions</strong>
        <span id="farmacia-status-badge" style="
          margin-left:auto;
          font-size:11px;
          padding:2px 8px;
          border-radius:10px;
          background:#3b82f6;
          color:white;
          font-weight:600;
        ">Processant...</span>
      </div>
      <div id="farmacia-status-log" style="
        max-height: 200px;
        overflow-y: auto;
        font-size: 12px;
        color: #94a3b8;
      "></div>
      <div id="farmacia-status-progress" style="
        margin-top: 12px;
        height: 4px;
        background: #334155;
        border-radius: 2px;
        overflow: hidden;
      ">
        <div id="farmacia-status-bar" style="
          height: 100%;
          background: #3b82f6;
          border-radius: 2px;
          width: 0%;
          transition: width 0.3s;
        "></div>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function updateStatus(msg, type = 'info') {
    const logEl = document.getElementById('farmacia-status-log');
    if (!logEl) return;
    const icons = { info: 'ℹ️', ok: '✅', warn: '⚠️', error: '❌', search: '🔍' };
    const line = document.createElement('div');
    line.style.marginBottom = '4px';
    line.innerHTML = `${icons[type] || '·'} ${msg}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
    log(msg);
  }

  function updateProgress(current, total) {
    const bar = document.getElementById('farmacia-status-bar');
    if (bar) bar.style.width = `${(current / total) * 100}%`;
  }

  function setStatusBadge(text, color) {
    const badge = document.getElementById('farmacia-status-badge');
    if (badge) {
      badge.textContent = text;
      badge.style.background = color;
    }
  }

  // ── Alliance Healthcare automation ──

  async function allianceAutomation(products) {
    createStatusOverlay();
    updateStatus(`Iniciant devolució de ${products.length} producte(s)...`);
    await sleep(2000);

    const searchByProductTab = await waitForElementWithText('a, button, span, li', 'Buscar por producto');
    if (searchByProductTab) {
      searchByProductTab.click();
      updateStatus('Pestanya "Buscar por producto" seleccionada', 'ok');
      await sleep(CONFIG.ACTION_DELAY);
    } else {
      updateStatus('Ja estem a la vista de cerca per producte', 'info');
    }

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      updateProgress(i, products.length);
      updateStatus(`Processant ${i + 1}/${products.length}: CN ${product.cn}`, 'search');

      try {
        const success = await allianceProcessSingleProduct(product);
        if (success) {
          successCount++;
          updateStatus(`CN ${product.cn} afegit a la llista`, 'ok');
        } else {
          failCount++;
          updateStatus(`CN ${product.cn}: no s'ha pogut afegir`, 'error');
        }
      } catch (e) {
        failCount++;
        updateStatus(`CN ${product.cn}: error — ${e.message}`, 'error');
      }

      if (i < products.length - 1) {
        await sleep(CONFIG.ACTION_DELAY);
      }
    }

    updateProgress(products.length, products.length);

    if (successCount > 0 && products.length > 0) {
      updateStatus('Aplicant motiu de devolució...', 'info');
      await allianceSetReason(products[0].reason);
    }

    if (failCount === 0) {
      setStatusBadge('Completat', '#22c55e');
      updateStatus(`✨ ${successCount} producte(s) afegit(s). Revisa i clica "Enviar devolución" manualment.`, 'ok');
    } else {
      setStatusBadge('Parcial', '#f59e0b');
      updateStatus(`${successCount} afegit(s), ${failCount} error(s). Revisa la llista.`, 'warn');
    }

    const overlay = document.getElementById('farmacia-auto-status');
    if (overlay) {
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕ Tancar';
      closeBtn.style.cssText = `
        margin-top: 12px;
        width: 100%;
        padding: 8px;
        background: #334155;
        color: #f1f5f9;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
      `;
      closeBtn.onclick = () => overlay.remove();
      overlay.appendChild(closeBtn);
    }

    const url = new URL(window.location.href);
    url.searchParams.delete('farmacia_auto_return');
    window.history.replaceState({}, '', url.toString());
  }

  async function allianceProcessSingleProduct(product) {
    const codeInput = await waitForElement(() => {
      const inputs = document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])');
      for (const input of inputs) {
        const placeholder = (input.placeholder || '').toLowerCase();
        const label = input.getAttribute('aria-label') || '';
        const name = input.name || '';
        if (placeholder.includes('codi') || placeholder.includes('códig') ||
            placeholder.includes('codigo') || placeholder.includes('código') ||
            label.toLowerCase().includes('código') || name.toLowerCase().includes('codigo') ||
            name.toLowerCase().includes('code')) {
          return input;
        }
      }
      const form = document.querySelector('form, .search-form, .search-container, [class*="search"], [class*="filter"]');
      if (form) {
        const formInput = form.querySelector('input[type="text"], input:not([type])');
        if (formInput) return formInput;
      }
      return null;
    });

    if (!codeInput) {
      log("No s'ha trobat el camp de codi");
      return false;
    }

    codeInput.focus();
    setInputValue(codeInput, product.cn);
    await sleep(300);

    const searchClicked = await clickButtonWithText('Buscar');
    if (!searchClicked) {
      codeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      codeInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
      await sleep(CONFIG.ACTION_DELAY);
    }

    await sleep(CONFIG.SEARCH_DELAY);

    const noResults = document.body.textContent.includes('No existen resultados');
    if (noResults) {
      log(`CN ${product.cn}: no results found`);
      return false;
    }

    const addBtn = await waitForElement(() => {
      const btns = document.querySelectorAll('button, a, span');
      for (const btn of btns) {
        const text = btn.textContent.trim();
        const cls = (btn.className || '').toLowerCase();
        if (text === '>' || text === '›' || text === '▶' ||
            cls.includes('chevron') || cls.includes('arrow') ||
            cls.includes('select') || cls.includes('add-product') ||
            (btn.tagName === 'I' && (cls.includes('angle-right') || cls.includes('chevron')))) {
          return btn;
        }
      }
      const icons = document.querySelectorAll('i.fa-angle-right, i.fa-chevron-right, .icon-arrow-right, [class*="angle-right"]');
      for (const icon of icons) {
        return icon.closest('button') || icon.closest('a') || icon;
      }
      return null;
    });

    if (addBtn) {
      addBtn.click();
      log(`Clicked result arrow for CN ${product.cn}`);
      await sleep(CONFIG.ACTION_DELAY);
    } else {
      const resultRow = document.querySelector('tr.clickable, tr[ng-click], .result-row, table tbody tr');
      if (resultRow) {
        resultRow.click();
        await sleep(CONFIG.ACTION_DELAY);
      } else {
        log(`No result row found for CN ${product.cn}`);
        return false;
      }
    }

    await sleep(CONFIG.SEARCH_DELAY);

    const checkbox = await waitForElement(() => {
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      for (const cb of checkboxes) {
        if (!cb.checked) return cb;
      }
      return checkboxes[0] || null;
    });

    if (checkbox && !checkbox.checked) {
      checkbox.click();
      log('Albarà seleccionat');
      await sleep(CONFIG.ACTION_DELAY);
    }

    const addToListClicked = await clickButtonWithText('Añadir productos a la lista');
    if (!addToListClicked) {
      const altClicked = await clickButtonWithText('Añadir');
      if (!altClicked) {
        log("No s'ha pogut afegir a la llista");
        return false;
      }
    }

    await sleep(CONFIG.ACTION_DELAY);
    return true;
  }

  async function allianceSetReason(reason) {
    const selects = document.querySelectorAll('select');
    for (const select of selects) {
      const label = select.getAttribute('aria-label') || '';
      const name = select.name || '';
      const id = select.id || '';
      const combined = (label + name + id).toLowerCase();

      if (combined.includes('motiv') || combined.includes('reason') || combined.includes('causa')) {
        for (const opt of select.options) {
          if (opt.text.toUpperCase().includes(reason.toUpperCase()) ||
              opt.value.toUpperCase().includes(reason.toUpperCase())) {
            select.value = opt.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            updateStatus(`Motiu establert: ${reason}`, 'ok');
            break;
          }
        }
        break;
      }
    }

    await sleep(CONFIG.ACTION_DELAY);
    const applyAll = await waitForElementWithText('button, a, span', 'Aplicar a todos', 3000);
    if (applyAll) {
      applyAll.click();
      updateStatus('Motiu aplicat a tots els productes', 'ok');
    }
  }

  // ── Main entry point ──

  function init() {
    const products = parseReturnParams();
    if (!products || products.length === 0) {
      return;
    }

    log(`Auto-return detected: ${products.length} product(s)`);

    const startAutomation = async () => {
      await sleep(3000);
      await allianceAutomation(products);
    };

    startAutomation();
  }

  // Run
  init();

  // Announce script presence for detection by farmacia-tools page
  window.__FARMACIA_DEVOLUCIONS_SCRIPT__ = true;
  window.dispatchEvent(new CustomEvent('farmacia-devolucions-ready'));

})();
