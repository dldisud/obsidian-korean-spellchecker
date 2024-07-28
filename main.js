const obsidian = require('obsidian');

const CORS_PROXY = "https://corsproxy.io/?";

async function checkSpelling(text) {
  const targetUrl = "http://speller.cs.pusan.ac.kr/results";
  const response = await fetch(`${CORS_PROXY}${targetUrl}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ text1: text.replace(/\n/g, "\r") })
  });
  if (!response.ok) {
    throw new Error("Network response was not ok");
  }
  const data = await response.text();
  return parseSpellingResults(data);
}

function parseSpellingResults(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const scriptTag = Array.from(doc.scripts).find(
    (script) => script.text.includes("data = ")
  );
  if (scriptTag) {
    const jsonStringMatch = scriptTag.text.match(/data = (\[.*?\]);/);
    if (jsonStringMatch && jsonStringMatch[1]) {
      const resultData = JSON.parse(jsonStringMatch[1]);
      return formatSpellingResults(resultData);
    }
  }
  return { resultOutput: "결과를 파싱할 수 없습니다.", corrections: [] };
}

function formatSpellingResults(resultData) {
  let resultOutput = "";
  const corrections = [];
  resultData.forEach((sentenceData, index) => {
    let highlightedText = sentenceData.str;
    sentenceData.errInfo.forEach((err, errIndex) => {
      highlightedText = replaceFirstOccurrenceWithPlaceholder(
        highlightedText,
        err.orgStr,
        `{placeholder_${index}_${errIndex}}`
      );
      const correction = {
        original: err.orgStr,
        corrected: err.candWord.split("|"),
        help: decodeHtmlEntities(err.help)
      };
      corrections.push(correction);
    });
    resultOutput += `문장 ${index + 1}: ${highlightedText}\n`;
  });
  return { resultOutput, corrections };
}

function replaceFirstOccurrenceWithPlaceholder(text, search, placeholder) {
  const index = text.indexOf(search);
  if (index === -1) return text;
  return text.slice(0, index) + placeholder + text.slice(index + search.length);
}

function decodeHtmlEntities(text) {
  const element = document.createElement("div");
  element.innerHTML = text;
  return element.textContent || "";
}

function highlightOriginalTextWithPlaceholders(text, corrections, type) {
  corrections.forEach((correction, index) => {
    text = replaceFirstOccurrenceWithPlaceholder(
      text,
      correction.original,
      `{placeholder_${index}}`
    );
  });
  corrections.forEach((correction, index) => {
    text = text.replace(
      `{placeholder_${index}}`,
      `<span id="${type}_correction${index}" style="color: var(--color-red); font-weight: bold;">${correction.original}</span>`
    );
  });
  return text;
}

function highlightCorrectedText(corrections) {
  corrections.forEach((correction, index) => {
    const selectedOptionElement = document.querySelector(
      `input[name="correction${index}"]:checked`
    );
    const selectedOption = selectedOptionElement ? selectedOptionElement.value : correction.original;
    const customTextElement = document.getElementById(
      `customCorrection${index}`
    );
    const customText = customTextElement ? customTextElement.value.trim() : "";
    let correctionText;
    if (selectedOption === "custom") {
      correctionText = customText || correction.original;
    } else {
      correctionText = selectedOption;
    }
    const spanElement = document.getElementById(`preview_correction${index}`);
    if (spanElement) {
      spanElement.innerHTML = correctionText;
      spanElement.style.color = correctionText === correction.original ? "var(--color-red)" : "var(--color-blue)";
    }
  });
}

function createCorrectionPopup(corrections, selectedText, start, end, editor) {
  const themeClass = document.body.classList.contains("theme-light") ? "light" : "dark";
  const popupHtml = `
    <div id="correctionPopup" class="${themeClass}">
        <div class="header">
            <button id="applyCorrectionsButton">적용</button>
            <h2>맞춤법 검사 결과</h2>
            <button id="closePopupButton">닫기</button>
        </div>
        <div class="preview-container">
            <div class="error-text">${highlightOriginalTextWithPlaceholders(
    selectedText,
    corrections,
    "error"
  )}</div>
            <div class="arrow">▶</div>
            <div id="resultPreview" class="result-preview">${highlightOriginalTextWithPlaceholders(
    selectedText,
    corrections,
    "preview"
  )}</div>
        </div>
        <div class="content">
            <div id="correctionUI" class="correction-list">
                ${corrections.map(
    (correction, index) => `
                <div class="correction-item">
                    <b>오류 ${index + 1}:</b> <span>${correction.original}</span><br>
                    <b>수정:</b>
                    ${correction.corrected.map(
      (option, optIndex) => `
                        <input type="radio" name="correction${index}" value="${option}" id="correction${index}_${optIndex}">
                        <label for="correction${index}_${optIndex}">${option}</label>
                    `
    ).join("")}
                    <input type="radio" name="correction${index}" value="${correction.original}" id="correction${index}_original" checked>
                    <label for="correction${index}_original">원본 유지</label>
                    <div class="correction-options">
                        <input type="radio" name="correction${index}" value="custom" id="correction${index}_custom">
                        <label for="correction${index}_custom">직접 수정:</label>
                        <input type="text" id="customCorrection${index}" placeholder="직접 수정 내용을 입력하세요" onfocus="document.getElementById('correction${index}_custom').checked = true;">
                    </div>
                    <pre>${correction.help}</pre>
                </div>
                `
  ).join("")}
            </div>
        </div>
        <div class="info-box">
            <p><a href="http://nara-speller.co.kr/speller/">한국어 맞춤법/문법 검사기</a>는 부산대학교 인공지능연구실과 (주)나라인포테크가 함께 만들고 있습니다.<br />이 검사기는 개인이나 학생만 무료로 사용할 수 있습니다.</p>
        </div>
    </div>`;
  const popup = document.createElement("div");
  popup.innerHTML = popupHtml;
  document.body.appendChild(popup);
  
  function closePopup() {
    document.getElementById("correctionPopup")?.remove();
    document.removeEventListener("keydown", escKeyListener);
  }
  
  function updatePreview() {
    highlightCorrectedText(corrections);
  }
  
  document.querySelectorAll('input[type="radio"]').forEach((input) => {
    input.addEventListener("click", updatePreview);
  });
  
  document.querySelectorAll('input[type="text"]').forEach((input) => {
    input.addEventListener("input", updatePreview);
  });
  
  document.getElementById("applyCorrectionsButton")?.addEventListener("click", () => {
    corrections.forEach((correction, index) => {
      const selectedOptionElement = document.querySelector(
        `input[name="correction${index}"]:checked`
      );
      const selectedOption = selectedOptionElement ? selectedOptionElement.value : correction.original;
      const customTextElement = document.getElementById(
        `customCorrection${index}`
      );
      const customText = customTextElement ? customTextElement.value.trim() : "";
      let correctionText;
      if (selectedOption === "custom") {
        correctionText = customText || correction.original;
      } else {
        correctionText = selectedOption;
      }
      const spanElement = document.getElementById(
        `preview_correction${index}`
      );
      if (spanElement) {
        spanElement.outerHTML = correctionText;
      }
    });
    editor.replaceRange("", start, end);
    editor.replaceRange(
      document.getElementById("resultPreview")?.innerHTML.replace(/<\/?span[^>]*>/g, "") || "",
      start
    );
    closePopup();
  });
  
  document.getElementById("closePopupButton")?.addEventListener("click", closePopup);
  
  function escKeyListener(event) {
    if (event.key === "Escape") {
      closePopup();
    }
  }
  
  document.addEventListener("keydown", escKeyListener);
  updatePreview();
}

class SpellingPlugin extends obsidian.Plugin {
  customNouns = new Set();

  async onload() {
    this.addRibbonIcon("han-spellchecker", "Check Spelling", async () => {
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
      if (!cursorStart || !cursorEnd) {
        new obsidian.Notice("텍스트의 시작 또는 끝 위치를 가져올 수 없습니다.");
        return;
      }
      editor.setCursor(cursorEnd);
      
      const processedText = this.excludeCustomNouns(selectedText);
      
      let resultOutput, corrections;
      try {
        ({ resultOutput, corrections } = await checkSpelling(processedText));
      } catch (error) {
        new obsidian.Notice("맞춤법 검사를 수행할 수 없습니다.");
        console.error(error);
        return;
      }
      if (resultOutput === "" && corrections.length === 0) {
        new obsidian.Notice("수정할 것이 없습니다. 훌륭합니다!");
      } else {
        corrections = this.includeCustomNouns(corrections);
        createCorrectionPopup(
          corrections,
          selectedText,
          cursorStart,
          cursorEnd,
          editor
        );
      }
    });

    this.addCommand({
      id: "check-spelling",
      name: "Check Spelling",
      editorCallback: async (editor) => {
        const selectedText = editor.getSelection();
        if (!selectedText) {
          new obsidian.Notice("선택된 텍스트가 없습니다.");
          return;
        }
        const cursorStart = editor.getCursor("from");
        const cursorEnd = editor.getCursor("to");
        if (!cursorStart || !cursorEnd) {
          new obsidian.Notice("텍스트의 시작 또는 끝 위치를 가져올 수 없습니다.");
          return;
        }
        editor.setCursor(cursorEnd);
        
        const processedText = this.excludeCustomNouns(selectedText);
        
        let resultOutput, corrections;
        try {
          ({ resultOutput, corrections } = await checkSpelling(processedText));
        } catch (error) {
          new obsidian.Notice("맞춤법 검사를 수행할 수 없습니다.");
          console.error(error);
          return;
        }
        if (resultOutput === "" && corrections.length === 0) {
          new obsidian.Notice("수정할 것이 없습니다. 훌륭합니다!");
        } else {
          corrections = this.includeCustomNouns(corrections);
          createCorrectionPopup(
            corrections,
            selectedText,
            cursorStart,
            cursorEnd,
            editor
          );
        }
      }
    });

    // 설정 로드
    await this.loadSettings();

    // 고유명사 관리 명령 추가
    this.addCommand({
      id: 'manage-custom-nouns',
      name: 'Manage Custom Nouns',
      callback: () => this.openCustomNounModal()
    });
  }

  excludeCustomNouns(text) {
    let processedText = text;
    this.customNouns.forEach(noun => {
      const regex = new RegExp(noun, 'g');
      processedText = processedText.replace(regex, match => `___${match}___`);
    });
    return processedText;
  }

  includeCustomNouns(corrections) {
    return corrections.map(correction => ({
      ...correction,
      original: correction.original.replace(/___(.+?)___/g, '$1')
    }));
  }

  async loadSettings() {
    const savedData = await this.loadData();
    if (savedData && savedData.customNouns) {
      this.customNouns = new Set(savedData.customNouns);
    }
  }

  async saveSettings() {
    await this.saveData({ customNouns: Array.from(this.customNouns) });
  }

  openCustomNounModal() {
    const modal = new CustomNounModal(this.app, this);
    modal.open();
  }

  onunload() {
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
    contentEl.createEl('h2', {text: '고유명사 관리'});

    const nounList = contentEl.createEl('ul');
    this.plugin.customNouns.forEach(noun => {
      const li = nounList.createEl('li');
      li.createSpan({text: noun});
      li.createEl('button', {text: '삭제'}).onclick = () => {
        this.plugin.customNouns.delete(noun);
        this.plugin.saveSettings();
        this.onOpen();
      };
    });

    const inputEl = contentEl.createEl('input', {type: 'text', placeholder: '새 고유명사 추가'});
    const addButton = contentEl.createEl('button', {text: '추가'});
    addButton.onclick = () => {
      const newNoun = inputEl.value.trim();
      if (newNoun) {
        this.plugin.customNouns.add(newNoun);
        this.plugin.saveSettings();
        inputEl.value = '';
        this.onOpen();
      }
    };
  }

  onClose() {
    const {contentEl} = this;
    contentEl.empty();
  }
}

module.exports = SpellingPlugin;