/* ============================================================
   Upload — Handle manual PDF upload (drag & drop)
   ============================================================ */
const Upload = (() => {

  function handleDragOver(event) {
    event.preventDefault();
    event.currentTarget.classList.add('dragover');
  }

  function handleDragLeave(event) {
    event.currentTarget.classList.remove('dragover');
  }

  function handleDrop(event) {
    event.preventDefault();
    event.currentTarget.classList.remove('dragover');

    const files = [...event.dataTransfer.files].filter(f => {
      const name = f.name.toLowerCase();
      return name.endsWith('.pdf') || name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.xml');
    });

    if (files.length === 0) {
      alert('Només es permeten fitxers PDF, Excel o XML.');
      return;
    }

    promptAndUpload(files);
  }

  function handleFiles(event) {
    const files = [...event.target.files];
    if (files.length === 0) return;
    promptAndUpload(files);
    event.target.value = ''; // Reset input
  }

  function promptAndUpload(files) {
    const supplier = prompt(
      `Has seleccionat ${files.length} fitxer(s).\n\nNom del proveïdor (per organitzar a Drive):`,
      'AMAZON'
    );
    if (supplier === null) return;

    Processor.uploadManualFiles(files, supplier.toUpperCase().trim() || 'MANUAL');
  }

  return { handleDragOver, handleDragLeave, handleDrop, handleFiles };
})();
