const api = require('../../utils/api');
const util = require('../../utils/util');

Page({
  data: {
    empName: '',
    empInfo: null,       // 当前确认的员工对象 {id,name,factory,grp}
    empError: '',
    empLoading: false,
    date: '',
    orders: [],           // [{order_no, product, label}]
    ordersLoading: false,
    ordersError: '',      // 订单列表加载失败提示
    rows: [],             // 明细行
    subtotalText: '0.00',
    saveAutofill: true,
    submitting: false
  },

  onLoad() {
    const empName = wx.getStorageSync('emp_name') || '';
    this.setData({ date: util.today(), empName });
    this.loadOrders();
    if (empName) this.loadEmployee(empName);
  },

  onShow() {
    // 上次订单列表没加载成功时，回页面自动重试
    if (!this.data.orders.length && !this.data.ordersLoading && !this.data.ordersError) {
      this.loadOrders();
    }
  },

  /* ---------- 数据加载 ---------- */
  loadOrders() {
    if (this.data.ordersLoading) return;
    this.setData({ ordersLoading: true, ordersError: '' });
    api.get('/orders').then((res) => {
      const orders = res.data.map((o) => ({
        ...o,
        label: o.order_no + (o.product ? '（' + o.product + '）' : '')
      }));
      this.setData({ orders, ordersLoading: false, ordersError: '' });
    }).catch((err) => {
      this.setData({
        ordersLoading: false,
        ordersError: err.message + '（服务器可能正在唤醒，请稍后重试）'
      });
    });
  },

  loadEmployee(name) {
    if (this.data.empLoading) return;
    this.setData({ empLoading: true, empError: '' });
    api.get('/employees/by-name/' + encodeURIComponent(name)).then((res) => {
      const list = res.data;
      if (list.length === 1) {
        wx.setStorageSync('emp_name', name);
        this.setData({ empInfo: list[0], empError: '', empLoading: false });
      } else if (list.length === 0) {
        this.setData({ empInfo: null, empError: '未找到该员工', empLoading: false });
      } else {
        this.setData({ empInfo: null, empError: '有 ' + list.length + ' 位同名员工，请联系管理员', empLoading: false });
      }
    }).catch((err) => {
      this.setData({ empInfo: null, empError: err.message, empLoading: false });
    });
  },

  /* ---------- 交互 ---------- */
  onEmpInput(e) {
    this.setData({ empName: e.detail.value });
  },

  onEmpBlur() {
    const name = this.data.empName.trim();
    if (!name) {
      this.setData({ empInfo: null, empError: '' });
      return;
    }
    this.loadEmployee(name);
  },

  onEmpConfirm() {
    this.onEmpBlur();
  },

  onDateChange(e) {
    this.setData({ date: e.detail.value });
  },

  addRow() {
    const row = {
      id: Date.now(),
      orderNo: '',
      orderIdx: -1,
      orderLabel: '',
      processes: [],
      procIdx: -1,
      procName: '',
      procLabel: '',
      unitPrice: 0,
      remaining: 0,
      qty: '',
      rqty: '',
      qtyErr: ''
    };
    this.setData({ rows: this.data.rows.concat([row]) });
  },

  removeRow(e) {
    const id = e.currentTarget.dataset.id;
    const rows = this.data.rows.filter((r) => r.id !== id);
    this.setData({ rows }, () => this.recalc());
  },

  onOrderChange(e) {
    const id = e.currentTarget.dataset.id;
    const orderIdx = Number(e.detail.value);
    const order = this.data.orders[orderIdx];
    if (!order) return;

    const patch = {
      orderNo: order.order_no,
      orderIdx,
      orderLabel: order.label,
      processes: [],
      procIdx: -1,
      procName: '',
      procLabel: '',
      unitPrice: 0,
      remaining: 0,
      qtyErr: ''
    };
    this.setData({ rows: this.updateRow(id, patch) }, () => this.recalc());

    api.get('/orders/' + encodeURIComponent(order.order_no) + '/processes').then((res) => {
      const processes = res.data.map((p) => ({
        ...p,
        label: p.proc_code + ' ' + p.proc_name
      }));
      this.setData({ rows: this.updateRow(id, { processes }) });
    }).catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
  },

  onProcChange(e) {
    const id = e.currentTarget.dataset.id;
    const row = this.data.rows.find((r) => r.id === id);
    const procIdx = Number(e.detail.value);
    const p = row && row.processes[procIdx];
    if (!p) return;

    this.setData({
      rows: this.updateRow(id, {
        procIdx,
        procName: p.proc_name,
        procLabel: p.label,
        unitPrice: p.unit_price,
        remaining: p.remaining,
        qtyErr: ''
      })
    }, () => {
      this.recalc();
      this.validateAll();
    });
  },

  // 幂等键：一次提交（含失败后重试）复用同一个 token，服务端据此去重；
  // 明细一改就作废，避免把「新的一笔」错认成重复提交。
  ensureToken() {
    if (!this.pendingToken) {
      this.pendingToken = 'r-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    }
    return this.pendingToken;
  },

  onQtyInput(e) {
    const id = e.currentTarget.dataset.id;
    this.pendingToken = null;
    this.setData({ rows: this.updateRow(id, { qty: e.detail.value }) }, () => {
      this.recalc();
      this.validateAll();
    });
  },

  onRqtyInput(e) {
    const id = e.currentTarget.dataset.id;
    this.pendingToken = null;
    this.setData({ rows: this.updateRow(id, { rqty: e.detail.value }) });
  },

  onSaveToggle(e) {
    this.setData({ saveAutofill: e.detail.value.indexOf('1') >= 0 });
  },

  /* ---------- 工具 ---------- */
  updateRow(id, patch) {
    return this.data.rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
  },

  validateQty(id) {
    const row = this.data.rows.find((r) => r.id === id);
    if (!row) return;
    const qty = parseFloat(row.qty);
    let qtyErr = '';
    if (row.procName && row.qty !== '' && (isNaN(qty) || qty <= 0)) {
      qtyErr = '产量必须大于 0';
    } else if (row.procName && !isNaN(qty) && qty > 0) {
      // 同一订单+工序分行输入时，按合计与剩余产量比较
      let total = 0;
      for (const r of this.data.rows) {
        if (r.procName && r.orderNo === row.orderNo && r.procIdx === row.procIdx) {
          const q = parseFloat(r.qty);
          if (!isNaN(q) && q > 0) total += q;
        }
      }
      if (total > row.remaining) {
        qtyErr = '合计 ' + total + ' 超过剩余产量 ' + row.remaining;
      }
    }
    this.setData({ rows: this.updateRow(id, { qtyErr }) });
  },

  // 重新校验所有行（合计校验互相影响）
  validateAll() {
    for (const r of this.data.rows) this.validateQty(r.id);
  },

  recalc() {
    let sum = 0;
    for (const r of this.data.rows) {
      const qty = parseFloat(r.qty);
      if (r.unitPrice && !isNaN(qty) && qty > 0) {
        sum += r.unitPrice * qty;
      }
    }
    this.setData({ subtotalText: util.money(sum) });
  },

  /* ---------- 提交 ---------- */
  async submit() {
    const { empName, empInfo, date, rows, saveAutofill, submitting } = this.data;
    if (submitting) return;
    if (!empName.trim()) return wx.showToast({ title: '请输入员工姓名', icon: 'none' });
    if (!empInfo) return wx.showToast({ title: '请先确认员工信息', icon: 'none' });
    // 姓名查询是异步的：改完名字直接点提交时 empInfo 可能还是上一个人，
    // 不比对就会把产量记到别人工号上
    if (empInfo.name !== empName.trim()) {
      return wx.showToast({ title: '姓名已改动，请等员工信息刷新后再提交', icon: 'none', duration: 2600 });
    }

    const items = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const n = i + 1;
      if (!r.orderNo || r.procIdx < 0) {
        return wx.showToast({ title: '第' + n + '行：请选择订单号和工序', icon: 'none' });
      }
      const qty = parseFloat(r.qty);
      if (isNaN(qty) || qty <= 0) {
        return wx.showToast({ title: '第' + n + '行：产量不合法', icon: 'none' });
      }
      if (qty > r.remaining) {
        return wx.showToast({ title: '第' + n + '行：超过剩余产量 ' + r.remaining, icon: 'none' });
      }
      const rqty = parseFloat(r.rqty);
      if (!isNaN(rqty) && rqty > qty) {
        return wx.showToast({ title: '第' + n + '行：返工数不能超过产量', icon: 'none' });
      }
      items.push({
        order_no: r.orderNo,
        proc_code: r.processes[r.procIdx].proc_code,
        qty: qty,
        rqty: isNaN(rqty) ? 0 : rqty
      });
    }
    if (!items.length) return wx.showToast({ title: '请至少添加一条产量明细', icon: 'none' });

    const empId = empInfo.id;
    this.setData({ submitting: true });
    try {
      const res = await api.post('/reports', {
        emp_id: empId, report_date: date, items, client_token: this.ensureToken()
      });
      this.pendingToken = null;   // 这一笔已入账，下次提交是新的一笔
      // icon:'success' 只能显示 7 个汉字，金额会被截掉，这里用 icon:'none'
      wx.showToast({
        title: res.duplicate
          ? '这一笔之前已交过，未重复记账'
          : '提交成功，工价 ¥' + util.money(res.subtotal),
        icon: 'none',
        duration: 2600
      });
      this.setData({ rows: [] }, () => {
        this.recalc();
        if (saveAutofill) this.applyLast(empId);
        else this.addRow();
      });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none', duration: 2600 });
    } finally {
      this.setData({ submitting: false });
    }
  },

  /* 提交后自动填充上次明细 */
  async applyLast(empId) {
    let data;
    try {
      const res = await api.get('/reports/history/' + encodeURIComponent(empId) + '?limit=1');
      data = res.data;
    } catch (e) {
      this.addRow();
      return;
    }
    if (!data || !data.length || !data[0].items || !data[0].items.length) {
      this.addRow();
      return;
    }

    const newRows = [];
    for (const it of data[0].items) {
      const orderIdx = this.data.orders.findIndex((o) => o.order_no === it.order_no);
      let processes = [];
      let procIdx = -1;
      if (orderIdx >= 0) {
        try {
          const res = await api.get('/orders/' + encodeURIComponent(it.order_no) + '/processes');
          processes = res.data.map((p) => ({ ...p, label: p.proc_code + ' ' + p.proc_name }));
          procIdx = processes.findIndex((p) => p.proc_code === it.proc_code);
        } catch (e) {}
      }
      newRows.push({
        id: Date.now() + newRows.length,
        orderNo: orderIdx >= 0 ? it.order_no : '',
        orderIdx,
        orderLabel: orderIdx >= 0 ? it.order_no + (this.data.orders[orderIdx].product ? '（' + this.data.orders[orderIdx].product + '）' : '') : '',
        processes,
        procIdx,
        procName: procIdx >= 0 ? processes[procIdx].proc_name : '',
        procLabel: procIdx >= 0 ? processes[procIdx].label : '',
        unitPrice: procIdx >= 0 ? processes[procIdx].unit_price : 0,
        remaining: procIdx >= 0 ? processes[procIdx].remaining : 0,
        // 只带回订单和工序，不回填产量数字 ——
        // 回填数字会让工人误触一次就变成一份重复工钱
        qty: '',
        rqty: '',
        qtyErr: ''
      });
    }
    this.setData({ rows: newRows }, () => this.recalc());
  }
});
