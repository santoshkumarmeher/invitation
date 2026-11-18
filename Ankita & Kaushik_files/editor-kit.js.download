// Shared in-template editor mechanics - the boilerplate every template's own
// editor.js otherwise has to reimplement: autosave, toast/popover chrome,
// config-path get/set, contenteditable [data-edit] wiring, [data-edit-input]
// wiring, generic reorderable-list helpers, and the compress-then-upload
// photo picker. rose-invitation is the reference: its editor.js keeps only
// what's genuinely its own (its data-action handlers, its ceremony-toggle
// rule, its render calls) and calls into this kit for everything else - a
// new template should be able to do the same with very little bespoke JS.
//
// Deliberately NOT here: [data-edit-toggle] handling. The one existing use
// (a ceremony on/off switch) carries a business rule - "don't allow
// unchecking the last enabled ceremony" - that has no generic form yet with
// only one template to generalize from; faking a hook for it now would be
// guessing at an API rather than extracting a proven one. Leave per-template
// `change` listeners for `[data-edit-toggle]` in the template's own editor.js
// until a second template's toggle rules reveal what's actually shared.
//
// Usage: const kit = BalconyEditorKit.init(RI); if (!kit) return; (mirrors
// the mode check every template's editor.js already opens with).
window.BalconyEditorKit = (function () {
  function init(RI) {
    if (!RI || RI.mode === 'view') return null;

    const esc = RI.esc;

    // ---- Config path helpers (e.g. "gallery.items.2.caption") --------------
    function resolve(path) {
      const keys = path.split('.');
      let obj = RI.config;
      for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
      return { obj, key: keys[keys.length - 1] };
    }
    const getVal = (path) => { const r = resolve(path); return r.obj[r.key]; };
    const setVal = (path, v) => { const r = resolve(path); r.obj[r.key] = v; };

    // ---- Autosave + feedback ------------------------------------------------
    let saveTimer = null;

    // Returns Promise<boolean>. RI.save() is a plain boolean in non-trial mode
    // and a Promise<boolean> in trial/platform mode (it writes to the server) -
    // Promise.resolve normalises both, so callers (incl. the toolbar, before
    // navigating) can await.
    function saveNow() {
      return Promise.resolve(RI.save()).then(function (ok) {
        if (ok) {
          // The shared toolbar owns the "saved ✓" indicator in the bar;
          // announce the save and let it flash.
          document.dispatchEvent(new CustomEvent('balcony:saved'));
        } else {
          toast("Couldn't save - please check your connection");
        }
        return ok;
      });
    }

    function scheduleSave(delay) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveNow, delay || 400);
    }

    // Cancels any pending debounced save and persists immediately - for
    // moments that can't wait out the debounce (the toolbar, right before it
    // navigates away).
    function flushSave() {
      clearTimeout(saveTimer);
      return saveNow();
    }

    let toastEl = null;
    let toastTimer = null;
    function toast(msg) {
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.className = 'edit-toast';
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = msg;
      toastEl.classList.add('is-on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 2600);
    }

    // ---- Popover ------------------------------------------------------------
    let pop = null;

    function closePop() {
      if (pop) { pop.remove(); pop = null; }
    }

    function openPop(anchor, html) {
      closePop();
      pop = document.createElement('div');
      pop.className = 'edit-pop';
      pop.innerHTML = html;
      document.body.appendChild(pop);
      const r = anchor.getBoundingClientRect();
      const w = pop.offsetWidth;
      let left = r.left + window.scrollX + r.width / 2 - w / 2;
      left = Math.max(10, Math.min(left, window.scrollX + document.documentElement.clientWidth - w - 10));
      pop.style.left = left + 'px';
      pop.style.top = (r.bottom + window.scrollY + 8) + 'px';
      return pop;
    }

    document.addEventListener('pointerdown', (e) => {
      if (pop && !pop.contains(e.target)) closePop();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePop();
    });

    // ---- Inline text editing (delegated) ------------------------------------
    document.addEventListener('input', (e) => {
      const el = e.target.closest ? e.target.closest('[data-edit]') : null;
      if (el) {
        let text = el.innerText.replace(/ /g, ' ');
        if (!el.hasAttribute('data-edit-multiline')) text = text.replace(/\n+/g, ' ');
        setVal(el.dataset.edit, text.replace(/^\s+$/, ''));
        scheduleSave();
      }
    });

    document.addEventListener('keydown', (e) => {
      const el = e.target.closest ? e.target.closest('[data-edit]') : null;
      if (el && e.key === 'Enter' && !el.hasAttribute('data-edit-multiline')) {
        e.preventDefault();
        el.blur();
      }
    });

    // Plain-text paste fallback for browsers without contenteditable="plaintext-only"
    document.addEventListener('paste', (e) => {
      const el = e.target.closest ? e.target.closest('[data-edit]') : null;
      if (!el) return;
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });

    // ---- [data-edit-input] wiring (dates, times, urls, ...) -----------------
    // Mechanical part only (persist the value): a path like "weddingDate" or
    // "ceremonies.2.time" says nothing about which section needs re-rendering
    // afterwards, so this dispatches a DOM event carrying {path, value} and
    // leaves the "what to re-render" decision to the template, which already
    // knows its own config shape.
    document.addEventListener('change', (e) => {
      const input = e.target;
      if (!(input.matches && input.matches('[data-edit-input]'))) return;
      const path = input.dataset.editInput;
      setVal(path, input.value);
      saveNow();
      document.dispatchEvent(new CustomEvent('balcony:field-changed', { detail: { path, value: input.value } }));
    });

    // ---- Generic reorderable-list helpers ------------------------------------
    // Operate on an array living at `path` in RI.config. What to push when
    // adding stays with the template (item shape varies per template); move/
    // remove are pure array mechanics every list needs identically.
    function listMove(path, index, dir) {
      const arr = getVal(path);
      if (!Array.isArray(arr)) return false;
      const j = index + dir;
      if (j < 0 || j >= arr.length) return false;
      const t = arr[index]; arr[index] = arr[j]; arr[j] = t;
      return true;
    }
    function listRemove(path, index) {
      const arr = getVal(path);
      if (!Array.isArray(arr)) return false;
      arr.splice(index, 1);
      return true;
    }

    // ---- Photo picker (compress client-side, then upload-or-inline) --------
    // Compresses to a JPEG data-URL (or WebP/PNG for a transparent picture, when
    // asked - see ALPHA_TYPE), then either uploads it as a real file (set
    // RI.uploadUrl - the host platform, from the payload's event id) or hands
    // back the data-URL directly (trial/standalone dev, no event to upload
    // against). Uploading keeps base64 image bytes out of the event's
    // `draft`/`live` JSON and out of the host editor's iframe payload hash,
    // which only gets bigger as a host adds more photos.
    const photoInput = document.createElement('input');
    photoInput.type = 'file';
    photoInput.accept = 'image/*';
    photoInput.hidden = true;
    document.body.appendChild(photoInput);
    let pendingReady = null;
    let pendingOpts = {};

    // Laravel's CSRF middleware accepts the XSRF-TOKEN cookie (set on any page
    // load that goes through the `web` middleware, e.g. the host editor's own
    // /host/events/{id}/edit) echoed back as X-XSRF-TOKEN - the same
    // convention Laravel's own axios defaults use. The iframe is same-origin,
    // so it can read that cookie directly; no separate token needs threading
    // through.
    function xsrfToken() {
      const m = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/);
      return m ? decodeURIComponent(m[1]) : '';
    }

    // Named for what it actually holds: the server keeps the upload's own
    // extension, and a transparent picture is not a .jpg.
    const EXT = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' };

    function uploadBlob(blob) {
      const form = new FormData();
      form.append('image', blob, 'photo.' + (EXT[blob.type] || 'jpg'));
      return fetch(RI.uploadUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'X-XSRF-TOKEN': xsrfToken() },
        body: form,
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    }

    // A picture with see-through parts (a cut-out PNG, say) loses them as a
    // JPEG - they come out black. A caller that wants them kept asks with
    // { keepTransparency: true }; the picture is then checked, and only one
    // that really has transparent pixels is kept that way: as WebP, which holds
    // them at a fraction of PNG's size, or PNG where the browser cannot encode
    // WebP (older Safari hands back a PNG when asked for one). Anything opaque
    // still goes as the smaller JPEG, whatever it arrived as.
    const ALPHA_TYPE = (() => {
      try {
        const t = document.createElement('canvas');
        t.width = t.height = 1;
        return t.toDataURL('image/webp').indexOf('data:image/webp') === 0 ? 'image/webp' : 'image/png';
      } catch (_) {
        return 'image/png';
      }
    })();

    function hasTransparency(ctx, w, h) {
      const px = ctx.getImageData(0, 0, w, h).data;
      for (let i = 3; i < px.length; i += 4) {
        if (px[i] < 250) return true;
      }
      return false;
    }

    photoInput.addEventListener('change', () => {
      const file = photoInput.files && photoInput.files[0];
      photoInput.value = '';
      const onReady = pendingReady;
      const opts = pendingOpts;
      pendingReady = null;
      pendingOpts = {};
      if (!file || !onReady) return;
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 1000;
        const s = Math.min(1, MAX / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        // JPEG/HEIC cannot carry transparency, so only the formats that can
        // are worth reading back pixel by pixel.
        const alpha = !!opts.keepTransparency && /^image\/(png|webp|gif|avif)$/.test(file.type) &&
          hasTransparency(ctx, c.width, c.height);
        const type = alpha ? ALPHA_TYPE : 'image/jpeg';
        const quality = alpha ? 0.85 : 0.8;
        const dataUrl = c.toDataURL(type, quality);
        if (RI.uploadUrl) {
          onReady(dataUrl); // optimistic preview while the real upload lands
          c.toBlob((blob) => {
            if (!blob) { saveNow(); return; }
            uploadBlob(blob).then((res) => {
              if (res && res.url) onReady(res.url);
              else toast("Couldn't upload photo - please check your connection");
              saveNow();
            });
          }, type, quality);
        } else {
          onReady(dataUrl);
          saveNow();
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); toast("Couldn't read that image file"); };
      img.src = url;
    });

    // onReady(dataUrlOrUploadedUrl) is called once (optimistically, then again
    // with the real URL if an upload follows) - the template sets it onto
    // whatever config field it came from and re-renders. opts.keepTransparency
    // keeps a transparent picture's see-through parts (see ALPHA_TYPE above).
    function pickPhoto(onReady, opts) {
      pendingReady = onReady;
      pendingOpts = opts || {};
      photoInput.click();
    }

    return {
      esc,
      resolve, getVal, setVal,
      saveNow, scheduleSave, flushSave,
      toast, openPop, closePop,
      listMove, listRemove,
      pickPhoto,
    };
  }

  return { init };
})();
