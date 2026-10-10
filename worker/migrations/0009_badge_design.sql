-- 好朋友徽章 DIY：严格校验后的设计 JSON（白名单键 + 枚举 + #rrggbb，见 src/badge-design.ts）。
-- NULL = 旧徽章，按 style（pearlescent / brushed-metal）显示对应预设。读库时会再校验一次。
ALTER TABLE badges ADD COLUMN design TEXT;
