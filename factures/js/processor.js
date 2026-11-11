/* ============================================================
   Processor â Download, rename, and upload invoices to Drive
   ============================================================ */
const Processor = (() => {

  // Process selected invoices: download from Gmail, rename, upload to Drive
  async function uploadSelected() {
    const selected = UI.getSelectedInvoices();
    if (selected.length === 0) {
      alert('Selecciona almenys una factura per pujar a Drive');
      return;
    }

    const confirm = window.confirm(
      `Pujar ${selected.length} factura(es) a Google Drive?\n\n` +
      `Es guardaran a la carpeta "${Config.get('driveFolderName')}" organitzades per proveÃ¯dor.`
    );
    if (!confirm) return;

    UI.showProgress(true);
    let uploaded = 0;
    let errors = 0;

    for (let i = 0; i < selected.length; i++) {
      const inv = selected[i];
      UI.updateProgress(
        `Pujant ${inv.haciendaName}...`,
        i + 1,
        selected.length,
        `${inv.supplier} â ${inv.originalFilename}`
      );

      try {
        // Ensure token is valid
        await Auth.refreshIfNeeded(inv.accountEmail);

        // Download attachment from Gmail
        const data = await GmailService.downloadAttachment(
          inv.accountEmail, inv.messageId, inv.attachmentId
        );

        // Get or create supplier folder in Drive
        const folderId = await DriveService.getSupplierFolder(inv.accountEmail, inv.supplier);

        // Check if already exists
        const exists = await DriveService.fileExists(inv.accountEmail, folderId, inv.haciendaName);
        if (exists) {
          inv.status = 'duplicate';
          inv.dupReason = 'Ja existeix a Drive';
          UI.updateInvoiceRow(inv);
          AppLog.warn(`[Drive] Ja existeix: ${inv.haciendaName}`);
          continue;
        }

        // Upload to Drive
        const result = await DriveService.uploadFile(
          inv.accountEmail, folderId, inv.haciendaName, data, inv.mimeType
        );

        inv.status = 'uploaded';
        inv.driveLink = result.webViewLink;
        uploaded++;

        // Mark as processed for dedup
        Dedup.markProcessed(inv.dedupKey);

        UI.updateInvoiceRow(inv);
        AppLog.success(`[Drive] Pujat: ${inv.haciendaName}`);

      } catch (e) {
        inv.status = 'error';
        inv.errorMsg = e.message;
        errors++;
        UI.updateInvoiceRow(inv);
        AppLog.error(`Error pujant ${inv.originalFilename}: ${e.message}`);
      }
    }

    UI.showProgress(false);
    UI.updateStats();

    const msg = `â ProcÃ©s completat!\n\n` +
      `- Pujades: ${uploaded}\n` +
      `- Errors: ${errors}\n` +
      `- Duplicades: ${selected.length - uploaded - errors}`;
    alert(msg);
  }

  // Download selected invoices as renamed files (triggers browser download)
  async function downloadSelected() {
    const selected = UI.getSelectedInvoices();
    if (selected.length === 0) {
      alert('Selecciona almenys una factura per descarregar');
      return;
    }

    UI.showProgress(true);

    for (let i = 0; i < selected.length; i++) {
      const inv = selected[i];
      UI.updateProgress(
        `Descarregant ${inv.haciendaName}...`,
        i + 1,
        selected.length
      );

      try {
        await Auth.refreshIfNeeded(inv.accountEmail);
        const data = await GmailService.downloadAttachment(
          inv.accountEmail, inv.messageId, inv.attachmentId
        );

        // Trigger browser download with Hacienda name
        const blob = new Blob([data], { type: inv.mimeType || 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = inv.haciendaName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        AppLog.success(`Descarregat: ${inv.haciendaName}`);

        // Small delay between downloads
        await new Promise(r => setTimeout(r, 300));

      } catch (e) {
        AppLog.error(`Error descarregant ${inv.originalFilename}: ${e.message}`);
      }
    }

    UI.showProgress(false);
  }

  // Upload manually provided files
  async function uploadManualFiles(files, supplierName) {
    if (files.length === 0) return;

    const accounts = Auth.getActiveTokens();
    if (accounts.length === 0) {
      alert('Connecta un compte primer per pujar a Drive.');
      return;
    }

    // Use the configured Drive account, or first available
    const driveTarget = Config.get('driveAccount') || accounts[0].email;
    const driveAcc = accounts.find(a => a.email === driveTarget);
    if (!driveAcc) {
      alert('â ï¸ El compte Drive destÃ­ (' + driveTarget + ') no estÃ  connectat. Connecta\'l primer.');
      return;
    }
    const email = driveAcc.email;

    UI.showProgress(true);
    let uploaded = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      UI.updateProgress(
        `Pujant ${file.name}...`,
        i + 1,
        files.length
      );

      try {
        const data = await readFileAsArrayBuffer(file);
        const uint8 = new Uint8Array(data);

        // Parse info from filename
        const date = new Date().toISOString().split('T')[0];
        const supplier = supplierName || 'MANUAL';
        const invoiceNum = InvoiceParser.extractInvoiceNumber('', file.name);
        const amount = InvoiceParser.extractAmount('', file.name);
        const haciendaName = InvoiceParser.generateHaciendaName(
          date, supplier, invoiceNum, amount, file.name
        );

        const folderId = await DriveService.getSupplierFolder(email, supplier);
        const result = await DriveService.uploadFile(
          email, folderId, haciendaName, uint8, file.type
        );

        uploaded++;
        AppLog.success(`[Manual] Pujat: ${haciendaName}`);

        // Add to results table
        const inv = {
          messageId: 'manual-' + Date.now(),
          accountEmail: email,
          from: 'Manual upload',
          fromEmail: '',
          subject: file.name,
          date: new Date().toISOString(),
          parsedDate: date,
          supplier,
          originalFilename: file.name,
          invoiceNumber: invoiceNum,
          amount,
          haciendaName,
          source: 'manual',
          status: 'uploaded',
          driveLink: result.webViewLink,
          dedupKey: InvoiceParser.generateDedupKey(supplier, invoiceNum, amount, date, file.name)
        };
        UI.addInvoiceRow(inv);

      } catch (e) {
        AppLog.error(`Error pujant ${file.name}: ${e.message}`);
      }
    }

    UI.showProgress(false);
    UI.updateStats();
    alert(`â ${uploaded} de ${files.length} fitxers pujats a Drive`);
  }

  // Download a single invoice with Hacienda name
  async function downloadOne(dedupKey) {
    const inv = UI.getAllInvoices().find(i => i.dedupKey === dedupKey);
    if (!inv) { alert('Factura no trobada'); return; }

    if (inv.source === 'manual') {
      AppLog.warn('Les factures pujades manualment no es poden descarregar des de Gmail.');
      return;
    }

    AppLog.info(`Descarregant ${inv.haciendaName}...`);

    try {
      await Auth.refreshIfNeeded(inv.accountEmail);
      const data = await GmailService.downloadAttachment(
        inv.accountEmail, inv.messageId, inv.attachmentId
      );

      const blob = new Blob([data], { type: inv.mimeType || 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = inv.haciendaName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      AppLog.success(`â Descarregat: ${inv.haciendaName}`);
    } catch (e) {
      AppLog.error(`Error descarregant: ${e.message}`);
    }
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  return { uploadSelected, downloadSelected, uploadManualFiles, downloadOne };
})();
