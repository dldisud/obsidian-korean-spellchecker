const obsidian = require('obsidian');



async function checkSpelling(text) {
  const maxWords = 300;  // 최대 300어절씩
  const words = text.split(/\s+/);
  const chunks = [];
  
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(' '));
  }

  const results = [];

  // 각 청크에 대해 요청 보내기
  for (const chunk of chunks) {
    const targetUrl = "https://nara-speller.co.kr/speller/results";
    const response = await fetch(targetUrl, {  // 프록시 제거
      method: "POST",
      headers: { 
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"  // User-Agent 헤더 추가
      },
      body: new URLSearchParams({ text1: chunk.replace(/\n/g, "\r") })
    });
    
    if (!response.ok) {
      throw new Error("Network response was not ok");
    }

    if (!response.ok) {
      throw new Error("Network response was not ok");
    }
    const data = await response.text();
    const result = parseSpellingResults(data);
    results.push(result);
  }

  return results.reduce((acc, result) => {
    acc.resultOutput += result.resultOutput;
    acc.corrections.push(...result.corrections);
    return acc;
  }, { resultOutput: "", corrections: [] });
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
  const MAX_CORRECTIONS_PER_PAGE = 10;
  const chunks = [];
  const totalCorrections = corrections.length;

  // corrections를 페이지 단위로 나누기
  for (let i = 0; i < totalCorrections; i += MAX_CORRECTIONS_PER_PAGE) {
    chunks.push(corrections.slice(i, i + MAX_CORRECTIONS_PER_PAGE));
  }

  const themeClass = document.body.classList.contains("theme-light") ? "light" : "dark";

  // 현재 페이지 상태를 추적
  let currentPage = 0;

  // 페이지 렌더링 함수
  const renderPopup = () => {
    const currentCorrections = chunks[currentPage];
    const popupHtml = `
      <div id="correctionPopup" class="${themeClass}">
        <div class="header">
          <button id="applyCorrectionsButton">적용</button>
          <h2>맞춤법 검사 결과 (${currentPage + 1}/${chunks.length})</h2>
          <button id="closePopupButton">닫기</button>
        </div>
        <div class="preview-container">
          <div class="error-text">${highlightOriginalTextWithPlaceholders(
            selectedText,
            currentCorrections,
            "error"
          )}</div>
          <div class="arrow">▶</div>
          <div id="resultPreview" class="result-preview">${highlightOriginalTextWithPlaceholders(
            selectedText,
            currentCorrections,
            "preview"
          )}</div>
        </div>
        <div class="content">
          <div id="correctionUI" class="correction-list">
            ${currentCorrections.map(
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
        <div class="pagination">
          <button id="prevPageButton" ${currentPage === 0 ? 'disabled' : ''}>이전</button>
          <span class="pagination-info">${currentPage + 1} / ${chunks.length}</span>
          <button id="nextPageButton" ${currentPage === chunks.length - 1 ? 'disabled' : ''}>다음</button>
        </div>
        <div class="info-box">
          <p><a href="http://nara-speller.co.kr/speller/">한국어 맞춤법/문법 검사기</a>는 부산대학교 인공지능연구실과 (주)나라인포테크가 함께 만들고 있습니다.<br />이 검사기는 개인이나 학생만 무료로 사용할 수 있습니다.</p>
        </div>
      </div>`;

    // 기존 팝업 제거 후 새 팝업 추가
    const existingPopup = document.getElementById("correctionPopup");
    if (existingPopup) existingPopup.remove();
    const popup = document.createElement("div");
    popup.innerHTML = popupHtml;
    document.body.appendChild(popup);

    // 버튼 클릭 이벤트
    document.getElementById("closePopupButton")?.addEventListener("click", closePopup);
    document.getElementById("applyCorrectionsButton")?.addEventListener("click", applyCorrections);

    // 페이지 전환 버튼 이벤트
    document.getElementById("prevPageButton")?.addEventListener("click", () => {
      if (currentPage > 0) {
        currentPage--;
        renderPopup();
      }
    });
    document.getElementById("nextPageButton")?.addEventListener("click", () => {
      if (currentPage < chunks.length - 1) {
        currentPage++;
        renderPopup();
      }
    });

    // 미리보기 업데이트
    document.querySelectorAll('input[type="radio"]').forEach((input) => {
      input.addEventListener("click", updatePreview);
    });

    document.querySelectorAll('input[type="text"]').forEach((input) => {
      input.addEventListener("input", updatePreview);
    });
  };

  function closePopup() {
    document.getElementById("correctionPopup")?.remove();
    document.removeEventListener("keydown", escKeyListener);
  }

  function updatePreview() {
    highlightCorrectedText(corrections);
  }

  function applyCorrections() {
    corrections.forEach((correction, index) => {
      const selectedOptionElement = document.querySelector(
        `input[name="correction${index}"]:checked`
      );
      const selectedOption = selectedOptionElement ? selectedOptionElement.value : correction.original;
      const customTextElement = document.getElementById(`customCorrection${index}`);
      const customText = customTextElement ? customTextElement.value.trim() : "";
      let correctionText;
      if (selectedOption === "custom") {
        correctionText = customText || correction.original;
      } else {
        correctionText = selectedOption;
      }
      const spanElement = document.getElementById(`preview_correction${index}`);
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
  }

  function escKeyListener(event) {
    if (event.key === "Escape") {
      closePopup();
    }
  }

  document.addEventListener("keydown", escKeyListener);
  renderPopup(); // 첫 페이지 렌더링
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
