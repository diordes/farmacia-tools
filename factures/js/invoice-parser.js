/* ============================================================
   InvoiceParser — Extract invoice number, amount, generate
   Hacienda-compliant filenames
   ============================================================ */
const InvoiceParser = (() => {

  // Patterns for invoice numbers (subject + filename)
  const INVOICE_NUM_PATTERNS = [
    /(?:factura|fra|invoice|fv|nc|ab|n[ºo°]?\s*factura)[\s.:_#nº°-]*([A-Z0-9][\w\/-]{3,25})/i,
    /(?:nº|num|número|numero|n\.)[\s.:_-]*([A-Z0-9][\w\/-]{3,20})/i,
    /\b([A-Z]{1,4}[-\/]?\d{4,12})\b/,     // FV-2026001, NC260401
    /\b(\d{4,6}[-\/]\d{4,8})\b/,           // 2026/12345
  ];

  // Extra patterns for invoice numbers in email body (more specific to avoid false positives)
  const BODY_INVOICE_NUM_PATTERNS = [
    /(?:n(?:º|°|úmero|umero)?\.?\s*(?:de\s+)?factura|invoice\s*(?:no|number|#|num)|factura\s*(?:no|n[ºo°]|#|num))[\s.:_#nº°-]*([A-Z0-9][\w\/-]{3,25})/i,
    /(?:fra|fv|nc|ab)[\s.:_#-]*([A-Z0-9][\w\/-]{3,25})/i,
    /(?:documento|document|referencia|referència|ref)[\s.:_#-]*([A-Z0-9][\w\/-]{4,25})/i,
    /(?:su factura|la factura|your invoice|invoice)\s+(?:n[ºo°.]?\s*)?([A-Z0-9][\w\/-]{3,25})/i,
    /\b([A-Z]{1,4}[-\/]\d{4,12})\b/,       // FV-2026001 (require dash/slash in body)
  ];

  // Patterns for amounts (subject + filename)
  const AMOUNT_PATTERNS = [
    /([\d.,]+)\s*€/,
    /€\s*([\d.,]+)/,
    /total[:\s]*([\d.,]+)/i,
    /importe[:\s]*([\d.,]+)/i,
    /import[:\s]*([\d.,]+)/i,
    /amount[:\s]*([\d.,]+)/i,
  ];

  // Extra patterns for amounts in email body (require label to avoid random numbers)
  const BODY_AMOUNT_PATTERNS = [
    /(?:total\s*(?:factura|fra|invoice|general|iva\s*incl[oòó]s|a\s*pagar|document)?)[\s.:]*?([\d.,]+)\s*€/i,
    /(?:total\s*(?:factura|fra|invoice|general|iva\s*incl[oòó]s|a\s*pagar|document)?)[\s.:]*?€\s*([\d.,]+)/i,
    /(?:importe\s*total|import\s*total|montant\s*total|grand\s*total|net\s*a\s*pagar)[\s.:]*?([\d.,]+)\s*€?/i,
    /(?:base\s*imponible|base\s*imposable|subtotal)[\s.:]*?([\d.,]+)\s*€?/i,
    /(?:total\s*iva\s*incl)[\s.:]*?([\d.,]+)\s*€?/i,
    /([\d.,]+)\s*€\s*(?:\(?iva\s*incl|\(?total)/i,
  ];

  function extractInvoiceNumber(subject, filename, bodyText) {
    // First try subject and filename with standard patterns
    const texts = [subject || '', filename || ''];
    for (const text of texts) {
      for (const pattern of INVOICE_NUM_PATTERNS) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const num = match[1].trim();
          if (num.length >= 3 && !/^0+$/.test(num)) {
            return num;
          }
        }
      }
    }

    // Then try body text with more specific patterns
    if (bodyText) {
      for (const pattern of BODY_INVOICE_NUM_PATTERNS) {
        const match = bodyText.match(pattern);
        if (match && match[1]) {
          const num = match[1].trim();
          if (num.length >= 3 && !/^0+$/.test(num) && !/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(num)) {
            return num;
          }
        }
      }
    }

    return '';
  }

  function extractAmount(subject, filename, bodyText) {
    // First try subject and filename
    const text = (subject || '') + ' ' + (filename || '');
    for (const pattern of AMOUNT_PATTERNS) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return normalizeAmount(match[1]);
      }
    }

    // Then try body text with labeled patterns (avoid random numbers)
    if (bodyText) {
      for (const pattern of BODY_AMOUNT_PATTERNS) {
        const match = bodyText.match(pattern);
        if (match && match[1]) {
          const amt = normalizeAmount(match[1]);
          // Sanity check: skip amounts that are obviously wrong (0 or > 1M)
          if (amt && parseFloat(amt) > 0 && parseFloat(amt) < 1000000) {
            return amt;
          }
        }
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
      const invoiceNum = extractInvoiceNumber(msg.subject, att.filename, msg.bodyText);
      const amount = extractAmount(msg.subject, att.filename, msg.bodyText);
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
