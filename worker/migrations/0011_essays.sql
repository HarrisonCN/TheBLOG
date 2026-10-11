-- l14：影集（posts.kind = 'essay'）与拍摄手记。
-- essay：影集 JSON（版式 + 照片序列，规则见 src/essay-core.ts）；notes：文章级拍摄手记 JSON。
-- 两列都只存粗略地名，不存坐标；照片文件在上传时已去掉 EXIF / GPS。
ALTER TABLE posts ADD COLUMN kind TEXT NOT NULL DEFAULT 'post' CHECK (kind IN ('post', 'essay'));
ALTER TABLE posts ADD COLUMN essay TEXT;
ALTER TABLE posts ADD COLUMN notes TEXT;
