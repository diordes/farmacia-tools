/* ============================================================
   UI — User interface updates and interactions
   ============================================================ */
const UI = (() => {

  let allInvoices = []; // Master list of all found invoices

  function togglePanel(name) {
    const panel = document.getElementById('panel-' + name);
    if (panel) {
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) {
        Config.populateUI();
        Suppliers.populateUI();
        Sources.populateUI();
        updateAccountsList();
      }
    }
  }

  function updateAccountsBar() {
    const bar = document.getElementById('accounts-bar');
    if (!bar) return;

    const accounts = Auth.getAccounts();
    bar.innerHTML = '';

    for (const acc of accounts) {
      const isActive = acc.expiresAt > Date.now();
      const chip = document.createElement('div');
      chip.className = 'account-chip';
      chip.innerHTML = `
        <span class="dot" style="background:${isActive ? 'var(--success)' : 'var(--danger)'}"></span>
        <span>${acc.email}</span>
        <span class="remove" onclick="Auth.removeAccount('${acc.email}')" title="Desconnectar">✕</span>
      `;
      bar.appendChild(chip);
    }
  }

  function updateAccountsList() {
    const list = document.getElementById('accounts-list');
    if (!list) return;

    const accounts = Auth.getAccounts();
    list.innerHTML = '';

    if (accounts.length === 0) {
      list.innerHTML = '<p class="help-text">Cap compte connectat.</p>';
      return;
    }

    for (const acc of accounts) {
      const isActive = acc.expiresAt > Date.now();
      const div = document.createElement('div');
      div.className = 'source-item';
      div.innerHTML = `
        <span class="dot" style="width:8px;height:8px;border-radius:50%;background:${isActive ? 'var(--success)' : 'var(--danger)'}"></span>
        <span style="flex:1">${acc.email} ${isActive ? '(actiu)' : '(expirat)'}</span>
        ${!isActive ? `<button class="btn btn-sm btn-outline" onclick="Auth.addAccount('${acc.email}').then(() => UI.updateAccountsList())">🔄 Reconnectar</button>` : ''}
        <button class="btn btn-sm btn-danger" onclick="Auth.removeAccount('${acc.email}')">Eliminar</button>
      `;
      list.appendChild(div);
    }

    // Update Drive account selector
    updateDriveAccountSelector(accounts);
  }

  function updateDriveAccountSelector(accounts) {
    const sel = document.getElementById('input-drive-account');
    if (!sel) return;
    const currentVal = sel.value || Config.get('driveAccount') || '';
    sel.innerHTML = '<option value="">Mateix compte que l\'origen</option>';
    for (const acc of (accounts || Auth.getAccounts())) {
      sel.innerHTML += `<option value="${acc.email}" ${acc.email === currentVal ? 'selected' : ''}>${acc.email}</option>`;
    }
  }

  function updateScanButtons() {
    const hasAccounts = Auth.getActiveTokens().length > 0;
    const btnScan = document.getElementById('btn-scan');
    const btnScanCustom = document.getElementById('btn-scan-custom');
    const status = document.getElementById('status-text');

    if (btnScan) btnScan.disabled = !hasAccounts;
    if (btnScanCustom) btnScanCustom.disabled = !hasAccounts;
    if (status) {
      status.textContent = hasAccounts
        ? `${Auth.getActiveTokens().length} compte(s) connectat(s)`
        : 'Connecta un compte per començar';
    }
  }

  function showProgress(visible) {
    const el = document.getElementById('progress-bar');
    if (el) el.classList.toggle('hidden', !visible);
  }

  function updateProgress(label, current, total, detail) {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    const elLabel = document.getElementById('progress-label');
    const elCount = document.getElementById('progress-count');
    const elFill = document.getElementById('progress-fill');
    const elDetail = document.getElementById('progress-detail');

    if (elLabel) elLabel.textContent = label;
    if (elCount) elCount.textContent = `${current} / ${total}`;
    if (elFill) elFill.style.width = pct + '%';
    if (elDetail) elDetail.textContent = detail || '';
  }

  function showUploadArea() {
    const el = document.getElementById('upload-area');
    if (el) el.classList.toggle('hidden');
  }

  // Render all invoices to the table
  function renderResults(invoices) {
    allInvoices = invoices;
    const body = document.getElementById('results-body');
    if (!body) return;

    body.innerHTML = '';

    if (invoices.length === 0) {
      body.innerHTML = `
        <tr class="empty-row">
          <td colspan="10">
            <div class="empty-state">
              <p>No s'han trobat factures. Prova amb un altre període o revisa els filtres.</p>
            </div>
          </td>
        </tr>`;
      return;
    }

    for (const inv of invoices) {
      body.appendChild(createInvoiceRow(inv));
    }

    document.getElementById('stats-row')?.classList.remove('hidden');
    document.getElementById('filters-row')?.classList.remove('hidden');

    updateStats();
    updateFilterOptions();
  }

  function createInvoiceRow(inv) {
    const tr = document.createElement('tr');
    tr.dataset.dedupKey = inv.dedupKey;
    tr.dataset.status = inv.status;
    tr.dataset.supplier = inv.supplier;
    tr.dataset.account = inv.accountEmail;

    const statusBadge = getStatusBadge(inv.status);
    const sourceLabel = inv.source === 'gmail' ? '📧' : inv.source === 'drive' ? '📁' : '📤';

    tr.innerHTML = `
      <td><input type="checkbox" class="inv-check" data-key="${inv.dedupKey}" ${inv.status === 'duplicate' ? 'disabled' : ''} /></td>
      <td>${statusBadge}</td>
      <td>${inv.parsedDate || '-'}</td>
      <td><strong>${escapeHtml(inv.supplier)}</strong></td>
      <td title="${escapeHtml(inv.subject)}">
        <div style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${escapeHtml(inv.subject)}
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted)">${escapeHtml(inv.originalFilename || '')}</div>
      </td>
      <td>${escapeHtml(inv.invoiceNumber || '-')}</td>
      <td>${inv.amount ? inv.amount + ' €' : '-'}</td>
      <td title="${escapeHtml(inv.haciendaName)}">
        <div class="hacienda-name" data-key="${inv.dedupKey}" onclick="UI.editHaciendaName('${inv.dedupKey}')" title="Clic per editar" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;font-size:0.75rem;cursor:pointer;border-bottom:1px dashed var(--text-muted)">
          ${escapeHtml(inv.haciendaName)}
        </div>
      </td>
      <td><span class="source-badge">${sourceLabel} ${escapeHtml(inv.accountEmail?.split('@')[0] || inv.source)}</span></td>
      <td class="action-btns">
        ${inv.source === 'gmail' ? `<button class="btn btn-sm btn-outline" onclick="Processor.downloadOne('${inv.dedupKey}')" title="Descarregar amb nom Hisenda">⬇️</button>` : ''}
        ${inv.driveLink ? `<a href="${inv.driveLink}" target="_blank" class="btn btn-sm btn-outline" title="Obrir a Drive">📁</a>` : ''}
        ${inv.status === 'duplicate' && inv.dupReason ? `<span title="${escapeHtml(inv.dupReason)}" style="cursor:help">ℹ️</span>` : ''}
      </td>
    `;
    return tr;
  }

  function addInvoiceRow(inv) {
    allInvoices.push(inv);
    const body = document.getElementById('results-body');
    if (!body) return;

    // Remove empty state if present
    const emptyRow = body.querySelector('.empty-row');
    if (emptyRow) emptyRow.remove();

    body.appendChild(createInvoiceRow(inv));
    document.getElementById('stats-row')?.classList.remove('hidden');
    document.getElementById('filters-row')?.classList.remove('hidden');
  }

  function updateInvoiceRow(inv) {
    const body = document.getElementById('results-body');
    if (!body) return;

    const rows = body.querySelectorAll('tr[data-dedup-key]');
    for (const row of rows) {
      if (row.dataset.dedupKey === inv.dedupKey) {
        const newRow = createInvoiceRow(inv);
        row.replaceWith(newRow);
        break;
      }
    }
  }

  function getStatusBadge(status) {
    const badges = {
      'new': '<span class="status-badge status-new">🆕 Nova</span>',
      'uploaded': '<span class="status-badge status-uploaded">✅ Pujada</span>',
      'duplicate': '<span class="status-badge status-duplicate">🐁 Duplicat</span>',
      'error': '<span class="status-badge status-error">❌ Error</span>',
      'pending': '<span class="status-badge status-pending">⏳ Pendent</span>'
    };
    return badges[status] || status;
  }

  function updateStats() {
    const found = allInvoices.length;
    const newCount = allInvoices.filter(i => i.status === 'new').length;
    const dupes = allInvoices.filter(i => i.status === 'duplicate').length;
    const uploaded = allInvoices.filter(i => i.status === 'uploaded').length;
    const totalEur = allInvoices
      .filter(i => i.amount && i.status !== 'duplicate')
      .reduce((sum, i) => sum + parseFloat(i.amount || 0), 0);

    setText('stat-found', found);
    setText('stat-new', newCount);
    setText('stat-dupes', dupes);
    setText('stat-uploaded', uploaded);
    setText('stat-total-eur', totalEur.toFixed(2) + ' €');
  }

  function updateFilterOptions() {
    const suppliers = [...new Set(allInvoices.map(i => i.supplier))].sort();
    const accounts = [...new Set(allInvoices.map(i => i.accountEmail))];

    const filterSupplier = document.getElementById('filter-supplier');
    const filterAccount = document.getElementById('filter-account');

    if (filterSupplier) {
      filterSupplier.innerHTML = '<option value="">Tots els proveïdors</option>';
      for (const s of suppliers) {
        filterSupplier.innerHTML += `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`;
      }
    }

    if (filterAccount) {
      filterAccount.innerHTML = '<option value="">Tots els comptes</option>';
      for (const a of accounts) {
        filterAccount.innerHTML += `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`;
      }
    }
  }

  function applyFilters() {
    const supplier = document.getElementById('filter-supplier')?.value || '';
    const account = document.getElementById('filter-account')?.value || '';
    const status = document.getElementById('filter-status')?.value || '';
    const search = (document.getElementById('filter-search')?.value || '').toLowerCase();
    const amountExact = document.getElementById('filter-amount-exact')?.value || '';
    const amountMin = document.getElementById('filter-amount-min')?.value || '';
    const amountMax = document.getElementById('filter-amount-max')?.value || '';
    const dateFrom = document.getElementById('filter-date-from')?.value || '';
    const dateTo = document.getElementById('filter-date-to')?.value || '';

    const body = document.getElementById('results-body');
    if (!body) return;

    let visibleCount = 0;
    const rows = body.querySelectorAll('tr[data-dedup-key]');

    for (const row of rows) {
      const inv = allInvoices.find(i => i.dedupKey === row.dataset.dedupKey);
      let show = true;

      if (supplier && row.dataset.supplier !== supplier) show = false;
      if (account && row.dataset.account !== account) show = false;
      if (status && row.dataset.status !== status) show = false;
      if (search && !row.textContent.toLowerCase().includes(search)) show = false;

      // Amount exact (with 0.01 tolerance)
      if (show && amountExact && inv) {
        const target = parseFloat(amountExact);
        const actual = parseFloat(inv.amount || 0);
        if (Math.abs(actual - target) > 0.01) show = false;
      }

      // Amount range
      if (show && amountMin && inv) {
        const min = parseFloat(amountMin);
        const actual = parseFloat(inv.amount || 0);
        if (actual < min) show = false;
      }
      if (show && amountMax && inv) {
        const max = parseFloat(amountMax);
        const actual = parseFloat(inv.amount || 0);
        if (actual > max) show = false;
      }

      // Date range (compare YYYY-MM-DD strings)
      if (show && inv) {
        const invDate = inv.parsedDate || '';
        if (dateFrom && invDate && invDate < dateFrom) show = false;
        if (dateTo && invDate && invDate > dateTo) show = false;
      }

      row.style.display = show ? '' : 'none';
      if (show) visibleCount++;
    }

    // Update filter count
    const countText = document.getElementById('filter-count-text');
    if (countText) {
      const total = rows.length;
      if (visibleCount === total) {
        countText.textContent = `${total} factures`;
      } else {
        countText.textContent = `${visibleCount} de ${total} factures`;
      }
    }
  }

  function clearFilters() {
    const ids = [
      'filter-supplier', 'filter-account', 'filter-status', 'filter-search',
      'filter-amount-exact', 'filter-amount-min', 'filter-amount-max',
      'filter-date-from', 'filter-date-to'
    ];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.value = '';
    }
    applyFilters();
  }

  function getSelectedInvoices() {
    const checkboxes = document.querySelectorAll('.inv-check:checked');
    const keys = new Set([...checkboxes].map(cb => cb.dataset.key));
    return allInvoices.filter(inv => keys.has(inv.dedupKey));
  }

  function toggleSelectAll(checkbox) {
    const all = document.querySelectorAll('.inv-check:not(:disabled)');
    for (const cb of all) {
      // Only select visible rows
      const row = cb.closest('tr');
      if (row && row.style.display !== 'none') {
        cb.checked = checkbox.checked;
      }
    }
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function editHaciendaName(dedupKey) {
    const inv = allInvoices.find(i => i.dedupKey === dedupKey);
    if (!inv) return;

    const newName = prompt('Editar nom Hisenda:', inv.haciendaName);
    if (newName === null || newName.trim() === '' || newName === inv.haciendaName) return;

    inv.haciendaName = newName.trim();

    // Update the cell in the DOM
    const cell = document.querySelector(`.hacienda-name[data-key="${CSS.escape(dedupKey)}"]`);
    if (cell) {
      cell.textContent = inv.haciendaName;
      cell.title = inv.haciendaName;
    }

    AppLog.info(`Nom Hisenda editat: ${inv.haciendaName}`);
  }

  function getAllInvoices() {
    return allInvoices;
  }

  return {
    togglePanel, updateAccountsBar, updateAccountsList, updateScanButtons,
    showProgress, updateProgress, showUploadArea,
    renderResults, addInvoiceRow, updateInvoiceRow, updateStats,
    applyFilters, clearFilters, getSelectedInvoices, toggleSelectAll, getAllInvoices,
    editHaciendaName, updateDriveAccountSelector
  };
})();
