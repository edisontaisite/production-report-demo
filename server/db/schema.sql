-- 员工表
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,           -- 工号 (如 1001)
  name TEXT NOT NULL,            -- 姓名
  factory TEXT NOT NULL,         -- 工厂
  grp TEXT NOT NULL,             -- 组别
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 制单表 (订单)
CREATE TABLE IF NOT EXISTS orders (
  order_no TEXT PRIMARY KEY,     -- 制单号 (如 MO-20260801)
  style_no TEXT,                 -- 款号
  product TEXT,                 -- 产品名称
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 工序表
CREATE TABLE IF NOT EXISTS processes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL,       -- 关联制单号
  proc_code TEXT NOT NULL,      -- 工序代码
  proc_name TEXT NOT NULL,      -- 工序名称
  mnemonic TEXT,                -- 助记码
  unit_price REAL NOT NULL,     -- 单价
  remaining REAL NOT NULL DEFAULT 0,  -- 剩余产量
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_no) REFERENCES orders(order_no),
  UNIQUE(order_no, proc_code)
);

-- 产量上报主表
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_id TEXT NOT NULL,         -- 员工工号
  report_date DATE NOT NULL,    -- 上报日期
  subtotal REAL NOT NULL,       -- 工价小计
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (emp_id) REFERENCES employees(id)
);

-- 产量上报明细表
CREATE TABLE IF NOT EXISTS report_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,   -- 关联上报ID
  order_no TEXT NOT NULL,       -- 制单号
  proc_code TEXT NOT NULL,      -- 工序代码
  proc_name TEXT NOT NULL,      -- 工序名称
  qty REAL NOT NULL,            -- 产量
  rqty REAL NOT NULL DEFAULT 0, -- 返工数（用于计算 FPY）
  unit_price REAL NOT NULL,     -- 单价
  amount REAL NOT NULL,         -- 金额
  FOREIGN KEY (report_id) REFERENCES reports(id)
);

-- 组别目标表（用于计算效率 / DCT）
CREATE TABLE IF NOT EXISTS group_targets (
  grp TEXT PRIMARY KEY,                      -- 组别
  target_per_person REAL NOT NULL DEFAULT 0, -- 目标人均产量（件/人/天）
  std_dct REAL NOT NULL DEFAULT 0.4,         -- 标准 DCT（小时/件）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 组别当天上班人数表（效率分母，按日期手动配置）
CREATE TABLE IF NOT EXISTS group_headcount (
  grp TEXT NOT NULL,                         -- 组别
  date TEXT NOT NULL,                        -- 日期 (YYYY-MM-DD)
  headcount INTEGER NOT NULL,                -- 当天上班人数
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (grp, date)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_reports_emp ON reports(emp_id);
CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(report_date);
CREATE INDEX IF NOT EXISTS idx_report_items_report ON report_items(report_id);
CREATE INDEX IF NOT EXISTS idx_processes_order ON processes(order_no);
