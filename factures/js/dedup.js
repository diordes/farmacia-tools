/* ============================================================
   Dedup — Deduplication of invoices across accounts and sources
   ============================================================ */
const Dedup = (() => {

  const STORAGE_KEY = 'factures_tool_processed';

  // Load previously processed invoice keys
  function loadProcessed() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  }

  function saveProcessed(set) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
    } catch (e) {
      console.warn('Failed to save processed list:', e);
    }
  }

  // Mark an invoice as processed
  function markProcessed(dedupKey) {
    const set = loadProcessed();
    set.add(dedupKey);
    saveProcessed(set);
  }

  // Check if an invoice was already processed
  function isProcessed(dedupKey) {
    return loadProcessed().has(dedupKey);
  }

  // Deduplicate a list of invoice records
  // Returns { unique: [], duplicates: [] }
  function deduplicate(invoices) {
    const processed = loadProcessed();
    const seen = new Map(); // dedupKey → first invoice
    const unique = [];
    const duplicates = [];

    for (const inv of invoices) {
      const key = inv.dedupKey;

      // Already processed in a previous session
      if (processed.has(key)) {
        inv.status = 'duplicate';
        inv.dupReason = 'Processada anteriorment';
        duplicates.push(inv);
        continue;
      }

      // Duplicate within this batch
      if (seen.has(key)) {
        inv.status = 'duplicate';
        inv.dupReason = `Duplicat de ${seen.get(key).accountEmail} (${seen.get(key).originalFilename})`;
        duplicates.push(inv);
        continue;
      }

      // Check for fuzzy duplicates (same supplier + same date + similar filename)
      let isFuzzyDup = false;
      for (const [existingKey, existingInv] of seen) {
        if (existingInv.supplier === inv.supplier &&
            existingInv.parsedDate === inv.parsedDate &&
            areSimilarFilenames(existingInv.originalFilename, inv.originalFilename)) {
          inv.status = 'duplicate';
          inv.dupReason = `Similar a ${existingInv.originalFilename} (${existingInv.accountEmail}, ${existingInv.parsedDate})`;
          duplicates.push(inv);
          isFuzzyDup = true;
          break;
        }
      }

      if (!isFuzzyDup) {
        seen.set(key, inv);
        unique.push(inv);
      }
    }

    return { unique, duplicates };
  }

  // Check if two filenames are similar (same invoice, different naming)
  function areSimilarFilenames(name1, name2) {
    if (!name1 || !name2) return false;

    // Normalize: lowercase, remove spaces and special chars, remove extension
    const norm = s => s.toLowerCase().replace(/\.(pdf|xlsx?|xml)$/i, '').replace(/[\s_.-]+/g, '');
    const n1 = norm(name1);
    const n2 = norm(name2);

    // Only exact match after normalization (no fuzzy includes — too aggressive)
    return n1 === n2;
  }

  // Cross-check with Drive files
  async function checkDriveForDuplicates(email, invoices) {
    try {
      const driveFiles = await DriveService.listAllInvoices(email);
      const driveNames = new Set(driveFiles.map(f => f.name.toLowerCase()));

      for (const inv of invoices) {
        if (inv.status === 'duplicate') continue;

        if (driveNames.has(inv.haciendaName.toLowerCase()) ||
            driveNames.has(inv.originalFilename.toLowerCase())) {
          inv.status = 'duplicate';
          inv.dupReason = 'Ja existeix a Drive';
        }
      }
    } catch (e) {
      AppLog.warn(`No s'ha pogut verificar duplicats a Drive: ${e.message}`);
    }
  }

  // Clear processed history
  function clearHistory() {
    localStorage.removeItem(STORAGE_KEY);
    AppLog.info('Historial de processament esborrat');
  }

  return { deduplicate, markProcessed, isProcessed, checkDriveForDuplicates, clearHistory, loadProcessed };
})();
