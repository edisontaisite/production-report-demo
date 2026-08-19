const express = require('express');
const router = express.Router();

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

router.get('/', async (req, res) => {
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
