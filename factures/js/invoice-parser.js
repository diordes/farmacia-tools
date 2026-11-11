/* ============================================================
   InvoiceParser — Extract invoice number, amount, generate
   Hacienda-compliant filenames
   ============================================================ */
const InvoiceParser = (() => {

  // Patterns for invoice numbers
  const INVOICE_NUM_PATTERNS = [
    /(?:factura|fra|invoice|fv|nc|ab|n[ºo°]?\s*factura)[\s.:_#nº°-]*([A-Z0-9][\w\/-]{3,25})/i,
    /(?:nº|num|número|numero|n\.)[\s.:_-]*([A-Z0-9][\w\/-]{3,20})/i,
    /\b([A-Z]{1,4}[-\/]?\d{4,12})\b/,     // FV-2026001, NC260401
    /\b(\d{4,6}[-\/]\d{4,8})\b/,           // 2026/12345
  ];

  // Patterns for amounts
  const AMOUNT_PATTERNS = [
    /([\d.,]+)\s*€/,
    /€\s*([\d.,]+)/,
    /total[:\s]*([\d.,]+)/i,
    /importe[:\s]*([\d.,]+)/i,
    /import[:\s]*([\d.,]+)/i,
    /amount[:\s]*([\d.,]+)/i,
  ];

  function extractInvoiceNumber(subject, filename) {
    const texts = [subject || '', filename || ''];
    for (const text of texts) {
      for (const pattern of INVOICE_NUM_PATTERNS) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const num = match[1].trim();
          // Filter out false positives (too short or all zeros)
          if (num.length >= 3 && !/^0+$/.test(num)) {
            return num;
          }
        }
      }
    }
    return '';
  }

  function extractAmount(subject, filename) {
    const text = (subject || '') + ' ' + (filename || '');
    for (const pattern of AMOUNT_PATTERNS) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return normalizeAmount(match[1]);
      }
    }
    return '';
  }

  function normalizeAmount(str) {
    // Handle European format: 1.234,56 → 1234.56
    // Handle US format: 1,234.56 → 1234.56
    let s = str.trim();

    // If has both . and , the last one is decimal separator
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');

    if (lastComma > lastDot) {
      // European: dots are thousands, comma is decimal
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (lastDot > lastComma) {
      // US/UK: commas are thousands, dot is decimal
      s = s.replace(/,/g, '');
    } else {
      // Only one separator
      s = s.replace(',', '.');
    }

    const num = parseFloat(s);
    return isNaN(num) ? '' : num.toFixed(2);
  }

  // Generate Hacienda-compliant filename
  // Format: YYYY-MM-DD_SUPPLIER_INVOICENUM_AMOUNT.ext
  function generateHaciendaName(date, supplier, invoiceNum, amount, originalFilename) {
    const ext = (originalFilename || 'document.pdf').split('.').pop().toLowerCase() || 'pdf';
    const parts = [];

    // Date
    parts.push(date || 'SENSE-DATA');

    // Supplier (clean)
    const cleanSupplier = (supplier || 'DESCONEGUT')
      .replace(/[^A-Z0-9\s]/gi, '')
      .replace(/\s+/g, '_')
      .substring(0, 30)
      .toUpperCase();
    parts.push(cleanSupplier);

    // Invoice number
    if (invoiceNum) {
      parts.push(invoiceNum.replace(/[\/\\:*?"<>|]/g, '_'));
    }

    // Amount
    if (amount) {
      parts.push(amount + '€');
    }

    let name = parts.join('_') + '.' + ext;
    // Clean any remaining invalid chars
    name = name.replace(/[\/\\:*?"<>|]/g, '_').replace(/__+/g, '_');
    return name;
  }

  // Parse a message into a structured invoice record
  function parseMessage(msg) {
    const invoices = [];

    for (const att of (msg.attachments || [])) {
      const invoiceNum = extractInvoiceNumber(msg.subject, att.filename);
      const amount = extractAmount(msg.subject, att.filename);
      const date = msg.parsedDate || '';

      const haciendaName = generateHaciendaName(
        date, msg.supplier, invoiceNum, amount, att.filename
      );

      invoices.push({
        messageId: msg.id,
        accountEmail: msg.accountEmail,
        from: msg.from,
        fromEmail: msg.fromEmail,
        subject: msg.subject,
        date: msg.date,
        parsedDate: date,
        supplier: msg.supplier,
        originalFilename: att.filename,
        attachmentId: att.attachmentId,
        mimeType: att.mimeType,
        size: att.size,
        invoiceNumber: invoiceNum,
        amount,
        haciendaName,
        source: msg.source || 'gmail',
        status: 'new',
        driveLink: '',
        dedupKey: generateDedupKey(msg.supplier, invoiceNum, amount, date, att.filename)
      });
    }

    return invoices;
  }

  // Generate a dedup key from invoice properties
  function generateDedupKey(supplier, invoiceNum, amount, date, filename) {
    const parts = [
      (supplier || '').toUpperCase().trim(),
      (invoiceNum || '').toUpperCase().trim(),
      (amount || '').trim(),
      (date || '').trim()
    ];

    // If no invoice number, fall back to filename
    if (!invoiceNum) {
      parts.push((filename || '').toLowerCase().trim());
    }

    return parts.filter(Boolean).join('|');
  }

  return { extractInvoiceNumber, extractAmount, generateHaciendaName, parseMessage, generateDedupKey };
})();
