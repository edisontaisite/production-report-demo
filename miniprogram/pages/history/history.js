const api = require('../../utils/api');
const util = require('../../utils/util');

Page({
  data: {
    empId: '',
    list: [],
    loading: false
  },

  onLoad() {
    this.setData({ empId: wx.getStorageSync('emp_id') || '' });
  },

  onShow() {
    if (this.data.empId.trim()) this.load();
  },

  onEmpInput(e) {
    this.setData({ empId: e.detail.value });
  },

  load() {
    const empId = this.data.empId.trim();
    if (!empId) return wx.showToast({ title: '请输入工号', icon: 'none' });
    if (this.data.loading) return;

    wx.setStorageSync('emp_id', empId);
    this.setData({ loading: true });

    api.get('/reports/history/' + encodeURIComponent(empId) + '?limit=20')
      .then((data) => {
        const list = data.map((r) => ({
          ...r,
          subtotalText: util.money(r.subtotal),
          itemsText: r.items.map((i) => i.order_no + ' ' + i.proc_name + ' ×' + i.qty).join('；')
        }));
        this.setData({ list });
      })
      .catch((err) => {
        wx.showToast({ title: err.message, icon: 'none' });
        this.setData({ list: [] });
      })
      .then(() => this.setData({ loading: false }));
  }
});
