// Ballena Outlet admin panel. Every change goes to a draft; publishing is an
// explicit step that sends the reviewed draft id, so the server can refuse a
// draft that changed (or went stale) after the owner looked at it.
(function () {
  "use strict";

  var API = "/api/admin";
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var state = { draft: null, live: null };
  var money = new Intl.NumberFormat("es-CR", { style: "currency", currency: "CRC", maximumFractionDigits: 0 });
  var dateFmt = new Intl.DateTimeFormat("es-CR", { dateStyle: "medium", timeStyle: "short" });

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "class") node.className = attrs[k];
      else if (k === "text") node.textContent = attrs[k];
      else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return node;
  }

  function toast(msg, isError) {
    var t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " err" : "");
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.hidden = true; }, isError ? 9000 : 4000);
  }

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || "GET", credentials: "same-origin", headers: {} };
    if (opts.json) { init.body = JSON.stringify(opts.json); init.headers["content-type"] = "application/json"; }
    if (opts.form) init.body = opts.form;
    return fetch(API + path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401 && path !== "/whoami") showLogin();
        if (!res.ok) {
          var msg = data.message || (res.status === 401 ? "Tu sesión expiró. Recargá la página." : "Error " + res.status);
          var err = new Error(msg); err.status = res.status; throw err;
        }
        return data;
      });
    });
  }

  function busy(btn, on) { if (btn) btn.disabled = on; }
  function price(v) { return v === null || v === undefined ? "sin precio" : money.format(v); }
  function when(iso) { return iso ? dateFmt.format(new Date(iso)) : "—"; }

  // ---- Status + draft -------------------------------------------------------

  function stat(value, label) { return el("div", { class: "stat" }, [el("b", { text: String(value) }), el("span", { text: label })]); }

  function renderStatus(s) {
    state.live = s.live;
    state.draft = s.draft;
    var live = $("#live");
    live.replaceChildren(
      stat(s.live.count, "artículos publicados"),
      stat(s.live.with_images, "con foto o flyer"),
      stat("#" + s.live.version, s.live.published_at ? "publicación · " + when(s.live.published_at) : "inventario inicial (git)")
    );
    renderDraft(s.draft);
  }

  function changeList(title, block, fmt) {
    if (!block || !block.total) return null;
    var more = block.total > block.items.length ? el("li", { class: "muted", text: "… y " + (block.total - block.items.length) + " más" }) : null;
    return el("details", {}, [
      el("summary", { text: title + " (" + block.total + ")" }),
      el("ul", {}, block.items.map(function (x) { return el("li", { text: fmt(x) }); }).concat(more ? [more] : [])),
    ]);
  }

  function renderDraft(d) {
    var box = $("#draft");
    if (!d) {
      box.replaceChildren(el("p", { class: "empty", text: "No hay cambios pendientes. Lo publicado es lo que se ve en la web." }));
      return;
    }
    var c = d.changes;
    var r = d.report;
    var lists = [
      changeList("Nuevos", c.added, function (x) { return x.id + " · " + x.name + " · " + price(x.price_crc) + " · " + x.qty + " u."; }),
      changeList("Se quitan de la web", c.removed, function (x) { return x.id + " · " + x.name; }),
      changeList("Cambios de precio", c.price_changed, function (x) { return x.id + " · " + x.name + ": " + price(x.from) + " → " + price(x.to); }),
      changeList("Cambios de cantidad", c.qty_changed, function (x) { return x.id + " · " + x.name + ": " + x.from + " → " + x.to; }),
      changeList("Imágenes", c.images_changed, function (x) { return x.id + " · " + x.name; }),
      changeList("Nombre, detalle o categoría", c.details_changed, function (x) { return x.id + " · " + x.name; }),
    ];
    if (r) {
      lists.push(changeList("Omitidas del Excel", { total: r.skipped.length, items: r.skipped }, String));
      lists.push(changeList("Avisos del Excel", { total: r.warnings.length, items: r.warnings }, String));
    }
    var any = lists.some(Boolean);
    var publishBtn = el("button", { class: "btn", type: "button", text: "Publicar en la web", onclick: publish });
    if (d.stale) publishBtn.disabled = true;
    box.replaceChildren(el("div", { class: "draft" + (d.stale ? " stale" : "") }, [
      el("h3", { text: "Borrador sin publicar · " + d.count + " artículos" }),
      el("p", { class: "small muted", text: "Último cambio " + when(d.updated_at) + (r ? " · Excel: hoja " + r.sheet + ", " + r.rows_read + " filas leídas" : "") }),
      d.stale ? el("p", { text: "Este borrador se armó sobre una publicación anterior y alguien publicó después. Descartalo y volvé a hacer el cambio." }) : null,
      el("div", { class: "changes" }, any ? lists.filter(Boolean) : [el("p", { text: "El borrador es igual a lo publicado." })]),
      el("div", { class: "row" }, [
        publishBtn,
        el("button", { class: "btn ghost", type: "button", text: "Descartar borrador", onclick: discard }),
      ]),
    ]));
  }

  function refresh() {
    return api("/status").then(renderStatus).catch(function (e) { toast(e.message, true); });
  }

  function publish(ev) {
    if (!state.draft) return;
    if (!confirm("¿Publicar el borrador? La web se actualiza en segundos.")) return;
    busy(ev.target, true);
    api("/publish", { method: "POST", json: { draft_id: state.draft.id } })
      .then(function (r) { toast("Publicado: publicación #" + r.version + " · " + r.count + " artículos."); return Promise.all([refresh(), loadVersions()]); })
      .catch(function (e) { toast(e.message, true); refresh(); })
      .finally(function () { busy(ev.target, false); });
  }

  function discard(ev) {
    if (!confirm("¿Descartar todos los cambios sin publicar?")) return;
    busy(ev.target, true);
    api("/draft/discard", { method: "POST", json: {} })
      .then(function () { toast("Borrador descartado."); return refresh(); })
      .catch(function (e) { toast(e.message, true); })
      .finally(function () { busy(ev.target, false); });
  }

  // ---- Workbook --------------------------------------------------------------

  function setupImport() {
    var form = $("#import-form");
    var input = form.querySelector("input[type=file]");
    input.addEventListener("change", function () {
      form.querySelector(".file span").textContent = input.files[0] ? input.files[0].name : "Elegir archivo";
    });
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var file = input.files[0];
      if (!file) return;
      var btn = form.querySelector("button");
      busy(btn, true);
      // The workbook is parsed here, with the same importer the server uses
      // for validation rules; only the public columns are sent.
      Promise.all([import("./importer.bundle.js"), file.arrayBuffer(), api("/images")])
        .then(function (r) {
          var mod = r[0];
          var wb = mod.readWorkbook(new Uint8Array(r[1]), file.name);
          return mod.buildInventory(wb, { images: r[2] }).catch(function (e) { throw e; });
        })
        .then(function (built) {
          return api("/import", { method: "POST", json: { payload: built.payload, report: built.report, filename: file.name } });
        })
        .then(function (r) {
          renderDraft(r.draft); state.draft = r.draft;
          toast("Borrador creado: " + r.draft.count + " artículos. Revisalo y publicá.");
          location.hash = "#estado";
          form.reset(); form.querySelector(".file span").textContent = "Elegir archivo";
        })
        .catch(function (e) { toast(e.message, true); })
        .finally(function () { busy(btn, false); });
    });
  }

  // ---- Images ----------------------------------------------------------------

  var queue = [];

  function guessCode(name) { var m = /bo-\d{5}(?!\d)/i.exec(name); return m ? m[0].toUpperCase() : ""; }

  function addFiles(files) {
    Array.prototype.forEach.call(files, function (file) {
      if (!/^image\//.test(file.type)) return;
      var row = $("#tpl-queue-row").content.firstElementChild.cloneNode(true);
      var entry = { file: file, row: row, done: false };
      row.querySelector("img").src = URL.createObjectURL(file);
      row.querySelector(".qname").textContent = file.name;
      row.querySelector(".qcode").value = guessCode(file.name);
      if (/flyer/i.test(file.name)) row.querySelector(".qkind").value = /\ben\b|_en\b|-en\b|english/i.test(file.name) ? "flyer_en" : "flyer_es";
      row.querySelector(".x").addEventListener("click", function () {
        queue = queue.filter(function (q) { return q !== entry; });
        row.remove(); syncImageActions();
      });
      queue.push(entry);
      $("#image-queue").appendChild(row);
    });
    syncImageActions();
  }

  function syncImageActions() { $("#image-actions").hidden = !queue.some(function (q) { return !q.done; }); }

  // Big photos straight from a phone are shrunk to 1600 px JPEG. Smaller files
  // go as-is, which keeps any BO-xxxxx code stored in their metadata.
  function shrink(file) {
    if (file.size < 1.5 * 1024 * 1024 || !window.createImageBitmap) return Promise.resolve(file);
    return createImageBitmap(file).then(function (bmp) {
      var scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      var canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
      canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) { resolve(blob ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : file); }, "image/jpeg", 0.85);
      });
    }).catch(function () { return file; });
  }

  function uploadOne(entry) {
    var status = entry.row.querySelector(".qstatus");
    status.className = "qstatus small"; status.textContent = "Preparando…";
    return shrink(entry.file).then(function (file) { return send(entry, file); });
  }

  function send(entry, file) {
    var status = entry.row.querySelector(".qstatus");
    var fd = new FormData();
    fd.append("file", file);
    fd.append("code", entry.row.querySelector(".qcode").value.trim());
    fd.append("kind", entry.row.querySelector(".qkind").value);
    status.className = "qstatus small"; status.textContent = "Subiendo…";
    return api("/images", { method: "POST", form: fd }).then(function (r) {
      entry.done = true;
      entry.row.querySelector(".qcode").value = r.code;
      status.className = "qstatus small ok";
      status.textContent = r.attached_to_draft ? "Listo: " + r.code + " (en el borrador)" : "Guardada: " + r.code + " todavía no está en el inventario.";
      return r;
    }).catch(function (e) {
      status.className = "qstatus small err"; status.textContent = e.message;
    });
  }

  function setupImages() {
    var drop = $("#drop");
    var input = $("#image-input");
    input.addEventListener("change", function () { addFiles(input.files); input.value = ""; });
    ["dragenter", "dragover"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
    drop.addEventListener("drop", function (e) { addFiles(e.dataTransfer.files); });
    $("#clear-images").addEventListener("click", function () { queue = []; $("#image-queue").replaceChildren(); syncImageActions(); });
    $("#upload-images").addEventListener("click", function (ev) {
      busy(ev.target, true);
      // Sequential: each upload updates the same draft.
      queue.filter(function (q) { return !q.done; }).reduce(function (p, entry) {
        return p.then(function () { return uploadOne(entry); });
      }, Promise.resolve()).then(function () {
        syncImageActions(); refresh();
        if (queue.every(function (q) { return q.done; })) toast("Imágenes subidas. Revisá el borrador y publicá.");
      }).finally(function () { busy(ev.target, false); });
    });
  }

  // ---- Items -----------------------------------------------------------------

  function itemCard(it) {
    var img = it.foto || it.flyer_es || it.flyer_en;
    var priceIn = el("input", { type: "number", min: "0", step: "500", value: it.price_crc === undefined ? "" : it.price_crc, "aria-label": "Precio" });
    var qtyIn = el("input", { type: "number", min: "0", step: "1", value: it.qty, "aria-label": "Cantidad" });
    function save(ev) {
      var ops = [];
      var p = priceIn.value === "" ? null : Number(priceIn.value);
      if (p !== (it.price_crc === undefined ? null : it.price_crc)) ops.push({ op: "set_price", id: it.id, price_crc: p });
      if (Number(qtyIn.value) !== it.qty) ops.push({ op: "set_quantity", id: it.id, qty: Number(qtyIn.value) });
      if (!ops.length) return toast("No hay cambios en " + it.id + ".");
      edit(ops, ev.target, it.id + " actualizado en el borrador.");
    }
    function sold(ev) {
      if (!confirm("¿Quitar " + it.id + " de la web (vendido)?")) return;
      edit([{ op: "remove", id: it.id }], ev.target, it.id + " se quita al publicar.");
    }
    return el("div", { class: "item" }, [
      img ? el("img", { src: "/" + img.replace(/^\//, ""), alt: "", loading: "lazy" }) : el("div", { class: "ph" }),
      el("div", {}, [
        el("h4", { text: it.name_es }),
        el("p", { class: "meta", text: it.id + " · " + it.category + " · " + price(it.price_crc) + " · " + it.qty + " u." }),
        el("div", { class: "edit" }, [
          el("label", {}, ["₡", priceIn]),
          el("label", {}, ["Cant.", qtyIn]),
          el("button", { class: "btn small", type: "button", text: "Guardar", onclick: save }),
          el("button", { class: "btn small danger", type: "button", text: "Vendido", onclick: sold }),
        ]),
      ]),
    ]);
  }

  function edit(ops, btn, ok) {
    busy(btn, true);
    api("/edits", { method: "POST", json: { ops: ops } })
      .then(function (r) { state.draft = r.draft; renderDraft(r.draft); toast(ok); search(); })
      .catch(function (e) { toast(e.message, true); })
      .finally(function () { busy(btn, false); });
  }

  function search(ev) {
    if (ev) ev.preventDefault();
    var q = $("#search-form input").value.trim();
    if (!q) return;
    api("/items?q=" + encodeURIComponent(q)).then(function (r) {
      var out = $("#results");
      if (!r.total) return out.replaceChildren(el("p", { class: "muted", text: "Sin resultados." }));
      out.replaceChildren(
        el("p", { class: "small muted", text: r.total + " resultado(s)" + (r.total > r.items.length ? ", se muestran " + r.items.length : "") + (r.from === "draft" ? " · mostrando el borrador" : "") }),
        el("div", { class: "items" }, r.items.map(itemCard))
      );
    }).catch(function (e) { toast(e.message, true); });
  }

  // ---- History ---------------------------------------------------------------

  function loadVersions() {
    return api("/versions").then(function (r) {
      var box = $("#versions");
      if (!r.versions.length) return box.replaceChildren(el("p", { class: "muted", text: "Todavía no hay publicaciones desde el panel." }));
      box.replaceChildren(el("div", { class: "table-wrap" }, [el("table", {}, [
        el("thead", {}, [el("tr", {}, ["Publicación", "Fecha", "Quién", "Artículos", "Cambios", ""].map(function (h) { return el("th", { text: h }); }))]),
        el("tbody", {}, r.versions.map(function (v) {
          var current = state.live && v.version === state.live.version;
          return el("tr", {}, [
            el("td", { text: "#" + v.version + (current ? " (actual)" : "") }),
            el("td", { text: when(v.published_at) }),
            el("td", { text: v.published_by || "" }),
            el("td", { text: v.count || "" }),
            el("td", { class: "small", text: (v.source || "") + (v.summary ? " · " + v.summary : "") }),
            el("td", {}, [current ? null : el("button", {
              class: "btn small ghost", type: "button", text: "Restaurar",
              onclick: function (ev) {
                if (!confirm("¿Crear un borrador con la publicación #" + v.version + "? Reemplaza el borrador actual.")) return;
                busy(ev.target, true);
                api("/restore", { method: "POST", json: { version: v.version } })
                  .then(function (res) { state.draft = res.draft; renderDraft(res.draft); location.hash = "#estado"; toast("Borrador con la publicación #" + v.version + ". Revisalo y publicá."); })
                  .catch(function (e) { toast(e.message, true); })
                  .finally(function () { busy(ev.target, false); });
              },
            })]),
          ]);
        })),
      ])]));
    }).catch(function (e) { toast(e.message, true); });
  }

  // ---- Boot --------------------------------------------------------------------

  function showLogin() {
    $("#app").hidden = true; $("#tabs").hidden = true; $("#logout").hidden = true;
    $("#who").textContent = "";
    $("#login").hidden = false;
  }

  function showApp(email) {
    $("#login").hidden = true;
    $("#app").hidden = false; $("#tabs").hidden = false; $("#logout").hidden = false;
    $("#who").textContent = email;
    refresh().then(loadVersions);
  }

  document.addEventListener("DOMContentLoaded", function () {
    setupImport();
    setupImages();
    $("#search-form").addEventListener("submit", search);
    $("#login-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var f = ev.target, btn = f.querySelector("button");
      busy(btn, true);
      api("/login", { method: "POST", json: { email: f.email.value, password: f.password.value } })
        .then(function (r) { f.reset(); showApp(r.email); })
        .catch(function (e) { toast(e.message, true); })
        .finally(function () { busy(btn, false); });
    });
    $("#logout").addEventListener("click", function () {
      api("/logout", { method: "POST", json: {} }).finally(showLogin);
    });
    api("/whoami").then(function (r) { showApp(r.email); }).catch(showLogin);
  });
})();
