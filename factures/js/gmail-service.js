/* ============================================================
   GmailService — Search and download invoices from Gmail
   ============================================================ */
const GmailService = (() => {

  // Search terms that indicate an invoice
  const INVOICE_TERMS = [
    'factura', 'invoice', 'fra ', 'fra.', 'fra:', 'fra/',
    'nota de crèdit', 'nota de credito', 'abono', 'credit note',
    'facturación', 'facturació', 'liquidación', 'liquidació',
    'rectificativa', 'cargo', 'adeudo'
  ];

  // Terms to EXCLUDE (not invoices!)
  const EXCLUDE_TERMS = [
    'aviso de pago', 'avis de pagament',
    'confirmación de pedido', 'confirmació de comanda',
    'albarán', 'albarà',
    'presupuesto', 'pressupost',
    'acuerdo comercial', 'acord comercial'
  ];

  // Filename patterns for invoice attachments
  const INVOICE_FILENAMES = [
    'factura', 'invoice', 'fra_', 'fra-', 'facture', 'rechnung',
    'liquidacion', 'liquidació', 'nota_credito', 'rectificativa'
  ];

  // Build Gmail search query
  function buildQuery(afterDate, beforeDate) {
    const subjectTerms = INVOICE_TERMS.map(t => `subject:"${t}"`).join(' OR ');
    const fileTerms = INVOICE_FILENAMES.map(t => `filename:${t}`).join(' OR ');
    let query = `(${subjectTerms} OR ${fileTerms}) has:attachment`;
    if (afterDate) query += ` after:${afterDate}`;
    if (beforeDate) query += ` before:${beforeDate}`;
    return query;
  }

  // Search Gmail for invoice threads
  async function searchInvoices(email, afterDate, beforeDate, onProgress) {
    if (!Auth.useAccount(email)) {
      throw new Error('No s\'ha pogut activar el compte ' + email);
    }

    // DIAGNOSTIC: verify which account the API actually sees
    try {
      const profile = await gapi.client.gmail.users.getProfile({ userId: 'me' });
      const realEmail = profile.result.emailAddress;
      if (realEmail !== email) {
        AppLog.error(`⚠️ TOKEN INCORRECTE! Volíem ${email} però l'API veu ${realEmail}`);
      } else {
        AppLog.info(`[${email}] ✓ Token verificat — API veu ${realEmail} (${profile.result.messagesTotal} missatges totals)`);
      }
    } catch (profileErr) {
      AppLog.error(`[${email}] Error verificant perfil: ${profileErr.message}`);
    }

    const query = buildQuery(afterDate, beforeDate);
    AppLog.info(`[${email}] Cercant: ${query}`);

    // DIAGNOSTIC: also try a simple query to see if the API works at all
    try {
      const testResp = await gapi.client.gmail.users.messages.list({
        userId: 'me',
        q: 'subject:factura has:attachment',
        maxResults: 5
      });
      const testCount = (testResp.result.messages || []).length;
      const testEstimate = testResp.result.resultSizeEstimate || 0;
      AppLog.info(`[${email}] 🔍 Test simple (subject:factura has:attachment): ${testCount} missatges, estimació: ${testEstimate}`);
    } catch (testErr) {
      AppLog.error(`[${email}] Error en test simple: ${testErr.message}`);
    }

    const results = [];
    let pageToken = null;
    let page = 0;

    do {
      const params = {
        userId: 'me',
        q: query,
        maxResults: 100,
        pageToken: pageToken || undefined
      };

      const resp = await gapi.client.gmail.users.messages.list(params);
      const messages = resp.result.messages || [];
      pageToken = resp.result.nextPageToken;
      page++;

      // DIAGNOSTIC: log raw response on first page
      if (page === 1) {
        AppLog.info(`[${email}] Resposta API pàg 1: ${messages.length} missatges, estimate=${resp.result.resultSizeEstimate}, nextPage=${!!pageToken}`);
      }

      if (onProgress) {
        onProgress({
          phase: 'search',
          email,
          page,
          found: results.length + messages.length,
          hasMore: !!pageToken
        });
      }

      // Fetch each message details
      for (const msg of messages) {
        try {
          const detail = await fetchMessageDetail(email, msg.id);
          if (detail && !isExcluded(detail.subject)) {
            results.push(detail);
          }
        } catch (e) {
          AppLog.error(`[${email}] Error processant missatge ${msg.id}: ${e.message}`);
        }
      }

    } while (pageToken);

    AppLog.info(`[${email}] ${results.length} missatges amb possibles factures trobats`);
    return results;
  }

  // Fetch full message details
  async function fetchMessageDetail(email, messageId) {
    if (!Auth.useAccount(email)) return null;

    const resp = await gapi.client.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date']
    });

    const msg = resp.result;
    const headers = {};
    for (const h of (msg.payload?.headers || [])) {
      headers[h.name.toLowerCase()] = h.value;
    }

    // Get attachments info
    const attachments = [];
    extractAttachments(msg.payload, attachments);

    if (attachments.length === 0) return null;

    const fromEmail = extractEmailFromHeader(headers.from || '');

    return {
      id: messageId,
      accountEmail: email,
      from: headers.from || '',
      fromEmail,
      subject: headers.subject || '(sense assumpte)',
      date: headers.date || '',
      parsedDate: parseDate(headers.date),
      supplier: Suppliers.getSupplierName(fromEmail, headers.from),
      attachments,
      source: 'gmail'
    };
  }

  // Recursively extract attachment info from MIME parts
  function extractAttachments(part, result) {
    if (!part) return;

    if (part.filename && part.filename.length > 0 && part.body) {
      const mime = part.mimeType || '';
      const name = part.filename.toLowerCase();
      // Only PDFs, Excel, and XML (e-invoices)
      if (mime.includes('pdf') || mime.includes('spreadsheet') || mime.includes('excel') ||
          name.endsWith('.pdf') || name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.xml')) {
        result.push({
          filename: part.filename,
          mimeType: mime,
          attachmentId: part.body.attachmentId,
          size: part.body.size || 0
        });
      }
    }

    if (part.parts) {
      for (const p of part.parts) {
        extractAttachments(p, result);
      }
    }
  }

  // Download attachment blob
  async function downloadAttachment(email, messageId, attachmentId) {
    if (!Auth.useAccount(email)) {
      throw new Error('Token no disponible per ' + email);
    }

    const resp = await gapi.client.gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId
    });

    // Convert base64url to blob
    const data = resp.result.data;
    const binaryStr = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes;
  }

  // Check if subject contains excluded terms
  function isExcluded(subject) {
    const lower = (subject || '').toLowerCase();
    return EXCLUDE_TERMS.some(term => lower.includes(term));
  }

  // Extract email from "Name <email>" format
  function extractEmailFromHeader(from) {
    const match = from.match(/<([^>]+)>/);
    return match ? match[1].toLowerCase() : from.toLowerCase().trim();
  }

  // Parse date string to YYYY-MM-DD
  function parseDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '';
      return d.toISOString().split('T')[0];
    } catch {
      return '';
    }
  }

  return { searchInvoices, downloadAttachment, buildQuery, INVOICE_TERMS, EXCLUDE_TERMS };
})();
