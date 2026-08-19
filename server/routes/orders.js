const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  const db = req.app.locals.db;
  
  try {
    const orders = await db.runQuery(`
      SELECT o.*, COUNT(p.proc_code) as proc_count 
      FROM orders o 
      LEFT JOIN processes p ON o.order_no = p.order_no 
      GROUP BY o.order_no
      ORDER BY o.order_no DESC
    `);
    res.json({ ok: true, data: orders });
  } catch (err) {
    console.error('获取制单列表失败:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

router.get('/:orderNo/processes', async (req, res) => {
  const db = req.app.locals.db;
  const { orderNo } = req.params;
  
  try {
    const processes = await db.runQuery(
      'SELECT * FROM processes WHERE order_no = ? ORDER BY proc_code',
      [orderNo]
    );
    
    if (processes.length === 0) {
      return res.status(404).json({ ok: false, error: '订单不存在' });
    }
    
    res.json({ ok: true, data: processes });
  } catch (err) {
    console.error('获取工序列表失败:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

router.get('/:orderNo/processes/:procCode', async (req, res) => {
  const db = req.app.locals.db;
  const { orderNo, procCode } = req.params;
  
  try {
    const rows = await db.runQuery(
      'SELECT * FROM processes WHERE order_no = ? AND proc_code = ?',
      [orderNo, procCode]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: '工序不存在' });
    }
    
    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    console.error('获取工序信息失败:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

module.exports = router;
