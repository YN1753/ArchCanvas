import type { DatabaseDialect } from '../types/dsl'

export const MYSQL_SAMPLE_SQL = `-- 示例：电商交易系统标准表结构 (MySQL)
CREATE TABLE \`users\` (
  \`id\` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '用户唯一主键',
  \`username\` varchar(64) NOT NULL COMMENT '登录名',
  \`email\` varchar(128) NOT NULL COMMENT '电子邮箱',
  \`status\` tinyint(4) NOT NULL DEFAULT '1' COMMENT '状态:1-正常,0-封禁',
  \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '注册时间',
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_username\` (\`username\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户基础表';

CREATE TABLE \`products\` (
  \`id\` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '商品主键',
  \`title\` varchar(128) NOT NULL COMMENT '商品标题',
  \`price\` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '售价',
  \`stock\` int(11) NOT NULL DEFAULT '0' COMMENT '库存数量',
  \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商品信息表';

CREATE TABLE \`orders\` (
  \`id\` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '订单主键',
  \`user_id\` bigint(20) unsigned NOT NULL COMMENT '下单用户ID',
  \`order_sn\` varchar(64) NOT NULL COMMENT '订单编号',
  \`total_amount\` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '订单总金额',
  \`status\` varchar(32) NOT NULL DEFAULT 'pending' COMMENT '订单状态',
  \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '下单时间',
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_order_sn\` (\`order_sn\`),
  CONSTRAINT \`fk_orders_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单主表';

CREATE TABLE \`order_items\` (
  \`id\` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '明细主键',
  \`order_id\` bigint(20) unsigned NOT NULL COMMENT '关联订单ID',
  \`product_id\` bigint(20) unsigned NOT NULL COMMENT '关联商品ID',
  \`price\` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '购买单价',
  \`quantity\` int(11) NOT NULL DEFAULT '1' COMMENT '购买数量',
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单商品明细表';
`

export const POSTGRES_SAMPLE_SQL = `-- 示例：电商交易系统标准表结构 (PostgreSQL)
CREATE TABLE "users" (
  "id" BIGSERIAL PRIMARY KEY,
  "username" VARCHAR(64) NOT NULL UNIQUE,
  "email" VARCHAR(128) NOT NULL,
  "status" SMALLINT NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE "users" IS '用户基础表';
COMMENT ON COLUMN "users"."id" IS '用户唯一主键';
COMMENT ON COLUMN "users"."username" IS '登录名';
COMMENT ON COLUMN "users"."email" IS '电子邮箱';

CREATE TABLE "orders" (
  "id" BIGSERIAL PRIMARY KEY,
  "user_id" BIGINT NOT NULL REFERENCES "users" ("id"),
  "order_sn" VARCHAR(64) NOT NULL UNIQUE,
  "total_amount" NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE "orders" IS '订单主表';
`

export const SQLITE_SAMPLE_SQL = `-- 示例：电商交易系统标准表结构 (SQLite)
-- 表说明: 用户基础表
CREATE TABLE IF NOT EXISTS "users" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT, -- 用户唯一主键
  "username" TEXT NOT NULL UNIQUE, -- 登录名
  "email" TEXT NOT NULL, -- 电子邮箱
  "status" INTEGER NOT NULL DEFAULT 1, -- 状态:1-正常,0-封禁
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP -- 注册时间
);

-- 表说明: 订单主表
CREATE TABLE IF NOT EXISTS "orders" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT, -- 订单主键
  "user_id" INTEGER NOT NULL REFERENCES "users" ("id"), -- 下单用户ID
  "order_sn" TEXT NOT NULL UNIQUE, -- 订单编号
  "total_amount" REAL NOT NULL DEFAULT 0.00, -- 订单总金额
  "status" TEXT NOT NULL DEFAULT 'pending' -- 订单状态
);
`

export const SAMPLE_SQL = MYSQL_SAMPLE_SQL

export const SAMPLE_SQL_BY_DIALECT: Record<DatabaseDialect, string> = {
  mysql: MYSQL_SAMPLE_SQL,
  postgres: POSTGRES_SAMPLE_SQL,
  sqlite: SQLITE_SAMPLE_SQL,
}
