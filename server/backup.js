const fs = require('fs');
const path = require('path');

// 备份放在数据库文件旁边的 backups/ 里。生产环境 DB_PATH 是 /data/production.db，
// 所以备份落在 /data/backups/ —— 和数据库同一块持久化磁盘，能扛住重启和重新部署。
//
// 注意这挡不住整块磁盘丢失。真正的异地备份要把文件下载走或推到对象存储，
// 后台提供了下载入口，可以人工或脚本定期取。
const KEEP = 14;                        // 保留最近 14 份
const INTERVAL_MS = 24 * 60 * 60 * 1000; // 每 24 小时一次

let backupDir = null;
let timer = null;

function init(dbPath) {
  backupDir = path.join(path.dirname(dbPath), 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  return backupDir;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
         `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// 文件名白名单校验，防止下载/删除接口被路径穿越利用
const NAME_RE = /^production-\d{8}-\d{6}\.db$/;

function isValidName(name) {
  return typeof name === 'string' && NAME_RE.test(name);
}

function resolveBackup(name) {
  if (!isValidName(name)) return null;
  const full = path.join(backupDir, name);
  // 再确认一次解析后的路径确实在备份目录内
  if (path.dirname(path.resolve(full)) !== path.resolve(backupDir)) return null;
  return full;
}

function list() {
  if (!backupDir || !fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter(isValidName)
    .map((name) => {
      const st = fs.statSync(path.join(backupDir, name));
      return { name, size: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1));   // 新的在前
}

function prune() {
  const files = list();
  const extra = files.slice(KEEP);
  for (const f of extra) {
    try {
      fs.unlinkSync(path.join(backupDir, f.name));
      console.log('清理旧备份:', f.name);
    } catch (e) {
      console.error('清理旧备份失败:', f.name, e.message);
    }
  }
  return extra.length;
}

// 用 SQLite 自己的 VACUUM INTO 生成快照。
// 不能直接 cp 数据库文件 —— 开了 WAL 之后，复制出来的文件很可能是残缺的。
async function run(runExclusive) {
  if (!backupDir) throw new Error('备份目录未初始化');

  const name = `production-${stamp()}.db`;
  const dest = path.join(backupDir, name);
  if (fs.existsSync(dest)) {
    throw new Error('同名备份已存在，请稍后再试');
  }

  // VACUUM INTO 的目标路径不能用参数占位符，这里的路径由服务端拼装、
  // 文件名只含数字和连字符，不来自用户输入
  await runExclusive(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);

  const size = fs.statSync(dest).size;
  const pruned = prune();
  console.log(`✓ 数据库已备份: ${name}（${(size / 1024).toFixed(1)} KB）` +
              (pruned ? `，清理 ${pruned} 份旧备份` : ''));
  return { name, size };
}

function schedule(runExclusive) {
  const tick = () => {
    run(runExclusive).catch((e) => console.error('自动备份失败:', e.message));
  };
  // 启动后先备一份，之后每 24 小时一次
  setTimeout(tick, 5000);
  timer = setInterval(tick, INTERVAL_MS);
  if (timer.unref) timer.unref();
  console.log(`✓ 自动备份已启用：每 24 小时一份，保留最近 ${KEEP} 份，目录 ${backupDir}`);
}

function stop() {
  if (timer) clearInterval(timer);
}

module.exports = { init, run, list, schedule, stop, resolveBackup, isValidName, KEEP };
