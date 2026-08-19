/**
 * API 请求封装
 *
 * BASE_URL 说明：
 * - 生产：https://production-report-demo-jswx.onrender.com
 * - 本地调试：http://127.0.0.1:3000（开发者工具需勾选「不校验合法域名」）
 *
 * 上线前需在微信公众平台 → 开发管理 → 服务器域名
 * 将 request 合法域名配置为：https://production-report-demo-jswx.onrender.com
 */
const BASE_URL = 'https://production-report-demo-jswx.onrender.com';

function request(method, path, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + '/api' + path,
      method: method,
      data: data || {},
      header: { 'Content-Type': 'application/json' },
      success(res) {
        const body = res.data;
        if (res.statusCode >= 200 && res.statusCode < 300 && body && body.ok) {
          resolve(body);
        } else {
          reject(new Error((body && body.error) || '请求失败(' + res.statusCode + ')'));
        }
      },
      fail() {
        reject(new Error('网络错误，请检查网络后重试'));
      }
    });
  });
}

module.exports = {
  get: (path) => request('GET', path),
  post: (path, data) => request('POST', path, data)
};
