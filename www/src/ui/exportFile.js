import { t } from '../i18n/index.js';
import { CSV_BOM } from '../core/csv.js';
import { showToast } from './feedback.js';
import { isNative, nativePlugin } from './platform.js';

const CSV_TYPE = 'text/csv;charset=utf-8';
const CSV_BOM_PATTERN = new RegExp(`^${CSV_BOM}`);

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text.replace(CSV_BOM_PATTERN, ''));
    showToast(t('toast.csvCopied'), { tone: 'success' });
    return 'copied';
  } catch {
    showToast(t('toast.csvFailed'), { tone: 'warning' });
    return 'failed';
  }
}

function isCancel(error) {
  const message = String((error && (error.message || error.errorMessage)) || '').toLowerCase();
  return (error && error.name === 'AbortError') || message.includes('cancel');
}

async function shareNative(text, filename) {
  const filesystem = nativePlugin('Filesystem');
  const share = nativePlugin('Share');
  if (!filesystem || !share) return null;
  let uri = null;
  try {
    const written = await filesystem.writeFile({ path: filename, data: text.startsWith(CSV_BOM) ? text : CSV_BOM + text, directory: 'CACHE', encoding: 'utf8' });
    uri = written && written.uri;
  } catch {
    return null;
  }
  if (!uri) return null;
  try {
    await share.share({ title: filename, files: [uri], dialogTitle: t('report.shareTitle') });
    showToast(t('toast.csvShared'), { tone: 'success' });
    return 'shared';
  } catch (error) {
    return isCancel(error) ? 'cancelled' : null;
  } finally {
    filesystem.deleteFile({ path: filename, directory: 'CACHE' }).catch(() => {});
  }
}

export async function exportCsv(text, filename) {
  if (isNative()) {
    const result = await shareNative(text, filename);
    if (result) return result;
    return copyText(text);
  }
  try {
    downloadBlob(new Blob([text], { type: CSV_TYPE }), filename);
    showToast(t('toast.csvDownloaded'), { tone: 'success' });
    return 'downloaded';
  } catch {
    return copyText(text);
  }
}
