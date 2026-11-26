CREATE TABLE IF NOT EXISTS "account_user" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "password" varchar(128) NOT NULL, "last_login" datetime NULL, "is_superuser" bool NOT NULL, "username" varchar(150) NOT NULL UNIQUE, "email" varchar(254) NOT NULL, "is_staff" bool NOT NULL, "is_active" bool NOT NULL, "date_joined" datetime NOT NULL, "role" varchar(20) NOT NULL, "raw_password" varchar(20) NULL, "classname" varchar(50) NOT NULL);

CREATE TABLE IF NOT EXISTS "task_task" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "created" datetime NOT NULL, "modified" datetime NOT NULL, "title" varchar(100) NOT NULL, "content" text NOT NULL, "task_type" varchar(20) NOT NULL, "is_public" bool NOT NULL, "display" integer NOT NULL, "example_css" text NULL, "example_html" text NULL, "example_js" text NULL);
CREATE INDEX IF NOT EXISTS "task_task_display_97da6aab" ON "task_task" ("display");
CREATE UNIQUE INDEX IF NOT EXISTS "task_task_display_task_type_f648533c_uniq" ON "task_task" ("display", "task_type");
CREATE TABLE IF NOT EXISTS "task_tutorial" ("task_ptr_id" bigint NOT NULL PRIMARY KEY REFERENCES "task_task" ("id") DEFERRABLE INITIALLY DEFERRED);
CREATE TABLE IF NOT EXISTS "task_challenge" ("task_ptr_id" bigint NOT NULL PRIMARY KEY REFERENCES "task_task" ("id") DEFERRABLE INITIALLY DEFERRED, "score" integer NOT NULL, "pass_score" real NULL, "author_id" bigint NULL REFERENCES "account_user" ("id") DEFERRABLE INITIALLY DEFERRED);
CREATE INDEX IF NOT EXISTS "task_challenge_author_id_d4492927" ON "task_challenge" ("author_id");
CREATE TABLE IF NOT EXISTS "task_creation" ("task_ptr_id" bigint NOT NULL PRIMARY KEY REFERENCES "task_task" ("id") DEFERRABLE INITIALLY DEFERRED, "html" text NOT NULL, "css" text NOT NULL, "js" text NOT NULL, "owner_id" bigint NOT NULL REFERENCES "account_user" ("id") DEFERRABLE INITIALLY DEFERRED);
CREATE INDEX IF NOT EXISTS "task_creation_owner_id_6ae3c55d" ON "task_creation" ("owner_id");
CREATE TABLE IF NOT EXISTS "task_taskasset" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "name" varchar(100) NOT NULL, "file" varchar(100) NOT NULL, "task_id" bigint NOT NULL REFERENCES "task_task" ("id") DEFERRABLE INITIALLY DEFERRED);
CREATE UNIQUE INDEX IF NOT EXISTS "task_taskasset_task_id_name_dc8ea9a8_uniq" ON "task_taskasset" ("task_id", "name");
CREATE INDEX IF NOT EXISTS "task_taskasset_task_id_0921deb6" ON "task_taskasset" ("task_id");

CREATE TABLE IF NOT EXISTS "submission_submission" ("created" datetime NOT NULL, "modified" datetime NOT NULL, "id" char(32) NOT NULL PRIMARY KEY, "score" real NOT NULL, "html" text NULL, "css" text NULL, "js" text NULL, "task_id" bigint NOT NULL REFERENCES "task_task" ("id") DEFERRABLE INITIALLY DEFERRED, "user_id" bigint NOT NULL REFERENCES "account_user" ("id") DEFERRABLE INITIALLY DEFERRED, "flag" varchar(10) NULL, "raw_score" real NOT NULL, "zone" varchar(10) NULL, "view_count" integer unsigned NOT NULL CHECK ("view_count" >= 0));
CREATE INDEX IF NOT EXISTS "submission_submission_task_id_91e9556b" ON "submission_submission" ("task_id");
CREATE INDEX IF NOT EXISTS "submission_submission_user_id_71741691" ON "submission_submission" ("user_id");
CREATE INDEX IF NOT EXISTS "submission_submission_flag_d96bc4aa" ON "submission_submission" ("flag");
CREATE INDEX IF NOT EXISTS "submission_submission_zone_a1bbf0a2" ON "submission_submission" ("zone");
-- 非 Django 原有：除 html/css/js 外的常用列。user_id 等列在表里排在 html/css/js 后面，
-- 直接读表要先读完整段代码，所以列表、打分、统计等扫描都靠这个覆盖索引
CREATE INDEX IF NOT EXISTS "submission_submission_slim" ON "submission_submission" ("user_id", "task_id", "created", "score", "flag", "zone", "raw_score", "id");
CREATE TABLE IF NOT EXISTS "submission_rating" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "score" integer NOT NULL, "created" datetime NOT NULL, "submission_id" char(32) NOT NULL REFERENCES "submission_submission" ("id") DEFERRABLE INITIALLY DEFERRED, "user_id" bigint NOT NULL REFERENCES "account_user" ("id") DEFERRABLE INITIALLY DEFERRED);
CREATE UNIQUE INDEX IF NOT EXISTS "submission_rating_user_id_submission_id_29be4c39_uniq" ON "submission_rating" ("user_id", "submission_id");
CREATE INDEX IF NOT EXISTS "submission_rating_submission_id_a20dcece" ON "submission_rating" ("submission_id");
CREATE INDEX IF NOT EXISTS "submission_rating_user_id_cfd08017" ON "submission_rating" ("user_id");
CREATE TABLE IF NOT EXISTS "submission_award" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "created" datetime NOT NULL, "modified" datetime NOT NULL, "name" varchar(100) NOT NULL UNIQUE, "description" text NOT NULL, "sort_order" integer NOT NULL, "is_active" bool NOT NULL, "item_ordering" varchar(20) NOT NULL);
CREATE INDEX IF NOT EXISTS "submission_award_sort_order_280640ce" ON "submission_award" ("sort_order");
CREATE TABLE IF NOT EXISTS "submission_submissionaward" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "created" datetime NOT NULL, "modified" datetime NOT NULL, "sort_order" integer NOT NULL, "awarded_at" datetime NOT NULL, "award_id" bigint NOT NULL REFERENCES "submission_award" ("id") DEFERRABLE INITIALLY DEFERRED, "submission_id" char(32) NOT NULL REFERENCES "submission_submission" ("id") DEFERRABLE INITIALLY DEFERRED, "is_stale" bool NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "submission_submissionaward_submission_id_award_id_6fab326b_uniq" ON "submission_submissionaward" ("submission_id", "award_id");
CREATE INDEX IF NOT EXISTS "submission_submissionaward_sort_order_7d90e1d6" ON "submission_submissionaward" ("sort_order");
CREATE INDEX IF NOT EXISTS "submission_submissionaward_awarded_at_8093b2c7" ON "submission_submissionaward" ("awarded_at");
CREATE INDEX IF NOT EXISTS "submission_submissionaward_award_id_b229157e" ON "submission_submissionaward" ("award_id");
CREATE INDEX IF NOT EXISTS "submission_submissionaward_submission_id_209aabba" ON "submission_submissionaward" ("submission_id");

CREATE TABLE IF NOT EXISTS "prompt_conversation" ("created" datetime NOT NULL, "modified" datetime NOT NULL, "id" char(32) NOT NULL PRIMARY KEY, "is_active" bool NOT NULL, "task_id" bigint NOT NULL REFERENCES "task_task" ("id") DEFERRABLE INITIALLY DEFERRED, "user_id" bigint NOT NULL REFERENCES "account_user" ("id") DEFERRABLE INITIALLY DEFERRED);
CREATE INDEX IF NOT EXISTS "prompt_conversation_task_id_90287800" ON "prompt_conversation" ("task_id");
CREATE INDEX IF NOT EXISTS "prompt_conversation_user_id_ecc418b3" ON "prompt_conversation" ("user_id");
CREATE TABLE IF NOT EXISTS "prompt_message" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "role" varchar(10) NOT NULL, "content" text NOT NULL, "code_html" text NULL, "code_css" text NULL, "code_js" text NULL, "created" datetime NOT NULL, "conversation_id" char(32) NOT NULL REFERENCES "prompt_conversation" ("id") DEFERRABLE INITIALLY DEFERRED, "prompt_level" integer NULL, "source" varchar(12) NOT NULL, "submission_id" char(32) NULL UNIQUE REFERENCES "submission_submission" ("id") DEFERRABLE INITIALLY DEFERRED);
CREATE INDEX IF NOT EXISTS "prompt_message_conversation_id_af18dd4b" ON "prompt_message" ("conversation_id");
CREATE INDEX IF NOT EXISTS "prompt_message_prompt_level_e461b596" ON "prompt_message" ("prompt_level");
-- 课堂总结统计提示词链用的覆盖索引：只读小列，不碰 content / code_*
CREATE INDEX IF NOT EXISTS "prompt_message_chain" ON "prompt_message" ("conversation_id", "created", "id", "role", "source", "prompt_level");
CREATE INDEX IF NOT EXISTS "prompt_message_submission" ON "prompt_message" ("submission_id", "conversation_id", "created", "source") WHERE "submission_id" IS NOT NULL;

-- 学生交作品时写的一句反思（最满意的改动和理由）；可以不写。删提交时跟着删
CREATE TABLE IF NOT EXISTS "submission_reflection" ("submission_id" char(32) NOT NULL PRIMARY KEY REFERENCES "submission_submission" ("id") ON DELETE CASCADE, "content" text NOT NULL, "modified" datetime NOT NULL);

-- 登录用 JWT：access token 不落库，refresh token 只存 sha256
DROP TABLE IF EXISTS "auth_session";
CREATE TABLE IF NOT EXISTS "auth_refresh_token" ("token_hash" text NOT NULL PRIMARY KEY, "user_id" bigint NOT NULL REFERENCES "account_user" ("id") ON DELETE CASCADE, "expire_at" datetime NOT NULL);
CREATE INDEX IF NOT EXISTS "auth_refresh_token_user_id" ON "auth_refresh_token" ("user_id");
