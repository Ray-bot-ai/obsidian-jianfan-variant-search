'use strict';

const obsidian = require('obsidian');
const { Plugin, ItemView, PluginSettingTab, Setting, Notice, debounce, MarkdownView, Platform } = obsidian;

const VIEW_TYPE = 'jianfan-variant-search-view';

const DEFAULT_SETTINGS = {
  searchTxt: true,        // 同时搜索 .txt
  contextChars: 24,       // 摘要前后字数
  maxFiles: 300,          // 最多展示多少个文件
  maxHitsPerFile: 5,      // 每个文件最多展示几处
  caseInsensitive: true,  // 拉丁字母大小写不敏感
};

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------- 检索视图 ----------------------
class VariantSearchView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.runId = 0;            // 用于取消过期检索
    this.lastQuery = '';
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return '简繁异体通搜'; }
  getIcon() { return 'search'; }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass('jfvs-root');

    const header = root.createDiv({ cls: 'jfvs-header' });
    this.inputEl = header.createEl('input', {
      cls: 'jfvs-input',
      attr: { type: 'text', placeholder: '输入要搜的词（简繁异体通用，空格=且）…' },
    });
    this.countEl = header.createDiv({ cls: 'jfvs-count' });

    this.resultsEl = root.createDiv({ cls: 'jfvs-results' });

    const onInput = debounce(() => this.runSearch(this.inputEl.value), 300, false);
    this.inputEl.addEventListener('input', onInput);
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.runSearch(this.inputEl.value); }
    });

    this.injectStyle();
    setTimeout(() => this.inputEl.focus(), 0);
  }

  async onClose() {}

  setQuery(q) {
    if (this.inputEl) {
      this.inputEl.value = q || '';
      this.runSearch(this.inputEl.value);
      this.inputEl.focus();
    }
  }

  // 把一个检索词编译成「字形等价」正则源
  compileTerm(term) {
    const variants = this.plugin.variants;
    let out = '';
    for (const ch of term) {
      if (/\s/.test(ch)) continue;
      const group = variants[ch];
      if (group && group.length > 1) {
        let cls = '';
        for (const v of group) cls += escapeRe(v);
        out += '[' + cls + ']';
      } else {
        out += escapeRe(ch);
      }
    }
    return out;
  }

  async runSearch(raw) {
    const query = (raw || '').trim();
    this.lastQuery = query;
    const myRun = ++this.runId;            // 标记本次检索
    this.resultsEl.empty();
    this.countEl.setText('');

    if (!query) return;

    const terms = query.split(/\s+/).filter(Boolean);
    const flags = this.plugin.settings.caseInsensitive ? 'gi' : 'g';
    let termRegexes;
    try {
      termRegexes = terms.map((t) => new RegExp(this.compileTerm(t), flags));
    } catch (err) {
      this.countEl.setText('正则错误');
      return;
    }
    // 用第一个词提取摘要
    const primary = termRegexes[0];

    const files = this.plugin.getSearchableFiles();
    this.countEl.setText(`检索中… 0 / ${files.length}`);

    const s = this.plugin.settings;
    const hitsByFile = [];
    let scanned = 0, matchedFiles = 0;

    for (const file of files) {
      if (myRun !== this.runId) return;     // 已被新检索取代
      scanned++;
      let content;
      try { content = await this.app.vault.cachedRead(file); }
      catch (e) { continue; }

      // 每个词都必须出现（且关系）
      let ok = true;
      for (const re of termRegexes) { re.lastIndex = 0; if (!re.test(content)) { ok = false; break; } }
      if (ok) {
        const hits = this.collectHits(content, primary, s.contextChars, s.maxHitsPerFile);
        let total = 0; primary.lastIndex = 0; let mm;
        while ((mm = primary.exec(content))) { total++; if (mm.index === primary.lastIndex) primary.lastIndex++; if (total > 9999) break; }
        hitsByFile.push({ file, hits, total });
        matchedFiles++;
      }

      if (scanned % 80 === 0) {
        this.countEl.setText(`检索中… ${scanned} / ${files.length}（已命中 ${matchedFiles}）`);
        await new Promise((r) => setTimeout(r, 0)); // 让出主线程
        if (myRun !== this.runId) return;
      }
    }

    if (myRun !== this.runId) return;
    this.render(hitsByFile, query, terms);
  }

  // 在 content 中按正则收集若干处带上下文的命中
  collectHits(content, re, ctx, maxHits) {
    const hits = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) && hits.length < maxHits) {
      const start = m.index;
      const end = start + m[0].length;
      const from = Math.max(0, start - ctx);
      const to = Math.min(content.length, end + ctx);
      hits.push({
        offset: start,
        pre: (from > 0 ? '…' : '') + content.slice(from, start).replace(/\s+/g, ' '),
        hit: content.slice(start, end),
        post: content.slice(end, to).replace(/\s+/g, ' ') + (to < content.length ? '…' : ''),
      });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return hits;
  }

  render(hitsByFile, query, terms) {
    this.resultsEl.empty();
    const total = hitsByFile.reduce((a, b) => a + b.total, 0);
    this.countEl.setText(`${hitsByFile.length} 个文件 · 约 ${total} 处`);

    if (hitsByFile.length === 0) {
      this.resultsEl.createDiv({ cls: 'jfvs-empty', text: '没有找到匹配。' });
      return;
    }

    // 命中多的文件排前面
    hitsByFile.sort((a, b) => b.total - a.total);
    const shown = hitsByFile.slice(0, this.plugin.settings.maxFiles);

    for (const { file, hits, total } of shown) {
      const fileEl = this.resultsEl.createDiv({ cls: 'jfvs-file' });
      const titleEl = fileEl.createDiv({ cls: 'jfvs-file-title' });
      titleEl.createSpan({ cls: 'jfvs-file-name', text: file.basename });
      titleEl.createSpan({ cls: 'jfvs-file-path', text: '  ' + file.path });
      titleEl.createSpan({ cls: 'jfvs-file-count', text: `  ${total}` });
      titleEl.addEventListener('click', () => this.openAt(file, hits[0] ? hits[0].offset : 0));

      for (const h of hits) {
        const snip = fileEl.createDiv({ cls: 'jfvs-snippet' });
        snip.createSpan({ text: h.pre });
        snip.createSpan({ cls: 'jfvs-mark', text: h.hit });
        snip.createSpan({ text: h.post });
        snip.addEventListener('click', () => this.openAt(file, h.offset));
      }
      if (total > hits.length) {
        fileEl.createDiv({ cls: 'jfvs-more', text: `… 还有 ${total - hits.length} 处` });
      }
    }
    if (hitsByFile.length > shown.length) {
      this.resultsEl.createDiv({ cls: 'jfvs-more', text: `… 另有 ${hitsByFile.length - shown.length} 个文件未显示（可在设置里调大上限）` });
    }
  }

  async openAt(file, offset) {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    const view = leaf.view;
    if (view instanceof MarkdownView && view.editor && typeof offset === 'number') {
      const content = view.editor.getValue();
      const idx = Math.min(offset, content.length);
      let line = 0, last = 0;
      for (let i = 0; i < idx; i++) { if (content[i] === '\n') { line++; last = i + 1; } }
      const ch = idx - last;
      const pos = { line, ch };
      view.editor.setCursor(pos);
      view.editor.scrollIntoView({ from: pos, to: pos }, true);
      view.editor.setSelection(pos, { line, ch: ch });
    }
  }

  injectStyle() {
    if (document.getElementById('jfvs-style')) return;
    const css = `
.jfvs-root{display:flex;flex-direction:column;height:100%;}
.jfvs-header{padding:8px 10px 6px;border-bottom:1px solid var(--background-modifier-border);}
.jfvs-input{width:100%;box-sizing:border-box;padding:6px 8px;font-size:14px;}
.jfvs-count{font-size:11px;color:var(--text-muted);margin-top:4px;}
.jfvs-results{flex:1;overflow-y:auto;padding:4px 6px 24px;}
.jfvs-file{margin:6px 0 10px;}
.jfvs-file-title{cursor:pointer;font-weight:600;font-size:13px;color:var(--text-normal);padding:2px 4px;border-radius:4px;}
.jfvs-file-title:hover{background:var(--background-modifier-hover);}
.jfvs-file-path{font-weight:400;font-size:11px;color:var(--text-faint);}
.jfvs-file-count{font-weight:400;font-size:11px;color:var(--text-accent);}
.jfvs-snippet{cursor:pointer;font-size:12px;line-height:1.5;color:var(--text-muted);padding:2px 8px;border-left:2px solid transparent;}
.jfvs-snippet:hover{background:var(--background-modifier-hover);border-left-color:var(--interactive-accent);}
.jfvs-mark{background:var(--text-highlight-bg);color:var(--text-normal);border-radius:2px;padding:0 1px;font-weight:600;}
.jfvs-more{font-size:11px;color:var(--text-faint);padding:2px 8px;}
.jfvs-empty{padding:16px;color:var(--text-muted);}
`;
    const style = document.createElement('style');
    style.id = 'jfvs-style';
    style.textContent = css;
    document.head.appendChild(style);
  }
}

// ---------------------- 插件主体 ----------------------
class VariantSearchPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    await this.loadVariants();

    this.registerView(VIEW_TYPE, (leaf) => new VariantSearchView(leaf, this));

    this.addRibbonIcon('search', '简繁异体通搜', () => this.activateView());

    this.addCommand({
      id: 'open-variant-search',
      name: '打开简繁异体通搜',
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: 'variant-search-selection',
      name: '用选中文字进行简繁异体通搜',
      editorCallback: async (editor) => {
        const sel = editor.getSelection();
        const view = await this.activateView();
        if (view && sel) view.setQuery(sel);
      },
    });

    this.addSettingTab(new VariantSearchSettingTab(this.app, this));
  }

  onunload() {
    const el = document.getElementById('jfvs-style');
    if (el) el.remove();
  }

  async loadVariants() {
    this.variants = {};
    try {
      const path = this.manifest.dir + '/variants.json';
      const raw = await this.app.vault.adapter.read(path);
      this.variants = JSON.parse(raw);
    } catch (e) {
      new Notice('简繁异体通搜：variants.json 加载失败，将退化为普通检索。');
      console.error('[jfvs] load variants failed', e);
    }
  }

  getSearchableFiles() {
    const exts = this.settings.searchTxt ? ['md', 'txt'] : ['md'];
    return this.app.vault.getFiles().filter((f) => exts.includes(f.extension));
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
    return leaf.view;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class VariantSearchSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h3', { text: '简繁异体通搜' });

    new Setting(containerEl)
      .setName('同时检索 .txt 文件')
      .setDesc('除 Markdown 外，也搜索纯文本（如 OCR 全文）。')
      .addToggle((t) => t.setValue(this.plugin.settings.searchTxt).onChange(async (v) => { this.plugin.settings.searchTxt = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('摘要上下文字数')
      .setDesc('命中处前后各显示多少个字符。')
      .addSlider((sl) => sl.setLimits(8, 60, 4).setValue(this.plugin.settings.contextChars).setDynamicTooltip().onChange(async (v) => { this.plugin.settings.contextChars = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('最多显示文件数')
      .addText((tx) => tx.setValue(String(this.plugin.settings.maxFiles)).onChange(async (v) => { const n = parseInt(v, 10); if (!isNaN(n)) { this.plugin.settings.maxFiles = n; await this.plugin.saveSettings(); } }));

    new Setting(containerEl)
      .setName('每个文件最多显示命中处')
      .addText((tx) => tx.setValue(String(this.plugin.settings.maxHitsPerFile)).onChange(async (v) => { const n = parseInt(v, 10); if (!isNaN(n)) { this.plugin.settings.maxHitsPerFile = n; await this.plugin.saveSettings(); } }));

    new Setting(containerEl)
      .setName('拉丁字母大小写不敏感')
      .addToggle((t) => t.setValue(this.plugin.settings.caseInsensitive).onChange(async (v) => { this.plugin.settings.caseInsensitive = v; await this.plugin.saveSettings(); }));

    const info = containerEl.createEl('p', { cls: 'setting-item-description' });
    info.setText('字形对照数据来自 cjkvi-tables（简繁汉字对照表、简化字总表、第一批异体字整理表、日本新旧字体表）。');
  }
}

module.exports = VariantSearchPlugin;
