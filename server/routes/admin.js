const express = require('express');
const router = express.Router();

router.get('/reports', async (req, res) => {
  const db = req.app.locals.db;
  const { start_date, end_date, emp_id, order_no, limit = 50, offset = 0 } = req.query;
  
  try {
    let where = [];
    let params = [];
    
    if (start_date) { where.push('r.report_date >= ?'); params.push(start_date); }
    if (end_date) { where.push('r.report_date <= ?'); params.push(end_date); }
    if (emp_id) { where.push('r.emp_id = ?'); params.push(emp_id); }
    if (order_no) {
      where.push('EXISTS (SELECT 1 FROM report_items ri WHERE ri.report_id = r.id AND ri.order_no = ?)');
      params.push(order_no);
    }
    
    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
    
    const reports = await db.runQuery(`
      SELECT r.*, e.name as emp_name, e.factory, e.grp
      FROM reports r
      LEFT JOIN employees e ON r.emp_id = e.id
      ${whereClause}
      ORDER BY r.report_date DESC, r.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), parseInt(offset)]);
    
    const reportsWithItems = await Promise.all(reports.map(async (report) => {
      const items = await db.runQuery('SELECT * FROM report_items WHERE report_id = ?', [report.id]);
      return { ...report, items };
    }));
    
    const countResult = await db.runQuery(`SELECT COUNT(*) as total FROM reports r ${whereClause}`, params);
    
    res.json({ 
      ok: true, 
      data: reportsWithItems,
      total: countResult[0].total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    console.error('获取上报列表失败:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

router.get('/stats', async (req, res) => {
  const db = req.app.locals.db;
  const { start_date, end_date } = req.query;
  
  try {
    let where = [];
    let params = [];
    
    if (start_date) { where.push('report_date >= ?'); params.push(start_date); }
    if (end_date) { where.push('report_date <= ?'); params.push(end_date); }
    
    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
    
    const totalResult = await db.runQuery(`SELECT COALESCE(SUM(subtotal), 0) as total FROM reports ${whereClause}`, params);
    const todayResult = await db.runQuery(`SELECT COUNT(*) as count FROM reports WHERE report_date = date('now')`);
    const todayAmountResult = await db.runQuery(`SELECT COALESCE(SUM(subtotal), 0) as total FROM reports WHERE report_date = date('now')`);
    
    const byOrder = await db.runQuery(`
      SELECT ri.order_no, o.product, SUM(ri.qty) as total_qty, SUM(ri.amount) as total_amount, COUNT(DISTINCT ri.report_id) as report_count
      FROM report_items ri
      LEFT JOIN orders o ON ri.order_no = o.order_no
      LEFT JOIN reports r ON ri.report_id = r.id
      ${whereClause ? 'WHERE ' + whereClause.replace(/report_date/g, 'r.report_date') : ''}
      GROUP BY ri.order_no
      ORDER BY total_amount DESC
    `, params);
    
    const byEmployee = await db.runQuery(`
      SELECT r.emp_id, e.name, e.factory, e.grp, COUNT(*) as report_count, SUM(r.subtotal) as total_amount
      FROM reports r
      LEFT JOIN employees e ON r.emp_id = e.id
      ${whereClause}
      GROUP BY r.emp_id
      ORDER BY total_amount DESC
    `, params);
    
    res.json({ 
      ok: true, 
      data: {
        total_amount: totalResult[0].total,
        today_count: todayResult[0].count,
        today_amount: todayAmountResult[0].total,
        by_order: byOrder,
        by_employee: byEmployee
      }
    });
  } catch (err) {
    console.error('获取统计失败:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

router.get('/export', async (req, res) => {
  const db = req.app.locals.db;
  const { start_date, end_date } = req.query;
  
  try {
    let where = [];
    let params = [];
    
    if (start_date) { where.push('r.report_date >= ?'); params.push(start_date); }
    if (end_date) { where.push('r.report_date <= ?'); params.push(end_date); }
    
    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
    
    const reports = await db.runQuery(`
      SELECT r.report_date, e.id as emp_id, e.name as emp_name, e.factory, e.grp, ri.order_no, ri.proc_name, ri.qty, ri.unit_price, ri.amount, r.subtotal
      FROM reports r
      LEFT JOIN employees e ON r.emp_id = e.id
      LEFT JOIN report_items ri ON r.id = ri.report_id
      ${whereClause}
      ORDER BY r.report_date DESC, e.id
    `, params);
    
    const headers = ['日期', '工号', '姓名', '工厂', '组别', '制单号', '工序', '产量', '单价', '金额', '小计'];
    const rows = reports.map(r => [
      r.report_date, r.emp_id, r.emp_name, r.factory, r.grp,
      r.order_no, r.proc_name, r.qty, r.unit_price, r.amount, r.subtotal
    ]);
    
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="产量报表_${start_date || '全量'}_${end_date || '至今'}.csv"`);
    res.send('\ufeff' + csv);
  } catch (err) {
    console.error('导出失败:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

router.get('/employees', async (req, res) => {
  const db = req.app.locals.db;
  
  try {
    const employees = await db.runQuery('SELECT * FROM employees ORDER BY id');
    res.json({ ok: true, data: employees });
  } catch (err) {
    console.error('获取员工列表失败:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

router.post('/employees', async (req, res) => {
  const db = req.app.locals.db;
  const { id, name, factory, grp } = req.body;
  
  if (!id || !name || !factory || !grp) {
    return res.status(400).json({ ok: false, error: '所有字段都不能为空' });
  }
  
  try {
    await db.runInsert('INSERT INTO employees (id, name, factory, grp) VALUES (?, ?, ?, ?)', [id, name, factory, grp]);
    res.json({ ok: true, message: '员工添加成功' });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      res.status(400).json({ ok: false, error: '工号已存在' });
    } else {
      console.error('添加员工失败:', err);
      res.status(500).json({ ok: false, error: '服务器错误' });
    }
  }
});

router.get('/orders', async (req, res) => {
  const db = req.app.locals.db;
  
  try {
    const orders = await db.runQuery(`
      SELECT o.*, COUNT(p.id) as proc_count, SUM(p.remaining) as total_remaining
      FROM orders o
      LEFT JOIN processes p ON o.order_no = p.order_no
      GROUP BY o.order_no
    `);
    res.json({ ok: true, data: orders });
  } catch (err) {
    console.error('获取制单列表失败:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

router.post('/orders', async (req, res) => {
  const db = req.app.locals.db;
  const { order_no, style_no, product, processes } = req.body;
  
  if (!order_no || !processes || !Array.isArray(processes) || processes.length === 0) {
    return res.status(400).json({ ok: false, error: '制单号和工序列表不能为空' });
  }
  
  try {
    await db.runInsert('INSERT INTO orders (order_no, style_no, product) VALUES (?, ?, ?)', 
      [order_no, style_no || '', product || '']);
    
    for (const p of processes) {
      await db.runInsert(
        'INSERT INTO processes (order_no, proc_code, proc_name, mnemonic, unit_price, remaining) VALUES (?, ?, ?, ?, ?, ?)',
        [order_no, p.proc_code, p.proc_name, p.mnemonic || '', p.unit_price || 0, p.remaining || 0]
      );
    }
    
    res.json({ ok: true, message: '制单添加成功' });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      res.status(400).json({ ok: false, error: '制单号已存在' });
    } else {
      console.error('添加制单失败:', err);
      res.status(500).json({ ok: false, error: '服务器错误' });
    }
  }
});

module.exports = router;
