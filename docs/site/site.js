// Shared script for the Schero94 Strapi plugin documentation sites.
// Byte-identical in every plugin repository (docs/site/site.js), loaded with
// `defer`. It only adds "Copy" buttons to code blocks; the page works without it.
/* global window, document, navigator */
(() => {
  if (!navigator.clipboard || !window.isSecureContext) return;

  /**
   * Adds a copy button that copies the text of `source` to the clipboard.
   * @param {HTMLElement} host Element that receives the button.
   * @param {HTMLElement} source Element whose text is copied.
   * @param {string} label Accessible name, for example "Copy install command".
   */
  const addButton = (host, source, label) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-button';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', label);
    const status = document.createElement('span');
    status.className = 'visually-hidden';
    status.setAttribute('role', 'status');
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(source.innerText.trim());
        button.textContent = 'Copied';
        status.textContent = 'Copied to the clipboard';
      } catch {
        button.textContent = 'Select and copy';
        status.textContent = 'Copy failed. Select the text and copy it.';
      }
      window.setTimeout(() => {
        button.textContent = 'Copy';
        status.textContent = '';
      }, 2000);
    });
    host.append(button, status);
  };

  for (const card of document.querySelectorAll('.code-card')) {
    const code = card.querySelector('pre');
    if (!code) continue;
    let label = card.querySelector('.code-label');
    if (!label) {
      label = document.createElement('div');
      label.className = 'code-label';
      label.append(document.createElement('span'));
      card.prepend(label);
    }
    const name = label.textContent.trim();
    addButton(label, code, name ? `Copy code: ${name}` : 'Copy code');
  }

  for (const line of document.querySelectorAll('.hero-install, .install-line')) {
    const code = line.querySelector('code') || line;
    if (line.tagName === 'CODE') {
      // Wrap a bare <code class="hero-install"> so the button sits beside the command.
      const wrap = document.createElement('span');
      wrap.className = line.className;
      line.className = '';
      line.replaceWith(wrap);
      wrap.append(line);
      addButton(wrap, line, 'Copy install command');
    } else {
      addButton(line, code, 'Copy install command');
    }
  }
})();
