/**
 * Copies text to the clipboard and reports whether it really worked.
 *
 * - Uses the async Clipboard API when it exists and the page is a secure
 *   context, and awaits it (a rejected write is a failure, not a success).
 * - Falls back to a hidden textarea + document.execCommand('copy') for
 *   plain-HTTP admins where navigator.clipboard is undefined.
 * - Never throws.
 *
 * @param {string} text
 * @param {{navigator?: Navigator, document?: Document, window?: Window}} [env] - injectable for tests
 * @returns {Promise<boolean>} true only if the text was copied
 */
export const copyToClipboard = async (text, env = {}) => {
  if (typeof text !== 'string' || text.length === 0) return false;

  const win = env.window ?? (typeof window === 'undefined' ? undefined : window);
  const nav =
    env.navigator ?? win?.navigator ?? (typeof navigator === 'undefined' ? undefined : navigator);
  const doc =
    env.document ?? win?.document ?? (typeof document === 'undefined' ? undefined : document);

  const secure = win?.isSecureContext !== false;
  if (secure && typeof nav?.clipboard?.writeText === 'function') {
    try {
      await nav.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or document not focused: try the legacy path.
    }
  }

  return legacyCopy(text, doc);
};

/**
 * @param {string} text
 * @param {Document|undefined} doc
 * @returns {boolean}
 */
const legacyCopy = (text, doc) => {
  if (
    !doc?.body ||
    typeof doc.createElement !== 'function' ||
    typeof doc.execCommand !== 'function'
  ) {
    return false;
  }

  const textarea = doc.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';

  const activeElement = doc.activeElement;
  doc.body.appendChild(textarea);
  try {
    textarea.select();
    return doc.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    doc.body.removeChild(textarea);
    if (activeElement && typeof activeElement.focus === 'function') {
      try {
        activeElement.focus();
      } catch {
        // Focus restoration is best effort.
      }
    }
  }
};

export default copyToClipboard;
