require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_foodboom_key_123';

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
   Инициализация базы данных SQLite
   ============================================================ */
const db = new Database('foodboom.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    phone TEXT DEFAULT '',
    permissions TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    description TEXT DEFAULT '',
    img TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT,
    user_id INTEGER,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT DEFAULT '',
    delivery TEXT DEFAULT 'delivery',
    address TEXT DEFAULT '',
    payment TEXT DEFAULT 'card',
    comment TEXT DEFAULT '',
    total INTEGER DEFAULT 0,
    status TEXT DEFAULT 'new',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    qty INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'new',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    excerpt TEXT DEFAULT '',
    content TEXT NOT NULL,
    cover TEXT DEFAULT '',
    status TEXT DEFAULT 'draft',
    author_id INTEGER,
    author_name TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    published_at DATETIME
  );
`);

const userColumns = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userColumns.includes('permissions')) {
  db.exec('ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT NULL');
}

// Создаём админа и демо-сотрудников
const adminEmail = 'admin@foodboom.ru';
if (!db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail)) {
  db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run('Администратор', adminEmail, bcrypt.hashSync('admin123', 10), 'admin');
  console.log('✅ Создан админ: admin@foodboom.ru / admin123');
}

const seedStaff = [
  { name: 'Оператор', email: 'operator@foodboom.ru', password: 'operator123', role: 'operator' },
  { name: 'Редактор', email: 'editor@foodboom.ru', password: 'editor123', role: 'editor' }
];
for (const s of seedStaff) {
  if (!db.prepare('SELECT id FROM users WHERE email = ?').get(s.email)) {
    db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(s.name, s.email, bcrypt.hashSync(s.password, 10), s.role);
    console.log(`✅ Создан сотрудник: ${s.email} / ${s.password} (${s.role})`);
  }
}

/* ============================================================
   Роли и права доступа
   ============================================================ */
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

// Добавляем товары, если их нет
if (db.prepare('SELECT COUNT(*) AS c FROM products').get().c === 0) {
  const insert = db.prepare('INSERT INTO products (name, price, description, img) VALUES (?, ?, ?, ?)');
  insert.run('Ролл Темпура', 350, 'Лосось, сливочный сыр, огурец, рис, нори, обжаренный в кляре темпура.', 'images/image_0.webp');
  insert.run('Удон с курицей', 319, 'Пшеничная лапша, куриное филе, болгарский перец, лук, морковь, соус терияки.', 'images/image_1.webp');
  insert.run('Шаурма с белым соусом', 295, 'Куриное филе, свежие овощи, пекинская капуста, фирменный белый соус, лаваш.', 'images/image_2.webp');
  insert.run('Филадельфия', 458, 'Лосось, сливочный сыр, огурец, рис, нори. Классика в идеальном исполнении.', 'images/image_3.webp');
  insert.run('Филадельфия Лайт', 367, 'Лосось, сливочный сыр, огурец, рис, нори. Лёгкая версия любимого ролла.', 'images/image_4.webp');
  console.log('✅ Товары добавлены');
}

// Демонстрационные публикации блога
if (db.prepare('SELECT COUNT(*) AS c FROM news').get().c === 0) {
  const insNews = db.prepare(`INSERT INTO news (title, excerpt, content, cover, status, author_id, author_name, published_at)
    VALUES (?, ?, ?, ?, 'published', NULL, 'Food Boom', ?)`);
  const now = Date.now();
  insNews.run(
    'Новое осеннее меню',
    'Согревающие боулы с удоном, тыква и специи — что попробовать в ноябре.',
    'Осень — время тёплых боулов. Мы добавили в меню удон с курицей и овощами, тыквой и соусом терияки.\n\nПопробуйте с обжаренным кунжутом и зелёным луком — это сытный обед, который согревает в холодный день.',
    'images/image_1.webp',
    new Date(now).toISOString()
  );
  insNews.run(
    'Как мы выбираем рыбу',
    'Почему роллы лучше есть в день приготовления и как мы проверяем свежесть.',
    'Каждое утро мы получаем рыбу от проверенных поставщиков и готовим из неё роллы в течение дня.\n\nМы не замораживаем рыбу повторно и не оставляем её на следующий день — поэтому вкус остаётся чистым, а текстура нежной.',
    'images/image_3.webp',
    new Date(now - 86400000).toISOString()
  );
  console.log('✅ Добавлены публикации блога');
}

/* ============================================================
   Middleware
   ============================================================ */
function auth(req, res, next) {
  const h = req.headers['authorization'];
  const token = h && h.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ error: 'Недействительный токен' });
    const user = db.prepare('SELECT id, name, email, phone, role, permissions FROM users WHERE id = ?').get(decoded.id);
    if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
    user.permissions = effectivePermissions(user);
    req.user = user;
    next();
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
   API: Авторизация
   ============================================================ */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Заполните все поля' });
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email))
      return res.status(400).json({ error: 'Email уже используется' });

    const hash = await bcrypt.hash(password, 10);
    const r = db.prepare('INSERT INTO users (name, email, password, phone) VALUES (?, ?, ?, ?)')
      .run(name, email, hash, phone || '');

    const user = { id: r.lastInsertRowid, name, email, role: 'user', permissions: [] };
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    res.status(201).json({ token, user });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !await bcrypt.compare(password, user.password))
      return res.status(401).json({ error: 'Неверный email или пароль' });

    const payload = { id: user.id, name: user.name, email: user.email, role: user.role };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { ...payload, phone: user.phone || '', permissions: effectivePermissions(user) } });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/auth/me', auth, (req, res) => {
  const u = req.user;
  res.json({ user: { id: u.id, name: u.name, email: u.email, phone: u.phone || '', role: u.role, permissions: u.permissions } });
});

/* ============================================================
   API: Товары
   ============================================================ */
app.get('/api/products', (req, res) => {
  const rows = db.prepare("SELECT id, name, price, description AS desc, img FROM products WHERE is_active = 1 ORDER BY id").all();
  res.json(rows);
});

/* ============================================================
   API: Заказы
   ============================================================ */
// Создание заказа (публично)
app.post('/api/orders', (req, res) => {
  try {
    const { items, customer, delivery, address, payment, comment } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'Корзина пуста' });

    const name = customer?.name?.trim();
    const phone = customer?.phone?.trim();
    const email = customer?.email?.trim() || '';
    if (!name || phone.replace(/\D/g, '').length < 6)
      return res.status(400).json({ error: 'Проверьте имя и телефон' });

    // Находим или создаём пользователя
    let userId = null;
    const h = req.headers['authorization'];
    if (h) {
      try { userId = jwt.verify(h.split(' ')[1], JWT_SECRET).id; } catch (_) {}
    }
    if (!userId) {
      const found = db.prepare("SELECT id FROM users WHERE email = ? OR phone = ? LIMIT 1").get(email, phone);
      if (found) userId = found.id;
      else {
        const r = db.prepare("INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, 'no_pass', 'guest')")
          .run(name, email || `guest_${Date.now()}@local`, phone);
        userId = r.lastInsertRowid;
      }
    }

    // Считаем сумму + валидация
    let total = 0;
    const normalized = [];
    for (const it of items) {
      const qty = Math.floor(Number(it.qty));
      if (!Number.isFinite(qty) || qty < 1 || qty > 99) continue;

      const p = db.prepare("SELECT id, name, price FROM products WHERE id = ?").get(it.id);
      if (!p) continue;

      total += p.price * qty;
      normalized.push({ id: p.id, name: p.name, price: p.price, qty });
    }

    if (!normalized.length) {
      return res.status(400).json({ error: 'Нет валидных позиций в заказе' });
    }

    const tx = db.transaction(() => {
      const r = db.prepare(`INSERT INTO orders (number, user_id, customer_name, customer_phone, customer_email, delivery, address, payment, comment, total) 
                            VALUES ('TMP', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(userId, name, phone, email, delivery, address || '', payment, comment || '', total);
      const orderId = r.lastInsertRowid;
      const number = `FB-${1000 + orderId}`;
      db.prepare('UPDATE orders SET number = ? WHERE id = ?').run(number, orderId);

      const ins = db.prepare('INSERT INTO order_items (order_id, product_id, name, price, qty) VALUES (?, ?, ?, ?, ?)');
      for (const n of normalized) ins.run(orderId, n.id, n.name, n.price, n.qty);
      return { orderId, number };
    });

    const { number } = tx();
    res.json({ id: number, number, total });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка создания заказа' });
  }
});

// Админ: список заказов
app.get('/api/orders', auth, requirePerm('orders'), (req, res) => {
  const rows = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  const itemStmt = db.prepare('SELECT name, price, qty FROM order_items WHERE order_id = ?');
  rows.forEach(o => {
    o.items = itemStmt.all(o.id);
    o.customer = { name: o.customer_name, phone: o.customer_phone, email: o.customer_email };
  });
  res.json(rows);
});

app.patch('/api/orders', auth, requirePerm('orders'), (req, res) => {
  const { id, status } = req.body;
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
  res.json({ ok: true });
});

app.delete('/api/orders', auth, requirePerm('orders'), (req, res) => {
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(req.query.id);
  db.prepare('DELETE FROM orders WHERE id = ?').run(req.query.id);
  res.json({ ok: true });
});

/* ============================================================
   API: Заявки (Feedback)
   ============================================================ */
app.post('/api/feedback', (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: 'Заполните поля' });
  db.prepare('INSERT INTO feedback (name, email, message) VALUES (?, ?, ?)').run(name, email, message);
  res.json({ success: true });
});

app.get('/api/feedback', auth, requirePerm('feedback'), (req, res) => {
  res.json(db.prepare('SELECT * FROM feedback ORDER BY id DESC').all());
});

app.patch('/api/feedback', auth, requirePerm('feedback'), (req, res) => {
  db.prepare('UPDATE feedback SET status = ? WHERE id = ?').run(req.body.status, req.body.id);
  res.json({ ok: true });
});

app.delete('/api/feedback', auth, requirePerm('feedback'), (req, res) => {
  db.prepare('DELETE FROM feedback WHERE id = ?').run(req.query.id);
  res.json({ ok: true });
});

/* ============================================================
   API: Блог (новости)
   ============================================================ */
const NEWS_STATUSES = ['draft', 'published'];
const NEWS_FIELDS = 'id, title, excerpt, content, cover, status, author_id, author_name, created_at, updated_at, published_at';
const newsById = (id) => db.prepare(`SELECT ${NEWS_FIELDS} FROM news WHERE id = ?`).get(id);

// Публичный список — только опубликованное
app.get('/api/news', (req, res) => {
  const rows = db.prepare(`SELECT ${NEWS_FIELDS} FROM news WHERE status = 'published'
    ORDER BY datetime(COALESCE(published_at, created_at)) DESC, id DESC`).all();
  res.json(rows);
});

// Полный список для редактора/администратора (включая черновики)
app.get('/api/news/all', auth, requirePerm('news'), (req, res) => {
  const rows = db.prepare(`SELECT ${NEWS_FIELDS} FROM news
    ORDER BY datetime(COALESCE(published_at, created_at)) DESC, id DESC`).all();
  res.json(rows);
});

app.get('/api/news/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Некорректный id' });
  const post = newsById(id);
  if (!post || post.status !== 'published') return res.status(404).json({ error: 'Публикация не найдена' });
  res.json(post);
});

app.post('/api/news', auth, requirePerm('news'), (req, res) => {
  const { title, content, excerpt, cover, status } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Укажите заголовок' });
  if (!content || !String(content).trim()) return res.status(400).json({ error: 'Добавьте текст публикации' });
  const st = NEWS_STATUSES.includes(status) ? status : 'draft';
  try {
    const r = db.prepare(`INSERT INTO news (title, excerpt, content, cover, status, author_id, author_name, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(String(title).trim(), excerpt || '', String(content), cover || '', st, req.user.id, req.user.name, st === 'published' ? new Date().toISOString() : null);
    res.status(201).json({ post: newsById(r.lastInsertRowid) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось сохранить публикацию' });
  }
});

app.patch('/api/news', auth, requirePerm('news'), (req, res) => {
  const post = db.prepare('SELECT * FROM news WHERE id = ?').get(req.body.id);
  if (!post) return res.status(404).json({ error: 'Публикация не найдена' });
  const title = req.body.title !== undefined ? String(req.body.title).trim() : post.title;
  const content = req.body.content !== undefined ? String(req.body.content) : post.content;
  if (!title || !String(content).trim()) return res.status(400).json({ error: 'Заголовок и текст обязательны' });
  const excerpt = req.body.excerpt !== undefined ? req.body.excerpt : post.excerpt;
  const cover = req.body.cover !== undefined ? req.body.cover : post.cover;
  const status = NEWS_STATUSES.includes(req.body.status) ? req.body.status : post.status;
  let publishedAt = post.published_at;
  if (status === 'published' && !publishedAt) publishedAt = new Date().toISOString();
  if (status !== 'published') publishedAt = null;
  db.prepare(`UPDATE news SET title = ?, excerpt = ?, content = ?, cover = ?, status = ?, updated_at = ?, published_at = ? WHERE id = ?`)
    .run(title, excerpt || '', content, cover || '', status, new Date().toISOString(), publishedAt, post.id);
  res.json({ post: newsById(post.id) });
});

app.delete('/api/news', auth, requirePerm('news'), (req, res) => {
  const id = Number(req.query.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Некорректный id' });
  db.prepare('DELETE FROM news WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ============================================================
   API: Пользователи (только админ)
   ============================================================ */
app.get('/api/users', auth, requireRole('admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, u.role, u.permissions, u.created_at,
    (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders_count
    FROM users u ORDER BY u.id DESC
  `).all();
  res.json(rows.map(u => ({ ...publicUser(u), orders_count: u.orders_count })));
});

// Добавление пользователя
app.post('/api/users', auth, requireRole('admin'), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const phone = String(req.body.phone || '').trim();
    const role = req.body.role || 'user';
    if (!name || !email || !password) return res.status(400).json({ error: 'Заполните имя, email и пароль' });
    if (password.length < 4) return res.status(400).json({ error: 'Пароль — минимум 4 символа' });
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Неизвестная роль' });
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      return res.status(400).json({ error: 'Email уже используется' });
    }
    const perms = normalizePermissionsInput(req.body.permissions);
    const hash = await bcrypt.hash(password, 10);
    const r = db.prepare('INSERT INTO users (name, email, password, role, phone, permissions) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name, email, hash, role, phone, perms === null ? null : JSON.stringify(perms));
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
    res.status(201).json({ user: publicUser(row) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось создать пользователя' });
  }
});

app.patch('/api/users', auth, requireRole('admin'), (req, res) => {
  const id = Number(req.body.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });

  const hasRole = req.body.role !== undefined;
  const role = hasRole ? String(req.body.role) : target.role;
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Неизвестная роль' });
  if (id === req.user.id && role !== 'admin') {
    return res.status(400).json({ error: 'Нельзя снять роль администратора с себя' });
  }
  if (target.role === 'admin' && role !== 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
    if (admins <= 1) return res.status(400).json({ error: 'Должен остаться хотя бы один администратор' });
  }

  let permissions = target.permissions;
  if (Object.prototype.hasOwnProperty.call(req.body, 'permissions')) {
    const perms = normalizePermissionsInput(req.body.permissions);
    permissions = perms === null ? null : JSON.stringify(perms);
  } else if (hasRole && role !== target.role) {
    permissions = null; // сброс на права роли
  }

  const name = req.body.name !== undefined ? String(req.body.name).trim() : target.name;
  const phone = req.body.phone !== undefined ? String(req.body.phone) : target.phone;
  if (!name) return res.status(400).json({ error: 'Имя не может быть пустым' });

  db.prepare('UPDATE users SET name = ?, phone = ?, role = ?, permissions = ? WHERE id = ?')
    .run(name, phone, role, permissions, id);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ user: publicUser(row) });
});

app.delete('/api/users', auth, requireRole('admin'), (req, res) => {
  const id = Number(req.query.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Нельзя удалить себя' });
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (target.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
    if (admins <= 1) return res.status(400).json({ error: 'Нельзя удалить последнего администратора' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ============================================================
   Запуск сервера
   ============================================================ */
const server = app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
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