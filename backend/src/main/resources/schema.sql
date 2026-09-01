CREATE TABLE IF NOT EXISTS `user` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `username` VARCHAR(64) NOT NULL UNIQUE,
    `password` VARCHAR(128) NOT NULL,
    `nickname` VARCHAR(64),
    `avatar` VARCHAR(256),
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `video` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `title` VARCHAR(256) NOT NULL,
    `file_name` VARCHAR(512) NOT NULL,
    `file_path` VARCHAR(1024) NOT NULL,
    `thumb_path` VARCHAR(1024),
    `type` VARCHAR(16) DEFAULT 'video',
    `category` VARCHAR(256),
    `duration` VARCHAR(32),
    `file_size` BIGINT DEFAULT 0,
    `width` INT DEFAULT 0,
    `height` INT DEFAULT 0,
    `hashtag` VARCHAR(1024),
    `pending_hashtag` VARCHAR(1024),
    `source` VARCHAR(32) DEFAULT 'import',
    `like_count` INT DEFAULT 0,
    `view_count` INT DEFAULT 0,
    `comment_count` INT DEFAULT 0,
    `hidden` TINYINT DEFAULT 0,
    `nsfw` TINYINT DEFAULT 0,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `media_folder` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(256) NOT NULL,
    `path` VARCHAR(1024) NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `video_like` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `video_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `uk_video_user` UNIQUE (`video_id`, `user_id`)
);

CREATE TABLE IF NOT EXISTS `comment` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `video_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `content` VARCHAR(2000) NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `danmaku` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `video_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `content` VARCHAR(500) NOT NULL,
    `time_point` FLOAT NOT NULL DEFAULT 0,
    `color` VARCHAR(16) DEFAULT '#ffffff',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_video_title ON `video`(`title`);
CREATE INDEX IF NOT EXISTS idx_video_hashtag ON `video`(`hashtag`);
CREATE INDEX IF NOT EXISTS idx_video_type ON `video`(`type`);
CREATE INDEX IF NOT EXISTS idx_video_category ON `video`(`category`);
CREATE INDEX IF NOT EXISTS idx_like_video ON `video_like`(`video_id`);
CREATE INDEX IF NOT EXISTS idx_like_user ON `video_like`(`user_id`);
CREATE INDEX IF NOT EXISTS idx_comment_video ON `comment`(`video_id`);
CREATE INDEX IF NOT EXISTS idx_comment_user ON `comment`(`user_id`);

CREATE TABLE IF NOT EXISTS `tag` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(255) NOT NULL UNIQUE,
    `cover_video_id` BIGINT,
    `cover_image_path` VARCHAR(1024),
    `description` VARCHAR(2000),
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tag_name ON `tag`(`name`);

-- 为已有表补充 hidden 字段
ALTER TABLE `video` ADD COLUMN IF NOT EXISTS `hidden` TINYINT DEFAULT 0;

-- 为 user 表补充 settings 字段
ALTER TABLE `user` ADD COLUMN IF NOT EXISTS `settings` TEXT;

-- 为 video 表补充 nsfw 字段
ALTER TABLE `video` ADD COLUMN IF NOT EXISTS `nsfw` TINYINT DEFAULT 0;

-- 为 video 表补充 nsfw_type 字段
ALTER TABLE `video` ADD COLUMN IF NOT EXISTS `nsfw_type` VARCHAR(32);

-- Default admin user (password: admin123)
MERGE INTO `user`(`username`, `password`, `nickname`) KEY(`username`)
VALUES ('admin', 'admin123', '管理员');
