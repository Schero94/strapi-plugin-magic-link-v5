// Shared script for the Schero94 Strapi plugin documentation sites.
// Byte-identical in every plugin repository (docs/site/site.js), loaded with
// `defer`. It adds "Copy" buttons to code blocks and starts the "Used by" logo
// slider; the page works without it.
/* global window, document, navigator */

// "Used by" logo slider (.showcase-marquee, rendered by .github/scripts/showcase.mjs).
// The logos only move after this script has added the Pause button, so the motion
// can always be stopped (WCAG 2.2.2). Without JavaScript the logos stay a still
// row that scrolls sideways. site-extra.css holds the animation, the pause on
// hover and keyboard focus, and the still row for prefers-reduced-motion.
(() => {
  /** Slider speed in CSS pixels per second, the same for any number of logos. */
  const SPEED = 40;

  for (const slider of document.querySelectorAll('.showcase-marquee')) {
    const list = slider.querySelector('.showcase-list');
    if (!list) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'showcase-toggle';
    const label = document.createElement('span');
    const context = document.createElement('span');
    context.className = 'visually-hidden';
    context.textContent = ' the logo slider';
    button.append(label, context);

    /**
     * Pauses or resumes the slider and updates the button.
     * @param {boolean} paused Whether the logos stand still.
     */
    const setPaused = (paused) => {
      slider.classList.toggle('is-paused', paused);
      button.dataset.state = paused ? 'paused' : 'playing';
      label.textContent = paused ? 'Play' : 'Pause';
    };
    button.addEventListener('click', () => setPaused(!slider.classList.contains('is-paused')));
    // Keyboard focus stops the slider at its start and lets it scroll (site-extra.css);
    // bring a partly hidden logo fully into view, which browsers do not always do.
    slider.addEventListener('focusin', (event) => {
      if (event.target.matches(':focus-visible')) {
        event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    });
    setPaused(false);
    slider.before(button);

    /** Moves the logos only while one copy is wider than the strip, at a constant speed. */
    const update = () => {
      const moving = list.scrollWidth > slider.clientWidth;
      slider.classList.toggle('is-animated', moving);
      button.hidden = !moving;
      if (moving) {
        slider.style.setProperty('--showcase-duration', `${Math.round(list.scrollWidth / SPEED)}s`);
      }
    };
    update();
    if (window.ResizeObserver) new window.ResizeObserver(update).observe(slider);
  }
})();

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
