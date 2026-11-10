/* ============================================================
   Cleaner — Core logic for Farmatic generics cleaning
   Implements all rules from the net-farmacia-generics skill.
   All column lookups are BY HEADER NAME, never by index.
   ============================================================ */

const Cleaner = (() => {

  // ---------- Column name constants ----------
  const PERSONAL_COLS = ['Paciente', 'C.Cliente', 'Cliente', 'Receta'];

  const REQUIRED_COLS = [
    'Cód.Disp.', 'Descripción', 'Cód.Presc.', 'Descripción Prescrito',
    'Cant.', 'Importe', 'Vendedor', 'Maquina'
  ];

  // Columns used for pairing key (everything except Vendedor, Maquina, Cant., Importe)
  const PAIR_KEY_COLS = [
    'Fecha', 'Hora', 'CIP', 'Tratamiento',
    'Cód.Disp.', 'Descripción', 'Cód.Presc.', 'Descripción Prescrito',
    'T.A.', 'P.V.P', 'Fecha Ini.', 'Fecha Fin'
  ];

  // ---------- Blacklists ----------

  const SUBSTRING_BLACKLIST_PRESCRITO = [
    'pensa', 'sandoz', 'cipla', 'tobrabact', 'tobramicina', 'oedien',
    'liderfer', 'tecnigen', 'normon', 'qualigen', 'neuraxpharm', 'kern',
    'almus', 'stada', 'combix', 'tevagen', 'viatris', 'vir', 'cinfa',
    'ababor', 'cinfamed', 'solufos', 'alvita', 'gasa', 'uxa', 'aurovitas',
    'teva', 'ratio', 'ratiopharm', 'tarbis', 'ardine', 'alter', 'aristogen',
    'aristo', 'sun', 'krka', 'level', 'simvastatina', 'vagirux', 'mabo',
    'chamber', 'ciclochem', 'isdin', 'serra', 'clovate', 'dexametasona',
    'diazepan', 'dienogest', 'llorens', 'atorva', 'atorvastatina', 'zentiva',
    'gador', 'abamed', 'medicebran', 'tad', 'accord', 'ringo', 'sebiprox',
    'viso', 'tamsulosina', 'farmalider', 'zolpidem', 'bluefish', 'atenza',
    'concerta', 'azalia', 'cerazet', 'bimeox', 'lumigan', '476309',
    'bolsa orina', 'calcial d', 'calcio d isdin', 'calciumosteo', 'calodis',
    'cicloseb', 'ciclopirox', 'cosduo', 'cosopt', 'disnal', 'duokopt',
    'forxiga', 'edistride', 'linelle', 'loette', 'progeffik', 'seidigestan',
    'veriscal', 'bonesil', 'atovacuona', 'bolsas', 'catiolance'
  ];

  const STARTSWITH_BLACKLIST_DESCRIPCION = [
    'VIGAMOX 5 MG/ML COLIRIO 1 FRASCO SOLUCION 5 ML',
    'ACIDO FUSIDICO ISDIN 20 MG/G CREMA 15 G',
    'AMERIDE 5/50 MG 60 COMPRIMIDOS',
    'ARAVA 20 MG 30 COMPRIMIDOS RECUBIERTOS',
    'ATARAX 25 MG 50 COMPRIMIDOS RECUBIERTOS',
    'ATACAND PLUS FORTE 32/25 MG 28 COMPRIMIDOS',
    'BRINTELLIX 20 MG 28 COMPRIMIDOS RECUBIERTOS',
    'CO-DIOVAN 160/12.5 MG 28 COMPRIMIDOS RECUBIERTOS',
    'DELTIUS 25000 UI SOLUCION ORAL 4 FRASCOS UNIDOSIS 2.5 ML',
    'EBASTEL 10 MG 20 COMPRIMIDOS RECUBIERTOS',
    'EMCONCOR COR 5 MG 28 COMPRIMIDOS RECUBIERTOS',
    'FERPLEX 40 800 MG 20 VIALES BEBIBLES 15 ML',
    'FERROCUR 800 MG 20 VIALES BEBIBLES 15 ML',
    'IDEOS 1250 MG (500 MG CA)/400 UI 60 COMP MASTICABLES',
    'IMUNOCARE 50 MG/G CREMA 24 SOBRES 250 MG',
    'MUPIROCINA ISDIN 20 MG/G POMADA 30 G',
    'ORFIDAL 1 MG 50 COMPRIMIDOS',
    'PRISTIQ 100 MG 28 COMPRIMIDOS LIBERACION PROLONGADA',
    'PRISTIQ 50 MG 28 COMPRIMIDOS LIBERACION PROLONGADA',
    'RUBIFEN 20 MG 30 COMPRIMIDOS',
    'SARCOP 5% CREMA 70 G',
    'SYRON 300 MG (40 MG FE) 30 COMPRIMIDOS SOLUBLES',
    'SYRON 600 MG (80 MG FE) 15 SOBRES GRANULADO',
    'TARDYFERON 256.3 MG (80 MG FE) 30 COMP LIB PROLONGADADA',
    'XIGDUO 5/850 MG 56 COMPRIMIDOS RECUBIERTOS'
  ].map(s => s.toUpperCase());

  const STARTSWITH_BLACKLIST_PRESCRITO = [
    'AC ALENDR SEMANAL LIDERFARM 70MG 4 COM R',
    'AMOXICILINA/ACIDO CLAVULANICO 875 MG/125',
    'Desvenlafaxina 100 mg 28 comprimidos lib',
    'Desvenlafaxina 50 mg 28 comprimidos libe',
    'Ferrimanitol ovoalbúmina 80 mg solución/',
    'Hierro sulfato 80 mg 30 comprimidos',
    'LACTOFERRINA 40MG 20 VIALES BEBIBLES 15',
    'Lorazepam 1 mg 50 comprimidos',
    'Losartán/Hidroclorotiazida 50 mg/12,5 mg',
    'Metilfenidato 20 mg 30 comprimidos',
    'PANTOPRAZOL 20 MG 14 COMPRIMIDOS',
    'Pantoprazol 40 mg 28 comprimidos'
  ].map(s => s.toUpperCase());

  // ---------- Helpers ----------

  function cellStr(val) {
    if (val == null) return '';
    return String(val).trim();
  }

  function cellNum(val) {
    if (val == null) return 0;
    if (typeof val === 'number') return val;
    const s = String(val).replace(/[^\d.,-]/g, '').replace(',', '.');
    return parseFloat(s) || 0;
  }

  function firstWord(s) {
    const t = (s || '').trim();
    const sp = t.indexOf(' ');
    return sp === -1 ? t : t.substring(0, sp);
  }

  // Build a column name → index map from header row
  function mapHeaders(headerRow) {
    const map = {};
    for (let i = 0; i < headerRow.length; i++) {
      const name = cellStr(headerRow[i]);
      if (name) map[name] = i;
    }
    return map;
  }

  function getCol(row, colMap, name) {
    const idx = colMap[name];
    if (idx == null) return '';
    return row[idx];
  }

  function getColStr(row, colMap, name) {
    return cellStr(getCol(row, colMap, name));
  }

  function getColNum(row, colMap, name) {
    return cellNum(getCol(row, colMap, name));
  }

  // ---------- Main process ----------

  function process(workbook, onProgress) {
    const log = [];
    const addLog = (level, msg) => {
      log.push({ level, msg, time: new Date().toLocaleTimeString() });
    };

    // Get first sheet
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (data.length < 2) {
      addLog('error', 'El fitxer no té dades suficients.');
      return { error: 'No hi ha dades', log };
    }

    // Step 0: Map headers
    const headerRow = data[0];
    let colMap = mapHeaders(headerRow);

    addLog('info', `Capçaleres trobades: ${Object.keys(colMap).join(', ')}`);

    // Check required columns
    const missing = REQUIRED_COLS.filter(c => colMap[c] == null);
    if (missing.length > 0) {
      addLog('error', `Falten columnes requerides: ${missing.join(', ')}`);
      return { error: `Falten columnes: ${missing.join(', ')}`, log };
    }

    let rows = data.slice(1); // data rows only
    const initialCount = rows.length;
    addLog('info', `Files de dades: ${initialCount}`);

    if (onProgress) onProgress('Pas 0: Perfil completat', 0.05);

    // Step 1: Remove personal data columns
    const personalIndices = PERSONAL_COLS
      .map(c => colMap[c])
      .filter(i => i != null)
      .sort((a, b) => b - a); // reverse order so indices stay valid

    // Remove from header
    const newHeader = [...headerRow];
    for (const idx of personalIndices) {
      newHeader.splice(idx, 1);
    }
    // Remove from each row
    rows = rows.map(row => {
      const newRow = [...row];
      for (const idx of personalIndices) {
        newRow.splice(idx, 1);
      }
      return newRow;
    });

    // Recalculate column map
    colMap = mapHeaders(newHeader);

    const removedPersonalCols = personalIndices.length;
    addLog('success', `Pas 1: Eliminades ${removedPersonalCols} columnes personals (${PERSONAL_COLS.filter(c => headerRow.some((h, i) => cellStr(h) === c)).join(', ')})`);

    if (onProgress) onProgress('Pas 1: Columnes personals eliminades', 0.15);

    // Step 2: Cancel paired sale/return rows
    // Build key for each row using PAIR_KEY_COLS + abs(Cant) + abs(Importe)
    const pairMap = new Map(); // key → [{index, cantSign}]
    const removedStep2 = new Set();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const parts = [];
      for (const col of PAIR_KEY_COLS) {
        if (colMap[col] != null) {
          parts.push(cellStr(getCol(row, colMap, col)));
        }
      }
      const cant = getColNum(row, colMap, 'Cant.');
      const importe = getColNum(row, colMap, 'Importe');
      parts.push(String(Math.abs(cant)));
      parts.push(String(Math.abs(importe).toFixed(4)));
      const key = parts.join('||');
      const sign = cant >= 0 ? '+' : '-';

      if (!pairMap.has(key)) pairMap.set(key, []);
      pairMap.get(key).push({ index: i, sign });
    }

    // Within each group, pair + with - one by one
    for (const [, entries] of pairMap) {
      const positives = entries.filter(e => e.sign === '+');
      const negatives = entries.filter(e => e.sign === '-');
      const pairs = Math.min(positives.length, negatives.length);
      for (let p = 0; p < pairs; p++) {
        removedStep2.add(positives[p].index);
        removedStep2.add(negatives[p].index);
      }
    }

    addLog('success', `Pas 2: ${removedStep2.size} files anul·lades (${removedStep2.size / 2} parells venda/devolució)`);

    if (onProgress) onProgress('Pas 2: Parells anul·lats', 0.35);

    // Step 3: Remove rows by rules
    const removedStep3_rule1 = new Set();
    const removedStep3_rule2 = new Set();
    const removedStep3_rule3 = new Set();
    const removedStep3_rule4 = new Set();
    const removedStep3_rule5 = new Set();
    const removedStep3_rule6 = new Set();

    for (let i = 0; i < rows.length; i++) {
      if (removedStep2.has(i)) continue; // already removed

      const row = rows[i];
      const codDisp = getColStr(row, colMap, 'Cód.Disp.');
      const codPresc = getColStr(row, colMap, 'Cód.Presc.');
      const descripcio = getColStr(row, colMap, 'Descripción');
      const prescrit = getColStr(row, colMap, 'Descripción Prescrito');

      const descripcioUp = descripcio.toUpperCase();
      const prescritUp = prescrit.toUpperCase();

      // Rule 1: Cód.Disp. = Cód.Presc.
      if (codDisp && codPresc && codDisp === codPresc) {
        removedStep3_rule1.add(i);
        continue;
      }

      // Rule 2: "efg" in Descripción Prescrito
      if (prescritUp.includes('EFG')) {
        removedStep3_rule2.add(i);
        continue;
      }

      // Rule 3: First word of Descripción = first word of Descripción Prescrito
      const fw1 = firstWord(descripcioUp);
      const fw2 = firstWord(prescritUp);
      if (fw1 && fw2 && fw1 === fw2) {
        removedStep3_rule3.add(i);
        continue;
      }

      // Rule 4: Descripción Prescrito contains any blacklisted substring
      let matchedRule4 = false;
      for (const term of SUBSTRING_BLACKLIST_PRESCRITO) {
        if (prescritUp.includes(term.toUpperCase())) {
          matchedRule4 = true;
          break;
        }
      }
      if (matchedRule4) {
        removedStep3_rule4.add(i);
        continue;
      }

      // Rule 5: Descripción starts with any blacklisted string
      let matchedRule5 = false;
      for (const prefix of STARTSWITH_BLACKLIST_DESCRIPCION) {
        if (descripcioUp.startsWith(prefix)) {
          matchedRule5 = true;
          break;
        }
      }
      if (matchedRule5) {
        removedStep3_rule5.add(i);
        continue;
      }

      // Rule 6: Descripción Prescrito starts with any blacklisted string
      let matchedRule6 = false;
      for (const prefix of STARTSWITH_BLACKLIST_PRESCRITO) {
        if (prescritUp.startsWith(prefix)) {
          matchedRule6 = true;
          break;
        }
      }
      if (matchedRule6) {
        removedStep3_rule6.add(i);
        continue;
      }
    }

    const step3Total = removedStep3_rule1.size + removedStep3_rule2.size +
      removedStep3_rule3.size + removedStep3_rule4.size +
      removedStep3_rule5.size + removedStep3_rule6.size;

    addLog('success', `Pas 3: ${step3Total} files eliminades per regles`);
    addLog('info', `  Regla 1 (Cód.Disp.=Cód.Presc.): ${removedStep3_rule1.size}`);
    addLog('info', `  Regla 2 (conté "efg"): ${removedStep3_rule2.size}`);
    addLog('info', `  Regla 3 (1a paraula igual): ${removedStep3_rule3.size}`);
    addLog('info', `  Regla 4 (substrs prescrit): ${removedStep3_rule4.size}`);
    addLog('info', `  Regla 5 (llista negra descripció): ${removedStep3_rule5.size}`);
    addLog('info', `  Regla 6 (llista negra prescrit): ${removedStep3_rule6.size}`);

    if (onProgress) onProgress('Pas 3: Regles aplicades', 0.75);

    // Combine all removed indices
    const allRemoved = new Set([
      ...removedStep2,
      ...removedStep3_rule1,
      ...removedStep3_rule2,
      ...removedStep3_rule3,
      ...removedStep3_rule4,
      ...removedStep3_rule5,
      ...removedStep3_rule6
    ]);

    // Step 4: Build output
    const survivingRows = rows.filter((_, i) => !allRemoved.has(i));
    const finalCount = survivingRows.length;
    const totalRemoved = allRemoved.size;

    addLog('success', `Pas 4: ${finalCount} files conservades de ${initialCount} inicials (${totalRemoved} eliminades, ${((totalRemoved / initialCount) * 100).toFixed(1)}%)`);

    if (onProgress) onProgress('Completat!', 1.0);

    // Build output workbook
    const outputData = [newHeader, ...survivingRows];
    const newSheet = XLSX.utils.aoa_to_sheet(outputData);
    const newWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWorkbook, newSheet, sheetName || 'Netejat');

    return {
      workbook: newWorkbook,
      log,
      stats: {
        initial: initialCount,
        removed: totalRemoved,
        kept: finalCount,
        personalCols: removedPersonalCols,
        step2_pairs: removedStep2.size,
        step3_rule1: removedStep3_rule1.size,
        step3_rule2: removedStep3_rule2.size,
        step3_rule3: removedStep3_rule3.size,
        step3_rule4: removedStep3_rule4.size,
        step3_rule5: removedStep3_rule5.size,
        step3_rule6: removedStep3_rule6.size,
        step3_total: step3Total
      }
    };
  }

  return { process };
})();
