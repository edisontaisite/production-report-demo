/** 今天日期 YYYY-MM-DD */
function today() {
  const d = new Date();
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** 金额格式化，保留两位 */
function money(n) {
  return (Math.round((n || 0) * 100) / 100).toFixed(2);
}

module.exports = { today, money };
