const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'db', 'production.db');

let db = null;

function initDatabase() {
  return new Promise((resolve, reject) => {
    const dir = path.join(__dirname, 'db');
    const fs = require('fs');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('数据库连接失败:', err);
        reject(err);
        return;
      }
      
      db.run('PRAGMA foreign_keys = ON', () => {
        const schemaPath = path.join(__dirname, 'db', 'schema.sql');
        const seedPath = path.join(__dirname, 'db', 'seed.sql');
        const fs = require('fs');
        
        if (!fs.existsSync(DB_PATH) || fs.statSync(DB_PATH).size === 0) {
          console.log('初始化数据库...');
          const schema = fs.readFileSync(schemaPath, 'utf8');
          const seed = fs.readFileSync(seedPath, 'utf8');
          
          db.exec(schema, (err) => {
            if (err) {
              console.error('创建表失败:', err);
              reject(err);
              return;
            }
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

initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('启动失败:', err);
    process.exit(1);
  });

process.on('SIGINT', () => {
  console.log('\nClosing...');
  if (db) db.close();
  process.exit(0);
});
