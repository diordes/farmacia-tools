/* ============================================================
   Suppliers — Known supplier email→name mapping
   ============================================================ */
const Suppliers = (() => {
  const STORAGE_KEY = 'factures_tool_suppliers';

  // Default suppliers from the pharmacy's known senders
  const DEFAULTS = {
    'contabilidad@pranarom.com': 'PRANAROM',
    'administracio@hecal.es': 'HECAL',
    'facturasprim@prim.es': 'PRIM',
    'sis-farma@sis-farma.com': 'SISFARMA',
    'facturas@lersaenergia.com': 'LERSA',
    'no-reply-misfacturasadt@adt.com.es': 'ADT',
    'clientes@stada.es': 'STADA',
    'atclien.css@almirall.com': 'ALMIRALL',
    'josefina.castellano@svr.com': 'SVR',
    'pilar.planellas@svr.com': 'SVR',
    'angels.grau@svr.com': 'SVR',
    'facturacion@normon.com': 'NORMON',
    'admin@finestres.com': 'FINESTRES.COM',
    'clientes@dentaid.es': 'DENTAID',
    'no-reply@alliance-healthcare.es': 'ALLIANCE HEALTHCARE',
    'facturacionesp@nuxe.com': 'NUXE',
    'serviciogestion@es.naos.com': 'NAOS',
    'clientes@faes.es': 'FAES',
    'factura@sakai-laboratorios.com': 'SAKAI',
    'info@fedefarma.com': 'FEDEFARMA',
    'facturacion@kern-pharma.com': 'KERN',
    'soporte@livepierrefabre.es': 'PIERRE FABRE',
    'info@climahogarbcn.com': 'CLIMA HOGAR BCN',
    'no-reply@eu.holded.com': 'GUARRO ARAGON CB',
    'info@faramahuman.com': 'FARAMA HUMAN',
    'noreply@oriolcerda.com': 'ORIOL CERDÀ',
    'facturacion@movistar.es': 'TELEFONICA',
    'info@email.o2online.es': 'TELEFONICA (O2)',
    'atencioclient@info.aiguesdebarcelona.cat': 'AIGUES DE BARCELONA',
    'conta@lec-economistas.com': 'LEC ECONOMISTAS',
    'facturacion@boehringer-ingelheim.com': 'BOEHRINGER',
    'facturas@laboratoriosferrer.com': 'FERRER INTERNACIONAL',
    'facturacion@boiron.es': 'BOIRON',
    'soporte@leti.com': 'LETI',
    'no-reply@amazon.es': 'AMAZON',
    'serviciocliente.es@laboratoire-native.com': 'LABORATOIRE NATIVE',
    'fatture-noreply@aboca.es': 'ABOCA',
    'ad_sap_pharma@logista.com': 'LOGISTA',
    'facturacion@brillpharma.com': 'BRILLPHARMA',
    'facturacion@lacer.es': 'LACER',
    'factures@fefac.cat': 'FEFAC',
    'facturas@carbovital.com': 'CARBOVITAL',
    'facturacion@dondominio.com': 'DONDOMINIO',
    'administracion@biobatch.net': 'BIOBATCH',
    'concepcion.garcia@cencora.es': 'CENCORA',
    'notificaciones.sap@manusa.com': 'MANUSA',
    'salafarmasl@gmail.com': 'SALAFARMACIA',
    'carlamarin@arcoabogados.es': 'ARCO ABOGADOS',
  };

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function save() {
    const textarea = document.getElementById('input-suppliers');
    if (!textarea) return;
    try {
      const custom = JSON.parse(textarea.value);
      const merged = { ...DEFAULTS, ...custom };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      AppLog.info('Proveïdors guardats: ' + Object.keys(merged).length);
      alert('✅ Proveïdors guardats!');
    } catch (e) {
      alert('❌ JSON invàlid. Format: {"email@example.com": "NOM", ...}');
    }
  }

  function resolve(email) {
    const map = load();
    const key = (email || '').toLowerCase().trim();
    return map[key] || null;
  }

  function normalizeFromHeader(fromStr) {
    // Extract name from "Name <email>" format
    let name = fromStr.replace(/<[^>]+>/, '').replace(/"/g, '').trim();
    if (!name) {
      const emailMatch = fromStr.match(/<([^>]+)>/);
      const email = emailMatch ? emailMatch[1] : fromStr;
      name = email.split('@')[0].replace(/[._-]/g, ' ');
    }
    return name.toUpperCase().substring(0, 50).replace(/\s+/g, ' ').trim();
  }

  function getSupplierName(email, fromHeader) {
    return resolve(email) || normalizeFromHeader(fromHeader || email);
  }

  function populateUI() {
    const textarea = document.getElementById('input-suppliers');
    if (textarea) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const custom = raw ? JSON.parse(raw) : {};
        // Only show custom additions (not defaults)
        const customOnly = {};
        for (const [k, v] of Object.entries(custom)) {
          if (!DEFAULTS[k] || DEFAULTS[k] !== v) {
            customOnly[k] = v;
          }
        }
        textarea.value = Object.keys(customOnly).length > 0
          ? JSON.stringify(customOnly, null, 2)
          : JSON.stringify({}, null, 2);
      } catch {
        textarea.value = '{}';
      }
    }
  }

  function addSupplier(email, name) {
    const map = load();
    map[email.toLowerCase().trim()] = name.toUpperCase().trim();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  }

  return { load, save, resolve, getSupplierName, normalizeFromHeader, populateUI, addSupplier };
})();
