const api = require('../../utils/api');
const util = require('../../utils/util');

Page({
  data: {
    empId: '',
    empInfo: null,
    empError: '',
    date: '',
    orders: [],           // [{order_no, product, label}]
    rows: [],             // 明细行
    subtotalText: '0.00',
    saveAutofill: true,
    submitting: false
  },

  onLoad() {
    const empId = wx.getStorageSync('emp_id') || '';
    this.setData({ date: util.today(), empId });
    this.loadOrders();
    if (empId) this.loadEmployee(empId);
  },

  /* ---------- 数据加载 ---------- */
  loadOrders() {
    api.get('/orders').then((data) => {
      const orders = data.map((o) => ({
        ...o,
        label: o.order_no + (o.product ? '（' + o.product + '）' : '')
      }));
      this.setData({ orders });
    }).catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
  },

  loadEmployee(id) {
    api.get('/employees/' + encodeURIComponent(id)).then((info) => {
      wx.setStorageSync('emp_id', id);
      this.setData({ empInfo: info, empError: '' });
    }).catch(() => {
      this.setData({ empInfo: null, empError: '未找到该工号' });
    });
  },

  /* ---------- 交互 ---------- */
  onEmpInput(e) {
    this.setData({ empId: e.detail.value });
  },

  onEmpBlur() {
    const id = this.data.empId.trim();
    if (!id) {
      this.setData({ empInfo: null, empError: '' });
      return;
    }
    this.loadEmployee(id);
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

    api.get('/orders/' + encodeURIComponent(order.order_no) + '/processes').then((data) => {
      const processes = data.map((p) => ({
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
      this.validateQty(id);
    });
  },

  onQtyInput(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ rows: this.updateRow(id, { qty: e.detail.value }) }, () => {
      this.recalc();
      this.validateQty(id);
    });
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
    } else if (row.procName && !isNaN(qty) && qty > row.remaining) {
      qtyErr = '超过剩余产量 ' + row.remaining;
    }
    this.setData({ rows: this.updateRow(id, { qtyErr }) });
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
    const { empId, empInfo, date, rows, saveAutofill, submitting } = this.data;
    if (submitting) return;
    if (!empId.trim()) return wx.showToast({ title: '请填写员工工号', icon: 'none' });
    if (!empInfo) return wx.showToast({ title: '员工工号无效', icon: 'none' });

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
      items.push({
        order_no: r.orderNo,
        proc_code: r.processes[r.procIdx].proc_code,
        qty: qty
      });
    }
    if (!items.length) return wx.showToast({ title: '请至少添加一条产量明细', icon: 'none' });

    this.setData({ submitting: true });
    try {
      const res = await api.post('/reports', { emp_id: empId.trim(), report_date: date, items });
      wx.showToast({ title: '提交成功，工价 ¥' + util.money(res.subtotal), icon: 'success', duration: 2000 });
      this.setData({ rows: [] }, () => {
        this.recalc();
        if (saveAutofill) this.applyLast(empId.trim());
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
      data = await api.get('/reports/history/' + encodeURIComponent(empId) + '?limit=1');
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
          const list = await api.get('/orders/' + encodeURIComponent(it.order_no) + '/processes');
          processes = list.map((p) => ({ ...p, label: p.proc_code + ' ' + p.proc_name }));
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
        qty: String(it.qty),
        qtyErr: ''
      });
    }
    this.setData({ rows: newRows }, () => this.recalc());
  }
});
