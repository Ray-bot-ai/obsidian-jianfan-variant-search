# 提交到 Obsidian 官方插件市场的步骤

> 关于**数据许可**：`variants.json` 由 build_variants.py 从官方规范字表
> （《通用规范汉字表》《简化字总表》《第一批异体字整理表》、日本《常用漢字表》）解析生成。
> 这些官方规范性文件在其法域一般不受著作权保护（中国《著作权法》第五条、日本《著作権法》第十三条），
> 字形等价关系属客观事实数据。cjkvi-tables 不设许可即因其仅为官方表格之转录。
> 因此再分发风险较低；来源已在 LICENSE/README 写明。若求绝对零歧义，可改用 Unicode Unihan 重建数据（非必需）。
> （以上非法律意见。）

## 前置条件（已全部就绪 ✓）
- [x] 公开仓库 `Ray-bot-ai/obsidian-jianfan-variant-search`
- [x] 根目录 `manifest.json`（version 1.0.0）
- [x] Release `1.0.0`，附件含 `main.js`、`manifest.json`
- [x] `LICENSE`、`versions.json`、`README.md`
- [x] `variants.json` 已内联进 `main.js`（市场安装不缺数据）

## 提交流程
1. Fork 官方仓库：https://github.com/obsidianmd/obsidian-releases
2. 编辑 `community-plugins.json`，在数组**末尾**追加这一条（注意前一条要补逗号）：

```json
{
    "id": "jianfan-variant-search",
    "name": "简繁异体通搜",
    "author": "yangrui",
    "description": "把简体、繁体、异体字、日本新旧字体视为等价进行全库全文检索。字形对照数据来自 cjkvi-tables。",
    "repo": "Ray-bot-ai/obsidian-jianfan-variant-search"
}
```

3. 提 PR，按模板勾选自查项（已用官方 API、无 innerHTML 注入、桌面+移动兼容等）。
4. 机器人自动校验 → Obsidian 团队人工审核（数周起，可能要求改动，需及时回应）。

## 审核常见会被问到的点（本插件自查）
- 用了官方 API（vault/adapter/Notice/ItemView），未用私有 API ✓
- 无 `innerHTML/outerHTML` 注入风险（建议正式提交前再自查一遍 DOM 写法）
- `isDesktopOnly: false`，需确保移动端也能跑（检索逻辑纯 JS，应可）
- id/version/tag 三者一致 ✓
