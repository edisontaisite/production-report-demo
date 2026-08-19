const api = require('../../utils/api');
const util = require('../../utils/util');

Page({
  data: {
    empName: '',
    list: [],
    loading: false
  },

  onLoad() {
    this.setData({ empName: wx.getStorageSync('emp_name') || '' });
  },

  onShow() {
    if (this.data.empName.trim()) this.load();
  },

  onEmpInput(e) {
    this.setData({ empName: e.detail.value });
  },

  async load() {
    const name = this.data.empName.trim();
    if (!name) return wx.showToast({ title: '请输入姓名', icon: 'none' });
    if (this.data.loading) return;

    wx.setStorageSync('emp_name', name);
    this.setData({ loading: true });

    try {
      // 先按姓名查员工
      const empRes = await api.get('/employees/by-name/' + encodeURIComponent(name));
      const emps = empRes.data;
      if (emps.length === 0) {
        this.setData({ list: [], loading: false });
        return wx.showToast({ title: '未找到该员工', icon: 'none' });
      }
      if (emps.length > 1) {
        this.setData({ list: [], loading: false });
        return wx.showToast({ title: '有 ' + emps.length + ' 位同名员工，请联系管理员', icon: 'none' });
      }

      const res = await api.get('/reports/history/' + encodeURIComponent(emps[0].id) + '?limit=20');
      const list = res.data.map((r) => ({
        ...r,
        subtotalText: util.money(r.subtotal),
        itemsText: r.items.map((i) => i.order_no + ' ' + i.proc_name + ' ×' + i.qty).join('；')
      }));
      this.setData({ list, loading: false });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
      this.setData({ list: [], loading: false });
    }
  }
});
