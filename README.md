# 星愿存钱罐

## 部署文件

把以下三个文件放在 GitHub Pages 仓库根目录并一起提交：

- `index.html`：网站界面、每日/月度共用存钱罐、收入和记录表单。
- `company-features.js`：公司费率、按公司查看时长，以及 Lionbridge 每日/每周上线进度。
- `supabase.js`：邮箱登录、云端数据同步和公司/上线设置同步。

同时保留原有 `manifest.webmanifest`、`icon-192.png` 和 `icon-512.png`，用于手机安装图标。

## 本次改动

- 每日和月度视图共用同一只存钱罐、金币点亮册和摇晃效果；月度视图汇总所选月份。视图选择保存在本机，不再被另一设备的云端设置自动切回。
- 默认费率档案为 Lionbridge（US$0.35/分钟）和 Propio（US$0.30/分钟）；可添加公司、改名、修改费率或删除档案。删除只归档公司并保留它的历史电话记录，不会重算历史金额；同步时也不会被另一设备恢复。
- 存钱罐可按公司筛选，也可看全部公司；每日和每月的收入、电话分钟数都会随筛选更新。
- Lionbridge 上线时长单独手动录入，不会与电话分钟数或收入混算。工作日基准为每天 3 小时 12 分钟，周一至周五每周 16 小时；前一工作日超出的部分会抵扣后续目标，不足则计入后续目标。进度卡片已移至历史日历下方并精简说明。
- 桌面布局拓宽并使用更多屏幕空间；较窄屏幕自动切换为单列。
- 公司档案、逐条电话的公司标记和上线时长保存在现有 `starwish_jar_preferences.preferences` JSONB 中，不增加数据库列或表；旧记录不会被删除。
- 浏览器标签标题已移除“· RM20”。

## 部署与同步

1. 保持 Supabase Auth 的 Site URL 和 Redirect URL 为 GitHub Pages 网站地址。
2. `supabase_realtime` publication 需要包含 `starwish_calls`、`starwish_diary`、`starwish_settings` 和 `starwish_jar_preferences`。RLS 仍按 `user_id = auth.uid()` 隔离账号数据。
3. 将上述三个代码文件一起更新到仓库根目录并部署。部署后，两台设备各刷新一次，并登录同一邮箱账号。
4. JSON 备份包含公司档案与上线进度。导入时记录按 ID 去重合并；旧记录没有公司标记时会保留为“未分类旧记录”。

## 文件

- `index-before-account-ui.html`、`supabase-before-account-ui.js`：之前界面版本的回滚副本。
- `index-before-supabase.html`：Supabase 接入前的回滚副本。

本轮源文件已准备；尚未在真实账号和两台设备上验证新版部署后的云端读写。
