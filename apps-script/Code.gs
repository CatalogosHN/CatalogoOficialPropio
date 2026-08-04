/**
 * International Items HN — Backend seguro de pedidos
 * Drive: WebsEmpresa/GmailPedidos
 * Incluye reintentos sin duplicar pedidos.
 */

const CONFIG = {
  EMAIL_DESTINO: "", // Opcional: deja vacío para usar el correo propietario del script.
  NOMBRE_HOJA: "Pedidos",
  NOMBRE_ARCHIVO: "Pedidos - International Items HN",
  RUTA_DRIVE: ["WebsEmpresa", "GmailPedidos"],
  GUARDAR_RESPALDO_JSON: true,
  GUARDAR_FICHA_HTML: true,
  ZONA_HORARIA: "America/Tegucigalpa"
};

function doGet() {
  return HtmlService.createHtmlOutput("Backend de pedidos activo.")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  let result;
  let requestId = "";
  try {
    const payload = JSON.parse((e && e.parameter && e.parameter.payload) || "{}");
    validatePayload_(payload);
    requestId = normalizeRequestId_(payload.requestId);
    maybeCleanupRequestStates_();

    let state = getRequestState_(requestId);
    if (state && state.status === "complete") {
      result = { ok: true, orderId: state.orderId, requestId: requestId, duplicate: true };
      return responsePage_(result);
    }

    if (!state) {
      const existingOrderId = findExistingOrderByRequestId_(requestId);
      if (existingOrderId) {
        result = { ok: true, orderId: existingOrderId, requestId: requestId, duplicate: true };
        return responsePage_(result);
      }
    }

    if (state && state.status === "processing" && Date.now() - Number(state.updatedAt || 0) < 120000) {
      result = {
        ok: false,
        processing: true,
        orderId: state.orderId,
        requestId: requestId,
        message: "El pedido todavía está siendo procesado. Espera unos segundos y vuelve a intentarlo."
      };
      return responsePage_(result);
    }

    const orderId = state && state.orderId ? state.orderId : createOrderId_();
    state = Object.assign({
      requestId: requestId,
      orderId: orderId,
      sheetSaved: false,
      documentationSaved: false,
      emailSent: false,
      createdAt: Date.now()
    }, state || {}, {
      status: "processing",
      updatedAt: Date.now()
    });
    saveRequestState_(requestId, state);

    if (!state.sheetSaved) {
      saveOrder_(orderId, payload, requestId);
      state.sheetSaved = true;
      state.updatedAt = Date.now();
      saveRequestState_(requestId, state);
    }

    if (!state.documentationSaved) {
      saveOrderDocumentation_(orderId, payload, requestId);
      state.documentationSaved = true;
      state.updatedAt = Date.now();
      saveRequestState_(requestId, state);
    }

    if (!state.emailSent) {
      sendOrderEmail_(orderId, payload);
      state.emailSent = true;
      state.updatedAt = Date.now();
      saveRequestState_(requestId, state);
    }

    state.status = "complete";
    state.updatedAt = Date.now();
    saveRequestState_(requestId, state);
    result = { ok: true, orderId: orderId, requestId: requestId };
  } catch (error) {
    console.error(error);
    if (requestId) {
      const failedState = getRequestState_(requestId) || { requestId: requestId };
      failedState.status = "failed";
      failedState.message = String(error && error.message || error);
      failedState.updatedAt = Date.now();
      saveRequestState_(requestId, failedState);
    }
    result = {
      ok: false,
      requestId: requestId,
      message: String(error && error.message || error)
    };
  }
  return responsePage_(result);
}

function validatePayload_(p) {
  if (!p || typeof p !== "object") throw new Error("Pedido vacío.");
  if (p.website) throw new Error("Solicitud bloqueada.");
  if (!p.client || !p.client.nombre || !p.client.telefono1) throw new Error("Faltan datos del cliente.");
  if (!Array.isArray(p.items) || !p.items.length) throw new Error("El carrito está vacío.");
  if (p.items.length > 100) throw new Error("Demasiados productos.");
  if (!p.requestId) throw new Error("Falta el identificador seguro del pedido.");
}

function normalizeRequestId_(value) {
  const clean = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
  if (clean.length < 8) throw new Error("Identificador de pedido inválido.");
  return clean;
}

function requestPropertyKey_(requestId) {
  return "ORDER_REQUEST_" + requestId;
}

function getRequestState_(requestId) {
  const raw = PropertiesService.getScriptProperties().getProperty(requestPropertyKey_(requestId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (error) { return null; }
}

function saveRequestState_(requestId, state) {
  PropertiesService.getScriptProperties().setProperty(requestPropertyKey_(requestId), JSON.stringify(state));
}

function maybeCleanupRequestStates_() {
  const props = PropertiesService.getScriptProperties();
  const now = Date.now();
  const lastCleanup = Number(props.getProperty("LAST_REQUEST_CLEANUP") || 0);
  if (now - lastCleanup < 24 * 60 * 60 * 1000) return;

  const all = props.getProperties();
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  Object.keys(all).forEach(function(key) {
    if (key.indexOf("ORDER_REQUEST_") !== 0) return;
    try {
      const state = JSON.parse(all[key]);
      if (Number(state.updatedAt || 0) < cutoff && state.status !== "processing") {
        props.deleteProperty(key);
      }
    } catch (error) {
      props.deleteProperty(key);
    }
  });
  props.setProperty("LAST_REQUEST_CLEANUP", String(now));
}

function createOrderId_() {
  const stamp = Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, "yyyyMMdd-HHmmss");
  return "II-" + stamp + "-" + Math.floor(100 + Math.random() * 900);
}

function getStorageFolder_() {
  let folder = DriveApp.getRootFolder();
  CONFIG.RUTA_DRIVE.forEach(function(name) {
    const matches = folder.getFoldersByName(name);
    folder = matches.hasNext() ? matches.next() : folder.createFolder(name);
  });
  return folder;
}

function moveFileToStorage_(fileId) {
  const file = DriveApp.getFileById(fileId);
  file.moveTo(getStorageFolder_());
  return file;
}

function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty("ORDERS_SPREADSHEET_ID");
  if (savedId) {
    try {
      const ss = SpreadsheetApp.openById(savedId);
      moveFileToStorage_(ss.getId());
      return ss;
    } catch (error) {
      props.deleteProperty("ORDERS_SPREADSHEET_ID");
    }
  }
  const ss = SpreadsheetApp.create(CONFIG.NOMBRE_ARCHIVO);
  moveFileToStorage_(ss.getId());
  props.setProperty("ORDERS_SPREADSHEET_ID", ss.getId());
  return ss;
}

function getSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(CONFIG.NOMBRE_HOJA);
  if (!sheet) {
    const first = ss.getSheets()[0];
    const firstIsEmpty = first && first.getLastRow() === 0 && first.getLastColumn() === 0;
    sheet = firstIsEmpty ? first.setName(CONFIG.NOMBRE_HOJA) : ss.insertSheet(CONFIG.NOMBRE_HOJA);
  }
  ensureHeaders_(sheet);
  return sheet;
}

function ensureHeaders_(sheet) {
  const headers = [
    "Fecha", "Pedido", "Cliente", "Teléfono 1", "Teléfono 2", "Ubicación",
    "Dirección", "Referencia", "Día", "Vendedor", "Pago", "Productos",
    "Subtotal", "Envío", "Total", "Origen", "ID solicitud"
  ];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    return;
  }
  const current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
  headers.forEach(function(header, index) {
    if (!current[index]) sheet.getRange(1, index + 1).setValue(header);
  });
  sheet.setFrozenRows(1);
}

function findExistingOrderByRequestId_(requestId) {
  const sheet = getSheet_();
  if (sheet.getLastRow() < 2) return "";
  const match = sheet.getRange(2, 17, sheet.getLastRow() - 1, 1)
    .createTextFinder(requestId)
    .matchEntireCell(true)
    .findNext();
  return match ? String(sheet.getRange(match.getRow(), 2).getValue() || "") : "";
}

function requestAlreadyInSheet_(sheet, requestId) {
  if (sheet.getLastRow() < 2) return false;
  const range = sheet.getRange(2, 17, sheet.getLastRow() - 1, 1);
  return Boolean(range.createTextFinder(requestId).matchEntireCell(true).findNext());
}

function saveOrder_(id, p, requestId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_();
    if (requestAlreadyInSheet_(sheet, requestId)) return;
    const c = p.client;
    const products = p.items.map(function(item) {
      return item.qty + " × " + item.name + " — L " + Number(item.subtotal || 0).toLocaleString("es-HN");
    }).join("\n");
    sheet.appendRow([
      new Date(), id, c.nombre, c.telefono1, c.telefono2 || "", c.ubicacion || "",
      c.direccion || "", c.referencia || "", c.dia || "", c.vendedor || "",
      c.metodoPago || "", products, Number(p.subtotal || 0), Number(p.shipping || 0),
      Number(p.total || 0), p.source || "", requestId
    ]);
  } finally {
    lock.releaseLock();
  }
}

function getDocumentationFolder_() {
  const base = getStorageFolder_();
  const year = Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, "yyyy");
  const month = Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, "MM");
  const backups = getOrCreateChildFolder_(base, "DocumentacionPedidos");
  return getOrCreateChildFolder_(getOrCreateChildFolder_(backups, year), month);
}

function getOrCreateChildFolder_(parent, name) {
  const matches = parent.getFoldersByName(name);
  return matches.hasNext() ? matches.next() : parent.createFolder(name);
}

function createFileIfMissing_(folder, name, blob) {
  if (folder.getFilesByName(name).hasNext()) return;
  folder.createFile(blob.setName(name));
}

function saveOrderDocumentation_(id, p, requestId) {
  if (!CONFIG.GUARDAR_RESPALDO_JSON && !CONFIG.GUARDAR_FICHA_HTML) return;
  const folder = getDocumentationFolder_();
  const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, "_");

  if (CONFIG.GUARDAR_RESPALDO_JSON) {
    const json = JSON.stringify({
      orderId: id,
      requestId: requestId,
      receivedAt: Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      order: p
    }, null, 2);
    createFileIfMissing_(folder, safeId + ".json", Utilities.newBlob(json, "application/json"));
  }

  if (CONFIG.GUARDAR_FICHA_HTML) {
    const c = p.client;
    const rows = p.items.map(function(item) {
      return `<tr><td>${escapeHtml_(item.qty + " × " + item.name)}</td><td style="text-align:right">L ${Number(item.subtotal || 0).toLocaleString("es-HN")}</td></tr>`;
    }).join("");
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml_(id)}</title><style>body{font-family:Arial,sans-serif;color:#0f172a;max-width:850px;margin:32px auto;padding:0 18px}h1{color:#0b5cff}table{width:100%;border-collapse:collapse}td,th{padding:9px;border-bottom:1px solid #ddd}.totales{text-align:right;font-size:17px;line-height:1.7}.dato{margin:4px 0}</style></head><body><h1>Pedido ${escapeHtml_(id)}</h1><p class="dato"><b>ID solicitud:</b> ${escapeHtml_(requestId)}</p><p class="dato"><b>Fecha:</b> ${escapeHtml_(Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, "dd/MM/yyyy hh:mm a"))}</p><h2>Cliente</h2><p class="dato"><b>Nombre:</b> ${escapeHtml_(c.nombre)}</p><p class="dato"><b>Teléfono:</b> ${escapeHtml_(c.telefono1)} ${c.telefono2 ? "/ " + escapeHtml_(c.telefono2) : ""}</p><p class="dato"><b>Ubicación:</b> ${escapeHtml_(c.ubicacion || "")}</p><p class="dato"><b>Dirección:</b> ${escapeHtml_(c.direccion || "")}</p><p class="dato"><b>Referencia:</b> ${escapeHtml_(c.referencia || "")}</p><p class="dato"><b>Día:</b> ${escapeHtml_(c.dia || "")}</p><p class="dato"><b>Vendedor:</b> ${escapeHtml_(c.vendedor || "")}</p><p class="dato"><b>Pago:</b> ${escapeHtml_(c.metodoPago || "")}</p><h2>Productos</h2><table><tbody>${rows}</tbody></table><p class="totales"><b>Subtotal:</b> L ${Number(p.subtotal || 0).toLocaleString("es-HN")}<br><b>Envío:</b> ${Number(p.shipping || 0) === 0 ? "GRATIS" : "L " + Number(p.shipping || 0).toLocaleString("es-HN")}<br><b>Total:</b> L ${Number(p.total || 0).toLocaleString("es-HN")}</p></body></html>`;
    createFileIfMissing_(folder, safeId + ".html", Utilities.newBlob(html, "text/html"));
  }
}

function prepararAlmacenamiento() {
  const folder = getStorageFolder_();
  const ss = getSpreadsheet_();
  const docs = getDocumentationFolder_();
  getSheet_();
  const result = {
    carpeta: folder.getUrl(),
    hoja: ss.getUrl(),
    documentacion: docs.getUrl(),
    ruta: CONFIG.RUTA_DRIVE.join("/")
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function sendOrderEmail_(id, p) {
  const c = p.client;
  const email = CONFIG.EMAIL_DESTINO || Session.getEffectiveUser().getEmail();
  if (!email) throw new Error("Configura EMAIL_DESTINO en Code.gs.");
  const itemsHtml = p.items.map(function(item) {
    return `<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml_(item.qty + " × " + item.name)}</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">L ${Number(item.subtotal || 0).toLocaleString("es-HN")}</td></tr>`;
  }).join("");
  const body = `<div style="font-family:Arial,sans-serif;max-width:720px;margin:auto;color:#0f172a"><div style="background:#0b5cff;color:white;padding:20px;border-radius:14px 14px 0 0"><h2 style="margin:0">Nuevo pedido ${escapeHtml_(id)}</h2></div><div style="border:1px solid #e5e7eb;padding:20px;border-radius:0 0 14px 14px"><h3>Cliente</h3><p><b>Nombre:</b> ${escapeHtml_(c.nombre)}<br><b>Teléfono:</b> ${escapeHtml_(c.telefono1)} ${c.telefono2 ? "/ " + escapeHtml_(c.telefono2) : ""}<br><b>Ubicación:</b> ${escapeHtml_(c.ubicacion || "")}<br><b>Dirección:</b> ${escapeHtml_(c.direccion || "")} — ${escapeHtml_(c.referencia || "")}<br><b>Día:</b> ${escapeHtml_(c.dia || "")}<br><b>Vendedor:</b> ${escapeHtml_(c.vendedor || "")}<br><b>Pago:</b> ${escapeHtml_(c.metodoPago || "")}</p><h3>Productos</h3><table style="width:100%;border-collapse:collapse">${itemsHtml}</table><p style="font-size:16px"><b>Subtotal:</b> L ${Number(p.subtotal || 0).toLocaleString("es-HN")}<br><b>Envío:</b> ${Number(p.shipping || 0) === 0 ? "GRATIS" : "L " + Number(p.shipping || 0).toLocaleString("es-HN")}<br><b>Total: L ${Number(p.total || 0).toLocaleString("es-HN")}</b></p></div></div>`;
  MailApp.sendEmail({
    to: email,
    subject: `Nuevo pedido ${id} — ${c.nombre}`,
    htmlBody: body,
    name: "International Items HN"
  });
}

function responsePage_(result) {
  const data = JSON.stringify({
    type: "INTERNATIONAL_ITEMS_ORDER",
    ok: Boolean(result.ok),
    processing: Boolean(result.processing),
    orderId: result.orderId || "",
    requestId: result.requestId || "",
    message: result.message || ""
  }).replace(/</g, "\\u003c");
  const html = `<script>(function(){var data=${data};try{window.parent.postMessage(data,"*");}catch(e){}try{window.top.postMessage(data,"*");}catch(e){}})();<\/script><p style="font-family:Arial">${result.ok ? "Pedido recibido." : "No se pudo registrar el pedido."}</p>`;
  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function escapeHtml_(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function(char) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char];
  });
}
