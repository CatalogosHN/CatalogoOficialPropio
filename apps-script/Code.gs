const CONFIG = {
  EMAIL_DESTINO: "", // Opcional: deja vacío para usar el correo propietario del script.
  NOMBRE_HOJA: "Pedidos",
  NOMBRE_ARCHIVO: "Pedidos - International Items HN",
  ZONA_HORARIA: "America/Tegucigalpa"
};

function doGet() {
  return HtmlService.createHtmlOutput("Backend de pedidos activo.")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  let result;
  try {
    const payload = JSON.parse((e && e.parameter && e.parameter.payload) || "{}");
    validatePayload_(payload);
    const orderId = createOrderId_();
    saveOrder_(orderId, payload);
    sendOrderEmail_(orderId, payload);
    result = { ok: true, orderId: orderId };
  } catch (error) {
    console.error(error);
    result = { ok: false, message: String(error && error.message || error) };
  }
  return responsePage_(result);
}

function validatePayload_(p) {
  if (!p || typeof p !== "object") throw new Error("Pedido vacío.");
  if (p.website) throw new Error("Solicitud bloqueada.");
  if (!p.client || !p.client.nombre || !p.client.telefono1) throw new Error("Faltan datos del cliente.");
  if (!Array.isArray(p.items) || !p.items.length) throw new Error("El carrito está vacío.");
  if (p.items.length > 100) throw new Error("Demasiados productos.");
  const cache = CacheService.getScriptCache();
  const key = "rate_" + String(p.client.telefono1).replace(/\D/g, "").slice(-12);
  if (cache.get(key)) throw new Error("Este pedido ya fue recibido recientemente.");
  cache.put(key, "1", 45);
}

function createOrderId_() {
  const stamp = Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, "yyyyMMdd-HHmmss");
  return "II-" + stamp + "-" + Math.floor(100 + Math.random() * 900);
}

function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty("ORDERS_SPREADSHEET_ID");
  if (savedId) {
    try { return SpreadsheetApp.openById(savedId); } catch (err) {}
  }
  const ss = SpreadsheetApp.create(CONFIG.NOMBRE_ARCHIVO);
  props.setProperty("ORDERS_SPREADSHEET_ID", ss.getId());
  return ss;
}

function getSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(CONFIG.NOMBRE_HOJA);
  if (!sh) sh = ss.insertSheet(CONFIG.NOMBRE_HOJA);
  if (sh.getLastRow() === 0) {
    sh.appendRow(["Fecha", "Pedido", "Cliente", "Teléfono 1", "Teléfono 2", "Ubicación", "Dirección", "Referencia", "Día", "Vendedor", "Pago", "Productos", "Subtotal", "Envío", "Total", "Origen"]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function saveOrder_(id, p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const c = p.client;
    const products = p.items.map(i => `${i.qty} × ${i.name} — L ${Number(i.subtotal || 0).toLocaleString("es-HN")}`).join("\n");
    getSheet_().appendRow([new Date(), id, c.nombre, c.telefono1, c.telefono2 || "", c.ubicacion || "", c.direccion || "", c.referencia || "", c.dia || "", c.vendedor || "", c.metodoPago || "", products, Number(p.subtotal || 0), Number(p.shipping || 0), Number(p.total || 0), p.source || ""]);
  } finally { lock.releaseLock(); }
}

function sendOrderEmail_(id, p) {
  const c = p.client;
  const email = CONFIG.EMAIL_DESTINO || Session.getEffectiveUser().getEmail();
  if (!email) throw new Error("Configura EMAIL_DESTINO en Code.gs.");
  const itemsHtml = p.items.map(i => `<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml_(i.qty + " × " + i.name)}</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">L ${Number(i.subtotal || 0).toLocaleString("es-HN")}</td></tr>`).join("");
  const body = `<div style="font-family:Arial,sans-serif;max-width:720px;margin:auto;color:#0f172a"><div style="background:#0b5cff;color:white;padding:20px;border-radius:14px 14px 0 0"><h2 style="margin:0">Nuevo pedido ${escapeHtml_(id)}</h2></div><div style="border:1px solid #e5e7eb;padding:20px;border-radius:0 0 14px 14px"><h3>Cliente</h3><p><b>Nombre:</b> ${escapeHtml_(c.nombre)}<br><b>Teléfono:</b> ${escapeHtml_(c.telefono1)} ${c.telefono2 ? "/ " + escapeHtml_(c.telefono2) : ""}<br><b>Ubicación:</b> ${escapeHtml_(c.ubicacion || "")}<br><b>Dirección:</b> ${escapeHtml_(c.direccion || "")} — ${escapeHtml_(c.referencia || "")}<br><b>Día:</b> ${escapeHtml_(c.dia || "")}<br><b>Vendedor:</b> ${escapeHtml_(c.vendedor || "")}<br><b>Pago:</b> ${escapeHtml_(c.metodoPago || "")}</p><h3>Productos</h3><table style="width:100%;border-collapse:collapse">${itemsHtml}</table><p style="font-size:16px"><b>Subtotal:</b> L ${Number(p.subtotal || 0).toLocaleString("es-HN")}<br><b>Envío:</b> ${Number(p.shipping || 0) === 0 ? "GRATIS" : "L " + Number(p.shipping || 0).toLocaleString("es-HN")}<br><b>Total: L ${Number(p.total || 0).toLocaleString("es-HN")}</b></p></div></div>`;
  MailApp.sendEmail({to: email, subject: `Nuevo pedido ${id} — ${c.nombre}`, htmlBody: body, name: "International Items HN"});
}

function responsePage_(result) {
  const data = JSON.stringify({type: "INTERNATIONAL_ITEMS_ORDER", ok: !!result.ok, orderId: result.orderId || "", message: result.message || ""}).replace(/</g, "\\u003c");
  return HtmlService.createHtmlOutput(`<script>window.parent.postMessage(${data}, "*");<\/script><p style="font-family:Arial">${result.ok ? "Pedido recibido." : "No se pudo registrar el pedido."}</p>`).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function escapeHtml_(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
