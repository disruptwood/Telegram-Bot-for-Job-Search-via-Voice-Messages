// ===== 1. Config =====
const BOT_TOKEN = "";
const WEBAPP_URL = "";
const OPENAI_API_KEY="";
const OPENAI_WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";
const DAILY_VOICE_LIMIT = 3;
const MAX_VOICE_DURATION = 300;
const SHEET_ID = "";
const SUBMISSIONS_SHEET_NAME = "Submissions";
const RESUME_SHEET_NAME = "Resumes";
const VACANCY_SHEET_NAME = "Vacancies";
const ALLOWED_USERS = [...];


const Bot = TGbot.bot({
  botToken: BOT_TOKEN,
  webAppUrl: WEBAPP_URL,
  logRequest: true,   // можно true, если хотите логировать запросы
  parseMode: "HTML"    // по умолчанию "HTML"
});

// Функция для установки Webhook
function setWebhook(){
  Bot.setWebhook({
    url: WEBAPP_URL,
    drop_pending_updates: true
  });
}

function doPost(e) {
  if (!e?.postData?.contents) return ContentService.createTextOutput("ok");
  
  const contents = JSON.parse(e.postData.contents);

  if (contents.callback_query) {
    handleCallbackQuery(contents);
  }

  if (contents.message) {
    const msg = contents.message;
    const chatId = msg.chat.id;

    if (msg.voice) {
      const duration = msg.voice.duration || 0;
      if (duration > MAX_VOICE_DURATION) {
        Bot.sendMessage({
          chat_id: chatId,
          text:
            "⏳ Слишком длинное аудио! Разрешено максимум 5 минут, а у вас " +
            (duration / 60).toFixed(1) +
            " мин."
        });
        return;
      }

      Bot.sendMessage({ chat_id: chatId, text: "🎙 Голосовое получено, обрабатываю..." });
      const fileId = msg.voice.file_id;
      const fileObj = Bot.getFile(fileId);
      const response = UrlFetchApp.fetch(fileObj, { muteHttpExceptions: true });
      if (response.getResponseCode() !== 200) {
        Bot.sendMessage({ chat_id: chatId, text: "❌ Ошибка загрузки файла." });
        return;
      }

      const voiceBlob = response.getBlob().setName("voice.ogg");
      const transcriptionText = sendToWhisper(voiceBlob, chatId);
      Logger.log("📝 Распознанный текст: " + transcriptionText);

      const sessionType = PropertiesService.getScriptProperties().getProperty("SESSION_TYPE_" + chatId);
      SESSION_TYPE[chatId] = sessionType;
      Logger.log("🔄 Загруженный SESSION_TYPE: " + sessionType);

      if (transcriptionText) {
        registerUserIfNeeded(chatId);

        if (sessionType === "resume") {
          appendTranscript(chatId, RESUME_SHEET_NAME, "resume", transcriptionText);
          notifyCandidateSaved(chatId);
        } else if (sessionType === "vacancy") {
          appendTranscript(chatId, VACANCY_SHEET_NAME, "vacancy", transcriptionText);
          Utilities.sleep(300);
          const matchList = FindMatches(transcriptionText, chatId);
          Utilities.sleep(300);
          const matchMsg = printMatches(matchList);
          Bot.sendMessage({ chat_id: chatId, text: matchMsg });
          sendFollowUpMenu(chatId);
        } else {
          Bot.sendMessage({
            chat_id: chatId,
            text:
              "⚠️ Ошибка: не определено, куда сохранить текст (резюме или вакансия)."
          });
        }
      } else {
        Bot.sendMessage({ chat_id: chatId, text: "❌ Ошибка расшифровки аудио." });
      }
    } else if (msg.text) {
      const text = msg.text.toLowerCase();
      if (text === "/start") {
        SESSION_TYPE[chatId] = null;
        PropertiesService.getScriptProperties().deleteProperty("SESSION_TYPE_" + chatId);
        sendMenu(chatId);
      } else if (text === "/help") {
        Bot.sendMessage({
          chat_id: chatId,
          text:
            "❓ Помощь:\n\nВыберите действие из меню для отправки резюме или описания вакансии."
        });
      } else if (text === "/about") {
        Bot.sendMessage({
          chat_id: chatId,
          text:
            "ℹ️ О боте:\n\nЭтот бот ищет кандидатов и вакансии через голосовые сообщения."
        });
      } else {
        Bot.sendMessage({
          chat_id: chatId,
          text: "🤖 Неизвестная команда. Введите /help для справки."
        });
      }
    }
  }
  //return ContentService.createTextOutput("ok");
}

/*************************************************************************************** 
 * BOT MENUE
*/
const SESSION_TYPE = {}; // Глобальный объект для хранения статуса пользователя

/*** Главное меню с кнопками***/
function sendMenu(chatId) {
  Bot.sendMessage({
    chat_id: chatId,
    text: "🎙 Это бот для поиска кандидатов или работы через голосовые сообщения.\nВыберите действие:",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📄 Отправить резюме", callback_data: "send_resume" },
          { text: "📝 Описать вакансию", callback_data: "describe_vacancy" },
          { text: "Удалить резюме/вакансию", callback_data: "delete_smth"}
        ]
      ]
    }
  });
}

/*** Обрабатывает callback-кнопки из меню***/
function handleCallbackQuery(contents) {
  if (contents.callback_query) {
    const cq = contents.callback_query;
    const data = cq.data; 
    const chatId = cq.message.chat.id;

    if (data === "send_resume") {
      SESSION_TYPE[chatId] = "resume";
      PropertiesService.getScriptProperties().setProperty(`SESSION_TYPE_${chatId}`, "resume");

      Bot.sendMessage({
        chat_id: chatId,
        text: `🎙 Запишите голосовое с вашим резюме (строго не более 5 минут). Последнее резюме будет перезаписано.`
      });

    } else if (data === "describe_vacancy") {
      SESSION_TYPE[chatId] = "vacancy";
      PropertiesService.getScriptProperties().setProperty(`SESSION_TYPE_${chatId}`, "vacancy");

      Bot.sendMessage({
        chat_id: chatId,
        text: `📝 Запишите голосовое с описанием вакансии (строго не более 5 минут). Вы можете отправить несколько вакансий`
      });
    }
  }
}

/**
 * Отправляет меню после сохранения данных
 */
function sendFollowUpMenu(chatId) {
  Bot.sendMessage({
    chat_id: chatId,
    text: "🔄 Что вы хотите сделать дальше?",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📄 Отправить резюме", callback_data: "send_resume" },
          { text: "📝 Добавить вакансию", callback_data: "describe_vacancy" }
        ]
      ]
    }
  });
}

/**
 * Сообщает пользователю, что резюме сохранено
 */
function notifyCandidateSaved(chatId) {
  Bot.sendMessage({
    chat_id: chatId,
    text: "✅ Ваше резюме сохранено!"
  });

  sendFollowUpMenu(chatId);
}

/**
 * Сообщает пользователю, что вакансия сохранена и сколько их уже в системе
 */
function notifyVacancySaved(chatId, vacancyCount) {
  Bot.sendMessage({
    chat_id: chatId,
    text: `✅ Ваша вакансия добавлена! Сейчас в обработке у вас ${vacancyCount} вакансий.`
  });

  sendFollowUpMenu(chatId);
}

/**************************************************************************
 * Тестовые функции для проверки основных функций
 * Функции для тестирования:
 *   1. FindMatches
 *   2. printMatches
 *   3. registerUserIfNeeded
 *   4. updateResume
 *   5. appendTranscript
 *
 * Перед запуском убедитесь, что константа SHEET_ID указывает на нужную Google таблицу,
 * а также что листы "Users", SUBMISSIONS_SHEET_NAME (например, "Submissions") и "Resume"
 * существуют (если их нет – тестовые функции создадут их или очистят).
 *
 **************************************************************************/

/**
 * Тестовая функция для FindMatches.
 * Принимает тестовый текст вакансии и тестовый userId, вызывает FindMatches и выводит результат.
 */
function TestFindMatches() {
  var vacancyText = "Вакансия: Требуется программист";
  var testUserId = "99999"; // тестовый userId
  // Вызов функции FindMatches (callGPT должна быть реализована отдельно)
  var matches = FindMatches(vacancyText, testUserId);
  Logger.log("TestFindMatches: Найденные совпадения: " + JSON.stringify(matches));
}


/**
 * Тестовая функция для printMatches.
 * Функция заполняет листы "Resume" и "Users" тестовыми данными, затем вызывает printMatches с тестовым массивом.
 */
function TestPrintMatches() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  
  var testMatchList = ["12345", "67890", "11111"];
  var result = printMatches(testMatchList);
  Logger.log("TestPrintMatches: Результат:\n" + result);
}



/**
 * Тестовая функция для appendTranscript.
 *
 * Проверяет:
 * 1. Резюме: добавление первого транскрипта, затем попытка обновления (дубликаты исключены).
 * 2. Вакансии: два вызова — оба должны добавляться как отдельные строки.
 * 3. Выводит итоговое состояние таблицы для testChatId.
 */
function TestAppendTranscript() {
    const testChatId = "22222";
    const testChatId2 = "55555";
    const ss = SpreadsheetApp.openById(SHEET_ID);
    
    // Очищаем тестовые данные перед запуском (если требуется)
    // clearTestData(ss, testChatId);
    // clearTestData(ss, testChatId2);

    Logger.log("=== Начало тестирования appendTranscript ===");

    // Тест 1: Резюме
    Logger.log("Добавляем резюме...");
    appendTranscript(testChatId, RESUME_SHEET_NAME, "resume", "Первое резюме");
    appendTranscript(testChatId, RESUME_SHEET_NAME, "resume", "Обновленное резюме"); // Должно обновить первую запись
    appendTranscript(testChatId, RESUME_SHEET_NAME, "resume", ""); // Должно удалить резюме
    appendTranscript(testChatId, RESUME_SHEET_NAME, "resume", "Новое резюме после удаления"); // Должно создать новую запись

    // Тест 2: Вакансии (разный порядок)
    Logger.log("Добавляем вакансии...");
    appendTranscript(testChatId, VACANCY_SHEET_NAME, "vacancy", "Вакансия 1 для 22222");
    appendTranscript(testChatId2, VACANCY_SHEET_NAME, "vacancy", "Вакансия 1 для 55555");
    appendTranscript(testChatId, VACANCY_SHEET_NAME, "vacancy", "Вакансия 2 для 22222"); // Должно идти после первой
    appendTranscript(testChatId2, VACANCY_SHEET_NAME, "vacancy", "Вакансия 2 для 55555");
    appendTranscript(testChatId, VACANCY_SHEET_NAME, "vacancy", "Вакансия 3 для 22222"); // Должно вставляться после второй

    Logger.log("TestAppendTranscript: Вакансии добавлены для " + testChatId + " и " + testChatId2);

    // Вывод итогового состояния
    logSheetData(ss, RESUME_SHEET_NAME, testChatId, "Резюме");
    logSheetData(ss, VACANCY_SHEET_NAME, testChatId, "Вакансии");
    logSheetData(ss, VACANCY_SHEET_NAME, testChatId2, "Вакансии для второго пользователя");

    Logger.log("=== Тестирование завершено ===");
}

/**
 * Очищает тестовые данные для testChatId в таблицах "Resumes" и "Vacancies".
 * 
 * @param {Spreadsheet} ss - Открытая таблица.
 * @param {string} chatId - Тестовый идентификатор пользователя.
 */
function clearTestData(ss, chatId) {
  const sheets = [RESUME_SHEET_NAME, VACANCY_SHEET_NAME];
  
  sheets.forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    
    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i > 0; i--) {
      if (String(data[i][0]) === String(chatId)) {
        sheet.deleteRow(i + 1); // Удаляем строки, содержащие testChatId
      }
    }
  });

  Logger.log(`TestAppendTranscript: Тестовые данные для chatId=${chatId} удалены.`);
}

/**
 * Выводит в лог все записи из указанного листа для testChatId.
 *
 * @param {Spreadsheet} ss - Открытая таблица.
 * @param {string} sheetName - Название листа.
 * @param {string} chatId - Идентификатор пользователя.
 * @param {string} entity - Название тестируемой сущности (например, "Резюме" или "Вакансии").
 */
function logSheetData(ss, sheetName, chatId, entity) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return;
  
  const data = sheet.getDataRange().getValues();
  Logger.log(`=== ${entity} для chatId=${chatId} ===`);
  
  data.forEach(row => {
    if (String(row[0]) === String(chatId)) {
      Logger.log(JSON.stringify(row));
    }
  });
}


/////////
/**
 * Функция callGPT(prompt)
 * Отправляет запрос к OpenAI API для модели GPT‑4o с заданным промтом.
 * Использует UrlFetchApp для выполнения POST‑запроса и возвращает текст ответа (без лишних пробелов).
 *
 * Дополнительно:
 * - Логирует запрос и ответ.
 * - Обрабатывает возможные ошибки API (логирование в случае ошибки).
 * - Возвращает пустую строку при неудачном запросе.
 *
 * @param {string} prompt – Текст запроса для GPT.
 * @return {string} – Ответ GPT (текст), или пустая строка в случае ошибки.
 */
function callGPT(prompt) {
  try {
    const url = "https://api.openai.com/v1/chat/completions";
    const payload = {
      model: "gpt-4o",            // Updated to GPT-4o
      messages: [{ role: "user", content: prompt }],
      temperature: 1,             // Maximum creativity, allows diverse candidate selection
      max_tokens: 600,            // Ensures full understanding of resumes, but short response
      top_p: 1,                   // No restrictions on token probability
      frequency_penalty: 0,       // No penalty for repeating user IDs
      presence_penalty: 0         // No penalty for including valid IDs
    };
    const options = {
      method: "post",
      contentType: "application/json",
      headers: { "Authorization": "Bearer " + OPENAI_API_KEY },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    Logger.log("GPT Request: " + JSON.stringify(payload));

    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();

    if (responseCode >= 200 && responseCode < 300) {
      const json = JSON.parse(response.getContentText());
      const gptResponse = json.choices[0].message.content.trim();
      
      Logger.log("GPT Response: " + gptResponse);
      return gptResponse;
    } else {
      Logger.log("GPT API Error: " + responseCode + " - " + response.getContentText());
      return "";
    }
  } catch (error) {
    Logger.log("callGPT Exception: " + error.toString());
    return "";
  }
}


/**
 * Функция TestCallGPT()
 * Проверяет работу callGPT() с тестовым запросом и логирует ответ.
 */
function TestCallGPT() {
  const testPrompt = "Привет, как тебя зовут?";
 // Logger.log("Testing callGPT with prompt: " + testPrompt);
  
  const response = callGPT(testPrompt);
  
  //Logger.log("TestCallGPT Response: " + response);
}



/**
 * Функция appendTranscript(chatId, sheetName, appendType, transcriptionText)
 * Добавляет транскрипцию голосового сообщения в указанный лист Google Sheets.
 * 
 * - Если appendType равен "resume", то для данного пользователя может быть только одна запись:
 *   - Если запись уже существует, она обновляется (текст в колонке B, дата в колонке D).
 *   - Если записи нет, создаётся новая строка.
 * 
 * - Если appendType равен "vacancy":
 *   - Создаётся новая запись (колонки A, B, D).
 *   - В первой строке с этим chatId увеличивается счетчик вакансий (колонка C) на 1.
 *
 * @param {string|number} chatId – Идентификатор пользователя.
 * @param {string} sheetName – Название листа в Google Sheets, куда добавляется запись.
 * @param {string} appendType – Тип записи: "resume" или "vacancy".
 * @param {string} transcriptionText – Текст транскрипции для сохранения.
 */
function appendTranscript(chatId, sheetName, appendType, transcriptionText) {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(sheetName);
    if (!sheet) {
        throw new Error(`Лист "${sheetName}" не найден.`);
    }

    const data = sheet.getDataRange().getValues();
    let firstRowIndex = -1;
    let lastRowIndex = -1;
    let vacancyCount = 0;

    // Scan for the user's first and last row indices
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(chatId)) {
            if (firstRowIndex === -1) {
                firstRowIndex = i + 1; // First row where this chatId appears
            }
            lastRowIndex = i + 1; // Last row where this chatId appears
            
            // Read the latest Vacancy Num from column C (only from the first row)
            if (i + 1 === firstRowIndex && data[i][2] !== "" && !isNaN(data[i][2])) {
                vacancyCount = Number(data[i][2]);
            }
        }
    }

    if (appendType === "resume") {
          if (transcriptionText.trim() === "") {
          // If text is empty, delete the resume row
          if (firstRowIndex !== -1) {
            sheet.deleteRow(firstRowIndex);
            SpreadsheetApp.flush();
            Utilities.sleep(300);
          }
          return;
          }
        if (firstRowIndex !== -1) {
            // Update existing resume (column B) and last updated date (column C)
            Utilities.sleep(300);
            sheet.getRange(firstRowIndex, 2).setValue(transcriptionText);
            sheet.getRange(firstRowIndex, 3).setValue(new Date());
        } else {
            Utilities.sleep(300);
            // If no resume exists, create a new row
            sheet.appendRow([chatId, transcriptionText, new Date()]);
        }
    } else if (appendType === "vacancy") {
      // Fetch current data.
      const data = sheet.getDataRange().getValues();
      let firstRowIndex = null;
      let lastRowIndex = null;
      let count = 0;
      
      // Assuming row 1 is a header.
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(chatId)) {
          if (firstRowIndex === null) firstRowIndex = i + 1;
          lastRowIndex = i + 1;
          count++;
        }
      }
      
      if (count === 0) {
        // No vacancy for this chatId; append to bottom.
        sheet.appendRow([chatId, transcriptionText, 1, new Date()]);
        SpreadsheetApp.flush();
        Utilities.sleep(300);
      } else {
        // Calculate new vacancy count.
        const newCount = count + 1;
        // Update only the first row of this chatId with the new count.
        sheet.getRange(firstRowIndex, 3).setValue(newCount);
        SpreadsheetApp.flush();
        Utilities.sleep(300);
        
        // Insert a row right after the last row for this chatId.
        sheet.insertRowAfter(lastRowIndex);
        SpreadsheetApp.flush();
        Utilities.sleep(300);
        
        // Populate the new row: leave the Vacancy Num blank.
        sheet.getRange(lastRowIndex + 1, 1, 1, 4).setValues([[chatId, transcriptionText, "", new Date()]]);
        SpreadsheetApp.flush();
        Utilities.sleep(300);
      }
    }

}


/**
 * Функция registerUserIfNeeded(chatId)
 * 
 * Проверяет, зарегистрирован ли пользователь в таблицах "Vacancies" и "Resumes".
 * Если идентификатор отсутствует в одной из таблиц, добавляет его в последнюю пустую строку.
 * 
 * - В "Vacancies": записывает chatId в первый столбец, 0 в третий.
 * - В "Resumes": записывает chatId в первый столбец без 0 в третьем столбце.
 *
 * @param {string|number} chatId – Идентификатор пользователя.
 */
function registerUserIfNeeded(chatId) {
  const spreadsheet = SpreadsheetApp.openById(SHEET_ID);
  
  // Обновление таблицы "Vacancies"
  registerInSheet(spreadsheet, "Vacancies", chatId, true);
  
  // Обновление таблицы "Resumes"
  registerInSheet(spreadsheet, "Resumes", chatId, false);
}

/**
 * Функция registerInSheet(sheet, sheetName, chatId, isVacancy)
 * 
 * Проверяет, есть ли chatId в указанном листе. Если нет, добавляет его в новую строку.
 *
 * @param {Spreadsheet} spreadsheet – Открытая таблица Google Sheets.
 * @param {string} sheetName – Название листа ("Vacancies" или "Resumes").
 * @param {string|number} chatId – Идентификатор пользователя.
 * @param {boolean} isVacancy – Флаг, указывающий, что это таблица "Vacancies".
 */
function registerInSheet(spreadsheet, sheetName, chatId, isVacancy) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  
  if (!sheet) {
    throw new Error(`Лист "${sheetName}" не найден. Проверьте, существует ли он в таблице.`);
  }

  const data = sheet.getDataRange().getValues();
  let found = false;

  // Проверяем, есть ли уже этот chatId в первом столбце
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(chatId)) {
      found = true;
      break;
    }
  }

  // Если пользователя нет в таблице, добавляем его в новую строку
  if (!found) {
    const newRow = isVacancy ? [chatId, "", 0] : [chatId, ""];
    sheet.appendRow(newRow);
  }
}


/**
 * Функция showResume(chatId)
 * 
 * Осуществляет поиск резюме пользователя в таблице RESUME_SHEET_NAME по его chatId.
 * 
 * Логика:
 * - Выполняет прямой поиск userId в таблице с помощью TextFinder.
 * - Если запись найдена, отправляет текст резюме пользователю.
 * - Если резюме отсутствует, отправляет уведомление.
 * 
 * @param {string|number} chatId – Идентификатор пользователя Telegram.
 */
function showResume(chatId) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(RESUME_SHEET_NAME);
  if (!sheet) {
    Logger.log("Ошибка: Лист '" + RESUME_SHEET_NAME + "' не найден.");
    Bot.sendMessage({ chat_id: chatId, text: "Ошибка: Лист с резюме не найден." });
    return;
  }

  // Прямой поиск userId в первой колонке
  const finder = sheet.createTextFinder(String(chatId));
  const cell = finder.findNext();

  if (cell && cell.getColumn() === 1) {
    const resumeText = sheet.getRange(cell.getRow(), 2).getValue();
    if (resumeText) {
      Bot.sendMessage({ chat_id: chatId, text: "Ваше резюме:\n" + resumeText });
    } else {
      Bot.sendMessage({ chat_id: chatId, text: "Ваше резюме пока пустое." });
    }
  } else {
    Bot.sendMessage({ chat_id: chatId, text: "У вас пока нет сохранённого резюме." });
  }
}


/**
 * Функция FindMatches(vacancyText, userId)
 * Принимает текст вакансии и идентификатор пользователя, затем формирует запрос для GPT‑4‑32k,
 * который должен выбрать не более 5 наиболее подходящих кандидатов. В ответ GPT должен вернуть
 * строку в формате: "$userId1, userId2, ...$" или "$$" в случае отсутствия подходящих кандидатов.
 * Если ответ не соответствует формату, функция делает повторную попытку (всего 2 попытки).
 * После получения валидного ответа функция парсит строку и возвращает массив подходящих userId,
 * либо пустой массив, если кандидаты не найдены.
 *
 * Дополнительно:
 * - Перед формированием основного запроса, функция загружает все существующие резюме из Google Sheets.
 *   Каждая запись содержит chatId и текст резюме. Эти данные добавляются в промт.
 * - Функция выводит в лог сформированный промт и полученный ответ от GPT.
 * - Добавлены задержки (Utilities.sleep), чтобы обеспечить корректное обновление данных.
 *
 * @param {string} vacancyText – Текст вакансии.
 * @param {string|number} userId – Идентификатор пользователя (для формирования запроса, если необходимо).
 * @return {Array} – Массив найденных userId или пустой массив.
 */
function FindMatches(vacancyText, userId) {
  var attempt = 0;
  var maxAttempts = 2;
  var gptResponse = "";
  
  // Загружаем данные резюме из листа Google Sheets.
  // Предполагается, что резюме хранятся в листе с именем "Resumes" (можно изменить имя при необходимости).
  var resumeSheetName = "Resumes";
  var resumeSheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(resumeSheetName);
  var resumeData = resumeSheet.getDataRange().getValues();
  var resumeList = "Список резюме:\n";
  // Пропускаем первую строку, если она является заголовком.
  for (var i = 1; i < resumeData.length; i++) {
    var rChatId = resumeData[i][0];
    var rText = resumeData[i][1];
    if (rChatId && rText) {
      resumeList += "ChatId " + rChatId + ": " + rText + "\n";
    }
  }
  
  while (attempt < maxAttempts) {
    var prompt = 'Выбери не более 5 человек наиболее подходящего для следующего запроса: "' + vacancyText + '". ' +
                 'Используй следующий список резюме для анализа кандидатов:\n' + resumeList + "\n" +
                 'Очень важно, чтобы ты отправил только их userId через запятую и все в формате: $userId1, userId2, ...$ ' +
                 'Ты можешь выбрать меньше чем 5 людей. Если подходящих нет, отправь просто $$ ' +
                 'и не добавляй ничего лишнего в ответ.';
    
    //Logger.log("GPT prompt: " + prompt);
    
    gptResponse = callGPT(prompt).trim();
    
    //Logger.log("GPT response: " + gptResponse);
    
    Utilities.sleep(300);
    
    if (gptResponse === "$$") {
      return [];
    }

    if (gptResponse.startsWith("$") && gptResponse.endsWith("$")) {
      var content = gptResponse.substring(1, gptResponse.length - 1).trim();
      if (content === "") return [];
      
      // Correct parsing: Split by "," and trim each ID
      var ids = content.split(",").map(id => id.trim());
      
      // Ensure valid numeric IDs (if needed)
      var result = ids.filter(id => id.match(/^\d+$/));

      return result;
    }

    attempt++;
  }
  return [];
}


/**
 * Функция printMatches(matchList)
 * Принимает массив userId, для каждого:
 * - Выполняет прямой поиск записи резюме в листе, заданном константой RESUME_SHEET_NAME, по userId и извлекает соответствующий текст.
 * - Пытается получить username через Telegram API (с использованием данных бота) для данного userId.
 * Затем формирует сообщение в формате:
 *
 * "Эти пользователи наиболее подходят для вашей вакансии:
 *  @<username>, <резюме>
 *  <userId> (у этого пользователя нет юзернейма), <резюме>
 *  ..."
 *
 * Если резюме для пользователя не найдено, кандидат не выводится.
 * Если ни одного кандидата не найдено, возвращается уведомление.
 *
 * @param {Array} matchList – Массив идентификаторов пользователей (без символа "@").
 * @return {string} – Отформатированное сообщение со списком кандидатов.
 */
function printMatches(matchList) {
  let resultStr = "Эти пользователи наиболее подходят для вашей вакансии:\n";
  
  const spreadsheet = SpreadsheetApp.openById(SHEET_ID);
  const resumeSheet = spreadsheet.getSheetByName(RESUME_SHEET_NAME);
  
  if (!resumeSheet) {
    Logger.log("Ошибка: Лист " + RESUME_SHEET_NAME + " не найден.");
    return "Ошибка: Лист " + RESUME_SHEET_NAME + " отсутствует.";
  }
  
  // Для каждого userId из matchList
  for (let i = 0; i < matchList.length; i++) {
    const userId = String(matchList[i]);
    
    // Поиск резюме в листе "Резюме" по userId (ищем в колонке 1, резюме в колонке 2)
    let resumeText = "";
    let resumeFinder = resumeSheet.createTextFinder(userId);
    let resumeCell = resumeFinder.findNext();
    if (resumeCell && resumeCell.getColumn() === 1) {
      resumeText = resumeSheet.getRange(resumeCell.getRow(), 2).getValue();
    }
    
    // Если резюме не найдено, пропускаем данного кандидата
    if (!resumeText) continue;
    
    // Получаем username через Telegram API, а не через данные таблицы.
    let username = getTelegramUsername(userId);
    
    const displayName = username ? `@${username}` : `${userId} (у этого пользователя нет юзернейма)`;
    resultStr += `${displayName}, ${resumeText}\n`;
  }
  
  if (resultStr === "Эти пользователи наиболее подходят для вашей вакансии:\n") {
    resultStr += "Ни один кандидат не найден.";
  }
  
  return resultStr;
}

/**
 * Функция getTelegramUsername(userId)
 * Пытается получить username пользователя через Telegram API с использованием данных бота.
 * Если username не найден или происходит ошибка, возвращает пустую строку.
 *
 * @param {string|number} userId – Идентификатор пользователя Telegram.
 * @return {string} – username пользователя или пустая строка.
 */
function getTelegramUsername(userId) {
  try {
    const url = "https://api.telegram.org/bot" + BOT_TOKEN + "/getChat?chat_id=" + userId;
    const response = UrlFetchApp.fetch(url);
    const json = JSON.parse(response.getContentText());
    if (json.ok && json.result && json.result.username) {
      return json.result.username;
    }
  } catch (e) {
    Logger.log("Ошибка получения username для userId " + userId + ": " + e.toString());
  }
  return "";
}

function sendToWhisper(blob, chatId) {
  Bot.sendMessage({
    chat_id: chatId,
    text: "⏳ Отправляю аудио на расшифровку..."
  });

  try {
    const formData = {
      "model": "whisper-1",
      "file": blob
    };

    const options = {
      method: "post",
      muteHttpExceptions: true,
      payload: formData,
      headers: { "Authorization": "Bearer " + OPENAI_API_KEY }
    };

    const response = UrlFetchApp.fetch(OPENAI_WHISPER_URL, options);
    const code = response.getResponseCode();
    const respText = response.getContentText();

    if (code >= 200 && code < 300) {
      const json = JSON.parse(respText);
      const resultText = json.text || "";

      // Бот просто отправляет распознанный текст пользователю
      Bot.sendMessage({
        chat_id: chatId,
        text: `✅ Аудио успешно распознано.\n\n📄 Распознанный текст:\n${resultText}`
      });

      return resultText; // Возвращаем текст без дальнейшей обработки

    } else {
      Bot.sendMessage({ chat_id: chatId, text: "❌ Ошибка распознавания: " + respText });
      return null;
    }

  } catch (err) {
    Bot.sendMessage({ chat_id: chatId, text: "❌ Ошибка при отправке на распознавание: " + err });
    return null;
  }
}


