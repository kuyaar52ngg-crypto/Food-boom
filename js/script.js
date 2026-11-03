/* =========================================================================
   Food Boom — единый клиентский скрипт
   Каталог, корзина, авторизация, заявки, заказы, админ-панель.
   Данные хранятся в localStorage (демо-«бэкенд»).
   ========================================================================= */
(function () {
  'use strict';

  /* -----------------------------------------------------------------------
     0. Константы и утилиты
     ----------------------------------------------------------------------- */
  const K = {
    users: 'fb.users',
    feedback: 'fb.feedback',
    orders: 'fb.orders',
    session: 'fb.session',
    cart: 'fb.cart',
    orderSeq: 'fb.orderSeq'
  };

  const ROLES = ['guest', 'user', 'operator', 'admin'];

  const ROLE_LABELS = {
    guest: 'Гость',
    user: 'Пользователь',
    operator: 'Оператор',
    admin: 'Администратор'
  };

  const ORDER_STATUSES = {
    new: 'Новый',
    accepted: 'Принят',
    delivering: 'В доставке',
    done: 'Выполнен',
    cancelled: 'Отменён'
  };

  const FEEDBACK_STATUSES = {
    new: 'Новое',
    inwork: 'В работе',
    done: 'Обработано'
  };

  const PAYMENTS = {
    card: 'Картой курьеру',
    cash: 'Наличными',
    online: 'Онлайн-оплата'
  };

  const PRODUCTS = [
    { id: 1, name: 'Ролл Темпура', price: 350, desc: 'Лосось, сливочный сыр, огурец, рис, нори, обжаренный в кляре темпура.', img: 'images/image_0.webp' },
    { id: 2, name: 'Удон с курицей', price: 319, desc: 'Пшеничная лапша, куриное филе, болгарский перец, лук, морковь, соус терияки.', img: 'images/image_1.webp' },
    { id: 3, name: 'Шаурма с белым соусом', price: 295, desc: 'Куриное филе, свежие овощи, пекинская капуста, фирменный белый соус, лаваш.', img: 'images/image_2.webp' },
    { id: 4, name: 'Филадельфия', price: 458, desc: 'Лосось, сливочный сыр, огурец, рис, нори. Классика в идеальном исполнении.', img: 'images/image_3.webp' },
    { id: 5, name: 'Филадельфия Лайт', price: 367, desc: 'Лосось, сливочный сыр, огурец, рис, нори. Легкая версия любимого ролла.', img: 'images/image_4.webp' }
  ];

  const LS = {
    get(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    },
    del(key) {
      try { window.localStorage.removeItem(key); } catch (e) {}
    }
  };

  // Простое (не криптостойкое!) хеширование — только для демо
  function hashPassword(value) {
    const s = String(value);
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    }
    return 'h' + h.toString(16);
  }

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtMoney(n) {
    return new Intl.NumberFormat('ru-RU').format(Number(n) || 0) + ' ₽';
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  /* -----------------------------------------------------------------------
     1. «База данных»
     ----------------------------------------------------------------------- */
  const Store = {
    /* ------------------------- Пользователи ------------------------- */
    users() {
      const list = LS.get(K.users, []);
      return Array.isArray(list) ? list : [];
    },
    saveUsers(list) { LS.set(K.users, list); },

    getUser(id) {
      return this.users().find(u => u.id === Number(id)) || null;
    },

    findByLogin(identifier) {
      const q = String(identifier || '').trim().toLowerCase();
      if (!q) return null;
      return this.users().find(u =>
        String(u.login || '').toLowerCase() === q ||
        String(u.email || '').toLowerCase() === q
      ) || null;
    },

    nextId(list) {
      return list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
    },

    createUser(data) {
      const users = this.users();
      const login = String(data.login || data.email || '').trim();
      const email = String(data.email || '').trim();

      if (login && this.findByLogin(login)) throw new Error('Такой логин или email уже занят');
      if (email && this.findByLogin(email)) throw new Error('Такой логин или email уже занят');

      const user = {
        id: this.nextId(users),
        login: login || ('guest' + Date.now()),
        name: String(data.name || 'Гость').trim(),
        email: email,
        phone: String(data.phone || '').trim(),
        role: ROLES.includes(data.role) ? data.role : 'user',
        password: data.password ? hashPassword(data.password) : null,
        createdAt: new Date().toISOString()
      };

      users.push(user);
      this.saveUsers(users);
      return user;
    },

    updateUser(id, patch) {
      const users = this.users();
      const i = users.findIndex(u => u.id === Number(id));
      if (i === -1) return null;
      users[i] = Object.assign({}, users[i], patch, { id: users[i].id });
      this.saveUsers(users);
      return users[i];
    },

    setRole(id, role) {
      if (!ROLES.includes(role)) throw new Error('Неизвестная роль');

      const user = this.getUser(id);
      if (!user) throw new Error('Пользователь не найден');

      const me = this.currentUser();
      if (me && me.id === user.id && role !== 'admin') {
        throw new Error('Нельзя снять роль администратора с самого себя');
      }
      if (user.role === 'admin' && role !== 'admin') {
        const admins = this.users().filter(u => u.role === 'admin');
        if (admins.length <= 1) throw new Error('В системе должен остаться хотя бы один администратор');
      }
      return this.updateUser(id, { role });
    },

    deleteUser(id) {
      const me = this.currentUser();
      if (me && me.id === Number(id)) throw new Error('Нельзя удалить свою учётную запись');

      const user = this.getUser(id);
      if (!user) throw new Error('Пользователь не найден');

      if (user.role === 'admin' && this.users().filter(u => u.role === 'admin').length <= 1) {
        throw new Error('Нельзя удалить последнего администратора');
      }
      this.saveUsers(this.users().filter(u => u.id !== Number(id)));
      return true;
    },

    /* ---------------------------- Сессия ---------------------------- */
    session() {
      const s = LS.get(K.session, null);
      return s && s.userId ? s : null;
    },
    currentUser() {
      const s = this.session();
      return s ? this.getUser(s.userId) : null;
    },
    login(identifier, password) {
      const user = this.findByLogin(identifier);
      if (!user || !user.password) throw new Error('Пользователь с таким логином не найден');
      if (user.password !== hashPassword(password)) throw new Error('Неверный пароль');
      LS.set(K.session, { userId: user.id, at: Date.now() });
      return user;
    },
    logout() { LS.del(K.session); },
    register(data) {
      if (!data.password || String(data.password).length < 4) {
        throw new Error('Пароль должен быть не короче 4 символов');
      }
      const user = this.createUser(Object.assign({}, data, { role: 'user' }));
      LS.set(K.session, { userId: user.id, at: Date.now() });
      return user;
    },

    /* ---------------------------- Заявки ---------------------------- */
    feedback() {
      const list = LS.get(K.feedback, []);
      return Array.isArray(list) ? list : [];
    },
    saveFeedback(list) { LS.set(K.feedback, list); },
    addFeedback(data) {
      const list = this.feedback();
      const item = {
        id: this.nextId(list),
        name: String(data.name || '').trim(),
        email: String(data.email || '').trim(),
        message: String(data.message || '').trim(),
        status: 'new',
        createdAt: new Date().toISOString()
      };
      list.unshift(item);
      this.saveFeedback(list);
      return item;
    },
    setFeedbackStatus(id, status) {
      const list = this.feedback();
      const item = list.find(f => f.id === Number(id));
      if (!item) return null;
      item.status = FEEDBACK_STATUSES[status] ? status : 'new';
      this.saveFeedback(list);
      return item;
    },
    deleteFeedback(id) {
      this.saveFeedback(this.feedback().filter(f => f.id !== Number(id)));
    },

    /* ---------------------------- Заказы ---------------------------- */
    orders() {
      const list = LS.get(K.orders, []);
      return Array.isArray(list) ? list : [];
    },
    saveOrders(list) { LS.set(K.orders, list); },

    addOrder(data) {
      const list = this.orders();
      const seq = Number(LS.get(K.orderSeq, 1000)) + 1;
      LS.set(K.orderSeq, seq);

      const order = {
        id: seq,
        number: 'FB-' + seq,
        createdAt: new Date().toISOString(),
        status: 'new',
        items: data.items || [],
        total: Number(data.total) || 0,
        customer: data.customer || {},
        delivery: data.delivery || 'delivery',
        address: data.address || '',
        payment: data.payment || 'card',
        comment: data.comment || '',
        userId: data.userId || null
      };

      list.unshift(order);
      this.saveOrders(list);
      return order;
    },
    setOrderStatus(id, status) {
      const list = this.orders();
      const order = list.find(o => o.id === Number(id));
      if (!order) return null;
      order.status = ORDER_STATUSES[status] ? status : 'new';
      this.saveOrders(list);
      return order;
    },
    deleteOrder(id) {
      this.saveOrders(this.orders().filter(o => o.id !== Number(id)));
    }
  };

  /* -----------------------------------------------------------------------
     2. Первичное наполнение: администратор admin / admin
     ----------------------------------------------------------------------- */
  (function seedAdmin() {
    const users = LS.get(K.users, null);
    if (!Array.isArray(users)) {
      LS.set(K.users, [{
        id: 1,
        login: 'admin',
        name: 'Администратор',
        email: 'admin@foodboom.ru',
        phone: '',
        role: 'admin',
        password: hashPassword('admin'),
        createdAt: new Date().toISOString()
      }]);
    }
  })();

  // Экспорт для возможного использования из HTML
  window.FB = {
    Store, ROLES, ROLE_LABELS, ORDER_STATUSES, FEEDBACK_STATUSES, PAYMENTS,
    PRODUCTS, esc, fmtMoney, fmtDate
  };

  /* -----------------------------------------------------------------------
     3. Роутинг инициализации
     ----------------------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {
    if (document.getElementById('productGrid')) initShop();
    if (document.getElementById('adminApp')) initAdmin();
  });

  /* =======================================================================
     4. МАГАЗИН (index.html)
     ======================================================================= */
  function initShop() {
    const $ = id => document.getElementById(id);

    const grid = $('productGrid');
    const productModal = $('productModal');
    const cartModal = $('cartModal');
    const successModal = $('successModal');
    const authModal = $('authModal');
    const checkoutModal = $('checkoutModal');

    const cartItemsBox = $('cartItems');
    const cartCountEl = $('cartCount');
    const cartTotalEl = $('cartTotalPrice');

    /* --------------------------- корзина --------------------------- */
    let cart = (LS.get(K.cart, []) || [])
      .map(Number)
      .filter(id => PRODUCTS.some(p => p.id === id));

    function saveCart() { LS.set(K.cart, cart); }

    function cartDetailed() {
      const map = new Map();
      cart.forEach(id => map.set(id, (map.get(id) || 0) + 1));
      return Array.from(map.entries()).map(function (entry) {
        const p = PRODUCTS.find(x => x.id === entry[0]);
        const qty = entry[1];
        return { id: p.id, name: p.name, price: p.price, img: p.img, qty: qty, sum: p.price * qty };
      });
    }

    function cartTotal() {
      return cartDetailed().reduce((s, i) => s + i.sum, 0);
    }

    function updateCartUI() {
      saveCart();
      const items = cartDetailed();
      cartCountEl.textContent = cart.length;

      if (!items.length) {
        cartItemsBox.innerHTML = '<p class="cart-empty">Корзина пуста.</p>';
        cartTotalEl.textContent = '0 ₽';
        return;
      }

      cartItemsBox.innerHTML = items.map(function (i) {
        return '' +
          '<div class="cart-item">' +
            '<img src="' + esc(i.img) + '" alt="' + esc(i.name) + '">' +
            '<div class="cart-item__info">' +
              '<div class="cart-item__title">' + esc(i.name) + '</div>' +
              '<div class="cart-item__price">' + fmtMoney(i.price) + ' × ' + i.qty + ' = ' + fmtMoney(i.sum) + '</div>' +
            '</div>' +
            '<div class="qty">' +
              '<button type="button" class="qty-btn" data-act="dec" data-id="' + i.id + '">−</button>' +
              '<span>' + i.qty + '</span>' +
              '<button type="button" class="qty-btn" data-act="inc" data-id="' + i.id + '">+</button>' +
            '</div>' +
            '<button type="button" class="remove-item" data-act="del" data-id="' + i.id + '">&times;</button>' +
          '</div>';
      }).join('');

      cartTotalEl.textContent = fmtMoney(cartTotal());
    }

    cartItemsBox.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = Number(btn.dataset.id);
      const act = btn.dataset.act;

      if (act === 'inc') cart.push(id);
      if (act === 'dec') {
        const idx = cart.indexOf(id);
        if (idx !== -1) cart.splice(idx, 1);
      }
      if (act === 'del') {
        cart = cart.filter(x => x !== id);
      }
      updateCartUI();
    });

    /* ------------------------- модальные окна ------------------------ */
    function openModal(m) {
      if (!m) return;
      m.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
    function closeModal(m) {
      if (!m) return;
      m.classList.remove('active');
      if (!document.querySelector('.modal-overlay.active')) {
        document.body.style.overflow = '';
      }
    }

    ['closeProductModal', 'closeCartModal', 'closeSuccessBtn', 'closeAuthModal', 'closeCheckoutModal']
      .forEach(function (id) {
        const btn = $(id);
        if (btn) btn.addEventListener('click', function () {
          closeModal(btn.closest('.modal-overlay'));
        });
      });

    document.querySelectorAll('.modal-overlay').forEach(function (m) {
      m.addEventListener('click', function (e) {
        if (e.target === m) closeModal(m);
      });
    });

    /* ---------------------------- каталог --------------------------- */
    let currentProductId = null;

    function renderProducts() {
      grid.innerHTML = '';
      PRODUCTS.forEach(function (product) {
        const card = document.createElement('div');
        card.className = 'product-card';
        card.innerHTML =
          '<div class="product-card__img-wrapper">' +
            '<img src="' + esc(product.img) + '" alt="' + esc(product.name) + '" class="product-card__img" loading="lazy">' +
          '</div>' +
          '<h3 class="product-card__title">' + esc(product.name) + '</h3>';
        card.addEventListener('click', function () { openProductModal(product); });
        grid.appendChild(card);
      });
    }

    function openProductModal(product) {
      currentProductId = product.id;
      $('modalImg').src = product.img;
      $('modalImg').alt = product.name;
      $('modalTitle').textContent = product.name;
      $('modalDesc').textContent = product.desc;
      $('modalPrice').textContent = fmtMoney(product.price);
      openModal(productModal);
    }

    $('addToCartBtn').addEventListener('click', function () {
      const product = PRODUCTS.find(p => p.id === currentProductId);
      if (!product) return;
      cart.push(product.id);
      updateCartUI();
      closeModal(productModal);
      openModal(cartModal);
    });

    $('openCartBtn').addEventListener('click', function () { openModal(cartModal); });

    /* ------------------------ оформление заказа ---------------------- */
    const coDelivery = $('coDelivery');
    const coAddress = $('coAddress');
    const addressGroup = $('addressGroup');
    const coTotal = $('coTotal');
    const checkoutForm = $('checkoutForm');
    const coError = $('coError');

    coDelivery.addEventListener('change', function () {
      const isDelivery = coDelivery.value === 'delivery';
      addressGroup.style.display = isDelivery ? '' : 'none';
      coAddress.required = isDelivery;
    });

    $('checkoutBtn').addEventListener('click', function () {
      if (!cart.length) {
        alert('Корзина пуста.');
        return;
      }

      const user = Store.currentUser();
      if (user) {
        $('coName').value = user.name || '';
        $('coPhone').value = user.phone || '';
        $('coEmail').value = user.email || '';
      }
      coError.textContent = '';
      coTotal.textContent = fmtMoney(cartTotal());
      closeModal(cartModal);
      openModal(checkoutModal);
    });

    checkoutForm.addEventListener('submit', function (e) {
      e.preventDefault();
      coError.textContent = '';

      const items = cartDetailed().map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty }));
      if (!items.length) {
        coError.textContent = 'Корзина пуста.';
        return;
      }

      const customer = {
        name: $('coName').value.trim(),
        phone: $('coPhone').value.trim(),
        email: $('coEmail').value.trim()
      };
      const delivery = coDelivery.value;
      const address = coAddress.value.trim();
      const payment = $('coPayment').value;
      const comment = $('coComment').value.trim();

      if (!customer.name) { coError.textContent = 'Укажите имя.'; return; }
      if (customer.phone.replace(/\D/g, '').length < 6) { coError.textContent = 'Укажите корректный телефон.'; return; }
      if (delivery === 'delivery' && address.length < 5) { coError.textContent = 'Укажите адрес доставки.'; return; }

      // Привязка к пользователю: авторизованный / существующий / новый гость
      let userId = null;
      const me = Store.currentUser();

      if (me) {
        userId = me.id;
        if (!me.phone && customer.phone) Store.updateUser(me.id, { phone: customer.phone });
      } else {
        const found = Store.users().find(function (u) {
          const byEmail = customer.email && u.email && u.email.toLowerCase() === customer.email.toLowerCase();
          const byPhone = customer.phone && u.phone && u.phone === customer.phone;
          return byEmail || byPhone;
        });

        if (found) {
          userId = found.id;
        } else {
          const guest = Store.createUser({
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            role: 'guest'
          });
          userId = guest.id;
        }
      }

      const order = Store.addOrder({
        items: items,
        total: items.reduce((s, i) => s + i.price * i.qty, 0),
        customer: customer,
        delivery: delivery,
        address: delivery === 'delivery' ? address : '',
        payment: payment,
        comment: comment,
        userId: userId
      });

      cart = [];
      updateCartUI();
      checkoutForm.reset();
      coDelivery.dispatchEvent(new Event('change'));

      closeModal(checkoutModal);
      $('successText').textContent =
        'Заказ №' + order.number + ' принят на сумму ' + fmtMoney(order.total) +
        '. Мы позвоним по номеру ' + customer.phone + '.';
      openModal(successModal);
    });

    /* ------------------------------ заявки --------------------------- */
    $('feedbackForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const status = $('formStatus');
      const btn = e.target.querySelector('button[type="submit"]');

      const name = $('fbName').value.trim();
      const email = $('fbEmail').value.trim();
      const message = $('fbMessage').value.trim();

      if (!name || !email || !message) {
        status.textContent = 'Заполните все поля.';
        status.className = 'form-status error';
        return;
      }

      btn.textContent = 'Отправка...';
      btn.disabled = true;

      try {
        Store.addFeedback({ name: name, email: email, message: message });
        e.target.reset();
        status.textContent = 'Сообщение получено. Спасибо!';
        status.className = 'form-status success';
      } catch (err) {
        status.textContent = 'Что-то пошло не так. Попробуйте снова.';
        status.className = 'form-status error';
      } finally {
        btn.textContent = 'Отправить';
        btn.disabled = false;
      }
    });

    /* --------------------------- авторизация ------------------------- */
    const loginWrapper = $('loginFormWrapper');
    const registerWrapper = $('registerFormWrapper');
    const authNav = $('authNav');

    function renderAuthNav() {
      const user = Store.currentUser();
      if (!authNav) return;

      if (user) {
        const panelLink = (user.role === 'admin' || user.role === 'operator')
          ? '<a href="admin.html" class="btn" style="padding:.5rem 1rem;font-size:.95rem;">Панель</a>'
          : '';
        authNav.innerHTML =
          '<span class="nav-user">Привет, ' + esc(user.name) + '</span>' +
          panelLink +
          '<button class="btn btn-ghost" id="logoutBtn" style="padding:.5rem 1rem;font-size:.95rem;">Выйти</button>';

        $('logoutBtn').addEventListener('click', function () {
          Store.logout();
          window.location.reload();
        });
      } else {
        authNav.innerHTML = '<button class="btn" id="openAuthBtn" style="padding:.5rem 1rem;font-size:.95rem;">Вход</button>';
        $('openAuthBtn').addEventListener('click', function () { openModal(authModal); });
      }
    }

    $('showRegister').addEventListener('click', function (e) {
      e.preventDefault();
      loginWrapper.style.display = 'none';
      registerWrapper.style.display = 'block';
    });
    $('showLogin').addEventListener('click', function (e) {
      e.preventDefault();
      registerWrapper.style.display = 'none';
      loginWrapper.style.display = 'block';
    });

    $('loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      try {
        Store.login($('loginIdentifier').value, $('loginPassword').value);
        window.location.reload();
      } catch (err) {
        alert(err.message || 'Ошибка входа');
      }
    });

    $('registerForm').addEventListener('submit', function (e) {
      e.preventDefault();
      try {
        Store.register({
          name: $('regName').value.trim(),
          email: $('regEmail').value.trim(),
          phone: $('regPhone').value.trim(),
          password: $('regPassword').value
        });
        window.location.reload();
      } catch (err) {
        alert(err.message || 'Ошибка регистрации');
      }
    });

    /* ----------------------------- слайдер --------------------------- */
    const slides = document.querySelectorAll('.slide');
    const dots = document.querySelectorAll('.dot');
    let slideIndex = 0;
    let slideInterval = null;

    function showSlide(index) {
      slides.forEach(s => s.classList.remove('active'));
      dots.forEach(d => d.classList.remove('active'));
      if (slides[index]) slides[index].classList.add('active');
      if (dots[index]) dots[index].classList.add('active');
    }
    function nextSlide() {
      slideIndex = (slideIndex + 1) % slides.length;
      showSlide(slideIndex);
    }
    window.goToSlide = function (index) {
      slideIndex = index;
      showSlide(slideIndex);
      clearInterval(slideInterval);
      slideInterval = setInterval(nextSlide, 6000);
    };
    if (slides.length) {
      slideInterval = setInterval(nextSlide, 6000);
    }

    /* --------------------------- sticky nav -------------------------- */
    const nav = $('mainNav');
    const navLinks = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('section[id]');

    window.addEventListener('scroll', function () {
      if (window.scrollY > 50) nav.classList.add('scrolled');
      else nav.classList.remove('scrolled');

      let current = '';
      sections.forEach(function (section) {
        if (window.scrollY >= section.offsetTop - 150) {
          current = section.getAttribute('id');
        }
      });
      navLinks.forEach(function (link) {
        link.classList.toggle('active', link.getAttribute('href') === '#' + current);
      });
    });

    /* ----------------------------- старт ----------------------------- */
    renderProducts();
    updateCartUI();
    renderAuthNav();
  }

  /* =======================================================================
     5. АДМИН-ПАНЕЛЬ (admin.html)
     ======================================================================= */
  function initAdmin() {
    const $ = id => document.getElementById(id);

    const gate = $('gate');
    const panel = $('panel');
    const gateForm = $('gateForm');
    const gateError = $('gateError');
    const toast = $('toast');

    let activeTab = 'orders';
    let toastTimer = null;

    function showToast(message, type) {
      toast.textContent = message;
      toast.className = 'toast show ' + (type || '');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toast.className = 'toast'; }, 3500);
    }

    /* --------------------------- табы --------------------------- */
    function switchTab(name) {
      activeTab = name;
      document.querySelectorAll('.tab').forEach(function (b) {
        b.classList.toggle('active', b.dataset.tab === name);
      });
      $('panel-orders').hidden = name !== 'orders';
      $('panel-feedback').hidden = name !== 'feedback';
      $('panel-users').hidden = name !== 'users';
    }

    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.dataset.tab); });
    });

    /* --------------------------- статистика --------------------------- */
    function renderStats() {
      const users = Store.users();
      const orders = Store.orders();
      const feedback = Store.feedback();

      const revenue = orders
        .filter(o => o.status !== 'cancelled')
        .reduce((sum, o) => sum + (Number(o.total) || 0), 0);

      const newOrders = orders.filter(o => o.status === 'new').length;
      const newFeedback = feedback.filter(f => f.status === 'new').length;

      $('stats').innerHTML =
        '<div class="stat"><span class="stat-label">Заказы</span><strong>' + orders.length + '</strong><span class="stat-sub">' + newOrders + ' новых</span></div>' +
        '<div class="stat"><span class="stat-label">Выручка</span><strong>' + fmtMoney(revenue) + '</strong><span class="stat-sub">без отменённых</span></div>' +
        '<div class="stat"><span class="stat-label">Пользователи</span><strong>' + users.length + '</strong><span class="stat-sub">' + users.filter(u => u.role === 'guest').length + ' гостей</span></div>' +
        '<div class="stat"><span class="stat-label">Заявки</span><strong>' + feedback.length + '</strong><span class="stat-sub">' + newFeedback + ' новых</span></div>';
    }

    /* --------------------------- заказы --------------------------- */
    function orderItemsText(order) {
      const items = order.items || [];
      if (!items.length) return '—';
      return items.map(i => esc(i.name) + ' × ' + i.qty).join(', ');
    }

    function renderOrders() {
      const box = $('panel-orders');
      const orders = Store.orders();

      if (!orders.length) {
        box.innerHTML = '<p class="empty">Заказов пока нет. Оформите заказ на сайте — он появится здесь.</p>';
        return;
      }

      box.innerHTML =
        '<table class="tbl"><thead><tr>' +
          '<th>№</th><th>Дата</th><th>Клиент</th><th>Доставка / оплата</th><th>Состав</th><th>Сумма</th><th>Статус</th><th></th>' +
        '</tr></thead><tbody>' +
        orders.map(function (o) {
          const c = o.customer || {};
          const statusOptions = Object.keys(ORDER_STATUSES).map(function (k) {
            return '<option value="' + k + '"' + (o.status === k ? ' selected' : '') + '>' + ORDER_STATUSES[k] + '</option>';
          }).join('');

          const delivery = o.delivery === 'pickup'
            ? '<div>Самовывоз</div><div class="muted">—</div>'
            : '<div>Доставка</div><div class="muted">' + esc(o.address || '—') + '</div>';

          return '' +
            '<tr>' +
              '<td><b>' + esc(o.number) + '</b></td>' +
              '<td class="muted nowrap">' + fmtDate(o.createdAt) + '</td>' +
              '<td>' +
                '<div>' + esc(c.name || '—') + '</div>' +
                '<div class="muted">' + esc(c.phone || '') + '</div>' +
                '<div class="muted">' + esc(c.email || '') + '</div>' +
              '</td>' +
              '<td>' + delivery + '<div class="muted">' + esc(PAYMENTS[o.payment] || '—') + '</div></td>' +
              '<td class="muted small">' + orderItemsText(o) +
                (o.comment ? '<div class="comment">«' + esc(o.comment) + '»</div>' : '') +
              '</td>' +
              '<td class="nowrap"><b>' + fmtMoney(o.total) + '</b></td>' +
              '<td><select data-order-status="' + o.id + '">' + statusOptions + '</select></td>' +
              '<td><button class="icon-btn" data-order-delete="' + o.id + '" title="Удалить">✕</button></td>' +
            '</tr>';
        }).join('') +
        '</tbody></table>';
    }

    $('panel-orders').addEventListener('change', function (e) {
      const sel = e.target.closest('[data-order-status]');
      if (!sel) return;
      Store.setOrderStatus(sel.dataset.orderStatus, sel.value);
      renderStats();
      showToast('Статус заказа обновлён', 'ok');
    });

    $('panel-orders').addEventListener('click', function (e) {
      const btn = e.target.closest('[data-order-delete]');
      if (!btn) return;
      if (!confirm('Удалить заказ?')) return;
      Store.deleteOrder(btn.dataset.orderDelete);
      renderOrders();
      renderStats();
      showToast('Заказ удалён');
    });

    /* --------------------------- заявки --------------------------- */
    function renderFeedback() {
      const box = $('panel-feedback');
      const list = Store.feedback();

      if (!list.length) {
        box.innerHTML = '<p class="empty">Заявок пока нет. Они появятся после отправки формы «Отправить сообщение» на сайте.</p>';
        return;
      }

      box.innerHTML =
        '<table class="tbl"><thead><tr>' +
          '<th>Дата</th><th>Имя</th><th>Email</th><th>Сообщение</th><th>Статус</th><th></th>' +
        '</tr></thead><tbody>' +
        list.map(function (f) {
          const options = Object.keys(FEEDBACK_STATUSES).map(function (k) {
            return '<option value="' + k + '"' + (f.status === k ? ' selected' : '') + '>' + FEEDBACK_STATUSES[k] + '</option>';
          }).join('');

          return '' +
            '<tr>' +
              '<td class="muted nowrap">' + fmtDate(f.createdAt) + '</td>' +
              '<td>' + esc(f.name) + '</td>' +
              '<td class="muted">' + esc(f.email) + '</td>' +
              '<td class="small">' + esc(f.message) + '</td>' +
              '<td><select data-feedback-status="' + f.id + '">' + options + '</select></td>' +
              '<td><button class="icon-btn" data-feedback-delete="' + f.id + '" title="Удалить">✕</button></td>' +
            '</tr>';
        }).join('') +
        '</tbody></table>';
    }

    $('panel-feedback').addEventListener('change', function (e) {
      const sel = e.target.closest('[data-feedback-status]');
      if (!sel) return;
      Store.setFeedbackStatus(sel.dataset.feedbackStatus, sel.value);
      renderStats();
      showToast('Статус заявки обновлён', 'ok');
    });

    $('panel-feedback').addEventListener('click', function (e) {
      const btn = e.target.closest('[data-feedback-delete]');
      if (!btn) return;
      if (!confirm('Удалить заявку?')) return;
      Store.deleteFeedback(btn.dataset.feedbackDelete);
      renderFeedback();
      renderStats();
      showToast('Заявка удалена');
    });

    /* ------------------------ пользователи ------------------------ */
    function renderUsers() {
      const box = $('panel-users');
      const users = Store.users();
      const orders = Store.orders();
      const me = Store.currentUser();

      box.innerHTML =
        '<table class="tbl"><thead><tr>' +
          '<th>ID</th><th>Имя</th><th>Логин / Email</th><th>Телефон</th><th>Роль</th><th>Заказов</th><th>Создан</th><th></th>' +
        '</tr></thead><tbody>' +
        users.map(function (u) {
          const roleOptions = ROLES.map(function (r) {
            return '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + ROLE_LABELS[r] + '</option>';
          }).join('');

          const count = orders.filter(o => o.userId === u.id).length;
          const isMe = me && me.id === u.id;

          return '' +
            '<tr' + (isMe ? ' class="row-me"' : '') + '>' +
              '<td class="muted">' + u.id + '</td>' +
              '<td>' + esc(u.name) + (isMe ? ' <span class="badge">это вы</span>' : '') + '</td>' +
              '<td><div>' + esc(u.login) + '</div><div class="muted small">' + esc(u.email || '—') + '</div></td>' +
              '<td class="muted">' + esc(u.phone || '—') + '</td>' +
              '<td><select data-user-role="' + u.id + '"' + (isMe ? ' disabled' : '') + '>' + roleOptions + '</select></td>' +
              '<td class="muted">' + count + '</td>' +
              '<td class="muted nowrap">' + fmtDate(u.createdAt) + '</td>' +
              '<td><button class="icon-btn" data-user-delete="' + u.id + '" title="Удалить">✕</button></td>' +
            '</tr>';
        }).join('') +
        '</tbody></table>';
    }

    $('panel-users').addEventListener('change', function (e) {
      const sel = e.target.closest('[data-user-role]');
      if (!sel) return;
      try {
        Store.setRole(sel.dataset.userRole, sel.value);
        showToast('Роль обновлена', 'ok');
        render();
      } catch (err) {
        showToast(err.message, 'err');
        renderUsers();
      }
    });

    $('panel-users').addEventListener('click', function (e) {
      const btn = e.target.closest('[data-user-delete]');
      if (!btn) return;
      if (!confirm('Удалить пользователя?')) return;
      try {
        Store.deleteUser(btn.dataset.userDelete);
        showToast('Пользователь удалён');
        render();
      } catch (err) {
        showToast(err.message, 'err');
      }
    });

    /* --------------------------- рендер --------------------------- */
    function render() {
      const user = Store.currentUser();
      const allowed = user && (user.role === 'admin' || user.role === 'operator');

      if (!allowed) {
        gate.hidden = false;
        panel.hidden = true;
        if (user) {
          gateError.textContent = 'Вы вошли как «' + ROLE_LABELS[user.role] + '». Доступ к панели запрещён.';
        }
        return;
      }

      gate.hidden = true;
      panel.hidden = false;
      gateError.textContent = '';

      $('whoami').textContent = user.name + ' · ' + ROLE_LABELS[user.role];
      $('tabUsers').hidden = user.role !== 'admin';

      if (user.role !== 'admin' && activeTab === 'users') switchTab('orders');

      renderStats();
      renderOrders();
      renderFeedback();
      if (user.role === 'admin') renderUsers();
    }

    /* ---------------------------- вход ---------------------------- */
    gateForm.addEventListener('submit', function (e) {
      e.preventDefault();
      gateError.textContent = '';
      try {
        const user = Store.login($('gateLogin').value, $('gatePassword').value);
        if (user.role !== 'admin' && user.role !== 'operator') {
          Store.logout();
          gateError.textContent = 'У этого аккаунта нет доступа к панели.';
          return;
        }
        gateForm.reset();
        switchTab('orders');
        render();
      } catch (err) {
        gateError.textContent = err.message || 'Ошибка входа';
      }
    });

    $('logoutBtn').addEventListener('click', function () {
      Store.logout();
      render();
    });

    /* ---------------------------- старт ---------------------------- */
    switchTab('orders');
    render();
  }
})();