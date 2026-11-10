require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { openDatabase } = require('./lib/db');
const schema = require('./lib/schema');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_foodboom_key_123';

// Заполняется при старте, до app.listen()
let db = null;

app.use(cors());
app.use(express.json());

// Блокируем отдачу чувствительных файлов через статику
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (
    /\.(db|db-wal|db-shm|env|log)$/.test(p) ||
    p.endsWith('/server.js') ||
    p.endsWith('/package.json') ||
    p.endsWith('/package-lock.json')
  ) {
    return res.status(404).end();
  }
  next();
});

app.use(express.static(__dirname, {
  extensions: ['html'],
  dotfiles: 'deny'
}));

/* ============================================================
   Вспомогательные функции
   ============================================================ */
// Оборачивает async-обработчик, чтобы ошибки попадали в error handler Express
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Дата в формате, который понимают и MySQL (DATETIME), и SQLite
function sqlDate(date) {
  return new Date(date).toISOString().slice(0, 19).replace('T', ' ');
}
function nowSql() {
  return sqlDate(Date.now());
}

const PERMISSION_KEYS = ['orders', 'feedback', 'news'];
const ROLE_PERMISSIONS = {
  admin:    ['orders', 'feedback', 'news'],
  operator: ['feedback'],
  editor:   ['news'],
  user:     [],
  guest:    []
};
const VALID_ROLES = Object.keys(ROLE_PERMISSIONS);

// null/'' -> права по роли, '[]' -> явно без прав
function parseCustomPermissions(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  let arr;
  try { arr = JSON.parse(raw); } catch (e) { return null; }
  if (!Array.isArray(arr)) return null;
  return [...new Set(arr.filter(k => PERMISSION_KEYS.includes(k)))];
}

function normalizePermissionsInput(input) {
  if (input === undefined || input === null) return null;
  if (!Array.isArray(input)) return null;
  return [...new Set(input.filter(k => PERMISSION_KEYS.includes(k)))];
}

function effectivePermissions(user) {
  if (user.role === 'admin') return PERMISSION_KEYS.slice();
  const custom = parseCustomPermissions(user.permissions);
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

/* ============================================================
   Схема и начальные данные
   ============================================================ */
async function initSchema() {
  const statements = db.driver === 'mysql' ? schema.mysql : schema.sqlite;
  for (const statement of statements) {
    await db.exec(statement);
  }

  // В старых базах может не быть колонки permissions
  const columns = db.driver === 'mysql'
    ? await db.all("SHOW COLUMNS FROM users LIKE 'permissions'")
    : await db.all('PRAGMA table_info(users)');

  const hasPermissions = db.driver === 'mysql'
    ? columns.length > 0
    : columns.some((c) => c.name === 'permissions');

  if (!hasPermissions) {
    await db.exec('ALTER TABLE users ADD COLUMN permissions TEXT ' + (db.driver === 'mysql' ? 'NULL' : 'DEFAULT NULL'));
  }
}

async function seedData() {
  // Создаём админа и демо-сотрудников
  const adminEmail = 'admin@foodboom.ru';
  const admin = await db.get('SELECT id FROM users WHERE email = ?', [adminEmail]);
  if (!admin) {
    await db.run('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      ['Администратор', adminEmail, bcrypt.hashSync('admin123', 10), 'admin']);
    console.log('✅ Создан админ: admin@foodboom.ru / admin123');
  }

  const seedStaff = [
    { name: 'Оператор', email: 'operator@foodboom.ru', password: 'operator123', role: 'operator' },
    { name: 'Редактор', email: 'editor@foodboom.ru', password: 'editor123', role: 'editor' }
  ];
  for (const s of seedStaff) {
    const found = await db.get('SELECT id FROM users WHERE email = ?', [s.email]);
    if (!found) {
      await db.run('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
        [s.name, s.email, bcrypt.hashSync(s.password, 10), s.role]);
      console.log(`✅ Создан сотрудник: ${s.email} / ${s.password} (${s.role})`);
    }
  }

  // Добавляем товары, если их нет
  const productsCount = await db.get('SELECT COUNT(*) AS c FROM products');
  if (Number(productsCount.c) === 0) {
    const items = [
      ['Ролл Темпура', 350, 'Лосось, сливочный сыр, огурец, рис, нори, обжаренный в кляре темпура.', 'images/image_0.webp'],
      ['Удон с курицей', 319, 'Пшеничная лапша, куриное филе, болгарский перец, лук, морковь, соус терияки.', 'images/image_1.webp'],
      ['Шаурма с белым соусом', 295, 'Куриное филе, свежие овощи, пекинская капуста, фирменный белый соус, лаваш.', 'images/image_2.webp'],
      ['Филадельфия', 458, 'Лосось, сливочный сыр, огурец, рис, нори. Классика в идеальном исполнении.', 'images/image_3.webp'],
      ['Филадельфия Лайт', 367, 'Лосось, сливочный сыр, огурец, рис, нори. Лёгкая версия любимого ролла.', 'images/image_4.webp']
    ];
    for (const item of items) {
      await db.run('INSERT INTO products (name, price, description, img) VALUES (?, ?, ?, ?)', item);
    }
    console.log('✅ Товары добавлены');
  }

  // Демонстрационные публикации блога
  const newsCount = await db.get('SELECT COUNT(*) AS c FROM news');
  if (Number(newsCount.c) === 0) {
    const stamp = Date.now();
    await db.run(
      `INSERT INTO news (title, excerpt, content, cover, status, author_id, author_name, published_at)
       VALUES (?, ?, ?, ?, 'published', NULL, 'Food Boom', ?)`,
      [
        'Новое осеннее меню',
        'Согревающие боулы с удоном, тыква и специи — что попробовать в ноябре.',
        'Осень — время тёплых боулов. Мы добавили в меню удон с курицей и овощами, тыквой и соусом терияки.\n\nПопробуйте с обжаренным кунжутом и зелёным луком — это сытный обед, который согревает в холодный день.',
        'images/image_1.webp',
        nowSql()
      ]
    );
    await db.run(
      `INSERT INTO news (title, excerpt, content, cover, status, author_id, author_name, published_at)
       VALUES (?, ?, ?, ?, 'published', NULL, 'Food Boom', ?)`,
      [
        'Как мы выбираем рыбу',
        'Почему роллы лучше есть в день приготовления и как мы проверяем свежесть.',
        'Каждое утро мы получаем рыбу от проверенных поставщиков и готовим из неё роллы в течение дня.\n\nМы не замораживаем рыбу повторно и не оставляем её на следующий день — поэтому вкус остаётся чистым, а текстура нежной.',
        'images/image_3.webp',
        sqlDate(Date.now() - 86400000)
      ]
    );
    console.log('✅ Добавлены публикации блога');
  }
}

/* ============================================================
   Middleware
   ============================================================ */
function auth(req, res, next) {
  const h = req.headers['authorization'];
  const token = h && h.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });

  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err) return res.status(401).json({ error: 'Недействительный токен' });
    try {
      const user = await db.get('SELECT id, name, email, phone, role, permissions FROM users WHERE id = ?', [decoded.id]);
      if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
      user.permissions = effectivePermissions(user);
      req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  });
}

function requirePerm(perm) {
  return (req, res, next) => {
    if (!req.user || !req.user.permissions.includes(perm)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    next();
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Доступ запрещён' });
    next();
  };
}

/* ============================================================
   API: Служебное
   ============================================================ */
app.get('/api/health', wrap(async (req, res) => {
  const row = await db.get('SELECT COUNT(*) AS c FROM products');
  res.json({ ok: true, database: db.driver, products: Number(row.c) });
}));

/* ============================================================
   API: Авторизация
   ============================================================ */
app.post('/api/auth/register', wrap(async (req, res) => {
  const { name, email, password, phone } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Заполните все поля' });
  if (await db.get('SELECT id FROM users WHERE email = ?', [email]))
    return res.status(400).json({ error: 'Email уже используется' });

  const hash = await bcrypt.hash(password, 10);
  let created;
  try {
    created = await db.run('INSERT INTO users (name, email, password, phone) VALUES (?, ?, ?, ?)',
      [name, email, hash, phone || '']);
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Email уже используется' });
    throw error;
  }

  const user = { id: created.insertId, name, email, role: 'user', permissions: [] };
  const token = jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
  res.status(201).json({ token, user });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !await bcrypt.compare(password || '', user.password))
    return res.status(401).json({ error: 'Неверный email или пароль' });

  const payload = { id: user.id, name: user.name, email: user.email, role: user.role };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { ...payload, phone: user.phone || '', permissions: effectivePermissions(user) } });
}));

app.get('/api/auth/me', auth, (req, res) => {
  const u = req.user;
  res.json({ user: { id: u.id, name: u.name, email: u.email, phone: u.phone || '', role: u.role, permissions: u.permissions } });
});

/* ============================================================
   API: Товары
   ============================================================ */
app.get('/api/products', wrap(async (req, res) => {
  const rows = await db.all('SELECT id, name, price, description, img FROM products WHERE is_active = 1 ORDER BY id');
  res.json(rows.map(row => ({
    id: row.id,
    name: row.name,
    price: row.price,
    desc: row.description,
    img: row.img
  })));
}));

/* ============================================================
   API: Заказы
   ============================================================ */
// Создание заказа (публично)
app.post('/api/orders', wrap(async (req, res) => {
  const { items, customer, delivery, address, payment, comment } = req.body || {};
  if (!items || !items.length) return res.status(400).json({ error: 'Корзина пуста' });

  const name = customer && customer.name ? String(customer.name).trim() : '';
  const phone = customer && customer.phone ? String(customer.phone).trim() : '';
  const email = customer && customer.email ? String(customer.email).trim() : '';
  if (!name || phone.replace(/\D/g, '').length < 6)
    return res.status(400).json({ error: 'Проверьте имя и телефон' });

  // Находим или создаём пользователя
  let userId = null;
  const h = req.headers['authorization'];
  if (h) {
    try { userId = jwt.verify(h.split(' ')[1], JWT_SECRET).id; } catch (_) { /* гость */ }
  }
  if (!userId) {
    const found = await db.get(
      "SELECT id FROM users WHERE (email <> '' AND email = ?) OR (phone <> '' AND phone = ?) LIMIT 1",
      [email, phone]
    );
    if (found) {
      userId = found.id;
    } else {
      const created = await db.run(
        "INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, 'no_pass', 'guest')",
        [name, email || `guest_${Date.now()}@local`, phone]
      );
      userId = created.insertId;
    }
  }

  // Считаем сумму + валидация
  let total = 0;
  const normalized = [];
  for (const it of items) {
    const qty = Math.floor(Number(it.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 99) continue;

    const p = await db.get('SELECT id, name, price FROM products WHERE id = ?', [it.id]);
    if (!p) continue;

    total += Number(p.price) * qty;
    normalized.push({ id: p.id, name: p.name, price: Number(p.price), qty });
  }

  if (!normalized.length) {
    return res.status(400).json({ error: 'Нет валидных позиций в заказе' });
  }

  const result = await db.transaction(async (tx) => {
    const created = await tx.run(
      `INSERT INTO orders (number, user_id, customer_name, customer_phone, customer_email, delivery, address, payment, comment, total)
       VALUES ('TMP', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, name, phone, email, delivery || 'delivery', address || '', payment || 'card', comment || '', total]
    );
    const orderId = created.insertId;
    const number = `FB-${1000 + orderId}`;
    await tx.run('UPDATE orders SET number = ? WHERE id = ?', [number, orderId]);

    for (const n of normalized) {
      await tx.run('INSERT INTO order_items (order_id, product_id, name, price, qty) VALUES (?, ?, ?, ?, ?)',
        [orderId, n.id, n.name, n.price, n.qty]);
    }
    return { orderId, number };
  });

  res.json({ id: result.number, number: result.number, total });
}));

// Админ: список заказов
app.get('/api/orders', auth, requirePerm('orders'), wrap(async (req, res) => {
  const rows = await db.all('SELECT * FROM orders ORDER BY id DESC');
  for (const o of rows) {
    o.items = await db.all('SELECT name, price, qty FROM order_items WHERE order_id = ?', [o.id]);
    o.customer = { name: o.customer_name, phone: o.customer_phone, email: o.customer_email };
  }
  res.json(rows);
}));

app.patch('/api/orders', auth, requirePerm('orders'), wrap(async (req, res) => {
  const { id, status } = req.body || {};
  await db.run('UPDATE orders SET status = ? WHERE id = ?', [status, id]);
  res.json({ ok: true });
}));

app.delete('/api/orders', auth, requirePerm('orders'), wrap(async (req, res) => {
  await db.run('DELETE FROM order_items WHERE order_id = ?', [req.query.id]);
  await db.run('DELETE FROM orders WHERE id = ?', [req.query.id]);
  res.json({ ok: true });
}));

/* ============================================================
   API: Заявки (Feedback)
   ============================================================ */
app.post('/api/feedback', wrap(async (req, res) => {
  const { name, email, message } = req.body || {};
  if (!name || !email || !message) return res.status(400).json({ error: 'Заполните поля' });
  await db.run('INSERT INTO feedback (name, email, message) VALUES (?, ?, ?)', [name, email, message]);
  res.json({ success: true });
}));

app.get('/api/feedback', auth, requirePerm('feedback'), wrap(async (req, res) => {
  res.json(await db.all('SELECT * FROM feedback ORDER BY id DESC'));
}));

app.patch('/api/feedback', auth, requirePerm('feedback'), wrap(async (req, res) => {
  await db.run('UPDATE feedback SET status = ? WHERE id = ?', [req.body ? req.body.status : null, req.body ? req.body.id : null]);
  res.json({ ok: true });
}));

app.delete('/api/feedback', auth, requirePerm('feedback'), wrap(async (req, res) => {
  await db.run('DELETE FROM feedback WHERE id = ?', [req.query.id]);
  res.json({ ok: true });
}));

/* ============================================================
   API: Блог (новости)
   ============================================================ */
const NEWS_STATUSES = ['draft', 'published'];
const NEWS_FIELDS = 'id, title, excerpt, content, cover, status, author_id, author_name, created_at, updated_at, published_at';
const newsById = (id) => db.get(`SELECT ${NEWS_FIELDS} FROM news WHERE id = ?`, [id]);

// Публичный список — только опубликованное
app.get('/api/news', wrap(async (req, res) => {
  const rows = await db.all(`SELECT ${NEWS_FIELDS} FROM news WHERE status = 'published'
    ORDER BY COALESCE(published_at, created_at) DESC, id DESC`);
  res.json(rows);
}));

// Полный список для редактора/администратора (включая черновики)
app.get('/api/news/all', auth, requirePerm('news'), wrap(async (req, res) => {
  const rows = await db.all(`SELECT ${NEWS_FIELDS} FROM news
    ORDER BY COALESCE(published_at, created_at) DESC, id DESC`);
  res.json(rows);
}));

app.get('/api/news/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Некорректный id' });
  const post = await newsById(id);
  if (!post || post.status !== 'published') return res.status(404).json({ error: 'Публикация не найдена' });
  res.json(post);
}));

app.post('/api/news', auth, requirePerm('news'), wrap(async (req, res) => {
  const { title, content, excerpt, cover, status } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Укажите заголовок' });
  if (!content || !String(content).trim()) return res.status(400).json({ error: 'Добавьте текст публикации' });

  const st = NEWS_STATUSES.includes(status) ? status : 'draft';
  const created = await db.run(
    `INSERT INTO news (title, excerpt, content, cover, status, author_id, author_name, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [String(title).trim(), excerpt || '', String(content), cover || '', st, req.user.id, req.user.name,
      st === 'published' ? nowSql() : null]
  );
  res.status(201).json({ post: await newsById(created.insertId) });
}));

app.patch('/api/news', auth, requirePerm('news'), wrap(async (req, res) => {
  const body = req.body || {};
  const post = await db.get('SELECT * FROM news WHERE id = ?', [body.id]);
  if (!post) return res.status(404).json({ error: 'Публикация не найдена' });

  const title = body.title !== undefined ? String(body.title).trim() : post.title;
  const content = body.content !== undefined ? String(body.content) : post.content;
  if (!title || !String(content).trim()) return res.status(400).json({ error: 'Заголовок и текст обязательны' });

  const excerpt = body.excerpt !== undefined ? body.excerpt : post.excerpt;
  const cover = body.cover !== undefined ? body.cover : post.cover;
  const status = NEWS_STATUSES.includes(body.status) ? body.status : post.status;

  let publishedAt = post.published_at;
  if (status === 'published' && !publishedAt) publishedAt = nowSql();
  if (status !== 'published') publishedAt = null;

  await db.run(
    'UPDATE news SET title = ?, excerpt = ?, content = ?, cover = ?, status = ?, updated_at = ?, published_at = ? WHERE id = ?',
    [title, excerpt || '', content, cover || '', status, nowSql(), publishedAt, post.id]
  );
  res.json({ post: await newsById(post.id) });
}));

app.delete('/api/news', auth, requirePerm('news'), wrap(async (req, res) => {
  const id = Number(req.query.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Некорректный id' });
  await db.run('DELETE FROM news WHERE id = ?', [id]);
  res.json({ ok: true });
}));

/* ============================================================
   API: Пользователи (только админ)
   ============================================================ */
app.get('/api/users', auth, requireRole('admin'), wrap(async (req, res) => {
  const rows = await db.all(`
    SELECT u.id, u.name, u.email, u.phone, u.role, u.permissions, u.created_at,
    (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders_count
    FROM users u ORDER BY u.id DESC
  `);
  res.json(rows.map(u => ({ ...publicUser(u), orders_count: Number(u.orders_count) || 0 })));
}));

// Добавление пользователя
app.post('/api/users', auth, requireRole('admin'), wrap(async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const phone = String(body.phone || '').trim();
  const role = body.role || 'user';

  if (!name || !email || !password) return res.status(400).json({ error: 'Заполните имя, email и пароль' });
  if (password.length < 4) return res.status(400).json({ error: 'Пароль — минимум 4 символа' });
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Неизвестная роль' });
  if (await db.get('SELECT id FROM users WHERE email = ?', [email]))
    return res.status(400).json({ error: 'Email уже используется' });

  const perms = normalizePermissionsInput(body.permissions);
  const hash = await bcrypt.hash(password, 10);
  let created;
  try {
    created = await db.run(
      'INSERT INTO users (name, email, password, role, phone, permissions) VALUES (?, ?, ?, ?, ?, ?)',
      [name, email, hash, role, phone, perms === null ? null : JSON.stringify(perms)]
    );
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Email уже используется' });
    throw error;
  }
  const row = await db.get('SELECT * FROM users WHERE id = ?', [created.insertId]);
  res.status(201).json({ user: publicUser(row) });
}));

app.patch('/api/users', auth, requireRole('admin'), wrap(async (req, res) => {
  const body = req.body || {};
  const id = Number(body.id);
  const target = await db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });

  const hasRole = body.role !== undefined;
  const role = hasRole ? String(body.role) : target.role;
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Неизвестная роль' });
  if (id === req.user.id && role !== 'admin') {
    return res.status(400).json({ error: 'Нельзя снять роль администратора с себя' });
  }
  if (target.role === 'admin' && role !== 'admin') {
    const admins = await db.get("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'");
    if (Number(admins.c) <= 1) return res.status(400).json({ error: 'Должен остаться хотя бы один администратор' });
  }

  let permissions = target.permissions;
  if (Object.prototype.hasOwnProperty.call(body, 'permissions')) {
    const perms = normalizePermissionsInput(body.permissions);
    permissions = perms === null ? null : JSON.stringify(perms);
  } else if (hasRole && role !== target.role) {
    permissions = null; // сброс на права роли
  }

  const name = body.name !== undefined ? String(body.name).trim() : target.name;
  const phone = body.phone !== undefined ? String(body.phone) : target.phone;
  if (!name) return res.status(400).json({ error: 'Имя не может быть пустым' });

  await db.run('UPDATE users SET name = ?, phone = ?, role = ?, permissions = ? WHERE id = ?',
    [name, phone, role, permissions, id]);
  const row = await db.get('SELECT * FROM users WHERE id = ?', [id]);
  res.json({ user: publicUser(row) });
}));

app.delete('/api/users', auth, requireRole('admin'), wrap(async (req, res) => {
  const id = Number(req.query.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Нельзя удалить себя' });
  const target = await db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (target.role === 'admin') {
    const admins = await db.get("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'");
    if (Number(admins.c) <= 1) return res.status(400).json({ error: 'Нельзя удалить последнего администратора' });
  }
  await db.run('DELETE FROM users WHERE id = ?', [id]);
  res.json({ ok: true });
}));

/* ============================================================
   Обработка ошибок
   ============================================================ */
app.use((err, req, res, next) => {
  console.error('❌ Ошибка запроса', req.method, req.originalUrl, '—', err && err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Ошибка сервера' });
});

/* ============================================================
   Запуск сервера
   ============================================================ */
(async function bootstrap() {
  db = await openDatabase();
  await initSchema();
  await seedData();

  const server = app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
    console.log(`🗄  База данных: ${db.driver} — ${db.label}`);
    console.log(`👤 Админка: admin@foodboom.ru / admin123`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Порт ${PORT} уже занят.`);
      console.error(`   Скорее всего, сервер уже запущен: http://localhost:${PORT}`);
      console.error('   Остановите старый процесс или укажите другой PORT в .env');
      process.exit(1);
    }
    throw err;
  });

  const shutdown = async () => {
    try { await db.close(); } catch (e) { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})().catch((error) => {
  console.error('❌ Не удалось запустить сервер:');
  console.error(error);
  process.exit(1);
});
