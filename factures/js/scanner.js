/* ============================================================
   Scanner — Orchestrates the full scan across accounts
   ============================================================ */
const Scanner = (() => {

  let isScanning = false;

  async function startScan() {
    if (isScanning) return;

    const accounts = Auth.getActiveTokens();
    if (accounts.length === 0) {
      alert('Connecta almenys un compte Gmail per buscar factures.');
      return;
    }

    const monthsBack = Config.get('monthsBack') || 3;
    const afterDate = new Date();
    afterDate.setMonth(afterDate.getMonth() - monthsBack);
    const afterStr = formatDateForGmail(afterDate);

    await runScan(accounts, afterStr);
  }

  async function customScan() {
    const input = prompt(
      'Data d\'inici (AAAA/MM/DD):\nExemple: 2026/01/01',
      new Date().getFullYear() + '/01/01'
    );
    if (!input) return;

    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(input.trim())) {
      alert('Format incorrecte. Usa AAAA/MM/DD');
      return;
    }

    const accounts = Auth.getActiveTokens();
    if (accounts.length === 0) {
      alert('Connecta almenys un compte Gmail.');
      return;
    }

    await runScan(accounts, input.trim());
  }

  async function runScan(accounts, afterDate, beforeDate) {
    isScanning = true;
    const btnScan = document.getElementById('btn-scan');
    if (btnScan) {
      btnScan.disabled = true;
      btnScan.textContent = '⏳ Buscant...';
    }

    UI.showProgress(true);
    AppLog.info(`=== Nova cerca: des de ${afterDate} amb ${accounts.length} compte(s) ===`);

    let allMessages = [];

    // Phase 1: Search Gmail across all accounts
    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i];
      UI.updateProgress(
        `Cercant a ${acc.email}...`,
        i + 1,
        accounts.length,
        'Fase 1: Cercant al Gmail'
      );

      try {
        await Auth.refreshIfNeeded(acc.email);
        const messages = await GmailService.searchInvoices(
          acc.email, afterDate, beforeDate,
          (progress) => {
            UI.updateProgress(
              `[${acc.email}] Pàgina ${progress.page}...`,
              progress.found,
              progress.found + (progress.hasMore ? 50 : 0),
              `Trobats: ${progress.found} correus amb possibles factures`
            );
          }
        );
        allMessages = allMessages.concat(messages);
      } catch (e) {
        AppLog.error(`Error cercant a ${acc.email}: ${e.message}`);
      }
    }

    AppLog.info(`Total missatges trobats: ${allMessages.length}`);

    // Phase 2: Parse invoices from messages
    UI.updateProgress('Analitzant factures...', 0, allMessages.length, 'Fase 2: Extracció');

    let allInvoices = [];
    for (let i = 0; i < allMessages.length; i++) {
      const parsed = InvoiceParser.parseMessage(allMessages[i]);
      allInvoices = allInvoices.concat(parsed);

      if (i % 10 === 0) {
        UI.updateProgress(
          'Analitzant factures...',
          i + 1,
          allMessages.length,
          `${allInvoices.length} factures extretes`
        );
      }
    }

    AppLog.info(`Total factures extretes: ${allInvoices.length}`);

    // Phase 3: Deduplication
    UI.updateProgress('Eliminant duplicats...', 0, 1, 'Fase 3: Deduplicació');

    const { unique, duplicates } = Dedup.deduplicate(allInvoices);

    // Also check Drive for existing files
    for (const acc of accounts) {
      try {
        await Dedup.checkDriveForDuplicates(acc.email, unique);
      } catch (e) {
        AppLog.warn(`Error verificant Drive per ${acc.email}: ${e.message}`);
      }
    }

    const finalList = [...unique, ...duplicates];
    // Sort: new first, then duplicates
    finalList.sort((a, b) => {
      const order = { 'new': 0, 'uploaded': 1, 'error': 2, 'duplicate': 3 };
      return (order[a.status] ?? 9) - (order[b.status] ?? 9);
    });

    AppLog.info(`Resultats: ${unique.filter(u => u.status === 'new').length} noves, ${duplicates.length + unique.filter(u => u.status === 'duplicate').length} duplicades`);

    // Phase 4: Render results
    UI.renderResults(finalList);
    UI.showProgress(false);

    // Reset button
    if (btnScan) {
      btnScan.disabled = false;
      btnScan.textContent = '🔍 Buscar factures';
    }
    isScanning = false;
  }

  function formatDateForGmail(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}/${m}/${d}`;
  }

  return { startScan, customScan };
})();
