/* ============================================================
   DriveService — Upload and organize files in Google Drive
   ============================================================ */
const DriveService = (() => {

  // Cache folder IDs to avoid repeated lookups
  const folderCache = {};

  // Get or create the root folder
  async function getRootFolder(email) {
    const folderName = Config.get('driveFolderName') || 'Factures_Comptabilitat';
    return await getOrCreateFolder(email, folderName, 'root');
  }

  // Get or create a subfolder (e.g., per supplier)
  async function getSupplierFolder(email, supplierName) {
    const rootId = await getRootFolder(email);
    return await getOrCreateFolder(email, supplierName, rootId);
  }

  // Get or create a folder by name under a parent
  async function getOrCreateFolder(email, name, parentId) {
    const cacheKey = `${email}:${parentId}:${name}`;
    if (folderCache[cacheKey]) return folderCache[cacheKey];

    if (!Auth.useAccount(email)) {
      throw new Error('Token no disponible per ' + email);
    }

    // Search for existing folder
    const query = `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;

    const resp = await gapi.client.drive.files.list({
      q: query,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    if (resp.result.files && resp.result.files.length > 0) {
      folderCache[cacheKey] = resp.result.files[0].id;
      return resp.result.files[0].id;
    }

    // Create folder
    const createResp = await gapi.client.drive.files.create({
      resource: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId]
      },
      fields: 'id'
    });

    folderCache[cacheKey] = createResp.result.id;
    AppLog.info(`[Drive] Carpeta creada: ${name}`);
    return createResp.result.id;
  }

  // Upload a file to Drive
  async function uploadFile(email, folderId, fileName, data, mimeType) {
    if (!Auth.useAccount(email)) {
      throw new Error('Token no disponible per ' + email);
    }

    const account = Auth.loadAccounts()[email];
    const token = account.accessToken;

    // Use multipart upload for files
    const metadata = {
      name: fileName,
      parents: [folderId],
      mimeType: mimeType || 'application/pdf'
    };

    const boundary = '---factures_tool_boundary---';
    const delimiter = '\r\n--' + boundary + '\r\n';
    const closeDelimiter = '\r\n--' + boundary + '--';

    // Convert Uint8Array to base64
    let base64Data;
    if (data instanceof Uint8Array) {
      let binary = '';
      for (let i = 0; i < data.length; i++) {
        binary += String.fromCharCode(data[i]);
      }
      base64Data = btoa(binary);
    } else {
      base64Data = btoa(data);
    }

    const body =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: ' + (mimeType || 'application/pdf') + '\r\n' +
      'Content-Transfer-Encoding: base64\r\n\r\n' +
      base64Data +
      closeDelimiter;

    const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'multipart/related; boundary=' + boundary
      },
      body
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error('Upload failed: ' + err);
    }

    const result = await resp.json();
    return {
      fileId: result.id,
      webViewLink: result.webViewLink
    };
  }

  // Check if a file already exists in a folder (for dedup)
  async function fileExists(email, folderId, fileName) {
    if (!Auth.useAccount(email)) return false;

    const query = `name='${fileName.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`;
    const resp = await gapi.client.drive.files.list({
      q: query,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    return resp.result.files && resp.result.files.length > 0;
  }

  // List all files in the root folder (for dedup across all suppliers)
  async function listAllInvoices(email) {
    const rootId = await getRootFolder(email);
    if (!Auth.useAccount(email)) return [];

    const files = [];
    let pageToken = null;

    do {
      const resp = await gapi.client.drive.files.list({
        q: `'${rootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'nextPageToken, files(id, name)',
        spaces: 'drive',
        pageToken: pageToken || undefined
      });

      const folders = resp.result.files || [];
      pageToken = resp.result.nextPageToken;

      // List files in each subfolder
      for (const folder of folders) {
        let subToken = null;
        do {
          const subResp = await gapi.client.drive.files.list({
            q: `'${folder.id}' in parents and trashed=false`,
            fields: 'nextPageToken, files(id, name, createdTime, size)',
            spaces: 'drive',
            pageToken: subToken || undefined
          });

          for (const f of (subResp.result.files || [])) {
            files.push({
              ...f,
              supplierFolder: folder.name
            });
          }
          subToken = subResp.result.nextPageToken;
        } while (subToken);
      }
    } while (pageToken);

    return files;
  }

  function clearCache() {
    Object.keys(folderCache).forEach(k => delete folderCache[k]);
  }

  return { getRootFolder, getSupplierFolder, uploadFile, fileExists, listAllInvoices, clearCache };
})();
