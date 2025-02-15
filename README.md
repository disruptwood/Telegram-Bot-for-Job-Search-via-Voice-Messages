# Telegram Bot for Job Search via Voice Messages

## Overview
This project is a Google Apps Script-based Telegram bot that allows users to send voice messages to describe job vacancies or submit resumes. The bot processes these messages using Whisper for transcription and stores the data in Google Sheets. It also matches job vacancies with potential candidates using GPT-4-32k.

## Features
- Users can send voice messages to submit resumes or describe job vacancies.
- Voice messages are transcribed using `sendToWhisper()`.
- Transcriptions are saved to Google Sheets (`Resumes` or `Vacancies`).
- If a vacancy is submitted, the bot finds matching candidates using `FindMatches()`.
- The bot prints the best candidate matches using `printMatches()`.
- Users can register automatically if they are new.
- A simple inline keyboard menu for easy navigation.

## Project Structure
- **Google Sheets**: Stores resumes and vacancies.
- **Google Apps Script**: Manages bot logic and data processing.
- **Telegram Bot API**: Handles user interactions.
- **Whisper API**: Converts voice messages to text.
- **GPT-4-32k**: Matches vacancies to candidates.

## Dependencies
- `TGbot` library for handling Telegram bot API.
- Google Sheets API for storing and retrieving resumes and vacancies.
- OpenAI's GPT-4-32k API for candidate matching.
- Whisper API for voice transcription.

## Google Sheets Structure
- **Resumes Sheet** (`Resumes`):
  - Column A: `chatId`
  - Column B: `Resume Text`
  - Column C: `Timestamp`

- **Vacancies Sheet** (`Vacancies`):
  - Column A: `chatId`
  - Column B: `Vacancy Text`
  - Column C: `Vacancy Counter`
  - Column D: `Timestamp`

- **Submissions Sheet** (`Submissions`):
  - Logs all submissions for tracking.

## Usage
### 1. Start the Bot
Send `/start` to the bot. The bot will present a menu with options:
- `📄 Отправить резюме` (Send Resume)
- `📝 Описать вакансию` (Describe Vacancy)
- `Удалить резюме/вакансию` (Delete Resume/Vacancy)

### 2. Send a Voice Message
- Choose an option from the menu.
- Send a voice message (max 5 minutes).
- The bot transcribes and saves it to the appropriate Google Sheet.
- If it’s a vacancy, the bot finds and lists matching candidates.

### 3. Receive Matches
If a vacancy is submitted, the bot uses `FindMatches()` to find relevant candidates and displays them using `printMatches()`.

## Key Functions
- `sendMenu(chatId)`: Displays the main menu.
- `handleCallbackQuery(contents)`: Handles menu selections.
- `sendToWhisper(blob, chatId)`: Transcribes voice messages.
- `FindMatches(vacancyText, userId)`: Matches vacancies to candidates.
- `printMatches(matchList)`: Formats and prints matching candidates.
- `registerUserIfNeeded(chatId)`: Ensures users are registered.
- `appendTranscript(chatId, sheetName, appendType, transcriptionText)`: Saves transcriptions to Google Sheets.
- `doPost(e)`: Main entry point for handling Telegram bot requests.

## Deployment
1. Create a Google Apps Script project.
2. Deploy as a Web App with `Anyone` access.
3. Connect the bot to Telegram using `TGbot` library.
4. Set up `doPost(e)` as the webhook URL.
5. Ensure Google Sheets permissions allow reading/writing.

## Notes
- The bot is designed for structured voice-based job applications.
- Ensure API keys and sensitive data are kept secure.
- Maintain Google Sheets to prevent excessive data buildup.

## Future Improvements
- Implement user authentication.
- Enhance vacancy-candidate matching with more AI features.
- Vector database for better search.

---
**Author**: [Ilya Vladimirskiy]  
**License**: MIT  
**Version**: 1.2

