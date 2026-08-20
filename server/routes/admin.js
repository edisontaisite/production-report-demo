const express = require('express');
const router = express.Router();
const auth = require('../auth');

// 登录守卫：除 login / logout / session 外，/api/admin/* 全部需要登录
router.use(auth.requireAuth);

router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!auth.checkPassword(password)) {
    return res.status(401).json({ ok: false, error: '口令不正确' });
  }
  auth.setSessionCookie(res, auth.issueToken());
  res.json({ ok: true, message: '登录成功' });
});

router.post('/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true, message: '已退出' });
});

router.get('/session', (req, res) => {
  res.json({ ok: true, authed: auth.isAuthed(req) });
});

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
  const { start_date, end_date, today } = req.query;
  
  try {
    let where = [];
    let params = [];
    
    if (start_date) { where.push('report_date >= ?'); params.push(start_date); }
    if (end_date) { where.push('report_date <= ?'); params.push(end_date); }
    
    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
    
    // 今日统计用客户端传来的本地日期（服务器时区可能与用户不同）
    const todayCond = today && /^\d{4}-\d{2}-\d{2}$/.test(today)
      ? { where: 'report_date = ?', params: [today] }
      : { where: "report_date = date('now')", params: [] };
    
    const totalResult = await db.runQuery(`SELECT COALESCE(SUM(subtotal), 0) as total FROM reports ${whereClause}`, params);
    const todayResult = await db.runQuery(`SELECT COUNT(*) as count FROM reports WHERE ${todayCond.where}`, todayCond.params);
    const todayAmountResult = await db.runQuery(`SELECT COALESCE(SUM(subtotal), 0) as total FROM reports WHERE ${todayCond.where}`, todayCond.params);
    
    const byOrder = await db.runQuery(`
      SELECT ri.order_no, o.product, SUM(ri.qty) as total_qty, SUM(ri.amount) as total_amount, COUNT(DISTINCT ri.report_id) as report_count
      FROM report_items ri
      LEFT JOIN orders o ON ri.order_no = o.order_no
      LEFT JOIN reports r ON ri.report_id = r.id
      ${whereClause ? whereClause.replace(/\breport_date\b/g, 'r.report_date') : ''}
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
      SELECT r.report_date, e.id as emp_id, e.name as emp_name, e.factory, e.grp, ri.order_no, ri.proc_code, ri.proc_name, ri.qty, ri.rqty, ri.unit_price, ri.amount, r.subtotal
      FROM reports r
      LEFT JOIN employees e ON r.emp_id = e.id
      LEFT JOIN report_items ri ON r.id = ri.report_id
      ${whereClause}
      ORDER BY r.report_date DESC, e.id
    `, params);
    
    const headers = ['日期', '工号', '姓名', '工厂', '组别', '订单号', '工序代码', '工序', '产量', '返工数', '单价', '金额', '小计'];
    const csvCell = v => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = reports.map(r => [
      r.report_date, r.emp_id, r.emp_name, r.factory, r.grp,
      r.order_no, r.proc_code, r.proc_name, r.qty, r.rqty, r.unit_price, r.amount, r.subtotal
    ]);
    
    const csv = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
    
    // HTTP 头只允许 ASCII，中文文件名必须按 RFC 5987 编码；
    // 同时保留一个纯 ASCII 的 filename 作为老浏览器兜底。
    const fileName = `产量报表_${start_date || '全量'}_${end_date || '至今'}.csv`;
    const asciiName = `report_${start_date || 'all'}_${end_date || 'now'}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );
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
  let { id, name, factory, grp } = req.body;
  
  if (!name || !factory || !grp) {
    return res.status(400).json({ ok: false, error: '姓名、工厂、组别都不能为空' });
  }
  
  try {
    // 未填工号时自动生成：取最大数字工号 + 1
    if (!id) {
      const rows = await db.runQuery(
        "SELECT id FROM employees WHERE id GLOB '[0-9]*' ORDER BY CAST(id AS INTEGER) DESC LIMIT 1"
      );
      const maxId = rows.length ? parseInt(rows[0].id, 10) : 1000;
      id = String(maxId + 1);
    }
    
    await db.runInsert('INSERT INTO employees (id, name, factory, grp) VALUES (?, ?, ?, ?)', [id, name, factory, grp]);
    res.json({ ok: true, id, message: '员工添加成功' });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      res.status(400).json({ ok: false, error: '工号已存在' });
    } else {
      console.error('添加员工失败:', err);
      res.status(500).json({ ok: false, error: '服务器错误' });
    }
  }
});

// 更新员工（姓名/工厂/组别，工号不可改）
router.put('/employees/:id', async (req, res) => {
  const db = req.app.locals.db;
  const { id } = req.params;
  const { name, factory, grp } = req.body;
  
  if (!name || !factory || !grp) {
    return res.status(400).json({ ok: false, error: '所有字段都不能为空' });
  }
  
  try {
    const rows = await db.runQuery('SELECT * FROM employees WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: '员工工号不存在' });
    }
    
    await db.runInsert('UPDATE employees SET name = ?, factory = ?, grp = ? WHERE id = ?', [name, factory, grp, id]);
    res.json({ ok: true, message: '员工信息已更新' });
  } catch (err) {
    console.error('更新员工失败:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

// 删除员工（有上报记录的员工不允许删除）
router.delete('/employees/:id', async (req, res) => {
  const db = req.app.locals.db;
  const { id } = req.params;
  
  try {
    const rows = await db.runQuery('SELECT * FROM employees WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: '员工工号不存在' });
    }
    
    const reportCount = await db.runQuery('SELECT COUNT(*) as c FROM reports WHERE emp_id = ?', [id]);
    if (reportCount[0].c > 0) {
      return res.status(400).json({ ok: false, error: `该员工已有 ${reportCount[0].c} 条上报记录，无法删除` });
    }
    
    await db.runInsert('DELETE FROM employees WHERE id = ?', [id]);
    res.json({ ok: true, message: '员工已删除' });
  } catch (err) {
    console.error('删除员工失败:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
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
    return res.status(400).json({ ok: false, error: '订单号和工序列表不能为空' });
  }
  
  try {
    await db.runTransaction(async ({ run }) => {
      await run('INSERT INTO orders (order_no, style_no, product) VALUES (?, ?, ?)',
        [order_no, style_no || '', product || '']);
      
      for (const p of processes) {
        await run(
          'INSERT INTO processes (order_no, proc_code, proc_name, mnemonic, unit_price, remaining) VALUES (?, ?, ?, ?, ?, ?)',
          [order_no, p.proc_code, p.proc_name, p.mnemonic || '', p.unit_price || 0, p.remaining || 0]
        );
      }
    });
    
    res.json({ ok: true, message: '订单添加成功' });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      res.status(400).json({ ok: false, error: '订单号已存在' });
    } else {
      console.error('添加订单失败:', err);
      res.status(500).json({ ok: false, error: '服务器错误' });
    }
  }
});

// 组别目标配置
router.get('/group-targets', async (req, res) => {
  const db = req.app.locals.db;
  try {
    const rows = await db.runQuery('SELECT * FROM group_targets ORDER BY grp');
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('获取组别目标失败:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

router.post('/group-targets', async (req, res) => {
  const db = req.app.locals.db;
  const { grp, target_per_person, std_dct } = req.body;
  if (!grp) return res.status(400).json({ ok: false, error: '组别不能为空' });
  const tpp = parseFloat(target_per_person);
  const sd = parseFloat(std_dct);
  if (isNaN(tpp) || tpp < 0) return res.status(400).json({ ok: false, error: '目标人均产量不合法' });
  if (isNaN(sd) || sd <= 0) return res.status(400).json({ ok: false, error: '标准 DCT 不合法' });
  try {
    await db.runInsert(
      'INSERT OR REPLACE INTO group_targets (grp, target_per_person, std_dct) VALUES (?, ?, ?)',
      [grp, tpp, sd]
    );
    res.json({ ok: true, message: '组别目标已保存' });
  } catch (err) {
    console.error('保存组别目标失败:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

router.delete('/group-targets/:grp', async (req, res) => {
  const db = req.app.locals.db;
  try {
    await db.runInsert('DELETE FROM group_targets WHERE grp = ?', [req.params.grp]);
    res.json({ ok: true, message: '已删除' });
  } catch (err) {
    console.error('删除组别目标失败:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

// 保存组别某天的上班人数（效率分母）；留空则删除、回退组内在册人数
router.post('/group-headcount', async (req, res) => {
  const db = req.app.locals.db;
  const { grp, date, headcount } = req.body;
  
  if (!grp) return res.status(400).json({ ok: false, error: '组别不能为空' });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: '日期格式不正确' });
  
  try {
    if (headcount === null || headcount === '' || headcount === undefined) {
      await db.runInsert('DELETE FROM group_headcount WHERE grp = ? AND date = ?', [grp, date]);
      res.json({ ok: true, message: '已恢复默认人数（组内在册人数）' });
      return;
    }
    
    const n = Number(headcount);
    if (!Number.isInteger(n) || n <= 0) {
      return res.status(400).json({ ok: false, error: '人数必须是大于 0 的整数' });
    }
    
    await db.runInsert(
      'INSERT OR REPLACE INTO group_headcount (grp, date, headcount) VALUES (?, ?, ?)',
      [grp, date, n]
    );
    res.json({ ok: true, message: '当天上班人数已保存' });
  } catch (err) {
    console.error('保存组别上班人数失败:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

// 组别日报：人数 / 产量 / 效率 / DCT / FPY
router.get('/group-report', async (req, res) => {
  const db = req.app.locals.db;
  const date = req.query.date;
  if (!date) return res.status(400).json({ ok: false, error: '日期不能为空' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: '日期格式不正确' });
  
  try {
    const employees = await db.runQuery('SELECT id, name, grp FROM employees ORDER BY grp, id');
    const targets = await db.runQuery('SELECT * FROM group_targets');
    const tMap = {};
    for (const t of targets) tMap[t.grp] = t;
    
    // 当天手动配置的上班人数（效率分母，留空则用组内在册人数）
    const headcountRows = await db.runQuery('SELECT grp, headcount FROM group_headcount WHERE date = ?', [date]);
    const hMap = {};
    for (const h of headcountRows) hMap[h.grp] = h.headcount;
    
    // 各组当天上报明细
    const items = await db.runQuery(`
      SELECT e.grp, e.id as emp_id, SUM(ri.qty) as qty, SUM(ri.rqty) as rqty
      FROM reports r
      JOIN employees e ON r.emp_id = e.id
      JOIN report_items ri ON ri.report_id = r.id
      WHERE r.report_date = ?
      GROUP BY e.grp, e.id
    `, [date]);
    
    // 组 → 员工数 / 产量
    const grpMap = {};   // grp -> { empIds:Set, qty, rqty }
    const empGrp = {};   // emp_id -> grp
    for (const e of employees) empGrp[e.id] = e.grp;
    
    const reportEmpIds = [];
    for (const it of items) {
      if (!grpMap[it.grp]) grpMap[it.grp] = { empIds: new Set(), qty: 0, rqty: 0 };
      grpMap[it.grp].empIds.add(it.emp_id);
      grpMap[it.grp].qty += it.qty || 0;
      grpMap[it.grp].rqty += it.rqty || 0;
      reportEmpIds.push(it.emp_id);
    }
    
    // 按组汇总
    const grps = {};
    for (const e of employees) {
      if (!grps[e.grp]) grps[e.grp] = { total: 0 };
      grps[e.grp].total += 1;
    }
    
    const rows = [];
    for (const grp of Object.keys(grps)) {
      const g = grpMap[grp] || { empIds: new Set(), qty: 0, rqty: 0 };
      const defaultHeadcount = grps[grp].total;
      const manual = hMap[grp] != null ? Number(hMap[grp]) : 0;
      const headcount = manual > 0 ? manual : defaultHeadcount;
      const qty = Math.round(g.qty * 100) / 100;
      const rqty = Math.round(g.rqty * 100) / 100;
      const target = tMap[grp];
      
      let eff = null, dct = null, fpy = null;
      if (target && target.target_per_person > 0 && qty > 0) {
        eff = Math.round((qty / headcount) / target.target_per_person * 1000) / 10;
      }
      if (eff !== null && eff > 0 && target && target.std_dct > 0) {
        dct = Math.round((target.std_dct * 100 / eff) * 100) / 100;
      }
      if (qty > 0) {
        fpy = Math.round((qty - rqty) / qty * 1000) / 10;
      }
      
      rows.push({
        grp,
        headcount,
        default_headcount: defaultHeadcount,
        manual_headcount: manual > 0 ? manual : null,
        qty,
        efficiency: eff,
        dct,
        fpy,
        has_target: !!target
      });
    }
    rows.sort((a, b) => (a.grp < b.grp ? -1 : 1));
    
    res.json({ ok: true, date, data: rows });
  } catch (err) {
    console.error('获取组别日报失败:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

module.exports = router;
