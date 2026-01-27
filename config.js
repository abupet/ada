// ADA v6.18.0 - Configuration
// API Keys are stored in api-keys.js

let API_KEY = null;
const ADA_API_KEY_MODE_KEY = 'ada_api_key_mode';

function getApiKeyMode() {
    try {
        const mode = localStorage.getItem(ADA_API_KEY_MODE_KEY);
        return mode === 'costs' ? 'costs' : 'general';
    } catch (e) {
        return 'general';
    }
}

function setApiKeyMode(mode) {
    try {
        const value = mode === 'costs' ? 'costs' : 'general';
        localStorage.setItem(ADA_API_KEY_MODE_KEY, value);
    } catch (e) {}
}

function getEncryptedKeyForMode(mode) {
    return mode === 'costs' ? ENCRYPTED_API_KEY_COSTS : ENCRYPTED_API_KEY_GENERAL;
}

function getSaltForMode(mode) {
    return mode === 'costs' ? SALT_COSTS : SALT_GENERAL;
}

// Version
const ADA_VERSION = '6.18.0';
const ADA_RELEASE_NOTES = 'Aggiornamenti UI per impostazioni/debug, gestione API key dedicata e nuove sezioni clinica.';

// Template titles
const templateTitles = {
    'generale': 'Visita Generale',
    'vaccinazione': 'Vaccinazione',
    'emergenza': 'Pronto Soccorso',
    'dermatologia': 'Dermatologia',
    'postchirurgico': 'Post-Chirurgico'
};

// Template-specific configuration (8B)
// - extraFields: campi aggiuntivi (stringa). Se non presente nel testo → stringa vuota.
// - checklistItems: items tri-state (true/false/null). null = non deducibile.
// NOTE: chiavi stabili per export/archivio.
const TEMPLATE_CONFIGS = {
    generale: {
        extraFields: [
            { key: 'anamnesi_rilevante', label: 'Anamnesi rilevante (extra)', hint: 'Patologie pregresse rilevanti, interventi, ecc. (solo se esplicitati)' },
            { key: 'condizioni_ambiente', label: 'Ambiente/gestione (extra)', hint: 'Casa/esterno, contatti, lettiera, ecc. (solo se riportato)' },
            { key: 'note_varie', label: 'Note aggiuntive', hint: 'Dettagli utili non già presenti nel SOAP' }
        ],
        checklistItems: [
            { key: 'stato_generale', label: 'Stato generale' },
            { key: 'peso', label: 'Peso' },
            { key: 'temperatura', label: 'Temperatura' },
            { key: 'fc', label: 'FC/Polso' },
            { key: 'fr', label: 'FR' },
            { key: 'mucose', label: 'Mucose' },
            { key: 'trc', label: 'TRC' },
            { key: 'linfonodi', label: 'Linfonodi' },
            { key: 'cute_mantello', label: 'Cute/Mantello' },
            { key: 'auscult_cuore', label: 'Auscultazione cardiaca' },
            { key: 'auscult_polmoni', label: 'Auscultazione polmonare' },
            { key: 'palp_addome', label: 'Palpazione addome' }
        ]
    },
    vaccinazione: {
        extraFields: [
            { key: 'vaccini_somministrati', label: 'Vaccini somministrati', hint: 'Nome vaccino/i e via di somministrazione se riportati' },
            { key: 'lotto_scadenza', label: 'Lotto / scadenza', hint: 'Solo se esplicitati' },
            { key: 'richiami_programmati', label: 'Richiami programmati', hint: 'Scadenze/tempi per richiami se indicati' },
            { key: 'profilassi_parassiti', label: 'Profilassi parassiti', hint: 'Antiparassitario/vermifugo se discusso' }
        ],
        checklistItems: [
            { key: 'anamnesi_vaccinale', label: 'Anamnesi vaccinale raccolta' },
            { key: 'esame_pre_vaccinale', label: 'Esame pre-vaccinale' },
            { key: 'temperatura', label: 'Temperatura' },
            { key: 'mucose', label: 'Mucose/TRC' },
            { key: 'linfonodi', label: 'Linfonodi' },
            { key: 'peso', label: 'Peso' },
            { key: 'consenso_info', label: 'Consenso/Info reazioni avverse' },
            { key: 'note_post_vaccino', label: 'Istruzioni post-vaccino' }
        ]
    },
    emergenza: {
        extraFields: [
            { key: 'triage', label: 'Triage / priorità', hint: 'Codice/gravità se esplicitati' },
            { key: 'stabilizzazione', label: 'Stabilizzazione', hint: 'Manovre/ossigeno/fluidi se riportati' },
            { key: 'terapie_urgenza', label: 'Terapie d’urgenza', hint: 'Farmaci/infusioni/analgesia se esplicitati' },
            { key: 'monitoraggio', label: 'Monitoraggio', hint: 'Parametri monitorati e frequenza se indicati' }
        ],
        checklistItems: [
            { key: 'triage_eseguito', label: 'Triage eseguito' },
            { key: 'accesso_venoso', label: 'Accesso venoso' },
            { key: 'fluidoterapia', label: 'Fluidoterapia' },
            { key: 'ossigeno', label: 'Ossigenoterapia' },
            { key: 'analgesia', label: 'Analgesia' },
            { key: 'parametri_vitali', label: 'Parametri vitali rilevati' },
            { key: 'esami_rapidi', label: 'Esami rapidi/POC' },
            { key: 'piano_ricovero', label: 'Valutazione ricovero' }
        ]
    },
    dermatologia: {
        extraFields: [
            { key: 'distribuzione_lesioni', label: 'Distribuzione lesioni', hint: 'Sedi corporee/estensione se riportate' },
            { key: 'prurito', label: 'Prurito (scala/descrizione)', hint: 'Solo se riportato' },
            { key: 'esami_derm', label: 'Esami dermatologici', hint: 'Citologia/raschiato/lampada Wood se eseguiti' },
            { key: 'prodotti_usati', label: 'Prodotti/terapie topiche', hint: 'Shampoo/lozioni ecc. se discussi' }
        ],
        checklistItems: [
            { key: 'valutazione_lesioni', label: 'Valutazione lesioni cutanee' },
            { key: 'otoscopia', label: 'Otoscopia' },
            { key: 'citologia', label: 'Citologia' },
            { key: 'raschiato', label: 'Raschiato cutaneo' },
            { key: 'ricerca_parassiti', label: 'Ricerca parassiti' },
            { key: 'controllo_prurito', label: 'Valutazione prurito' },
            { key: 'piano_followup', label: 'Follow-up dermatologico' }
        ]
    },
    postchirurgico: {
        extraFields: [
            { key: 'tipo_intervento', label: 'Tipo intervento', hint: 'Solo se esplicitato' },
            { key: 'sito_chirurgico', label: 'Sito chirurgico', hint: 'Aspetto ferita/edema/essudato se riportati' },
            { key: 'medicazione', label: 'Medicazione / gestione ferita', hint: 'Dettagli su bendaggio/medicazioni se indicati' },
            { key: 'rimozione_punti', label: 'Rimozione punti', hint: 'Quando prevista, se indicato' }
        ],
        checklistItems: [
            { key: 'controllo_ferita', label: 'Controllo ferita' },
            { key: 'dolore', label: 'Valutazione dolore' },
            { key: 'temperatura', label: 'Temperatura' },
            { key: 'medicazione', label: 'Medicazione eseguita/istruita' },
            { key: 'collare', label: 'Collare elisabettiano/limitazioni' },
            { key: 'terapia', label: 'Terapia post-operatoria' },
            { key: 'followup', label: 'Follow-up programmato' }
        ]
    }
};

// Checklist items
const checklistItems = [
    'Stato generale', 'Peso', 'Temperatura', 'FC/Polso', 'FR',
    'Mucose', 'TRC', 'Linfonodi', 'Cute/Mantello', 'Occhi',
    'Orecchie', 'Cavo orale', 'Collo/Tiroide', 'Auscultazione cardiaca',
    'Auscultazione polmonare', 'Palpazione addome', 'Apparato locomotore',
    'Sistema nervoso', 'App. urogenitale', 'Stato nutrizionale'
];

// Language map for TTS
const langMap = { 'IT': 'it', 'EN': 'en', 'DE': 'de', 'FR': 'fr', 'ES': 'es' };
const langNames = { 'IT': 'italiano', 'EN': 'inglese', 'DE': 'tedesco', 'FR': 'francese', 'ES': 'spagnolo' };
const voiceMap = { 'IT': 'nova', 'EN': 'alloy', 'DE': 'nova', 'FR': 'nova', 'ES': 'nova' };

// API costs (estimated, USD - standard tier)
const API_COSTS = {
    'gpt4o_transcribe_minutes': { label: 'gpt-4o-transcribe-diarize', costPerUnit: 0.006, unit: 'min' },
    'whisper_minutes': { label: 'whisper-1', costPerUnit: 0.006, unit: 'min' },
    'gpt4o_input_tokens': { label: 'gpt-4o (input)', costPerUnit: 2.50 / 1000000, unit: 'tokens' },
    'gpt4o_output_tokens': { label: 'gpt-4o (output)', costPerUnit: 10.00 / 1000000, unit: 'tokens' },
    'gpt4o_mini_input_tokens': { label: 'gpt-4o-mini (input)', costPerUnit: 0.15 / 1000000, unit: 'tokens' },
    'gpt4o_mini_output_tokens': { label: 'gpt-4o-mini (output)', costPerUnit: 0.60 / 1000000, unit: 'tokens' },
    'tts_input_chars': { label: 'tts-1', costPerUnit: 15.00 / 1000000, unit: 'caratteri' }
};

// API usage tracking
let apiUsage = {
    gpt4o_transcribe_minutes: 0,
    whisper_minutes: 0,
    gpt4o_input_tokens: 0,
    gpt4o_output_tokens: 0,
    gpt4o_mini_input_tokens: 0,
    gpt4o_mini_output_tokens: 0,
    tts_input_chars: 0
};

// Medical abbreviations expansion
const MEDICAL_ABBREVIATIONS = {
    'q4h': 'ogni quattro ore',
    'q6h': 'ogni sei ore',
    'q8h': 'ogni otto ore',
    'q12h': 'ogni dodici ore',
    'q24h': 'ogni ventiquattro ore',
    'BID': 'due volte al giorno',
    'TID': 'tre volte al giorno',
    'SID': 'una volta al giorno',
    'QID': 'quattro volte al giorno',
    'PRN': 'al bisogno',
    'PO': 'per bocca',
    'SC': 'sottocute',
    'IM': 'intramuscolo',
    'IV': 'endovena',
    'mg': 'milligrammi',
    'ml': 'millilitri',
    'kg': 'chilogrammi',
    'g': 'grammi',
    '1/2 cp': 'mezza compressa',
    '1/4 cp': 'un quarto di compressa'
};

// SOAP JSON Schema (strict mode)
const SOAP_JSON_SCHEMA = {
    "name": "vet_soap_report",
    "strict": true,
    "schema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "meta": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "language": { "type": "string", "enum": ["it"] },
                    "visit_datetime_local": { "type": ["string", "null"] },
                    "species": { "type": ["string", "null"], "enum": ["cane", "gatto", null] },
                    "age_text": { "type": ["string", "null"] },
                    "sex": { "type": ["string", "null"], "enum": ["M", "F", "sconosciuto", null] },
                    "sterilized": { "type": ["boolean", "null"] },
                    "speakers": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": {
                                "speaker_label": { "type": "string" },
                                "role": { "type": "string", "enum": ["veterinario", "proprietario", "altro_personale", "terzo", "sconosciuto"] },
                                "display_name": { "type": ["string", "null"] },
                                "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
                                "supporting_segment_ids": { "type": "array", "items": { "type": "integer", "minimum": 0 } }
                            },
                            "required": ["speaker_label", "role", "confidence", "supporting_segment_ids"]
                        }
                    },
                    "disclaimers": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["language", "speakers", "disclaimers"]
            },
            "S": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "chief_complaint": { "type": ["string", "null"] },
                    "history": { "type": "array", "items": { "type": "string" } },
                    "symptoms": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": {
                                "name": { "type": "string" },
                                "onset": { "type": ["string", "null"] },
                                "duration": { "type": ["string", "null"] },
                                "frequency": { "type": ["string", "null"] },
                                "severity": { "type": ["string", "null"] },
                                "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
                                "supporting_segment_ids": { "type": "array", "items": { "type": "integer", "minimum": 0 } }
                            },
                            "required": ["name", "confidence", "supporting_segment_ids"]
                        }
                    },
                    "diet": { "type": ["string", "null"] },
                    "environment": { "type": ["string", "null"] },
                    "medications_current": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": {
                                "drug_name": { "type": "string" },
                                "dose_text": { "type": ["string", "null"] },
                                "route": { "type": ["string", "null"] },
                                "frequency": { "type": ["string", "null"] },
                                "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
                                "supporting_segment_ids": { "type": "array", "items": { "type": "integer", "minimum": 0 } }
                            },
                            "required": ["drug_name", "confidence", "supporting_segment_ids"]
                        }
                    },
                    "allergies": { "type": "array", "items": { "type": "string" } },
                    "vaccination_prevention": { "type": ["string", "null"] },
                    "supporting_segment_ids": { "type": "array", "items": { "type": "integer", "minimum": 0 } }
                },
                "required": ["history", "symptoms", "medications_current", "allergies", "supporting_segment_ids"]
            },
            "O": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "vitals": {
                        "type": "object",
                        "additionalProperties": false,
                        "properties": {
                            "weight": { "type": ["string", "null"] },
                            "temperature": { "type": ["string", "null"] },
                            "heart_rate": { "type": ["string", "null"] },
                            "resp_rate": { "type": ["string", "null"] },
                            "mm_color": { "type": ["string", "null"] },
                            "crt": { "type": ["string", "null"] }
                        },
                        "required": ["weight", "temperature", "heart_rate", "resp_rate", "mm_color", "crt"]
                    },
                    "physical_exam": { "type": "array", "items": { "type": "string" } },
                    "tests_performed": { "type": "array", "items": { "type": "string" } },
                    "test_results": { "type": "array", "items": { "type": "string" } },
                    "supporting_segment_ids": { "type": "array", "items": { "type": "integer", "minimum": 0 } }
                },
                "required": ["vitals", "physical_exam", "tests_performed", "test_results", "supporting_segment_ids"]
            },
            "A": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "problem_list": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": {
                                "problem": { "type": "string" },
                                "status": { "type": ["string", "null"] },
                                "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
                                "supporting_segment_ids": { "type": "array", "items": { "type": "integer", "minimum": 0 } }
                            },
                            "required": ["problem", "confidence", "supporting_segment_ids"]
                        }
                    },
                    "differentials": { "type": "array", "items": { "type": "string" } },
                    "triage_urgency": { "type": "string", "enum": ["bassa", "media", "alta"] },
                    "uncertainties_and_conflicts": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": {
                                "topic": { "type": "string" },
                                "conflict_summary": { "type": "string" },
                                "supporting_segment_ids": { "type": "array", "items": { "type": "integer", "minimum": 0 } }
                            },
                            "required": ["topic", "conflict_summary", "supporting_segment_ids"]
                        }
                    },
                    "supporting_segment_ids": { "type": "array", "items": { "type": "integer", "minimum": 0 } }
                },
                "required": ["problem_list", "differentials", "triage_urgency", "uncertainties_and_conflicts", "supporting_segment_ids"]
            },
            "P": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "diagnostics_planned": { "type": "array", "items": { "type": "string" } },
                    "treatment_plan": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": {
                                "action": { "type": "string" },
                                "dose_text": { "type": ["string", "null"] },
                                "duration": { "type": ["string", "null"] },
                                "notes": { "type": ["string", "null"] },
                                "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
                                "supporting_segment_ids": { "type": "array", "items": { "type": "integer", "minimum": 0 } }
                            },
                            "required": ["action", "confidence", "supporting_segment_ids"]
                        }
                    },
                    "client_instructions": { "type": "array", "items": { "type": "string" } },
                    "follow_up": { "type": "array", "items": { "type": "string" } },
                    "red_flags": { "type": "array", "items": { "type": "string" } },
                    "supporting_segment_ids": { "type": "array", "items": { "type": "integer", "minimum": 0 } }
                },
                "required": ["diagnostics_planned", "treatment_plan", "client_instructions", "follow_up", "red_flags", "supporting_segment_ids"]
            },
            "audit": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "coverage_notes": { "type": "array", "items": { "type": "string" } },
                    "low_confidence_items": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["coverage_notes", "low_confidence_items"]
            }
        },
        "required": ["meta", "S", "O", "A", "P", "audit"]
    }
};

// SOAP Generation Instructions
const SOAP_SYSTEM_INSTRUCTIONS = `Sei un assistente clinico veterinario esperto. Produci un referto SOAP strutturato dalla trascrizione fornita.

REGOLE FONDAMENTALI:
1) ESTRAI TUTTO IL POSSIBILE: popola i campi con tutte le informazioni clinicamente rilevanti trovate.
2) Lingua: italiano.
3) Tracciabilità: usa supporting_segment_ids (array di interi segment_index) per collegare le informazioni ai segmenti. Se non hai segment_index, usa [].
4) S (Soggettivo): informazioni dal proprietario - motivo visita, storia clinica, sintomi riferiti, dieta, farmaci in corso.
5) O (Oggettivo): osservazioni del veterinario - parametri vitali, esame fisico, esami eseguiti e risultati.
6) A (Assessment/Analisi): diagnosi, diagnosi differenziali, valutazione clinica menzionate.
7) P (Piano): terapie prescritte, esami da fare, istruzioni al proprietario, follow-up.
8) Se il ruolo del parlante è "unknown", deduci dal contenuto: terminologia medica = veterinario, descrizioni in linguaggio comune = proprietario.
9) Confidenza: 0-1 per item. Se incerto, usa 0.5-0.7 ma INCLUDI comunque l'informazione.
10) NON lasciare sezioni completamente vuote se ci sono informazioni rilevanti nella trascrizione.
11) Privacy: generalizza i nomi propri.`;

// Simplified SOAP schema for fallback (more permissive)
const SOAP_SIMPLE_SCHEMA = {
    type: "object",
    properties: {
        S: { type: "object", description: "Soggettivo - dal proprietario" },
        O: { type: "object", description: "Oggettivo - dal veterinario" },
        A: { type: "object", description: "Assessment/Analisi clinica" },
        P: { type: "object", description: "Piano terapeutico" },
        meta: { type: "object", description: "Metadati" }
    }
};

// Crypto functions
async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: Uint8Array.from(atob(salt), c => c.charCodeAt(0)), iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
    );
}

async function decryptApiKey(password, mode = getApiKeyMode()) {
    try {
        const salt = getSaltForMode(mode);
        const encryptedKey = getEncryptedKeyForMode(mode);
        const key = await deriveKey(password, salt);
        const data = Uint8Array.from(atob(encryptedKey), c => c.charCodeAt(0));
        const iv = data.slice(0, 12);
        const encrypted = data.slice(12);
        const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
        return new TextDecoder().decode(decrypted);
    } catch (e) {
        return null;
    }
}

// Helper: blob to base64 data URL
async function blobToDataURL(blob) {
    const ab = await blob.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(ab);
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return `data:${blob.type || "audio/webm"};base64,${base64}`;
}

// Helper: blob to base64 (clean, no prefix)
async function blobToBase64Clean(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
