const express = require('express');
const router = express.Router();

router.post('/', async (req, res) => {
  const db = req.app.locals.db;
  const { emp_id, report_date, items } = req.body;
  
  if (!emp_id) return res.status(400).json({ ok: false, error: '员工编号不能为空' });
  if (!report_date) return res.status(400).json({ ok: false, error: '上报日期不能为空' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(report_date)) return res.status(400).json({ ok: false, error: '上报日期格式不正确' });
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: '至少需要一条产量明细' });
  }
  
  try {
    const result = await db.runTransaction(async ({ run, all }) => {
      const employees = await all('SELECT * FROM employees WHERE id = ?', [emp_id]);
      if (employees.length === 0) {
        throw new Error('员工编号不存在');
      }
      
      // 同一订单+工序分行输入时按合计校验（避免各行独立通过、合计溢出）
      const aggMap = new Map();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const n = i + 1;
        
        if (!item.order_no) throw new Error(`第${n}行：订单号不能为空`);
        if (!item.proc_code) throw new Error(`第${n}行：工序代码不能为空`);
        const qty = Number(item.qty);
        if (!(qty > 0)) throw new Error(`第${n}行：产量必须大于0`);
        
        const rqty = item.rqty !== undefined && item.rqty !== null && item.rqty !== ''
          ? Number(item.rqty) : 0;
        if (isNaN(rqty) || rqty < 0) throw new Error(`第${n}行：返工数不合法`);
        
        const key = item.order_no + '|' + item.proc_code;
        if (!aggMap.has(key)) {
          aggMap.set(key, { order_no: item.order_no, proc_code: item.proc_code, qty: 0, rqty: 0 });
        }
        const agg = aggMap.get(key);
        agg.qty += qty;
        agg.rqty += rqty;
      }
      
      // 逐项校验并生成明细
      let subtotal = 0;
      const resolvedItems = [];
      for (const agg of aggMap.values()) {
        if (agg.rqty > agg.qty) {
          throw new Error(`工序 ${agg.proc_code}：返工数合计 ${agg.rqty} 超过产量合计 ${agg.qty}`);
        }
        
        const processes = await all(
          'SELECT * FROM processes WHERE order_no = ? AND proc_code = ?',
          [agg.order_no, agg.proc_code]
        );
        if (processes.length === 0) {
          throw new Error(`订单号 ${agg.order_no} / 工序代码 ${agg.proc_code} 不匹配`);
        }
        
        const process = processes[0];
        if (agg.qty > process.remaining) {
          throw new Error(`工序 ${agg.proc_code}：合计产量 ${agg.qty} 超过剩余产量 ${process.remaining}`);
        }
        
        const amount = Math.round(process.unit_price * agg.qty * 100) / 100;
        subtotal += amount;
        
        resolvedItems.push({
          order_no: agg.order_no,
          proc_code: agg.proc_code,
          proc_name: process.proc_name,
          qty: agg.qty,
          rqty: agg.rqty,
          unit_price: process.unit_price,
          amount: amount,
          new_remaining: Math.round((process.remaining - agg.qty) * 100) / 100
        });
      }
      
      subtotal = Math.round(subtotal * 100) / 100;
      
      const reportRes = await run(
        'INSERT INTO reports (emp_id, report_date, subtotal) VALUES (?, ?, ?)',
        [emp_id, report_date, subtotal]
      );
      const reportId = reportRes.lastID;
      
      for (const item of resolvedItems) {
        await run(
          'INSERT INTO report_items (report_id, order_no, proc_code, proc_name, qty, rqty, unit_price, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [reportId, item.order_no, item.proc_code, item.proc_name, item.qty, item.rqty, item.unit_price, item.amount]
        );
      }
      
      for (const item of resolvedItems) {
        await run(
          'UPDATE processes SET remaining = ? WHERE order_no = ? AND proc_code = ?',
          [item.new_remaining, item.order_no, item.proc_code]
        );
      }
      
      return { reportId, subtotal, resolvedItems };
    });
    
    console.log(`员工 ${emp_id} 提交上报 #${result.reportId}，工价合计 ¥${result.subtotal}`);
    res.json({ 
      ok: true, 
      report_id: result.reportId, 
      subtotal: result.subtotal,
      items: result.resolvedItems.map(({ new_remaining, ...rest }) => rest)
    });
  } catch (err) {
    console.error('提交上报失败:', err);
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/history/:empId', async (req, res) => {
  const db = req.app.locals.db;
  const { empId } = req.params;
  const { limit = 20, offset = 0 } = req.query;
  
  try {
    const reports = await db.runQuery(`
      SELECT r.*, e.name as emp_name
      FROM reports r
      LEFT JOIN employees e ON r.emp_id = e.id
      WHERE r.emp_id = ?
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `, [empId, parseInt(limit), parseInt(offset)]);
    
    const reportsWithItems = await Promise.all(reports.map(async (report) => {
      const items = await db.runQuery('SELECT * FROM report_items WHERE report_id = ?', [report.id]);
      return { ...report, items };
    }));
    
    res.json({ ok: true, data: reportsWithItems });
  } catch (err) {
    console.error('获取上报历史失败:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

router.get('/:id', async (req, res) => {
  const db = req.app.locals.db;
  const { id } = req.params;
  
  try {
    const rows = await db.runQuery(`
      SELECT r.*, e.name as emp_name, e.factory, e.grp
      FROM reports r
      LEFT JOIN employees e ON r.emp_id = e.id
      WHERE r.id = ?
    `, [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: '上报记录不存在' });
    }
    
    const items = await db.runQuery('SELECT * FROM report_items WHERE report_id = ?', [id]);
    
    res.json({ ok: true, data: { ...rows[0], items } });
  } catch (err) {
    console.error('获取上报详情失败:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

module.exports = router;
