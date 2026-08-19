const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'production.db');

function initDb() {
  // 删除旧数据库（如果存在）
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    console.log('已删除旧数据库');
  }

  // 创建新数据库
  const db = new Database(DB_PATH);
  
  // 启用外键
  db.pragma('foreign_keys = ON');

  // 读取并执行 schema
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  console.log('✓ 表结构创建完成');

  // 读取并执行种子数据
  const seed = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
  db.exec(seed);
  console.log('✓ 种子数据插入完成');

  // 验证数据
  const empCount = db.prepare('SELECT COUNT(*) as count FROM employees').get();
  const orderCount = db.prepare('SELECT COUNT(*) as count FROM orders').get();
  const procCount = db.prepare('SELECT COUNT(*) as count FROM processes').get();
  
  console.log(`\n数据库初始化成功！`);
  console.log(`  - 员工: ${empCount.count} 条`);
  console.log(`  - 制单: ${orderCount.count} 条`);
  console.log(`  - 工序: ${procCount.count} 条`);
  console.log(`\n数据库文件: ${DB_PATH}`);

  db.close();
}

initDb();
