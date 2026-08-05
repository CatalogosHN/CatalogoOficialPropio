let categories = Array.isArray(window.CATEGORY_CONFIG) ? [...window.CATEGORY_CONFIG] : [];

const AUTO_REFRESH_MS = 5000;
const grid = document.querySelector('#category-grid');
const searchInput = document.querySelector('#category-search');
const visibleCount = document.querySelector('#visible-count');
const emptyState = document.querySelector('#empty-state');
const clearSearch = document.querySelector('#clear-search');
const toast = document.querySelector('#toast');
const categorySelect = document.querySelector('#category-select');
const goCategory = document.querySelector('#go-category');
const menuButton = document.querySelector('.menu-button');
const mainNav = document.querySelector('.main-nav');

let catalogFingerprint = '';
let catalogRemoteMarker = '';
let refreshBusy = false;
let refreshTimer = null;

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function productCategories(product) {
  let list = [];
  if (Array.isArray(product?.categories)) {
    list = product.categories;
  } else if (typeof product?.categories === 'string') {
    list = product.categories.split(/[|,;]/g);
  }
  const primary = typeof product?.category === 'string' ? product.category.trim() : '';
  if (primary) list.unshift(primary);
  const seen = new Set();
  return list
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => value.trim())
    .filter(value => {
      const key = normalizeText(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function makeFingerprint(productData, categoryData) {
  return JSON.stringify([
    Array.isArray(productData?.products) ? productData.products : [],
    Array.isArray(categoryData?.categories) ? categoryData.categories : []
  ]);
}

function responseMarker(response) {
  return [
    response.headers.get('etag') || '',
    response.headers.get('last-modified') || '',
    response.headers.get('content-length') || ''
  ].join('|');
}

async function fetchRemoteCatalogMarker() {
  const fresh = Date.now();
  try {
    const responses = await Promise.all([
      fetch(`data/productos.json?verificar=${fresh}`, { method: 'HEAD', cache: 'no-store' }),
      fetch(`data/categorias.json?verificar=${fresh}`, { method: 'HEAD', cache: 'no-store' })
    ]);
    if (responses.some(response => !response.ok)) return '';
    const marker = responses.map(responseMarker).join('::');
    return marker.replace(/[|:]/g, '') ? marker : '';
  } catch (_) {
    return '';
  }
}

async function fetchFreshCatalog() {
  const fresh = Date.now();
  const [productResponse, categoryResponse] = await Promise.all([
    fetch(`data/productos.json?actualizar=${fresh}`, { cache: 'no-store' }),
    fetch(`data/categorias.json?actualizar=${fresh}`, { cache: 'no-store' })
  ]);
  if (!productResponse.ok) throw new Error(`productos.json respondió ${productResponse.status}`);
  if (!categoryResponse.ok) throw new Error(`categorias.json respondió ${categoryResponse.status}`);
  const [productData, categoryData] = await Promise.all([
    productResponse.json(),
    categoryResponse.json()
  ]);
  return {
    productData,
    categoryData,
    fingerprint: makeFingerprint(productData, categoryData),
    remoteMarker: [responseMarker(productResponse), responseMarker(categoryResponse)].join('::')
  };
}

function applyCatalogSnapshot(productData, categoryData, announce = false) {
  const products = Array.isArray(productData?.products) ? productData.products : [];
  const freshCategories = Array.isArray(categoryData?.categories) ? categoryData.categories : [];
  if (freshCategories.length) categories = freshCategories;

  categories.forEach(category => {
    const wanted = normalizeText(category.name);
    category.count = products.filter(product =>
      productCategories(product).some(value => normalizeText(value) === wanted)
    ).length;
  });

  fillCategorySelect();
  renderCategories(searchInput.value);
  if (announce) showToast('Catálogo actualizado automáticamente ✅');
}

async function refreshCatalog(announce = true) {
  if (refreshBusy || document.hidden) return;
  refreshBusy = true;
  try {
    const remoteMarker = await fetchRemoteCatalogMarker();
    if (remoteMarker && remoteMarker === catalogRemoteMarker) return;
    const snapshot = await fetchFreshCatalog();
    catalogRemoteMarker = snapshot.remoteMarker || remoteMarker || catalogRemoteMarker;
    if (snapshot.fingerprint === catalogFingerprint) return;
    catalogFingerprint = snapshot.fingerprint;
    catalogRemoteMarker = snapshot.remoteMarker || '';
    applyCatalogSnapshot(snapshot.productData, snapshot.categoryData, announce);
  } catch (error) {
    console.warn('No se pudo comprobar una actualización del catálogo.', error);
  } finally {
    refreshBusy = false;
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2800);
}

function openCategory(category) {
  if (!category) return;
  const url = String(category.url || '').trim();
  if (!url || url === '#') {
    showToast(`La categoría “${category.name}” todavía no tiene catálogo configurado.`);
    return;
  }
  window.location.href = url;
}

function categoryCardTemplate(category, index) {
  return `
    <article
      class="category-card"
      tabindex="0"
      role="link"
      aria-label="Abrir categoría ${category.name}"
      data-category-id="${category.id}"
      style="--accent:${category.accent || '#0b5cff'}"
    >
      <img class="category-image" src="${category.image}" alt="${category.name}" loading="lazy" decoding="async" />
      <span class="category-badge" aria-hidden="true">${category.icon || '●'}</span>
      <span class="category-number">${String(index + 1).padStart(2, '0')}</span>
      <div class="category-content">
        <h3>${category.name}</h3>
        <p>${category.description}</p>
        <small class="card-product-count">${category.count} ${category.count === 1 ? 'producto' : 'productos'}</small>
        <span class="category-action">
          Ver categoría
          <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
        </span>
      </div>
    </article>
  `;
}

function bindCardEvents() {
  grid.querySelectorAll('.category-card').forEach(card => {
    const category = categories.find(item => item.id === card.dataset.categoryId);
    card.addEventListener('click', () => openCategory(category));
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openCategory(category);
      }
    });

    if (window.matchMedia('(pointer:fine)').matches) {
      card.addEventListener('mousemove', event => {
        const rect = card.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const rotateY = ((x / rect.width) - 0.5) * 7;
        const rotateX = ((y / rect.height) - 0.5) * -7;
        card.style.setProperty('--mouse-x', `${(x / rect.width) * 100}%`);
        card.style.setProperty('--mouse-y', `${(y / rect.height) * 100}%`);
        card.style.setProperty('--rotate-x', `${rotateX.toFixed(2)}deg`);
        card.style.setProperty('--rotate-y', `${rotateY.toFixed(2)}deg`);
      });
      card.addEventListener('mouseleave', () => {
        card.style.setProperty('--rotate-x', '0deg');
        card.style.setProperty('--rotate-y', '0deg');
      });
    }
  });
}

function renderCategories(query = '') {
  const normalizedQuery = normalizeText(query);
  const filtered = categories.filter(category => {
    const searchable = normalizeText(`${category.name} ${category.description}`);
    return searchable.includes(normalizedQuery);
  });

  grid.innerHTML = filtered.map(category => {
    const originalIndex = categories.findIndex(item => item.id === category.id);
    return categoryCardTemplate(category, originalIndex);
  }).join('');

  visibleCount.textContent = filtered.length;
  emptyState.hidden = filtered.length !== 0;
  grid.hidden = filtered.length === 0;
  bindCardEvents();
}

function fillCategorySelect() {
  const previous = categorySelect.value;
  categorySelect.innerHTML = '<option value="">Selecciona una categoría</option>' +
    categories.map(category => `<option value="${category.id}">${category.name}</option>`).join('');
  if (previous && categories.some(category => category.id === previous)) categorySelect.value = previous;
}

searchInput.addEventListener('input', event => renderCategories(event.target.value));
clearSearch.addEventListener('click', () => {
  searchInput.value = '';
  renderCategories('');
  searchInput.focus();
});

goCategory.addEventListener('click', () => {
  const category = categories.find(item => item.id === categorySelect.value);
  if (!category) {
    showToast('Selecciona primero una categoría.');
    categorySelect.focus();
    return;
  }
  openCategory(category);
});

menuButton.addEventListener('click', () => {
  const isOpen = mainNav.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(isOpen));
});

mainNav.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    mainNav.classList.remove('open');
    menuButton.setAttribute('aria-expanded', 'false');
  });
});

document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    searchInput.focus();
    document.querySelector('#categorias').scrollIntoView({ behavior: 'smooth' });
  }
});

document.querySelectorAll('[data-search-link]').forEach(link => {
  link.addEventListener('click', () => {
    const query = link.dataset.searchLink || '';
    searchInput.value = query;
    renderCategories(query);
  });
});

document.querySelector('#current-year').textContent = new Date().getFullYear();

async function initHomepage() {
  fillCategorySelect();
  renderCategories();
  try {
    const snapshot = await fetchFreshCatalog();
    catalogFingerprint = snapshot.fingerprint;
    catalogRemoteMarker = snapshot.remoteMarker || '';
    applyCatalogSnapshot(snapshot.productData, snapshot.categoryData, false);
  } catch (error) {
    console.warn('Se usaron los datos locales de categorías porque no se pudo descargar el catálogo.', error);
  }
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => refreshCatalog(true), AUTO_REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshCatalog(true);
  });
  window.addEventListener('focus', () => refreshCatalog(true));
}

initHomepage();
