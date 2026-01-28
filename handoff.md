# HANDOFF – ADA Development & Automated Testing

Questo documento definisce **come Codex deve lavorare su ADA**, includendo sviluppo, test locali e test automatizzati via GitHub Actions. È pensato come guida operativa unica e vincolante.

---

## 1. Obiettivi dell’handoff

- Sviluppare le feature descritte in `specs/PROMPT.md` in modo incrementale e verificabile
- Garantire che **nessuna modifica entri in `main` senza CI verde**
- Usare correttamente i **due livelli di test**:
  - CI (PR) → MOCK, veloce, gate di merge
  - CI (REAL) → rete stretta + OpenAI reale, on‑demand e nightly
- Fornire tracciabilità chiara (commit, PR, artifacts, commenti automatici)
- Mantenere il baseline stabile (ADA v6.17.5) e le funzionalità critiche integre

---

## 2. Regole generali di sviluppo

### 2.1 Branching

- Ogni attività → **branch dedicata**
- Naming consigliato:
  - `feat/<descrizione>`
  - `fix/<descrizione>`
  - `ci/<descrizione>`

Non lavorare mai direttamente su `main`.

### 2.2 Commit

- Commit piccoli e mirati
- Messaggi chiari e descrittivi
- Evitare commit “miscellaneous”

---

## 2.3 Note di baseline (v6.17.5)

- Il repository include già il fix per il bug critico su `app-recording.js`.
- In questa versione i pulsanti della pagina **Visita** devono rimanere operativi.

---

## 2.4 Regole funzionali non negoziabili

### Release notes

- Deve esistere **un solo** file `RELEASE_NOTES.md` (cumulativo).
- Ogni release aggiunge una nuova sezione `## vX.Y.Z`.
- Non creare file di release notes separati.

### Pagina Visita – pulsanti obbligatori

Devono funzionare sempre:
- 🎤 Microfono (`toggleRecording`)
- 📁 Carica audio
- 🧪 Carica audio lungo (test chunking)
- 🧪 Carica testo lungo (test append)
- 📄 Carica testo

### Caricamento script

- `app-recording.js` deve caricarsi senza errori di sintassi.
- Se fallisce, i pulsanti Visita non funzionano.
- Verificare che esistano funzioni come:
  `toggleRecording`, `triggerAudioUpload`, `triggerLongAudioTestUpload`, `triggerLongTextTestUpload`.

### Audio lungo

- Limite upload OpenAI: 25MB per richiesta.
- Non spezzare WebM/MP4 a byte nudi.
- Usare chunking temporale su audio decodificato (es. WAV/PCM 16kHz mono).

### Debug mode

Quando “Debug attivo (per i test)” è abilitato:
- `ADA.log` deve essere verboso.
- Le funzionalità di debug/test devono essere visibili.
- Gli errori devono essere loggati chiaramente.

---

## 3. Specifiche di versione

- Le specifiche **iniziali** della versione si trovano in:
  
  `specs/PROMPT.md`

- Codex deve:
  1. Implementare **tutte** le specifiche richieste
  2. Verificare che CI (PR) sia verde
  3. Solo a sviluppo completato:
     - rinominare il file in `PROMPT+<numero_versione>.md`
     - spostarlo in `specs/archive/`

⚠️ Il file **non va spostato prima** del completamento della versione.

---

## 4. Testing locale (obbligatorio prima della PR)

### 4.1 Setup

```bash
npm ci
```

### 4.2 Avvio applicazione

```bash
npm run serve
```

- L’app gira su `http://localhost:4173`

### 4.3 Test Playwright

- Smoke test:

```bash
npx playwright test --grep "@smoke"
```

- Suite completa:

```bash
npx playwright test
```

### 4.4 Variabili ambiente locali

In locale possono essere usati `.env` (non committati):

- `ADA_TEST_PASSWORD`
- `OPENAI_API_KEY`

---

## 5. CI su GitHub – panoramica

### 5.1 CI (PR)

- File: `.github/workflows/ci.yml`
- Trigger: ogni Pull Request
- Modalità:
  - `MODE=MOCK`
  - `STRICT_NETWORK=0`

È il **gate di merge** (branch protection).

### 5.2 CI (REAL)

Due modalità:

1. **Nightly automatica**
   - File: `ci-real.yml`
   - Trigger: schedule + manuale

2. **On‑label su PR**
   - File: `real-on-label.yml`
   - Trigger: label `run-real`

Configurazione comune:

- `MODE=REAL`
- `STRICT_NETWORK=1`
- `ALLOW_OPENAI=1`
- `STRICT_ALLOW_HOSTS=cdnjs.cloudflare.com`

---

## 6. Labeling automatico e strategia REAL

### 6.1 Label automatiche

Il workflow `PR Labeler` applica automaticamente label in base ai file modificati:

- `ci`
- `tests`
- `frontend`
- `backend`
- `docs`

### 6.2 Auto‑aggiunta `run-real`

Il workflow `auto-run-real-label.yml` aggiunge automaticamente la label `run-real` quando la PR modifica file considerati **rischiosi**, tra cui:

- `.github/workflows/**`
- `tests/e2e/**`
- `tests/policy/**`
- `strict-network.ts`
- `helpers/login.ts`

Quando `run-real` è presente:
- parte automaticamente **CI (REAL on label)**

---

## 7. Diagnostica automatica dei fallimenti

### 7.1 Artifacts

Su fallimento, vengono sempre caricati:

- `playwright-report`
- `test-results`
- `server-log`

### 7.2 Job Summary

Ogni workflow scrive un **Summary** con:

- MODE / STRICT_NETWORK / ALLOW_OPENAI
- Host consentiti
- Comandi utili per il debug locale

### 7.3 Commento automatico su PR

Se **CI (PR)** fallisce:

- il workflow `ci-pr-failure-comment.yml`
- posta automaticamente un commento nella PR con:
  - link al run
  - commit SHA
  - next steps di debug

Codex deve usare **quel commento come guida operativa**.

---

## 8. Cosa fare quando CI fallisce

1. Aprire il link del run
2. Identificare il primo errore reale
3. Scaricare artifacts se Playwright fallisce
4. Correggere il codice
5. Push → CI riparte automaticamente

Non aggirare mai i test.

---

## 9. Divieti espliciti

- ❌ Non usare `ada-tests.sh` in CI GitHub
- ❌ Non disabilitare test per “far passare la build”
- ❌ Non committare secrets
- ❌ Non mergiare senza CI (PR) verde

---

## 9.1 Cosa fare per primo

- Leggere `AGENTS.md`
- Leggere `RELEASE_NOTES.md`
- Verificare manualmente i pulsanti della pagina Visita
- Segnalare immediatamente eventuali errori di caricamento script

---

## 10. Stato finale atteso

Una versione è considerata **completata** solo quando:

- Tutte le specifiche di `PROMPT.md` sono implementate
- CI (PR) è verde
- Eventuali CI (REAL) sono verdi
- `PROMPT.md` è stato archiviato correttamente in `specs/archive/`

---

**Questo file è la fonte di verità per Codex.**
