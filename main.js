const obsidian = require('obsidian');

async function checkSpelling(text) {
  // Old speller handles max ~300 tokens per page; chunk to be safe
  // Normalize any whitespace run that contains a line break (\n, \r, \r\n, or
  // several in a row for paragraph breaks) down to a single space. This keeps the
  // API from concatenating the words on either side of a line break (which it would
  // otherwise flag as a spacing error) while never producing double spaces.
  text = text.replace(/\s*[\r\n]\s*/g, ' ');
  const maxWords = 300;
  const tokens = text.split(/(\s+)/);
  const chunks = [];
  let currentChunk = '';
  let wordCount = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    currentChunk += token;
    if (/\S/.test(token)) {
      wordCount++;
    }

    if (wordCount >= maxWords) {
      chunks.push(currentChunk);
      currentChunk = '';
      wordCount = 0;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  const aggregatedCorrections = [];

  for (const chunk of chunks) {
    const resultsUrl = "https://nara-speller.co.kr/old_speller/results";
    const body = new URLSearchParams();
    // Match site’s form field names
    body.set('text1', chunk);
    // Enable stronger rules if available (checkbox in form). Server tolerates absence.
    body.set('btnModeChange', 'on');

    try {
      // Use Obsidian's requestUrl to bypass CORS
      const res = await obsidian.requestUrl({
        url: resultsUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Origin': 'https://nara-speller.co.kr',
          'Referer': 'https://nara-speller.co.kr/old_speller/'
        },
        body: body.toString()
      });

      const html = res.text || '';

      if (res.status < 200 || res.status >= 300 || !html) {
        console.error(
          `Network response was not ok. Status: ${res.status}`,
          'Response snippet:', (html || '').substring(0, 500)
        );
        throw new Error(`Network error: ${res.status}.`);
      }

      const parsed = parseOldSpellerResults(html);
      if (parsed && parsed.corrections) {
        aggregatedCorrections.push(...parsed.corrections);
      }
    } catch (error) {
      console.error('Error during spell check for chunk:', error?.message || error);
      throw new Error(`Failed to check spelling for chunk "${chunk.substring(0, 20)}...": ${error.message}`);
    }
  }

  return { resultOutput: '', corrections: aggregatedCorrections };
}

function parseOldSpellerResults(html) {
  if (typeof html !== 'string' || html.trim() === '') {
    return { resultOutput: '', corrections: [] };
  }

  // Extract the embedded `data = [...] ;` JSON from results page
  const match = html.match(/(?:var\s+)?data\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) {
    return { resultOutput: '', corrections: [] };
  }

  let arr;
  try {
    arr = JSON.parse(match[1]);
  } catch (e) {
    console.error('Failed to parse embedded results JSON:', e);
    return { resultOutput: '', corrections: [] };
  }

  if (!Array.isArray(arr)) {
    return { resultOutput: '', corrections: [] };
  }

  const corrections = [];
  for (const entry of arr) {
    const errList = entry && Array.isArray(entry.errInfo) ? entry.errInfo : [];
    for (const err of errList) {
      if (!err || typeof err !== 'object') continue;
      const cand = typeof err.candWord === 'string' ? err.candWord : '';
      const candidates = cand.split('|').map(s => s.trim()).filter(Boolean);
      corrections.push({
        original: err.orgStr || '',
        corrected: candidates.length > 0 ? candidates : (err.orgStr ? [err.orgStr] : []),
        help: decodeHtmlEntities(err.help || '')
      });
    }
  }

  return { resultOutput: '', corrections };
}

function decodeHtmlEntities(text) {
  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/html');
    doc.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    return doc.body.textContent || "";
  }
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/&/g, '&')
    .replace(/"/g, '"')
    .replace(/'/g, "'");
}

// Derive a short error-type tag from the API's help text so each card can be labelled.
function inferErrorType(help) {
  const h = help || '';
  if (h.includes('띄어') || h.includes('붙여')) return { label: '띄어쓰기', spacing: true };
  if (h.includes('표준어')) return { label: '표준어', spacing: false };
  if (h.includes('문장 부호') || h.includes('문장부호') || h.includes('구두점')) return { label: '문장부호', spacing: false };
  if (h.includes('맞춤법') || h.includes('표기')) return { label: '맞춤법', spacing: false };
  return { label: '교정', spacing: false };
}

function replaceFirstOccurrenceWithPlaceholder(text, search, placeholder) {
  const index = text.indexOf(search);
  if (index === -1) return text;
  return text.slice(0, index) + placeholder + text.slice(index + search.length);
}

function highlightOriginalTextWithPlaceholders(text, correctionsInPage, type, baseIndex) {
  let tempText = text;
  if (!Array.isArray(correctionsInPage) || correctionsInPage.length === 0) {
    return text; 
  }
  correctionsInPage.forEach((correction, localIndex) => {
    const globalIndex = baseIndex + localIndex;
    if (correction && typeof correction.original === 'string') {
      tempText = replaceFirstOccurrenceWithPlaceholder(
        tempText,
        correction.original,
        `{placeholder_${type}_${globalIndex}}`
      );
    }
  });
  correctionsInPage.forEach((correction, localIndex) => {
    const globalIndex = baseIndex + localIndex;
    if (correction && typeof correction.original === 'string') {
        const cls = type === 'error' ? 'ksp-err' : 'ksp-preview-word';
        const span = `<span id="${type}_correction${globalIndex}" class="${cls}">${correction.original}</span>`;
        tempText = tempText.replace(
        `{placeholder_${type}_${globalIndex}}`,
        span
      );
    }
  });
  return tempText;
}


// --- `createCorrectionPopup` 함수를 `CorrectionModal` 클래스로 대체 ---

class CorrectionModal extends obsidian.Modal {
  constructor(app, allCorrections, selectedText, start, end, editor) {
    super(app);
    this.allCorrections = allCorrections;
    this.selectedText = selectedText;
    this.start = start;
    this.end = end;
    this.editor = editor;
    this.currentPage = 0;
    this.correctionChunks = [];
    this.userChoices = {};
    this.customMode = {};

    this.MAX_CORRECTIONS_PER_PAGE = 10;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('korean-spellchecker-modal');
    this.modalEl.addClass('korean-spellchecker-modal-el');
    this.titleEl.style.display = 'none'; // use our own custom header instead

    if (this.allCorrections.length === 0) {
      this.close();
      return;
    }

    // Default each error to its first suggestion; the before/after preview makes
    // every pending change visible before the user hits 적용.
    this.allCorrections.forEach((c, i) => {
      if (this.userChoices[i] !== undefined) return;
      this.userChoices[i] = (c && Array.isArray(c.corrected) && c.corrected.length > 0)
        ? c.corrected[0]
        : (c ? c.original : '');
    });

    for (let i = 0; i < this.allCorrections.length; i += this.MAX_CORRECTIONS_PER_PAGE) {
      this.correctionChunks.push(this.allCorrections.slice(i, i + this.MAX_CORRECTIONS_PER_PAGE));
    }

    this.renderContent();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
  
  renderContent() {
    const { contentEl } = this;
    contentEl.empty();

    const currentCorrections = this.correctionChunks[this.currentPage];
    if (!currentCorrections || currentCorrections.length === 0) {
        this.close();
        return;
    }
    const baseIndex = this.currentPage * this.MAX_CORRECTIONS_PER_PAGE;

    // --- Header ---
    const header = contentEl.createDiv({ cls: 'ksp-header' });
    const headerIcon = header.createDiv({ cls: 'ksp-ico' });
    obsidian.setIcon(headerIcon, 'spell-check');
    const headerText = header.createDiv({ cls: 'ksp-header-text' });
    headerText.createEl('p', { cls: 'ksp-title', text: '맞춤법 검사 결과' });
    headerText.createEl('p', { cls: 'ksp-sub', text: '제안을 고른 뒤 적용하세요' });
    header.createDiv({ cls: 'ksp-count', text: `오류 ${this.allCorrections.length}` });

    // --- Before / After preview ---
    const preview = contentEl.createDiv({ cls: 'ksp-preview' });
    const beforeWrap = preview.createDiv({ cls: 'ksp-pane-wrap' });
    beforeWrap.createEl('p', { cls: 'ksp-pane-label', text: '원본' });
    this.beforeEl = beforeWrap.createDiv({ cls: 'ksp-pane' });
    this.beforeEl.innerHTML = highlightOriginalTextWithPlaceholders(this.selectedText, currentCorrections, 'error', baseIndex);
    const arrow = preview.createDiv({ cls: 'ksp-arrow' });
    obsidian.setIcon(arrow, 'arrow-right');
    const afterWrap = preview.createDiv({ cls: 'ksp-pane-wrap' });
    afterWrap.createEl('p', { cls: 'ksp-pane-label', text: '수정본' });
    this.afterEl = afterWrap.createDiv({ cls: 'ksp-pane' });
    this.afterEl.innerHTML = highlightOriginalTextWithPlaceholders(this.selectedText, currentCorrections, 'preview', baseIndex);

    // --- Correction cards ---
    const list = contentEl.createDiv({ cls: 'ksp-list' });
    currentCorrections.forEach((correction, localIndex) => {
        const globalIndex = baseIndex + localIndex;
        if (!correction || typeof correction.original !== 'string' || !Array.isArray(correction.corrected)) return;

        const card = list.createDiv({ cls: 'ksp-card' });

        const cardHead = card.createDiv({ cls: 'ksp-card-head' });
        cardHead.createDiv({ cls: 'ksp-card-idx', text: String(globalIndex + 1) });
        const type = inferErrorType(correction.help);
        cardHead.createEl('span', { cls: `ksp-tag${type.spacing ? ' is-spacing' : ''}`, text: type.label });
        const orig = cardHead.createEl('span', { cls: 'ksp-orig' });
        orig.createEl('s', { text: correction.original });

        const choices = card.createDiv({ cls: 'ksp-choices' });
        const customWrap = card.createDiv({ cls: 'ksp-custom' });
        const customInput = customWrap.createEl('input', { type: 'text', attr: { placeholder: '직접 수정 내용을 입력하세요' } });
        customInput.addEventListener('input', () => {
            this.userChoices[globalIndex] = customInput.value.trim() || correction.original;
            this.updatePreview();
        });

        this.renderChoices(choices, customWrap, customInput, correction, globalIndex);

        if (correction.help) {
            const help = card.createDiv({ cls: 'ksp-help' });
            const helpIcon = help.createSpan({ cls: 'ksp-help-ico' });
            obsidian.setIcon(helpIcon, 'info');
            help.createEl('span', { text: correction.help });
        }
    });

    // --- Footer ---
    const footer = contentEl.createDiv({ cls: 'ksp-footer' });
    if (this.correctionChunks.length > 1) {
        const pager = footer.createDiv({ cls: 'ksp-pager' });
        const prevButton = pager.createEl('button', { cls: 'ksp-pbtn', attr: { 'aria-label': '이전' } });
        obsidian.setIcon(prevButton, 'chevron-left');
        prevButton.disabled = this.currentPage === 0;
        prevButton.addEventListener('click', () => {
            if (this.currentPage > 0) { this.currentPage--; this.renderContent(); }
        });
        pager.createEl('span', { cls: 'ksp-pinfo', text: `${this.currentPage + 1} / ${this.correctionChunks.length}` });
        const nextButton = pager.createEl('button', { cls: 'ksp-pbtn', attr: { 'aria-label': '다음' } });
        obsidian.setIcon(nextButton, 'chevron-right');
        nextButton.disabled = this.currentPage === this.correctionChunks.length - 1;
        nextButton.addEventListener('click', () => {
            if (this.currentPage < this.correctionChunks.length - 1) { this.currentPage++; this.renderContent(); }
        });
    }

    const applyButton = footer.createEl('button', { cls: 'ksp-apply' });
    const applyIcon = applyButton.createSpan({ cls: 'ksp-apply-ico' });
    obsidian.setIcon(applyIcon, 'check');
    applyButton.createSpan({ text: '적용' });
    applyButton.addEventListener('click', () => this.applyCorrectionsHandler());

    this.updatePreview();
  }

  renderChoices(container, customWrap, customInput, correction, globalIndex) {
    container.empty();
    const current = this.userChoices[globalIndex];
    const isCustom = !!this.customMode[globalIndex];

    const makeChip = (label, opts = {}) => {
        let cls = 'ksp-chip';
        if (opts.keep) cls += ' is-keep';
        if (opts.custom) cls += ' is-custom';
        if (opts.selected) cls += ' is-selected';
        const chip = container.createEl('button', { cls });
        if (opts.selected && !opts.custom) {
            const check = chip.createSpan({ cls: 'ksp-chip-check' });
            obsidian.setIcon(check, 'check');
        }
        chip.createSpan({ text: label });
        return chip;
    };

    correction.corrected.forEach((option) => {
        const chip = makeChip(option, { selected: !isCustom && current === option });
        chip.addEventListener('click', () => this.selectChoice(container, customWrap, customInput, correction, globalIndex, option, false));
    });

    const keepChip = makeChip('원본 유지', { keep: true, selected: !isCustom && current === correction.original });
    keepChip.addEventListener('click', () => this.selectChoice(container, customWrap, customInput, correction, globalIndex, correction.original, false));

    const customChip = makeChip('직접 수정', { custom: true, selected: isCustom });
    customChip.addEventListener('click', () => this.selectChoice(container, customWrap, customInput, correction, globalIndex, null, true));

    customWrap.toggleClass('show', isCustom);
    if (isCustom) customInput.value = current === correction.original ? '' : current;
  }

  selectChoice(container, customWrap, customInput, correction, globalIndex, value, custom) {
    if (custom) {
        this.customMode[globalIndex] = true;
        this.userChoices[globalIndex] = customInput.value.trim() || correction.original;
        this.renderChoices(container, customWrap, customInput, correction, globalIndex);
        customInput.focus();
    } else {
        this.customMode[globalIndex] = false;
        this.userChoices[globalIndex] = value;
        this.renderChoices(container, customWrap, customInput, correction, globalIndex);
    }
    this.updatePreview();
  }

  updatePreview() {
    const currentCorrections = this.correctionChunks[this.currentPage];
    if (!currentCorrections || !this.afterEl) return;
    const baseIndex = this.currentPage * this.MAX_CORRECTIONS_PER_PAGE;
    currentCorrections.forEach((correction, localIndex) => {
        const globalIndex = baseIndex + localIndex;
        if (!correction || typeof correction.original !== 'string') return;

        let choice = this.userChoices[globalIndex];
        if (choice === undefined) choice = correction.original;

        const spanElement = this.afterEl.querySelector(`#preview_correction${globalIndex}`);
        if (spanElement) {
            spanElement.textContent = choice;
            spanElement.classList.toggle('ksp-fix', choice !== correction.original);
        }
    });
  }

  applyCorrectionsHandler() {
    let finalAppliedText = this.selectedText;

    // First pass: replace original occurrences with unique placeholders
    this.allCorrections.forEach((correction, globalIndex) => {
        if (correction && typeof correction.original === 'string') {
            finalAppliedText = replaceFirstOccurrenceWithPlaceholder(
                finalAppliedText,
                correction.original,
                `{placeholder_apply_${globalIndex}}`
            );
        }
    });

    // Second pass: replace placeholders with user choices (or original if no choice)
    this.allCorrections.forEach((correction, globalIndex) => {
        if (correction && typeof correction.original === 'string') {
            let choice = this.userChoices[globalIndex];
            if (choice === undefined) {
                choice = correction.original;
            }
            finalAppliedText = finalAppliedText.replace(
                `{placeholder_apply_${globalIndex}}`,
                choice
            );
        }
    });

    this.editor.replaceRange(finalAppliedText, this.start, this.end);
    this.close();
  }
}

class SpellingPlugin extends obsidian.Plugin {
  customNouns = new Set();
  excludedNounsMap = new Map();

  async onload() {
    const statusBarItemEl = this.addStatusBarItem();
    statusBarItemEl.addClass('korean-spellchecker-statusbar');
    const statusIcon = statusBarItemEl.createSpan({ cls: 'korean-spellchecker-statusbar-icon' });
    obsidian.setIcon(statusIcon, 'spell-check');
    statusBarItemEl.createSpan({ text: '맞춤법 검사' });

    // 6. Sentence case 적용
    this.addRibbonIcon("spell-check", "Check spelling", () => this.runSpellCheck());

    this.addCommand({
      id: "check-spelling",
      name: "Check spelling", // 6. Sentence case 적용
      editorCallback: () => this.runSpellCheck()
    });

    await this.loadSettings();

    this.addCommand({
      id: 'manage-custom-nouns',
      name: 'Manage custom nouns', // 6. Sentence case 적용
      callback: () => this.openCustomNounModal()
    });

    this.registerDomEvent(statusBarItemEl, 'click', () => this.runSpellCheck());
  }

  async runSpellCheck() {
    const markdownView = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    const editor = markdownView?.editor;
    if (!editor) {
      new obsidian.Notice("에디터를 찾을 수 없습니다.");
      return;
    }
    const selectedText = editor.getSelection();
    if (!selectedText) {
      new obsidian.Notice("선택된 텍스트가 없습니다.");
      return;
    }
    const cursorStart = editor.getCursor("from");
    const cursorEnd = editor.getCursor("to");
    editor.setCursor(cursorEnd);

    const processedText = this.excludeCustomNouns(selectedText);

    let result;
    try {
      new obsidian.Notice("맞춤법 검사를 시작합니다...", 3000);
      result = await checkSpelling(processedText);
    } catch (error) {
      new obsidian.Notice(`맞춤법 검사 오류: ${error.message}`, 5000);
      console.error(error);
      return;
    }

    if (!result || !Array.isArray(result.corrections) || result.corrections.length === 0) {
      new obsidian.Notice("수정할 것이 없습니다. 훌륭합니다!", 3000);
    } else {
      const finalCorrections = this.includeCustomNounsInCorrections(result.corrections);
      // 5. 네이티브 모달 사용
      new CorrectionModal(this.app, finalCorrections, selectedText, cursorStart, cursorEnd, editor).open();
    }
  }

  excludeCustomNouns(text) {
    this.excludedNounsMap.clear();
    let processedText = text;
    const sortedNouns = Array.from(this.customNouns).sort((a, b) => b.length - a.length);
    let placeholderIndex = 0;

    sortedNouns.forEach(noun => {
        if (noun.trim() === "") return;

        const escapedNoun = noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedNoun, 'g');

        processedText = processedText.replace(regex, () => {
            const placeholder = `__NOUN_${placeholderIndex++}__`;
            this.excludedNounsMap.set(placeholder, noun);
            return placeholder;
        });
    });
    return processedText;
  }

  includeCustomNounsInCorrections(corrections) {
    if (!Array.isArray(corrections)) return [];

    const restoreNouns = (text) => {
        let restoredText = text;
        for (const [placeholder, noun] of this.excludedNounsMap.entries()) {
            restoredText = restoredText.replace(new RegExp(placeholder, 'g'), noun);
        }
        return restoredText;
    };

    return corrections.map(correction => {
        if (!correction || typeof correction.original !== 'string' || !Array.isArray(correction.corrected)) {
            return correction;
        }
        return {
            ...correction,
            original: restoreNouns(correction.original),
            corrected: correction.corrected.map(cand => typeof cand === 'string' ? restoreNouns(cand) : cand)
        };
    });
  }

  async loadSettings() {
    const savedData = await this.loadData();
    if (savedData && savedData.customNouns && Array.isArray(savedData.customNouns)) {
      this.customNouns = new Set(savedData.customNouns);
    } else {
      this.customNouns = new Set(); 
    }
  }

  async saveSettings() {
    await this.saveData({ customNouns: Array.from(this.customNouns) });
  }

  openCustomNounModal() {
    new CustomNounModal(this.app, this).open();
  }

  onunload() {
    // 모달은 자동으로 닫히고 정리되므로 특별한 unload 로직은 필요 없습니다.
  }
}

class CustomNounModal extends obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const {contentEl} = this;
    contentEl.empty();
    contentEl.addClass('custom-noun-modal');
    this.modalEl.addClass('custom-noun-modal-el');
    this.titleEl.style.display = 'none'; // use our own custom header instead

    const header = contentEl.createDiv({ cls: 'ksp-noun-head' });
    const headerIcon = header.createDiv({ cls: 'ksp-ico' });
    obsidian.setIcon(headerIcon, 'tags');
    const headerText = header.createDiv({ cls: 'ksp-header-text' });
    headerText.createEl('h3', { cls: 'ksp-title', text: '고유명사 관리' });
    headerText.createEl('p', { cls: 'ksp-sub', text: '여기 등록한 단어는 맞춤법 검사에서 제외됩니다' });

    const body = contentEl.createDiv({ cls: 'ksp-noun-body' });
    const listContainerEl = body.createDiv({ cls: 'ksp-noun-chips' });

    const renderList = () => {
        listContainerEl.empty();
        if (this.plugin.customNouns.size === 0) {
            listContainerEl.createEl('p', { cls: 'ksp-noun-empty', text: '아직 등록된 고유명사가 없습니다.' });
        } else {
            Array.from(this.plugin.customNouns).sort().forEach(noun => {
                const chip = listContainerEl.createDiv({ cls: 'ksp-noun-chip' });
                chip.createSpan({ text: noun });
                const deleteButton = chip.createEl('button', { attr: { 'aria-label': `${noun} 삭제` } });
                obsidian.setIcon(deleteButton, 'x');
                deleteButton.onclick = async () => {
                    this.plugin.customNouns.delete(noun);
                    await this.plugin.saveSettings();
                    renderList();
                };
            });
        }
    };

    renderList();

    const inputGroup = body.createDiv({ cls: 'ksp-noun-input' });
    const inputEl = inputGroup.createEl('input', {type: 'text', placeholder: '새 고유명사 추가'});
    const addButton = inputGroup.createEl('button', {text: '추가'});

    const addNounAction = async () => {
        const newNoun = inputEl.value.trim();
        if (newNoun) {
            if (this.plugin.customNouns.has(newNoun)) {
                new obsidian.Notice(`"${newNoun}"은(는) 이미 등록된 고유명사입니다.`, 3000);
            } else {
                this.plugin.customNouns.add(newNoun);
                await this.plugin.saveSettings();
                inputEl.value = '';
                renderList();
                new obsidian.Notice(`"${newNoun}"이(가) 고유명사로 추가되었습니다.`, 3000);
            }
        } else {
            new obsidian.Notice('추가할 고유명사를 입력하세요.', 3000);
        }
        inputEl.focus(); 
    };

    addButton.onclick = addNounAction;
    inputEl.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault(); 
            addNounAction();
        }
    });
    setTimeout(() => inputEl.focus(), 50);
  }

  onClose() {
    const {contentEl} = this;
    contentEl.empty();
  }
}

module.exports = SpellingPlugin;
