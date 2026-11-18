// Royale - editor wiring: mounts the shared editing mechanics
// (_platform/editor-kit.js) and the shared toolbar chrome
// (_platform/toolbar.js), and defines this template's own data-actions.
//
// The generic half - autosave, toasts, popovers, [data-edit] contenteditable
// wiring, [data-edit-input] persistence and the compress-then-upload photo
// picker - all lives in the kit. What is here is Royale's own: which render
// to call after each edit, the rules about its cards, and its two pickers.
(function () {
  const RY = window.Royale;
  if (!RY) return;

  const kit = window.BalconyEditorKit && window.BalconyEditorKit.init(RY);
  if (!kit) return; // guests never wire editing at all (RY.mode === 'view')

  const cfg = RY.config;
  const esc = RY.esc;
  // Keep in step with the same constant in render.js, which decides whether
  // the "Add a frame" tile is drawn and prints the running count on it. This
  // one is the rule; that one is what the host sees.
  const GALLERY_MAX = 10;

  // ---- Fields written by a native control --------------------------------
  // The kit persists [data-edit-input] values itself but cannot know what to
  // redraw: a path like "ceremonies.2.time" says nothing about which section
  // owns it. A ceremony's date or time changes what its card prints, so
  // either redraws the deck.
  document.addEventListener('balcony:field-changed', (e) => {
    const { path, value } = e.detail;

    // A ceremony's date, time or map link all change what its card prints -
    // the map link decides whether the pin points at the host's own place or
    // at a search for the venue - so any of the three redraws the deck.
    if (/^ceremonies\.\d+\.(date|time|mapUrl)$/.test(path)) RY.render.ceremonies();

    // The wedding date IS the Vivaah date, so moving it carries the whole
    // schedule with it rather than leaving the two to drift apart.
    if (path === 'eventISO' && /^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
      syncCeremoniesToVivaah(value);
      kit.saveNow();
      RY.render.date();
      RY.render.ceremonies();
      kit.toast('Date set - the ceremonies moved with it.');
    }
  });

  // ---- Framing a photo ----------------------------------------------------
  // A gallery frame's picture and an added ceremony's photo are both framed
  // this way. The picture area is the only control either has. Four gestures
  // share it, and they are told apart by what the pointer does rather than by
  // separate widgets:
  //
  //   tap            choose a photo, or swap the one that is there
  //   drag           move the picture inside its frame
  //   wheel / pinch  zoom in and out
  //
  // Everything is written onto the <img> directly rather than by re-rendering:
  // a re-render mid-gesture would rebuild the element under the pointer and
  // drop the very gesture that caused it.
  const ZOOM_MAX = 3;

  /**
   * Which picture a gesture is on, from the area it landed in: the config
   * entry it writes to, the field holding the picture, how far it may zoom
   * out, its <img>, and what a tap does. A gallery picture never goes below
   * covering its frame; a ceremony photo may (RY.CEREMONY_ZOOM_MIN), so a
   * cut-out picture can be shown whole.
   */
  function photoTarget(box) {
    if (!box) return null;
    if (box.dataset.adjust !== undefined) {
      const i = +box.dataset.adjust;
      const item = galleryItems()[i];
      return item && {
        item, field: 'image', min: 1,
        img: () => document.querySelector('[data-adjust="' + i + '"] .gframe__img'),
        pick: () => pickPhotoFor(i),
      };
    }
    if (box.dataset.cphoto !== undefined) {
      const i = +box.dataset.cphoto;
      const c = (cfg.ceremonies || [])[i];
      return c && c.custom && {
        item: c, field: 'art', min: RY.CEREMONY_ZOOM_MIN,
        img: () => document.querySelector('[data-cphoto="' + i + '"] .ryc-card__photo-img'),
        pick: () => pickCeremonyPhoto(c),
      };
    }
    return null;
  }

  const clampZoom = (t, z) => Math.min(ZOOM_MAX, Math.max(t.min, z));

  // The framing itself lives in render.js, so a picture is laid out the same
  // way for a guest as it is mid-drag here. This only hands it the numbers.
  function applyFrame(t) {
    const el = t.img();
    if (!el) return null;
    el.dataset.zoom = clampZoom(t, +t.item.zoom || 1);
    el.dataset.posX = Number.isFinite(+t.item.posX) ? +t.item.posX : 50;
    el.dataset.posY = Number.isFinite(+t.item.posY) ? +t.item.posY : 50;
    return RY.frameImage(el);
  }

  // How much bigger than its frame the picture is, in pixels each way - the
  // distance a stored position of 0..100 spends. Near zero on an axis means
  // the picture is flush there and a drag should leave it alone, which at
  // zoom 1 is true of one axis or the other. Negative once a ceremony photo
  // is zoomed out below covering: then it is the room the smaller picture
  // has to move about in, and the same arithmetic places it.
  function frameSpare(t) {
    const el = t.img();
    const box = el && el.parentElement;
    if (!box) return null;
    return { x: el.offsetWidth - box.clientWidth, y: el.offsetHeight - box.clientHeight };
  }

  function pickPhotoFor(index) {
    const item = galleryItems()[index];
    if (!item) return;
    kit.pickPhoto((url) => {
      item.image = url;
      kit.saveNow();
      RY.render.gallery();
    });
  }

  // An added ceremony's photo. Set on the entry itself rather than by its
  // index: the kit calls back twice (a preview, then the uploaded file's URL).
  // A new photo starts framed afresh - the old one's zoom and position were
  // chosen for a different picture. A transparent PNG keeps its see-through
  // parts, so the card's own colour shows through them, as it does round the
  // built-in artwork.
  function pickCeremonyPhoto(c) {
    if (!RY.canEdit('ceremonies')) return;
    let fresh = true;   // only on the first call: a zoom made before the
                        // upload lands belongs to this same picture
    kit.pickPhoto((url) => {
      if (fresh) { delete c.zoom; delete c.posX; delete c.posY; fresh = false; }
      c.art = url;
      kit.saveNow();
      RY.render.ceremonies();
    }, { keepTransparency: true });
  }

  // Zoom about the centre, which is what both the wheel and a pinch imply.
  function zoomBy(t, factor) {
    if (!t || !(t.item[t.field] || '').trim()) return;   // nothing to zoom yet
    t.item.zoom = clampZoom(t, (+t.item.zoom || 1) * factor);
    applyFrame(t);
    kit.scheduleSave();
  }

  const ADJUSTABLE = '[data-adjust], [data-cphoto]';

  // Wheel: the laptop half of zooming. preventDefault matters twice over - it
  // stops the page scrolling past the picture, and stops the gallery's own
  // horizontal scroller running sideways under the cursor. Non-passive for
  // exactly that reason.
  document.addEventListener('wheel', (e) => {
    const box = e.target.closest && e.target.closest(ADJUSTABLE);
    if (!box) return;
    e.preventDefault();
    zoomBy(photoTarget(box), e.deltaY < 0 ? 1.08 : 1 / 1.08);
  }, { passive: false });

  // Pointers in flight per frame, so a second finger turns a drag into a
  // pinch rather than fighting it.
  const touches = new Map();

  document.addEventListener('pointerdown', (e) => {
    const box = e.target.closest && e.target.closest(ADJUSTABLE);
    const t = photoTarget(box);
    if (!t) return;
    const item = t.item;

    const live = touches.get(box) || new Map();
    touches.set(box, live);
    live.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const startX = e.clientX, startY = e.clientY;
    const fromX = Number.isFinite(+item.posX) ? +item.posX : 50;
    const fromY = Number.isFinite(+item.posY) ? +item.posY : 50;
    let moved = false;
    let pinchFrom = null;

    const spread = () => {
      const pts = [...live.values()];
      if (pts.length < 2) return null;
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    };

    box.setPointerCapture(e.pointerId);

    const move = (ev) => {
      if (live.has(ev.pointerId)) live.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

      // Two fingers: pinch. Measured against the spread when the second one
      // landed, so the picture tracks the fingers instead of drifting.
      if (live.size >= 2) {
        const now = spread();
        if (pinchFrom === null) { pinchFrom = now; return; }
        if (now && pinchFrom) {
          moved = true;
          zoomBy(t, now / pinchFrom);
          pinchFrom = now;
        }
        return;
      }

      // One finger: pan, on both axes, as far as the picture has room to go.
      // The pointer's pixels are turned into the frame's own 0-100 scale by
      // dividing by the spare the zoom has opened up, so the picture keeps
      // pace with the finger exactly whatever the zoom.
      if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) moved = true;
      if (!moved) return;
      const spare = frameSpare(t);
      if (!spare) return;
      // Position counts down towards the edge it reveals, so dragging right
      // brings in what was off to the left, and dragging *down* walks posY
      // towards 0 - the top of the picture. Which is the whole point of
      // zooming in on a face near the top of a photograph. (Zoomed out, the
      // spare's sign flips and so does this: the smaller picture simply
      // follows the finger.)
      if (Math.abs(spare.x) > 1) {
        item.posX = Math.min(100, Math.max(0, fromX - (ev.clientX - startX) * 100 / spare.x));
      }
      if (Math.abs(spare.y) > 1) {
        item.posY = Math.min(100, Math.max(0, fromY - (ev.clientY - startY) * 100 / spare.y));
      }
      applyFrame(t);
    };

    const up = (ev) => {
      live.delete(ev.pointerId);
      if (live.size) { pinchFrom = null; return; }   // other fingers still down
      touches.delete(box);
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerup', up);
      box.removeEventListener('pointercancel', up);
      // A press that went nowhere is a tap, and a tap picks the photo. Done
      // here rather than with a click listener because the pointer is
      // captured: the browser retargets the click and a handler on the frame
      // would never see it.
      if (moved) kit.saveNow();
      else t.pick();
    };

    box.addEventListener('pointermove', move);
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', up);
  });


  // The typed day/month/year beside the calendar (see render.js's date
  // panel). They write a complete date onto the calendar field and fire its
  // change event, so the kit's own [data-edit-input] pipeline - persist,
  // save, announce - runs exactly as it does for a real pick, and the handler
  // above does the rest. Nothing happens until all three make a real date: a
  // half-typed year is not something to re-schedule six ceremonies around.
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.closest || !el.closest('.ry-date-edit__manual')) return;

    const panel = el.closest('.ry-date-edit');
    const d = parseInt(panel.querySelector('.ry-date-edit__day').value, 10);
    const mo = parseInt(panel.querySelector('.ry-date-edit__month').value, 10);
    const y = parseInt(panel.querySelector('.ry-date-edit__year').value, 10);
    if (!(d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 1900 && y <= 2999)) return;

    // A date the calendar cannot express (31 April) is not one the plaques
    // can roll to either.
    const check = new Date(y, mo - 1, d);
    if (check.getMonth() !== mo - 1 || check.getDate() !== d) {
      kit.toast('That date is not on the calendar.');
      return;
    }

    const iso = panel.querySelector('.ry-date-edit__iso');
    iso.value = y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    iso.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // ---- Shared venue across ceremonies ------------------------------------
  // The FIRST ceremony's venue is the shared default: editing it fills every
  // other ceremony that has not been individually overridden, so a host types
  // the address once and then overrides only the rites that are somewhere
  // else. Editing any other venue marks THAT one overridden instead of
  // cascading from it. Venue is contenteditable (not [data-edit-input]), so
  // this listens for the field losing focus rather than the kit's event.
  document.addEventListener('focusout', (e) => {
    const el = e.target.closest ? e.target.closest('[data-edit]') : null;
    if (!el) return;
    const m = /^ceremonies\.(\d+)\.venue$/.exec(el.dataset.edit || '');
    if (!m) return;
    const list = cfg.ceremonies || [];
    const i = +m[1];
    const c = list[i];
    if (!c) return;

    if (i === 0) {
      list.forEach((other, j) => { if (j !== 0 && !other.venueCustom) other.venue = c.venue; });
    } else {
      c.venueCustom = true;
    }
    kit.saveNow();
    RY.render.ceremonies();
  });

  // An added ceremony's name is one of the two things that put it in front of
  // guests (RY.ceremonyLive), so finishing or emptying it can show or clear
  // the card's "hidden from guests" line. Redrawn only when that changes:
  // the redraw would otherwise take the card out from under whatever the
  // host just clicked on next.
  document.addEventListener('focusout', (e) => {
    const el = e.target.closest ? e.target.closest('[data-edit]') : null;
    const m = el && /^ceremonies\.(\d+)\.name$/.exec(el.dataset.edit || '');
    if (!m) return;
    const c = (cfg.ceremonies || [])[+m[1]];
    if (!c || !c.custom) return;
    const item = el.closest('.ryc-edit');   // the card and the panel under it
    const hinted = !!(item && item.querySelector('.ry-cere-hint'));
    if (hinted === RY.ceremonyLive(c)) RY.render.ceremonies();
  });

  // ---- Include / exclude one ceremony ------------------------------------
  // "Keep at least one" is this template's rule about ceremonies, not generic
  // toggle behaviour, so it lives here. The entry keeps its name, date and
  // venue while excluded, which is what makes this reversible.
  document.addEventListener('change', (e) => {
    const input = e.target;
    if (!(input.matches && input.matches('[data-edit-toggle]'))) return;
    if (!RY.canEdit('ceremonies')) { input.checked = !input.checked; return; }

    const list = cfg.ceremonies || [];
    if (!input.checked && list.filter(RY.ceremonyLive).length <= 1) {
      input.checked = true;
      kit.toast('Keep at least one ceremony - the schedule always appears.');
      return;
    }
    kit.setVal(input.dataset.editToggle, input.checked);
    kit.saveNow();
    RY.render.ceremonies();
  });

  // ---- The wedding date carries the schedule with it ---------------------
  // The date the plaques roll to IS the Vivaah date; every other rite is
  // scheduled relative to it, in the order the rites actually run (the same
  // offsets config.js seeds a new invitation with). A renamed ceremony no
  // longer matches an entry here, so its date is left alone rather than
  // guessed at - and so is every ceremony the host added themselves, even one
  // they happened to call "Haldi": its date is the one they typed.
  const VIVAAH_OFFSETS = {
    'ring ceremony': -2,
    'mehendi': -1,
    'haldi': -1,
    'sangeet': -1,
    'vivaah': 0,
    'reception': 1,
  };

  function syncCeremoniesToVivaah(iso) {
    (cfg.ceremonies || []).forEach((c) => {
      if (c.custom) return;
      const offset = VIVAAH_OFFSETS[(c.name || '').trim().toLowerCase()];
      if (offset !== undefined) c.date = RY.addDaysISO(iso, offset);
    });
  }

  // ---- Opening-invocation picker -----------------------------------------
  // Ported from papercut so a host meets the identical control in every
  // template: custom (non-native) dropdowns, so each native script can be
  // shown in its own font, plus a live preview of the card's single line.
  const INVOCATION_MAX = 60;

  function ddOption(kind, value, text, current, font, rtl) {
    return '<button type="button" class="inv-dd__opt' + (current ? ' is-current' : '') + '"' +
      ' data-dd-set data-dd-kind="' + kind + '" data-dd-value="' + esc(value) + '"' +
      (font ? ' style="font-family:' + font + '"' : '') + (rtl ? ' dir="rtl"' : '') + '>' +
      esc(text) + '</button>';
  }

  function ddBlock(kind, label, valueText, valueFont, valueRtl, optionsHtml) {
    return '<div class="edit-pop__field"><span>' + label + '</span>' +
      '<div class="inv-dd" data-dd="' + kind + '">' +
      '<button type="button" class="inv-dd__trigger" data-dd-toggle>' +
      '<span class="inv-dd__value"' + (valueFont ? ' style="font-family:' + valueFont + '"' : '') +
      (valueRtl ? ' dir="rtl"' : '') + '>' + esc(valueText) + '</span>' +
      '<svg class="inv-dd__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
      '</button>' +
      '<div class="inv-dd__menu" role="listbox">' + optionsHtml + '</div>' +
      '</div></div>';
  }

  function symThumb(s) {
    return s.src
      ? '<img class="inv-dd__sym" src="' + esc(s.src) + '" alt="" />'
      : '<span class="inv-dd__sym inv-dd__sym--none">-</span>';
  }

  function symbolBlock() {
    const cur = RY.symbolById(cfg.invocation.symbol);
    const options = RY.SYMBOLS.map((s) => (
      '<button type="button" class="inv-dd__opt inv-dd__opt--sym' + (cur.id === s.id ? ' is-current' : '') + '"' +
      ' data-dd-set data-dd-kind="symbol" data-dd-value="' + esc(s.id) + '">' +
      symThumb(s) + '<span>' + esc(s.label) + '</span></button>'
    )).join('');

    return '<div class="edit-pop__field"><span>Symbol</span>' +
      '<div class="inv-dd" data-dd="symbol">' +
      '<button type="button" class="inv-dd__trigger" data-dd-toggle>' +
      '<span class="inv-dd__value inv-dd__value--sym">' + symThumb(cur) + '<span>' + esc(cur.label) + '</span></span>' +
      '<svg class="inv-dd__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
      '</button>' +
      '<div class="inv-dd__menu" role="listbox">' + options + '</div>' +
      '</div></div>';
  }

  // ONE grouped list rather than separate tradition/script dropdowns: under
  // each tradition heading sits its line in English AND in its native
  // script(s), so picking an option sets both at once.
  function invocationBlock() {
    const inv = cfg.invocation;
    const rels = RY.INVOCATIONS;
    const cur = RY.invocationLines(inv);

    let menu = '';
    Object.keys(rels).forEach((relKey) => {
      const rel = rels[relKey];
      menu += '<div class="inv-dd__group">' + esc(rel.label) + '</div>';
      const engOn = inv.religion === relKey && cur.isEnglish;
      menu += ddOption('inv', relKey + ':english', rel.english, engOn, '', false);
      Object.keys(rel.scripts).forEach((sk) => {
        const s = rel.scripts[sk];
        const on = inv.religion === relKey && !cur.isEnglish && cur.script === sk;
        menu += ddOption('inv', relKey + ':' + sk, s.text, on, "'" + s.font + "'", !!s.rtl);
      });
    });

    menu += '<div class="inv-dd__group">Other</div>';
    menu += ddOption('inv', 'custom', '✎ Write your own…', cur.isCustom, '', false);
    menu += ddOption('inv', 'blank', 'No invocation line', cur.isBlank, '', false);

    const triggerText = cur.isCustom ? (cur.text || 'Write your own…')
      : cur.isBlank ? 'No invocation line'
        : cur.text;
    const curFont = (cur.isEnglish || cur.isCustom || cur.isBlank || !cur.font) ? '' : "'" + cur.font + "'";
    const block = ddBlock('inv', 'Invocation', triggerText, curFont, cur.isBlank ? false : cur.rtl, menu);

    const customInput = cur.isCustom
      ? '<input type="text" class="inv-custom" maxlength="' + INVOCATION_MAX + '" value="' + esc(inv.custom || '') + '" placeholder="Write your invocation line…" />' +
      '<div class="inv-custom__count">' + (inv.custom || '').length + ' / ' + INVOCATION_MAX + '</div>'
      : '';

    return block + customInput;
  }

  function invocationPopHtml() {
    const line = RY.invocationLines(cfg.invocation);
    const sym = RY.symbolById(cfg.invocation.symbol);

    const preview =
      '<div class="edit-pop__inv-preview">' +
      (sym.src ? '<img class="inv-preview__sym" src="' + esc(sym.src) + '" alt="" />' : '') +
      (line.text
        ? '<div class="inv-preview__native"' + (line.rtl ? ' dir="rtl"' : '') +
        (line.isEnglish ? '' : ' style="font-family:\'' + line.font + '\',serif"') +
        '>' + esc(line.text) + '</div>'
        : (sym.src ? '' : '<div class="inv-preview__en">No opening line</div>')) +
      '</div>';

    return '<h4>Opening invocation</h4>' + invocationBlock() + symbolBlock() + preview;
  }

  // ONE delegated listener per popover element, guarded: the pop survives its
  // own innerHTML rebuilds, so re-adding would stack handlers.
  function wireInvocationPop(pop) {
    if (!pop || pop.__invWired) return;
    pop.__invWired = true;

    pop.addEventListener('click', (e) => {
      const toggle = e.target.closest('[data-dd-toggle]');
      if (toggle) {
        const dd = toggle.closest('.inv-dd');
        const open = dd.classList.contains('is-open');
        pop.querySelectorAll('.inv-dd.is-open').forEach((d) => d.classList.remove('is-open'));
        if (!open) dd.classList.add('is-open');
        return;
      }

      const opt = e.target.closest('[data-dd-set]');
      if (opt) {
        if (opt.dataset.ddKind === 'symbol') {
          cfg.invocation.symbol = opt.dataset.ddValue;
        } else if (opt.dataset.ddKind === 'inv') {
          const parts = opt.dataset.ddValue.split(':');
          if (parts.length === 1) {
            cfg.invocation.script = parts[0];
          } else {
            cfg.invocation.religion = parts[0];
            cfg.invocation.script = parts[1];
          }
        }
        kit.saveNow();
        RY.render.invocation();
        pop.innerHTML = invocationPopHtml();
        const ci = pop.querySelector('.inv-custom');
        if (ci) ci.focus();
        return;
      }

      pop.querySelectorAll('.inv-dd.is-open').forEach((d) => d.classList.remove('is-open'));
    });

    pop.addEventListener('input', (e) => {
      const inp = e.target.closest('.inv-custom');
      if (!inp) return;
      // Enforce the cap even on paste - maxlength misses programmatic input.
      if (inp.value.length > INVOCATION_MAX) inp.value = inp.value.slice(0, INVOCATION_MAX);
      cfg.invocation.custom = inp.value;
      kit.saveNow();
      RY.render.invocation();
      const caret = inp.selectionStart;
      pop.innerHTML = invocationPopHtml();
      const next = pop.querySelector('.inv-custom');
      if (next) { next.focus(); try { next.setSelectionRange(caret, caret); } catch (_) { /* ignore */ } }
    });
  }

  function galleryItems() {
    if (!Array.isArray(cfg.gallery.items)) cfg.gallery.items = [];
    return cfg.gallery.items;
  }

  const actions = {
    'invocation-pick': (btn) => {
      const pop = kit.openPop(btn, invocationPopHtml());
      wireInvocationPop(pop);
    },

    // Gallery: add a frame, pick its picture, reorder, remove.
    'gallery-add': (btn) => {
      const items = galleryItems();
      if (items.length >= GALLERY_MAX) { kit.toast('Up to ' + GALLERY_MAX + ' frames'); return; }
      const type = btn.dataset.type;
      // A cord length of its own, so a new frame hangs at a different height
      // from its neighbour rather than lining up with it.
      const hang = 86 + ((items.length * 23) % 70);
      items.push(type === 'story'
        ? { type: 'story', text: '', hang }
        : { type, image: '', caption: '', hang });
      kit.saveNow();
      RY.render.gallery();
    },

    // Kept for anything that still asks by action; the frame itself taps
    // straight into pickPhotoFor.
    'gallery-photo': (btn) => pickPhotoFor(+btn.dataset.index),

    'gallery-move': (btn) => {
      const items = galleryItems();
      const from = +btn.dataset.index;
      const to = from + (+btn.dataset.dir);
      if (to < 0 || to >= items.length) return;
      const moved = items[from];
      items[from] = items[to];
      items[to] = moved;
      kit.saveNow();
      RY.render.gallery();
    },

    // A picture is the one thing a host cannot get back by retyping - it came
    // off their device - so removing a filled frame asks first.
    'gallery-remove': (btn) => {
      const items = galleryItems();
      const i = +btn.dataset.index;
      const item = items[i];
      if (!item) return;

      const filled = item.type === 'story' ? (item.text || '').trim() : (item.image || '').trim();
      if (!filled) {
        items.splice(i, 1);
        kit.saveNow();
        RY.render.gallery();
        return;
      }

      const pop = kit.openPop(btn,
        '<h4>Remove this frame?</h4>' +
        '<p class="edit-pop__note">It comes off the invitation straight away. You can add it ' +
        'again later, but you will need the original photo.</p>' +
        '<div class="edit-pop__confirm">' +
        '<button type="button" class="edit-pop__btn edit-pop__btn--danger" data-confirm-remove>Remove</button>' +
        '<button type="button" class="edit-pop__btn" data-confirm-cancel>Keep it</button>' +
        '</div>');
      pop.querySelector('[data-confirm-remove]').addEventListener('click', () => {
        kit.closePop();
        items.splice(i, 1);
        kit.saveNow();
        RY.render.gallery();
      });
      pop.querySelector('[data-confirm-cancel]').addEventListener('click', () => kit.closePop());
    },

    // The compliments scroll: add / remove a name line.
    // Ceremony time, on and off. The guest view already skipped a ceremony
    // with no time; this is the pair that lets a host actually get to that
    // state, rather than fighting a native time field to empty it.
    'ceremony-time-remove': (btn) => {
      cfg.ceremonies[+btn.dataset.index].time = '';
      kit.saveNow();
      RY.render.ceremonies();
    },

    'ceremony-time-add': (btn) => {
      const i = +btn.dataset.index;
      cfg.ceremonies[i].time = '12:00';
      kit.saveNow();
      RY.render.ceremonies();
      // Straight into the picker, so adding a time is one gesture and not two.
      const input = document.querySelector('[data-edit-input="ceremonies.' + i + '.time"]');
      if (input) { input.focus(); if (input.showPicker) try { input.showPicker(); } catch (_) { /* ignore */ } }
    },

    // A ceremony of the host's own (see CUSTOM_CEREMONY_MAX in config.js). It
    // starts on the wedding date at the shared venue, unnamed and without a
    // photo - so hidden from guests until the host has given it both.
    'ceremony-add': () => {
      if (!RY.canEdit('ceremonies')) return;
      if (!Array.isArray(cfg.ceremonies)) cfg.ceremonies = [];
      const list = cfg.ceremonies;
      if (list.filter((c) => c.custom).length >= RY.CUSTOM_CEREMONY_MAX) {
        kit.toast('Up to ' + RY.CUSTOM_CEREMONY_MAX + ' ceremonies of your own');
        return;
      }
      list.push({
        // Its RSVP key for good, so deleting another added ceremony can never
        // move this one's replies.
        id: 'own-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        custom: true,
        name: '',
        art: '',
        date: cfg.eventISO || '',
        time: '',
        venue: (list[0] && list[0].venue) || '',
        mapUrl: '',
        enabled: true,
      });
      kit.saveNow();
      RY.render.ceremonies();

      // Sorted in by date, it may not land at the end - take the host to it.
      const nameEl = document.querySelector('[data-edit="ceremonies.' + (list.length - 1) + '.name"]');
      if (nameEl) {
        nameEl.closest('.ryc-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
        nameEl.focus({ preventScroll: true });
      }
      kit.toast('Added - give it a name, a date and a photo.');
    },

    // The added ceremony's picture - the "Change photo" button under the card;
    // a tap on the photo itself comes through photoTarget.
    'ceremony-photo': (btn) => {
      const c = (cfg.ceremonies || [])[+btn.dataset.index];
      if (c && c.custom) pickCeremonyPhoto(c);
    },

    // The zoom buttons under the card: the same steps a few wheel notches take.
    'ceremony-zoom': (btn) => {
      const box = document.querySelector('[data-cphoto="' + btn.dataset.index + '"]');
      zoomBy(photoTarget(box), +btn.dataset.dir > 0 ? 1.15 : 1 / 1.15);
    },

    // Deleting an added ceremony. Only these come out of the array - the
    // built-in six are switched off instead, and their place in the array is
    // their RSVP key. Added ones sit after all six, so taking one out never
    // moves a built-in. A photo is asked about first, as a gallery frame's is.
    'ceremony-remove': (btn) => {
      const list = cfg.ceremonies || [];
      const i = +btn.dataset.index;
      const c = list[i];
      if (!c || !c.custom || !RY.canEdit('ceremonies')) return;
      if (RY.ceremonyLive(c) && list.filter(RY.ceremonyLive).length <= 1) {
        kit.toast('Keep at least one ceremony - the schedule always appears.');
        return;
      }

      const drop = () => {
        list.splice(i, 1);
        kit.saveNow();
        RY.render.ceremonies();
      };
      if (!(c.art || '').trim()) { drop(); return; }

      const pop = kit.openPop(btn,
        '<h4>Delete this ceremony?</h4>' +
        '<p class="edit-pop__note">It comes off the invitation straight away, with its photo. ' +
        'You can add it again later, but you will need the photo again.</p>' +
        '<div class="edit-pop__confirm">' +
        '<button type="button" class="edit-pop__btn edit-pop__btn--danger" data-confirm-remove>Delete</button>' +
        '<button type="button" class="edit-pop__btn" data-confirm-cancel>Keep it</button>' +
        '</div>');
      pop.querySelector('[data-confirm-remove]').addEventListener('click', () => { kit.closePop(); drop(); });
      pop.querySelector('[data-confirm-cancel]').addEventListener('click', () => kit.closePop());
    },

    'compliment-line-add': () => {
      if (!RY.canEdit('compliments.lines')) return;
      if (!Array.isArray(cfg.compliments.lines)) cfg.compliments.lines = [];
      cfg.compliments.lines.push('');
      kit.saveNow();
      RY.render.compliments();
      const fields = document.querySelectorAll('#ryComplimentLines [data-edit]');
      if (fields.length) fields[fields.length - 1].focus();
    },

    'compliment-line-remove': (btn) => {
      cfg.compliments.lines.splice(+btn.dataset.index, 1);
      kit.saveNow();
      RY.render.compliments();
    },

    // Take a card out of the invitation, or put it back. Only the flag moves,
    // so the writing is still there when it returns.
    'card-remove': (btn) => {
      const key = btn.dataset.card;
      const branch = cfg[key];
      if (!branch || !RY.canEdit(key)) return;
      branch.enabled = false;
      kit.saveNow();
      RY.render.all();
      kit.toast('Removed - you can add it back where it was.');
    },

    'card-restore': (btn) => {
      const key = btn.dataset.card;
      const branch = cfg[key];
      if (!branch || !RY.canEdit(key)) return;
      branch.enabled = true;
      kit.saveNow();
      RY.render.all();
    },

    // The media row's one removable icon. Only the row is re-rendered, not the
    // page: the other two icons are derived and nothing else reads this flag.
    'social-remove': () => {
      if (!RY.canEdit('social')) return;
      if (!cfg.social) cfg.social = { instagram: true, instagramUrl: '' };
      cfg.social.instagram = false;
      kit.saveNow();
      RY.render.social();
      kit.toast('Removed - you can add it back where it was.');
    },

    'social-restore': () => {
      if (!RY.canEdit('social')) return;
      if (!cfg.social) cfg.social = { instagram: true, instagramUrl: '' };
      cfg.social.instagram = true;
      kit.saveNow();
      RY.render.social();
    },
  };

  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-action]');
    if (btn && actions[btn.dataset.action]) actions[btn.dataset.action](btn);
  });

  // ---- Mount the shared platform toolbar ---------------------------------
  // The bar, buy modal and edit <-> preview navigation are the platform's,
  // not this template's. We hand it only what is ours: how to persist, reset
  // and finalize this invitation's config, and - in the host editor - how to
  // carry the payload across the edit <-> preview page change.
  if (window.BalconyToolbar) {
    window.BalconyToolbar.mount({
      mode: RY.mode,
      trial: RY.trial,
      platform: !!RY.platform,
      published: RY.hasPublished,
      save: () => kit.flushSave(),
      reset: () => RY.reset(),
      finalize: () => { cfg.finalized = true; RY.save(); },
      platformHash: RY.platformHash || null,
      labels: RY.trial
        ? { editTrial: "Try editing - the couple's names are yours to change" }
        : { editHost: 'Editing your invitation', previewHost: 'Previewing your invitation' },
    });
  }
})();
