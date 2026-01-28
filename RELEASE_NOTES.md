# Release Notes (cumulative)

## v6.17.8 (2026-01-28)
- Aggiornato il numero di versione visibile nell'app e nei tool di supporto.
- Archiviato il file di specifica completata e ripristinato il template vuoto.

## v6.17.7 (2026-01-22)
- **Fix**: aggiunta intestazione con versione in `specs/README.md`.
- **Behavior**: nessuna modifica funzionale.
- **Limitazioni**: nessuna nuova limitazione.

## v6.17.6 (2026-01-22)
- **Fix**: aggiunti `data-testid` ai pulsanti e alle aree di stato/log per facilitare i test automatici.
- **Behavior**: nessuna modifica funzionale.
- **Limitazioni**: nessuna nuova limitazione.

## v6.17.5 (2026-01-22)
Fix/Behavior/Limitazione: aggiunta pagina Debug con strumenti test e cache spostati fuori dalle pagine normali, voce Debug visibile solo con Debug attivo e ritorno automatico a Visita quando disattivato; gli strumenti debug restano disponibili solo con toggle ON.

## v6.17.4 (2026-01-22) — Fix CSP / handler click + logging
- **Fix**: aggiunto fallback CSP-safe per i pulsanti (binding eventi via `addEventListener`) per evitare casi in cui alcuni `onclick` inline vengano ignorati.
- **Debug**: se un handler genera eccezione, viene loggato in `ADA.log` e mostrato un toast di errore.

## v6.17.2 (2026-01-22)
Data: 2026-01-22

## Fix principali
- Debug tool "Carica file lungo audio": invio del file completo (no slicing byte-level) per evitare errori 400 "Audio file might be corrupted or unsupported" su WebM/MP4 troncati.
- Aggiunto controllo dimensione upload (25MB) con messaggio chiaro.
- Warning best-effort se durata > 1500s (possibile limite modello).

## v6.17.1 (2026-01-21)
## Fix principali
- **Chunking: nessun blocco a fine registrazione** se un chunk fallisce la trascrizione: ora viene inserito un placeholder e l’append prosegue.
- **Chunking: protezione anti-stallo** durante il drain: se la coda è vuota e l’append resta fermo, viene inserito un placeholder “mancante” per sbloccare la chiusura.
- **Timer**: reset coerente nelle sessioni chunking e su “Annulla”.

## Fix minori
- `generateSOAPFromPaste()` ora è **retro-compatibile**: se non esiste `#pasteText`, usa `#transcriptionText` (evita bug latente su DOM mancante).

## Note
- Nessuna modifica alle API o ai prompt: hotfix solo di robustezza UI/pipeline.

## v6.17.0 (2026-01-21)
## Highlights
- **Registrazione lunga a chunk**: registrazione continua con spezzettamento automatico e **trascrizione in parallelo** (coda + worker), per evitare blocchi su visite lunghe.
- **Profili automatici**: scelta automatica del profilo in base al dispositivo (Windows / Android / iPhone) e selezione robusta del **mimeType**.
- **UI runtime**: badge e stato live durante la registrazione (profilo, durata chunk, mimeType, timer chunk, coda/in-flight, warning split).
- **Persistenza progressiva**: testo trascritto e segmenti diarizzati salvati in IndexedDB (ripristino dopo refresh; la registrazione non può riprendere).
- **Debug avanzato**: toggle “Debug attivo (per i test)” abilita strumenti test (audio/text lunghi) + cache locale dei chunk audio (IndexedDB) con export ZIP.

## Chunk recording — parametri configurabili (Impostazioni)
- `chunkDurationSec`, `timesliceMs`, `maxPendingChunks`, `maxConcurrentTranscriptions`, `uploadRetryCount`, `uploadRetryBackoffMs`, `hardStopAtMb`, `warnBeforeSplitSec`, `autoSplitGraceMs`.

## Note
- La cache audio di test usa **IndexedDB** (non filesystem) e viene esportata come ZIP tramite JSZip (CDN).
- In caso di refresh, ADA ripristina testo/segmenti salvati ma **non** può riprendere la registrazione.

## v6.16.4 (2026-01-21)
## Fix & miglioramenti
- **Checklist modificabile**: fix dei click sugli item della checklist (es. "Otoscopia") che prima non cambiavano stato.
- **Domande su un referto → Apri/Genera spiegazione**: ridotta la possibilità di vedere una spiegazione “stale” (pulizia dell’area spiegazione e generazione glossario coerente col referto).
- **Tips & Tricks**
  - Mostra il contatore “Mostrati finora”.
  - Messaggio chiaro: i tips generati sono sempre nuovi; per ripartire usare “⟲ Ricomincia”.
  - I tips già generati restano visibili anche se la pagina perde focus (persistenza per pet).
- **Carica testo → SOAP**: prompt text-only più forte + retry automatico se S/O/A escono vuoti; in “Follow-up” ora visualizza correttamente `descrizione` (niente JSON grezzo).

## Note
- Versioning: incremento patch (Z) a **6.16.4**.

## v6.16.2 (2026-01-21)
Questa versione corregge bug individuati in analisi del codice relativi a tracking costi, annullamento generazione SOAP, multi‑pet e Q&A/Archivio.

## Correzioni principali

### Costi API / Token tracking
- Corretto il tracking: rimossi incrementi “a forfait” su chiavi errate (`gpt4o_input`, `gpt4o_output`) e sostituiti con tracking basato su `usage` (prompt/completion tokens) tramite `trackChatUsage('gpt-4o', data.usage)`.

### Annullamento generazione SOAP
- Propagato il `signal` anche nel fallback “text-only” (`generateSOAPFallbackTextOnly(..., { signal })`) così il tasto Annulla funziona anche nei casi di fallback.

### Multi‑pet: persistenza pet (robustezza)
- Aggiunto backup/restore in LocalStorage dei pet come fallback se IndexedDB risulta vuoto.

### Archivio: dati specialistici (extras)
- In apertura di un referto dall’Archivio, ora vengono ripristinati anche i campi extra e la checklist associati al referto.

### Multi‑pet: migrazione Archivio
- Resettato il flag di migrazione storico al cambio pet, per evitare che pet successivi con storico legacy restino non normalizzati.

### Parametri vitali
- La lista parametri viene renderizzata anche se il grafico non è ancora inizializzato; in apertura pagina, se necessario, il grafico viene reinizializzato.

### Q&A: diagnosi “più recente”
- “Ultima diagnosi / Diagnosi recente” ora deriva dal referto più recente per data (usa `_getHistorySortedForUI()` quando disponibile).

### Checklist template
- Ripristinate/aggiunte funzioni mancanti per aprire/chiudere la checklist, resettarla e gestire il toggle tri‑state sugli item.

### Robustezza parsing JSON da output modello
- Introdotte funzioni globali `_extractJsonObject()` / `_extractJsonArray()` e utilizzate nei punti critici (FAQ, speaker assignment) per ridurre crash su output con testo extra.

### Gestione errori HTTP
- Aggiunto controllo `response.ok` (con messaggio di errore utile) nei fetch principali che chiamano OpenAI.

## File interessati
- `app-core.js`, `app-data.js`, `app-recording.js`, `app-soap.js`, `app-pets.js`, `config.js`, `index.html`.
