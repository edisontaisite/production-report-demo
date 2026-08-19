Page({
  data: {
    url: 'https://production-report-demo-jswx.onrender.com/admin.html'
  },

  copyUrl() {
    wx.setClipboardData({
      data: this.data.url,
      success: () => wx.showToast({ title: '网址已复制', icon: 'success' })
    });
  }
});
