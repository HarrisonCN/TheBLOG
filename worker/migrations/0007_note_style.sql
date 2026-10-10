-- 便签文字 DIY 样式：严格校验后的 JSON 对象（颜色 #rrggbb + 白名单枚举），NULL = 默认样式（旧便签）
ALTER TABLE sticky_notes ADD COLUMN style TEXT;
