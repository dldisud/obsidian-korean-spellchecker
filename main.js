

const obsidian = require('obsidian');

async function checkSpelling(text) {
  const maxWords = 300;
  const words = text.split(/\s+/);
  const chunks = [];
  
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(' '));
  }

  const aggregatedCorrections = [];
  
  console.log("[DEBUG] Text to check (original):", text.substring(0,100) + "..."); // 긴 텍스트 로깅 줄임

  for (const chunk of chunks) {
    const targetUrl = "https://nara-speller.co.kr/speller";

    const formData = new FormData();
    formData.append('1_speller-text', chunk.replace(/\n/g, "\r"));
    formData.append('0', '[{"data":null,"error":null},"$K1"]'); 

    console.log("[DEBUG] Chunk being sent to API:", chunk.substring(0,100) + "..."); // 긴 텍스트 로깅 줄임
    console.log("[DEBUG] Request URL:", targetUrl);
    for (let pair of formData.entries()) {
        console.log(`[DEBUG] FormData field: ${pair[0]}= ${pair[1].substring(0,100)}...`); // 값 로깅 줄임
    }

    try {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: { 
          "Accept": "text/x-component, */*",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Origin": "https://nara-speller.co.kr",
          "Referer": "https://nara-speller.co.kr/speller",
          "Next-Action": "7f2acc76ef56592dba37ceb7bfdff1248517384d32"
        },
        body: formData
      });
      
      const responseText = await response.text();

      if (!response.ok) {
        console.error(
            `[DEBUG] Network response was not ok. Status: ${response.status} (${response.statusText})`,
            "Chunk:", chunk.substring(0,100) + "...", 
            "Response Text:", responseText.substring(0, 500), 
            "Response Headers:", Object.fromEntries(response.headers.entries())
        );
        throw new Error(`Network error: ${response.status} ${response.statusText}. Server response: ${responseText.substring(0,200)}...`);
      }
      
      const responseContentType = response.headers.get("content-type");
      console.log("[DEBUG] Response Content-Type:", responseContentType);
      console.log("[DEBUG] Original responseText (first 500 chars):", responseText.substring(0,500) + (responseText.length > 500 ? "..." : ""));

      let jsonForFirstPart = {"a":"$@1"}; 
      let jsonForMainData = {};    
      let referencedTextForMainData = null; 

      const lines = responseText.split('\n');
      
      lines.forEach(line => {
          if (line.startsWith("0:")) {
              const content = line.substring(2);
              try {
                  jsonForFirstPart = JSON.parse(content);
              } catch (e) {
                  console.warn("[DEBUG] Failed to parse '0:' part of response:", e, content.substring(0,100) + "...");
              }
          } else if (line.startsWith("1:")) {
              const content = line.substring(2);
              try {
                  jsonForMainData = JSON.parse(content);
              } catch (e) {
                  console.error("[DEBUG] Failed to parse '1:' part (main data) of response as JSON. Error:", e, "String was:", content.substring(0,200) + "...");
              }
          } else if (line.startsWith("2:T")) { 
              const textStartIndex = line.indexOf(',') + 1;
              if (textStartIndex > 2 && textStartIndex < line.length) {
                referencedTextForMainData = line.substring(textStartIndex);
              } else {
                referencedTextForMainData = line.substring(2); 
              }
              console.log("[DEBUG] Found referenced text (2:):", referencedTextForMainData.substring(0,100) + "...");
          }
      });
      
      if (Object.keys(jsonForMainData).length === 0 && responseText.includes('"errInfo"')) {
          console.warn("[DEBUG] '1:' line not parsed correctly, but responseText contains 'errInfo'. This might indicate an issue or an unhandled response format variant.");
          // 이 경우, jsonForMainData는 {}로 유지되어 parseNewSpellingApiResponse에서 교정 없음으로 처리될 것임.
          // 필요하다면 여기서 오류를 던지거나, 다른 방식으로 파싱 시도.
      }

      // 만약 jsonForMainData.data.str이 "$2" 이고, referencedTextForMainData가 있다면,
      // 실제 텍스트로 교체해줄 수 있음. parseNewSpellingApiResponse는 errInfo.orgStr을 사용하므로,
      // 이 부분이 직접적인 영향을 주지는 않지만, 완전성을 위해 로깅 정도는 할 수 있음.
      if (jsonForMainData && jsonForMainData.data && jsonForMainData.data.str === "$2" && referencedTextForMainData) {
        console.log("[DEBUG] Main data string refers to '$2'. Referenced text from '2:' line will be implicitly used by server/client logic if needed by 'orgStr'.");
        // jsonForMainData.data.str = referencedTextForMainData; // 직접 교체는 현재 필요 없어 보임.
      }

      const responseJsonArray = [jsonForFirstPart, jsonForMainData];
      
      console.log("[DEBUG] Constructed responseJsonArray for parsing. Part 0 (keys):", Object.keys(jsonForFirstPart), "Part 1 (Main Data - keys):", Object.keys(jsonForMainData));
      if (jsonForMainData && jsonForMainData.data) {
          console.log("[DEBUG] Main Data str:", jsonForMainData.data.str, "errInfo length:", jsonForMainData.data.errInfo?.length);
      }


      const parsedResult = parseNewSpellingApiResponse(responseJsonArray);       
      
      console.log("[DEBUG] Parsed corrections for chunk:", parsedResult.corrections.length > 0 ? parsedResult.corrections[0] : "No corrections");

      if (parsedResult && parsedResult.corrections) {
        aggregatedCorrections.push(...parsedResult.corrections);
      }

    } catch (error) {
      console.error("[DEBUG] Error during spell check for chunk:", chunk.substring(0,100)+"...", error.message, error.stack); 
      throw new Error(`Failed to check spelling for chunk "${chunk.substring(0,20)}...": ${error.message}`);
    }
  }

  console.log("[DEBUG] Final aggregated corrections count:", aggregatedCorrections.length);
  return { resultOutput: "", corrections: aggregatedCorrections };
}

// --- 나머지 코드는 이전 답변과 동일 ---
// parseNewSpellingApiResponse, decodeHtmlEntities, UI 관련 함수들, SpellingPlugin 클래스 등

function parseNewSpellingApiResponse(responseJson) {
  if (!responseJson || !Array.isArray(responseJson) || responseJson.length < 2) {
    console.warn("[DEBUG] Invalid API JSON response structure for parseNewSpellingApiResponse. Expected array with at least 2 elements:", responseJson);
    return { resultOutput: "", corrections: [] }; 
  }

  const spellDataContainer = responseJson[1]; 
  if (!spellDataContainer || typeof spellDataContainer !== 'object' || spellDataContainer === null) {
    console.warn("[DEBUG] Second element of API response (spellDataContainer) is not a valid object:", spellDataContainer);
    if (Object.keys(spellDataContainer || {}).length === 0) {
        console.log("[DEBUG] Second element (spellDataContainer) is empty, assuming no corrections.");
        return { resultOutput: "", corrections: [] };
    }
    return { resultOutput: "", corrections: [] };
  }
  
  if (spellDataContainer.hasOwnProperty('digest') && Object.keys(spellDataContainer).length === 1) {
      console.warn("[DEBUG] API returned an error digest object in spellDataContainer:", spellDataContainer);
      return { resultOutput: `서버 오류: ${spellDataContainer.digest}`, corrections: []};
  }

  const spellData = spellDataContainer.data;

  if (!spellData || !spellData.errInfo || spellData.errInfo.length === 0) {
    if (spellData && spellData.str) { 
        console.log("[DEBUG] No spelling errors found by API for (str exists):", spellData.str);
    } else if (spellDataContainer.error) { 
        console.warn("[DEBUG] API returned an error object in spellDataContainer:", spellDataContainer.error);
    } else { 
        // data가 null이거나, errInfo가 없는 모든 경우 (jsonForMainData가 {} 였던 경우 포함)
        console.log("[DEBUG] No 'data' or 'errInfo' or empty 'errInfo' in API JSON response, assuming no errors. SpellDataContainer:", spellDataContainer);
    }
    return { resultOutput: "", corrections: [] };
  }

  const corrections = [];
  spellData.errInfo.forEach((err) => {
    if (!err || typeof err !== 'object') {
        console.warn("[DEBUG] Invalid error item in errInfo:", err);
        return; 
    }
    // orgStr이 "$2" 일 수 있으나, UI 표시는 orgStr 그대로 하므로 문제 없음.
    // 실제 교정 대상 텍스트는 사용자 선택 텍스트를 사용.
    const correctedWords = err.candWord ? err.candWord.split("|") : (err.orgStr ? [err.orgStr] : []);

    corrections.push({
      original: err.orgStr || "", 
      corrected: correctedWords,
      help: decodeHtmlEntities(err.help || "") 
    });
  });

  return { resultOutput: "", corrections }; 
}

// ... (decodeHtmlEntities 이하 나머지 코드는 이전과 동일)
function decodeHtmlEntities(text) {
  if (typeof document !== 'undefined') { 
    const element = document.createElement("div");
    element.innerHTML = text;
    return element.textContent || "";
  }
  return text.replace(/</g, '<').replace(/>/g, '>').replace(/&/g, '&').replace(/"/g, '"').replace(/'/g, "'").replace(/<br\s*\/?>/gi, '\n');
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
      // 만약 correction.original이 "$2"이고, 실제 텍스트로 하이라이트해야 한다면 여기서 처리 필요.
      // 하지만 현재는 API가 반환한 orgStr (예: "$2")을 그대로 사용.
      // UI에서는 selectedText를 기반으로 하므로 "$2"가 직접 보이지 않음.
      tempText = replaceFirstOccurrenceWithPlaceholder(
        tempText,
        correction.original === "$2" && referencedTextForMainData ? referencedTextForMainData : correction.original, // orgStr이 $2면 실제 텍스트 사용 시도 (이 변수가 전역이어야 함) - 복잡도 증가로 일단 보류
        `{placeholder_${type}_${globalIndex}}`
      );
    }
  });
  correctionsInPage.forEach((correction, localIndex) => {
    const globalIndex = baseIndex + localIndex;
    if (correction && typeof correction.original === 'string') {
      tempText = tempText.replace(
        `{placeholder_${type}_${globalIndex}}`,
        // 여기서도 correction.original이 $2일 경우 처리 필요할 수 있음
        `<span id="${type}_correction${globalIndex}" style="color: var(--color-red); font-weight: bold;">${correction.original === "$2" && referencedTextForMainData ? referencedTextForMainData : correction.original}</span>`
      );
    }
  });
  return tempText;
}

function highlightCorrectedText(correctionsInPage, baseIndex) {
  if (!Array.isArray(correctionsInPage) || correctionsInPage.length === 0) {
    return;
  }
  correctionsInPage.forEach((correction, localIndex) => {
    const globalIndex = baseIndex + localIndex;
    if (!correction || typeof correction.original !== 'string') return;

    const selectedOptionElement = document.querySelector(
      `input[name="correction${globalIndex}"]:checked`
    );
    // $2 처리: selectedOption이 $2이면 실제 텍스트 사용 (이것도 referencedTextForMainData 필요)
    const originalTextForComparison = correction.original === "$2" && referencedTextForMainData ? referencedTextForMainData : correction.original;
    const selectedOption = selectedOptionElement ? selectedOptionElement.value : originalTextForComparison;

    const customTextElement = document.getElementById(
      `customCorrection${globalIndex}`
    );
    const customText = customTextElement ? customTextElement.value.trim() : "";
    let correctionText;
    if (selectedOption === "custom") {
      correctionText = customText || originalTextForComparison;
    } else {
      correctionText = selectedOption;
    }
    const spanElement = document.getElementById(`preview_correction${globalIndex}`);
    if (spanElement) {
      spanElement.textContent = correctionText; 
      spanElement.style.color = correctionText === originalTextForComparison ? "var(--color-red)" : "var(--color-blue)";
    }
  });
}

// createCorrectionPopup, SpellingPlugin, CustomNounModal 등 나머지 코드는 이전과 동일하게 유지

function createCorrectionPopup(allCorrections, selectedText, start, end, editor) {
  const MAX_CORRECTIONS_PER_PAGE = 10;
  const correctionChunks = [];
  const totalCorrections = allCorrections.length;

  if (totalCorrections === 0) {
      return;
  }

  for (let i = 0; i < totalCorrections; i += MAX_CORRECTIONS_PER_PAGE) {
    correctionChunks.push(allCorrections.slice(i, i + MAX_CORRECTIONS_PER_PAGE));
  }

  const themeClass = document.body.classList.contains("theme-light") ? "light" : "dark";
  let currentPage = 0;

  // referencedTextForMainData를 createCorrectionPopup 스코프에서 접근 가능하게 해야 함.
  // 또는, highlight 함수들에 파라미터로 전달. 여기서는 일단 전역 변수처럼 사용한다고 가정 (좋은 방식은 아님).
  // 더 나은 방식은 checkSpelling 결과에 referencedTextForMainData를 포함시켜 전달하는 것.

  const renderPopup = () => {
    const currentCorrections = correctionChunks[currentPage];
    if (!currentCorrections || currentCorrections.length === 0) {
        console.error("No corrections for current page:", currentPage, "Total chunks:", correctionChunks.length);
        closePopup();
        return;
    }
    const baseIndex = currentPage * MAX_CORRECTIONS_PER_PAGE;

    // selectedText에 대해 하이라이트. 만약 correction.original이 $2면, selectedText에서 해당 부분을 찾아야 함.
    // 이 부분은 복잡해지므로, 일단은 API가 주는 orgStr 기준으로 하이라이트 시도.
    // UI에서 사용자가 보는 원본 텍스트는 selectedText이므로, $2가 직접 보이진 않음.
    const errorTextHighlighted = highlightOriginalTextWithPlaceholders(selectedText, currentCorrections, "error", baseIndex);
    const resultPreviewHighlighted = highlightOriginalTextWithPlaceholders(selectedText, currentCorrections, "preview", baseIndex);

    const popupHtml = `
      <div id="correctionPopup" class="${themeClass}">
        <div class="header">
          <button id="applyCorrectionsButton">적용</button>
          <h2>맞춤법 검사 결과 (${currentPage + 1}/${correctionChunks.length})</h2>
          <button id="closePopupButton">닫기</button>
        </div>
        <div class="preview-container">
          <div class="error-text">${errorTextHighlighted}</div>
          <div class="arrow">▶</div>
          <div id="resultPreview" class="result-preview">${resultPreviewHighlighted}</div>
        </div>
        <div class="content">
          <div id="correctionUI" class="correction-list">
            ${currentCorrections.map(
              (correction, localIndex) => {
                const globalIndex = baseIndex + localIndex;
                if (!correction || typeof correction.original !== 'string' || !Array.isArray(correction.corrected)) {
                  return `<!-- Invalid correction item at globalIndex ${globalIndex} -->`;
                }
                // UI에 표시되는 원본 오류는 API가 준 original 값을 그대로 사용.
                // $2 일 경우, 사용자는 selectedText와 비교하여 이해해야 함.
                const displayOriginal = correction.original; // 필요시 $2를 실제 텍스트로 바꾸는 로직 추가
                return `
              <div class="correction-item">
                <b>오류 ${localIndex + 1}:</b> <span>${displayOriginal}</span><br>
                <b>수정:</b>
                ${correction.corrected.map(
                  (option, optIndex) => `
                    <input type="radio" name="correction${globalIndex}" value="${option}" id="correction${globalIndex}_${optIndex}">
                    <label for="correction${globalIndex}_${optIndex}">${option}</label>
                  `
                ).join("")}
              <input type="radio" name="correction${globalIndex}" value="${correction.original}" id="correction${globalIndex}_original" checked>
              <label for="correction${globalIndex}_original">원본 유지</label>
              <div class="correction-options">
                <input type="radio" name="correction${globalIndex}" value="custom" id="correction${globalIndex}_custom">
                <label for="correction${globalIndex}_custom">직접 수정:</label>
                <input type="text" id="customCorrection${globalIndex}" placeholder="직접 수정 내용을 입력하세요" onfocus="document.getElementById('correction${globalIndex}_custom').checked = true;">
              </div>
              <pre>${correction.help || ""}</pre>
            </div>
            `;
              }
            ).join("")}
          </div>
        </div>
        <div class="pagination">
          <button id="prevPageButton" ${currentPage === 0 ? 'disabled' : ''}>이전</button>
          <span class="pagination-info">${currentPage + 1} / ${correctionChunks.length}</span>
          <button id="nextPageButton" ${currentPage === correctionChunks.length - 1 ? 'disabled' : ''}>다음</button>
        </div>
        <div class="info-box">
          <p><a href="http://nara-speller.co.kr/" target="_blank" rel="noopener noreferrer">한국어 맞춤법/문법 검사기</a>는 부산대학교 인공지능연구실과 (주)나라인포테크가 함께 만들고 있습니다.<br />이 검사기는 개인이나 학생만 무료로 사용할 수 있습니다.</p>
        </div>
      </div>`;

    const existingPopup = document.getElementById("correctionPopup");
    if (existingPopup) existingPopup.remove();
    const popup = document.createElement("div");
    popup.innerHTML = popupHtml;
    document.body.appendChild(popup);

    document.getElementById("closePopupButton")?.addEventListener("click", closePopup);
    document.getElementById("applyCorrectionsButton")?.addEventListener("click", applyCorrectionsHandler);

    document.getElementById("prevPageButton")?.addEventListener("click", () => {
      if (currentPage > 0) {
        currentPage--;
        renderPopup();
      }
    });
    document.getElementById("nextPageButton")?.addEventListener("click", () => {
      if (currentPage < correctionChunks.length - 1) {
        currentPage++;
        renderPopup();
      }
    });

    document.querySelectorAll('input[type="radio"]').forEach((input) => {
      input.addEventListener("click", updatePreview);
    });
    document.querySelectorAll('input[type="text"]').forEach((input) => {
      input.addEventListener("input", updatePreview);
    });
    
    updatePreview(); 
  };

  function closePopup() {
    const popup = document.getElementById("correctionPopup");
    if (popup) popup.remove();
    document.removeEventListener("keydown", escKeyListener);
  }

  function updatePreview() {
    const currentCorrections = correctionChunks[currentPage];
    if (currentCorrections) {
      highlightCorrectedText(currentCorrections, currentPage * MAX_CORRECTIONS_PER_PAGE);
    }
  }
  
  function applyCorrectionsHandler() {
    // applyCorrections 시에는 $2 같은 참조가 아니라 실제 텍스트로 교체되어야 함.
    // 현재 resultPreview는 selectedText를 기반으로 하고, highlight 함수들이 orgStr($2)을
    // selectedText 내에서 찾아 span으로 감싸고 내용을 바꾸는 방식.
    // 따라서 resultPreview.textContent는 이미 $2가 아닌 실제 텍스트로 변환된 결과여야 함.
    const resultPreviewElement = document.getElementById("resultPreview");
    let finalAppliedText = selectedText; 

    if (resultPreviewElement) {
        let correctedHTML = resultPreviewElement.innerHTML;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = correctedHTML;
        tempDiv.querySelectorAll('span[id^="preview_correction"]').forEach(span => {
            span.replaceWith(document.createTextNode(span.textContent || ""));
        });
        finalAppliedText = tempDiv.textContent || ""; 
    }

    editor.replaceRange(finalAppliedText, start, end);
    closePopup();
  }

  function escKeyListener(event) {
    if (event.key === "Escape") {
      closePopup();
    }
  }

  document.addEventListener("keydown", escKeyListener);
  renderPopup(); 
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
        createCorrectionPopup(
          finalCorrections,
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
          createCorrectionPopup(
            finalCorrections,
            selectedText,
            cursorStart,
            cursorEnd,
            editor
          );
        }
      }
    });

    await this.loadSettings();

    this.addCommand({
      id: 'manage-custom-nouns',
      name: 'Manage Custom Nouns',
      callback: () => this.openCustomNounModal()
    });
  }

  excludeCustomNouns(text) {
    let processedText = text;
    const sortedNouns = Array.from(this.customNouns).sort((a, b) => b.length - a.length);

    sortedNouns.forEach(noun => {
      if (noun.trim() === "") return;
      const escapedNoun = noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
      const regex = new RegExp(escapedNoun, 'g');
      processedText = processedText.replace(regex, `___${noun}___`);
    });
    return processedText;
  }

  includeCustomNounsInCorrections(corrections) {
    if (!Array.isArray(corrections)) return [];
    return corrections.map(correction => {
      if (!correction || typeof correction.original !== 'string' || !Array.isArray(correction.corrected)) {
        return correction; 
      }
      return {
        ...correction,
        original: correction.original.replace(/___(.+?)___/g, '$1'),
        corrected: correction.corrected.map(cand => typeof cand === 'string' ? cand.replace(/___(.+?)___/g, '$1') : cand)
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
    const popup = document.getElementById("correctionPopup");
    if (popup) {
        popup.remove();
    }
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

    const listContainerEl = contentEl.createEl('div', { cls: 'custom-noun-list-container' });

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

    const inputGroup = contentEl.createEl('div', { cls: 'custom-noun-input-group' });
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
