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
      
      db.run('PRAGMA foreign_keys = ON', () => {
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
        
        if (!fs.existsSync(DB_PATH) || fs.statSync(DB_PATH).size === 0) {
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
          resolve(db);
        }
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

app.locals.db = { runQuery, runInsert, db: () => db };

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
