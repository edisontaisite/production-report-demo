const express = require('express');
const router = express.Router();
const auth = require('../auth');

// 按姓名查询员工（可能同名，返回数组）
router.get('/by-name/:name', async (req, res) => {
  const db = req.app.locals.db;
  const { name } = req.params;
  
  try {
    const rows = await db.runQuery('SELECT * FROM employees WHERE name = ?', [name]);
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('按姓名查询员工失败:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

router.get('/:id', async (req, res) => {
  const db = req.app.locals.db;
  const { id } = req.params;
  
  try {
    const rows = await db.runQuery('SELECT * FROM employees WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: '员工工号不存在' });
    }
    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    console.error('获取员工信息失败:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

// 全厂花名册属于管理数据，员工端只用 /by-name/:name，这里需要登录
router.get('/', auth.requireAuth, async (req, res) => {
  const db = req.app.locals.db;

  try {
    const employees = await db.runQuery('SELECT * FROM employees ORDER BY id');
    res.json({ ok: true, data: employees });
  } catch (err) {
    console.error('获取员工列表失败:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

module.exports = router;
