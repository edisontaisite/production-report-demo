const crypto = require('crypto');

// 管理后台口令。生产环境务必在 Render 的环境变量里设置 ADMIN_PASSWORD；
// 没设置时随机生成一个并打印到启动日志，避免出现「默认口令」这种不设防的状态。
let adminPassword = process.env.ADMIN_PASSWORD || '';
let generated = false;

if (!adminPassword) {
  adminPassword = crypto.randomBytes(9).toString('base64url');
  generated = true;
}

// 签名密钥由口令派生：口令不变则重启后已登录的会话依然有效
const SECRET = crypto.createHash('sha256').update('prs|' + adminPassword).digest();
const COOKIE = 'prs_admin';
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 小时，够一个班次

function printStartupNotice() {
  if (generated) {
    console.log('');
    console.log('  ⚠ 未设置 ADMIN_PASSWORD，已随机生成本次启动的管理后台口令：');
    console.log('      ' + adminPassword);
    console.log('  ⚠ 重启后会变。请在部署平台的环境变量里设置 ADMIN_PASSWORD 固定下来。');
    console.log('');
  } else {
    console.log('✓ 管理后台口令已从 ADMIN_PASSWORD 读取');
  }
}

function sign(expiresAt) {
  return crypto.createHmac('sha256', SECRET).update(String(expiresAt)).digest('hex');
}

function issueToken() {
  const expiresAt = Date.now() + MAX_AGE_MS;
  return expiresAt + '.' + sign(expiresAt);
}

function verifyToken(token) {
  if (typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;

  const expiresAt = Number(token.slice(0, dot));
  const mac = token.slice(dot + 1);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expected = sign(expiresAt);
  // 长度不等时 timingSafeEqual 会抛，先挡掉
  if (mac.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

function checkPassword(input) {
  if (typeof input !== 'string') return false;
  const a = Buffer.from(input);
  const b = Buffer.from(adminPassword);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

function setSessionCookie(res, token) {
  // Secure 只在生产开：本地 http 调试时带 Secure 浏览器不会存
  const flags = [
    COOKIE + '=' + encodeURIComponent(token),
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=' + Math.floor(MAX_AGE_MS / 1000)
  ];
  if (process.env.NODE_ENV === 'production') flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', COOKIE + '=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
}

function isAuthed(req) {
  return verifyToken(readCookie(req, COOKIE));
}

// 挂在 /api/admin 上的守卫；login / logout / session 三个端点放行
function requireAuth(req, res, next) {
  if (req.path === '/login' || req.path === '/logout' || req.path === '/session') {
    return next();
  }
  if (isAuthed(req)) return next();
  res.status(401).json({ ok: false, error: '未登录或登录已过期' });
}

module.exports = {
  printStartupNotice,
  issueToken,
  checkPassword,
  setSessionCookie,
  clearSessionCookie,
  isAuthed,
  requireAuth
};
