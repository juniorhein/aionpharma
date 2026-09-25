/* ================================================
   AION PHARMA — Main Script
   Cart, Animations, Mobile Nav, Toast, Newsletter
   ================================================ */

// ── State ─────────────────────────────────────────
let cart = [];
let selectedFrete = null; // { id, name, company, price, prazo }
/** Cupom aplicado: { codigo, desconto_percent, influencer? } | null */
let appliedCoupon = null;

function loadCoupon() {
  try {
    appliedCoupon = JSON.parse(localStorage.getItem('aion_coupon') || 'null');
  } catch {
    appliedCoupon = null;
  }
}

function saveCoupon() {
  if (appliedCoupon) {
    localStorage.setItem('aion_coupon', JSON.stringify(appliedCoupon));
  } else {
    localStorage.removeItem('aion_coupon');
  }
}

function getDiscountAmount(subtotal) {
  if (!appliedCoupon) return 0;
  const pct = Number(appliedCoupon.desconto_percent) || 0;
  return Math.round(subtotal * (pct / 100) * 100) / 100;
}

// ── Init ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadCart();
  loadCoupon();
  renderCartUI();
  initScrollBehavior();
  initRevealAnimations();
  initMobileNav();
  initB2B();
  initPF();
  initCatalog();
  initProductPage();
  initBarraTopo();
});

// ── Header Scroll ──────────────────────────────────
function initScrollBehavior() {
  const header = document.getElementById('header');
  if (!header) return;
  const onScroll = () => {
    header.classList.toggle('scrolled', window.scrollY > 20);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
}

// ── Reveal on Scroll ──────────────────────────────
function initRevealAnimations() {
  const items = document.querySelectorAll('.reveal');
  if (!items.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  items.forEach(el => observer.observe(el));
}

// ── Mobile Nav ─────────────────────────────────────
function initMobileNav() {
  const toggle = document.getElementById('menu-toggle');
  const nav = document.getElementById('mobile-nav');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    toggle.classList.toggle('open', isOpen);
    toggle.setAttribute('aria-expanded', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
  });
}

function closeMobileNav() {
  const toggle = document.getElementById('menu-toggle');
  const nav = document.getElementById('mobile-nav');
  if (!toggle || !nav) return;
  nav.classList.remove('open');
  toggle.classList.remove('open');
  toggle.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}

// ── Cart ───────────────────────────────────────────
function loadCart() {
  try {
    cart = JSON.parse(localStorage.getItem('aion_cart') || '[]');
  } catch {
    cart = [];
  }
}

function saveCart() {
  localStorage.setItem('aion_cart', JSON.stringify(cart));
}

// `sku` é obrigatório na cotação de frete da Olist; sem ele o backend
// precisa resolver o SKU pelo id, custando uma chamada extra ao Tiny.
function addToCart(id, name, price, image, sku) {
  const existing = cart.find(item => item.id === id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ id, sku, name, price, image, qty: 1 });
  }
  invalidarFrete();
  saveCart();
  renderCartUI();
  showToast(`✅ <strong>${name}</strong> adicionado ao carrinho`);
  openCart();
}

function removeFromCart(id) {
  cart = cart.filter(item => item.id !== id);
  invalidarFrete();
  saveCart();
  renderCartUI();
}

function updateQty(id, delta) {
  const item = cart.find(i => i.id === id);
  if (!item) return;
  item.qty = Math.max(1, item.qty + delta);
  invalidarFrete();
  saveCart();
  renderCartUI();
}

// O frete depende do conteúdo do carrinho; ao mudar, zera a escolha.
function invalidarFrete() {
  selectedFrete = null;
  const box = document.getElementById('cart-frete-options');
  if (box) { box.innerHTML = ''; box._opcoes = null; }
}

/**
 * Alinha o carrinho com os preços que o servidor confirmou no checkout.
 * Com cupom os itens voltam já descontados — aí o carrinho não mexe,
 * senão o desconto entraria duas vezes.
 */
function sincronizarPrecosDoCarrinho(itensConferidos) {
  if (appliedCoupon) return;
  let mudou = false;
  for (const conferido of itensConferidos) {
    const item = cart.find((c) => String(c.id) === String(conferido.id));
    if (!item || !(Number(conferido.price) > 0)) continue;
    if (Number(item.price) !== Number(conferido.price)) {
      item.price = Number(conferido.price);
      mudou = true;
    }
  }
  if (mudou) {
    saveCart();
    renderCartUI();
    renderCheckoutResumo();
  }
}

function getCartTotal() {
  return cart.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function getCartCount() {
  return cart.reduce((sum, item) => sum + item.qty, 0);
}

function renderCartUI() {
  // Count badge
  const countEl = document.getElementById('cart-count');
  const count = getCartCount();
  if (countEl) {
    countEl.textContent = count;
    countEl.style.display = count > 0 ? 'flex' : 'none';
  }

  // Cart items
  const container = document.getElementById('cart-items-container');
  const emptyEl = document.getElementById('cart-empty');
  const footerEl = document.getElementById('cart-footer');
  const totalEl = document.getElementById('cart-total-display');

  if (!container) return;

  if (cart.length === 0) {
    if (emptyEl) emptyEl.style.display = 'flex';
    if (footerEl) footerEl.style.display = 'none';
    // Remove any item cards
    container.querySelectorAll('.cart-item').forEach(el => el.remove());
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  if (footerEl) footerEl.style.display = 'block';

  // Re-render items
  container.querySelectorAll('.cart-item').forEach(el => el.remove());

  cart.forEach(item => {
    const itemEl = document.createElement('div');
    itemEl.className = 'cart-item';
    itemEl.id = `cart-item-${item.id}`;
    itemEl.innerHTML = `
      <div class="cart-item-image">
        ${item.image
          ? `<img src="${item.image}" alt="${item.name}" />`
          : `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:1.75rem">🐾</div>`
        }
      </div>
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-price">${formatPrice(item.price * item.qty)}</div>
        <div class="cart-item-controls">
          <button class="qty-btn" onclick="updateQty('${item.id}', -1)" aria-label="Diminuir quantidade">−</button>
          <span class="qty-value">${item.qty}</span>
          <button class="qty-btn" onclick="updateQty('${item.id}', 1)" aria-label="Aumentar quantidade">+</button>
        </div>
      </div>
      <button class="cart-item-remove" onclick="removeFromCart('${item.id}')" aria-label="Remover item">
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    `;
    container.appendChild(itemEl);
  });

  // Subtotal + desconto + frete + total
  const subtotal = getCartTotal();
  const desconto = getDiscountAmount(subtotal);
  const freteVal = selectedFrete ? Number(selectedFrete.price) : 0;
  const subEl = document.getElementById('cart-subtotal-display');
  if (subEl) subEl.textContent = formatPrice(subtotal);

  const descLine = document.getElementById('cart-desconto-line');
  const descDisp = document.getElementById('cart-desconto-display');
  const descLabel = document.getElementById('cart-desconto-label');
  if (descLine && descDisp) {
    if (appliedCoupon && desconto > 0) {
      descLine.style.display = 'flex';
      if (descLabel) {
        descLabel.textContent = `Desconto (${appliedCoupon.codigo} · ${appliedCoupon.desconto_percent}%)`;
      }
      descDisp.textContent = `−${formatPrice(desconto)}`;
    } else {
      descLine.style.display = 'none';
    }
  }

  const cupomInput = document.getElementById('cart-cupom-input');
  const cupomMsg = document.getElementById('cart-cupom-msg');
  const cupomBtn = document.getElementById('cart-cupom-btn');
  if (cupomInput && appliedCoupon) {
    cupomInput.value = appliedCoupon.codigo;
    if (cupomMsg) {
      cupomMsg.style.display = 'block';
      cupomMsg.className = 'frete-msg frete-ok';
      cupomMsg.innerHTML = `Cupom <strong>${appliedCoupon.codigo}</strong> aplicado · <button type="button" class="cupom-remover" onclick="removerCupom()">Remover</button>`;
    }
    if (cupomBtn) cupomBtn.textContent = 'OK';
  } else if (cupomBtn) {
    cupomBtn.textContent = 'Aplicar';
  }

  // Lojista logado: cupom sai de cena (a tabela dele já é o desconto)
  // e o carrinho mostra qual tabela está valendo.
  const blocoCupom = document.getElementById('cart-cupom');
  if (blocoCupom) blocoCupom.style.display = b2bLogado() ? 'none' : '';
  const footerBox = document.getElementById('cart-footer');
  let avisoB2B = document.getElementById('cart-b2b-aviso');
  if (b2bLogado() && footerBox) {
    if (!avisoB2B) {
      avisoB2B = document.createElement('p');
      avisoB2B.id = 'cart-b2b-aviso';
      avisoB2B.className = 'cart-b2b-aviso';
      footerBox.prepend(avisoB2B);
    }
    const conta = b2bSession.conta || {};
    avisoB2B.innerHTML = `🏷️ Tabela <strong>${conta.nivelLabel || 'Lojista'}</strong> aplicada · pedido no CNPJ ${conta.cnpj || ''}`;
  } else if (avisoB2B) {
    avisoB2B.remove();
  }

  const freteLine = document.getElementById('cart-frete-line');
  const freteDisp = document.getElementById('cart-frete-display');
  if (freteLine && freteDisp) {
    if (selectedFrete) {
      freteLine.style.display = 'flex';
      freteDisp.textContent = freteVal === 0 ? 'Grátis' : formatPrice(freteVal);
    } else {
      freteLine.style.display = 'none';
    }
  }
  if (totalEl) totalEl.textContent = formatPrice(Math.max(0, subtotal - desconto) + freteVal);
}

/* ================================================================
   Área do Lojista (compra com CNPJ)
   A sessão fica no localStorage e vai como Bearer em /api/produtos e
   /api/checkout — é o servidor que decide a tabela de preço (Lojista
   ou Distribuição). O front só mostra o que voltou.
   ================================================================ */

const B2B_KEY = 'aion_b2b';
let b2bSession = null;

function b2bCarregarSessao() {
  try {
    b2bSession = JSON.parse(localStorage.getItem(B2B_KEY) || 'null');
  } catch {
    b2bSession = null;
  }
  return b2bSession;
}

function b2bSalvarSessao(sessao) {
  b2bSession = sessao;
  if (sessao) localStorage.setItem(B2B_KEY, JSON.stringify(sessao));
  else localStorage.removeItem(B2B_KEY);
}

function b2bLogado() {
  return Boolean(b2bSession?.token);
}

/** Headers com a sessão do lojista (vazio para visitante comum). */
function b2bHeaders(extra = {}) {
  return b2bLogado() ? { ...extra, Authorization: `Bearer ${b2bSession.token}` } : { ...extra };
}

/** Sessão expirada/derrubada pelo servidor → limpa e avisa. */
function b2bSessaoInvalida() {
  if (!b2bLogado()) return;
  b2bSalvarSessao(null);
  b2bAplicarUI();
  showToast('🔒 Sua sessão de lojista expirou. Entre de novo para ver os preços de revenda.', 5000);
}

async function b2bApi(path, options = {}) {
  const r = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...b2bHeaders(),
      ...(options.headers || {}),
    },
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && b2bLogado()) b2bSessaoInvalida();
  if (!r.ok) throw new Error(data.error || data.detail || `Erro ${r.status}`);
  return data;
}

/** Marca visual no header + link do menu enquanto o lojista está logado. */
function b2bAplicarUI() {
  const nivel = b2bSession?.conta?.nivelLabel || 'Lojista';
  document.querySelectorAll('.b2b-chip').forEach((el) => el.remove());
  document.body.classList.toggle('b2b-ativo', b2bLogado());

  if (b2bLogado()) {
    const chip = document.createElement('a');
    chip.href = 'b2b.html';
    chip.className = 'b2b-chip';
    chip.title = b2bSession?.conta?.razaoSocial || '';
    chip.innerHTML = `<span class="b2b-chip-dot"></span>Preço ${nivel}`;
    document.querySelector('.header-actions')?.prepend(chip);
  }

  // Link do menu vira "Minha conta" quando logado
  document.querySelectorAll('a[href="b2b.html"]').forEach((a) => {
    if (a.classList.contains('b2b-chip')) return;
    if (a.closest('.footer-links')) return;
    a.textContent = b2bLogado() ? 'Minha conta' : 'Área do Lojista';
  });

  renderCartUI();
}

function initB2B() {
  b2bCarregarSessao();
  b2bAplicarUI();
  if (b2bLogado()) {
    // Revalida em silêncio: conta desativada ou promovida a Distribuição
    // precisa refletir no preço já nesta visita.
    b2bApi('/api/b2b/me')
      .then((data) => {
        const nivelAntes = b2bSession?.conta?.nivel;
        b2bSalvarSessao({ ...b2bSession, conta: data.conta });
        b2bAplicarUI();
        if (nivelAntes && data.conta.nivel !== nivelAntes) initCatalog();
        b2bPreencherPainel();
      })
      .catch(() => { /* offline ou sessão caiu — b2bApi já tratou o 401 */ });
  }
  b2bRenderizarPagina();
}

/* ── Página b2b.html ─────────────────────────────────────────── */

function b2bRenderizarPagina() {
  const painel = document.getElementById('b2b-painel');
  const acesso = document.getElementById('b2b-acesso');
  if (!painel || !acesso) return; // não estamos na b2b.html

  painel.hidden = !b2bLogado();
  acesso.hidden = b2bLogado();
  if (b2bLogado()) b2bPreencherPainel();
}

function b2bPreencherPainel() {
  const conta = b2bSession?.conta;
  if (!conta || !document.getElementById('b2b-painel')) return;

  const set = (id, valor) => {
    const el = document.getElementById(id);
    if (el) el.textContent = valor;
  };
  set('b2b-painel-razao', conta.razaoSocial || '—');
  set('b2b-painel-cnpj', `CNPJ ${conta.cnpj}`);
  set('b2b-painel-nivel', `Tabela ${conta.nivelLabel}`);

  const val = (id, valor) => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = valor || '';
  };
  val('b2b-contato', conta.contatoNome);
  val('b2b-telefone', conta.telefone);
  val('b2b-cep', conta.endereco?.cep);
  val('b2b-endereco', conta.endereco?.logradouro);
  val('b2b-numero', conta.endereco?.numero);
  val('b2b-complemento', conta.endereco?.complemento);
  val('b2b-bairro', conta.endereco?.bairro);
  val('b2b-cidade', conta.endereco?.cidade);
  val('b2b-uf', conta.endereco?.uf);
}

function b2bMostrarAba(aba) {
  const ehLogin = aba === 'login';
  document.getElementById('b2b-form-login').hidden = !ehLogin;
  document.getElementById('b2b-form-cadastro').hidden = ehLogin;
  document.getElementById('b2b-tab-login').classList.toggle('active', ehLogin);
  document.getElementById('b2b-tab-cadastro').classList.toggle('active', !ehLogin);
}

/** Máscara de CNPJ (aceita o formato alfanumérico novo). */
function onCnpjInput(el) {
  const v = el.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14);
  let out = v;
  if (v.length > 12) out = `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`;
  else if (v.length > 8) out = `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8)}`;
  else if (v.length > 5) out = `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5)}`;
  else if (v.length > 2) out = `${v.slice(0, 2)}.${v.slice(2)}`;
  el.value = out;

  const hint = document.getElementById('b2b-cad-razao-hint');
  if (hint) {
    hint.textContent = v.length === 14
      ? 'Confirmamos a razão social na Receita ao criar a conta.'
      : '';
  }
}

/** Máscara de CEP + ViaCEP preenchendo os campos do formulário de dados. */
function onCheckoutCepGenerico(el) {
  let v = el.value.replace(/\D/g, '').slice(0, 8);
  if (v.length > 5) v = `${v.slice(0, 5)}-${v.slice(5)}`;
  el.value = v;
  const limpo = v.replace(/\D/g, '');
  if (limpo.length !== 8) return;

  fetch(`https://viacep.com.br/ws/${limpo}/json/`)
    .then((r) => r.json())
    .then((d) => {
      if (d.erro) return;
      const set = (id, valor) => {
        const campo = document.getElementById(id);
        if (campo && valor && !campo.value) campo.value = valor;
      };
      set('b2b-endereco', d.logradouro);
      set('b2b-bairro', d.bairro);
      set('b2b-cidade', d.localidade);
      set('b2b-uf', d.uf);
    })
    .catch(() => { /* silencioso — dá para preencher à mão */ });
}

async function b2bLogin(event) {
  event.preventDefault();
  const btn = document.getElementById('b2b-login-submit');
  const f = Object.fromEntries(new FormData(event.target).entries());
  if (btn) { btn.disabled = true; btn.textContent = 'Entrando…'; }
  try {
    const data = await b2bApi('/api/b2b/login', {
      method: 'POST',
      body: JSON.stringify({ identificador: f.identificador, senha: f.senha }),
    });
    b2bSalvarSessao({ token: data.token, conta: data.conta });
    b2bAplicarUI();
    b2bRenderizarPagina();
    showToast(`✅ Bem-vindo! Preço ${data.conta.nivelLabel} ativo no catálogo.`, 4000);
  } catch (err) {
    showToast(`❌ ${err.message}`, 4000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
  }
}

async function b2bCadastrar(event) {
  event.preventDefault();
  const btn = document.getElementById('b2b-cad-submit');
  const f = Object.fromEntries(new FormData(event.target).entries());
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
  try {
    const data = await b2bApi('/api/b2b/cadastro', {
      method: 'POST',
      body: JSON.stringify(f),
    });
    // A conta nasce pendente: sem token, sem sessão e sem preço B2B até
    // a Aion aprovar no painel.
    event.target.reset();
    showToast('🎉 Cadastro enviado! A Aion confere os dados e libera o seu acesso — você recebe um aviso assim que a conta for aprovada.', 7000);
  } catch (err) {
    showToast(`❌ ${err.message}`, 5000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar cadastro'; }
  }
}

async function b2bSalvarDados(event) {
  event.preventDefault();
  const btn = document.getElementById('b2b-dados-submit');
  const f = Object.fromEntries(new FormData(event.target).entries());
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
  try {
    const data = await b2bApi('/api/b2b/me', { method: 'PATCH', body: JSON.stringify(f) });
    b2bSalvarSessao({ ...b2bSession, conta: data.conta });
    showToast('✅ Dados atualizados.');
  } catch (err) {
    showToast(`❌ ${err.message}`, 4000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar dados'; }
  }
}

/**
 * Checkout do lojista: nasce como Pessoa Jurídica com o CNPJ da conta
 * (o servidor ignora o que vier diferente disso) e já traz o endereço
 * padrão, que continua editável pedido a pedido.
 */
function b2bPreencherCheckout() {
  const form = document.getElementById('checkout-form');
  if (!form) return;
  const campo = (nome) => form.elements[nome];

  const tipo = campo('tipoPessoa');
  const doc = campo('cpfCnpj');

  if (!b2bLogado()) {
    if (tipo) tipo.disabled = false;
    if (doc) { doc.readOnly = false; doc.title = ''; }
    return;
  }

  const conta = b2bSession.conta || {};
  if (tipo) { tipo.value = 'J'; tipo.disabled = true; onTipoPessoa(tipo); }
  if (doc) {
    doc.value = conta.cnpj || '';
    doc.readOnly = true;
    doc.title = 'Pedido emitido no CNPJ da conta de lojista';
  }

  const preencher = (nome, valor) => {
    const el = campo(nome);
    if (el && !el.value && valor) el.value = valor;
  };
  preencher('nome', conta.razaoSocial);
  preencher('email', conta.email);
  preencher('telefone', conta.telefone);
  const end = conta.endereco || {};
  preencher('cep', end.cep);
  preencher('endereco', end.logradouro);
  preencher('numero', end.numero);
  preencher('complemento', end.complemento);
  preencher('bairro', end.bairro);
  preencher('cidade', end.cidade);
  preencher('uf', end.uf);
}

function b2bLogout() {
  b2bSalvarSessao(null);
  b2bAplicarUI();
  b2bRenderizarPagina();
  initCatalog(); // volta a vitrine para o preço de consumidor
  showToast('👋 Você saiu da conta de lojista.');
}

/* ================================================================
   Conta do cliente (CPF)
   Existe para acompanhar pedidos e não redigitar endereço. NÃO muda
   preço: PF compra na mesma tabela de quem compra sem conta — por
   isso a sessão não vai em /api/produtos, só no checkout.
   ================================================================ */

const PF_KEY = 'aion_pf';
let pfSession = null;

function pfCarregarSessao() {
  try {
    pfSession = JSON.parse(localStorage.getItem(PF_KEY) || 'null');
  } catch {
    pfSession = null;
  }
  return pfSession;
}

function pfSalvarSessao(sessao) {
  pfSession = sessao;
  if (sessao) localStorage.setItem(PF_KEY, JSON.stringify(sessao));
  else localStorage.removeItem(PF_KEY);
}

function pfLogado() {
  return Boolean(pfSession?.token);
}

/** Bearer para o checkout: lojista tem prioridade (é quem muda preço). */
function authHeaders(extra = {}) {
  if (b2bLogado()) return { ...extra, Authorization: `Bearer ${b2bSession.token}` };
  if (pfLogado()) return { ...extra, Authorization: `Bearer ${pfSession.token}` };
  return { ...extra };
}

function pfSessaoInvalida() {
  if (!pfLogado()) return;
  pfSalvarSessao(null);
  pfAplicarUI();
  pfRenderizarPagina();
  showToast('🔒 Sua sessão expirou. Entre de novo na sua conta.', 5000);
}

async function pfApi(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (pfLogado()) headers.Authorization = `Bearer ${pfSession.token}`;
  const r = await fetch(path, { ...options, headers });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && pfLogado()) pfSessaoInvalida();
  if (!r.ok) throw new Error(data.error || data.detail || `Erro ${r.status}`);
  return data;
}

/** Link do menu vira "Minha Conta (Nome)" enquanto o cliente está logado. */
function pfAplicarUI() {
  const nome = (pfSession?.conta?.nome || '').split(' ')[0];
  document.querySelectorAll('a[href="conta.html"]').forEach((a) => {
    if (a.closest('.footer-links')) return;
    a.textContent = pfLogado() && nome ? `Minha Conta (${nome})` : 'Minha Conta';
  });
}

function initPF() {
  pfCarregarSessao();
  pfAplicarUI();
  if (pfLogado()) {
    // Revalida em silêncio: conta desativada precisa cair já nesta visita.
    pfApi('/api/b2b/pf-me')
      .then((data) => {
        pfSalvarSessao({ ...pfSession, conta: data.conta });
        pfAplicarUI();
        pfRenderizarPagina();
      })
      .catch(() => { /* offline ou sessão caiu — pfApi já tratou o 401 */ });
  }
  pfRenderizarPagina();
}

/* ── Página conta.html ───────────────────────────────────────── */

function pfRenderizarPagina() {
  const painel = document.getElementById('pf-painel');
  const acesso = document.getElementById('pf-acesso');
  if (!painel || !acesso) return; // não estamos na conta.html

  painel.hidden = !pfLogado();
  acesso.hidden = pfLogado();
  if (pfLogado()) {
    pfPreencherPainel();
    pfCarregarPedidos();
  }
}

function pfPreencherPainel() {
  const conta = pfSession?.conta;
  if (!conta || !document.getElementById('pf-painel')) return;

  const set = (id, valor) => {
    const el = document.getElementById(id);
    if (el) el.textContent = valor;
  };
  set('pf-painel-nome', conta.nome || '—');
  set('pf-painel-doc', `CPF ${conta.cpf} · ${conta.email}`);

  const val = (id, valor) => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = valor || '';
  };
  val('pf-dados-nome', conta.nome);
  val('pf-dados-telefone', conta.telefone);
  val('pf-dados-cep', conta.endereco?.cep);
  val('pf-dados-endereco', conta.endereco?.logradouro);
  val('pf-dados-numero', conta.endereco?.numero);
  val('pf-dados-complemento', conta.endereco?.complemento);
  val('pf-dados-bairro', conta.endereco?.bairro);
  val('pf-dados-cidade', conta.endereco?.cidade);
  val('pf-dados-uf', conta.endereco?.uf);
}

async function pfCarregarPedidos() {
  const box = document.getElementById('pf-pedidos-lista');
  if (!box) return;
  try {
    const { pedidos } = await pfApi('/api/b2b/pf-pedidos');
    if (!pedidos || !pedidos.length) {
      box.innerHTML = '<p class="b2b-muted">Você ainda não fez pedidos por aqui. <a href="produtos.html">Ver produtos</a>.</p>';
      return;
    }
    box.innerHTML = pedidos
      .map((p) => {
        const data = new Date(p.data).toLocaleDateString('pt-BR');
        const situacao = p.situacao || 'Processando';
        const rastreio = p.rastreamento
          ? `<span class="pf-pedido-rastreio">Rastreio ${p.rastreamento}</span>`
          : '';
        return `
          <div class="pf-pedido">
            <div class="pf-pedido-info">
              <strong>Pedido ${p.numero}</strong>
              <span class="b2b-muted">${data}</span>
              ${rastreio}
            </div>
            <div class="pf-pedido-valor">
              <span class="pf-pedido-situacao">${situacao}</span>
              <strong>${formatPrice(p.total)}</strong>
            </div>
          </div>`;
      })
      .join('');
  } catch (err) {
    box.innerHTML = `<p class="b2b-muted">Não consegui carregar agora: ${err.message}</p>`;
  }
}

function pfMostrarAba(aba) {
  const ehLogin = aba === 'login';
  document.getElementById('pf-form-login').hidden = !ehLogin;
  document.getElementById('pf-form-cadastro').hidden = ehLogin;
  document.getElementById('pf-tab-login').classList.toggle('active', ehLogin);
  document.getElementById('pf-tab-cadastro').classList.toggle('active', !ehLogin);
}

/** Máscara de CPF. */
function onCpfInput(el) {
  const v = el.value.replace(/\D/g, '').slice(0, 11);
  let out = v;
  if (v.length > 9) out = `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`;
  else if (v.length > 6) out = `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6)}`;
  else if (v.length > 3) out = `${v.slice(0, 3)}.${v.slice(3)}`;
  el.value = out;
}

async function pfLogin(event) {
  event.preventDefault();
  const btn = document.getElementById('pf-login-submit');
  const f = Object.fromEntries(new FormData(event.target).entries());
  if (btn) { btn.disabled = true; btn.textContent = 'Entrando…'; }
  try {
    const data = await pfApi('/api/b2b/pf-login', {
      method: 'POST',
      body: JSON.stringify({ identificador: f.identificador, senha: f.senha }),
    });
    pfSalvarSessao({ token: data.token, conta: data.conta });
    pfAplicarUI();
    pfRenderizarPagina();
    showToast(`✅ Bem-vindo de volta, ${(data.conta.nome || '').split(' ')[0]}!`, 4000);
  } catch (err) {
    showToast(`❌ ${err.message}`, 4000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
  }
}

async function pfCadastrar(event) {
  event.preventDefault();
  const btn = document.getElementById('pf-cad-submit');
  const f = Object.fromEntries(new FormData(event.target).entries());
  if (btn) { btn.disabled = true; btn.textContent = 'Criando…'; }
  try {
    const data = await pfApi('/api/b2b/pf-cadastro', {
      method: 'POST',
      body: JSON.stringify(f),
    });
    // Conta de consumidor nasce ativa: não muda preço, então não há o
    // que aprovar. Já entra logada para o cliente seguir comprando.
    pfSalvarSessao({ token: data.token, conta: data.conta });
    event.target.reset();
    pfAplicarUI();
    pfRenderizarPagina();
    showToast('🎉 Conta criada! Seus próximos pedidos ficam salvos aqui.', 5000);
  } catch (err) {
    showToast(`❌ ${err.message}`, 5000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Criar conta'; }
  }
}

async function pfSalvarDados(event) {
  event.preventDefault();
  const btn = document.getElementById('pf-dados-submit');
  const f = Object.fromEntries(new FormData(event.target).entries());
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
  try {
    const data = await pfApi('/api/b2b/pf-me', { method: 'PATCH', body: JSON.stringify(f) });
    pfSalvarSessao({ ...pfSession, conta: data.conta });
    pfAplicarUI();
    showToast('✅ Dados atualizados.');
  } catch (err) {
    showToast(`❌ ${err.message}`, 4000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar dados'; }
  }
}

function pfSair() {
  pfSalvarSessao(null);
  pfAplicarUI();
  pfRenderizarPagina();
  showToast('👋 Você saiu da sua conta.');
}

/**
 * Checkout do cliente PF: traz CPF, contato e endereço da conta. Tudo
 * continua editável — só o CPF fica travado, porque é ele que liga o
 * pedido ao histórico (o servidor usa o da conta de qualquer jeito).
 */
function pfPreencherCheckout() {
  const form = document.getElementById('checkout-form');
  if (!form || b2bLogado() || !pfLogado()) return;
  const campo = (nome) => form.elements[nome];
  const conta = pfSession.conta || {};

  const tipo = campo('tipoPessoa');
  const doc = campo('cpfCnpj');
  if (tipo) { tipo.value = 'F'; onTipoPessoa(tipo); }
  if (doc) {
    doc.value = conta.cpf || '';
    doc.readOnly = true;
    doc.title = 'Pedido emitido no CPF da sua conta';
  }

  const preencher = (nome, valor) => {
    const el = campo(nome);
    if (el && !el.value && valor) el.value = valor;
  };
  preencher('nome', conta.nome);
  preencher('email', conta.email);
  preencher('telefone', conta.telefone);
  const end = conta.endereco || {};
  preencher('cep', end.cep);
  preencher('endereco', end.logradouro);
  preencher('numero', end.numero);
  preencher('complemento', end.complemento);
  preencher('bairro', end.bairro);
  preencher('cidade', end.cidade);
  preencher('uf', end.uf);
}

/* ── Cupom de desconto ───────────────────────────────────────── */

async function aplicarCupom() {
  if (b2bLogado()) {
    showToast('🏷️ Cupom não vale junto com preço de lojista — sua tabela já está aplicada.', 4500);
    return;
  }
  const input = document.getElementById('cart-cupom-input');
  const msg = document.getElementById('cart-cupom-msg');
  const btn = document.getElementById('cart-cupom-btn');
  const codigo = (input?.value || '').trim().toUpperCase();
  if (!codigo) {
    if (msg) {
      msg.style.display = 'block';
      msg.className = 'frete-msg frete-erro';
      msg.textContent = 'Digite o código do cupom.';
    }
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const r = await fetch('/api/cupons/validar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo }),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || 'Cupom inválido');
    appliedCoupon = {
      codigo: data.codigo,
      desconto_percent: data.desconto_percent,
      influencer: data.influencer || null,
    };
    saveCoupon();
    renderCartUI();
    renderCheckoutResumo();
    showToast(`🎉 Cupom <strong>${data.codigo}</strong> · ${data.desconto_percent}% OFF`);
  } catch (err) {
    appliedCoupon = null;
    saveCoupon();
    if (msg) {
      msg.style.display = 'block';
      msg.className = 'frete-msg frete-erro';
      msg.textContent = err.message || 'Cupom inválido';
    }
    renderCartUI();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = appliedCoupon ? 'OK' : 'Aplicar'; }
  }
}

function removerCupom() {
  appliedCoupon = null;
  saveCoupon();
  const input = document.getElementById('cart-cupom-input');
  const msg = document.getElementById('cart-cupom-msg');
  if (input) input.value = '';
  if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
  renderCartUI();
  renderCheckoutResumo();
}

/* ── Frete (cotação via /api/frete) ───────────────────────────── */

// Máscara simples de CEP (00000-000) e invalida frete escolhido ao editar.
function onCepInput(el) {
  let v = el.value.replace(/\D/g, '').slice(0, 8);
  if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5);
  el.value = v;
  selectedFrete = null;
}

async function calcularFrete() {
  const cepEl = document.getElementById('cart-cep');
  const box = document.getElementById('cart-frete-options');
  if (!cepEl || !box) return;
  const cep = cepEl.value.replace(/\D/g, '');
  if (cep.length !== 8) {
    box.innerHTML = `<p class="frete-msg frete-erro">Digite um CEP válido (8 dígitos).</p>`;
    return;
  }
  if (cart.length === 0) return;

  box.innerHTML = `<p class="frete-msg">Calculando frete…</p>`;
  try {
    const r = await fetch('/api/frete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cep, itens: cart }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || data.error || 'Falha na cotação');

    if (data.freteGratis) {
      // Grátis pro cliente, mas o pedido precisa levar uma logística real
      // (a mais barata) — sem ela a Expedição não gera etiqueta de verdade.
      const maisBarata = (data.opcoes || []).slice().sort((a, b) => a.price - b.price)[0];
      selectedFrete = maisBarata
        ? { ...maisBarata, price: 0 }
        : { id: 'gratis', name: 'Frete grátis', company: '', price: 0, prazo: null };
      box.innerHTML = `<p class="frete-msg frete-ok">🎉 Você ganhou frete grátis!</p>`;
      renderCartUI();
      return;
    }
    if (!data.opcoes || !data.opcoes.length) {
      box.innerHTML = `<p class="frete-msg frete-erro">${data.aviso || 'Sem opções de envio para este CEP.'}</p>`;
      return;
    }
    renderFreteOptions(data.opcoes);
  } catch (err) {
    box.innerHTML = `<p class="frete-msg frete-erro">Não foi possível calcular: ${err.message}</p>`;
  }
}

function renderFreteOptions(opcoes) {
  const box = document.getElementById('cart-frete-options');
  if (!box) return;
  box.innerHTML = opcoes.map((o, i) => {
    const prazo = o.prazo ? ` · ${o.prazo} dia(s) útil(eis)` : '';
    const label = [o.company, o.name].filter(Boolean).join(' ');
    return `<label class="frete-opt">
      <input type="radio" name="frete" value="${i}" onchange="selecionarFrete(${i})" />
      <span class="frete-opt-name">${label}${prazo}</span>
      <span class="frete-opt-price">${formatPrice(o.price)}</span>
    </label>`;
  }).join('');
  // guarda as opções no elemento para o select
  box._opcoes = opcoes;
  // pré-seleciona a 1ª (mais barata)
  const first = box.querySelector('input[name="frete"]');
  if (first) { first.checked = true; selecionarFrete(0); }
}

function selecionarFrete(i) {
  const box = document.getElementById('cart-frete-options');
  const o = box?._opcoes?.[i];
  if (!o) return;
  selectedFrete = o;
  renderCartUI();
}

function formatPrice(value) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ── Cart Drawer ────────────────────────────────────
function openCart() {
  document.getElementById('cart-overlay')?.classList.add('open');
  document.getElementById('cart-drawer')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCart() {
  document.getElementById('cart-overlay')?.classList.remove('open');
  document.getElementById('cart-drawer')?.classList.remove('open');
  document.body.style.overflow = '';
}

document.getElementById('cart-btn')?.addEventListener('click', openCart);

// Escape key closes cart
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeCart();
});

/* ── Checkout (dados do cliente → /api/checkout → Mercado Pago) ── */

function openCheckout() {
  if (cart.length === 0) return;
  if (!selectedFrete) {
    showToast('📦 Calcule o frete e escolha uma opção de envio antes de finalizar.', 3500);
    return;
  }
  voltarCheckoutForm(); // garante a etapa do formulário ao (re)abrir
  // copia o CEP já informado no carrinho
  const cepCart = document.getElementById('cart-cep');
  const cepForm = document.getElementById('checkout-cep');
  if (cepForm && cepCart && cepCart.value) { cepForm.value = cepCart.value; onCheckoutCep(cepForm); }
  b2bPreencherCheckout();
  pfPreencherCheckout();
  renderCheckoutResumo();
  document.getElementById('checkout-overlay')?.classList.add('open');
  document.getElementById('checkout-panel')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCheckout() {
  document.getElementById('checkout-overlay')?.classList.remove('open');
  document.getElementById('checkout-panel')?.classList.remove('open');
  document.body.style.overflow = '';
}

function onTipoPessoa(sel) {
  const lbl = document.getElementById('cpf-label');
  if (lbl) lbl.textContent = sel.value === 'J' ? 'CNPJ*' : 'CPF*';
}

// Máscara de CEP + busca de endereço no ViaCEP
function onCheckoutCep(el) {
  let v = el.value.replace(/\D/g, '').slice(0, 8);
  if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5);
  el.value = v;
  if (v.replace(/\D/g, '').length === 8) buscarCep(v.replace(/\D/g, ''));
}

async function buscarCep(cep) {
  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const d = await r.json();
    if (d.erro) return;
    const set = (id, val) => { const e = document.getElementById(id); if (e && val && !e.value) e.value = val; };
    set('checkout-endereco', d.logradouro);
    set('checkout-bairro', d.bairro);
    set('checkout-cidade', d.localidade);
    set('checkout-uf', d.uf);
  } catch { /* silencioso — o cliente pode preencher à mão */ }
}

function renderCheckoutResumo() {
  const box = document.getElementById('checkout-resumo');
  if (!box) return;
  const subtotal = getCartTotal();
  const desconto = getDiscountAmount(subtotal);
  const frete = selectedFrete ? Number(selectedFrete.price) : 0;
  const freteLabel = selectedFrete ? [selectedFrete.company, selectedFrete.name].filter(Boolean).join(' ') : '';
  const descontoLine = appliedCoupon && desconto > 0
    ? `<div class="cart-line cart-line-discount"><span>Desconto (${appliedCoupon.codigo})</span><span>−${formatPrice(desconto)}</span></div>`
    : '';
  box.innerHTML = `
    <div class="cart-line"><span>Subtotal</span><span>${formatPrice(subtotal)}</span></div>
    ${descontoLine}
    <div class="cart-line"><span>Frete (${freteLabel})</span><span>${frete === 0 ? 'Grátis' : formatPrice(frete)}</span></div>
    <div class="cart-line checkout-resumo-total"><span>Total</span><span>${formatPrice(Math.max(0, subtotal - desconto) + frete)}</span></div>`;
}

async function enviarCheckout(event) {
  event.preventDefault();
  const btn = document.getElementById('checkout-submit');
  const form = event.target;
  const f = Object.fromEntries(new FormData(form).entries());

  const cliente = {
    nome: f.nome, email: f.email, telefone: f.telefone,
    // O select fica travado em "J" na área do lojista (campo desabilitado
    // não entra no FormData), e o servidor confere pelo CNPJ da conta.
    tipoPessoa: f.tipoPessoa || (b2bLogado() ? 'J' : 'F'),
    cpfCnpj: f.cpfCnpj,
    cep: f.cep, endereco: f.endereco, numero: f.numero,
    complemento: f.complemento || '', bairro: f.bairro,
    cidade: f.cidade, uf: (f.uf || '').toUpperCase(),
  };

  if (btn) { btn.disabled = true; btn.textContent = 'Processando…'; }
  try {
    const r = await fetch('/api/checkout', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        cliente,
        itens: cart,
        frete: selectedFrete,
        cupom: b2bLogado() ? null : appliedCoupon?.codigo || null,
      }),
    });
    const data = await r.json();
    if (r.status === 401) b2bSessaoInvalida();
    if (!r.ok || !data.preferenceId) throw new Error(data.detail || data.error || 'Falha no checkout');

    // O servidor reconfere o preço na tabela; se mudou (tabela nova na
    // Olist, carrinho velho), o carrinho acompanha antes do pagamento.
    if (Array.isArray(data.itens)) sincronizarPrecosDoCarrinho(data.itens);

    // sem public key configurada → cai para o checkout externo (init_point)
    if (!data.publicKey) {
      if (data.paymentUrl) { window.location.href = data.paymentUrl; return; }
      throw new Error('Pagamento indisponível no momento. Tente novamente em instantes.');
    }
    // pagamento embutido no site (modal do Mercado Pago)
    await renderWalletBrick(data.preferenceId, data.publicKey, data.paymentUrl);
  } catch (err) {
    showToast(`❌ ${err.message}`, 4000);
    if (btn) { btn.disabled = false; btn.textContent = 'Ir para o pagamento →'; }
  }
}

/* ── Wallet Brick: abre o Checkout Pro num modal sobre o site ── */
let mpInstance = null;
let walletBrickController = null;

async function renderWalletBrick(preferenceId, publicKey, fallbackUrl) {
  // SDK não carregou → usa o checkout externo se houver
  if (typeof MercadoPago === 'undefined') {
    if (fallbackUrl) { window.location.href = fallbackUrl; return; }
    throw new Error('Não foi possível carregar o pagamento. Recarregue a página.');
  }

  const form = document.getElementById('checkout-form');
  const pag = document.getElementById('checkout-pagamento');
  const container = document.getElementById('wallet-container');

  // troca a etapa: esconde o formulário, mostra o pagamento
  if (form) form.style.display = 'none';
  if (pag) pag.style.display = 'block';
  if (container) container.innerHTML = '';

  if (!mpInstance) mpInstance = new MercadoPago(publicKey, { locale: 'pt-BR' });

  // remove um brick anterior (caso o cliente tenha voltado e refeito o pedido)
  if (walletBrickController) {
    try { await walletBrickController.unmount(); } catch { /* ignore */ }
    walletBrickController = null;
  }

  walletBrickController = await mpInstance.bricks().create('wallet', 'wallet-container', {
    initialization: { preferenceId, redirectMode: 'modal' },
    customization: { texts: { valueProp: 'practicality' } },
  });
}

// Volta da etapa de pagamento para o formulário de dados.
function voltarCheckoutForm() {
  const form = document.getElementById('checkout-form');
  const pag = document.getElementById('checkout-pagamento');
  if (pag) pag.style.display = 'none';
  if (form) form.style.display = '';
  const btn = document.getElementById('checkout-submit');
  if (btn) { btn.disabled = false; btn.textContent = 'Ir para o pagamento →'; }
}

// ── Toast Notifications ────────────────────────────
function showToast(html, duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span class="toast-icon">🛒</span><span>${html}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'fadeOutToast 0.3s var(--ease) forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Newsletter ─────────────────────────────────────
function handleNewsletterSubmit(event) {
  event.preventDefault();
  const emailEl = document.getElementById('newsletter-email');
  if (!emailEl || !emailEl.value) return;

  const btn = event.target.querySelector('button[type="submit"]');
  if (btn) {
    btn.textContent = '✅ Inscrito!';
    btn.disabled = true;
    btn.style.background = 'var(--clr-primary-lt)';
  }

  showToast(`🎉 Obrigado! Seu cupom de 10% OFF foi enviado para <strong>${emailEl.value}</strong>`);
  emailEl.value = '';

  setTimeout(() => {
    if (btn) {
      btn.textContent = 'Quero o Desconto →';
      btn.disabled = false;
      btn.style.background = '';
    }
  }, 5000);
}

// ── Search (placeholder) ───────────────────────────
document.getElementById('search-btn')?.addEventListener('click', () => {
  showToast('🔍 Busca em breve. Use o catálogo de produtos por enquanto!', 2500);
});

/* ================================================================
   Catálogo dinâmico — lê os produtos do Tiny via /api/produtos
   ================================================================ */

let CATALOG = [];

/* Uma requisição só de /api/produtos por página: a home, a página de
   produto e a faixa do topo dividem a mesma promise. */
let CATALOGO_PROMISE = null;
function carregarCatalogo() {
  if (!CATALOGO_PROMISE) {
    CATALOGO_PROMISE = fetch('/api/produtos', { headers: b2bHeaders() }).then((r) => {
      if (r.status === 401) b2bSessaoInvalida();
      return r.json();
    });
  }
  return CATALOGO_PROMISE;
}

function initCatalog() {
  const catalogGrid = document.getElementById('catalog-grid'); // página produtos
  const homeGrid = document.getElementById('products-grid');   // home
  if (!catalogGrid && !homeGrid) return;

  const grid = catalogGrid || homeGrid;
  grid.innerHTML = catalogSkeleton(catalogGrid ? 6 : 4);

  // Com sessão de lojista, o servidor devolve a tabela dele (Lojista
  // ou Distribuição) em vez do preço de consumidor final.
  carregarCatalogo()
    .then((data) => {
      CATALOG = (data.produtos || []).map(withTags);
      if (homeGrid) {
        aplicarDestaque(data.destaque, data.produtos || []);
        renderProducts(homeGrid, CATALOG.slice(0, 4));
      }
      if (catalogGrid) {
        renderProducts(catalogGrid, CATALOG);
        updateFilterCounts(CATALOG);
        wireCatalogControls();
      }
    })
    .catch(() => {
      grid.innerHTML = `<div class="catalog-empty">
        <p>Não foi possível carregar os produtos agora.</p>
        <button class="btn btn-primary btn-sm" onclick="location.reload()">Tentar novamente</button>
      </div>`;
    });
}

/* ================================================================
   Faixa do topo — o texto mora no painel (/admin - Vitrine).
   O HTML da pagina traz uma versao estatica como rede de seguranca;
   se o painel tiver texto, ele manda.
   ================================================================ */

function initBarraTopo() {
  const barra = document.getElementById('announcement-bar');
  if (!barra) return;
  carregarCatalogo()
    .then((data) => {
      const d = data.destaque;
      if (!d) return;
      if (d.barraAtiva === false) {
        barra.style.display = 'none';
        return;
      }
      if (!d.barraTexto) return;
      // *entre asteriscos* vira negrito - o resto entra escapado
      barra.innerHTML = escHtml(d.barraTexto).replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
    })
    .catch(() => {
      /* sem API, a faixa estatica continua valendo */
    });
}

/* ================================================================
   Destaque da home — o bloco grande vem do painel (/admin → Vitrine).
   O HTML da página já traz uma versão estática: se a API não
   responder, é ela que fica no ar. Aqui só sobrescrevemos o que
   o painel tiver preenchido.
   ================================================================ */

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function aplicarDestaque(d, produtos) {
  const secao = document.getElementById('featured-product');
  if (!secao || !d) return;

  if (d.ativo === false) {
    secao.style.display = 'none';
    return;
  }

  const badge = document.getElementById('destaque-badge');
  if (badge) {
    if (d.badge) { badge.textContent = d.badge; badge.style.display = ''; }
    else badge.style.display = 'none';
  }

  const titulo = document.getElementById('destaque-titulo');
  if (titulo && (d.titulo || d.tituloRealce)) {
    const linhas = String(d.titulo || '').split('\n').map(escHtml).join('<br />');
    const realce = d.tituloRealce ? ` <span>${escHtml(d.tituloRealce)}</span>` : '';
    titulo.innerHTML = linhas + realce;
  }

  const texto = document.getElementById('destaque-texto');
  if (texto && d.texto) texto.textContent = d.texto;

  const bene = document.getElementById('destaque-beneficios');
  if (bene && Array.isArray(d.beneficios) && d.beneficios.length) {
    const check = `<div class="benefit-icon"><svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M5 13l4 4L19 7"/></svg></div>`;
    bene.innerHTML = d.beneficios
      .map((b) => `<div class="benefit-item">${check}${escHtml(b)}</div>`)
      .join('');
  }

  // Preço: sempre o do sistema, pelo código escolhido no painel.
  const precoEl = document.getElementById('destaque-preco');
  if (precoEl) {
    const p = d.sku ? produtos.find((x) => String(x.sku) === String(d.sku)) : null;
    if (!p) {
      precoEl.style.display = 'none';
    } else {
      const [inteiro, centavos] = Number(p.price).toFixed(2).split('.');
      precoEl.style.display = '';
      precoEl.innerHTML =
        `${d.precoPrefixo ? `<span class="per">${escHtml(d.precoPrefixo)}</span>` : ''}` +
        `<span class="currency">R$</span>` +
        `<span class="amount">${escHtml(inteiro)}<sup style="font-size:1.5rem;font-weight:700">,${escHtml(centavos)}</sup></span>`;
    }
  }

  const ctas = document.getElementById('destaque-ctas');
  if (ctas && d.ctaLabel) {
    const seta = `<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;
    let html = `<a href="${escHtml(d.ctaUrl || '#')}" class="btn btn-gold btn-lg">${escHtml(d.ctaLabel)}${seta}</a>`;
    if (d.cta2Label) {
      html += `<a href="${escHtml(d.cta2Url || '#')}" class="btn btn-outline-white btn-lg">${escHtml(d.cta2Label)}</a>`;
    }
    ctas.innerHTML = html;
  }

  const img = document.getElementById('destaque-img');
  if (img && d.imagem) {
    img.src = d.imagem;
    img.alt = [d.titulo, d.tituloRealce].filter(Boolean).join(' ') || img.alt;
  }
}

// Imagem local com fundo transparente para a linha TartOff (sobrepõe a do Tiny)
function localProductImage(name) {
  const n = (name || '').toLowerCase();
  const isGel = n.includes('gel dental') || n.includes('tartoff');
  if (!isGel) return null;
  const size = n.includes('100') ? '100ml' : n.includes('50') ? '50ml' : null;
  const flavor = n.includes('banana') ? 'banana' : n.includes('menta') ? 'menta' : null;
  if (!flavor || !size) return null;
  return `/assets/produtos/gel-${flavor}-${size}.png`;
}

// Deriva tags simples (animal/categoria) a partir do nome — best effort
function withTags(p) {
  const n = (p.name || '').toLowerCase();
  let animal = 'cao gato';
  let category = 'saude';
  if (n.includes('gel dental') || n.includes('tartoff') || n.includes('tártaro') || n.includes('tartaro')) {
    animal = 'cao gato'; category = 'bucal';
  } else if (n.includes('areia') || n.includes('green cat') || n.includes('gato')) {
    animal = 'gato'; category = 'lar';
  } else if (n.includes('osso') || n.includes('everbone') || n.includes('nylon')) {
    animal = 'cao'; category = 'saude';
  }
  const image = localProductImage(p.name) || p.image;
  return { ...p, animal, category, image };
}

function catalogSkeleton(n) {
  return Array.from({ length: n }, () =>
    `<div class="product-card skeleton-card"><div class="product-image skeleton"></div>
     <div class="product-body"><div class="skeleton skeleton-line"></div>
     <div class="skeleton skeleton-line short"></div></div></div>`
  ).join('');
}

function renderProducts(grid, products) {
  if (!products.length) {
    grid.innerHTML = `<div class="catalog-empty"><p>Nenhum produto encontrado.</p></div>`;
    return;
  }
  grid.innerHTML = products.map(productCardHTML).join('');
  // re-aplica animação de reveal
  if (typeof IntersectionObserver !== 'undefined') {
    grid.querySelectorAll('.reveal').forEach((el) => el.classList.add('visible'));
  }
  updateProductCount(products.length);
}

function productUrl(p) {
  return `produto.html?id=${encodeURIComponent(p.id)}`;
}

/* Texto curto do card: a descricao do Tiny vem com HTML, entao tira as
   tags, corta na ultima palavra inteira e fecha com reticencias. */
function resumoProduto(texto, max = 110) {
  const limpo = String(texto || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  if (limpo.length <= max) return limpo;
  const corte = limpo.slice(0, max);
  const espaco = corte.lastIndexOf(' ');
  return (espaco > max * 0.6 ? corte.slice(0, espaco) : corte).replace(/[.,;:-]$/, '') + '…';
}

function productCardHTML(p) {
  const animalLabel = p.animal === 'gato' ? '🐈 Gatos'
    : p.animal === 'cao' ? '🐕 Cães'
    : '🐕 Cães & 🐈 Gatos';
  const priceOld = p.priceOld ? `<span class="price-old">${formatPrice(p.priceOld)}</span>` : '';
  const desc = resumoProduto(p.description) || 'Produto Aion Pharma para o cuidado do seu pet.';
  const outOfStock = p.inStock === false;
  const safeName = (p.name || '').replace(/'/g, "\\'");
  const safeImage = (p.image || '').replace(/'/g, "\\'");
  const safeSku = (p.sku || '').replace(/'/g, "\\'");
  return `
  <a href="${productUrl(p)}" class="product-card reveal" data-animal="${p.animal}" data-category="${p.category}" data-price="${p.price}" data-name="${(p.name || '').toLowerCase()}">
    <div class="product-image">
      <img src="${p.image}" alt="${p.name}" loading="lazy" onerror="this.src='/assets/images/placeholder-produto.svg'" />
      ${outOfStock ? '<div class="product-badges"><span class="badge badge-muted">Indisponível</span></div>' : ''}
    </div>
    <div class="product-body">
      <span class="product-animal">${animalLabel}</span>
      <h3 class="product-name">${p.name}</h3>
      <p class="product-desc">${desc}</p>
      <div class="product-footer">
        <div class="product-price">${priceOld}<span class="price-current">${formatPrice(p.price)}</span></div>
        <button type="button" class="add-to-cart-btn" aria-label="Adicionar ao carrinho" ${outOfStock ? 'disabled' : ''}
          onclick="event.preventDefault(); event.stopPropagation(); addToCart('${p.id}','${safeName}',${p.price},'${safeImage}','${safeSku}')">
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
    </div>
  </a>`;
}

function updateProductCount(n) {
  const el = document.getElementById('product-count');
  if (el) el.textContent = n;
}

// Contadores da sidebar de filtros — derivados do catálogo real (Tiny/Olist),
// para não ficarem defasados quando o catálogo muda. Espelha a lógica de applyCatalog.
function updateFilterCounts(catalog) {
  const setCount = (id, n) => {
    const el = document.getElementById(id);
    if (el) el.textContent = n;
  };
  const count = (fn) => catalog.filter(fn).length;
  setCount('count-cao', count((p) => p.animal.includes('cao')));
  setCount('count-gato', count((p) => p.animal.includes('gato')));
  setCount('count-bucal', count((p) => p.category === 'bucal'));
  setCount('count-lar', count((p) => p.category === 'lar'));
  setCount('count-saude', count((p) => p.category === 'saude'));
  setCount('count-price-1', count((p) => p.price <= 50));
  setCount('count-price-2', count((p) => p.price > 50 && p.price <= 120));
  setCount('count-price-3', count((p) => p.price > 120));
}

// Filtros + ordenação na página de catálogo
function wireCatalogControls() {
  const sort = document.querySelector('.sort-select');
  sort?.addEventListener('change', applyCatalog);
  document.querySelectorAll('.filters-sidebar input[type=checkbox]').forEach((cb) =>
    cb.addEventListener('change', applyCatalog)
  );
}

function applyCatalog() {
  const grid = document.getElementById('catalog-grid');
  if (!grid) return;
  const animals = checkedValues(['filter-cao', 'filter-gato'], { 'filter-cao': 'cao', 'filter-gato': 'gato' });
  const cats = checkedValues(['filter-bucal', 'filter-lar', 'filter-saude'],
    { 'filter-bucal': 'bucal', 'filter-lar': 'lar', 'filter-saude': 'saude' });

  let list = CATALOG.filter((p) => {
    const animalOk = !animals.length || animals.some((a) => p.animal.includes(a));
    const catOk = !cats.length || cats.includes(p.category);
    return animalOk && catOk;
  });

  const sort = document.querySelector('.sort-select')?.value;
  if (sort === 'price-asc') list = [...list].sort((a, b) => a.price - b.price);
  else if (sort === 'price-desc') list = [...list].sort((a, b) => b.price - a.price);

  renderProducts(grid, list);
}

function checkedValues(ids, map) {
  return ids.filter((id) => document.getElementById(id)?.checked).map((id) => map[id]);
}

// substitui a antiga applyFilter inline da página
function applyFilter() { applyCatalog(); }
window.applyFilter = applyFilter;

/* ================================================================
   Página de produto — produto.html?id=
   ================================================================ */

let PRODUCT_PAGE = null;
let productQty = 1;

function initProductPage() {
  const root = document.getElementById('product-page-root');
  if (!root) return;

  const id = new URLSearchParams(location.search).get('id');
  if (!id) {
    root.innerHTML = productPageNotFound();
    return;
  }

  root.innerHTML = '<div class="product-page-loading">Carregando produto…</div>';

  carregarCatalogo()
    .then((data) => {
      const p = (data.produtos || []).map(withTags).find((item) => item.id === id);
      if (!p) {
        root.innerHTML = productPageNotFound();
        return;
      }
      PRODUCT_PAGE = p;
      productQty = 1;
      document.title = `${p.name} — Aion Pharma`;
      const meta = document.querySelector('meta[name="description"]');
      if (meta) meta.content = (p.description || p.name).slice(0, 160);
      root.innerHTML = renderProductPageHTML(p);
      document.getElementById('product-breadcrumb-name').textContent = p.name;
      initRevealAnimations();
    })
    .catch(() => {
      root.innerHTML = `<div class="product-page-error">
        <p>Não foi possível carregar este produto.</p>
        <a href="produtos.html" class="btn btn-primary btn-sm">Voltar ao catálogo</a>
      </div>`;
    });
}

function productPageNotFound() {
  return `<div class="product-page-error">
    <p>Produto não encontrado.</p>
    <a href="produtos.html" class="btn btn-primary btn-sm">Ver todos os produtos</a>
  </div>`;
}

function renderProductPageHTML(p) {
  const animalLabel = p.animal === 'gato' ? '🐈 Gatos'
    : p.animal === 'cao' ? '🐕 Cães'
    : '🐕 Cães & 🐈 Gatos';
  const priceOld = p.priceOld
    ? `<span class="price-compare">${formatPrice(p.priceOld)}</span>`
    : '';
  const discount = p.priceOld
    ? `<span class="price-discount">−${Math.round((1 - p.price / p.priceOld) * 100)}%</span>`
  : '';
  const desc = (p.description || 'Produto Aion Pharma para o cuidado do seu pet.').trim();
  const stockBadge = p.inStock === false
    ? '<span class="badge badge-muted">Indisponível</span>'
    : '<span class="badge badge-green">Em estoque</span>';
  const disabled = p.inStock === false ? 'disabled' : '';

  return `
  <div class="product-layout">
    <div class="product-gallery">
      <div class="product-main-image">
        <img src="${p.image}" alt="${p.name}" id="main-product-img" onerror="this.src='/assets/images/placeholder-produto.svg'" />
      </div>
    </div>
    <div class="product-info">
      <div class="product-info-top">
        <div class="product-brand">Aion Pharma</div>
        <h1 class="product-title">${p.name}</h1>
        <div class="product-rating-row">
          <span class="product-animal">${animalLabel}</span>
          ${stockBadge}
        </div>
        <p class="product-description">${desc}</p>
      </div>
      <div class="price-block">
        <div class="price-row">
          <span class="price-main">${formatPrice(p.price)}</span>
          ${priceOld}
          ${discount}
        </div>
        <p class="price-note">ou 3× de ${formatPrice(p.price / 3)} sem juros no cartão</p>
      </div>
      <div class="option-group">
        <div class="option-label">Quantidade</div>
        <div class="qty-selector">
          <button type="button" class="qty-btn-lg" onclick="changeProductQty(-1)" aria-label="Diminuir">−</button>
          <span class="qty-display" id="product-qty">1</span>
          <button type="button" class="qty-btn-lg" onclick="changeProductQty(1)" aria-label="Aumentar">+</button>
        </div>
      </div>
      <div class="buy-actions">
        <button type="button" class="btn btn-gold btn-lg" ${disabled} onclick="addProductPageToCart()">Adicionar ao carrinho</button>
        <button type="button" class="btn btn-outline btn-lg" ${disabled} onclick="buyProductNow()">Comprar agora</button>
      </div>
      <div class="shipping-info">
        <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        <span>Frete grátis em compras acima de R$ 99</span>
      </div>
    </div>
  </div>
  <div class="product-tabs">
    <div class="tab-content active" id="tab-descricao">
      <h2 class="heading-3" style="margin-bottom:1rem">Sobre o produto</h2>
      <div class="product-long-desc">${desc.replace(/\n/g, '<br>')}</div>
    </div>
  </div>`;
}

function changeProductQty(delta) {
  productQty = Math.max(1, productQty + delta);
  const el = document.getElementById('product-qty');
  if (el) el.textContent = productQty;
}

function addProductPageToCart() {
  if (!PRODUCT_PAGE) return;
  const p = PRODUCT_PAGE;
  for (let i = 0; i < productQty; i++) {
    addToCart(p.id, p.name, p.price, p.image, p.sku);
  }
}

function buyProductNow() {
  addProductPageToCart();
  openCart();
}

window.changeProductQty = changeProductQty;
window.addProductPageToCart = addProductPageToCart;
window.buyProductNow = buyProductNow;
