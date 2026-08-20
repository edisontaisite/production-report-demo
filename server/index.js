const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'db', 'production.db');

let db = null;

function initDatabase() {
  return new Promise((resolve, reject) => {
    const dir = path.join(__dirname, 'db');
    
    console.log('数据库路径:', DB_PATH);
    console.log('数据库目录:', dir);
    
    // 确保目录存在
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log('创建数据库目录成功');
      }
    } catch (err) {
      console.error('创建数据库目录失败:', err);
      reject(err);
      return;
    }
    
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('数据库连接失败:', err);
        reject(err);
        return;
      }
      
      console.log('数据库连接成功');
      
      db.run('PRAGMA foreign_keys = ON');
      db.run('PRAGMA journal_mode = WAL');
      db.run('PRAGMA busy_timeout = 5000', () => {
        const schemaPath = path.join(__dirname, 'db', 'schema.sql');
        const seedPath = path.join(__dirname, 'db', 'seed.sql');
        
        console.log('Schema 文件路径:', schemaPath);
        console.log('Seed 文件路径:', seedPath);
        
        // 检查 SQL 文件是否存在
        if (!fs.existsSync(schemaPath)) {
          console.error('Schema 文件不存在!');
          reject(new Error('Schema file not found'));
          return;
        }
        if (!fs.existsSync(seedPath)) {
          console.error('Seed 文件不存在!');
          reject(new Error('Seed file not found'));
          return;
        }
        
        // 是否已初始化，看核心表在不在，而不是看文件大小：
        // 开了 WAL 之后空库文件也不是 0 字节；而且初始化中途失败时文件同样非空，
        // 按大小判断会让半截库被当成「已存在」，永远不会自愈。
        db.get(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='employees'",
          (probeErr, probeRow) => {
          if (probeErr) {
            console.error('检查数据库状态失败:', probeErr);
            reject(probeErr);
            return;
          }

          if (!probeRow) {
            console.log('初始化数据库...');

            let schema, seed;
            try {
              schema = fs.readFileSync(schemaPath, 'utf8');
              seed = fs.readFileSync(seedPath, 'utf8');
              console.log('SQL 文件读取成功');
            } catch (err) {
              console.error('读取 SQL 文件失败:', err);
              reject(err);
              return;
            }
          
            db.exec(schema, (err) => {
              if (err) {
                console.error('创建表失败:', err);
                reject(err);
                return;
              }
              console.log('表创建成功');
            
              db.exec(seed, (err) => {
                if (err) {
                  console.error('插入种子数据失败:', err);
                  reject(err);
                  return;
                }
                console.log('数据库初始化完成');
                resolve(db);
              });
            });
          } else {
            console.log('数据库已存在');

            // 幂等迁移：老库升级（新列 / 新表）。
            // 这些迁移必须全部跑完才 resolve —— 之前是「发出去就不管」，
            // 服务可能在新列建好之前就开始接收请求。
            const addColumn = (table, column, ddl) => new Promise((done) => {
              db.all(`PRAGMA table_info(${table})`, (err, cols) => {
                if (err || !cols) return done();
                if (cols.some(c => c.name === column)) return done();
                db.run(ddl, (e) => {
                  if (e) console.error(`迁移 ${table}.${column} 失败:`, e.message);
                  else console.log(`✓ 迁移: ${table} 增加 ${column} 列`);
                  done();
                });
              });
            });

            const runStep = (sql, okMsg, failMsg) => new Promise((done) => {
              db.exec(sql, (e) => {
                if (e) console.error(failMsg, e.message);
                else if (okMsg) console.log(okMsg);
                done();
              });
            });

            addColumn('report_items', 'rqty',
              'ALTER TABLE report_items ADD COLUMN rqty REAL NOT NULL DEFAULT 0')
              .then(() => addColumn('reports', 'client_token',
                'ALTER TABLE reports ADD COLUMN client_token TEXT'))
              // 幂等键唯一索引必须在列建好之后创建
              .then(() => runStep(
                `CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_token
                   ON reports(client_token) WHERE client_token IS NOT NULL;`,
                '✓ 迁移: reports 幂等键索引就绪',
                '迁移 idx_reports_token 失败:'
              ))
              .then(() => runStep(
                `CREATE TABLE IF NOT EXISTS group_targets (
                   grp TEXT PRIMARY KEY,
                   target_per_person REAL NOT NULL DEFAULT 0,
                   std_dct REAL NOT NULL DEFAULT 0.4,
                   created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                 );
                 INSERT OR IGNORE INTO group_targets (grp, target_per_person, std_dct) VALUES
                   ('缝纫A组', 47, 0.4), ('缝纫B组', 54, 0.4),
                   ('裁剪组', 33, 0.4), ('后整组', 26, 0.4);
                 CREATE TABLE IF NOT EXISTS group_headcount (
                   grp TEXT NOT NULL,
                   date TEXT NOT NULL,
                   headcount INTEGER NOT NULL,
                   created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                   PRIMARY KEY (grp, date)
                 );`,
                '✓ 迁移: group_targets / group_headcount 表就绪（含默认目标）',
                '迁移 group_targets 失败:'
              ))
              .then(() => resolve(db));
          }
          }
        );
      });
    });
  });
}

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function runInsert(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

// 事务串行队列。
//
// 全局只有一个 sqlite3 连接，同一时刻只能有一个事务。之前用 db.serialize() 包住
// BEGIN，但 serialize 只对回调里「同步」发出的语句生效，而业务回调是 async 的：
// 每个 await 都会让出事件循环，第二个请求就能插进来执行 BEGIN，于是
// SQLITE_ERROR: cannot start a transaction within a transaction。更糟的是当时
// BEGIN 没带回调，node-sqlite3 会把错误抛成 Statement 的 'error' 事件，没人监听
// 就变成 uncaughtException，整个进程退出。
//
// 这里改成一条 Promise 队列，保证同一时刻只有一个事务在跑；所有
// BEGIN / COMMIT / ROLLBACK 都带回调，错误一律走 Promise，不再有裸的 'error' 事件。
let txQueue = Promise.resolve();

function runTransaction(callback) {
  const result = txQueue.then(() => execTransaction(callback));
  // 队列自身必须吞掉失败，否则一次事务出错会让后面排队的事务全部被拒绝
  txQueue = result.catch(() => {});
  return result;
}

function execTransaction(callback) {
  return new Promise((resolve, reject) => {
    // BEGIN IMMEDIATE 立刻拿写锁，避免事务中途才升级锁而撞上 SQLITE_BUSY
    db.run('BEGIN IMMEDIATE', (beginErr) => {
      if (beginErr) return reject(beginErr);

      const run = (sql, params = []) => new Promise((res, rej) => {
        db.run(sql, params, function(err) {
          if (err) rej(err);
          else res({ lastID: this.lastID, changes: this.changes });
        });
      });
      const all = (sql, params = []) => new Promise((res, rej) => {
        db.all(sql, params, (err, rows) => (err ? rej(err) : res(rows)));
      });

      Promise.resolve(callback({ run, all }))
        .then((value) => {
          db.run('COMMIT', (commitErr) => {
            if (!commitErr) return resolve(value);
            db.run('ROLLBACK', () => reject(commitErr));
          });
        })
        .catch((err) => {
          db.run('ROLLBACK', (rollbackErr) => {
            // 回滚失败必须记下来，否则这类静默失效永远查不到
            if (rollbackErr) console.error('事务回滚失败:', rollbackErr.message);
            reject(err);
          });
        });
    });
  });
}

app.locals.db = { runQuery, runInsert, runTransaction, db: () => db };

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const employeesRouter = require('./routes/employees');
const reportsRouter = require('./routes/reports');
const adminRouter = require('./routes/admin');

app.use('/api/employees', employeesRouter);
app.use('/api/orders', require('./routes/orders'));
app.use('/api/reports', reportsRouter);
app.use('/api/admin', adminRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

let server;

initDatabase()
  .then(() => {
    server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`✓ Server running on port ${PORT}`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`✓ Database: ${DB_PATH}`);
    });
    
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`✗ 端口 ${PORT} 已被占用`);
        console.error('尝试关闭现有进程或使用其他端口');
      } else {
        console.error('✗ 服务器错误:', err);
      }
      process.exit(1);
    });
  })
  .catch((err) => {
    console.error('=== 启动失败 ===');
    console.error('错误类型:', err.name);
    console.error('错误信息:', err.message);
    console.error('错误堆栈:', err.stack);
    process.exit(1);
  });

// 优雅关闭
function gracefulShutdown(signal) {
  console.log(`\n收到 ${signal} 信号，正在关闭服务器...`);
  
  if (server) {
    server.close(() => {
      console.log('HTTP 服务器已关闭');
      if (db) {
        db.close((err) => {
          if (err) console.error('关闭数据库时出错:', err);
          else console.log('数据库连接已关闭');
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    });
    
    // 如果 10 秒后还未关闭，强制退出
    setTimeout(() => {
      console.error('无法正常关闭，强制退出');
      process.exit(1);
    }, 10000);
  } else {
    if (db) db.close();
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
