// Balcony platform toolbar - the edit/preview chrome shared by EVERY template.
//
// A template mounts this once with a small contract (see window.BalconyToolbar
// .mount below); the platform owns everything generic and template-agnostic:
//   - the one bar across edit + preview, in its four states (trial/host ×
//     edit/preview)
//   - the buy modal and the commerce ?buy= / pricing URL params
//   - the finalize / share / upsell modal
//   - edit ⇄ preview navigation, carrying the trial + commerce params along
//
// The template keeps only what's genuinely its own: its editable fields and how
// it persists them. It hands us `save()`, `reset()`, `finalize()` and (for the
// host-editor iframe) `platformHash()`, and we drive the chrome around them.
//
// This file is served from /templates/_platform/ and included by each template's
// index.html BEFORE its own script, so window.BalconyToolbar exists when the
// template calls mount().
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));

  // ---- Commerce params (generic across templates) -------------------------
  // The buy modal's data - the checkout URL, the template's name/category and
  // the invitation's price - is fetched from TemplateController::meta on load
  // rather than read from the URL, so the trial URL stays clean (just ?trial=1
  // + mode) and the checkout URL / price never sit in the address bar. The
  // checkout URL comes straight from our own /try/<slug>/meta endpoint (a
  // server route), so it's inherently same-origin and trusted - no sanitising
  // needed.
  let buyUrl = '';
  let buyMeta = {};
  let dashboardUrl = ''; // signed-in visitor's home (host/admin); '' when logged out
  let metaPromise = null;

  // Fetch once, keyed by the slug already in the path (/templates/<slug>/...).
  function ensureMeta() {
    if (metaPromise) return metaPromise;
    const slug = (location.pathname.match(/\/templates\/([^/]+)\//) || [])[1];
    if (!slug) return (metaPromise = Promise.resolve());

    metaPromise = fetch('/try/' + slug + '/meta', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (!m) return;
        buyUrl = m.checkoutUrl || '';
        dashboardUrl = m.dashboardUrl || '';
        buyMeta = {
          name: m.name || '',
          category: m.category || '',
          priceLabel: m.priceLabel || '',
          // Struck-through pre-discount price - null/absent unless a
          // discount is currently active, which is exactly when it renders.
          originalLabel: m.originalLabel || '',
          discountPercent: m.discountPercent || 0,
          // What the invitation itself comes with, and the optional
          // personalization tiers that can be bought later.
          includes: Array.isArray(m.includes) ? m.includes : [],
          addOns: Array.isArray(m.addOns) ? m.addOns : [],
          // The "no add-on" tier key and the guests it covers, named by the
          // server so nothing here has to hardcode a server constant.
          includedTier: m.includedTier || 'included',
          includedGuests: m.includedGuests || 0,
          // Every total the add-on choice can produce, keyed by tier. The
          // modal picks a label out of this rather than adding up money
          // itself - the server formats currency, here as everywhere.
          totals: (m.totals && typeof m.totals === 'object') ? m.totals : {},
          // Admin-managed buy-modal FAQs (below the invitation panel).
          faqsEnabled: !!m.faqsEnabled,
          faqs: Array.isArray(m.faqs) ? m.faqs : [],
        };
        renderHome(); // the bar is already up; fill in the Dashboard link now
      })
      .catch(() => { /* offline / not listed - buy modal just shows blanks */ });

    return metaPromise;
  }

  // ---- Copy (a template may override any of these via mount({labels})) -----
  const DEFAULT_LABELS = {
    editTrial: 'Try editing - make it yours',
    editHost: 'Editing your invitation',
    previewTrial: 'This is what your guests will see',
    previewHost: 'Previewing your invitation',
  };

  // ---- Buy modal ----------------------------------------------------------
  // There is ONE invitation product, so the invitation itself is never chosen
  // between: the modal shows what it is and what it includes, then a single
  // Buy. The one thing a shopper picks here is how many guests they want to
  // personalize - the same optional add-on the checkout page offers, in the
  // same order (above the total, preselected to nothing). Picking it here just
  // carries the choice to checkout in the URL; nothing is charged until there.
  //
  // '' means the included tier, i.e. no add-on. Module-level rather than
  // per-render so reopening the modal keeps whatever the shopper last chose.
  let buyTier = '';

  function buyModalHtml() {
    // The invitation's own price, and the struck-through/badge pair that
    // describe ITS discount - all three belong to the panel below and are
    // unaffected by any add-on.
    const price = buyMeta.priceLabel || '';
    const priceOriginal = buyMeta.originalLabel || '';

    // The total is the invitation plus whatever add-on is currently picked,
    // read out of the server's precomputed map. Reopening the modal after a
    // choice therefore paints the right total straight away, with nothing for
    // syncBuyModal() to correct.
    const tier = buyTier || buyMeta.includedTier;
    const total = buyMeta.totals[tier] || price;

    // Both of these measure the INVITATION, so they only stand beside the
    // total while the total IS the invitation. They are still RENDERED when an
    // add-on is picked, just hidden - syncBuyModal() toggles the same display
    // when the choice changes, and it can only bring back an element that is
    // actually there to bring back.
    const hideForAddOn = buyTier ? ' style="display:none"' : '';
    const discountBadge = buyMeta.discountPercent
      ? '<span class="buy-discount-badge"' + hideForAddOn + '>' + buyMeta.discountPercent + '% OFF</span>' : '';

    // The invitation's own price as its OWN line, shown only once an add-on
    // is picked. The comment on `card` above explains why it is not ALWAYS
    // shown: with no add-on, Total IS the invitation price and a second copy
    // of the same number reads as a question ("which one am I paying?"), not
    // a reassurance. The moment an add-on joins the total, that stops being
    // true - Total is now two numbers added together, and a shopper cannot
    // see that sum unless the invitation's own share of it is named
    // somewhere. This is the exact inverse of hideForAddOn, for exactly that
    // reason: it shows precisely when the discount badge/strike-through hide.
    const showForAddOn = buyTier ? '' : ' style="display:none"';
    const breakdown =
      '<div class="buy-modal__breakdown"' + showForAddOn + '>' +
      '<span>Template</span>' +
      '<span class="buy-modal__breakdown-amt">' + esc(price) + '</span>' +
      '</div>';

    const includes = (buyMeta.includes || [])
      .map((pt) => '<span class="buy-plan__point">' + esc(pt) + '</span>').join('');

    // One panel, not a radio group - the shopper is confirming the invitation,
    // not choosing between two things.
    //
    // It carries what the invitation includes and nothing else. The price used
    // to sit up here as well, repeating the identical pair of numbers the
    // TOTAL shows a few hundred pixels below - and the two only ever differ
    // once an add-on is picked, which is exactly when a second price is a
    // question ("which one am I paying?") rather than a reassurance. The
    // tagline went with it: "Beautiful, interactive and ready to share with
    // everyone" is the first two bullets in different words.
    const card =
      '<div class="buy-plan is-selected">' +
      '<span class="buy-plan__body">' +
      '<span class="buy-plan__name">Your Invitation</span>' +
      '<span class="buy-plan__points">' + includes + '</span>' +
      '</span></div>';

    // The add-on picker. Three options, "Not now" first and selected by
    // default, so choosing nothing is something the shopper can SEE they have
    // already done rather than an absence they have to infer. Kept in the same
    // shape and order as the checkout page's picker, since a shopper who picks
    // here meets it again there with their choice already made.
    // One line each: the label and the price say the whole thing. The
    // per-option sentence underneath ("Personalize invitations for up to 50
    // guests" under a heading that reads "50 Guests") restated its own label,
    // and cost three lines of the modal to do it.
    const option = (tier, name, price, priceClass) => {
      const on = (buyTier || buyMeta.includedTier) === tier;
      return '<button type="button" class="buy-addon' + (on ? ' is-selected' : '') + '"' +
        ' role="radio" aria-checked="' + (on ? 'true' : 'false') + '"' +
        ' data-action="addon-select" data-tier="' + esc(tier) + '">' +
        '<span class="buy-addon__mark" aria-hidden="true"></span>' +
        '<span class="buy-addon__name">' + esc(name) + '</span>' +
        '<span class="buy-addon__price' + (priceClass ? ' ' + priceClass : '') + '">' + esc(price) + '</span>' +
        '</button>';
    };

    // The lead has one job: DEFINE the thing being sold. "Personalized guest"
    // is our word, not the shopper's, and the options below ("50 Guests",
    // "Unlimited") are unreadable until it means something - counting what,
    // exactly? The contrast against the common link is what makes it land in
    // one sentence, since the common link is the part they already grasp.
    //
    // How many come free is deliberately NOT repeated here - it is on the
    // includes list directly above.
    const addOns = (buyMeta.addOns && buyMeta.addOns.length)
      ? '<div class="buy-addons">' +
        '<div class="buy-addons__title">Want to greet guests by name?</div>' +
        '<p class="buy-addons__lead">Everyone opens the same invitation link. A personalized guest ' +
        'gets their own instead, which opens with their name on it. Add more now, or anytime ' +
        'later from your dashboard.</p>' +
        '<div class="buy-addons__list" role="radiogroup" aria-label="Personalized guests">' +
        option(buyMeta.includedTier, 'Not now', '₹0', 'buy-addon__price--free') +
        buyMeta.addOns.map((a) =>
          option(a.tier, a.label, '+' + a.priceLabel)
        ).join('') +
        '</div>' +
        '</div>'
      : '';

    // Admin-managed FAQ accordion (only when the section is enabled and has items).
    const faqs = (buyMeta.faqsEnabled && Array.isArray(buyMeta.faqs) && buyMeta.faqs.length)
      ? '<div class="buy-faqs">' +
        '<div class="buy-faqs__title">Frequently asked</div>' +
        buyMeta.faqs.map((f) =>
          '<div class="buy-faq">' +
          '<button type="button" class="buy-faq__q" data-action="faq-toggle" aria-expanded="false">' +
          '<span>' + esc(f.q) + '</span>' +
          '<svg class="buy-faq__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
          '</button>' +
          '<div class="buy-faq__a">' + esc(f.a) + '</div>' +
          '</div>'
        ).join('') +
        '</div>'
      : '';

    // The add-on picker sits ABOVE the total, not below the Buy button where
    // the note used to live: it changes the total, and nothing that changes a
    // number may sit underneath it.
    return (
      '<div class="buy-modal">' +
      (buyMeta.category ? '<div class="buy-modal__eyebrow">' + esc(buyMeta.category) + '</div>' : '') +
      '<h3>' + esc(buyMeta.name || 'This template') + '</h3>' +
      '<div class="buy-modal__plans">' + card + '</div>' +
      addOns +
      breakdown +
      '<div class="buy-modal__total"><span>Total</span><span class="buy-modal__total-wrap">' +
      (priceOriginal ? '<span class="buy-modal__total-original"' + hideForAddOn + '>' + esc(priceOriginal) + '</span>' : '') +
      '<span class="buy-modal__total-amt">' + esc(total) + '</span>' +
      discountBadge +
      '</span></div>' +
      '<div class="edit-modal__actions">' +
      '<button class="edit-btn" type="button" data-action="modal-close">Cancel</button>' +
      '<button class="edit-btn edit-btn--primary" type="button" data-action="buy-confirm">Proceed to Buy</button>' +
      '</div>' +
      faqs +
      '</div>'
    );
  }

  /**
   * Repaints the open buy modal from buyTier: which option reads as selected,
   * and what the total says.
   *
   * The struck-through price and the % badge describe the INVITATION's own
   * discount, so they are hidden once an add-on is in the total - the add-on
   * is never discounted, and leaving them up would claim a saving against a
   * number they were never measured from.
   */
  function syncBuyModal() {
    const modal = document.querySelector('.buy-modal');
    if (!modal) return;

    const tier = buyTier || buyMeta.includedTier;

    modal.querySelectorAll('.buy-addon').forEach((el) => {
      const on = el.dataset.tier === tier;
      el.classList.toggle('is-selected', on);
      el.setAttribute('aria-checked', on ? 'true' : 'false');
    });

    const amount = modal.querySelector('.buy-modal__total-amt');
    if (amount && buyMeta.totals[tier]) amount.textContent = buyMeta.totals[tier];

    const strike = modal.querySelector('.buy-modal__total-original');
    const badge = modal.querySelector('.buy-modal__total .buy-discount-badge');
    [strike, badge].forEach((el) => { if (el) el.style.display = buyTier ? 'none' : ''; });

    // Exact inverse of the pair above - see the comment on `breakdown` in
    // buyModalHtml() for why. The row's own amount never changes (it is
    // always the invitation's own price, not the total), so only its
    // visibility needs updating here.
    const breakdown = modal.querySelector('.buy-modal__breakdown');
    if (breakdown) breakdown.style.display = buyTier ? '' : 'none';
  }

  // ---- Modal + overflow popover (generic chrome) --------------------------
  function openModal(html, boxClass) {
    closeModal();
    const m = document.createElement('div');
    m.className = 'edit-modal';
    m.innerHTML = '<div class="edit-modal__overlay" data-action="modal-close"></div>' +
      '<div class="edit-modal__box' + (boxClass ? ' ' + boxClass : '') + '">' + html + '</div>';
    document.body.appendChild(m);
  }

  function closeModal() {
    const m = document.querySelector('.edit-modal');
    if (m) m.remove();
  }

  // ---- The contract the mounted template fills ----------------------------
  // { mode, trial, platform, save(), reset(), finalize(), platformHash(), labels }
  let tpl = null;

  const labels = () => Object.assign({}, DEFAULT_LABELS, tpl.labels || {});

  const shareUrl = () => location.origin !== 'null'
    ? location.origin + location.pathname
    : location.href.split('?')[0];

  // Only the trial flag (and planNotice) must ride along through every edit ⇄
  // preview navigation - drop trial and the shopper's next click would hand
  // them the FULL editor. The buy/pricing data isn't here any more: it's
  // re-fetched from meta() on each load, keyed by the unchanging slug in the path.
  function carriedQS() {
    if (!tpl.trial) return '';
    return '&trial=1' + (params.has('planNotice') ? '&planNotice=1' : '');
  }

  // In the host-editor iframe the template re-encodes the event payload into the
  // URL hash so in-progress edits survive the edit ⇄ preview page change.
  function navigate(mode) {
    const hash = tpl.platformHash ? tpl.platformHash() : '';
    location.href = location.pathname + '?' + mode + '=1' + carriedQS() + hash;
  }

  // ---- Generic actions ----------------------------------------------------
  const actions = {
    // Flush the save BEFORE navigating away - trial saves are async (server),
    // so the page reload on preview could otherwise race ahead of the last edit.
    'preview': () => { Promise.resolve(tpl.save()).then(() => navigate('preview')); },
    'back-to-edit': () => { navigate('edit'); },

    'reset': () => {
      if (confirm('Reset all your edits back to the original template? This cannot be undone.')) {
        tpl.reset();
        location.reload();
      }
    },

    'finalize': () => {
      // A trial must never mint a shareable invitation - that IS the product.
      // Ask the shopper to buy instead of handing them a live link.
      if (tpl.trial) {
        openModal(
          '<h3>Like how that feels?</h3>' +
          '<p>You’ve been editing a trial copy. Buy this template to unlock every ' +
          'section and make a real, shareable invitation live.</p>' +
          '<div class="edit-modal__actions">' +
          '<button class="edit-btn edit-btn--primary" type="button" data-action="buy">Buy this template</button>' +
          '<button class="edit-btn" type="button" data-action="modal-close">Keep exploring</button>' +
          '</div>'
        );
        return;
      }
      tpl.finalize();
      // Platform mode (host editor): publishing - links, edit budget, analytics
      // - is the website's job, so hand control back instead of showing the
      // local share modal. See event-editor.js's balcony:finalize handler.
      if (tpl.platform) {
        window.parent.postMessage({ type: 'balcony:finalize' }, '*');
        return;
      }
      openModal(
        '<h3>Your invitation is ready 🎉</h3>' +
        '<p>Share this link with your guests:</p>' +
        '<div class="edit-modal__link"><input type="text" readonly value="' + esc(shareUrl()) + '" />' +
        '<button class="edit-btn" type="button" data-action="copy-link">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>' +
        '<span class="copy-label">Copy</span></button></div>' +
        '<p>To greet each guest by name, add <strong>?to=</strong> to the link, e.g.<br />' +
        '<em>' + esc(shareUrl()) + '?to=Guest%20Name</em></p>' +
        '<div class="edit-modal__actions">' +
        '<a class="edit-btn edit-btn--primary" href="' + esc(shareUrl()) + '">View invitation</a>' +
        '<button class="edit-btn" type="button" data-action="modal-close">Close</button>' +
        '</div>'
      );
    },

    // Trial → the buy modal, in place. The invitation is never chosen between
    // there (one invitation, one price) - only the optional add-on is, and
    // 'buy-confirm' is where the shopper actually leaves. We await the meta
    // fetch so the modal never opens with a blank price (it's prefetched at
    // mount, so this is usually instant).
    'buy': () => { ensureMeta().then(() => openModal(buyModalHtml(), 'edit-modal__box--buy')); },

    // Picking an add-on (or "Not now", which is the same handler with the
    // included tier). Nothing is charged here - it only decides what the
    // total says and what rides in the checkout URL below.
    'addon-select': (btn) => {
      const tier = btn.dataset.tier || '';
      buyTier = (tier === buyMeta.includedTier) ? '' : tier;
      syncBuyModal();
    },

    'buy-confirm': () => {
      // Await the save first: checkout reads the trial edits from the SERVER now,
      // so the final edit must land before we leave, or the purchase seeds stale.
      Promise.resolve(tpl.save()).then(() => {
        closeModal();
        if (buyUrl) {
          // The add-on rides along so checkout opens with it already selected.
          // Only a hint: checkout re-resolves the tier, and the amount is
          // priced from it server-side when the order is opened.
          location.href = buyTier
            ? buyUrl + (buyUrl.indexOf('?') === -1 ? '?' : '&') +
              'personalization_tier=' + encodeURIComponent(buyTier)
            : buyUrl;
          return;
        }
        // No checkout URL (e.g. embedded, or meta unavailable) - ask the parent.
        window.parent.postMessage({ type: 'balcony:buy', personalizationTier: buyTier || null }, '*');
      });
    },

    'copy-link': (btn) => {
      const input = btn.parentElement.querySelector('input');
      input.select();
      const done = () => {
        const label = btn.querySelector('.copy-label');
        if (label) { label.textContent = 'Copied ✓'; } else { btn.textContent = 'Copied ✓'; }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(input.value).then(done, () => document.execCommand('copy') && done());
      } else if (document.execCommand('copy')) {
        done();
      }
    },
    'modal-close': closeModal,
    'trial-back': () => { if (window.history.length > 1) window.history.back(); else location.href = '/'; },
    'faq-toggle': (btn) => {
      const item = btn.closest('.buy-faq');
      if (!item) return;
      const open = item.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    },
  };

  // The template's own script keeps its own delegated click listener for its
  // editing actions; each listener only acts on the data-actions it knows, so
  // the two coexist without double-handling.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest ? e.target.closest('[data-action]') : null;
    if (btn && actions[btn.dataset.action]) actions[btn.dataset.action](btn);
  });

  // Arrow keys move (and select) within the add-on radiogroup, wrapping at
  // both ends - what a radiogroup is expected to do. Tab and Enter/Space work
  // on their own, these buttons being buttons.
  document.addEventListener('keydown', (e) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;

    const current = e.target.closest ? e.target.closest('.buy-addon') : null;
    if (!current) return;

    const options = Array.prototype.slice.call(
      current.closest('.buy-addons__list').querySelectorAll('.buy-addon')
    );
    const next = options[(options.indexOf(current) + step + options.length) % options.length];

    e.preventDefault();
    actions['addon-select'](next);
    next.focus();
  });

  // The template autosaves its own config, then announces it; we own the
  // indicator in the bar.
  let savedFlash = null;
  document.addEventListener('balcony:saved', () => {
    const el = document.querySelector('.edit-bar__saved');
    if (!el) return;
    el.classList.add('is-on');
    clearTimeout(savedFlash);
    savedFlash = setTimeout(() => el.classList.remove('is-on'), 1600);
  });

  // The leftmost escape link on the TRIAL bar. Signed in → "Dashboard" (their
  // home); logged out → "Home" (the landing page, where they can pick another
  // template). Rendered synchronously with the sensible default (Home → /), then
  // upgraded to Dashboard once the meta fetch reveals a logged-in visitor.
  //
  // Trial only: the host editor is embedded and has the platform's own outer bar
  // (with Back), so its in-iframe toolbar shows no home link.
  function renderHome() {
    const slot = document.querySelector('.edit-bar__home');
    if (!slot) return;
    if (!tpl || !tpl.trial) { slot.innerHTML = ''; return; }

    // A Back control (not a Dashboard link) - the shopper returns to wherever
    // they were browsing templates (the gallery / landing).
    slot.innerHTML =
      '<button class="edit-btn edit-btn--quiet" type="button" data-action="trial-back">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>' +
      'Back</button>';
  }

  // ---- Trial watermark (unpurchased templates only) -----------------------
  // Tiled "Balcony" mark over the PREVIEW of a trial - the moment a shopper
  // (or anyone they forward the link to) could mistake it for the real,
  // shareable invitation. Gone the instant the template is bought (trial
  // becomes false) or while still mid-edit (that view is theirs to try, not
  // to pass around). Click-through, styled in toolbar.css.
  //
  // A real element, not a body::before/::after - several templates (e.g.
  // papercut) already claim those pseudo-elements for their own chrome
  // (decorative edge bars etc.), and a template's `width` there silently
  // out-fights our `right: 0` under CSS's over-constrained box resolution,
  // clipping the mark to whatever sliver the template already sized. Same
  // reason the bar itself (above) is a real appended div.
  function renderWatermark() {
    const on = !!tpl.trial && tpl.mode === 'preview';
    let el = document.querySelector('.trial-watermark');
    if (on && !el) {
      el = document.createElement('div');
      el.className = 'trial-watermark';
      document.body.appendChild(el);
    } else if (!on && el) {
      el.remove();
    }
  }

  // ---- The bar (four states: trial/host × edit/preview) -------------------
  function buildBar() {
    // In the host editor (platform mode) the PREVIEW chrome - the "Previewing…"
    // label, "Make it Live" and "Keep editing" - lives in the parent editor page,
    // not inside this iframe. So don't render a bar for host preview. (Host edit
    // keeps its in-iframe bar; trial/standalone keep theirs in both modes.)
    if (tpl.platform && tpl.mode !== 'edit') return;
    const editing = tpl.mode === 'edit';
    const L = labels();

    // Lucide "pencil" / "eye" (currentColor = --edit-accent / dusk-500)
    const icon = editing
      ? '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>'
      : '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>';

    const label = editing
      ? (tpl.trial ? L.editTrial : L.editHost)
      : (tpl.trial ? L.previewTrial : L.previewHost);

    // Reset is the only editing tool - shown directly (no overflow menu).
    const tools = editing
      ? '<span class="edit-bar__actions">' +
        '<button class="edit-btn edit-btn--quiet" type="button" data-action="reset">Reset</button>' +
        '</span>'
      : '';

    // A trial can never finalize - finalizing mints a shareable invitation,
    // which is the thing being sold. It buys instead.
    //
    // The buy button is the large floating CTA at the bottom-right
    // (edit-btn--buycta) in BOTH trial modes. It used to float only in preview
    // and sit small in the bar while editing, which put the one action the page
    // exists to prompt in the least prominent place at the moment the shopper
    // is most invested - and moved it on them between the two views. The label
    // still differs, because what the shopper is being offered differs: mid-edit
    // it is the locked parts, from the preview it is the template.
    const commit = tpl.trial
      ? '<button class="edit-btn edit-btn--primary edit-btn--buycta" type="button" data-action="buy">' +
        (editing ? 'Buy to unlock all' : 'Buy this template') + '</button>'
      : (editing
        ? ''
        // First time going live (published === false) reads "Make it Live";
        // a re-push (or when the template doesn't report it) reads "Push to live".
        : '<button class="edit-btn edit-btn--primary" type="button" data-action="finalize">' +
          (tpl.published === false ? 'Make it Live' : 'Push to live') + '</button>');

    // Who the toggle is for decides how hard it pushes. A shopper lands in the
    // preview without having edited anything, so editing is the hook and leads.
    // A host reached preview from their own editor, so going back is a retreat
    // and yields to Finalize beside it.
    const toggle = editing
      ? '<button class="edit-btn edit-btn--primary" type="button" data-action="preview">Preview →</button>'
      : (tpl.trial
        ? '<button class="edit-btn" type="button" data-action="back-to-edit">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>' +
          'Try editing</button>'
        : '<button class="edit-btn edit-btn--quiet" type="button" data-action="back-to-edit">← Keep editing</button>');

    const bar = document.createElement('div');
    bar.className = 'edit-bar' + (editing ? '' : ' edit-bar--preview');
    bar.innerHTML =
      // Back control at the extreme left (trial only; empty and hidden otherwise).
      '<span class="edit-bar__home"></span>' +
      '<span class="edit-bar__brand">' +
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      icon + '</svg>' +
      '<span class="edit-bar__brand-text">' + esc(label) + '</span></span>' +
      (editing && !tpl.trial ? '<span class="edit-bar__saved">All changes saved ✓</span>' : '') +
      '<span class="edit-bar__spacer"></span>' +
      tools + commit + toggle;
    document.body.appendChild(bar);
    renderHome(); // in case meta already resolved before the bar was built
  }

  // ---- Public API ---------------------------------------------------------
  window.BalconyToolbar = {
    /**
     * Mount the toolbar for the current page. No-ops in guest ('view') mode -
     * guests get no chrome. See the contract shape on `tpl` above.
     */
    mount(contract) {
      tpl = contract;
      if (tpl.mode !== 'edit' && tpl.mode !== 'preview') return;
      // Host editor: its preview chrome lives in the parent page, so let the
      // parent drive edit ⇄ preview. We navigate on request, re-encoding the
      // in-progress edits into the URL (via navigate → platformHash) so nothing
      // is lost - the parent can't do that itself.
      if (tpl.platform) {
        window.addEventListener('message', function (e) {
          if (e.source !== window.parent) return;
          var d = e.data;
          if (d && d.type === 'balcony:navigate' && (d.mode === 'edit' || d.mode === 'preview')) navigate(d.mode);
        });
      }
      buildBar();
      renderWatermark();
      // Warm the buy-modal data so the plan picker opens instantly. Only the
      // trial sells; a host editing their own event has no buy modal.
      if (tpl.trial) ensureMeta();
    },
    // Exposed for the platform's own tests / debugging.
    ensureMeta,
    get buyUrl() { return buyUrl; },
    get buyMeta() { return buyMeta; },
  };
})();
