(function () {
  'use strict';
  const form = document.getElementById('zcm-import-form');
  if (!form) return;
  const status = document.getElementById('zcm-import-status');
  const progress = document.getElementById('zcm-progress');
  const button = form.querySelector('button[type="submit"]');
  let busy = false;
  async function request(action, values) {
    const body = new FormData();
    body.append('action', action);
    body.append('nonce', zcmAdmin.nonce);
    Object.keys(values).forEach(function (key) { body.append(key, values[key]); });
    const response = await fetch(zcmAdmin.url, { method: 'POST', credentials: 'same-origin', body });
    if (response.status === 413) {
      const error = new Error('The server rejected this upload size. Try a smaller package or ask your administrator to check the upload limit.');
      error.status = 413;
      throw error;
    }
    let result;
    try { result = await response.json(); } catch (_) { throw new Error('The server returned an unexpected response (HTTP ' + response.status + '). Refresh this page and try again.'); }
    if (!response.ok || !result.success) throw new Error(result.data && result.data.message || 'The import failed. Please retry.');
    return result.data;
  }
  window.addEventListener('beforeunload', function (event) { if (busy) { event.preventDefault(); event.returnValue = ''; } });
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    const file = document.getElementById('zcm-file').files[0];
    if (!file || !/\.zip$/i.test(file.name) || file.size > zcmAdmin.maxBytes || !file.size) {
      status.textContent = 'Choose a ZIP file no larger than 256 MB.';
      return;
    }
    busy = true;
    button.disabled = true;
    progress.hidden = false;
    progress.value = 0;
    status.textContent = 'Preparing upload…';
    try {
      const session = await request('zcm_begin', { title: document.getElementById('zcm-title').value, entry: document.getElementById('zcm-entry').value, size: file.size });
      let chunkBytes = zcmAdmin.chunkBytes;
      for (let offset = 0; offset < file.size;) {
        const end = Math.min(offset + chunkBytes, file.size);
        let chunk;
        try {
          chunk = await request('zcm_chunk', { upload: session.upload, offset, chunk: file.slice(offset, end) });
        } catch (error) {
          // A 413 rejects the whole request before the chunk is stored.
          if (error.status === 413 && chunkBytes > 65536) {
            chunkBytes = Math.max(65536, Math.floor(chunkBytes / 2));
            status.textContent = 'Adjusting upload size for this server…';
            continue;
          }
          throw error;
        }
        if (chunk.received !== end) throw new Error('Upload verification failed. Please import again.');
        offset = end;
        progress.value = Math.round(offset / file.size * 90);
        status.textContent = 'Uploading package: ' + Math.round(offset / file.size * 100) + '%';
      }
      status.textContent = 'Checking and extracting package…';
      const result = await request('zcm_finish', { upload: session.upload });
      progress.value = 100;
      status.textContent = 'Module imported successfully (' + result.files + ' files). Refreshing your library…';
      busy = false;
      window.location.reload();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      button.disabled = false;
    }
  });
})();
