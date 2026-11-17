# Start here

## First launch

1. Double-click **Keyword Deck** on the desktop.
2. If there is no shortcut, run once:

```powershell
cd "C:\Users\User\Documents\ChatGPT\KeywordDeck"
powershell -ExecutionPolicy Bypass -File ".\scripts\install-shortcut.ps1"
```

3. Enter keywords separated by commas, for example:

```text
cold brew coffee, coffee subscription
```

4. Press **Search**.
5. Use **High relevance** for the strongest matches or **All posts** for the wider index.
6. `Space` next, `O` open, `S` save, `X` hide, `R` shuffle.

## Make it easier to read

- **A− / A+** changes real font size from 100% to 130%.
- **Focus** hides the sidebar and hero.
- **Trace** shows every query the app ran.

## Optional Apify detail

The free path needs no accounts. If you want likes, comments, views and exact timestamps, add an Apify token in **Settings** and turn on **Apify deep read**. Keyword Deck caps the charge per run.

## Manual lanes

The row under the search bar opens a keyword search in your logged-in browser for Reddit, Facebook, Threads and LinkedIn. Keyword Deck does not read those pages or use your accounts.

## If something looks wrong

- **No results:** try broader keywords or the 7-day window.
- **No images:** public preview is unavailable for that post; the typographic fallback is intentional.
- **Server offline:** run `npm start` in this folder.
- **Port already in use:** another copy is probably running at `http://127.0.0.1:4318`.


