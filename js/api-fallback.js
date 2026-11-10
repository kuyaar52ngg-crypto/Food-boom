/* =========================================================================
   Food Boom — локальный (демо) API для статического хостинга.
   -------------------------------------------------------------------------
   На Vercel статический сайт не запускает server.js, поэтому запросы к
   /api/* возвращают 404 и страницы показывают «Не удалось загрузить каталог».

   Этот скрипт перехватывает fetch к /api/* и, ЕСЛИ настоящий сервер не
   ответил JSON (404/HTML/сеть недоступна), обрабатывает запрос локально:
   данные хранятся в localStorage браузера.

   Если сервер Node.js запущен (локально `npm start`), запросы идут к нему
   и ничего не подменяется — поведение не меняется.
   ========================================================================= */
(function () {
  'use strict';

  if (window.__FB_API_FALLBACK__) return;
  window.__FB_API_FALLBACK__ = true;

  var DB_KEY = 'fb.demo.db.v1';
  var TOKEN_PREFIX = 'demo.';
  var PERMISSION_KEYS = ['orders', 'feedback', 'news'];
  var ROLE_PERMISSIONS = {
    admin: ['orders', 'feedback', 'news'],
    operator: ['feedback'],
    editor: ['news'],
    user: [],
    guest: []
  };
  var VALID_ROLES = ['admin', 'operator', 'editor', 'user', 'guest'];
  var NEWS_STATUSES = ['draft', 'published'];

  /* ---------- Демо-данные (снимок рабочей базы) ---------- */
  var SEED = {
    products: [
      { id: 1, name: 'Ролл Темпура', price: 350, description: 'Лосось, сливочный сыр, огурец, рис, нори, обжаренный в кляре темпура.', img: 'images/image_0.webp', is_active: 1 },
      { id: 2, name: 'Удон с курицей', price: 319, description: 'Пшеничная лапша, куриное филе, болгарский перец, лук, морковь, соус терияки.', img: 'images/image_1.webp', is_active: 1 },
      { id: 3, name: 'Шаурма с белым соусом', price: 295, description: 'Куриное филе, свежие овощи, пекинская капуста, фирменный белый соус, лаваш.', img: 'images/image_2.webp', is_active: 1 },
      { id: 4, name: 'Филадельфия', price: 458, description: 'Лосось, сливочный сыр, огурец, рис, нори. Классика в идеальном исполнении.', img: 'images/image_3.webp', is_active: 1 },
      { id: 5, name: 'Филадельфия Лайт', price: 367, description: 'Лосось, сливочный сыр, огурец, рис, нори. Лёгкая версия любимого ролла.', img: 'images/image_4.webp', is_active: 1 }
    ],
    users: [
      { id: 1, name: 'Администратор', email: 'admin@foodboom.ru', phone: '', role: 'admin', permissions: null, password: 'h9b340f86', created_at: '2026-10-31 04:12:43' },
      { id: 2, name: '23', email: 'tumat206@gmail.com', phone: '79990004504', role: 'guest', permissions: null, password: null, created_at: '2026-10-31 04:14:17' },
      { id: 3, name: 'KKKK', email: 'erwer@gmail.com', phone: '79999000066', role: 'user', permissions: null, password: null, created_at: '2026-10-31 04:15:25' },
      { id: 4, name: 'Оператор', email: 'operator@foodboom.ru', phone: '', role: 'operator', permissions: null, password: 'h253c9ac9', created_at: '2026-11-03 00:06:53' },
      { id: 5, name: 'Редактор', email: 'editor@foodboom.ru', phone: '', role: 'editor', permissions: null, password: 'hb99d4924', created_at: '2026-11-03 00:06:53' },
      { id: 9, name: 'testoper', email: 'testoper@gmail.com', phone: '79999999999', role: 'operator', permissions: null, password: null, created_at: '2026-11-03 00:18:10' },
      { id: 10, name: 'testredaktor', email: 'testredaktor@gmail.com', phone: '79999999999', role: 'editor', permissions: null, password: null, created_at: '2026-11-03 00:18:41' },
      { id: 12, name: 'test', email: 'test@gmail.com', phone: '797979797979', role: 'admin', permissions: null, password: null, created_at: '2026-11-03 00:26:46' }
    ],
    news: [
      {
        id: 2, title: 'Новое осеннее меню',
        excerpt: 'Согревающие боулы с удоном, тыква и специи — что попробовать в ноябре.',
        content: 'Осень — время тёплых боулов. Мы добавили в меню удон с курицей и овощами, тыквой и соусом терияки.\n\nПопробуйте с обжаренным кунжутом и зелёным луком — это сытный обед, который согревает в холодный день.',
        cover: 'images/image_1.webp', status: 'published', author_id: null, author_name: 'Food Boom',
        created_at: '2026-11-03 00:11:10', updated_at: '2026-11-03 00:11:10', published_at: '2026-11-03T00:11:10.907Z'
      },
      {
        id: 3, title: 'Как мы выбираем рыбу',
        excerpt: 'Почему роллы лучше есть в день приготовления и как мы проверяем свежесть.',
        content: 'Каждое утро мы получаем рыбу от проверенных поставщиков и готовим из неё роллы в течение дня.\n\nМы не замораживаем рыбу повторно и не оставляем её на следующий день — поэтому вкус остаётся чистым, а текстура нежной.',
        cover: 'images/image_3.webp', status: 'published', author_id: null, author_name: 'Food Boom',
        created_at: '2026-11-03 00:11:10', updated_at: '2026-11-03 00:11:10', published_at: '2026-11-02T00:11:10.907Z'
      },
      {
        id: 5, title: 'Сегодня снег', excerpt: '1212', content: '121212', cover: '',
        status: 'published', author_id: 10, author_name: 'testredaktor',
        created_at: '2026-11-03 00:21:37', updated_at: '2026-11-03 00:21:37', published_at: '2026-11-03T00:21:37.844Z'
      },
      {
        id: 6, title: 'eqweqw', excerpt: 'eqweqwe', content: 'qweqwe', cover: '',
        status: 'published', author_id: 10, author_name: 'testredaktor',
        created_at: '2026-11-03 00:32:53', updated_at: '2026-11-03 00:32:53', published_at: '2026-11-03T00:32:53.319Z'
      }
    ],
    orders: [
      { id: 1, number: 'FB-1001', user_id: 2, customer_name: '23', customer_phone: '79990004504', customer_email: 'tumat206@gmail.com', delivery: 'pickup', address: '', payment: 'card', comment: '', total: 350, status: 'accepted', created_at: '2026-10-31 04:14:17' },
      { id: 2, number: 'FB-1002', user_id: 1, customer_name: 'Администратор', customer_phone: '79 999 999 99 99', customer_email: 'admin@foodbaoom.ru', delivery: 'delivery', address: 'выаываываыва', payment: 'card', comment: '', total: 3245, status: 'new', created_at: '2026-11-02 23:35:01' },
      { id: 3, number: 'FB-1003', user_id: 1, customer_name: 'Администратор', customer_phone: '324234234234', customer_email: 'admin@foodboom.ru', delivery: 'delivery', address: 'sdfsfsf', payment: 'card', comment: '', total: 9570, status: 'new', created_at: '2026-11-03 00:28:00' }
    ],
    order_items: [
      { id: 1, order_id: 1, product_id: 1, name: 'Ролл Темпура', price: 350, qty: 1 },
      { id: 2, order_id: 2, product_id: 3, name: 'Шаурма с белым соусом', price: 295, qty: 11 },
      { id: 3, order_id: 3, product_id: 2, name: 'Удон с курицей', price: 319, qty: 30 }
    ],
    feedback: [
      { id: 1, name: 'RRRR', email: 'wewe@gmail.com', message: '2121212', status: 'inwork', created_at: '2026-10-31 04:16:13' },
      { id: 2, name: 'Карл', email: 'tumat206@gmail.com', message: 'test', status: 'new', created_at: '2026-11-02 23:35:40' },
      { id: 3, name: '23123', email: 'WQEWQE@GMAIL.COM', message: 'QWEQWEQ', status: 'done', created_at: '2026-11-03 00:33:34' }
    ],
    passwords: { 'admin@foodboom.ru': 'admin123', 'operator@foodboom.ru': 'operator123', 'editor@foodboom.ru': 'editor123' }
  };

  /* ---------- Утилиты ---------- */
  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function hashPassword(value) {
    var s = 'fb:' + String(value == null ? '' : value);
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return 'h' + h.toString(16);
  }

  function trim(value) { return String(value == null ? '' : value).trim(); }
  function isoNow() { return new Date().toISOString(); }
  function ts(value) {
    var d = new Date(String(value == null ? '' : value).replace(' ', 'T'));
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }
  function nextId(list) {
    return list.reduce(function (max, item) { return Math.max(max, Number(item.id) || 0); }, 0) + 1;
  }

  var db = null;
  var lastSerialized = null;

  // Перечитываем localStorage при каждом запросе: так админка в соседней
  // вкладке видит заказы, созданные на сайте.
  function loadDb() {
    var raw = null;
    try { raw = window.localStorage.getItem(DB_KEY); } catch (e) { raw = null; }
    if (db && raw === lastSerialized) return db;
    if (raw) {
      try { db = JSON.parse(raw); } catch (e) { db = null; }
    }
    if (!db || !Array.isArray(db.users) || !Array.isArray(db.products)) db = clone(SEED);
    lastSerialized = raw;
    return db;
  }

  function saveDb() {
    try {
      var raw = JSON.stringify(db);
      window.localStorage.setItem(DB_KEY, raw);
      lastSerialized = raw;
    } catch (e) { /* приватный режим: данные живут до перезагрузки */ }
  }

  /* ---------- Права ---------- */
  function parseCustomPermissions(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    var arr;
    try { arr = JSON.parse(raw); } catch (e) { return null; }
    if (!Array.isArray(arr)) return null;
    return arr.filter(function (k, i) { return PERMISSION_KEYS.indexOf(k) !== -1 && arr.indexOf(k) === i; });
  }

  function normalizePermissionsInput(input) {
    if (input === undefined || input === null) return null;
    if (!Array.isArray(input)) return null;
    return input.filter(function (k, i) { return PERMISSION_KEYS.indexOf(k) !== -1 && input.indexOf(k) === i; });
  }

  function effectivePermissions(user) {
    if (user.role === 'admin') return PERMISSION_KEYS.slice();
    var custom = parseCustomPermissions(user.permissions);
    if (custom !== null) return custom;
    return (ROLE_PERMISSIONS[user.role] || []).slice();
  }

  function publicUser(row) {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone || '',
      role: row.role,
      permissions: effectivePermissions(row),
      custom_permissions: parseCustomPermissions(row.permissions) !== null,
      created_at: row.created_at
    };
  }

  /* ---------- Ответы ---------- */
  function json(data, status) {
    return new Response(JSON.stringify(data), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
  function fail(message, status) { return json({ error: message }, status); }

  /* ---------- Авторизация ---------- */
  function headerValue(headers, name) {
    if (!headers) return '';
    if (typeof headers.get === 'function') return headers.get(name) || '';
    var lower = name.toLowerCase();
    for (var key in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, key) && key.toLowerCase() === lower) return String(headers[key]);
    }
    return '';
  }

  function bearer(headers) {
    var h = headerValue(headers, 'Authorization');
    var parts = String(h).split(' ');
    return parts.length === 2 ? parts[1] : '';
  }

  function tokenFor(user) {
    return TOKEN_PREFIX + user.id + '.' + Date.now().toString(36);
  }

  function userFromToken(headers) {
    var token = bearer(headers);
    if (!token) return { status: 401, error: 'Требуется авторизация' };
    if (token.indexOf(TOKEN_PREFIX) !== 0) return { status: 401, error: 'Недействительный токен' };
    var id = Number(token.slice(TOKEN_PREFIX.length).split('.')[0]);
    var user = loadDb().users.filter(function (u) { return u.id === id; })[0];
    if (!user) return { status: 401, error: 'Пользователь не найден' };
    return { user: user };
  }

  function can(user, perm) { return effectivePermissions(user).indexOf(perm) !== -1; }

  /* ---------- Обработчики ---------- */
  function handle(method, url, body, headers) {
    var u;
    try { u = new URL(url, window.location.href); } catch (e) { u = { pathname: String(url), searchParams: new URLSearchParams('') }; }
    var path = u.pathname;
    var query = u.searchParams;
    var data = loadDb();

    /* ----- Товары ----- */
    if (path === '/api/products' && method === 'GET') {
      return json(data.products.filter(function (p) { return p.is_active !== 0; }).map(function (p) {
        return { id: p.id, name: p.name, price: p.price, desc: p.description, img: p.img };
      }));
    }

    /* ----- Регистрация ----- */
    if (path === '/api/auth/register' && method === 'POST') {
      var regName = trim(body.name), regEmail = trim(body.email), regPassword = body.password, regPhone = trim(body.phone);
      if (!regName || !regEmail || !regPassword) return fail('Заполните все поля', 400);
      if (data.users.some(function (x) { return String(x.email).toLowerCase() === regEmail.toLowerCase(); })) {
        return fail('Email уже используется', 400);
      }
      var newUser = {
        id: nextId(data.users), name: regName, email: regEmail, phone: regPhone,
        role: 'user', permissions: null, password: hashPassword(regPassword), created_at: isoNow()
      };
      data.users.push(newUser);
      saveDb();
      return json({ token: tokenFor(newUser), user: publicUser(newUser) }, 201);
    }

    /* ----- Вход ----- */
    if (path === '/api/auth/login' && method === 'POST') {
      var loginEmail = trim(body.email), loginPassword = String(body.password == null ? '' : body.password);
      var found = data.users.filter(function (x) { return String(x.email).toLowerCase() === loginEmail.toLowerCase(); })[0];
      if (!found || !found.password || found.password !== hashPassword(loginPassword)) {
        return fail('Неверный email или пароль', 401);
      }
      return json({ token: tokenFor(found), user: publicUser(found) });
    }

    /* ----- Текущий пользователь ----- */
    if (path === '/api/auth/me' && method === 'GET') {
      var me = userFromToken(headers);
      if (!me.user) return fail(me.error, me.status);
      var pu = publicUser(me.user);
      return json({ user: { id: pu.id, name: pu.name, email: pu.email, phone: pu.phone, role: pu.role, permissions: pu.permissions } });
    }

    /* ----- Заказы ----- */
    if (path === '/api/orders' && method === 'POST') {
      var items = body.items;
      if (!Array.isArray(items) || !items.length) return fail('Корзина пуста', 400);

      var customer = body.customer || {};
      var customerName = trim(customer.name);
      var customerPhone = trim(customer.phone);
      var customerEmail = trim(customer.email);
      if (!customerName || customerPhone.replace(/\D/g, '').length < 6) return fail('Проверьте имя и телефон', 400);

      var userId = null;
      var tokenUser = userFromToken(headers);
      if (tokenUser.user) userId = tokenUser.user.id;
      if (!userId) {
        var existing = data.users.filter(function (x) {
          return (customerEmail && String(x.email).toLowerCase() === customerEmail.toLowerCase()) ||
                 (customerPhone && String(x.phone) === customerPhone);
        })[0];
        if (existing) userId = existing.id;
        else {
          var guest = {
            id: nextId(data.users), name: customerName, email: customerEmail || ('guest_' + Date.now() + '@local'),
            phone: customerPhone, role: 'guest', permissions: null, password: null, created_at: isoNow()
          };
          data.users.push(guest);
          userId = guest.id;
        }
      }

      var total = 0;
      var normalized = [];
      for (var i = 0; i < items.length; i++) {
        var qty = Math.floor(Number(items[i].qty));
        if (!isFinite(qty) || qty < 1 || qty > 99) continue;
        var product = data.products.filter(function (p) { return p.id === Number(items[i].id) && p.is_active !== 0; })[0];
        if (!product) continue;
        total += product.price * qty;
        normalized.push({ id: product.id, name: product.name, price: product.price, qty: qty });
      }
      if (!normalized.length) return fail('Нет валидных позиций в заказе', 400);

      var orderId = nextId(data.orders);
      var orderNumber = 'FB-' + (1000 + orderId);
      data.orders.push({
        id: orderId, number: orderNumber, user_id: userId,
        customer_name: customerName, customer_phone: customerPhone, customer_email: customerEmail,
        delivery: body.delivery || 'delivery', address: body.address || '',
        payment: body.payment || 'card', comment: body.comment || '',
        total: total, status: 'new', created_at: isoNow()
      });
      normalized.forEach(function (n) {
        data.order_items.push({
          id: nextId(data.order_items), order_id: orderId, product_id: n.id,
          name: n.name, price: n.price, qty: n.qty
        });
      });
      saveDb();
      return json({ id: orderNumber, number: orderNumber, total: total });
    }

    if (path === '/api/orders' && method === 'GET') {
      var authOrders = userFromToken(headers);
      if (!authOrders.user) return fail(authOrders.error, authOrders.status);
      if (!can(authOrders.user, 'orders')) return fail('Недостаточно прав', 403);
      var orderRows = data.orders.slice().sort(function (a, b) { return b.id - a.id; }).map(function (o) {
        var copy = clone(o);
        copy.items = data.order_items.filter(function (it) { return it.order_id === o.id; })
          .map(function (it) { return { name: it.name, price: it.price, qty: it.qty }; });
        copy.customer = { name: o.customer_name, phone: o.customer_phone, email: o.customer_email };
        return copy;
      });
      return json(orderRows);
    }

    if (path === '/api/orders' && method === 'PATCH') {
      var authOrderPatch = userFromToken(headers);
      if (!authOrderPatch.user) return fail(authOrderPatch.error, authOrderPatch.status);
      if (!can(authOrderPatch.user, 'orders')) return fail('Недостаточно прав', 403);
      var patchOrder = data.orders.filter(function (o) { return o.id === Number(body.id); })[0];
      if (patchOrder) { patchOrder.status = body.status; saveDb(); }
      return json({ ok: true });
    }

    if (path === '/api/orders' && method === 'DELETE') {
      var authOrderDel = userFromToken(headers);
      if (!authOrderDel.user) return fail(authOrderDel.error, authOrderDel.status);
      if (!can(authOrderDel.user, 'orders')) return fail('Недостаточно прав', 403);
      var removeId = Number(query.get('id'));
      data.order_items = data.order_items.filter(function (it) { return it.order_id !== removeId; });
      data.orders = data.orders.filter(function (o) { return o.id !== removeId; });
      saveDb();
      return json({ ok: true });
    }

    /* ----- Заявки ----- */
    if (path === '/api/feedback' && method === 'POST') {
      var fbName = trim(body.name), fbEmail = trim(body.email), fbMessage = trim(body.message);
      if (!fbName || !fbEmail || !fbMessage) return fail('Заполните поля', 400);
      data.feedback.push({
        id: nextId(data.feedback), name: fbName, email: fbEmail, message: fbMessage,
        status: 'new', created_at: isoNow()
      });
      saveDb();
      return json({ success: true });
    }

    if (path === '/api/feedback' && method === 'GET') {
      var authFb = userFromToken(headers);
      if (!authFb.user) return fail(authFb.error, authFb.status);
      if (!can(authFb.user, 'feedback')) return fail('Недостаточно прав', 403);
      return json(data.feedback.slice().sort(function (a, b) { return b.id - a.id; }));
    }

    if (path === '/api/feedback' && method === 'PATCH') {
      var authFbPatch = userFromToken(headers);
      if (!authFbPatch.user) return fail(authFbPatch.error, authFbPatch.status);
      if (!can(authFbPatch.user, 'feedback')) return fail('Недостаточно прав', 403);
      var patchFb = data.feedback.filter(function (f) { return f.id === Number(body.id); })[0];
      if (patchFb) { patchFb.status = body.status; saveDb(); }
      return json({ ok: true });
    }

    if (path === '/api/feedback' && method === 'DELETE') {
      var authFbDel = userFromToken(headers);
      if (!authFbDel.user) return fail(authFbDel.error, authFbDel.status);
      if (!can(authFbDel.user, 'feedback')) return fail('Недостаточно прав', 403);
      var fbId = Number(query.get('id'));
      data.feedback = data.feedback.filter(function (f) { return f.id !== fbId; });
      saveDb();
      return json({ ok: true });
    }

    /* ----- Новости ----- */
    if (path === '/api/news' && method === 'GET') {
      var published = data.news.filter(function (n) { return n.status === 'published'; }).slice().sort(function (a, b) {
        var diff = ts(b.published_at || b.created_at) - ts(a.published_at || a.created_at);
        return diff !== 0 ? diff : b.id - a.id;
      });
      return json(published);
    }

    if (path === '/api/news/all' && method === 'GET') {
      var authNews = userFromToken(headers);
      if (!authNews.user) return fail(authNews.error, authNews.status);
      if (!can(authNews.user, 'news')) return fail('Недостаточно прав', 403);
      return json(data.news.slice().sort(function (a, b) {
        var diff = ts(b.published_at || b.created_at) - ts(a.published_at || a.created_at);
        return diff !== 0 ? diff : b.id - a.id;
      }));
    }

    if (path === '/api/news' && method === 'POST') {
      var authNewsPost = userFromToken(headers);
      if (!authNewsPost.user) return fail(authNewsPost.error, authNewsPost.status);
      if (!can(authNewsPost.user, 'news')) return fail('Недостаточно прав', 403);
      if (!trim(body.title)) return fail('Укажите заголовок', 400);
      if (!trim(body.content)) return fail('Добавьте текст публикации', 400);
      var postStatus = NEWS_STATUSES.indexOf(body.status) !== -1 ? body.status : 'draft';
      var post = {
        id: nextId(data.news), title: trim(body.title), excerpt: body.excerpt || '',
        content: String(body.content), cover: body.cover || '', status: postStatus,
        author_id: authNewsPost.user.id, author_name: authNewsPost.user.name,
        created_at: isoNow(), updated_at: isoNow(),
        published_at: postStatus === 'published' ? isoNow() : null
      };
      data.news.push(post);
      saveDb();
      return json({ post: post }, 201);
    }

    if (path === '/api/news' && method === 'PATCH') {
      var authNewsPatch = userFromToken(headers);
      if (!authNewsPatch.user) return fail(authNewsPatch.error, authNewsPatch.status);
      if (!can(authNewsPatch.user, 'news')) return fail('Недостаточно прав', 403);
      var existingPost = data.news.filter(function (n) { return n.id === Number(body.id); })[0];
      if (!existingPost) return fail('Публикация не найдена', 404);
      var nextTitle = body.title !== undefined ? trim(body.title) : existingPost.title;
      var nextContent = body.content !== undefined ? String(body.content) : existingPost.content;
      if (!nextTitle || !trim(nextContent)) return fail('Заголовок и текст обязательны', 400);
      existingPost.title = nextTitle;
      existingPost.content = nextContent;
      existingPost.excerpt = body.excerpt !== undefined ? body.excerpt : existingPost.excerpt;
      existingPost.cover = body.cover !== undefined ? body.cover : existingPost.cover;
      if (NEWS_STATUSES.indexOf(body.status) !== -1) existingPost.status = body.status;
      if (existingPost.status === 'published' && !existingPost.published_at) existingPost.published_at = isoNow();
      if (existingPost.status !== 'published') existingPost.published_at = null;
      existingPost.updated_at = isoNow();
      saveDb();
      return json({ post: existingPost });
    }

    if (path === '/api/news' && method === 'DELETE') {
      var authNewsDel = userFromToken(headers);
      if (!authNewsDel.user) return fail(authNewsDel.error, authNewsDel.status);
      if (!can(authNewsDel.user, 'news')) return fail('Недостаточно прав', 403);
      var newsId = Number(query.get('id'));
      if (!isFinite(newsId)) return fail('Некорректный id', 400);
      data.news = data.news.filter(function (n) { return n.id !== newsId; });
      saveDb();
      return json({ ok: true });
    }

    if (/^\/api\/news\/[^/]+$/.test(path) && method === 'GET') {
      var singleId = Number(path.split('/').pop());
      if (!isFinite(singleId)) return fail('Некорректный id', 400);
      var single = data.news.filter(function (n) { return n.id === singleId; })[0];
      if (!single || single.status !== 'published') return fail('Публикация не найдена', 404);
      return json(single);
    }

    /* ----- Пользователи (админ) ----- */
    if (path === '/api/users' && method === 'GET') {
      var authUsers = userFromToken(headers);
      if (!authUsers.user) return fail(authUsers.error, authUsers.status);
      if (authUsers.user.role !== 'admin') return fail('Доступ запрещён', 403);
      var rows = data.users.slice().sort(function (a, b) { return b.id - a.id; }).map(function (x) {
        var item = publicUser(x);
        item.orders_count = data.orders.filter(function (o) { return o.user_id === x.id; }).length;
        return item;
      });
      return json(rows);
    }

    if (path === '/api/users' && method === 'POST') {
      var authUserPost = userFromToken(headers);
      if (!authUserPost.user) return fail(authUserPost.error, authUserPost.status);
      if (authUserPost.user.role !== 'admin') return fail('Доступ запрещён', 403);
      var nuName = trim(body.name), nuEmail = trim(body.email).toLowerCase();
      var nuPassword = String(body.password || ''), nuPhone = trim(body.phone);
      var nuRole = body.role || 'user';
      if (!nuName || !nuEmail || !nuPassword) return fail('Заполните имя, email и пароль', 400);
      if (nuPassword.length < 4) return fail('Пароль — минимум 4 символа', 400);
      if (VALID_ROLES.indexOf(nuRole) === -1) return fail('Неизвестная роль', 400);
      if (data.users.some(function (x) { return String(x.email).toLowerCase() === nuEmail; })) return fail('Email уже используется', 400);
      var nuPerms = normalizePermissionsInput(body.permissions);
      var createdUser = {
        id: nextId(data.users), name: nuName, email: nuEmail, phone: nuPhone, role: nuRole,
        permissions: nuPerms === null ? null : JSON.stringify(nuPerms),
        password: hashPassword(nuPassword), created_at: isoNow()
      };
      data.users.push(createdUser);
      saveDb();
      return json({ user: publicUser(createdUser) }, 201);
    }

    if (path === '/api/users' && method === 'PATCH') {
      var authUserPatch = userFromToken(headers);
      if (!authUserPatch.user) return fail(authUserPatch.error, authUserPatch.status);
      if (authUserPatch.user.role !== 'admin') return fail('Доступ запрещён', 403);
      var targetId = Number(body.id);
      var target = data.users.filter(function (x) { return x.id === targetId; })[0];
      if (!target) return fail('Пользователь не найден', 404);

      var hasRole = body.role !== undefined;
      var nextRole = hasRole ? String(body.role) : target.role;
      if (VALID_ROLES.indexOf(nextRole) === -1) return fail('Неизвестная роль', 400);
      if (targetId === authUserPatch.user.id && nextRole !== 'admin') return fail('Нельзя снять роль администратора с себя', 400);
      if (target.role === 'admin' && nextRole !== 'admin') {
        var admins = data.users.filter(function (x) { return x.role === 'admin'; }).length;
        if (admins <= 1) return fail('Должен остаться хотя бы один администратор', 400);
      }

      if (Object.prototype.hasOwnProperty.call(body, 'permissions')) {
        var perms = normalizePermissionsInput(body.permissions);
        target.permissions = perms === null ? null : JSON.stringify(perms);
      } else if (hasRole && nextRole !== target.role) {
        target.permissions = null;
      }

      if (body.name !== undefined) {
        var nextName = trim(body.name);
        if (!nextName) return fail('Имя не может быть пустым', 400);
        target.name = nextName;
      }
      if (body.phone !== undefined) target.phone = String(body.phone);
      target.role = nextRole;
      saveDb();
      return json({ user: publicUser(target) });
    }

    if (path === '/api/users' && method === 'DELETE') {
      var authUserDel = userFromToken(headers);
      if (!authUserDel.user) return fail(authUserDel.error, authUserDel.status);
      if (authUserDel.user.role !== 'admin') return fail('Доступ запрещён', 403);
      var delId = Number(query.get('id'));
      if (delId === authUserDel.user.id) return fail('Нельзя удалить себя', 400);
      var delTarget = data.users.filter(function (x) { return x.id === delId; })[0];
      if (!delTarget) return fail('Пользователь не найден', 404);
      if (delTarget.role === 'admin') {
        var totalAdmins = data.users.filter(function (x) { return x.role === 'admin'; }).length;
        if (totalAdmins <= 1) return fail('Нельзя удалить последнего администратора', 400);
      }
      data.users = data.users.filter(function (x) { return x.id !== delId; });
      saveDb();
      return json({ ok: true });
    }

    return fail('Не найдено', 404);
  }

  /* ---------- Перехват fetch ---------- */
  var API_RE = /^\/api\//;

  function isApiUrl(url) {
    try {
      var u = new URL(url, window.location.href);
      return API_RE.test(u.pathname);
    } catch (e) {
      return false;
    }
  }

  // Подменяем ответ только когда маршрута /api нет вовсе (статический хостинг).
  // Ошибки работающего сервера (500/502 и т.п.) не перехватываем, чтобы они
  // были видны, а не маскировались демо-данными.
  function looksLikeMissingApi(response) {
    if (response.status !== 404) return false;
    var type = '';
    try { type = (response.headers.get('content-type') || '').toLowerCase(); } catch (e) { type = ''; }
    return type.indexOf('application/json') === -1;
  }

  function requestOptions(input, init) {
    var method = (init && init.method) || (input && input.method) || 'GET';
    var headers = (init && init.headers) || (input && input.headers) || {};
    var rawBody = init && init.body;
    var body = {};
    if (typeof rawBody === 'string' && rawBody) {
      try { body = JSON.parse(rawBody); } catch (e) { body = {}; }
    }
    return { method: String(method).toUpperCase(), headers: headers, body: body };
  }

  var nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  var demoMode = false;

  function markDemoMode() {
    if (demoMode) return;
    demoMode = true;
    try { window.__FB_DEMO_MODE__ = true; } catch (e) {}
    if (!/(^|\/)admin(\.html)?$/.test(window.location.pathname)) return;
    var paint = function () {
      if (!document.body || document.getElementById('fbDemoBadge')) return;
      var badge = document.createElement('div');
      badge.id = 'fbDemoBadge';
      badge.textContent = 'Демо-режим';
      badge.title = 'Сервер Node.js не подключён: заказы, заявки и правки сохраняются только в этом браузере.';
      badge.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9999;cursor:help;' +
        'background:rgba(20,20,20,.78);color:#fff;font:500 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
        'padding:7px 11px;border-radius:999px;letter-spacing:.02em;';
      document.body.appendChild(badge);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint);
    else setTimeout(paint, 0);
  }

  function localResponse(url, init) {
    var opts = requestOptions(null, init);
    var result;
    try {
      result = handle(opts.method, url, opts.body, opts.headers);
    } catch (e) {
      result = fail('Ошибка демо-хранилища', 500);
    }
    markDemoMode();
    return result;
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';

    if (!isApiUrl(url)) {
      return nativeFetch ? nativeFetch(input, init) : Promise.reject(new TypeError('Failed to fetch'));
    }

    if (!nativeFetch) return Promise.resolve(localResponse(url, init));

    return nativeFetch(input, init).then(function (response) {
      if (looksLikeMissingApi(response)) return localResponse(url, init);
      return response;
    }, function () {
      return localResponse(url, init);
    });
  };

  /* Сброс демо-данных: FB.resetDemoData() в консоли */
  window.FB = window.FB || {};
  window.FB.resetDemoData = function () {
    try { window.localStorage.removeItem(DB_KEY); } catch (e) {}
    db = null;
    lastSerialized = null;
    return 'Демо-данные сброшены';
  };
})();
