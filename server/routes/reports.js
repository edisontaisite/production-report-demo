const express = require('express');
const router = express.Router();

router.post('/', async (req, res) => {
  const db = req.app.locals.db;
  const { emp_id, report_date, items } = req.body;
  
  if (!emp_id) return res.status(400).json({ ok: false, error: '员工工号不能为空' });
  if (!report_date) return res.status(400).json({ ok: false, error: '上报日期不能为空' });
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: '至少需要一条产量明细' });
  }
  
  const employees = await db.runQuery('SELECT * FROM employees WHERE id = ?', [emp_id]);
  if (employees.length === 0) {
    return res.status(400).json({ ok: false, error: '员工工号不存在' });
  }
  
  const database = db.db();
  database.serialize(() => {
    database.run('BEGIN TRANSACTION');
    
    let subtotal = 0;
    const resolvedItems = [];
    
    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const n = i + 1;
        
        if (!item.order_no) throw new Error(`第${n}行：制单号不能为空`);
        if (!item.proc_code) throw new Error(`第${n}行：工序代码不能为空`);
        if (!item.qty || item.qty <= 0) throw new Error(`第${n}行：产量必须大于0`);
        
        const processes = db.runQuery(
          'SELECT * FROM processes WHERE order_no = ? AND proc_code = ?',
          [item.order_no, item.proc_code]
        );
        
        const procRows = database.prepare('SELECT * FROM processes WHERE order_no = ? AND proc_code = ?');
        procRows.bind([item.order_no, item.proc_code]);
        
        let process = null;
        if (procRows.step()) {
          process = procRows.getAsObject();
        }
        procRows.free();
        
        if (!process) throw new Error(`第${n}行：制单号/工序代码不匹配`);
        if (item.qty > process.remaining) {
          throw new Error(`第${n}行：产量 ${item.qty} 超过剩余产量 ${process.remaining}`);
        }
        
        const amount = Math.round(process.unit_price * item.qty * 100) / 100;
        subtotal += amount;
        
        resolvedItems.push({
          order_no: item.order_no,
          proc_code: item.proc_code,
          proc_name: process.proc_name,
          qty: item.qty,
          unit_price: process.unit_price,
          amount: amount,
          new_remaining: process.remaining - item.qty
        });
      }
      
      subtotal = Math.round(subtotal * 100) / 100;
      
      const insertReport = database.prepare('INSERT INTO reports (emp_id, report_date, subtotal) VALUES (?, ?, ?)');
      insertReport.bind([emp_id, report_date, subtotal]);
      insertReport.step();
      const report_id = database.getRowsModified();
      insertReport.free();
      
      const lastId = database.prepare('SELECT last_insert_rowid() as id');
      lastId.step();
      const { id: realReportId } = lastId.getAsObject();
      lastId.free();
      
      const insertItem = database.prepare('INSERT INTO report_items (report_id, order_no, proc_code, proc_name, qty, unit_price, amount) VALUES (?, ?, ?, ?, ?, ?, ?)');
      
      for (const item of resolvedItems) {
        insertItem.bind([realReportId, item.order_no, item.proc_code, item.proc_name, item.qty, item.unit_price, item.amount]);
        insertItem.step();
        insertItem.reset();
      }
      insertItem.free();
      
      const updateProcess = database.prepare('UPDATE processes SET remaining = ? WHERE order_no = ? AND proc_code = ?');
      for (const item of resolvedItems) {
        updateProcess.bind([item.new_remaining, item.order_no, item.proc_code]);
        updateProcess.step();
        updateProcess.reset();
      }
      updateProcess.free();
      
      database.run('COMMIT');
      
      console.log(`员工 ${emp_id} 提交上报 #${realReportId}，工价合计 ¥${subtotal}`);
      res.json({ 
        ok: true, 
        report_id: realReportId, 
        subtotal: subtotal,
        items: resolvedItems
      });
    } catch (err) {
      database.run('ROLLBACK');
      console.error('提交上报失败:', err);
      res.status(400).json({ ok: false, error: err.message });
    }
  });
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
