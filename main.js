const obsidian = require('obsidian');

async function checkSpelling(text) {
  // Old speller handles max ~300 tokens per page; chunk to be safe
  const maxWords = 300;
  const words = text.split(/\s+/);
  const chunks = [];

  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(' '));
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
        const span = `<span id="${type}_correction${globalIndex}" style="color: var(--color-red); font-weight: bold;">${correction.original}</span>`;
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
    
    this.MAX_CORRECTIONS_PER_PAGE = 10;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('korean-spellchecker-modal');
    
    if (this.allCorrections.length === 0) {
      this.close();
      return;
    }

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
    
    const errorTextHighlighted = highlightOriginalTextWithPlaceholders(this.selectedText, currentCorrections, "error", baseIndex);
    const resultPreviewHighlighted = highlightOriginalTextWithPlaceholders(this.selectedText, currentCorrections, "preview", baseIndex);
    
    // Header (모달 타이틀로 대체)
    this.titleEl.textContent = `맞춤법 검사 결과 (${this.currentPage + 1}/${this.correctionChunks.length})`;

    // Preview Container
    const previewContainer = contentEl.createDiv({ cls: "preview-container" });
    const errorTextDiv = previewContainer.createDiv({ cls: "error-text" });
    errorTextDiv.innerHTML = errorTextHighlighted;
    previewContainer.createDiv({ cls: "arrow", text: "▶" });
    const resultPreviewDiv = previewContainer.createDiv({ cls: "result-preview", attr: { id: "resultPreview" } });
    resultPreviewDiv.innerHTML = resultPreviewHighlighted;
    
    // Content
    const content = contentEl.createDiv({ cls: "content" });
    const correctionUI = content.createDiv({ cls: "correction-list", attr: { id: "correctionUI" } });

    currentCorrections.forEach((correction, localIndex) => {
        const globalIndex = baseIndex + localIndex;
        if (!correction || typeof correction.original !== 'string' || !Array.isArray(correction.corrected)) return;
        
        const item = correctionUI.createDiv({ cls: "correction-item" });
        item.createEl("b", { text: `오류 ${localIndex + 1}:` });
        item.createEl("span", { text: ` ${correction.original}` });
        item.createEl("br");
        item.createEl("b", { text: "수정:" });

        correction.corrected.forEach((option, optIndex) => {
            const radioId = `correction${globalIndex}_${optIndex}`;
            const radio = item.createEl("input", { type: "radio", attr: { name: `correction${globalIndex}`, value: option, id: radioId } });
            item.createEl("label", { text: option, attr: { for: radioId } });
            radio.addEventListener("click", () => this.updatePreview());
        });

        const originalRadioId = `correction${globalIndex}_original`;
        const radioOriginal = item.createEl("input", { type: "radio", attr: { name: `correction${globalIndex}`, value: correction.original, id: originalRadioId, checked: true } });
        item.createEl("label", { text: "원본 유지", attr: { for: originalRadioId } });
        radioOriginal.addEventListener("click", () => this.updatePreview());

        const customDiv = item.createDiv({ cls: "correction-options" });
        const customRadioId = `correction${globalIndex}_custom`;
        const radioCustom = customDiv.createEl("input", { type: "radio", attr: { name: `correction${globalIndex}`, value: "custom", id: customRadioId } });
        customDiv.createEl("label", { text: "직접 수정:", attr: { for: customRadioId } });
        const inputCustom = customDiv.createEl("input", { type: "text", attr: { id: `customCorrection${globalIndex}`, placeholder: "직접 수정 내용을 입력하세요" } });
        
        radioCustom.addEventListener("click", () => this.updatePreview());
        inputCustom.addEventListener("focus", () => radioCustom.checked = true);
        inputCustom.addEventListener("input", () => this.updatePreview());
        
        item.createEl("pre", { text: correction.help || "" });
    });

    // Pagination & Actions
    const controlsEl = contentEl.createDiv({ cls: 'modal-button-container' });

    const prevButton = controlsEl.createEl("button", { text: "이전" });
    prevButton.disabled = this.currentPage === 0;
    prevButton.addEventListener("click", () => {
        if (this.currentPage > 0) {
            this.currentPage--;
            this.renderContent();
        }
    });

    controlsEl.createEl("span", { cls: "pagination-info", text: `${this.currentPage + 1} / ${this.correctionChunks.length}` });

    const nextButton = controlsEl.createEl("button", { text: "다음" });
    nextButton.disabled = this.currentPage === this.correctionChunks.length - 1;
    nextButton.addEventListener("click", () => {
        if (this.currentPage < this.correctionChunks.length - 1) {
            this.currentPage++;
            this.renderContent();
        }
    });
    
    // Spacer to push apply button to the right
    controlsEl.createDiv({ cls: 'spacer' });

    const applyButton = controlsEl.createEl("button", { text: "적용", cls: "mod-cta" });
    applyButton.addEventListener("click", () => this.applyCorrectionsHandler());

    this.updatePreview(); 
  }

  updatePreview() {
    const currentCorrections = this.correctionChunks[this.currentPage];
    if (currentCorrections) {
      const baseIndex = this.currentPage * this.MAX_CORRECTIONS_PER_PAGE;
      currentCorrections.forEach((correction, localIndex) => {
        const globalIndex = baseIndex + localIndex;
        if (!correction || typeof correction.original !== 'string') return;
    
        const selectedOptionElement = this.contentEl.querySelector(`input[name="correction${globalIndex}"]:checked`);
        const originalTextForComparison = correction.original;
        const selectedOption = selectedOptionElement ? selectedOptionElement.value : originalTextForComparison;
    
        const customTextElement = this.contentEl.querySelector(`#customCorrection${globalIndex}`);
        const customText = customTextElement ? customTextElement.value.trim() : "";
        let correctionText;
        if (selectedOption === "custom") {
          correctionText = customText || originalTextForComparison;
        } else {
          correctionText = selectedOption;
        }
        const spanElement = this.contentEl.querySelector(`#preview_correction${globalIndex}`);
        if (spanElement) {
          spanElement.textContent = correctionText; 
          spanElement.style.color = correctionText === originalTextForComparison ? "var(--color-red)" : "var(--color-blue)";
        }
      });
    }
  }
  
  applyCorrectionsHandler() {
    const resultPreviewElement = this.contentEl.querySelector("#resultPreview");
    if (!resultPreviewElement) {
        this.editor.replaceRange(this.selectedText, this.start, this.end);
        this.close();
        return;
    }
    const tempDiv = resultPreviewElement.cloneNode(true);
    tempDiv.querySelectorAll('span[id^="preview_correction"]').forEach(span => {
        span.replaceWith(span.textContent || "");
    });
    const finalAppliedText = tempDiv.textContent || "";
    this.editor.replaceRange(finalAppliedText, this.start, this.end);
    this.close();
  }
}

class SpellingPlugin extends obsidian.Plugin {
  customNouns = new Set();
  excludedNounsMap = new Map();

  async onload() {
    const statusBarItemEl = this.addStatusBarItem();
    statusBarItemEl.setText('맞춤법 검사');
    statusBarItemEl.addClass('korean-spellchecker-statusbar');

    // 6. Sentence case 적용
    this.addRibbonIcon("han-spellchecker", "Check spelling", () => this.runSpellCheck());

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
    this.titleEl.textContent = '고유명사 관리';

    const listContainerEl = contentEl.createDiv({ cls: 'custom-noun-list-container' });

    const renderList = () => {
        listContainerEl.empty();
        if (this.plugin.customNouns.size === 0) {
            listContainerEl.createEl('p', {text: '등록된 고유명사가 없습니다.'});
        } else {
            const ul = listContainerEl.createEl('ul');
            Array.from(this.plugin.customNouns).sort().forEach(noun => {
                const li = ul.createEl('li');
                li.createSpan({text: noun});
                const deleteButton = li.createEl('button', {text: '삭제', cls: 'mod-warning'});
                deleteButton.onclick = async () => {
                    this.plugin.customNouns.delete(noun);
                    await this.plugin.saveSettings();
                    renderList(); 
                };
            });
        }
    };

    renderList();

    const inputGroup = contentEl.createDiv({ cls: 'custom-noun-input-group' });
    const inputEl = inputGroup.createEl('input', {type: 'text', placeholder: '새 고유명사 추가'});
    const addButton = inputGroup.createEl('button', {text: '추가', cls: 'mod-cta'});
    
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
