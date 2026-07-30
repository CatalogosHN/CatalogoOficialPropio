const categories = Array.isArray(window.CATEGORY_CONFIG) ? window.CATEGORY_CONFIG : [];

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

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
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
    showToast(`La categoría “${category.name}” todavía no tiene catalogo configurado.`);
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
      <span class="category-number">0${index + 1}</span>
      <div class="category-content">
        <h3>${category.name}</h3>
        <p>${category.description}</p>
        <span class="category-action">
          Ver categoría
          <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
        </span>
      </div>
    </article>
  `;
}

function bindCardEvents() {
  grid.querySelectorAll('.category-card').forEach((card) => {
    const category = categories.find((item) => item.id === card.dataset.categoryId);

    card.addEventListener('click', () => openCategory(category));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openCategory(category);
      }
    });

    if (window.matchMedia('(pointer:fine)').matches) {
      card.addEventListener('mousemove', (event) => {
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
  const filtered = categories.filter((category) => {
    const searchable = normalizeText(`${category.name} ${category.description}`);
    return searchable.includes(normalizedQuery);
  });

  grid.innerHTML = filtered.map((category) => {
    const originalIndex = categories.findIndex((item) => item.id === category.id);
    return categoryCardTemplate(category, originalIndex);
  }).join('');

  visibleCount.textContent = filtered.length;
  emptyState.hidden = filtered.length !== 0;
  grid.hidden = filtered.length === 0;
  bindCardEvents();
}

function fillCategorySelect() {
  categorySelect.insertAdjacentHTML(
    'beforeend',
    categories.map((category) => `<option value="${category.id}">${category.name}</option>`).join('')
  );
}

searchInput.addEventListener('input', (event) => renderCategories(event.target.value));
clearSearch.addEventListener('click', () => {
  searchInput.value = '';
  renderCategories('');
  searchInput.focus();
});

goCategory.addEventListener('click', () => {
  const category = categories.find((item) => item.id === categorySelect.value);
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

mainNav.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    mainNav.classList.remove('open');
    menuButton.setAttribute('aria-expanded', 'false');
  });
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    searchInput.focus();
    document.querySelector('#categorias').scrollIntoView({ behavior: 'smooth' });
  }
});

document.querySelectorAll('[data-search-link]').forEach((link) => {
  link.addEventListener('click', () => {
    const query = link.dataset.searchLink || '';
    searchInput.value = query;
    renderCategories(query);
  });
});

document.querySelector('#current-year').textContent = new Date().getFullYear();

fillCategorySelect();
renderCategories();
