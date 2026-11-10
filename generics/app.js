/* ============================================================
   App — UI wiring for the Generics Cleaner tool
   ============================================================ */

(() => {
  // State
  let resultWorkbook = null;
  let originalFileName = '';

  // DOM refs
  const uploadArea = document.getElementById('upload-area');
  const fileInput = document.getElementById('file-input');
  const progressSection = document.getElementById('progress-section');
  const progressLabel = document.getElementById('progress-label');
  const progressPct = document.getElementById('progress-pct');
  const progressBar = document.getElementById('progress-bar');
  const progressDetail = document.getElementById('progress-detail');
  const resultsSection = document.getElementById('results-section');
  const logContent = document.getElementById('log-content');
  const btnDownload = document.getElementById('btn-download');
  const btnReset = document.getElementById('btn-reset');

  // ---- Logging ----
  function addLogEntry(level, msg) {
    const time = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.className = 'log-entry ' + level;
    div.textContent = `[${time}] ${msg}`;
    logContent.insertBefore(div, logContent.firstChild);
  }

  // ---- Progress ----
  function showProgress(show) {
    progressSection.hidden = !show;
    if (show) {
      resultsSection.hidden = true;
      progressBar.style.width = '0%';
      progressPct.textContent = '0%';
      progressDetail.textContent = '';
    }
  }

  function updateProgress(label, pct) {
    const pctInt = Math.round(pct * 100);
    progressLabel.textContent = label;
    progressPct.textContent = pctInt + '%';
    progressBar.style.width = pctInt + '%';
  }

  // ---- File handling ----
  function handleFile(file) {
    if (!file) return;

    const name = file.name.toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
      alert('Només es permeten fitxers Excel (.xlsx, .xls)');
      return;
    }

    originalFileName = file.name.replace(/\.[^.]+$/, '');
    uploadArea.hidden = true;
    showProgress(true);
    addLogEntry('info', `Fitxer carregat: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        addLogEntry('info', 'Llegint Excel...');
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });

        addLogEntry('info', `Full: "${workbook.SheetNames[0]}", processant...`);

        // Run cleaner
        const result = Cleaner.process(workbook, (label, pct) => {
          updateProgress(label, pct);
        });

        // Show log entries from cleaner
        for (const entry of result.log) {
          addLogEntry(entry.level, entry.msg);
        }

        if (result.error) {
          alert('Error: ' + result.error);
          resetUI();
          return;
        }

        resultWorkbook = result.workbook;
        showResults(result.stats);

      } catch (err) {
        addLogEntry('error', 'Error processant: ' + err.message);
        alert('Error processant el fitxer: ' + err.message);
        resetUI();
      }
    };

    reader.readAsArrayBuffer(file);
  }

  // ---- Results ----
  function showResults(stats) {
    showProgress(false);
    progressSection.hidden = true;
    resultsSection.hidden = false;

    document.getElementById('stat-initial').textContent = stats.initial.toLocaleString();
    document.getElementById('stat-removed').textContent = stats.removed.toLocaleString();
    document.getElementById('stat-kept').textContent = stats.kept.toLocaleString();

    const breakdownList = document.getElementById('breakdown-list');
    breakdownList.innerHTML = '';

    const items = [
      ['Pas 1: Columnes personals eliminades', stats.personalCols],
      ['Pas 2: Parells venda/devolució', stats.step2_pairs],
      ['Regla 1: Cód.Disp. = Cód.Presc.', stats.step3_rule1],
      ['Regla 2: Conté "EFG"', stats.step3_rule2],
      ['Regla 3: 1a paraula igual', stats.step3_rule3],
      ['Regla 4: Substrs llista negra (prescrit)', stats.step3_rule4],
      ['Regla 5: Llista negra (descripció)', stats.step3_rule5],
      ['Regla 6: Llista negra (prescrit inici)', stats.step3_rule6],
    ];

    for (const [label, value] of items) {
      const div = document.createElement('div');
      div.className = 'breakdown-item';
      div.innerHTML = `<span class="label">${label}</span><span class="value">${value.toLocaleString()}</span>`;
      breakdownList.appendChild(div);
    }
  }

  // ---- Download ----
  function downloadResult() {
    if (!resultWorkbook) return;
    const fileName = `${originalFileName}_NETEJAT.xlsx`;
    XLSX.writeFile(resultWorkbook, fileName);
    addLogEntry('success', `Descarregat: ${fileName}`);
  }

  // ---- Reset ----
  function resetUI() {
    uploadArea.hidden = false;
    progressSection.hidden = true;
    resultsSection.hidden = true;
    resultWorkbook = null;
    originalFileName = '';
    fileInput.value = '';
  }

  // ---- Events ----
  uploadArea.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
  });
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    handleFile(file);
  });

  btnDownload.addEventListener('click', downloadResult);
  btnReset.addEventListener('click', resetUI);

  addLogEntry('info', 'Neteja Genèrics llest. Puja un Excel de Farmatic per començar.');
})();
