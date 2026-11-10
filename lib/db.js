'use strict';

/**
 * Единый асинхронный слой доступа к данным.
 *
 *  • MySQL  — основной вариант (Replit и любой обычный хостинг).
 *             Параметры берутся из DATABASE_URL / MYSQL_URL вида
 *             mysql://user:password@host:3306/database или из переменных
 *             MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE.
 *  • SQLite — локальная разработка без MySQL (`npm start` в папке проекта).
 *             Используется better-sqlite3, а если он не собрался — встроенный
 *             в Node.js модуль node:sqlite (Node 22.13+).
 *
 * Интерфейс одинаковый для обоих драйверов:
 *
 *   await db.all(sql, params)   -> массив строк
 *   await db.get(sql, params)   -> строка или null
 *   await db.run(sql, params)   -> { changes, insertId }
 *   await db.exec(sql)          -> выполнить DDL/несколько операторов
 *   await db.transaction(fn)    -> fn(tx), где tx.all/get/run работают в транзакции
 */

function mysqlConfigFromEnv() {
  const url = process.env.DATABASE_URL || process.env.MYSQL_URL || process.env.DB_URL;

  if (url) {
    if (!/^mysql:\/\//i.test(url)) {
      if (/^postgres(ql)?:\/\//i.test(url)) {
        console.warn('⚠️  DATABASE_URL указывает на PostgreSQL — для MySQL нужен DATABASE_URL вида mysql://...');
      }
      return null;
    }
    const parsed = new URL(url);
    return {
      source: 'DATABASE_URL',
      host: parsed.hostname,
      port: Number(parsed.port || 3306),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
      ssl: /ssl=true|sslmode=(require|verify)/i.test(parsed.search) ? { rejectUnauthorized: false } : undefined
    };
  }

  const host = process.env.MYSQL_HOST || process.env.DB_HOST;
  if (!host) return null;

  const sslFlag = String(process.env.MYSQL_SSL || '').toLowerCase();
  return {
    source: 'MYSQL_*',
    host,
    port: Number(process.env.MYSQL_PORT || process.env.DB_PORT || 3306),
    user: process.env.MYSQL_USER || process.env.DB_USER || 'root',
    password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || process.env.DB_NAME || 'foodboom',
    ssl: sslFlag === '1' || sslFlag === 'true' ? { rejectUnauthorized: false } : undefined
  };
}

async function openMysql(config) {
  const mysql = require('mysql2/promise');

  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    charset: 'utf8mb4',
    dateStrings: true,
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_POOL_SIZE || 5),
    ssl: config.ssl
  });

  try {
    await pool.query('SELECT 1');
  } catch (error) {
    await pool.end().catch(() => {});
    throw new Error(
      `Не удалось подключиться к MySQL (${config.host}:${config.port}/${config.database}): ${error.message}`
    );
  }

  async function query(conn, sql, params) {
    const [result] = await conn.query(sql, params && params.length ? params : undefined);
    return result;
  }

  const db = {
    driver: 'mysql',
    label: `MySQL ${config.host}:${config.port}/${config.database}`,

    async all(sql, params) {
      const rows = await query(pool, sql, params);
      return Array.isArray(rows) ? rows : [];
    },
    async get(sql, params) {
      const rows = await query(pool, sql, params);
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    },
    async run(sql, params) {
      const result = await query(pool, sql, params);
      return {
        changes: result && typeof result.affectedRows === 'number' ? result.affectedRows : 0,
        insertId: result && result.insertId ? result.insertId : null
      };
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction(fn) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const tx = {
          all: async (sql, params) => {
            const rows = await query(conn, sql, params);
            return Array.isArray(rows) ? rows : [];
          },
          get: async (sql, params) => {
            const rows = await query(conn, sql, params);
            return Array.isArray(rows) && rows.length ? rows[0] : null;
          },
          run: async (sql, params) => {
            const result = await query(conn, sql, params);
            return {
              changes: result && typeof result.affectedRows === 'number' ? result.affectedRows : 0,
              insertId: result && result.insertId ? result.insertId : null
            };
          }
        };
        const result = await fn(tx);
        await conn.commit();
        return result;
      } catch (error) {
        try { await conn.rollback(); } catch (_) { /* соединение уже закрыто */ }
        throw error;
      } finally {
        conn.release();
      }
    },
    async close() {
      await pool.end();
    }
  };

  return db;
}

function openSqlite(file) {
  let raw;
  let label;

  try {
    const Database = require('better-sqlite3');
    raw = new Database(file);
    label = 'SQLite (better-sqlite3)';
  } catch (error) {
    const { DatabaseSync } = require('node:sqlite');
    raw = new DatabaseSync(file);
    label = 'SQLite (node:sqlite)';
  }

  raw.exec('PRAGMA journal_mode = WAL');

  const db = {
    driver: 'sqlite',
    label: `${label}: ${file}`,

    async all(sql, params) {
      return raw.prepare(sql).all(...(params || []));
    },
    async get(sql, params) {
      const row = raw.prepare(sql).get(...(params || []));
      return row === undefined ? null : row;
    },
    async run(sql, params) {
      const info = raw.prepare(sql).run(...(params || []));
      const insertId = typeof info.lastInsertRowid === 'bigint' ? Number(info.lastInsertRowid) : info.lastInsertRowid;
      return { changes: info.changes, insertId: insertId === undefined ? null : insertId };
    },
    async exec(sql) {
      raw.exec(sql);
    },
    async transaction(fn) {
      raw.exec('BEGIN');
      try {
        const result = await fn(db);
        raw.exec('COMMIT');
        return result;
      } catch (error) {
        try { raw.exec('ROLLBACK'); } catch (_) { /* транзакция уже закрыта */ }
        throw error;
      }
    },
    async close() {
      if (typeof raw.close === 'function') raw.close();
    }
  };

  return db;
}

async function openDatabase() {
  const forced = String(process.env.DB_DRIVER || '').toLowerCase();
  const mysqlConfig = mysqlConfigFromEnv();

  if (forced === 'mysql' && !mysqlConfig) {
    throw new Error(
      'DB_DRIVER=mysql, но параметры подключения не заданы. Укажите DATABASE_URL=mysql://... ' +
      'или переменные MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE.'
    );
  }

  if (mysqlConfig) {
    console.log(`🔌 Подключение к MySQL (${mysqlConfig.source}): ${mysqlConfig.host}:${mysqlConfig.port}/${mysqlConfig.database}`);
    return openMysql(mysqlConfig);
  }

  const file = process.env.DB_PATH || 'foodboom.db';
  console.log(`ℹ️  MySQL не настроен — использую локальную базу ${file}`);
  return openSqlite(file);
}

module.exports = { openDatabase };
