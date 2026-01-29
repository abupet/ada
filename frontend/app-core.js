// ADA v6.17.3 - Core Application Functions

// State variables
let currentTemplate = 'generale';
let currentLang = 'IT';
let photos = [];
let vitalsData = [];
let historyData = [];
let medications = [];
let appointments = [];
let checklist = {};
let currentSOAPChecklist = {};
let currentTemplateExtras = {};
let hideEmptyFields = false;
let vitalsChart = null;
let currentEditingSOAPIndex = -1;
let currentEditingHistoryId = null; // id-based selection for Archivio
let _historySchemaMigrated = false;
let fullscreenTargetId = null;
let lastResetDate = null;
let tipsData = [];
let debugLogEnabled = true;
let checklistLabelTranslations = {};
let extraLabelTranslations = {};

// ============================================
// JSON EXTRACTION HELPERS (robust parsing from model output)
// ============================================

function _extractJsonObject(text) {
    const t = String(text || '');
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    const candidate = t.slice(start, end + 1);
    try { return JSON.parse(candidate); } catch (e) { return null; }
}

function _extractJsonArray(text) {
    const t = String(text || '');
    const start = t.indexOf('[');
    const end = t.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) return null;
    const candidate = t.slice(start, end + 1);
    try { return JSON.parse(candidate); } catch (e) { return null; }
}

// ============================================
// LOGIN / SESSION
// ============================================

async function login() {
    const password = document.getElementById('passwordInput').value;
    const apiKey = await decryptApiKey(password, getApiKeyMode());
    let token = '';
    try {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        if (response.ok) {
            const data = await response.json();
            token = data?.token || '';
        }
    } catch (e) {}

    if (token) {
        if (apiKey) {
            API_KEY = apiKey;
        }
        setAuthToken(token);
        const sessionKey = btoa(password + ':' + Date.now());
        localStorage.setItem('ada_session', sessionKey);
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('appContainer').classList.add('active');
        loadData();
        initApp();
    } else {
        document.getElementById('loginError').style.display = 'block';
    }
}

async function checkSession() {
    try { applyVersionInfo(); } catch (e) {}
    const session = localStorage.getItem('ada_session');
    const token = getAuthToken();
    if (session && token) {
        try {
            const decoded = atob(session);
            const password = decoded.split(':')[0];
            const apiKey = await decryptApiKey(password, getApiKeyMode());
            if (apiKey) {
                API_KEY = apiKey;
            }
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('appContainer').classList.add('active');
            loadData();
            initApp();
            return;
        } catch (e) {}
    }
}

function logout() {
    localStorage.removeItem('ada_session');
    clearAuthToken();
    location.reload();
}

function handleAuthFailure() {
    localStorage.removeItem('ada_session');
    clearAuthToken();
    API_KEY = null;
    const loginScreen = document.getElementById('loginScreen');
    const appContainer = document.getElementById('appContainer');
    if (appContainer) appContainer.classList.remove('active');
    if (loginScreen) loginScreen.style.display = 'flex';
    const loginError = document.getElementById('loginError');
    if (loginError) {
        loginError.textContent = 'Sessione scaduta. Accedi di nuovo.';
        loginError.style.display = 'block';
    }
}

// ============================================
// INITIALIZATION
// ============================================

async function initApp() {
    initNavigation();
    initTemplateSelector();
    initVisualizer();
    initVitalsChart();
    initChecklist();
    initHideEmptyToggle();
    initLanguageSelectors();
    initVitalsDateTime();
    initDebugLogSetting();
    initApiKeySelector();
    initChunkingSettings();
    initChunkingSectionToggle();
    initVetNameSetting();
    initClinicLogoSetting();
    restoreClinicLogoSectionState();
    applyVersionInfo();
    await initSpeakersDB();
    await initMultiPetSystem(); // Initialize multi-pet system

    // Restore any draft content (transcription/SOAP/notes) saved when the tab lost focus
    restoreTextDrafts();
    syncLangSelectorsForCurrentDoc();

    // Restore progressive transcription state for chunking sessions (if any)
    try { if (typeof restoreChunkVisitDraft === 'function') await restoreChunkVisitDraft(); } catch (e) {}
    renderPhotos();
    renderHistory();
    renderMedications();
    renderAppointments();
    renderSpeakersSettings();
    restoreSpeakersSectionState();
    updateHistoryBadge();
    updateCostDisplay();
    restoreLastPage(); // Restore last viewed page
}

function applyVersionInfo() {
    const versionEl = document.getElementById('appVersion');
    const releaseNotesEl = document.getElementById('appReleaseNotesVersion');
    const loginVersionEl = document.getElementById('loginVersion');
    if (versionEl) versionEl.textContent = ADA_VERSION;
    if (releaseNotesEl) releaseNotesEl.textContent = ADA_VERSION;
    if (loginVersionEl) loginVersionEl.textContent = ADA_VERSION;
    if (document && document.title) {
        document.title = `ADA v${ADA_VERSION} - AI Driven Abupet`;
    }
}

function initNavigation() {
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
        item.addEventListener('click', () => {
            const page = item.dataset.page;
            navigateToPage(page);
        });
    });
    
    // Save scroll position when scrolling
    document.querySelector('.main-content')?.addEventListener('scroll', debounce(() => {
        const activePage = document.querySelector('.page.active');
        if (activePage) {
            localStorage.setItem('ada_scroll_position', document.querySelector('.main-content').scrollTop);
        }
    }, 200));
    
    // Save state when app loses focus
    window.addEventListener('blur', saveCurrentPageState);
    window.addEventListener('pagehide', saveCurrentPageState);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') saveCurrentPageState();
    });
}

function navigateToPage(page) {
    if (page === 'debug' && !debugLogEnabled) page = 'recording';
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (navItem) navItem.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const pageEl = document.getElementById('page-' + page);
    if (pageEl) pageEl.classList.add('active');
    if (window.innerWidth < 800) document.getElementById('sidebar').classList.remove('open');
    
    // Save current page
    localStorage.setItem('ada_current_page', page);
    
    if (page === 'costs') updateCostDisplay();
    if (page === 'vitals') setTimeout(() => { try { if (!vitalsChart) initVitalsChart(); } catch(e) {} try { updateVitalsChart(); } catch(e) {} }, 100);
    if (page === 'photos') renderPhotos();
    if (page === 'settings') renderSpeakersSettings();
    if (page === 'qna-report') renderQnaReportDropdown();
    if (page === 'tips') {
        try { if (typeof restoreTipsDataForCurrentPet === 'function') restoreTipsDataForCurrentPet(); } catch(e) {}
        try { if (typeof updateTipsMeta === 'function') updateTipsMeta(); } catch(e) {}
    }
    syncLangSelectorsForCurrentDoc();
}

function saveCurrentPageState() {
    const activePage = document.querySelector('.page.active');
    if (activePage) {
        const pageId = activePage.id.replace('page-', '');
        localStorage.setItem('ada_current_page', pageId);
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            localStorage.setItem('ada_scroll_position', mainContent.scrollTop);
        }
    }

    // Persist drafts of user-edited fields so they don't get lost when the tab loses focus
    saveTextDrafts();
}

// ============================================
// TEXT DRAFT PERSISTENCE
// ============================================

const ADA_DRAFT_FIELD_IDS = [
    'transcriptionText',
    'soap-s', 'soap-o', 'soap-a', 'soap-p',
    'ownerExplanation',
    'qnaQuestion', 'qnaAnswer',
    'appointmentDate', 'appointmentTime', 'appointmentReason', 'appointmentNotes',
    'medName', 'medDosage', 'medFrequency', 'medDuration', 'medInstructions'
];

// Draft persistence for template-specific extras/checklist (v6.16.2)
let _templateDraftSaveTimer = null;

function _getDraftPetKey() {
    try {
        if (typeof getCurrentPetId === 'function') {
            const pid = getCurrentPetId();
            if (pid) return `pet${pid}`;
        }
    } catch (e) {}
    try {
        if (typeof currentPetId !== 'undefined' && currentPetId) return `pet${currentPetId}`;
    } catch (e) {}
    return 'global';
}

function _draftKeyForTemplate(templateKey) {
    const tpl = (templateKey || currentTemplate || 'generale').toString();
    const petKey = _getDraftPetKey();

    // If we are editing a specific archived report, store drafts per-report (not per-template)
    try {
        if (typeof currentEditingHistoryId !== 'undefined' && currentEditingHistoryId) {
            return `ada_draft_rep_${petKey}_${currentEditingHistoryId}_${tpl}`;
        }
    } catch (e) {}

    return `ada_draft_tpl_${petKey}_${tpl}`;
}

function saveTemplateDraftState() {
    try {
        const key = _draftKeyForTemplate(currentTemplate);
        const payload = {
            extras: (currentTemplateExtras && typeof currentTemplateExtras === 'object') ? currentTemplateExtras : {},
            checklist: (currentSOAPChecklist && typeof currentSOAPChecklist === 'object') ? currentSOAPChecklist : {},
            savedAt: new Date().toISOString()
        };
        localStorage.setItem(key, JSON.stringify(payload));
    } catch (e) {
        // non-fatal
    }
}

function scheduleTemplateDraftSave() {
    try {
        if (_templateDraftSaveTimer) clearTimeout(_templateDraftSaveTimer);
        _templateDraftSaveTimer = setTimeout(() => {
            saveTemplateDraftState();
            _templateDraftSaveTimer = null;
        }, 300);
    } catch (e) {}
}

function restoreTemplateDraftState(options) {
    const opts = options || {};
    const templateKey = (opts.templateKey || currentTemplate || 'generale').toString();
    const force = !!opts.force;

    // Avoid overwriting a populated state unless forced
    const extrasIsEmpty = !currentTemplateExtras || Object.keys(currentTemplateExtras || {}).length === 0;
    const checklistIsEmpty = !currentSOAPChecklist || Object.keys(currentSOAPChecklist || {}).length === 0;
    if (!force && (!extrasIsEmpty || !checklistIsEmpty)) return;

    try {
        const key = _draftKeyForTemplate(templateKey);
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            currentTemplateExtras = (parsed.extras && typeof parsed.extras === 'object') ? parsed.extras : {};
            currentSOAPChecklist = (parsed.checklist && typeof parsed.checklist === 'object') ? parsed.checklist : {};
        }
    } catch (e) {
        // non-fatal
    }
}

function saveTextDrafts() {
    try {
        ADA_DRAFT_FIELD_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            if (typeof el.value !== 'string') return;
            localStorage.setItem(`ada_draft_${id}`, el.value);
        });

        // Template-specific drafts (extras/checklist)
        saveTemplateDraftState();
    } catch (e) {
        // non-fatal
    }
}

function restoreTextDrafts() {
    try {
        ADA_DRAFT_FIELD_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const v = localStorage.getItem(`ada_draft_${id}`);
            if (v === null) return;
            // Don't overwrite existing values (e.g., when loading a pet)
            if (!el.value) el.value = v;
        });

        // Restore transcription UI state
        const savedMode = localStorage.getItem('ada_transcription_mode');
        if (savedMode === 'audio' || savedMode === 'text') {
            transcriptionMode = savedMode;
        }
        const ta = document.getElementById('transcriptionText');
        if (ta && ta.value && (!transcriptionMode || transcriptionMode === 'none')) {
            transcriptionMode = 'text';
        }
        applyTranscriptionUI();

        // Restore template-specific extras/checklist drafts if present
        restoreTemplateDraftState({ force: false });
        renderTemplateExtras();
        renderChecklistInSOAP();
        applyHideEmptyVisibility();
    } catch (e) {
        // non-fatal
    }
}

function restoreLastPage() {
    const lastPage = localStorage.getItem('ada_current_page');
    const scrollPosition = localStorage.getItem('ada_scroll_position');
    const safePage = (!debugLogEnabled && lastPage === 'debug') ? 'recording' : lastPage;

    if (safePage) {
        navigateToPage(safePage);
        if (scrollPosition) {
            setTimeout(() => {
                const mainContent = document.querySelector('.main-content');
                if (mainContent) mainContent.scrollTop = parseInt(scrollPosition);
            }, 100);
        }
    }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function toggleSidebar() { 
    document.getElementById('sidebar').classList.toggle('open'); 
}

// ============================================
// TEXT FILE UPLOAD
// ============================================

// Transcription mode controls the UX and what we send to the SOAP generator
// - 'audio': transcription generated from audio => read-only
// - 'text': transcription loaded from a .txt => editable
// - 'none': nothing loaded yet
let transcriptionMode = 'none';

function showTranscriptionCard() {
    const card = document.getElementById('transcriptionCard');
    if (card) card.style.display = '';
}

function hideTranscriptionCard() {
    const card = document.getElementById('transcriptionCard');
    if (card) card.style.display = 'none';
    const row = document.getElementById('generateSoapRow');
    if (row) row.style.display = 'none';
}

function applyTranscriptionUI() {
    const titleEl = document.getElementById('transcriptionTitle');
    const ta = document.getElementById('transcriptionText');
    const note = document.getElementById('transcriptionReadOnlyNote');
    const row = document.getElementById('generateSoapRow');

    if (!ta) return;

    if (transcriptionMode === 'none') {
        hideTranscriptionCard();
        return;
    }

    showTranscriptionCard();
    if (row) row.style.display = 'flex';

    const isAudio = transcriptionMode === 'audio';
    if (titleEl) titleEl.textContent = isAudio ? 'Testo trascritto' : 'Testo caricato';
    ta.readOnly = isAudio;
    ta.classList.toggle('readonly-transcription', isAudio);
    if (note) note.style.display = isAudio ? '' : 'none';

    // Persist mode for UX continuity
    try { localStorage.setItem('ada_transcription_mode', transcriptionMode); } catch (e) {}
}

function setTranscriptionFromTextFile(text) {
    // New transcription implies a new referto draft (avoid overwriting an archived record)
    try { if (typeof resetSoapDraftLink === 'function') resetSoapDraftLink(); } catch (e) {}

    const ta = document.getElementById('transcriptionText');
    if (ta) ta.value = (text || '').toString();

    transcriptionMode = 'text';

    // IMPORTANT: when loading a text file we must NOT use segments
    try {
        if (typeof transcriptionSegments !== 'undefined') transcriptionSegments = [];
    } catch (e) {}
    try {
        if (typeof lastTranscriptionResult !== 'undefined') lastTranscriptionResult = { text: (text || '').toString(), segments: [] };
        if (typeof lastTranscriptionDiarized !== 'undefined') lastTranscriptionDiarized = false;
    } catch (e) {}

    applyTranscriptionUI();
}

// Called by app-recording.js when an audio transcription is ready
function setTranscriptionFromAudio(text, segments = [], diarized = false) {
    // New transcription implies a new referto draft (avoid overwriting an archived record)
    try { if (typeof resetSoapDraftLink === 'function') resetSoapDraftLink(); } catch (e) {}

    const ta = document.getElementById('transcriptionText');
    if (ta) ta.value = (text || '').toString();

    transcriptionMode = 'audio';

    try {
        if (typeof transcriptionSegments !== 'undefined') transcriptionSegments = Array.isArray(segments) ? segments : [];
    } catch (e) {}
    try {
        if (typeof lastTranscriptionResult !== 'undefined') lastTranscriptionResult = { text: (text || '').toString(), segments: Array.isArray(segments) ? segments : [] };
        if (typeof lastTranscriptionDiarized !== 'undefined') lastTranscriptionDiarized = !!diarized;
    } catch (e) {}

    applyTranscriptionUI();
}

function triggerTextUpload() {
    document.getElementById('textFileInput').click();
}

function handleTextUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result || '';
        setTranscriptionFromTextFile(text);
        showToast('File testo caricato', 'success');
    };
    reader.onerror = () => {
        showToast('Errore nella lettura del file', 'error');
    };
    reader.readAsText(file);
    event.target.value = '';
}

// ============================================
// FULLSCREEN TEXT READING
// ============================================

let fullscreenSpeaking = false;

async function speakFullscreenText() {
    const text = document.getElementById('fullscreenTextarea').value;
    
    if (!text.trim()) {
        showToast('Nessun testo da leggere', 'error');
        return;
    }
    
    // Use the global speak function with OpenAI TTS
    if (isSpeaking) {
        stopSpeaking();
    } else {
        await speak(text, 'IT');
    }
}

function initTemplateSelector() {
    // Restore last template
    const savedTemplate = localStorage.getItem('ada_last_template');
    if (savedTemplate) {
        currentTemplate = savedTemplate;
        const selector = document.getElementById('templateSelector');
        if (selector) selector.value = savedTemplate;
    }
    document.getElementById('soapTemplateTitle').textContent = templateTitles[currentTemplate];
    // Restore draft extras/checklist for this template (if any)
    restoreTemplateDraftState({ force: false });

    // Render template-specific UI (extras + checklist)
    renderTemplateExtras();
    renderChecklistInSOAP();
    applyHideEmptyVisibility();
}

function onTemplateChange(value) {
    // Save current template drafts before switching
    saveTemplateDraftState();

    currentTemplate = value;
    localStorage.setItem('ada_last_template', value);
    document.getElementById('soapTemplateTitle').textContent = templateTitles[currentTemplate];

    // Reset template-specific state (8B)
    currentTemplateExtras = {};
    currentSOAPChecklist = {};
    scheduleTemplateDraftSave();

    // Restore drafts for the newly selected template
    restoreTemplateDraftState({ templateKey: value, force: true });

    renderTemplateExtras();
    renderChecklistInSOAP();
    applyHideEmptyVisibility();
}


// ============================================
// VETERINARIAN NAME (Settings 5A)
// ============================================

const ADA_VET_NAME_KEY = 'ada_vet_name';

function getVetName() {
    try {
        return (localStorage.getItem(ADA_VET_NAME_KEY) || '').trim();
    } catch (e) {
        return '';
    }
}

function saveVetName(value) {
    try {
        const v = (value || '').toString().trim();
        localStorage.setItem(ADA_VET_NAME_KEY, v);
    } catch (e) {}
}

function initVetNameSetting() {
    const input = document.getElementById('vetNameInput');
    if (!input) return;
    input.value = getVetName();
}

// ============================================
// API KEY SELECTION (General vs Costs)
// ============================================

function getSessionPassword() {
    try {
        const session = localStorage.getItem('ada_session');
        if (!session) return null;
        const decoded = atob(session);
        return decoded.split(':')[0] || null;
    } catch (e) {
        return null;
    }
}

async function applyApiKeyMode(mode, { silent = false } = {}) {
    setApiKeyMode(mode);
    const password = getSessionPassword();
    if (!password) return;
    const apiKey = await decryptApiKey(password, mode);
    if (apiKey) {
        API_KEY = apiKey;
        if (!silent) {
            const label = mode === 'costs' ? 'calcolo consumi' : 'generale';
            showToast(`API key impostata su "${label}"`, 'success');
        }
    } else if (!silent) {
        showToast('API key non valida', 'error');
    }
}

function initApiKeySelector() {
    const selector = document.getElementById('apiKeyModeSelector');
    if (!selector) return;
    const mode = getApiKeyMode();
    selector.value = mode;
    selector.addEventListener('change', async () => {
        await applyApiKeyMode(selector.value);
    });
}

// ============================================
// DEBUG LOG SETTINGS
// ============================================

function initDebugLogSetting() {
    const saved = localStorage.getItem('ada_debug_log');
    debugLogEnabled = saved !== 'false';
    const checkbox = document.getElementById('debugLogEnabled');
    if (checkbox) checkbox.checked = debugLogEnabled;
}

function toggleDebugLog(enabled) {
    debugLogEnabled = enabled;
    localStorage.setItem('ada_debug_log', enabled ? 'true' : 'false');
    showToast(enabled ? 'Log debug attivato' : 'Log debug disattivato', 'success');

    // Debug ON exposes test-only UI tools (long audio/text loaders) and audio cache controls
    try { updateDebugToolsVisibility(); } catch (e) {}
    try { if (typeof refreshAudioCacheInfo === 'function') refreshAudioCacheInfo(); } catch (e) {}
}

// ============================================
// CLINIC LOGO SETTINGS
// ============================================

const ADA_CLINIC_LOGO_KEY = 'ada_clinic_logo';
const ADA_DEFAULT_LOGO_SRC = 'logo-anicura.png';

function getClinicLogoSrc() {
    try {
        return localStorage.getItem(ADA_CLINIC_LOGO_KEY) || ADA_DEFAULT_LOGO_SRC;
    } catch (e) {
        return ADA_DEFAULT_LOGO_SRC;
    }
}

function setClinicLogoSrc(value) {
    try {
        if (!value || value === ADA_DEFAULT_LOGO_SRC) {
            localStorage.removeItem(ADA_CLINIC_LOGO_KEY);
        } else {
            localStorage.setItem(ADA_CLINIC_LOGO_KEY, value);
        }
    } catch (e) {}
}

function applyClinicLogo(src) {
    const logo = document.getElementById('clinicLogo');
    const preview = document.getElementById('clinicLogoPreview');
    const hidden = document.getElementById('anicuraLogoImg');
    if (logo) logo.src = src;
    if (preview) preview.src = src;
    if (hidden) {
        hidden.src = src;
        hidden.crossOrigin = 'anonymous';
    }
}

function handleClinicLogoUpload(event) {
    const input = event?.target;
    const file = input?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        const src = String(reader.result || '');
        if (!src) return;
        setClinicLogoSrc(src);
        applyClinicLogo(src);
        showToast('Logo aggiornato', 'success');
        if (input) input.value = '';
    };
    reader.readAsDataURL(file);
}

function resetClinicLogo() {
    setClinicLogoSrc(ADA_DEFAULT_LOGO_SRC);
    applyClinicLogo(ADA_DEFAULT_LOGO_SRC);
    showToast('Logo ripristinato', 'success');
}

function initClinicLogoSetting() {
    const input = document.getElementById('clinicLogoInput');
    applyClinicLogo(getClinicLogoSrc());
    if (input) input.addEventListener('change', handleClinicLogoUpload);
}

const ADA_CLINIC_LOGO_SECTION_KEY = 'ada_clinic_logo_section_open';

function toggleClinicLogoSection(forceOpen) {
    const body = document.getElementById('clinicLogoSectionBody');
    const icon = document.getElementById('clinicLogoToggleIcon');
    if (!body) return;
    const isOpenNow = body.style.display !== 'none' && body.style.display !== ''
        ? true
        : (getComputedStyle(body).display !== 'none');
    const nextOpen = (typeof forceOpen === 'boolean') ? forceOpen : !isOpenNow;
    body.style.display = nextOpen ? '' : 'none';
    if (icon) icon.textContent = nextOpen ? '▾' : '▸';
    try { localStorage.setItem(ADA_CLINIC_LOGO_SECTION_KEY, nextOpen ? 'true' : 'false'); } catch (e) {}
}

function restoreClinicLogoSectionState() {
    let open = true;
    try {
        const stored = localStorage.getItem(ADA_CLINIC_LOGO_SECTION_KEY);
        if (stored !== null) open = stored !== 'false';
    } catch (e) {}
    toggleClinicLogoSection(open);
}

// ============================================
// CHUNK RECORDING SETTINGS (v6.17.3)
// ============================================

const ADA_CHUNKING_ENABLED_KEY = 'ada_chunking_enabled';
const ADA_CHUNKING_PROFILE_KEY = 'ada_chunking_profile';
const ADA_CHUNKING_CONFIG_KEY_PREFIX = 'ada_chunking_config_';
const ADA_CHUNKING_SECTION_OPEN_KEY = 'ada_chunking_section_open';

function toggleChunkingSection(forceOpen) {
    const body = document.getElementById('chunkingSectionBody');
    const icon = document.getElementById('chunkingToggleIcon');
    if (!body) return;
    const isOpen = typeof forceOpen === 'boolean' ? forceOpen : body.style.display === 'none';
    body.style.display = isOpen ? '' : 'none';
    if (icon) icon.textContent = isOpen ? '▾' : '▸';
    try { localStorage.setItem(ADA_CHUNKING_SECTION_OPEN_KEY, isOpen ? 'true' : 'false'); } catch (e) {}
}

function initChunkingSectionToggle() {
    let open = true;
    try {
        const stored = localStorage.getItem(ADA_CHUNKING_SECTION_OPEN_KEY);
        if (stored !== null) open = stored !== 'false';
    } catch (e) {}
    toggleChunkingSection(open);
}

function detectRecordingProfile() {
    const ua = (navigator.userAgent || '').toString();
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    const isWindows = /Windows/.test(ua);
    if (isIOS) return 'iphone';
    if (isAndroid) return 'android';
    if (isWindows) return 'windows';
    return 'desktop';
}

function chooseBestSupportedMimeType(profile) {
    // Prefer Opus/WebM on desktop/Android, MP4/AAC on iPhone if available.
    const candidates = profile === 'iphone'
        ? ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
        : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];

    try {
        for (const t of candidates) {
            if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
        }
    } catch (e) {}
    return ''; // let the browser choose
}

function _defaultChunkingConfig(profile) {
    // Defaults tuned to stay under the 25MB transcription cap and reduce iPhone instability.
    if (profile === 'iphone') {
        return {
            chunkDurationSec: 1200,
            timesliceMs: 1000,
            maxPendingChunks: 2,
            maxConcurrentTranscriptions: 1,
            uploadRetryCount: 2,
            uploadRetryBackoffMs: 1800,
            hardStopAtMb: 23,
            warnBeforeSplitSec: 25,
            autoSplitGraceMs: 450
        };
    }
    if (profile === 'android') {
        return {
            chunkDurationSec: 900,
            timesliceMs: 1000,
            maxPendingChunks: 3,
            maxConcurrentTranscriptions: 1,
            uploadRetryCount: 2,
            uploadRetryBackoffMs: 1500,
            hardStopAtMb: 23,
            warnBeforeSplitSec: 20,
            autoSplitGraceMs: 250
        };
    }
    // windows/desktop
    return {
        chunkDurationSec: 600,
        timesliceMs: 1000,
        maxPendingChunks: 4,
        maxConcurrentTranscriptions: 1,
        uploadRetryCount: 2,
        uploadRetryBackoffMs: 1300,
        hardStopAtMb: 23,
        warnBeforeSplitSec: 20,
        autoSplitGraceMs: 200
    };
}

function getChunkingEnabled() {
    const v = localStorage.getItem(ADA_CHUNKING_ENABLED_KEY);
    if (v === null) return true; // default ON
    return v !== 'false';
}

function setChunkingEnabled(enabled) {
    localStorage.setItem(ADA_CHUNKING_ENABLED_KEY, enabled ? 'true' : 'false');
}

function loadChunkingConfig(profile) {
    const key = ADA_CHUNKING_CONFIG_KEY_PREFIX + profile;
    try {
        const raw = localStorage.getItem(key);
        if (raw) {
            const parsed = JSON.parse(raw);
            return { ..._defaultChunkingConfig(profile), ...(parsed || {}) };
        }
    } catch (e) {}
    return _defaultChunkingConfig(profile);
}

function saveChunkingConfig(profile, cfg) {
    const key = ADA_CHUNKING_CONFIG_KEY_PREFIX + profile;
    try { localStorage.setItem(key, JSON.stringify(cfg || {})); } catch (e) {}
}

function toggleChunkingEnabled(enabled) {
    setChunkingEnabled(!!enabled);
    showToast(enabled ? 'Chunking attivato' : 'Chunking disattivato', 'success');
    try { if (typeof updateChunkingBadgesFromSettings === 'function') updateChunkingBadgesFromSettings(); } catch (e) {}
}

function updateDebugToolsVisibility() {
    const dbg = !!debugLogEnabled;
    const el1 = document.getElementById('debugTestTools');
    const el2 = document.getElementById('audioCacheTools');
    const nav = document.getElementById('nav-debug');
    const page = document.getElementById('page-debug');
    const runtime = document.getElementById('chunkingRuntime');
    if (el1) el1.style.display = dbg ? '' : 'none';
    if (el2) el2.style.display = dbg ? '' : 'none';
    if (nav) nav.style.display = dbg ? '' : 'none';
    if (page) page.style.display = dbg ? '' : 'none';
    if (!dbg && runtime) runtime.style.display = 'none';

    if (!dbg) {
        const activePage = document.querySelector('.page.active');
        if (activePage && activePage.id === 'page-debug') {
            navigateToPage('recording');
        }
    }

    // Refresh cache info when shown
    if (dbg) {
        try { if (typeof updateAudioCacheInfo === 'function') updateAudioCacheInfo(); } catch (e) {}
    }
}

function initChunkingSettings() {
    // Device profile is auto-detected and shown read-only.
    const profile = detectRecordingProfile();
    try { localStorage.setItem(ADA_CHUNKING_PROFILE_KEY, profile); } catch (e) {}

    const profileEl = document.getElementById('chunkingProfile');
    if (profileEl) profileEl.value = profile;

    const mime = chooseBestSupportedMimeType(profile) || '(auto)';
    const mimeEl = document.getElementById('chunkingMimeType');
    if (mimeEl) mimeEl.value = mime;

    // Enabled toggle
    const enabledEl = document.getElementById('chunkingEnabled');
    if (enabledEl) enabledEl.checked = getChunkingEnabled();

    const cfg = loadChunkingConfig(profile);

    const bindNum = (id, key, min, max) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = cfg[key];
        el.addEventListener('input', () => {
            let v = Number(el.value);
            if (!Number.isFinite(v)) v = cfg[key];
            if (min !== undefined) v = Math.max(min, v);
            if (max !== undefined) v = Math.min(max, v);
            cfg[key] = v;
            saveChunkingConfig(profile, cfg);
            try { if (typeof updateChunkingBadgesFromSettings === 'function') updateChunkingBadgesFromSettings(); } catch (e) {}
        });
    };

    bindNum('chunkDurationSec', 'chunkDurationSec', 60, 60 * 60);
    bindNum('timesliceMs', 'timesliceMs', 250, 10000);
    bindNum('maxPendingChunks', 'maxPendingChunks', 1, 20);
    bindNum('maxConcurrentTranscriptions', 'maxConcurrentTranscriptions', 1, 4);
    bindNum('uploadRetryCount', 'uploadRetryCount', 0, 10);
    bindNum('uploadRetryBackoffMs', 'uploadRetryBackoffMs', 200, 20000);
    bindNum('hardStopAtMb', 'hardStopAtMb', 1, 24);
    bindNum('warnBeforeSplitSec', 'warnBeforeSplitSec', 0, 180);
    bindNum('autoSplitGraceMs', 'autoSplitGraceMs', 0, 5000);

    // Ensure debug-only controls are in the right visibility on startup
    try { updateDebugToolsVisibility(); } catch (e) {}

    // Let recording module refresh its UI badges at startup
    try { if (typeof updateChunkingBadgesFromSettings === 'function') updateChunkingBadgesFromSettings(); } catch (e) {}
}

function initVisualizer() {
    const visualizer = document.getElementById('visualizer');
    if (!visualizer) return;
    visualizer.innerHTML = '';
    for (let i = 0; i < 20; i++) {
        const bar = document.createElement('div');
        bar.className = 'visualizer-bar';
        bar.style.height = '5px';
        visualizer.appendChild(bar);
    }
}

// ============================================
// 8B: HIDE-EMPTY + EXTRAS + CHECKLIST (template)
// ============================================

const ADA_HIDE_EMPTY_KEY = 'ada_hide_empty_fields';

function initHideEmptyToggle() {
    try {
        hideEmptyFields = localStorage.getItem(ADA_HIDE_EMPTY_KEY) === 'true';
    } catch (e) {
        hideEmptyFields = false;
    }
    const t = document.getElementById('hideEmptyToggle');
    if (t) t.checked = hideEmptyFields;

    // Live update visibility when editing SOAP
    ['soap-s', 'soap-o', 'soap-a', 'soap-p'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            if (hideEmptyFields) applyHideEmptyVisibility();
            else applyMissingHighlights();
        });
    });

    applyHideEmptyVisibility();
}

function setHideEmptyFields(enabled) {
    hideEmptyFields = !!enabled;
    try { localStorage.setItem(ADA_HIDE_EMPTY_KEY, hideEmptyFields ? 'true' : 'false'); } catch (e) {}
    // Re-render to apply hiding and missing highlights correctly
    renderTemplateExtras();
    renderChecklistInSOAP();
    applyHideEmptyVisibility();
}

function _getTemplateConfigSafe() {
    try {
        if (typeof TEMPLATE_CONFIGS !== 'undefined' && TEMPLATE_CONFIGS && TEMPLATE_CONFIGS[currentTemplate]) {
            return TEMPLATE_CONFIGS[currentTemplate];
        }
    } catch (e) {}
    return null;
}

function renderTemplateExtras() {
    const container = document.getElementById('extrasFields');
    const section = document.getElementById('extrasSection');
    if (!container || !section) return;

    const cfg = (typeof _get8BTemplateConfig === 'function') ? _get8BTemplateConfig() : null;
    if (!cfg || !Array.isArray(cfg.extraFields) || cfg.extraFields.length === 0) {
        section.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    section.style.display = '';

    container.innerHTML = cfg.extraFields.map(f => {
        const key = (f.key || '').toString();
        const id = `extra_${key}`;
        const rawLabel = (f.label || key).toString();
        const label = getTemplateLabelTranslation('extras', key, rawLabel);
        const hint = (f.hint || '').toString();
        const value = ((currentTemplateExtras && currentTemplateExtras[key]) ? currentTemplateExtras[key] : '').toString();

        const placeholder = hint.replace(/"/g, '&quot;');
        const labelForOnclick = label.replace(/'/g, "\\'");
        const safeValue = value.replace(/<\/textarea/gi, '<\/textarea');

        return `
            <div class="extra-field" data-extra-field="${key}">
                <label>${label}</label>
                <div class="textarea-wrapper">
                    <textarea id="${id}" rows="3" placeholder="${placeholder}"
                        oninput="updateExtraField('${key}', this.value)">${safeValue}</textarea>
                    <button class="expand-btn" onclick="expandTextarea('${id}', '${labelForOnclick}')">⛶</button>
                </div>
                ${hint ? `<span class="hint">${hint}</span>` : ''}
            </div>
        `;
    }).join('');

    applyMissingHighlights();
}

function applyMissingHighlights() {
    // SOAP sections
    ['soap-s', 'soap-o', 'soap-a', 'soap-p'].forEach(id => {
        const ta = document.getElementById(id);
        if (!ta) return;
        const wrapper = ta.closest('.soap-section');
        const empty = !String(ta.value || '').trim();
        if (wrapper) wrapper.classList.toggle('missing', empty && !hideEmptyFields);
    });
}

function applyHideEmptyVisibility() {
    // SOAP sections (hide if empty when toggle ON)
    ['soap-s', 'soap-o', 'soap-a', 'soap-p'].forEach(id => {
        const ta = document.getElementById(id);
        if (!ta) return;
        const wrapper = ta.closest('.soap-section');
        if (!wrapper) return;
        const empty = !String(ta.value || '').trim();
        wrapper.style.display = (hideEmptyFields && empty) ? 'none' : '';
        wrapper.classList.toggle('missing', empty && !hideEmptyFields);
    });

    // Extras fields
    const extrasSection = document.getElementById('extrasSection');
    const extrasContainer = document.getElementById('extrasFields');
    if (extrasSection && extrasContainer) {
        const fieldDivs = Array.from(extrasContainer.querySelectorAll('[data-extra-field]'));
        let anyVisible = false;
        fieldDivs.forEach(div => {
            const key = div.getAttribute('data-extra-field');
            const ta = div.querySelector('textarea');
            const empty = !String(ta?.value || '').trim();
            div.style.display = (hideEmptyFields && empty) ? 'none' : '';
            if (ta) ta.classList.toggle('missing', empty && !hideEmptyFields);
            if (div.style.display !== 'none') anyVisible = true;
        });
        extrasSection.style.display = anyVisible ? '' : (hideEmptyFields ? 'none' : '');
    }

    // Checklist items are hidden/shown in renderChecklistInSOAP; ensure missing highlights consistent
    renderChecklistInSOAP();
}

// ============================================
// CHECKLIST (Template-specific)
// ============================================

function initChecklist() {
    // Restore open/closed state
    try {
        const open = localStorage.getItem('ada_checklist_open') === 'true';
        const el = document.getElementById('checklistCollapsible');
        if (el) el.classList.toggle('open', open);
    } catch (e) {}

    try { renderChecklistInSOAP(); } catch (e) {}
}

function toggleChecklist() {
    const el = document.getElementById('checklistCollapsible');
    if (!el) return;
    el.classList.toggle('open');
    try { localStorage.setItem('ada_checklist_open', el.classList.contains('open') ? 'true' : 'false'); } catch (e) {}
}

function resetChecklist() {
    currentSOAPChecklist = {};
    try { renderChecklistInSOAP(); } catch (e) {}
    try { scheduleTemplateDraftSave(); } catch (e) {}
}

function toggleChecklistItem(key) {
    const k = String(key || '').trim();
    if (!k) return;
    const cur = currentSOAPChecklist?.[k];

    // tri-state: undefined -> true -> false -> undefined
    let next;
    if (cur === true) next = false;
    else if (cur === false) next = undefined;
    else next = true;

    if (next === undefined) {
        try { delete currentSOAPChecklist[k]; } catch (e) {}
    } else {
        currentSOAPChecklist[k] = next;
    }

    try { renderChecklistInSOAP(); } catch (e) {}
    try { scheduleTemplateDraftSave(); } catch (e) {}
}

function renderChecklistInSOAP() {
    const grid = document.getElementById('checklistGrid');
    if (!grid) return;

    const cfg = _getTemplateConfigSafe();
    const items = (cfg && Array.isArray(cfg.checklistItems)) ? cfg.checklistItems : [];
    if (!items.length) {
        grid.innerHTML = '<p style="color:#888;margin:0;">Nessuna checklist per questo template</p>';
        return;
    }

    const st = (currentSOAPChecklist && typeof currentSOAPChecklist === 'object') ? currentSOAPChecklist : {};

    // Build DOM with data-key to avoid inline onclick quote issues
    grid.innerHTML = items.map(it => {
        const key = String(it.key ?? '').trim();
        const rawLabel = (it.label || key).toString();
        const label = _escapeHtml(getTemplateLabelTranslation('checklist', key, rawLabel));
        const val = st[key];
        const cls = val === true ? 'checked' : (val === false ? 'unchecked' : '');
        const badge = val === true ? '✓' : (val === false ? '✗' : '•');

        // Escape attribute double-quotes minimally
        const safeKey = key.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        return `<button type="button" class="checklist-item ${cls}" data-key="${safeKey}">${badge} ${label}</button>`;
    }).join('');

    // Bind click handlers
    grid.querySelectorAll('.checklist-item').forEach(el => {
        el.addEventListener('click', (ev) => {
            const k = el.getAttribute('data-key') || '';
            toggleChecklistItem(k);
        });
    });
}


// ============================================
// FULLSCREEN TEXTAREA
// ============================================

let fullscreenCorrectionRecorder = null;
let fullscreenCorrectionChunks = [];

function expandTextarea(textareaId, title) {
    fullscreenTargetId = textareaId;
    const target = document.getElementById(textareaId);
    const fullscreenTitle = document.getElementById('fullscreenTitle');
    const fullscreenTa = document.getElementById('fullscreenTextarea');
    const btnCorrect = document.getElementById('btnCorrectFullscreen');

    const isTranscription = textareaId === 'transcriptionText';
    const isReadOnly = isTranscription && transcriptionMode === 'audio';
    const resolvedTitle = isTranscription
        ? (isReadOnly ? 'Testo trascritto' : 'Testo caricato')
        : (title || 'Testo');

    if (fullscreenTitle) fullscreenTitle.textContent = resolvedTitle;
    if (fullscreenTa) {
        fullscreenTa.value = target ? target.value : '';
        fullscreenTa.readOnly = !!isReadOnly;
        fullscreenTa.classList.toggle('readonly-transcription', !!isReadOnly);
    }
    document.getElementById('textareaFullscreen').classList.add('active');
    // Reset correction state
    document.getElementById('fullscreenCorrectionButtons').style.display = 'none';
    if (btnCorrect) btnCorrect.style.display = isReadOnly ? 'none' : '';
}

function closeFullscreenTextarea() {
    if (fullscreenTargetId) {
        const target = document.getElementById(fullscreenTargetId);
        const fullscreenTa = document.getElementById('fullscreenTextarea');
        // Do not overwrite read-only fields (e.g., audio transcription)
        if (target && fullscreenTa && !target.readOnly) {
            target.value = fullscreenTa.value;
        }
    }
    document.getElementById('textareaFullscreen').classList.remove('active');
    fullscreenTargetId = null;
    // Cancel any ongoing correction
    if (fullscreenCorrectionRecorder && fullscreenCorrectionRecorder.state === 'recording') {
        fullscreenCorrectionRecorder.stop();
    }
}

async function startFullscreenCorrection() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        fullscreenCorrectionRecorder = new MediaRecorder(stream);
        fullscreenCorrectionChunks = [];
        
        fullscreenCorrectionRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) fullscreenCorrectionChunks.push(e.data);
        };
        
        fullscreenCorrectionRecorder.onstop = () => {
            stream.getTracks().forEach(track => track.stop());
        };
        
        fullscreenCorrectionRecorder.start();
        
        document.getElementById('btnCorrectFullscreen').style.display = 'none';
        document.getElementById('fullscreenCorrectionButtons').style.display = 'flex';
        showToast('🎤 Registrazione correzione avviata', 'success');
        
    } catch (err) {
        showToast('Errore accesso microfono: ' + err.message, 'error');
    }
}

function cancelFullscreenCorrection() {
    if (fullscreenCorrectionRecorder && fullscreenCorrectionRecorder.state === 'recording') {
        fullscreenCorrectionRecorder.stop();
    }
    fullscreenCorrectionChunks = [];
    document.getElementById('fullscreenCorrectionButtons').style.display = 'none';
    document.getElementById('btnCorrectFullscreen').style.display = '';
    showToast('Correzione annullata', 'success');
}

async function sendFullscreenCorrection() {
    if (!fullscreenCorrectionRecorder) return;
    
    fullscreenCorrectionRecorder.stop();
    
    // Wait for data
    await new Promise(resolve => setTimeout(resolve, 200));
    
    const audioBlob = new Blob(fullscreenCorrectionChunks, { type: 'audio/webm' });
    const currentText = document.getElementById('fullscreenTextarea').value;
    
    showProgress(true);
    document.getElementById('fullscreenCorrectionButtons').style.display = 'none';
    
    try {
        // Transcribe correction
        const formData = new FormData();
        formData.append('file', audioBlob, 'correction.webm');
        formData.append('model', 'whisper-1');
        formData.append('language', 'it');
        
        const transcribeResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + API_KEY },
            body: formData
        });
        
        const transcribeResult = await transcribeResponse.json();
        if (transcribeResult.error) throw new Error(transcribeResult.error.message);
        
        const correctionText = transcribeResult.text;
        
        // Apply correction using GPT
        const applyResponse = await fetchApi('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: 'Sei un assistente che applica correzioni testuali. Applica le modifiche richieste al testo originale e restituisci SOLO il testo corretto, senza spiegazioni.' },
                    { role: 'user', content: `TESTO ORIGINALE:\n${currentText}\n\nCORREZIONE RICHIESTA:\n${correctionText}\n\nApplica la correzione e restituisci il testo modificato.` }
                ],
                temperature: 0.3
            })
        });
        
        const applyResult = await applyResponse.json();
        if (applyResult.error) throw new Error(applyResult.error.message);
        
        const correctedText = applyResult.choices[0].message.content;
        document.getElementById('fullscreenTextarea').value = correctedText;
        
        showToast('✅ Correzione applicata', 'success');
        
    } catch (err) {
        logError('Correzione fullscreen', err.message);
        showToast('Errore: ' + err.message, 'error');
    }
    
    showProgress(false);
    document.getElementById('btnCorrectFullscreen').style.display = '';
    fullscreenCorrectionChunks = [];
}

// ============================================
// LIFESTYLE SECTION
// ============================================

function toggleLifestyleSection() {
    document.getElementById('lifestyleSection').classList.toggle('open');
}

// ============================================
// SETTINGS: SPEAKERS SECTION COLLAPSE
// ============================================

function toggleSpeakersSection(forceOpen) {
    const body = document.getElementById('speakersSectionBody');
    const icon = document.getElementById('speakersToggleIcon');
    if (!body || !icon) return;

    const isOpenNow = body.style.display !== "none" && body.style.display !== "" ? true : (getComputedStyle(body).display !== "none");
    const nextOpen = (typeof forceOpen === "boolean") ? forceOpen : !isOpenNow;

    body.style.display = nextOpen ? "" : "none";
    icon.textContent = nextOpen ? "▾" : "▸";

    try {
        localStorage.setItem('ada_speakers_section_open', nextOpen ? "1" : "0");
    } catch (e) {}
}

function restoreSpeakersSectionState() {
    // Default is CLOSED
    let open = false;
    try {
        open = localStorage.getItem('ada_speakers_section_open') === "1";
    } catch (e) {
        open = false;
    }
    toggleSpeakersSection(open);
}

// ============================================
// UTILITIES
// ============================================

function showToast(message, type) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + type + ' show';
    setTimeout(() => toast.classList.remove('show'), 3000);
}

function showProgress(show) { 
    document.getElementById('progressBar').classList.toggle('active', show); 
}

function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// Global error logging function
function logError(context, errorMessage) {
    if (!debugLogEnabled) return;
    
    const now = new Date();
    const timestamp = now.toLocaleString('it-IT', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    
    const logEntry = `[${timestamp}] ${context}: ${errorMessage}\n`;
    
    let existingLog = localStorage.getItem('ADA_LOG') || '';
    existingLog += logEntry;
    localStorage.setItem('ADA_LOG', existingLog);
    
    console.error(`[ADA LOG] ${context}:`, errorMessage);
}

// Credit exhausted modal
function showCreditExhaustedModal() {
    document.getElementById('creditExhaustedModal').classList.add('active');
}

function closeCreditExhaustedModal() {
    document.getElementById('creditExhaustedModal').classList.remove('active');
}

// Check API response for credit issues
function checkCreditExhausted(errorText) {
    if (errorText && (errorText.includes('insufficient_quota') || 
        errorText.includes('exceeded') || 
        errorText.includes('billing') ||
        errorText.includes('rate_limit'))) {
        showCreditExhaustedModal();
        return true;
    }
    return false;
}

// ============================================
// VITALS
// ============================================

function initVitalsDateTime() {
    const dateTimeInput = document.getElementById('vitalDateTime');
    if (dateTimeInput) {
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60000;
        const localISOTime = new Date(now - offset).toISOString().slice(0, 16);
        dateTimeInput.value = localISOTime;
    }
}

function initVitalsChart() {
    const canvas = document.getElementById('vitalsChart');
    if (!canvas) return;
    
    if (vitalsChart) vitalsChart.destroy();
    
    vitalsChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                { label: 'Peso (kg)', data: [], borderColor: '#1e3a5f', backgroundColor: 'rgba(30,58,95,0.1)', tension: 0.1, yAxisID: 'y' },
                { label: 'Temperatura (°C)', data: [], borderColor: '#c24e17', backgroundColor: 'rgba(194,78,23,0.1)', tension: 0.1, yAxisID: 'y1' }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { type: 'linear', position: 'left', title: { display: true, text: 'Peso (kg)' } },
                y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Temp (°C)' } }
            }
        }
    });
    updateVitalsChart();
}

function updateVitalsChart() {
    // Always render the list, even if the chart is not initialized yet
    try { renderVitalsList(); } catch (e) {}
    if (!vitalsChart) return;
    try { if (typeof vitalsChart.resize === 'function') vitalsChart.resize(); } catch (e) {}
    const sorted = [...vitalsData].sort((a, b) => new Date(a.date) - new Date(b.date));
    vitalsChart.data.labels = sorted.map(v => new Date(v.date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }));
    vitalsChart.data.datasets[0].data = sorted.map(v => v.weight || null);
    vitalsChart.data.datasets[1].data = sorted.map(v => v.temp || null);
    vitalsChart.update();
}

function renderVitalsList() {
    const list = document.getElementById('vitalsList');
    if (!list) return;
    if (vitalsData.length === 0) {
        list.innerHTML = '<p style="color:#888;text-align:center;">Nessun parametro registrato</p>';
        return;
    }
    const sorted = [...vitalsData].sort((a, b) => new Date(b.date) - new Date(a.date));

    const fmt = (iso) => {
        try {
            return new Date(iso).toLocaleString('it-IT', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit'
            });
        } catch (_) {
            return new Date(iso).toLocaleString('it-IT');
        }
    };

    const vOrDash = (v) => (v === null || v === undefined || v === '' || Number.isNaN(v)) ? '-' : v;

    list.innerHTML = sorted.map((v) => {
        const idx = vitalsData.indexOf(v);
        const weight = vOrDash(v.weight);
        const temp = vOrDash(v.temp);
        const hr = vOrDash(v.hr);
        const rr = vOrDash(v.rr);

        return `
        <div class="vital-record">
            <span class="vital-date">${fmt(v.date)}</span>
            <span>Peso: ${weight} kg | T: ${temp} °C | FC ${hr} bpm | FR ${rr}</span>
            <button class="btn-small btn-danger" onclick="deleteVital(${idx})">🗑</button>
        </div>
    `;
    }).join('');
}


function deleteVital(index) {
    if (confirm('Eliminare questa rilevazione?')) {
        vitalsData.splice(index, 1);
        saveData();
        updateVitalsChart();
        showToast('Rilevazione eliminata', 'success');
    }
}

function recordVitals() {
    const dateTime = document.getElementById('vitalDateTime')?.value;
    const vital = {
        date: dateTime ? new Date(dateTime).toISOString() : new Date().toISOString(),
        weight: parseFloat(document.getElementById('vitalWeight').value) || null,
        temp: parseFloat(document.getElementById('vitalTemp').value) || null,
        hr: parseInt(document.getElementById('vitalHR').value) || null,
        rr: parseInt(document.getElementById('vitalRR').value) || null
    };
    if (!vital.weight && !vital.temp && !vital.hr && !vital.rr) {
        showToast('Inserisci almeno un parametro', 'error');
        return;
    }
    vitalsData.push(vital);
    saveData();
    updateVitalsChart();
    document.getElementById('vitalWeight').value = '';
    document.getElementById('vitalTemp').value = '';
    document.getElementById('vitalHR').value = '';
    document.getElementById('vitalRR').value = '';
    initVitalsDateTime();
    showToast('Parametri registrati', 'success');
}

function resetVitals() {
    if (!confirm('Azzera tutti i parametri vitali registrati per questo paziente?')) return;
    vitalsData = [];
    saveData();
    updateVitalsChart();
    document.getElementById('vitalWeight').value = '';
    document.getElementById('vitalTemp').value = '';
    document.getElementById('vitalHR').value = '';
    document.getElementById('vitalRR').value = '';
    initVitalsDateTime();
    showToast('Parametri vitali azzerati', 'success');
}


// ============================================
// COST & USAGE TRACKING
// ============================================

function ensureApiUsageShape() {
    if (!apiUsage || typeof apiUsage !== 'object') {
        apiUsage = {
            gpt4o_transcribe_minutes: 0,
            whisper_minutes: 0,
            gpt4o_input_tokens: 0,
            gpt4o_output_tokens: 0,
            gpt4o_mini_input_tokens: 0,
            gpt4o_mini_output_tokens: 0,
            tts_input_chars: 0
        };
        return;
    }
    const defaults = {
        gpt4o_transcribe_minutes: 0,
        whisper_minutes: 0,
        gpt4o_input_tokens: 0,
        gpt4o_output_tokens: 0,
        gpt4o_mini_input_tokens: 0,
        gpt4o_mini_output_tokens: 0,
        tts_input_chars: 0
    };
    for (const [k, v] of Object.entries(defaults)) {
        if (typeof apiUsage[k] !== 'number') apiUsage[k] = v;
    }
}

function estimateTokensFromText(text) {
    // Rough estimate: ~4 characters per token
    const len = (text || '').length;
    return Math.max(1, Math.ceil(len / 4));
}

function trackChatUsage(model, usage) {
    if (!usage) return;
    ensureApiUsageShape();

    const pt = Number(usage.prompt_tokens || 0);
    const ct = Number(usage.completion_tokens || 0);

    if (String(model).startsWith('gpt-4o-mini')) {
        apiUsage.gpt4o_mini_input_tokens += pt;
        apiUsage.gpt4o_mini_output_tokens += ct;
    } else {
        apiUsage.gpt4o_input_tokens += pt;
        apiUsage.gpt4o_output_tokens += ct;
    }

    saveApiUsage();
    updateCostDisplay();
}

function trackTranscriptionMinutes(minutes, type = 'gpt4o') {
    ensureApiUsageShape();
    const m = Number(minutes || 0);
    if (!isFinite(m) || m <= 0) return;
    if (type === 'whisper') apiUsage.whisper_minutes += m;
    else apiUsage.gpt4o_transcribe_minutes += m;

    saveApiUsage();
    updateCostDisplay();
}

function trackTtsTokens(text) {
    // NOTE: tts-1 pricing is per 1M characters, not per text tokens.
    ensureApiUsageShape();
    apiUsage.tts_input_chars += (text || '').length;
    saveApiUsage();
    updateCostDisplay();
}


function updateCostDisplay() {
    const costList = document.getElementById('costList');
    if (!costList) return;

    ensureApiUsageShape();

    let total = 0;
    const rows = [
        { api: 'gpt-4o-transcribe-diarize', key: 'gpt4o_transcribe_minutes', icon: '🎤' },
        { api: 'whisper-1 (fallback)', key: 'whisper_minutes', icon: '🎧' },
        { api: 'gpt-4o input', key: 'gpt4o_input_tokens', icon: '🧠' },
        { api: 'gpt-4o output', key: 'gpt4o_output_tokens', icon: '🧾' },
        { api: 'gpt-4o-mini input', key: 'gpt4o_mini_input_tokens', icon: '🧩' },
        { api: 'gpt-4o-mini output', key: 'gpt4o_mini_output_tokens', icon: '🧩' },
        { api: 'tts-1', key: 'tts_input_chars', icon: '🔊' }
    ];

    costList.innerHTML = rows.map(row => {
        const usage = apiUsage[row.key] || 0;
        const costInfo = API_COSTS[row.key] || { costPerUnit: 0, unit: 'unità', label: row.api };
        const cost = usage * costInfo.costPerUnit;
        total += cost;

        const unitLabel = costInfo.unit === 'tokens' ? 'tokens' : costInfo.unit;
        const priceLabel = costInfo.unit === 'tokens'
            ? `$ ${(costInfo.costPerUnit * 1000000).toFixed(2)}/1M tokens`
            : (costInfo.unit === 'caratteri'
                ? `$ ${(costInfo.costPerUnit * 1000000).toFixed(2)}/1M caratteri`
                : `$ ${costInfo.costPerUnit.toFixed(4)}/${unitLabel}`);
        const usageLabel = costInfo.unit === 'tokens'
            ? Math.round(usage).toLocaleString('it-IT')
            : (costInfo.unit === 'caratteri'
                ? Math.round(usage).toLocaleString('it-IT')
                : usage.toFixed(2));

        return `
            <div class="cost-item">
                <div class="cost-item-header">${row.icon} ${costInfo.label || row.api}</div>
                <div class="cost-item-detail"><span>Prezzo</span><span>${priceLabel}</span></div>
                <div class="cost-item-detail"><span>Uso (${unitLabel})</span><span>${usageLabel}</span></div>
                <div class="cost-item-total">$ ${cost.toFixed(4)}</div>
            </div>
        `;
    }).join('');

    const totalEl = document.getElementById('totalCost');
    if (totalEl) totalEl.textContent = '$ ' + total.toFixed(2);

    const resetInfo = document.getElementById('lastResetInfo');
    if (resetInfo) {
        resetInfo.textContent = lastResetDate ? `Ultimo azzeramento: ${new Date(lastResetDate).toLocaleString('it-IT')}` : 'Ultimo azzeramento: mai';
    }
}

function resetCosts() {
    if (confirm('Azzerare tutti i contatori?')) {
        apiUsage = {
            gpt4o_transcribe_minutes: 0,
            whisper_minutes: 0,
            gpt4o_input_tokens: 0,
            gpt4o_output_tokens: 0,
            gpt4o_mini_input_tokens: 0,
            gpt4o_mini_output_tokens: 0,
            tts_input_chars: 0
        };
        lastResetDate = new Date().toISOString();
        localStorage.setItem('ada_last_reset', lastResetDate);
        saveApiUsage();
        updateCostDisplay();
        showToast('Contatori azzerati', 'success');
    }
}

function saveApiUsage() {
    ensureApiUsageShape();
    localStorage.setItem('ada_api_usage', JSON.stringify(apiUsage));
}

function loadApiUsage() {
    const saved = localStorage.getItem('ada_api_usage');
    if (saved) {
        try { apiUsage = JSON.parse(saved); } catch { apiUsage = null; }
    } else {
        apiUsage = null;
    }
    ensureApiUsageShape();
    lastResetDate = localStorage.getItem('ada_last_reset');
}

// ============================================
// LANGUAGE SELECTORS
// ============================================

const ADA_LANG_STATE_PREFIX = 'ada_lang_state_';

function _getLangStateKey(selectorId) {
    if (selectorId === 'diaryLangSelector') {
        return `${ADA_LANG_STATE_PREFIX}${selectorId}`;
    }
    const docId = currentEditingHistoryId || 'draft';
    return `${ADA_LANG_STATE_PREFIX}${selectorId}_${docId}`;
}

function getStoredLangForSelector(selectorId) {
    try {
        return localStorage.getItem(_getLangStateKey(selectorId)) || 'IT';
    } catch (e) {
        return 'IT';
    }
}

function storeLangForSelector(selectorId, lang) {
    try {
        localStorage.setItem(_getLangStateKey(selectorId), lang);
    } catch (e) {}
}

function setActiveLangButton(selectorId, lang) {
    const selector = document.getElementById(selectorId);
    if (!selector) return;
    selector.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.remove('active');
    });
}

function syncLangSelectorsForCurrentDoc() {
    const soapLang = getStoredLangForSelector('soapLangSelector');
    setActiveLangButton('soapLangSelector', soapLang);
    try { updateSOAPLabels(soapLang); } catch (e) {}
    setActiveLangButton('ownerLangSelector', getStoredLangForSelector('ownerLangSelector'));
    setActiveLangButton('diaryLangSelector', getStoredLangForSelector('diaryLangSelector'));
}

function _getTemplateTranslationStore(store, lang) {
    const tpl = (currentTemplate || 'generale').toString();
    if (!store[tpl]) store[tpl] = {};
    if (!store[tpl][lang]) store[tpl][lang] = {};
    return store[tpl][lang];
}

function getTemplateLabelTranslation(kind, key, fallback) {
    const lang = getStoredLangForSelector('soapLangSelector');
    if (lang === 'IT') return fallback;
    const store = kind === 'extras' ? extraLabelTranslations : checklistLabelTranslations;
    const tpl = (currentTemplate || 'generale').toString();
    const translated = store?.[tpl]?.[lang]?.[key];
    return translated || fallback;
}

async function translateExtrasValues(lang) {
    const container = document.getElementById('extrasFields');
    if (!container) return;
    const fields = Array.from(container.querySelectorAll('[data-extra-field]'));
    for (const field of fields) {
        const key = field.getAttribute('data-extra-field');
        const ta = field.querySelector('textarea');
        const value = (ta?.value || '').trim();
        if (!key || !value) continue;
        const translated = await translateText(value, lang);
        if (ta) ta.value = translated;
        if (currentTemplateExtras && typeof currentTemplateExtras === 'object') {
            currentTemplateExtras[key] = translated;
        }
    }
    try { scheduleTemplateDraftSave(); } catch (e) {}
    try { applyHideEmptyVisibility(); } catch (e) {}
}

async function translateTemplateLabels(lang) {
    const cfg = _getTemplateConfigSafe();
    if (!cfg) return;

    if (lang === 'IT') {
        const tpl = (currentTemplate || 'generale').toString();
        if (extraLabelTranslations[tpl]) delete extraLabelTranslations[tpl][lang];
        if (checklistLabelTranslations[tpl]) delete checklistLabelTranslations[tpl][lang];
        try { renderTemplateExtras(); } catch (e) {}
        try { renderChecklistInSOAP(); } catch (e) {}
        return;
    }

    const extras = Array.isArray(cfg.extraFields) ? cfg.extraFields : [];
    const checklistItems = Array.isArray(cfg.checklistItems) ? cfg.checklistItems : [];
    const extrasStore = _getTemplateTranslationStore(extraLabelTranslations, lang);
    const checklistStore = _getTemplateTranslationStore(checklistLabelTranslations, lang);

    for (const f of extras) {
        const key = (f.key || '').toString();
        if (!key || extrasStore[key]) continue;
        const label = (f.label || key).toString();
        extrasStore[key] = await translateText(label, lang);
    }

    for (const it of checklistItems) {
        const key = (it.key || '').toString();
        if (!key || checklistStore[key]) continue;
        const label = (it.label || key).toString();
        checklistStore[key] = await translateText(label, lang);
    }

    try { renderTemplateExtras(); } catch (e) {}
    try { renderChecklistInSOAP(); } catch (e) {}
}

function initLanguageSelectors() {
    document.querySelectorAll('.lang-selector').forEach(selector => {
        selector.querySelectorAll('.lang-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const lang = btn.dataset.lang;
                const selectorId = selector.id;
                const currentLang = getStoredLangForSelector(selectorId);
                if (lang === currentLang) return;

                storeLangForSelector(selectorId, lang);
                
                showProgress(true);
                try {
                    if (selectorId === 'soapLangSelector') {
                        // Translate SOAP labels
                        updateSOAPLabels(lang);
                        
                        // Translate content
                        for (const fieldId of ['soap-s', 'soap-o', 'soap-a', 'soap-p']) {
                            const field = document.getElementById(fieldId);
                            if (field && field.value.trim()) field.value = await translateText(field.value, lang);
                        }
                        await translateExtrasValues(lang);
                        await translateTemplateLabels(lang);
                    } else if (selectorId === 'ownerLangSelector') {
                        const field = document.getElementById('ownerExplanation');
                        if (field && field.value.trim()) field.value = await translateText(field.value, lang);
                    } else if (selectorId === 'diaryLangSelector') {
                        const field = document.getElementById('diaryText');
                        if (field && field.value.trim()) field.value = await translateText(field.value, lang);
                    }
                    showToast('Traduzione completata', 'success');
                } catch (e) {
                    logError('Traduzione', e.message);
                    showToast('Errore traduzione', 'error');
                }
                showProgress(false);
            });
        });
    });
}

// SOAP label translations
const soapLabels = {
    IT: { S: 'Soggettivo', O: 'Oggettivo', A: 'Analisi clinica', P: 'Piano' },
    EN: { S: 'Subjective', O: 'Objective', A: 'Assessment', P: 'Plan' },
    DE: { S: 'Subjektiv', O: 'Objektiv', A: 'Beurteilung', P: 'Plan' },
    FR: { S: 'Subjectif', O: 'Objectif', A: 'Analyse', P: 'Plan' },
    ES: { S: 'Subjetivo', O: 'Objetivo', A: 'Análisis', P: 'Plan' }
};

function updateSOAPLabels(lang) {
    const labels = soapLabels[lang] || soapLabels.IT;
    document.getElementById('labelSoapS').textContent = labels.S;
    document.getElementById('labelSoapO').textContent = labels.O;
    document.getElementById('labelSoapA').textContent = labels.A;
    document.getElementById('labelSoapP').textContent = labels.P;
}

async function translateText(text, targetLang) {
    const response = await fetchApi('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: `Traduci in ${langNames[targetLang]}. Rispondi SOLO con la traduzione:\n\n${text}` }],
            temperature: 0.3
        })
    });
    const data = await response.json();
    trackChatUsage('gpt-4o', data.usage);
    return data.choices[0].message.content;
}

// ============================================
// HISTORY / ARCHIVIO (4A)
// ============================================

function resetSoapDraftLink() {
    currentEditingSOAPIndex = -1;
    currentEditingHistoryId = null;
  // v6.16.3: new visit should start clean (extras + checklist)
  currentTemplateExtras = {};
  currentSOAPChecklist = {};
  try { renderTemplateExtras && renderTemplateExtras(); } catch(e) {}
  try { renderChecklistInSOAP && renderChecklistInSOAP(); } catch(e) {}
  storeLangForSelector('soapLangSelector', 'IT');
  storeLangForSelector('ownerLangSelector', 'IT');
  syncLangSelectorsForCurrentDoc();
  try {
      const oe = document.getElementById('ownerExplanation');
      if (oe) oe.value = '';
      localStorage.removeItem('ada_draft_ownerExplanation');
  } catch (e) {}

}

function _escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function _generateArchiveId() {
    // deterministic enough for local storage (timestamp + random)
    return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function _getTemplateKeyFromRecord(item) {
    return item.templateKey || item.template || item.template_id || 'generale';
}

function _getCreatedAtFromRecord(item) {
    return item.createdAt || item.date || new Date().toISOString();
}

function _getSoapFromRecord(item) {
    const sd = item.soapData || item.soap || null;
    if (sd && typeof sd === 'object') {
        return {
            s: sd.s ?? sd.S ?? item.s ?? '',
            o: sd.o ?? sd.O ?? item.o ?? '',
            a: sd.a ?? sd.A ?? item.a ?? '',
            p: sd.p ?? sd.P ?? item.p ?? ''
        };
    }
    return {
        s: item.s || '',
        o: item.o || '',
        a: item.a || '',
        p: item.p || ''
    };
}

function _normalizeHistoryRecord(item) {
    if (!item || typeof item !== 'object') return null;

    const templateKey = _getTemplateKeyFromRecord(item);
    const createdAt = _getCreatedAtFromRecord(item);
    const soap = _getSoapFromRecord(item);

    // Title: keep existing titleDisplay if present; otherwise derive from template title
    const baseTitle = (item.titleDisplay || '').trim() || (templateTitles[templateKey] || 'Referto');

    const normalized = {
        ...item,
        id: item.id || _generateArchiveId(),
        titleDisplay: baseTitle,
        createdAt,
        templateKey,
        soapData: {
            s: soap.s,
            o: soap.o,
            a: soap.a,
            p: soap.p
        },

        // Back-compat fields (older code expects these)
        template: templateKey,
        date: createdAt,
        s: soap.s,
        o: soap.o,
        a: soap.a,
        p: soap.p
    };

    return normalized;
}

function migrateLegacyHistoryDataIfNeeded() {
    if (_historySchemaMigrated) return false;
    if (!Array.isArray(historyData) || historyData.length === 0) {
        _historySchemaMigrated = true;
        return false;
    }

    let changed = false;
    historyData = historyData.map((it) => {
        const n = _normalizeHistoryRecord(it);
        if (!n) { changed = true; return null; }
        if (!it.id || !it.titleDisplay || !it.createdAt || !it.templateKey || !it.soapData) changed = true;
        return n;
    }).filter(Boolean);

    _historySchemaMigrated = true;

    // Persist migration best-effort
    try { if (changed && typeof saveData === 'function') saveData(); } catch (e) {}
    return changed;
}

function _computeDedupTitle(baseTitle, excludeId = null) {
    const base = String(baseTitle || '').trim() || 'Referto';
    const existing = new Set(
        (historyData || [])
            .filter(r => r && (!excludeId || r.id !== excludeId))
            .map(r => String(r.titleDisplay || '').trim())
            .filter(Boolean)
    );
    if (!existing.has(base)) return base;
    let n = 2;
    while (n < 9999) {
        const candidate = `${base} (${n})`;
        if (!existing.has(candidate)) return candidate;
        n++;
    }
    return `${base} (${Date.now()})`;
}


// ============================================
// Q&A — Report selector (6.16.2)
// ============================================

function renderQnaReportDropdown() {
    try { migrateLegacyHistoryDataIfNeeded(); } catch (e) {}

    const sel = document.getElementById('qnaReportSelect');
    if (!sel) return;

    const sorted = (typeof _getHistorySortedForUI === 'function') ? _getHistorySortedForUI() : (historyData || []).slice();

    sel.innerHTML = '<option value="">-- Seleziona --</option>';

    if (!Array.isArray(sorted) || sorted.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Nessun referto in archivio';
        sel.appendChild(opt);
        return;
    }

    sorted.forEach(item => {
        if (!item || !item.id) return;
        const date = new Date(_getCreatedAtFromRecord(item));
        const title = item.titleDisplay || (templateTitles[_getTemplateKeyFromRecord(item)] || 'Visita');
        const patientName = item.patient?.petName || 'Paziente';
        const diarizedBadge = item.diarized ? '✅' : '⚠️';
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = `${diarizedBadge} ${date.toLocaleDateString('it-IT')} — ${patientName} — ${title}`;
        sel.appendChild(opt);
    });
}

async function openOrGenerateOwnerFromSelectedReport() {
    try { migrateLegacyHistoryDataIfNeeded(); } catch (e) {}

    const sel = document.getElementById('qnaReportSelect');
    const id = sel ? sel.value : '';
    if (!id) {
        showToast('Seleziona un referto', 'error');
        return;
    }

    const index = (historyData || []).findIndex(r => r && r.id === id);
    if (index < 0) {
        showToast('Referto non trovato', 'error');
        return;
    }

    const item = historyData[index];

    // Load record context (SOAP + patient) so Owner/FAQ work consistently
    const soap = _getSoapFromRecord(item);
    document.getElementById('soap-s').value = soap.s || '';
    document.getElementById('soap-o').value = soap.o || '';
    document.getElementById('soap-a').value = soap.a || '';
    document.getElementById('soap-p').value = soap.p || '';

    setPatientData(item.patient || {});

    currentTemplate = _getTemplateKeyFromRecord(item);
    currentEditingSOAPIndex = index;
    currentEditingHistoryId = id;
    syncLangSelectorsForCurrentDoc();

    currentTemplateExtras = item.extras || {};
    currentSOAPChecklist = item.checklist || {};
    lastTranscriptionDiarized = item.diarized || false;
    lastSOAPResult = item.structuredResult || null;

    // Sync template selector + render template-specific UI for this archived report
    try {
        const selector = document.getElementById('templateSelector');
        if (selector) selector.value = currentTemplate;
    } catch (e) {}
    try { document.getElementById('soapTemplateTitle').textContent = templateTitles[currentTemplate]; } catch (e) {}
    try { renderTemplateExtras(); } catch (e) {}
    try { renderChecklistInSOAP(); } catch (e) {}
    try { applyHideEmptyVisibility(); } catch (e) {}

    try {
        document.getElementById('soapTemplateTitle').textContent = templateTitles[currentTemplate] || 'Referto SOAP';
        renderChecklistInSOAP();
        // Keep template-specific extras in sync when the user later opens the SOAP page
        if (typeof renderTemplateExtras === 'function') renderTemplateExtras();
        if (typeof applyHideEmptyVisibility === 'function') applyHideEmptyVisibility();
        if (typeof applyMissingHighlights === 'function') applyMissingHighlights();
    } catch (e) {}

    // Clear glossary/FAQ to avoid stale content
    try {
        const gc = document.getElementById('glossaryContent');
        if (gc) gc.innerHTML = '';
        const fl = document.getElementById('faqList');
        if (fl) fl.innerHTML = '';
        const oe = document.getElementById('ownerExplanation');
        if (oe) oe.value = '';
        localStorage.removeItem('ada_draft_ownerExplanation');

    } catch (e) {}

    if (item.ownerExplanation && item.ownerExplanation.trim()) {
        const oe = document.getElementById('ownerExplanation');
        if (oe) oe.value = item.ownerExplanation;
        try { localStorage.setItem('ada_draft_ownerExplanation', item.ownerExplanation); } catch (e) {}
        navigateToPage('owner');
        showToast('Spiegazione proprietario aperta', 'success');
        return;
    }

    if (typeof generateOwnerExplanation !== 'function') {
        showToast('Funzione owner non disponibile', 'error');
        return;
    }

    await generateOwnerExplanation(soap, { saveToHistoryId: id, navigate: true });
}

function _getHistorySortedForUI() {
    return (historyData || [])
        .slice()
        .sort((a, b) => new Date(_getCreatedAtFromRecord(b)).getTime() - new Date(_getCreatedAtFromRecord(a)).getTime());
}

function renderHistory() {
    migrateLegacyHistoryDataIfNeeded();

    const list = document.getElementById('historyList');
    if (!list) return;
    if (!Array.isArray(historyData) || historyData.length === 0) {
        list.innerHTML = '<p style="color:#888;text-align:center;padding:20px;">Nessuna visita nello storico</p>';
        return;
    }

    const months = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

    const sorted = _getHistorySortedForUI();

    list.innerHTML = sorted.map((item) => {
        const id = item.id;
        const date = new Date(_getCreatedAtFromRecord(item));
        const diarizedBadge = item.diarized ? '✅' : '⚠️';
        const title = item.titleDisplay || (templateTitles[_getTemplateKeyFromRecord(item)] || 'Visita');
        const patientName = item.patient?.petName || 'Paziente';
        const aText = (item.soapData?.a || item.a || '').trim();

        return `
            <div class="history-item" onclick="loadHistoryById('${id}')">
                <div class="history-date">
                    <div class="day">${date.getDate()}</div>
                    <div class="month">${months[date.getMonth()]}</div>
                </div>
                <div class="history-info">
                    <h4>${diarizedBadge} ${_escapeHtml(patientName)} - ${_escapeHtml(title)}</h4>
                    <p>${aText ? _escapeHtml(aText.substring(0, 80) + (aText.length > 80 ? '...' : '')) : 'Nessuna diagnosi'}</p>
                </div>
                <button class="history-delete" onclick="event.stopPropagation(); deleteHistoryById('${id}')">×</button>
            </div>
        `;
    }).join('');
}


function loadHistoryById(id) {
    migrateLegacyHistoryDataIfNeeded();

    const index = (historyData || []).findIndex(r => r && r.id === id);
    if (index < 0) {
        showToast('Referto non trovato', 'error');
        return;
    }
    const item = historyData[index];

    const soap = _getSoapFromRecord(item);
    document.getElementById('soap-s').value = soap.s || '';
    document.getElementById('soap-o').value = soap.o || '';
    document.getElementById('soap-a').value = soap.a || '';
    document.getElementById('soap-p').value = soap.p || '';

    // Owner explanation (if stored)
    try {
        const oe = document.getElementById('ownerExplanation');
        if (oe) oe.value = item.ownerExplanation || '';
        localStorage.setItem('ada_draft_ownerExplanation', item.ownerExplanation || '');
    } catch (e) {}

    setPatientData(item.patient || {});

    currentTemplate = _getTemplateKeyFromRecord(item);
    currentEditingSOAPIndex = index; // keep for compatibility
    currentEditingHistoryId = id;
    syncLangSelectorsForCurrentDoc();

    
  // v6.16.3: restore per-report specialist extras
  currentTemplateExtras = (item.extras && typeof item.extras === 'object') ? item.extras : {};
currentSOAPChecklist = item.checklist || {};
    lastTranscriptionDiarized = item.diarized || false;
    lastSOAPResult = item.structuredResult || null;

    // Sync selector UI
    try {
        const selector = document.getElementById('templateSelector');
        if (selector) selector.value = currentTemplate;
    } catch (e) {}

    document.getElementById('soapTemplateTitle').textContent = templateTitles[currentTemplate] || 'Referto SOAP';
    renderTemplateExtras();
    renderChecklistInSOAP();
    applyHideEmptyVisibility();
    navigateToPage('soap');
    showToast('Referto caricato', 'success');
}

function deleteHistoryById(id) {
    migrateLegacyHistoryDataIfNeeded();

    const index = (historyData || []).findIndex(r => r && r.id === id);
    if (index < 0) return;

    if (confirm('Eliminare questa visita?')) {
        historyData.splice(index, 1);

        if (currentEditingHistoryId === id) {
            resetSoapDraftLink();
        } else if (currentEditingSOAPIndex > index) {
            // legacy index correction
            currentEditingSOAPIndex--;
        }

        saveData();
        updateHistoryBadge();
        renderHistory();
        showToast('Visita eliminata', 'success');
    }
}

function updateHistoryBadge() { 
    const badge = document.getElementById('historyBadge');
    if (badge) badge.textContent = (historyData || []).length; 
}



// ============================================
// MEDICATIONS
// ============================================

let editingMedicationIndex = null;

function openMedicationModal(index = null) {
    const modal = document.getElementById('medicationModal');
    const title = document.getElementById('medicationModalTitle');
    const saveBtn = document.getElementById('medicationModalSaveBtn');

    editingMedicationIndex = (typeof index === 'number' && index >= 0) ? index : null;

    // Populate fields if editing
    if (editingMedicationIndex !== null && medications[editingMedicationIndex]) {
        const med = medications[editingMedicationIndex];
        document.getElementById('medName').value = med.name || '';
        document.getElementById('medDosage').value = med.dosage || '';
        document.getElementById('medFrequency').value = med.frequency || '';
        document.getElementById('medDuration').value = med.duration || '';
        document.getElementById('medInstructions').value = med.instructions || '';
        if (title) title.textContent = 'Modifica Farmaco';
        if (saveBtn) saveBtn.textContent = '✅ Salva';
    } else {
        // New medication
        ['medName', 'medDosage', 'medFrequency', 'medDuration', 'medInstructions'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        if (title) title.textContent = 'Aggiungi Farmaco';
        if (saveBtn) saveBtn.textContent = '✅ Aggiungi';
    }

    if (modal) modal.classList.add('active');
}

function editMedication(index) {
    openMedicationModal(index);
}

function closeMedicationModal() {
    const modal = document.getElementById('medicationModal');
    if (modal) modal.classList.remove('active');
    editingMedicationIndex = null;
    const title = document.getElementById('medicationModalTitle');
    const saveBtn = document.getElementById('medicationModalSaveBtn');
    if (title) title.textContent = 'Aggiungi Farmaco';
    if (saveBtn) saveBtn.textContent = '✅ Aggiungi';
    ['medName', 'medDosage', 'medFrequency', 'medDuration', 'medInstructions'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
}

// Backward compatible alias
function addMedication() { saveMedication(); }

function saveMedication() {
    const med = {
        name: document.getElementById('medName').value,
        dosage: document.getElementById('medDosage').value,
        frequency: document.getElementById('medFrequency').value,
        duration: document.getElementById('medDuration').value,
        instructions: document.getElementById('medInstructions').value
    };
    if (!med.name) { showToast('Inserisci il nome', 'error'); return; }

    if (editingMedicationIndex !== null && medications[editingMedicationIndex]) {
        medications[editingMedicationIndex] = med;
    } else {
        medications.push(med);
    }
    saveData();
    renderMedications();
    closeMedicationModal();
    showToast(editingMedicationIndex !== null ? 'Farmaco aggiornato' : 'Farmaco aggiunto', 'success');
}

function renderMedications() {
    const list = document.getElementById('medicationList');
    if (!list) return;
    if (medications.length === 0) {
        list.innerHTML = '<p style="color:#888;text-align:center;padding:20px;">Nessun farmaco</p>';
        return;
    }
    list.innerHTML = medications.map((med, i) => `
        <div class="medication-item">
            <span class="medication-icon">💊</span>
            <div class="medication-info">
                <h4>${med.name}</h4>
                <p>${med.dosage} - ${med.frequency} - ${med.duration}</p>
                ${med.instructions ? `<p><em>${med.instructions}</em></p>` : ''}
            </div>
            <div class="medication-actions">
                <button class="medication-edit" onclick="editMedication(${i})" title="Modifica">✏️</button>
                <button class="medication-delete" onclick="deleteMedication(${i})" title="Elimina">🗑️</button>
            </div>
        </div>
    `).join('');
}

function deleteMedication(index) { 
    medications.splice(index, 1); 
    saveData(); 
    renderMedications(); 
}

// ============================================
// APPOINTMENTS
// ============================================

let editingAppointmentId = null;

function editAppointment(id) {
    const apt = appointments.find(a => a.id === id);
    if (!apt) return;

    editingAppointmentId = id;
    document.getElementById('appointmentDate').value = apt.date || '';
    document.getElementById('appointmentTime').value = apt.time || '';
    document.getElementById('appointmentReason').value = apt.reason || '';
    document.getElementById('appointmentNotes').value = apt.notes || '';

    const cancelBtn = document.getElementById('btnCancelAppointmentEdit');
    if (cancelBtn) cancelBtn.style.display = '';
    const saveBtn = document.getElementById('btnSaveAppointment');
    if (saveBtn) saveBtn.textContent = '💾 Aggiorna';

    showToast('Modifica appuntamento attiva', 'success');
}

function cancelAppointmentEdit() {
    editingAppointmentId = null;
    document.getElementById('appointmentDate').value = '';
    document.getElementById('appointmentTime').value = '';
    document.getElementById('appointmentReason').value = '';
    document.getElementById('appointmentNotes').value = '';
    const cancelBtn = document.getElementById('btnCancelAppointmentEdit');
    if (cancelBtn) cancelBtn.style.display = 'none';
    const saveBtn = document.getElementById('btnSaveAppointment');
    if (saveBtn) saveBtn.textContent = '💾 Salva';
}

function saveAppointment() {
    const date = document.getElementById('appointmentDate').value;
    const time = document.getElementById('appointmentTime').value;
    const reason = document.getElementById('appointmentReason').value;
    const notes = document.getElementById('appointmentNotes').value;

    const apt = {
        id: editingAppointmentId || Date.now(),
        date,
        time,
        reason,
        notes
    };
    if (!apt.date || !apt.time) { showToast('Inserisci data e ora', 'error'); return; }

    if (editingAppointmentId) {
        const idx = appointments.findIndex(a => a.id === editingAppointmentId);
        if (idx >= 0) appointments[idx] = apt;
        else appointments.push(apt);
    } else {
        appointments.push(apt);
    }

    saveData();
    renderAppointments();
    document.getElementById('appointmentDate').value = '';
    document.getElementById('appointmentTime').value = '';
    document.getElementById('appointmentReason').value = '';
    document.getElementById('appointmentNotes').value = '';

    const wasEditing = !!editingAppointmentId;
    cancelAppointmentEdit();
    showToast(wasEditing ? 'Appuntamento aggiornato' : 'Appuntamento salvato', 'success');
}

function renderAppointments() {
    const list = document.getElementById('appointmentList');
    if (!list) return;
    if (appointments.length === 0) {
        list.innerHTML = '<p style="color:#888;text-align:center;padding:20px;">Nessun appuntamento</p>';
        return;
    }
    const months = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
    const sorted = [...appointments].sort((a, b) => new Date(a.date + 'T' + a.time) - new Date(b.date + 'T' + b.time));
    list.innerHTML = sorted.map((apt) => {
        const date = new Date(apt.date);
        const originalIndex = appointments.findIndex(a => a.id === apt.id);
        return `
            <div class="history-item" style="cursor:default;">
                <div class="history-date">
                    <div class="day">${date.getDate()}</div>
                    <div class="month">${months[date.getMonth()]}</div>
                </div>
                <div class="history-info">
                    <h4>${apt.time} - ${apt.reason || 'Controllo'}</h4>
                    <p>${apt.notes || ''}</p>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    <button class="history-delete" onclick="editAppointment(${apt.id})" title="Modifica" style="opacity:1; background:#f0f0f0; color:#333;">✏️</button>
                    <button class="history-delete" onclick="deleteAppointment(${originalIndex})" title="Elimina" style="opacity:1;">×</button>
                </div>
            </div>
        `;
    }).join('');
}

function deleteAppointment(index) {
    if (confirm('Eliminare questo appuntamento?')) {
        appointments.splice(index, 1);
        saveData();
        renderAppointments();
        showToast('Appuntamento eliminato', 'success');
    }
}

function addToCalendar() {
    const apt = {
        date: document.getElementById('appointmentDate').value,
        time: document.getElementById('appointmentTime').value,
        reason: document.getElementById('appointmentReason').value,
        notes: document.getElementById('appointmentNotes').value
    };
    if (!apt.date || !apt.time) { showToast('Inserisci data e ora', 'error'); return; }
    const patient = getPatientData();
    const startDate = new Date(apt.date + 'T' + apt.time);
    const endDate = new Date(startDate.getTime() + 30 * 60000);
    const formatDate = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent('Visita - ' + (patient.petName || 'Paziente'))}&dates=${formatDate(startDate)}/${formatDate(endDate)}&details=${encodeURIComponent(apt.reason + '\n' + apt.notes)}`;
    window.open(url, '_blank');
}

function openCostsPage() {
    navigateToPage('costs');
    updateCostDisplay();
}

// Initialize on load
window.onload = checkSession;
