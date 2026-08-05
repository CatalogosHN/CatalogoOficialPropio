(() => {
  'use strict';

  const cfg = window.SITE_CONFIG || {};
  const shipping = window.SHIPPING_DATA || {};
  const CART_KEY = 'international_items_cart_v2';
  const DRAFT_KEY = 'international_items_checkout_draft_v2';
  const PENDING_KEY = 'international_items_order_pending_v2';
  const pageCategory = (document.body.dataset.category || '').trim();

  let products = [];
  let categories = [];
  let view = [];
  let cart = loadCart();
  let viewer = { images: [], index: 0 };
  let sending = false;
  let progressValue = 0;
  let progressTimer = null;
  let responseTimer = null;
  let stateTimer = null;
  let currentRequestId = '';

  const $ = (selector, root = document) => root.querySelector(selector);
  const money = value => 'L ' + Number(value || 0).toLocaleString('es-HN', { maximumFractionDigits: 0 });
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const normalizeCategory = value => normalize(value).replace(/\s+/g, ' ').trim();

  function productCategories(product) {
    let list = [];
    if (Array.isArray(product?.categories)) {
      list = product.categories;
    } else if (typeof product?.categories === 'string') {
      list = product.categories.split(/[|,;]/g);
    }
    list = list
      .filter(value => typeof value === 'string' && value.trim())
      .map(value => value.trim());
    const primary = typeof product?.category === 'string' ? product.category.trim() : '';
    if (primary && !list.some(value => normalizeCategory(value) === normalizeCategory(primary))) {
      list.unshift(primary);
    }
    const seen = new Set();
    return list.filter(value => {
      const key = normalizeCategory(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function productBelongsTo(product, category) {
    const wanted = normalizeCategory(category);
    return !wanted || productCategories(product).some(value => normalizeCategory(value) === wanted);
  }

  function safeParse(value, fallback = null) {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }

  function toast(message) {
    const element = $('#toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove('show'), 2800);
  }

  function loadCart() {
    const stored = safeParse(localStorage.getItem(CART_KEY), []);
    return Array.isArray(stored) ? stored.filter(item => item && item.id && Number(item.qty) > 0) : [];
  }

  function saveCart() {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartUI();
  }

  function cartSubtotal() {
    return cart.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty) || 1), 0);
  }

  function totalQty() {
    return cart.reduce((sum, item) => sum + (Number(item.qty) || 1), 0);
  }

  function productById(id) {
    return products.find(product => product.id === id);
  }

  function syncCartWithCatalog() {
    let changed = false;
    cart = cart.map(item => {
      const product = productById(item.id);
      if (!product) return item;
      const updated = {
        ...item,
        name: product.name,
        price: Number(product.price) || 0,
        image: Array.isArray(product.images) ? (product.images[0] || '') : ''
      };
      if (updated.name !== item.name || updated.price !== Number(item.price) || updated.image !== item.image) changed = true;
      return updated;
    });
    if (changed) localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }

  async function init() {
    try {
      injectOrderExperience();
      const fresh = Date.now();
      const [productData, categoryData] = await Promise.all([
        fetch(`data/productos.json?v=${fresh}`, { cache: 'no-store' }).then(response => {
          if (!response.ok) throw new Error(`No se pudo cargar productos.json (${response.status}).`);
          return response.json();
        }),
        fetch(`data/categorias.json?v=${fresh}`, { cache: 'no-store' }).then(response => {
          if (!response.ok) throw new Error(`No se pudo cargar categorias.json (${response.status}).`);
          return response.json();
        })
      ]);
      products = Array.isArray(productData.products) ? productData.products : [];
      categories = Array.isArray(categoryData.categories) ? categoryData.categories : [];
      syncCartWithCatalog();
      setupHeader();
      fillFilters();
      bind();
      restoreCheckoutDraft();
      render();
      updateCartUI();
      recoverInterruptedOrder();
      deepLink();
    } catch (error) {
      console.error(error);
      $('#product-grid').innerHTML = '<p>No se pudo cargar el catálogo. Publica la carpeta completa en GitHub Pages.</p>';
    }
  }

  function setupHeader() {
    const meta = categories.find(category => category.name === pageCategory);
    $('#catalog-title').textContent = pageCategory || 'Todos los productos';
    $('#catalog-description').textContent = meta?.description || 'Explora todos los productos disponibles de International Items HN.';
    $('#category-icon').textContent = meta?.icon || '🛍️';
    document.title = (pageCategory || 'Catálogo completo') + ' | International Items HN';
    const whatsapp = cfg.whatsappNumber || '50496310102';
    $('#floating-wa').href = `https://wa.me/${whatsapp}?text=${encodeURIComponent('Hola, estoy viendo el catálogo de International Items.')}`;
  }

  function fillFilters() {
    const select = $('#category-filter');
    select.innerHTML = '<option value="">Todas las categorías</option>' + categories.map(category => {
      const count = products.filter(product => productBelongsTo(product, category.name)).length;
      return `<option value="${esc(category.name)}">${esc(category.name)} (${count})</option>`;
    }).join('');
    if (pageCategory) {
      select.value = pageCategory;
      select.disabled = true;
    }
  }

  function render() {
    const query = normalize($('#search-products').value);
    const category = pageCategory || $('#category-filter').value;
    let list = products.filter(product =>
      productBelongsTo(product, category) &&
      (!query || normalize(product.name + ' ' + (Array.isArray(product.description) ? product.description.join(' ') : '')).includes(query))
    );
    const sort = $('#sort-products').value;
    if (sort === 'price-asc') list.sort((a, b) => a.price - b.price);
    if (sort === 'price-desc') list.sort((a, b) => b.price - a.price);
    if (sort === 'az') list.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    view = list;
    $('#product-count').textContent = `${list.length} ${list.length === 1 ? 'producto' : 'productos'}`;
    $('#empty-products').hidden = Boolean(list.length);
    $('#product-grid').hidden = !list.length;
    $('#product-grid').innerHTML = list.map(card).join('');
  }

  function card(product) {
    const images = Array.isArray(product.images) ? product.images : [];
    const descriptions = Array.isArray(product.description) ? product.description : [];
    const image = images[0] || '';
    return `<article class="product-card" id="${esc(product.id)}" data-id="${esc(product.id)}">
      <div class="product-media">
        <img src="${esc(image)}" alt="${esc(product.name)}" loading="lazy" decoding="async" data-action="view">
        <span class="image-count">${images.length} foto${images.length === 1 ? '' : 's'}</span>
        ${images.length > 1 ? '<div class="image-nav"><button type="button" data-action="prev-image">‹</button><button type="button" data-action="next-image">›</button></div>' : ''}
      </div>
      <div class="product-body">
        <span class="category-tag">${esc(pageCategory || productCategories(product).join(' · ') || product.category || 'Otros')}</span>
        <h2>${esc(product.name)}</h2>
        <p class="product-description">${esc(descriptions[0] || '')}</p>
        <div class="product-bottom">
          <div class="price">${money(product.price)}</div>
          <div class="card-actions">
            <button class="add-cart" type="button" data-action="add">Agregar al carrito</button>
            <button class="share-button" type="button" data-action="share" aria-label="Compartir">↗</button>
          </div>
        </div>
      </div>
    </article>`;
  }

  function bind() {
    $('#search-products').addEventListener('input', render);
    $('#category-filter').addEventListener('change', render);
    $('#sort-products').addEventListener('change', render);
    $('#product-grid').addEventListener('click', onGridClick);
    $('#open-cart-top').addEventListener('click', openCart);
    $('#floating-cart').addEventListener('click', openCart);
    $('#close-cart').addEventListener('click', closeCart);
    $('#cart-overlay').addEventListener('click', event => {
      if (event.target === event.currentTarget) closeCart();
    });
    $('#cart-items').addEventListener('click', onCartClick);
    $('#checkout-button').addEventListener('click', openCheckout);
    $('#close-checkout').addEventListener('click', closeCheckout);
    $('#checkout-overlay').addEventListener('click', event => {
      if (event.target === event.currentTarget) closeCheckout();
    });

    const form = $('#checkout-form');
    form.vendedor.addEventListener('change', () => {
      toggleOther();
      fillAddresses();
      updateCheckoutTotals();
      saveCheckoutDraft();
    });
    form.dia.addEventListener('change', () => {
      toggleOther();
      saveCheckoutDraft();
    });
    form.direccion.addEventListener('change', () => {
      updateCheckoutTotals();
      saveCheckoutDraft();
    });
    form.addEventListener('input', saveCheckoutDraft);
    form.addEventListener('change', saveCheckoutDraft);
    form.addEventListener('submit', submitOrder);

    $('#viewer-close').addEventListener('click', closeViewer);
    $('#viewer-prev').addEventListener('click', () => moveViewer(-1));
    $('#viewer-next').addEventListener('click', () => moveViewer(1));
    $('#viewer').addEventListener('click', event => {
      if (event.target === event.currentTarget) closeViewer();
    });

    $('#recovery-open-checkout').addEventListener('click', () => {
      hideRecoveryBanner();
      openCheckout();
    });
    $('#recovery-dismiss').addEventListener('click', hideRecoveryBanner);

    window.addEventListener('message', handleBackendMessage);
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !sending) {
        closeViewer();
        closeCheckout();
        closeCart();
      }
      if (!$('#viewer').hidden && event.key === 'ArrowLeft') moveViewer(-1);
      if (!$('#viewer').hidden && event.key === 'ArrowRight') moveViewer(1);
    });

    window.addEventListener('beforeunload', event => {
      if (!sending) return;
      markPendingInterrupted();
      event.preventDefault();
      event.returnValue = '';
    });
    window.addEventListener('pagehide', () => {
      if (sending) markPendingInterrupted();
    });
  }

  function onGridClick(event) {
    const element = event.target.closest('.product-card');
    if (!element || sending) return;
    const product = productById(element.dataset.id);
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'add') addToCart(product);
    if (action === 'share') shareProduct(product);
    if (action === 'view') openViewer(product.images, Number(element.dataset.imageIndex || 0));
    if (action === 'prev-image' || action === 'next-image') {
      const delta = action === 'next-image' ? 1 : -1;
      let index = Number(element.dataset.imageIndex || 0);
      index = (index + delta + product.images.length) % product.images.length;
      element.dataset.imageIndex = index;
      $('.product-media img', element).src = product.images[index];
    }
  }

  function addToCart(product) {
    if (!product) return;
    const line = cart.find(item => item.id === product.id);
    if (line) line.qty = Math.min(100, line.qty + 1);
    else cart.push({ id: product.id, name: product.name, price: product.price, image: product.images[0] || '', qty: 1 });
    saveCart();
    toast('Producto agregado al carrito 🛒');
  }

  function updateCartUI() {
    const quantity = totalQty();
    $('#cart-count-top').textContent = quantity;
    $('#floating-cart-count').textContent = quantity;
    $('#cart-total').textContent = money(cartSubtotal());
    $('#cart-items').innerHTML = cart.length ? cart.map(item =>
      `<div class="cart-line" data-id="${esc(item.id)}">
        <img src="${esc(item.image)}" alt="">
        <div><h3>${esc(item.name)}</h3><strong>${money(item.price)}</strong>
          <div class="qty-controls"><button data-cart="minus">−</button><span>${item.qty}</span><button data-cart="plus">+</button></div>
        </div>
        <button class="remove-line" data-cart="remove">✕</button>
      </div>`
    ).join('') : '<div class="cart-empty">🛒<h3>Tu carrito está vacío</h3><p>Agrega productos desde cualquier categoría.</p></div>';
    $('#checkout-button').disabled = !cart.length;
    updateCheckoutTotals();
  }

  function onCartClick(event) {
    if (sending) return;
    const line = event.target.closest('.cart-line');
    if (!line) return;
    const index = cart.findIndex(item => item.id === line.dataset.id);
    const action = event.target.dataset.cart;
    if (index < 0 || !action) return;
    if (action === 'plus') cart[index].qty = Math.min(100, cart[index].qty + 1);
    if (action === 'minus') cart[index].qty = Math.max(1, cart[index].qty - 1);
    if (action === 'remove') cart.splice(index, 1);
    saveCart();
  }

  function openCart() {
    if (sending) return;
    $('#cart-overlay').hidden = false;
    document.body.classList.add('modal-open');
  }

  function closeCart() {
    if (sending) return;
    $('#cart-overlay').hidden = true;
    if ($('#checkout-overlay').hidden) document.body.classList.remove('modal-open');
  }

  function openCheckout() {
    if (!cart.length || sending) return;
    closeCart();
    restoreCheckoutDraft();
    fillAddresses(true);
    toggleOther();
    updateCheckoutTotals();
    $('#backend-warning').hidden = isBackendConfigured();
    $('#checkout-overlay').hidden = false;
    document.body.classList.add('modal-open');
  }

  function closeCheckout() {
    if (sending) return;
    saveCheckoutDraft();
    $('#checkout-overlay').hidden = true;
    document.body.classList.remove('modal-open');
  }

  function toggleOther() {
    const form = $('#checkout-form');
    const otherSeller = form.vendedor.value === 'Otro';
    $('#seller-other-wrap').hidden = !otherSeller;
    form.vendedor_otro.required = otherSeller;
    const otherDay = form.dia.value === 'Otro';
    $('#day-other-wrap').hidden = !otherDay;
    form.dia_otro.required = otherDay;
  }

  function addressList() {
    const seller = $('#checkout-form').vendedor.value;
    return (seller === 'Edith' || seller === 'Rigo') ? (shipping.EdithRigo || []) : (shipping.Mayra || []);
  }

  function fillAddresses(preserveCurrent = true) {
    const select = $('#checkout-form').direccion;
    const oldValue = preserveCurrent ? select.value : '';
    select.innerHTML = '<option value="">Selecciona tu colonia/sector</option>' + addressList().map(address =>
      `<option value="${esc(address.text)}" data-cost="${Number(address.cost) || 0}">${esc(address.text)} — ${money(address.cost)}</option>`
    ).join('');
    if ([...select.options].some(option => option.value === oldValue)) select.value = oldValue;
  }

  function shippingCost() {
    const subtotal = cartSubtotal();
    if (subtotal >= Number(cfg.freeShippingThreshold || 2500)) return 0;
    const option = $('#checkout-form').direccion.selectedOptions[0];
    return Number(option?.dataset.cost || 0);
  }

  function updateCheckoutTotals() {
    if (!$('#checkout-form')) return;
    const subtotal = cartSubtotal();
    const hasAddress = $('#checkout-form').direccion?.value;
    const shippingAmount = hasAddress ? shippingCost() : 0;
    $('#checkout-subtotal').textContent = money(subtotal);
    $('#checkout-shipping').textContent = hasAddress ? (shippingAmount === 0 ? 'GRATIS' : money(shippingAmount)) : '—';
    $('#checkout-total').textContent = money(subtotal + shippingAmount);
  }

  function saveCheckoutDraft() {
    const form = $('#checkout-form');
    if (!form) return;
    const data = {};
    new FormData(form).forEach((value, key) => { data[key] = value; });
    data.savedAt = Date.now();
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  }

  function restoreCheckoutDraft() {
    const form = $('#checkout-form');
    const data = safeParse(localStorage.getItem(DRAFT_KEY), null);
    if (!form || !data) {
      fillAddresses(false);
      toggleOther();
      return;
    }
    Object.entries(data).forEach(([name, value]) => {
      if (name === 'direccion' || name === 'savedAt') return;
      const field = form.elements.namedItem(name);
      if (field && typeof value === 'string') field.value = value;
    });
    toggleOther();
    fillAddresses(false);
    if (typeof data.direccion === 'string' && [...form.direccion.options].some(option => option.value === data.direccion)) {
      form.direccion.value = data.direccion;
    }
    updateCheckoutTotals();
  }

  function clearCheckoutDraft() {
    localStorage.removeItem(DRAFT_KEY);
  }

  function isBackendConfigured() {
    const url = String(cfg.appsScriptUrl || '').trim();
    return /^https:\/\/script\.google\.com\/macros\/s\//.test(url) && url.endsWith('/exec') && !url.includes('PEGAR_AQUI');
  }

  function orderPayload() {
    const form = $('#checkout-form');
    const seller = form.vendedor.value === 'Otro' ? form.vendedor_otro.value.trim() : form.vendedor.value;
    const day = form.dia.value === 'Otro' ? form.dia_otro.value.trim() : form.dia.value;
    const shippingAmount = shippingCost();
    return {
      client: {
        nombre: form.nombre.value.trim(),
        telefono1: form.telefono1.value.trim(),
        telefono2: form.telefono2.value.trim(),
        dia: day,
        ubicacion: form.ubicacion.value,
        vendedor: seller,
        direccion: form.direccion.value,
        referencia: form.referencia.value.trim(),
        metodoPago: form.metodo_pago.value
      },
      items: cart.map(item => ({
        id: item.id,
        name: item.name,
        price: item.price,
        qty: item.qty,
        subtotal: item.price * item.qty
      })),
      subtotal: cartSubtotal(),
      shipping: shippingAmount,
      total: cartSubtotal() + shippingAmount,
      source: location.href,
      createdAt: new Date().toISOString(),
      website: form.website.value
    };
  }

  function payloadSignature(payload) {
    return JSON.stringify({ client: payload.client, items: payload.items, subtotal: payload.subtotal, shipping: payload.shipping, total: payload.total });
  }

  function createRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'req-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
  }

  function loadPendingOrder() {
    return safeParse(localStorage.getItem(PENDING_KEY), null);
  }

  function savePendingOrder(pending) {
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  }

  function clearPendingOrder() {
    localStorage.removeItem(PENDING_KEY);
  }

  function markPendingInterrupted() {
    const pending = loadPendingOrder();
    if (!pending) return;
    pending.status = 'interrupted';
    pending.updatedAt = Date.now();
    savePendingOrder(pending);
  }

  function submitOrder(event) {
    event.preventDefault();
    beginOrderSubmission();
  }

  function beginOrderSubmission() {
    if (sending) return;
    const form = $('#checkout-form');
    if (!form.reportValidity() || !cart.length) return;

    saveCheckoutDraft();
    const payload = orderPayload();
    const signature = payloadSignature(payload);
    const previous = loadPendingOrder();
    const requestId = previous && previous.signature === signature && previous.requestId
      ? previous.requestId
      : createRequestId();

    payload.requestId = requestId;
    currentRequestId = requestId;
    savePendingOrder({
      requestId,
      signature,
      payload,
      status: 'sending',
      startedAt: previous?.startedAt || Date.now(),
      updatedAt: Date.now()
    });

    if (!isBackendConfigured()) {
      showProcessingFailure('La conexión con Google Apps Script no está configurada. Pega en config/site-config.js la URL que termina en /exec.', payload);
      return;
    }

    sending = true;
    $('#submit-order').disabled = true;
    $('#order-status').textContent = 'Procesando pedido…';
    showProcessingOverlay();
    startProgress();

    try {
      let frame = $('#order-frame');
      if (!frame) {
        frame = document.createElement('iframe');
        frame.id = 'order-frame';
        frame.name = 'order-frame';
        frame.hidden = true;
        document.body.appendChild(frame);
      }

      const postForm = document.createElement('form');
      postForm.method = 'POST';
      postForm.action = cfg.appsScriptUrl;
      postForm.target = 'order-frame';
      postForm.acceptCharset = 'UTF-8';
      postForm.hidden = true;

      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'payload';
      input.value = JSON.stringify(payload);
      postForm.appendChild(input);
      document.body.appendChild(postForm);
      postForm.submit();
      postForm.remove();

      clearTimeout(responseTimer);
      responseTimer = setTimeout(() => {
        showProcessingFailure('No pudimos confirmar la respuesta del servidor. Tu carrito y tus datos siguen guardados; vuelve a intentarlo.', payload);
      }, 45000);
    } catch (error) {
      console.error(error);
      showProcessingFailure('No se pudo iniciar el envío. Tu carrito y tus datos siguen guardados; vuelve a intentarlo.', payload);
    }
  }

  function handleBackendMessage(event) {
    const data = event.data || {};
    if (data.type !== 'INTERNATIONAL_ITEMS_ORDER') return;
    if (data.requestId && currentRequestId && data.requestId !== currentRequestId) return;

    clearTimeout(responseTimer);
    if (data.ok) {
      completeProgress(data.orderId);
      return;
    }

    if (data.processing) {
      showProcessingFailure('El pedido todavía está siendo procesado por el servidor. Espera unos segundos y vuelve a intentarlo; no se duplicará.', loadPendingOrder()?.payload);
      return;
    }

    showProcessingFailure(data.message || 'No se pudo registrar el pedido. Tu carrito y tus datos continúan guardados.', loadPendingOrder()?.payload);
  }

  function injectOrderExperience() {
    if ($('#order-process-overlay')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div id="order-process-overlay" class="order-process-overlay" hidden aria-hidden="true">
        <section class="order-process-card" role="alertdialog" aria-modal="true" aria-labelledby="order-process-title" aria-describedby="order-process-message">
          <div id="order-process-icon" class="order-process-icon">📦</div>
          <p class="order-process-kicker">International Items HN</p>
          <h2 id="order-process-title">Procesando tu pedido</h2>
          <p id="order-process-message" class="order-process-message">No cierres ni recargues esta página mientras confirmamos tu pedido.</p>
          <div class="order-progress-row">
            <div class="order-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
              <div id="order-progress-bar" class="order-progress-bar"></div>
            </div>
            <strong id="order-progress-percent">0%</strong>
          </div>
          <p class="order-process-safe">🔒 La pantalla permanecerá bloqueada hasta recibir la confirmación. Tu carrito y tus datos están guardados en este dispositivo.</p>
        </section>
      </div>
      <aside id="order-recovery-banner" class="order-recovery-banner" hidden>
        <div><strong>⚠️ El pedido anterior no quedó confirmado.</strong><span>Tu carrito y tus datos siguen guardados. Revísalos y vuelve a enviarlo.</span></div>
        <button id="recovery-open-checkout" class="primary-button" type="button">Revisar pedido</button>
        <button id="recovery-dismiss" class="icon-button" type="button" aria-label="Cerrar aviso">✕</button>
      </aside>
    `);
  }

  function showProcessingOverlay() {
    clearTimeout(stateTimer);
    const overlay = $('#order-process-overlay');
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.remove('is-error', 'is-success');
    $('#order-process-icon').textContent = '📦';
    $('#order-process-title').textContent = 'Procesando tu pedido';
    $('#order-process-message').textContent = 'No cierres ni recargues esta página mientras confirmamos tu pedido.';
    document.body.classList.add('modal-open', 'order-submitting');
    setProgress(0);
  }

  function hideProcessingOverlay() {
    if (sending) return;
    const overlay = $('#order-process-overlay');
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('order-submitting');
    if ($('#checkout-overlay').hidden && $('#cart-overlay').hidden) document.body.classList.remove('modal-open');
  }

  function startProgress() {
    stopProgress();
    progressValue = 0;
    setProgress(0);
    progressTimer = setInterval(() => {
      if (progressValue < 25) progressValue += 4;
      else if (progressValue < 55) progressValue += 3;
      else if (progressValue < 78) progressValue += 2;
      else if (progressValue < 92) progressValue += 1;
      progressValue = Math.min(progressValue, 92);
      setProgress(progressValue);
      if (progressValue >= 30 && progressValue < 62) $('#order-process-message').textContent = 'Guardando los datos del pedido de forma segura…';
      if (progressValue >= 62 && progressValue < 86) $('#order-process-message').textContent = 'Registrando el pedido y preparando la notificación…';
      if (progressValue >= 86) $('#order-process-message').textContent = 'Esperando la confirmación final del servidor…';
    }, 420);
  }

  function stopProgress() {
    clearInterval(progressTimer);
    progressTimer = null;
  }

  function setProgress(value) {
    const safeValue = Math.max(0, Math.min(100, Math.round(value)));
    progressValue = safeValue;
    $('#order-progress-bar').style.width = safeValue + '%';
    $('#order-progress-percent').textContent = safeValue + '%';
    $('.order-progress-track')?.setAttribute('aria-valuenow', String(safeValue));
  }

  function completeProgress(orderId) {
    stopProgress();
    clearTimeout(responseTimer);
    const pending = loadPendingOrder();
    if (pending) {
      pending.status = 'confirmed';
      pending.orderId = orderId;
      pending.updatedAt = Date.now();
      savePendingOrder(pending);
    }
    const start = progressValue;
    const steps = Math.max(1, 100 - start);
    let current = start;
    const timer = setInterval(() => {
      current += Math.max(1, Math.ceil(steps / 12));
      if (current >= 100) {
        clearInterval(timer);
        setProgress(100);
        showSuccessState(orderId);
      } else {
        setProgress(current);
      }
    }, 55);
  }

  function showSuccessState(orderId) {
    sending = false;
    $('#submit-order').disabled = false;
    $('#order-status').textContent = `Pedido ${orderId} recibido correctamente ✅`;
    const overlay = $('#order-process-overlay');
    overlay.classList.add('is-success');
    overlay.classList.remove('is-error');
    $('#order-process-icon').textContent = '✅';
    $('#order-process-title').textContent = 'Pedido enviado correctamente';
    $('#order-process-message').textContent = `Hemos recibido tu pedido ${orderId}. Espera a que uno de nuestros asesores se comunique contigo para confirmar la entrega.`;

    cart = [];
    localStorage.removeItem(CART_KEY);
    clearPendingOrder();
    updateCartUI();
    updateCheckoutTotals();
    hideRecoveryBanner();
    toast('Pedido enviado correctamente ✅');

    clearTimeout(stateTimer);
    stateTimer = setTimeout(finishSuccessfulOrder, 5500);
  }

  function finishSuccessfulOrder() {
    hideProcessingOverlay();
    $('#checkout-overlay').hidden = true;
    document.body.classList.remove('modal-open');
  }

  function showProcessingFailure(message, payload) {
    stopProgress();
    clearTimeout(responseTimer);
    clearTimeout(stateTimer);
    sending = false;
    $('#submit-order').disabled = false;
    $('#order-status').textContent = message;
    const pending = loadPendingOrder();
    if (pending) {
      pending.status = 'failed';
      pending.updatedAt = Date.now();
      if (payload) pending.payload = payload;
      savePendingOrder(pending);
    }

    const overlay = $('#order-process-overlay');
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.add('is-error');
    overlay.classList.remove('is-success');
    $('#order-process-icon').textContent = '⚠️';
    $('#order-process-title').textContent = 'No se pudo confirmar el pedido';
    $('#order-process-message').textContent = `${message} Regresaremos al formulario; tus datos y tu carrito permanecen guardados.`;
    document.body.classList.add('modal-open');
    document.body.classList.remove('order-submitting');

    stateTimer = setTimeout(() => {
      hideProcessingOverlay();
      restoreCheckoutDraft();
      updateCheckoutTotals();
      $('#checkout-overlay').hidden = false;
      document.body.classList.add('modal-open');
    }, 5200);
  }

  function recoverInterruptedOrder() {
    const pending = loadPendingOrder();
    if (!pending) return;
    const age = Date.now() - Number(pending.updatedAt || pending.startedAt || 0);
    if (!cart.length || age > 24 * 60 * 60 * 1000) {
      clearPendingOrder();
      return;
    }
    pending.status = 'interrupted';
    pending.updatedAt = Date.now();
    savePendingOrder(pending);
    $('#order-recovery-banner').hidden = false;
  }

  function hideRecoveryBanner() {
    $('#order-recovery-banner').hidden = true;
  }

  function openWhatsApp(payload) {
    const items = payload.items.map(item => `- ${item.qty} × ${item.name} (${money(item.price)} c/u)`).join('\n');
    const message = `🛒 *Nuevo pedido*\nCliente: ${payload.client.nombre}\nTel: ${payload.client.telefono1}${payload.client.telefono2 ? ' / ' + payload.client.telefono2 : ''}\nDirección: ${payload.client.direccion} — ${payload.client.referencia}\nDía: ${payload.client.dia}\nVendedor: ${payload.client.vendedor}\nPago: ${payload.client.metodoPago}\n\n📦 *Productos*\n${items}\n\nSubtotal: ${money(payload.subtotal)}\nEnvío: ${payload.shipping === 0 ? 'GRATIS' : money(payload.shipping)}\n*Total: ${money(payload.total)}*`;
    window.open(`https://wa.me/${cfg.whatsappNumber || '50496310102'}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
  }

  async function shareProduct(product) {
    const url = `${location.origin}${location.pathname}#${product.id}`;
    const text = `${product.name}\n${money(product.price)}\n${url}`;
    try {
      if (navigator.share) await navigator.share({ title: product.name, text, url });
      else {
        await navigator.clipboard.writeText(text);
        toast('Enlace copiado');
      }
    } catch (error) {
      if (error.name !== 'AbortError') toast('No se pudo compartir');
    }
  }

  function openViewer(images, index = 0) {
    if (sending) return;
    viewer = { images, index };
    showViewer();
    $('#viewer').hidden = false;
    document.body.classList.add('modal-open');
  }

  function showViewer() {
    const image = viewer.images[viewer.index] || '';
    $('#viewer-image').src = image;
    $('#viewer-counter').textContent = `${viewer.index + 1} / ${viewer.images.length}`;
  }

  function moveViewer(direction) {
    if (!viewer.images.length) return;
    viewer.index = (viewer.index + direction + viewer.images.length) % viewer.images.length;
    showViewer();
  }

  function closeViewer() {
    if (sending) return;
    $('#viewer').hidden = true;
    if ($('#cart-overlay').hidden && $('#checkout-overlay').hidden) document.body.classList.remove('modal-open');
  }

  function deepLink() {
    const id = location.hash.slice(1);
    if (!id) return;
    setTimeout(() => {
      const element = document.getElementById(id);
      if (!element) return;
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.style.boxShadow = '0 0 0 4px rgba(255,60,120,.35)';
      setTimeout(() => { element.style.boxShadow = ''; }, 2400);
    }, 250);
  }

  init();
})();
