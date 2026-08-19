const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'production.db');

// sqlite3 是异步 API，这里封装成 Promise
function exec(db, sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => (err ? reject(err) : resolve()));
  });
}

function getCount(db, sql) {
  return new Promise((resolve, reject) => {
    db.get(sql, (err, row) => (err ? reject(err) : resolve(row.count)));
  });
}

function initDb() {
  // 删除旧数据库（如果存在）
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    console.log('已删除旧数据库');
  }

  // 创建新数据库
  const db = new sqlite3.Database(DB_PATH, async (err) => {
    if (err) {
      console.error('创建数据库失败:', err);
      process.exit(1);
    }

    try {
      // 启用外键
      await exec(db, 'PRAGMA foreign_keys = ON');

      // 读取并执行 schema
      const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
      await exec(db, schema);
      console.log('✓ 表结构创建完成');

      // 读取并执行种子数据
      const seed = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
      await exec(db, seed);
      console.log('✓ 种子数据插入完成');

      // 验证数据
      const empCount = await getCount(db, 'SELECT COUNT(*) as count FROM employees');
      const orderCount = await getCount(db, 'SELECT COUNT(*) as count FROM orders');
      const procCount = await getCount(db, 'SELECT COUNT(*) as count FROM processes');

      console.log(`\n数据库初始化成功！`);
      console.log(`  - 员工: ${empCount} 条`);
      console.log(`  - 制单: ${orderCount} 条`);
      console.log(`  - 工序: ${procCount} 条`);
      console.log(`\n数据库文件: ${DB_PATH}`);

      db.close(() => process.exit(0));
    } catch (e) {
      console.error('数据库初始化失败:', e);
      process.exit(1);
    }
  });
}

initDb();
