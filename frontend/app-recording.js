// ADA v6.17.4 - Recording & Transcription with Native Diarization + Chunking

let mediaRecorder = null;
let audioChunks = [];
let audioBlob = null;
let audioFileName = '';
let audioFileType = '';
let isRecording = false;
let isPaused = false;
let timerInterval = null;
let seconds = 0;
let audioContext = null;
let analyser = null;
let animationId = null;

// ============================================
// CHUNK RECORDING (v6.17.3)
// ============================================

let recordingStream = null;
let chunkingSessionId = null;
let chunkingProfile = null;
let chunkingCfg = null;
let activeMimeType = null;
let currentChunkIndex = 0;
let currentChunkStartSecond = 0;
let currentChunkBytes = 0;
let currentChunkParts = [];
let chunkSplitInProgress = false;
let chunkStopRequested = false;
let chunkNextAppendIndex = 0;
let globalSegmentIndex = 0;

let chunkQueue = []; // pending chunks to transcribe
let chunkInFlight = 0;
let chunkResults = new Map(); // chunkIndex -> {text, segments, minutes}

// Persistence (IndexedDB)
const ADA_VISIT_DRAFT_DB = 'ADA_VisitDraft';
const ADA_VISIT_DRAFT_STORE = 'draft';
let visitDraftDB = null;

// Debug audio cache (IndexedDB)
const ADA_AUDIOCACHE_DB = 'ADA_AudioCache';
const ADA_AUDIOCACHE_STORE = 'chunks';
let audioCacheDB = null;

// Transcription state
let lastTranscriptionResult = null;
let lastTranscriptionDiarized = false;
let transcriptionSegments = []; // Real diarized segments with segment_index

// Visit process abort (transcription / SOAP generation)
let visitAbortController = null;
let visitPipelineRunning = false;
let lastKnownAudioDurationSec = 0;

function getVisitSignal() {
    return visitAbortController ? visitAbortController.signal : undefined;
}

function beginVisitAbortScope() {
    // Abort any previous in-flight work
    try { if (visitAbortController) visitAbortController.abort(); } catch (e) {}
    visitAbortController = new AbortController();

    // New visit pipeline => ensure the SOAP is treated as a NEW draft (avoid overwriting an archived record)
    try { if (typeof resetSoapDraftLink === 'function') resetSoapDraftLink(); } catch (e) {}

    return visitAbortController;
}

function endVisitAbortScope() {
    visitAbortController = null;
}

function isAbortError(err) {
    if (!err) return false;
    if (err.name === 'AbortError') return true;
    const msg = String(err.message || '').toLowerCase();
    return msg.includes('abort');
}

// ============================================
// LOG UTILITY FUNCTIONS
// ============================================

function getLogContent() {
    return localStorage.getItem('ADA_LOG') || 'Nessun errore registrato.';
}

function clearLog() {
    localStorage.removeItem('ADA_LOG');
    localStorage.removeItem('ADA_LOG_CONTENT');
}

function exportLogFile() {
    const logContent = getLogContent();
    const blob = new Blob([logContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ADA.log';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ============================================
// RECORDING FUNCTIONS
// ============================================

function toggleRecording() {
    // Microfono: toggle Start/Stop
    if (!isRecording) {
        startRecording();
    } else {
        // Stop triggers stop→transcribe→(quality gate)→auto SOAP
        completeRecording();
    }
}

function _shouldUseChunking() {
    try { return typeof getChunkingEnabled === 'function' ? !!getChunkingEnabled() : false; } catch (e) { return false; }
}

function startRecording() {
    if (_shouldUseChunking()) return startRecordingChunking();
    return startRecordingLegacy();
}

function startRecordingLegacy() {
    if (isRecording) return;

    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            const mimeType = (typeof chooseBestSupportedMimeType === 'function')
                ? chooseBestSupportedMimeType(detectRecordingProfile?.() || 'desktop')
                : (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm');

            mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            audioChunks = [];

            recordingStream = stream;
            activeMimeType = mimeType || mediaRecorder.mimeType || 'audio/webm';

            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);
            analyser.fftSize = 64;
            updateVisualizer();

            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);

            mediaRecorder.onstop = () => {
                audioBlob = new Blob(audioChunks, { type: activeMimeType });
                console.log('Audio recorded:', audioBlob.size, 'bytes');
                stream.getTracks().forEach(track => track.stop());
                if (animationId) cancelAnimationFrame(animationId);
                resetVisualizer();
            };

            mediaRecorder.start();
            isRecording = true;
            isPaused = false;

            hideChunkingRuntime();

            const rb = document.getElementById('recordBtn');
            if (rb) { rb.classList.add('recording'); rb.textContent = '⏹️'; }
            document.getElementById('recordingStatus').textContent = '🔴 Registrazione in corso...';
            document.getElementById('btnPause').disabled = false;
            document.getElementById('btnResume').disabled = true;
            const btnCancel = document.getElementById('btnCancel');
            if (btnCancel) btnCancel.disabled = false;
            startTimer();
        })
        .catch(err => {
            showToast('Errore microfono: ' + err.message, 'error');
        });
}

function pauseRecording() {
    if (!isRecording || isPaused) return;
    mediaRecorder.pause();
    isPaused = true;
    stopTimer();
    const rb = document.getElementById('recordBtn');
    if (rb) { rb.classList.remove('recording'); rb.classList.add('paused'); rb.textContent = '⏹️'; }
    document.getElementById('recordingStatus').textContent = '⏸️ In pausa';
    document.getElementById('btnPause').disabled = true;
    document.getElementById('btnResume').disabled = false;
}

function resumeRecording() {
    if (!isRecording || !isPaused) return;
    mediaRecorder.resume();
    isPaused = false;
    startTimer();
    document.getElementById('recordBtn').classList.remove('paused');
    const rb = document.getElementById('recordBtn');
            if (rb) { rb.classList.add('recording'); rb.textContent = '⏹️'; }
    document.getElementById('recordingStatus').textContent = '🔴 Registrazione in corso...';
    document.getElementById('btnPause').disabled = false;
    document.getElementById('btnResume').disabled = true;
            const btnCancel = document.getElementById('btnCancel');
            if (btnCancel) btnCancel.disabled = false;
}

function completeRecording() {
    if (!isRecording) return;

    // Chunking mode: stop recording but keep transcriptions running until queue drains
    if (_shouldUseChunking()) {
        return stopChunkingRecording();
    }

    // Capture duration before timer reset
    lastKnownAudioDurationSec = seconds || lastKnownAudioDurationSec || 0;

    // Prepare abort scope for the stop->transcribe->(auto SOAP) pipeline
    beginVisitAbortScope();
    visitPipelineRunning = true;

    // Stop recorder
    try { mediaRecorder.stop(); } catch (e) {}
    isRecording = false;
    isPaused = false;
    stopTimer();

    const rb = document.getElementById('recordBtn');
    if (rb) {
        rb.classList.remove('recording', 'paused');
        rb.disabled = true; // prevent restarting while processing
        rb.textContent = '🎤';
    }

    const statusEl = document.getElementById('recordingStatus');
    if (statusEl) statusEl.textContent = '⏳ Elaborazione...';

    const btnPause = document.getElementById('btnPause');
    const btnResume = document.getElementById('btnResume');
    const btnCancel = document.getElementById('btnCancel');
    if (btnPause) btnPause.disabled = true;
    if (btnResume) btnResume.disabled = true;
    if (btnCancel) btnCancel.disabled = false;

    // Wait a moment for audioBlob to be finalized in mediaRecorder.onstop
    setTimeout(() => {
        runAudioAutoPipeline().catch(err => {
            console.error('Auto pipeline error:', err);
        });
    }, 250);
}



async function getAudioDurationSecondsFromBlob(blob) {
    try {
        const url = URL.createObjectURL(blob);
        const audio = new Audio();
        audio.preload = 'metadata';
        audio.src = url;
        const duration = await new Promise((resolve, reject) => {
            const to = setTimeout(() => reject(new Error('duration_timeout')), 5000);
            audio.onloadedmetadata = () => { clearTimeout(to); resolve(audio.duration || 0); };
            audio.onerror = () => { clearTimeout(to); reject(new Error('duration_error')); };
        });
        URL.revokeObjectURL(url);
        return Number.isFinite(duration) ? duration : 0;
    } catch (e) {
        return 0;
    }
}

function transcriptionPassesQualityGate(transcriptionText) {
    const t = (transcriptionText || '').trim();
    const words = t ? t.split(/\s+/).filter(Boolean) : [];
    const wordCount = words.length;
    const dur = Number(lastKnownAudioDurationSec) || 0;

    // Gate: short audio OR very short text => manual generation
    // (thresholds tuned to avoid auto-generating on trivial recordings)
    const okByDurationAndWords = dur >= 25 && wordCount >= 40;
    const okByTextOnly = wordCount >= 140; // long text even if duration unknown
    return okByDurationAndWords || okByTextOnly;
}

async function runAudioAutoPipeline() {
    const rb = document.getElementById('recordBtn');
    const btnCancel = document.getElementById('btnCancel');
    const btnGenerateRow = document.getElementById('generateSoapRow');
    const btnAutoRow = document.getElementById('autoSoapCompleteRow');
    const titleEl = document.getElementById('transcriptionTitle');

    if (btnAutoRow) btnAutoRow.style.display = 'none';

    try {
        // Debug: cache the audio file/blob used for transcription
        try {
            if (typeof debugLogEnabled !== 'undefined' && debugLogEnabled && audioBlob && audioBlob.size) {
                const sid = `pipeline_${Date.now()}`;
                await saveAudioChunkToCache(sid, 0, audioBlob);
            }
        } catch (e) {}

        const statusEl = document.getElementById('recordingStatus');
        if (statusEl) statusEl.textContent = 'Sto trascrivendo la registrazione.';
        await transcribeAudio();

        // If canceled during transcription, stop here
        if (!visitAbortController || (visitAbortController.signal && visitAbortController.signal.aborted)) {
            return;
        }

        const transcriptionText = (document.getElementById('transcriptionText')?.value || '').toString();
        const ok = transcriptionPassesQualityGate(transcriptionText);

        if (!ok) {
            if (btnGenerateRow) btnGenerateRow.style.display = 'flex';
            if (titleEl) titleEl.textContent = 'Testo trascritto (audio corto: genera referto manualmente)';
            if (statusEl) statusEl.textContent = '✅ Trascrizione pronta — premi “Genera referto”';
            showToast('Trascrizione pronta. Audio corto: genera il referto manualmente.', 'success');
            return;
        }

        // Auto-generate SOAP
        if (btnGenerateRow) btnGenerateRow.style.display = 'none';
        if (statusEl) statusEl.textContent = 'Ho completato la trascrizione della registrazione. Sto generando il referto.';

        if (typeof generateSOAP === 'function') {
            await generateSOAP({ auto: true, signal: getVisitSignal() });
        } else {
            throw new Error('Funzione generateSOAP non disponibile');
        }

        if (titleEl) titleEl.textContent = '✅ Referto completato';
        if (btnAutoRow) btnAutoRow.style.display = 'flex';

        if (statusEl) statusEl.textContent = 'Ho completato la generazione del referto';
        showToast('✅ Referto completato', 'success');

    } catch (error) {
        if (error && (error.name === 'AbortError' || ('' + error.message).toLowerCase().includes('abort'))) {
            // Silent on abort
            const statusEl = document.getElementById('recordingStatus');
            if (statusEl) statusEl.textContent = '❌ Annullato';
        } else {
            console.error('Pipeline error:', error);
            showToast('Errore: ' + (error?.message || error), 'error');
            const statusEl = document.getElementById('recordingStatus');
            if (statusEl) statusEl.textContent = '❌ Errore';
        }
    } finally {
        visitPipelineRunning = false;
        endVisitAbortScope();
        if (btnCancel) btnCancel.disabled = true;
        if (rb) { rb.disabled = false; rb.textContent = '🎤'; rb.classList.remove('recording','paused'); }
        resetTimer();
        try {
            audioBlob = null;
            audioChunks = [];
        } catch (e) {}
    }
}

function cancelVisitProcess() {
    // Abort in-flight transcription/generation and leave any produced output visible.
    try {
        if (visitAbortController) visitAbortController.abort();
    } catch (e) {}

    // If recording is active, stop and discard audio (no transcription).
    try {
        if (isRecording && _shouldUseChunking()) {
            chunkStopRequested = true;
            chunkQueue = [];
            chunkResults = new Map();
            chunkInFlight = 0;
            try { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); } catch (e) {}
            try { if (recordingStream) recordingStream.getTracks().forEach(t => t.stop()); } catch (e) {}
            recordingStream = null;
            hideChunkingRuntime();
        } else if (isRecording && mediaRecorder) {
            try { mediaRecorder.stop(); } catch (e) {}
        }
    } catch (e) {}

    isRecording = false;
    isPaused = false;
    stopTimer();
    try { resetTimer(); } catch (e) {}

    // Reset UI controls
    const rb = document.getElementById('recordBtn');
    if (rb) {
        rb.disabled = false;
        rb.textContent = '🎤';
        rb.classList.remove('recording', 'paused');
    }

    const statusEl = document.getElementById('recordingStatus');
    if (statusEl) statusEl.textContent = '❌ Annullato';

    const btnPause = document.getElementById('btnPause');
    const btnResume = document.getElementById('btnResume');
    const btnCancel = document.getElementById('btnCancel');
    if (btnPause) btnPause.disabled = true;
    if (btnResume) btnResume.disabled = true;
    if (btnCancel) btnCancel.disabled = true;

    // Never autosave anything
    showProgress(false);
    showToast('Operazione annullata', 'success');

    visitPipelineRunning = false;
    endVisitAbortScope();
}

// Upload audio file
function triggerAudioUpload() {
    document.getElementById('audioFileInput').click();
}

async function handleAudioUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Supported formats by OpenAI Whisper API
    const validExtensions = ['mp3', 'wav', 'webm', 'ogg', 'm4a', 'mp4', 'mpeg', 'mpga', 'oga', 'flac'];
    const extension = file.name.split('.').pop().toLowerCase();
    
    if (!validExtensions.includes(extension)) {
        showToast('Formato non supportato. Usa MP3, WAV, M4A, WEBM, OGG, FLAC.', 'error');
        return;
    }
    
    // Check file size (max 25MB for Whisper API)
    if (file.size > 25 * 1024 * 1024) {
        showToast('File troppo grande. Massimo 25MB.', 'error');
        return;
    }
    
    // IMPORTANT: Keep original File object with its name and type
    audioBlob = file;
    audioFileName = file.name;
    audioFileType = file.type || `audio/${extension}`;
    seconds = 60; // default estimate
    
    console.log('Audio file uploaded:', { name: audioFileName, type: audioFileType, size: file.size });
    
    document.getElementById('recordingStatus').textContent = `📁 File: ${file.name}`;
    showToast('File caricato, avvio trascrizione...', 'success');
    event.target.value = '';
    
    // Prepare duration estimate (best-effort)
    lastKnownAudioDurationSec = await getAudioDurationSecondsFromBlob(file);
    if (!lastKnownAudioDurationSec) lastKnownAudioDurationSec = seconds || 0;

    // Start auto pipeline (stop -> transcribe -> quality gate -> auto SOAP if OK)
    beginVisitAbortScope();
    visitPipelineRunning = true;
    const rb = document.getElementById('recordBtn');
    if (rb) rb.disabled = true;
    const btnCancel = document.getElementById('btnCancel');
    if (btnCancel) btnCancel.disabled = false;
    await runAudioAutoPipeline();
}

// Timer functions
function startTimer() {
    timerInterval = setInterval(() => {
        seconds++;
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        document.getElementById('timer').textContent = `${mins}:${secs}`;

        // Update chunk runtime UI (if enabled)
        try { updateChunkingRuntimeUI(); } catch (e) {}
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function resetTimer() {
    seconds = 0;
    document.getElementById('timer').textContent = '00:00';
}

// Visualizer
function updateVisualizer() {
    if (!analyser) return;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    const bars = document.querySelectorAll('.visualizer-bar');
    bars.forEach((bar, i) => {
        const value = dataArray[i] || 0;
        bar.style.height = Math.max(5, value / 5) + 'px';
    });
    animationId = requestAnimationFrame(updateVisualizer);
}

function resetVisualizer() {
    const bars = document.querySelectorAll('.visualizer-bar');
    bars.forEach(bar => bar.style.height = '5px');
}

// ============================================
// CHUNKING IMPLEMENTATION (v6.17.3)
// ============================================

function updateChunkingBadgesFromSettings() {
    // Called by settings module when a parameter changes
    try {
        chunkingProfile = typeof detectRecordingProfile === 'function' ? detectRecordingProfile() : 'desktop';
        chunkingCfg = typeof loadChunkingConfig === 'function' ? loadChunkingConfig(chunkingProfile) : null;
        activeMimeType = (typeof chooseBestSupportedMimeType === 'function') ? chooseBestSupportedMimeType(chunkingProfile) : (activeMimeType || 'audio/webm');
    } catch (e) {}

    const p = document.getElementById('chunkProfileBadge');
    const d = document.getElementById('chunkDurationBadge');
    const m = document.getElementById('chunkMimeBadge');
    if (p) p.textContent = `Profilo: ${chunkingProfile || '—'}`;
    if (d) d.textContent = `Chunk: ${chunkingCfg?.chunkDurationSec ? Math.round(chunkingCfg.chunkDurationSec / 60) + ' min' : '—'}`;
    if (m) m.textContent = `mimeType: ${activeMimeType || '—'}`;
}

function showChunkingRuntime() {
    if (typeof debugLogEnabled !== 'undefined' && !debugLogEnabled) return;
    const wrap = document.getElementById('chunkingRuntime');
    if (wrap) wrap.style.display = '';
    updateChunkingBadgesFromSettings();
}

function hideChunkingRuntime() {
    const wrap = document.getElementById('chunkingRuntime');
    if (wrap) wrap.style.display = 'none';
}

function _formatMMSS(totalSec) {
    const s = Math.max(0, Math.floor(totalSec || 0));
    const mm = Math.floor(s / 60).toString().padStart(2, '0');
    const ss = (s % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
}

function updateChunkingRuntimeUI() {
    const wrap = document.getElementById('chunkingRuntime');
    if (!wrap || wrap.style.display === 'none') return;

    const line1 = document.getElementById('chunkTimerLine');
    const line2 = document.getElementById('chunkQueueLine');
    const warn = document.getElementById('chunkWarnLine');

    const dur = Number(chunkingCfg?.chunkDurationSec) || 0;
    const chunkSec = Math.max(0, (seconds || 0) - (currentChunkStartSecond || 0));
    if (line1) line1.textContent = `Chunk: ${_formatMMSS(chunkSec)} / ${_formatMMSS(dur)}`;
    if (line2) line2.textContent = `In coda: ${chunkQueue.length} • In trascrizione: ${chunkInFlight}`;

    const warnBefore = Number(chunkingCfg?.warnBeforeSplitSec) || 0;
    if (warn && warnBefore > 0 && dur > 0 && isRecording && !isPaused) {
        const remaining = Math.max(0, dur - chunkSec);
        if (remaining > 0 && remaining <= warnBefore && !chunkSplitInProgress) {
            warn.style.display = '';
            warn.textContent = `⚠️ Tra ${remaining}s spezzetto il chunk`;
        } else {
            warn.style.display = 'none';
        }
    }

    // Auto split checks (only while recording)
    if (isRecording && !isPaused && _shouldUseChunking() && chunkingCfg && !chunkSplitInProgress && !chunkStopRequested) {
        const hardStopMb = Number(chunkingCfg.hardStopAtMb) || 23;
        const hardStopBytes = Math.floor(hardStopMb * 1024 * 1024);
        if ((dur > 0 && chunkSec >= dur) || (hardStopBytes > 0 && currentChunkBytes >= hardStopBytes)) {
            requestChunkSplit((currentChunkBytes >= hardStopBytes) ? 'hard_stop_size' : 'duration');
        }
    }
}

async function startRecordingChunking() {
    if (isRecording) return;

    // Safety: ensure timer state is clean before starting a new chunking session
    try { stopTimer(); } catch (e) {}
    try { resetTimer(); } catch (e) {}

    // New session
    chunkingProfile = typeof detectRecordingProfile === 'function' ? detectRecordingProfile() : 'desktop';
    chunkingCfg = typeof loadChunkingConfig === 'function' ? loadChunkingConfig(chunkingProfile) : null;
    activeMimeType = (typeof chooseBestSupportedMimeType === 'function') ? chooseBestSupportedMimeType(chunkingProfile) : null;
    chunkingSessionId = `sess_${Date.now()}`;
    currentChunkIndex = 0;
    chunkNextAppendIndex = 0;
    globalSegmentIndex = 0;
    chunkQueue = [];
    chunkResults = new Map();
    chunkInFlight = 0;
    chunkStopRequested = false;
    chunkSplitInProgress = false;

    // Reset transcription output for this visit
    try { if (typeof setTranscriptionFromAudio === 'function') setTranscriptionFromAudio('', [], true); } catch (e) {}
    try { transcriptionSegments = []; } catch (e) {}

    beginVisitAbortScope();
    visitPipelineRunning = true;

    showChunkingRuntime();

    const statusEl = document.getElementById('recordingStatus');
    if (statusEl) statusEl.textContent = '🔴 Registrazione in corso (chunking attivo)...';

    try {
        recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
        showToast('Errore microfono: ' + err.message, 'error');
        visitPipelineRunning = false;
        endVisitAbortScope();
        return;
    }

    // Visualizer
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(recordingStream);
        source.connect(analyser);
        analyser.fftSize = 64;
        updateVisualizer();
    } catch (e) {}

    // Start recorder
    await _startNewChunkRecorder();

    isRecording = true;
    isPaused = false;

    // UI
    const rb = document.getElementById('recordBtn');
    if (rb) { rb.classList.add('recording'); rb.textContent = '⏹️'; rb.disabled = false; }
    const btnPause = document.getElementById('btnPause');
    const btnResume = document.getElementById('btnResume');
    const btnCancel = document.getElementById('btnCancel');
    if (btnPause) btnPause.disabled = false;
    if (btnResume) btnResume.disabled = true;
    if (btnCancel) btnCancel.disabled = false;

    // Timers
    currentChunkStartSecond = seconds || 0;
    startTimer();

    // Persist session state early
    try { await persistChunkVisitDraft(); } catch (e) {}
}

async function _startNewChunkRecorder() {
    if (!recordingStream) return;

    // Reset chunk buffers
    currentChunkParts = [];
    currentChunkBytes = 0;
    chunkSplitInProgress = false;

    // Create recorder
    try {
        mediaRecorder = new MediaRecorder(recordingStream, activeMimeType ? { mimeType: activeMimeType } : undefined);
        activeMimeType = activeMimeType || mediaRecorder.mimeType || 'audio/webm';
    } catch (e) {
        // Fallback: let the browser decide
        mediaRecorder = new MediaRecorder(recordingStream);
        activeMimeType = mediaRecorder.mimeType || 'audio/webm';
    }

    const timeslice = Number(chunkingCfg?.timesliceMs) || 1000;
    mediaRecorder.ondataavailable = (e) => {
        if (!e || !e.data) return;
        currentChunkParts.push(e.data);
        try { currentChunkBytes += (e.data.size || 0); } catch (e2) {}
    };

    mediaRecorder.onstop = async () => {
        const parts = currentChunkParts.slice();
        const blob = new Blob(parts, { type: activeMimeType || 'audio/webm' });
        const idx = currentChunkIndex;

        // Enqueue transcription of this finalized chunk
        try {
            await enqueueChunkForTranscription(blob, idx);
        } catch (e) {
            logError?.('CHUNK', `Errore enqueue chunk ${idx}: ${e.message || e}`);
        }

        // Prepare for next chunk
        currentChunkIndex++;
        currentChunkStartSecond = seconds || currentChunkStartSecond;
        currentChunkParts = [];
        currentChunkBytes = 0;
        chunkSplitInProgress = false;

        // If user requested stop, do not restart
        if (chunkStopRequested) {
            return;
        }

        // Restart recorder ASAP
        try {
            await _delay(Number(chunkingCfg?.autoSplitGraceMs) || 0);
            mediaRecorder.start(timeslice);
        } catch (e) {
            // If restart fails, stop everything
            logError?.('CHUNK', `Impossibile riavviare MediaRecorder: ${e.message || e}`);
            try { stopChunkingRecording(true); } catch (e2) {}
        }
    };

    // Start first chunk
    try {
        mediaRecorder.start(timeslice);
    } catch (e) {
        showToast('Errore avvio MediaRecorder: ' + (e?.message || e), 'error');
        throw e;
    }

    updateChunkingBadgesFromSettings();
}

function requestChunkSplit(reason) {
    if (!mediaRecorder || chunkSplitInProgress) return;
    chunkSplitInProgress = true;

    try {
        logDebug?.('CHUNK_SPLIT', `Split chunk ${currentChunkIndex} (${reason}) size=${currentChunkBytes} bytes`);
    } catch (e) {}

    try { mediaRecorder.requestData(); } catch (e) {}

    const grace = Number(chunkingCfg?.autoSplitGraceMs) || 200;
    setTimeout(() => {
        try { mediaRecorder.stop(); } catch (e) {
            chunkSplitInProgress = false;
        }
    }, grace);
}

async function stopChunkingRecording(force = false) {
    if (!isRecording) return;

    // Capture duration best-effort
    lastKnownAudioDurationSec = seconds || lastKnownAudioDurationSec || 0;
    chunkStopRequested = true;

    // UI
    const rb = document.getElementById('recordBtn');
    if (rb) {
        rb.classList.remove('recording', 'paused');
        rb.disabled = true;
        rb.textContent = '🎤';
    }
    const btnPause = document.getElementById('btnPause');
    const btnResume = document.getElementById('btnResume');
    if (btnPause) btnPause.disabled = true;
    if (btnResume) btnResume.disabled = true;

    const statusEl = document.getElementById('recordingStatus');
    if (statusEl) statusEl.textContent = '⏳ Stop... chiudo ultimo chunk';

    // Finalize last chunk
    try {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            try { mediaRecorder.requestData(); } catch (e) {}
            try { mediaRecorder.stop(); } catch (e) {}
        }
    } catch (e) {}

    // Stop tracks and visualizer
    try { if (recordingStream) recordingStream.getTracks().forEach(t => t.stop()); } catch (e) {}
    recordingStream = null;
    try { if (animationId) cancelAnimationFrame(animationId); } catch (e) {}
    resetVisualizer();

    isRecording = false;
    isPaused = false;
    stopTimer();

    // Wait for transcription queue to drain
    await waitForChunkQueueToDrain({ force });
}

async function waitForChunkQueueToDrain({ force = false } = {}) {
    const statusEl = document.getElementById('recordingStatus');
    const titleEl = document.getElementById('transcriptionTitle');
    if (titleEl) titleEl.textContent = 'Testo trascritto (chunking)';
    showProgress(true);

    const tStart = Date.now();
    let lastProgressAt = Date.now();
    let lastAppendIdx = chunkNextAppendIndex;

    while (!force && (chunkQueue.length > 0 || chunkInFlight > 0 || chunkNextAppendIndex < currentChunkIndex)) {
        if (getVisitSignal() && getVisitSignal().aborted) break;

        // If the queue is empty and nothing is in-flight but append is stuck, force-skip missing chunks
        // by inserting placeholders. This prevents "drain" from hanging in edge cases.
        try {
            if (chunkQueue.length === 0 && chunkInFlight === 0 && chunkNextAppendIndex < currentChunkIndex) {
                if (chunkNextAppendIndex === lastAppendIdx) {
                    const stalledMs = Date.now() - lastProgressAt;
                    if (stalledMs > 3000 && !chunkResults.has(chunkNextAppendIndex)) {
                        const marker = `⚠️ [Chunk ${chunkNextAppendIndex + 1} mancante: trascrizione non disponibile]`;
                        chunkResults.set(chunkNextAppendIndex, { text: marker, segments: [], minutes: 0, failed: true, error: 'missing' });
                        tryAppendReadyChunkResults();
                    }
                }
            }
        } catch (e) {}

        updateChunkingRuntimeUI();
        if (statusEl) statusEl.textContent = 'Sto trascrivendo la registrazione.';
        await _delay(450);

        if (chunkNextAppendIndex !== lastAppendIdx) {
            lastAppendIdx = chunkNextAppendIndex;
            lastProgressAt = Date.now();
        }

        // Hard guard to avoid infinite loops
        if (Date.now() - tStart > 60 * 60 * 1000) break;
    }

    showProgress(false);

    const transcriptionText = (document.getElementById('transcriptionText')?.value || '').toString();
    const ok = transcriptionPassesQualityGate(transcriptionText);
    const btnGenerateRow = document.getElementById('generateSoapRow');

    if (!ok) {
        if (statusEl) statusEl.textContent = '✅ Trascrizione pronta — premi “Genera referto”';
        if (btnGenerateRow) btnGenerateRow.style.display = 'flex';
    } else {
        if (btnGenerateRow) btnGenerateRow.style.display = 'none';
        if (statusEl) statusEl.textContent = 'Ho completato la trascrizione della registrazione. Sto generando il referto.';
        if (typeof generateSOAP === 'function') {
            try {
                await generateSOAP({ auto: true, signal: getVisitSignal() });
                if (statusEl) statusEl.textContent = 'Ho completato la generazione del referto';
            } catch (e) {
                if (statusEl) statusEl.textContent = '❌ Errore generazione';
                if (btnGenerateRow) btnGenerateRow.style.display = 'flex';
            }
        }
    }

    // Reset UI state
    const rb = document.getElementById('recordBtn');
    if (rb) rb.disabled = false;
    const btnCancel = document.getElementById('btnCancel');
    if (btnCancel) btnCancel.disabled = true;

    visitPipelineRunning = false;
    endVisitAbortScope();

    // Reset timer for next visit (chunking path doesn't go through legacy pipeline finally{})
    try { resetTimer(); } catch (e) {}

    // Persist final
    try { await persistChunkVisitDraft(); } catch (e) {}
}

async function enqueueChunkForTranscription(blob, chunkIndex) {
    if (!blob || !blob.size) return;

    // Guard: prevent queue explosion
    const maxPending = Number(chunkingCfg?.maxPendingChunks) || 4;
    if (chunkQueue.length >= maxPending) {
        logError?.('CHUNK', `Coda piena (>${maxPending}). Stop registrazione.`);
        showToast('Coda chunk piena: stop per evitare perdita dati', 'error');
        await stopChunkingRecording(true);
        return;
    }

    const key = `${chunkingSessionId || 'sess'}#${chunkIndex}`;
    chunkQueue.push({ key, chunkIndex, blob, createdAt: Date.now(), mimeType: blob.type || activeMimeType || 'audio/webm' });
    updateChunkingRuntimeUI();

    // Debug: cache audio chunk locally
    try {
        if (typeof debugLogEnabled !== 'undefined' && debugLogEnabled) {
            await saveAudioChunkToCache(chunkingSessionId || 'sess', chunkIndex, blob);
        }
    } catch (e) {}

    // Persist progress ASAP (so refresh won't lose queued state)
    try { await persistChunkVisitDraft(); } catch (e) {}

    // Kick worker
    processChunkQueue();
}

async function processChunkQueue() {
    if (!chunkingCfg) return;
    const maxConc = Number(chunkingCfg.maxConcurrentTranscriptions) || 1;
    while (chunkInFlight < maxConc && chunkQueue.length > 0) {
        const item = chunkQueue.shift();
        if (!item) break;
        chunkInFlight++;
        updateChunkingRuntimeUI();
        _transcribeChunkItem(item)
            .catch(e => {
                logError?.('CHUNK_TRANSCRIBE', `Chunk ${item.chunkIndex} fallito: ${e.message || e}`);
            })
            .finally(async () => {
                chunkInFlight--;
                updateChunkingRuntimeUI();
                try { await persistChunkVisitDraft(); } catch (e) {}
                // Continue draining
                setTimeout(() => processChunkQueue(), 50);
            });
    }
}

async function _transcribeChunkItem(item) {
    const retries = Number(chunkingCfg?.uploadRetryCount) || 0;
    const backoff = Number(chunkingCfg?.uploadRetryBackoffMs) || 1500;

    const t0 = performance.now();
    for (let attempt = 0; attempt <= retries; attempt++) {
        if (getVisitSignal() && getVisitSignal().aborted) throw new DOMException('Aborted', 'AbortError');

        try {
            const res = await transcribeDiarizedOpenAI(item.blob, attempt + 1, { chunkIndex: item.chunkIndex, sessionId: chunkingSessionId });
            const segments = Array.isArray(res.segments) ? res.segments : [];

            // Compute minutes best-effort
            let dur = 0;
            try { dur = await getAudioDurationSecondsFromBlob(item.blob); } catch (e) {}
            const minutes = dur ? (dur / 60) : ((Number(chunkingCfg?.chunkDurationSec) || 60) / 60);

            // Apply offsets + reindex
            const baseOffsetSec = _estimateChunkBaseOffsetSeconds(item.chunkIndex);
            const adjustedSegments = segments.map((s) => {
                const start = (Number(s.start) || 0) + baseOffsetSec;
                const end = (Number(s.end) || 0) + baseOffsetSec;
                return { ...s, start, end, segment_index: (globalSegmentIndex++) };
            });

            chunkResults.set(item.chunkIndex, { text: res.text || '', segments: adjustedSegments, minutes });
            tryAppendReadyChunkResults();

            // Cost tracking
            try {
                if (typeof trackTranscriptionMinutes === 'function') trackTranscriptionMinutes(minutes, 'gpt4o');
            } catch (e) {}

            const dt = ((performance.now() - t0) / 1000).toFixed(1);
            logDebug?.('CHUNK_DONE', `Chunk ${item.chunkIndex} trascritto (${dt}s, ${minutes.toFixed(2)} min)`);
            return;
        } catch (e) {
            if (isAbortError(e) || (getVisitSignal() && getVisitSignal().aborted)) throw e;

            if (attempt >= retries) {
                // Final failure: do NOT block the global append/drain.
                // We record a placeholder so chunkNextAppendIndex can advance and the user is informed.
                let minutes = ((Number(chunkingCfg?.chunkDurationSec) || 60) / 60);
                try {
                    const dur = await getAudioDurationSecondsFromBlob(item.blob);
                    if (dur) minutes = dur / 60;
                } catch (e2) {}

                const rawMsg = (e && e.message) ? e.message : String(e || 'errore');
                const shortMsg = rawMsg.length > 140 ? (rawMsg.slice(0, 137) + '...') : rawMsg;
                const marker = `⚠️ [Chunk ${item.chunkIndex + 1} non trascritto: ${shortMsg}]`;

                try {
                    chunkResults.set(item.chunkIndex, { text: marker, segments: [], minutes, failed: true, error: shortMsg });
                    tryAppendReadyChunkResults();
                } catch (e3) {}

                try {
                    showToast(`Chunk ${item.chunkIndex + 1} non trascritto: testo incompleto`, 'error');
                } catch (e4) {}

                return;
            }

            await _delay(backoff * (attempt + 1));
        }
    }
}

function _estimateChunkBaseOffsetSeconds(chunkIndex) {
    // Base offset derived from nominal chunkDurationSec, good enough for merges/ordering.
    const dur = Number(chunkingCfg?.chunkDurationSec) || 0;
    return dur > 0 ? (dur * chunkIndex) : 0;
}

function tryAppendReadyChunkResults() {
    while (chunkResults.has(chunkNextAppendIndex)) {
        const res = chunkResults.get(chunkNextAppendIndex);
        chunkResults.delete(chunkNextAppendIndex);

        // Append to textarea
        const ta = document.getElementById('transcriptionText');
        const prev = (ta?.value || '').toString();
        const add = (res?.text || '').toString().trim();
        const sep = prev.trim().length && add.length ? '\n\n' : '';
        const nextText = prev + sep + add;
        if (ta) ta.value = nextText;

        // Append segments
        try {
            if (Array.isArray(res.segments) && res.segments.length) {
                transcriptionSegments = (transcriptionSegments || []).concat(res.segments);
            }
            lastTranscriptionResult = { text: nextText, segments: transcriptionSegments };
            lastTranscriptionDiarized = true;
        } catch (e) {}

        // Ensure UI is in audio mode (read-only)
        try { if (typeof setTranscriptionFromAudio === 'function') setTranscriptionFromAudio(nextText, transcriptionSegments, true); } catch (e) {}

        chunkNextAppendIndex++;

        // Persist after each append
        persistChunkVisitDraft().catch(() => {});
    }
}

function _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms || 0)));
}

// --------------------------------------------
// IndexedDB: Visit Draft persistence
// --------------------------------------------

async function _openVisitDraftDB() {
    if (visitDraftDB) return visitDraftDB;
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(ADA_VISIT_DRAFT_DB, 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => { visitDraftDB = req.result; resolve(visitDraftDB); };
        req.onupgradeneeded = (evt) => {
            const db = evt.target.result;
            if (!db.objectStoreNames.contains(ADA_VISIT_DRAFT_STORE)) {
                db.createObjectStore(ADA_VISIT_DRAFT_STORE, { keyPath: 'key' });
            }
        };
    });
}

async function persistChunkVisitDraft() {
    try {
        const db = await _openVisitDraftDB();
        const tx = db.transaction(ADA_VISIT_DRAFT_STORE, 'readwrite');
        const store = tx.objectStore(ADA_VISIT_DRAFT_STORE);
        const ta = document.getElementById('transcriptionText');
        const payload = {
            key: 'current',
            sessionId: chunkingSessionId,
            profile: chunkingProfile,
            mimeType: activeMimeType,
            nextAppendIndex: chunkNextAppendIndex,
            currentChunkIndex,
            transcriptionText: (ta?.value || '').toString(),
            segments: transcriptionSegments || [],
            updatedAt: Date.now(),
        };
        store.put(payload);
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } catch (e) {
        // Best-effort, ignore
        return false;
    }
}

async function restoreChunkVisitDraft() {
    try {
        const db = await _openVisitDraftDB();
        const tx = db.transaction(ADA_VISIT_DRAFT_STORE, 'readonly');
        const store = tx.objectStore(ADA_VISIT_DRAFT_STORE);
        const req = store.get('current');

        const data = await new Promise((resolve) => {
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });

        if (!data) return;

        // Restore only if there's meaningful content
        const text = (data.transcriptionText || '').toString();
        const segs = Array.isArray(data.segments) ? data.segments : [];
        if (!text.trim() && segs.length === 0) return;

        // Restore globals
        chunkingSessionId = data.sessionId || null;
        chunkingProfile = data.profile || chunkingProfile;
        activeMimeType = data.mimeType || activeMimeType;
        chunkNextAppendIndex = Number(data.nextAppendIndex) || 0;
        currentChunkIndex = Number(data.currentChunkIndex) || 0;
        transcriptionSegments = segs;
        globalSegmentIndex = segs.length;

        // Restore UI text (audio mode)
        try { if (typeof setTranscriptionFromAudio === 'function') setTranscriptionFromAudio(text, segs, true); } catch (e) {
            const ta = document.getElementById('transcriptionText');
            if (ta) ta.value = text;
        }

        // Inform user (recording itself cannot be resumed after refresh)
        showToast('Ripristinato testo trascritto (chunking). Nota: la registrazione non riprende dopo refresh.', 'success');
    } catch (e) {}
}

// --------------------------------------------
// IndexedDB: Debug audio cache
// --------------------------------------------

async function _openAudioCacheDB() {
    if (audioCacheDB) return audioCacheDB;
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(ADA_AUDIOCACHE_DB, 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => { audioCacheDB = req.result; resolve(audioCacheDB); };
        req.onupgradeneeded = (evt) => {
            const db = evt.target.result;
            if (!db.objectStoreNames.contains(ADA_AUDIOCACHE_STORE)) {
                db.createObjectStore(ADA_AUDIOCACHE_STORE, { keyPath: 'key' });
            }
        };
    });
}

async function saveAudioChunkToCache(sessionId, chunkIndex, blob) {
    try {
        const db = await _openAudioCacheDB();
        const tx = db.transaction(ADA_AUDIOCACHE_STORE, 'readwrite');
        const store = tx.objectStore(ADA_AUDIOCACHE_STORE);
        const key = `${sessionId}#${chunkIndex}`;
        store.put({
            key,
            sessionId,
            chunkIndex,
            mimeType: blob.type || activeMimeType || 'audio/webm',
            size: blob.size || 0,
            createdAt: Date.now(),
            blob,
        });
        await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });

        // Log location (IndexedDB)
        logDebug?.('AUDIO_CACHE_SAVE', `Salvato chunk ${key} in IndexedDB(${ADA_AUDIOCACHE_DB}/${ADA_AUDIOCACHE_STORE})`);
        updateAudioCacheInfo().catch(() => {});
        return true;
    } catch (e) {
        return false;
    }
}

async function listSavedAudioChunks() {
    try {
        const db = await _openAudioCacheDB();
        const tx = db.transaction(ADA_AUDIOCACHE_STORE, 'readonly');
        const store = tx.objectStore(ADA_AUDIOCACHE_STORE);
        const req = store.getAll();
        const rows = await new Promise((resolve) => {
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
        return rows;
    } catch (e) {
        return [];
    }
}

async function clearSavedAudioChunks() {
    try {
        const db = await _openAudioCacheDB();
        const tx = db.transaction(ADA_AUDIOCACHE_STORE, 'readwrite');
        const store = tx.objectStore(ADA_AUDIOCACHE_STORE);
        store.clear();
        await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
        showToast('Cache audio di test cancellata', 'success');
        updateAudioCacheInfo().catch(() => {});
    } catch (e) {
        showToast('Errore cancellazione cache audio', 'error');
    }
}

async function exportSavedAudioChunks() {
    try {
        const rows = await listSavedAudioChunks();
        if (!rows.length) {
            showToast('Nessun file audio in cache', 'error');
            return;
        }

        if (typeof JSZip === 'undefined') {
            showToast('JSZip non disponibile (CDN).', 'error');
            return;
        }

        const zip = new JSZip();
        rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        rows.forEach(r => {
            const ext = (r.mimeType && r.mimeType.includes('mp4')) ? 'mp4' : 'webm';
            const name = `audio_chunks/${r.sessionId || 'sess'}_chunk_${String(r.chunkIndex).padStart(4, '0')}.${ext}`;
            zip.file(name, r.blob);
        });

        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ADA_audio_chunks_${Date.now()}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Export zip avviato', 'success');
    } catch (e) {
        showToast('Errore export cache audio', 'error');
    }
}

async function updateAudioCacheInfo() {
    try {
        const info = document.getElementById('audioCacheInfo');
        if (!info) return;
        const rows = await listSavedAudioChunks();
        const totalBytes = rows.reduce((s, r) => s + (r.size || 0), 0);
        const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
        info.textContent = rows.length
            ? `${rows.length} file in cache • ${totalMb} MB • IndexedDB: ${ADA_AUDIOCACHE_DB}/${ADA_AUDIOCACHE_STORE}`
            : 'Nessun file in cache.';
    } catch (e) {}
}

// --------------------------------------------
// Debug-only test helpers (long audio/text)
// --------------------------------------------

function triggerLongAudioTestUpload() {
    document.getElementById('longAudioTestInput')?.click();
}

function triggerLongTextTestUpload() {
    document.getElementById('longTextTestInput')?.click();
}



// --- Long-audio debug helper: decode + resample to 16k mono + split into valid WAV chunks (no container corruption) ---
async function decodeToMonoBuffer(arrayBuffer) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ac = new AudioCtx();
    try {
        const decoded = await ac.decodeAudioData(arrayBuffer.slice(0));
        // Mixdown to mono at original sample rate
        const channels = decoded.numberOfChannels || 1;
        const length = decoded.length;
        const sr = decoded.sampleRate;

        const mono = ac.createBuffer(1, length, sr);
        const monoData = mono.getChannelData(0);

        if (channels === 1) {
            monoData.set(decoded.getChannelData(0));
        } else {
            // Average all channels
            const chData = [];
            for (let c = 0; c < channels; c++) chData.push(decoded.getChannelData(c));
            for (let i = 0; i < length; i++) {
                let sum = 0;
                for (let c = 0; c < channels; c++) sum += chData[c][i];
                monoData[i] = sum / channels;
            }
        }
        return mono;
    } finally {
        // Close context to free resources
        try { await ac.close(); } catch (_) {}
    }
}

async function resampleAudioBufferTo16k(monoBuffer) {
    const targetRate = 16000;
    if (!monoBuffer) return null;
    if (monoBuffer.sampleRate === targetRate) return monoBuffer;

    const length = Math.ceil(monoBuffer.duration * targetRate);
    const oac = new OfflineAudioContext(1, length, targetRate);

    const src = oac.createBufferSource();
    src.buffer = monoBuffer;
    src.connect(oac.destination);
    src.start(0);

    const rendered = await oac.startRendering();
    return rendered;
}

function encodeWavInt16(samplesFloat32, sampleRate) {
    const numChannels = 1;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = samplesFloat32.length * bytesPerSample;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    function writeString(offset, str) {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM
    view.setUint16(20, 1, true);  // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // bits per sample
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // PCM data
    let offset = 44;
    for (let i = 0; i < samplesFloat32.length; i++, offset += 2) {
        let s = samplesFloat32[i];
        if (s > 1) s = 1;
        if (s < -1) s = -1;
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return new Blob([buffer], { type: 'audio/wav' });
}

async function buildWavChunksFromFile(file, chunkSeconds = 600) {
    const ab = await file.arrayBuffer();
    logDebug?.('DEBUG_LONG_AUDIO', `Decoding for WAV chunking: ${file.size} bytes, type=${file.type || 'n/a'}`);

    const mono = await decodeToMonoBuffer(ab);
    const audio16k = await resampleAudioBufferTo16k(mono);
    const sr = audio16k.sampleRate;
    const data = audio16k.getChannelData(0);

    const totalSamples = data.length;
    const chunkSamples = Math.max(1, Math.floor(chunkSeconds * sr));
    const chunks = [];

    let idx = 0;
    let part = 0;
    while (idx < totalSamples) {
        const end = Math.min(totalSamples, idx + chunkSamples);
        const slice = data.slice(idx, end); // copies
        const wavBlob = encodeWavInt16(slice, sr);
        chunks.push({ blob: wavBlob, part });
        part++;
        idx = end;
    }
    return { chunks, durationSec: audio16k.duration };
}

async function handleLongAudioTestUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';

    // NOTE: WebM/MP4 containers cannot be safely "byte-sliced" into valid sub-files.
    // A truncated container often triggers: "Audio file might be corrupted or unsupported".
    // For the debug long-audio tool we therefore send the ORIGINAL file as a single request.
    // If the file is above the upload cap, we instruct the user to split/convert externally.

    try {
        const maxUploadBytes = 25 * 1024 * 1024; // 25 MB (OpenAI file upload cap)

        // If under cap, send as a single chunk (fast path).
        let preparedChunks = null;
        let preparedDurationSec = null;

        if (file.size <= maxUploadBytes) {
            preparedChunks = [{ blob: file, part: 0 }];
            preparedDurationSec = null;
        } else {
            // Over cap: build VALID audio chunks in WAV (16k mono) to stay under the API limit.
            // This avoids corrupt WebM slicing and supports very long files.
            showToast('Pre-elaborazione audio lunga: conversione in chunk WAV (16k mono)…', 'info');

            // Default: 10 minutes per chunk (~19MB at 16k mono WAV)
            let chunkSeconds = 600;
            let built = await buildWavChunksFromFile(file, chunkSeconds);
            preparedChunks = built.chunks;
            preparedDurationSec = built.durationSec;

            // Safety: if any chunk is still above maxUploadBytes, reduce chunkSeconds iteratively.
            // (Should be rare unless sampleRate differs or browser output differs.)
            let guard = 0;
            while (preparedChunks.some(c => c.blob.size > maxUploadBytes) && guard < 5) {
                chunkSeconds = Math.max(120, Math.floor(chunkSeconds * 0.7));
                logDebug?.('DEBUG_LONG_AUDIO', `Chunk WAV too big, retry with chunkSeconds=${chunkSeconds}`);
                built = await buildWavChunksFromFile(file, chunkSeconds);
                preparedChunks = built.chunks;
                preparedDurationSec = built.durationSec;
                guard++;
            }

            if (preparedChunks.some(c => c.blob.size > maxUploadBytes)) {
                showToast('Impossibile creare chunk sotto 25MB in questo browser. Prova a convertire in MP3/WAV e riprova.', 'error');
                logError?.('DEBUG_LONG_AUDIO', `Unable to chunk under cap. File=${file.size} bytes, chunks=${preparedChunks.map(c=>c.blob.size).join(',')}`);
                return;
            }

            logDebug?.('DEBUG_LONG_AUDIO', `Prepared ${preparedChunks.length} WAV chunks under cap. durationSec=${preparedDurationSec?.toFixed?.(1) || 'n/a'}`);
        }

        // Initialize a chunking session for consistent UI.
        chunkingProfile = typeof detectRecordingProfile === 'function' ? detectRecordingProfile() : 'desktop';
        chunkingCfg = typeof loadChunkingConfig === 'function'
            ? loadChunkingConfig(chunkingProfile)
            : (chunkingCfg || {});
        activeMimeType = file.type || activeMimeType;

        chunkingSessionId = `debug_file_${Date.now()}`;
        currentChunkIndex = preparedChunks.length;   // total chunks
        chunkNextAppendIndex = 0;
        globalSegmentIndex = 0;
        chunkQueue = [];
        chunkResults = new Map();
        chunkInFlight = 0;

        showChunkingRuntime();
        updateChunkingRuntimeUI();

        if (preparedChunks.length === 1) {
            showToast('Test audio lungo: invio il file completo per trascrizione...', 'success');
        } else {
            showToast(`Test audio lungo: creati ${preparedChunks.length} chunk WAV (16k mono)`, 'success');
        }

        // Reset transcription
        try { if (typeof setTranscriptionFromText === 'function') setTranscriptionFromText(''); } catch (_) {}
        try { if (typeof setTranscriptionText === 'function') setTranscriptionText(''); } catch (_) {}

        // Enqueue all prepared chunks (kept under cap).
        for (const c of preparedChunks) {
            const blob = c?.blob;
            const idx = Number(c?.part ?? 0);
            await enqueueChunkForTranscription(blob, idx);
        }
        processChunkQueue();

        // Wait for queue drain (will also persist drafts)
        await waitForChunkQueueToDrain({ force: false });
    } catch (e) {
        showToast('Errore test audio lungo: ' + (e?.message || e), 'error');
        logError?.('DEBUG_LONG_AUDIO', e?.message || String(e));
    }
}

async function handleLongTextTestUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';

    try {
        const text = await file.text();
        const chunkSize = 4000;
        const total = Math.max(1, Math.ceil(text.length / chunkSize));

        // Reset
        try { if (typeof setTranscriptionFromTextFile === 'function') setTranscriptionFromTextFile(''); } catch (e) {}
        const ta = document.getElementById('transcriptionText');
        if (ta) ta.value = '';

        showToast(`Test append: simulo ${total} parti...`, 'success');
        showTranscriptionCard?.();

        for (let i = 0; i < total; i++) {
            const part = text.slice(i * chunkSize, Math.min(text.length, (i + 1) * chunkSize));
            const prev = (ta?.value || '').toString();
            const sep = prev.trim().length ? '\n\n' : '';
            if (ta) ta.value = prev + sep + part;
            await _delay(10);
        }

        showToast('Test append completato', 'success');
    } catch (e) {
        showToast('Errore test testo lungo', 'error');
    }
}

// Provide a logDebug helper (more verbose than logError). Uses ADA.log.
function logDebug(context, message) {
    try {
        if (typeof debugLogEnabled === 'undefined' || !debugLogEnabled) return;
        let msg = message;
        if (typeof msg !== 'string') {
            try { msg = JSON.stringify(msg); } catch (e) { msg = String(msg); }
        }
        const now = new Date();
        const timestamp = now.toLocaleString('it-IT', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        const entry = `[${timestamp}] DEBUG ${context}: ${msg}\n`;
        let existingLog = localStorage.getItem('ADA_LOG') || '';
        existingLog += entry;
        localStorage.setItem('ADA_LOG', existingLog);
    } catch (e) {}
}

// ============================================
// TRANSCRIPTION WITH DIARIZATION
// ============================================

async function transcribeAudio() {
    // A new transcription implies a new referto draft
    try { if (typeof resetSoapDraftLink === 'function') resetSoapDraftLink(); } catch (e) {}

    if (!audioBlob || audioBlob.size === 0) {
        showToast('Nessun audio da trascrivere', 'error');
        return;
    }
    
    showProgress(true);
    const t0 = performance.now();
    const recordedMinutes = seconds > 0 ? seconds / 60 : 1;
    
    // Try diarized transcription first
    document.getElementById('recordingStatus').textContent = 'Sto trascrivendo la registrazione.';
    
    try {
        const result = await transcribeDiarizedOpenAI(audioBlob, 1); // attempt 1
        lastTranscriptionResult = result;
        lastTranscriptionDiarized = true;
        // Expose for SOAP generation
        transcriptionSegments = Array.isArray(result.segments) ? result.segments : [];
        
        // Compact and display
        const compacted = compactSegments(result.segments || []);
        const displayText = renderCompactLines(compacted);
        if (typeof setTranscriptionFromAudio === 'function') {
            setTranscriptionFromAudio(displayText, transcriptionSegments, true);
        } else {
            document.getElementById('transcriptionText').value = displayText;
        }
        const dt = ((performance.now() - t0) / 1000).toFixed(1);

        if (typeof trackTranscriptionMinutes === 'function') trackTranscriptionMinutes(recordedMinutes, 'gpt4o');
        else {
            ensureApiUsageShape?.();
            apiUsage.gpt4o_transcribe_minutes = (apiUsage.gpt4o_transcribe_minutes || 0) + recordedMinutes;
            saveApiUsage?.();
            updateCostDisplay?.();
        }
        showToast(`✅ Trascrizione completata (${dt}s)`, 'success');
        
    } catch (error) {
        if (isAbortError(error) || (getVisitSignal() && getVisitSignal().aborted)) {
            throw error;
        }
        console.error('Diarization attempt 1 failed:', error);
        logError("TRASCRIZIONE", `Tentativo 1 fallito - ${error.message}`);
        
        // Retry once
        document.getElementById('recordingStatus').textContent = 'Sto trascrivendo la registrazione.';
        
        try {
            const result = await transcribeDiarizedOpenAI(audioBlob, 2); // attempt 2
            lastTranscriptionResult = result;
            lastTranscriptionDiarized = true;
            // Expose for SOAP generation
            transcriptionSegments = Array.isArray(result.segments) ? result.segments : [];
            
            const compacted = compactSegments(result.segments || []);
            const displayText = renderCompactLines(compacted);
            if (typeof setTranscriptionFromAudio === 'function') {
                setTranscriptionFromAudio(displayText, transcriptionSegments, true);
            } else {
                document.getElementById('transcriptionText').value = displayText;
            }
            const dt = ((performance.now() - t0) / 1000).toFixed(1);

            if (typeof trackTranscriptionMinutes === 'function') trackTranscriptionMinutes(recordedMinutes, 'gpt4o');
            showToast(`✅ Trascrizione completata al secondo tentativo (${dt}s)`, 'success');
            
        } catch (error2) {
            if (isAbortError(error2) || (getVisitSignal() && getVisitSignal().aborted)) {
                throw error2;
            }
            console.error('Diarization attempt 2 failed:', error2);
            logError("TRASCRIZIONE", `Tentativo 2 fallito - ${error2.message}`);
            
            // Ask user for fallback
            if (getVisitSignal() && getVisitSignal().aborted) { throw new DOMException('Aborted', 'AbortError'); }
            const useFallback = confirm(
                'La trascrizione con riconoscimento parlanti non è riuscita.\n\n' +
                'Errore: ' + error2.message + '\n\n' +
                'Vuoi usare Whisper come fallback?\n' +
                '(ATTENZIONE: senza riconoscimento parlanti non sarà possibile distinguere chi parla)'
            );
            
            if (useFallback) {
                await transcribeWithWhisperFallback(recordedMinutes);
            } else {
                document.getElementById('recordingStatus').textContent = '❌ Trascrizione annullata';
                showToast('Trascrizione annullata', 'error');
            }
        }
    }
    
    showProgress(false);
    resetTimer();
    audioBlob = null;
    audioChunks = [];
}

// Diarized transcription using gpt-4o-transcribe-diarize (native speaker diarization)
async function transcribeDiarizedOpenAI(blob, attemptNum) {
    console.log(`Transcription attempt ${attemptNum}...`);

    // Debug logging
    if (typeof logDebug === 'function') {
        logDebug('TRANSCRIBE_START', {
            size: blob.size,
            type: blob.type,
            name: blob.name || audioFileName,
            attempt: attemptNum
        });
    }

    const fd = new FormData();

    // CRITICAL FIX: Preserve original file name/type for uploaded files
    if (blob instanceof File && blob.name) {
        fd.append('file', blob, blob.name);
        console.log('Using original file:', blob.name, blob.type);
    } else {
        // For recorded blobs, create a File with correct MIME and filename
        const fileName = audioFileName || 'recording.webm';
        const mimeType = audioFileType || blob.type || 'audio/webm';
        const file = new File([blob], fileName, { type: mimeType });
        fd.append('file', file, fileName);
        console.log('Created file from blob:', fileName, mimeType);
    }

    // Use native diarization model
    fd.append('model', 'gpt-4o-transcribe-diarize');
    fd.append('response_format', 'diarized_json');
    fd.append('language', 'it');
    // Required for audio > 30s
    fd.append('chunking_strategy', 'auto');

    // Add known speaker references (optional but recommended)
    const speakersConfig = await getSavedSpeakersForTranscription();
    if (speakersConfig.length > 0) {
        for (const spk of speakersConfig) {
            // OpenAI expects data URLs
            const dataUrl = await blobToDataURL(spk.refBlob);
            fd.append('known_speaker_names[]', spk.name);
            fd.append('known_speaker_references[]', dataUrl);
        }
    }

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + API_KEY },
        body: fd,
        signal: getVisitSignal()
    });

    const responseText = await response.text();

    if (typeof logDebug === 'function') {
        logDebug('TRANSCRIBE_RESPONSE', {
            status: response.status,
            preview: responseText.substring(0, 300)
        });
    }

    if (!response.ok) {
        console.error('Transcription error:', response.status, responseText);

        // If audio format issue - try normalization
        if (responseText.includes('corrupted or unsupported') || responseText.includes('invalid_value')) {
            console.log('Audio format issue detected, attempting normalization...');
            return await transcribeWithNormalizedAudio(blob, speakersConfig);
        }

        if (responseText.includes('insufficient_quota')) {
            if (typeof showCreditExhaustedModal === 'function') {
                showCreditExhaustedModal();
            }
        }

        throw new Error(`HTTP ${response.status}: ${responseText.substring(0, 200)}`);
    }

    const result = JSON.parse(responseText);
    console.log('Diarized transcription result:', result);

    // Normalize diarized segments into our internal format
    const rawSegs = Array.isArray(result.segments) ? result.segments : [];
    const processedSegments = rawSegs.map((seg, index) => ({
        segment_index: index,
        id: seg.id ?? index,
        text: seg.text || '',
        start: seg.start ?? 0,
        end: seg.end ?? 0,
        speaker: seg.speaker || 'sconosciuto',
        role: 'unknown'
    }));

    // Assign roles deterministically: from settings when possible, otherwise heuristic
    applyRolesFromSpeakersConfig(processedSegments, speakersConfig);

    result.segments = processedSegments;

    // Some responses may not include duration; keep best-effort
    if (result.duration == null) {
        // Try to infer from last segment end
        const lastEnd = processedSegments.length ? processedSegments[processedSegments.length - 1].end : 0;
        result.duration = lastEnd || 0;
    }

    return result;
}

// Normalize audio to WAV for problematic files
async function transcribeWithNormalizedAudio(originalBlob, speakersConfig) {
    console.log('Normalizing audio to WAV...');

    if (typeof logDebug === 'function') {
        logDebug('NORMALIZE_START', { originalSize: originalBlob.size });
    }

    try {
        const normalizedWav = await normalizeAudioToWav(originalBlob);

        if (!normalizedWav) {
            throw new Error('Audio normalization failed');
        }

        console.log('Normalized WAV size:', normalizedWav.size);

        const fd = new FormData();
        fd.append('file', normalizedWav, 'normalized.wav');
        fd.append('model', 'gpt-4o-transcribe-diarize');
        fd.append('response_format', 'diarized_json');
        fd.append('language', 'it');
        fd.append('chunking_strategy', 'auto');

        // Add known speakers again after normalization
        if (speakersConfig && speakersConfig.length > 0) {
            for (const spk of speakersConfig) {
                const dataUrl = await blobToDataURL(spk.refBlob);
                fd.append('known_speaker_names[]', spk.name);
                fd.append('known_speaker_references[]', dataUrl);
            }
        }

        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + API_KEY },
            body: fd,
        signal: getVisitSignal()
    });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Normalized transcription failed: ${errText.substring(0, 200)}`);
        }

        const result = await response.json();

        // Normalize diarized segments into our internal format
        const rawSegs = Array.isArray(result.segments) ? result.segments : [];
        const processedSegments = rawSegs.map((seg, index) => ({
            segment_index: index,
            id: seg.id ?? index,
            text: seg.text || '',
            start: seg.start ?? 0,
            end: seg.end ?? 0,
            speaker: seg.speaker || 'sconosciuto',
            role: 'unknown'
        }));

        applyRolesFromSpeakersConfig(processedSegments, speakersConfig || []);
        result.segments = processedSegments;

        if (result.duration == null) {
            const lastEnd = processedSegments.length ? processedSegments[processedSegments.length - 1].end : 0;
            result.duration = lastEnd || 0;
        }

        return result;

    } catch (error) {
        console.error('Normalization failed:', error);
        throw error;
    }
}

// Convert audio to 16kHz mono WAV using Web Audio API
async function normalizeAudioToWav(blob) {
    try {
        const arrayBuffer = await blob.arrayBuffer();
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        
        // Resample to 16kHz mono
        const targetSampleRate = 16000;
        const length = Math.ceil(audioBuffer.duration * targetSampleRate);
        
        const offlineCtx = new OfflineAudioContext(1, length, targetSampleRate);
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineCtx.destination);
        source.start();
        
        const renderedBuffer = await offlineCtx.startRendering();
        const wavBlob = audioBufferToWav(renderedBuffer);
        
        audioCtx.close();
        
        return new File([wavBlob], 'normalized.wav', { type: 'audio/wav' });
        
    } catch (error) {
        console.error('Audio normalization error:', error);
        return null;
    }
}

// Convert AudioBuffer to WAV blob
function audioBufferToWav(buffer) {
    const numChannels = 1;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    
    const samples = buffer.getChannelData(0);
    const dataLength = samples.length * bytesPerSample;
    const bufferLength = 44 + dataLength;
    
    const arrayBuffer = new ArrayBuffer(bufferLength);
    const view = new DataView(arrayBuffer);
    
    // WAV header
    writeWavString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeWavString(view, 8, 'WAVE');
    writeWavString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeWavString(view, 36, 'data');
    view.setUint32(40, dataLength, true);
    
    // Write samples
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
    }
    
    return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeWavString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

// Post-process to identify speakers using GPT-4o-mini
async function identifySpeakers(segments, speakersConfig) {
    if (!segments || segments.length === 0) return segments;
    
    // Build text for speaker identification with timestamps
    const segmentTexts = segments.map((s) => {
        const time = s.start ? `${formatTimeShort(s.start)}-${formatTimeShort(s.end)}` : '';
        return `[${s.segment_index}|${time}] ${s.text}`;
    }).join('\n');
    
    // Build speaker hints with roles
    let speakerHints = '';
    if (speakersConfig && speakersConfig.length > 0) {
        speakerHints = `Parlanti noti:\n${speakersConfig.map(s => `- ${s.name} (ruolo: ${s.role || 'sconosciuto'})`).join('\n')}`;
    } else {
        speakerHints = `Identifica questi ruoli:
- "Veterinario": usa terminologia medica, fa domande cliniche, descrive l'esame
- "Proprietario": descrive sintomi in linguaggio comune, risponde alle domande sul pet`;
    }
    
    const prompt = `Analizza questa trascrizione di una visita veterinaria e identifica chi parla.

${speakerHints}

TRASCRIZIONE:
${segmentTexts}

Rispondi SOLO con un JSON array. Per ogni segmento indica:
- segment_index: numero del segmento (int)
- speaker: nome del parlante (string)
- role: ruolo tra "veterinario", "proprietario", "assistente", "unknown" (string)
- confidence: confidenza 0-1 (number)

Esempio: [{"segment_index": 0, "speaker": "Veterinario", "role": "veterinario", "confidence": 0.9}]`;

    try {
        const response = await fetchBackend('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'gpt-4o-mini', // Cheaper model for this task
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2
            }),
            signal: getVisitSignal()
        });
        
        if (!response.ok) {
            const err = await response.json().catch(() => null);
            throw new Error(err?.error?.message || `HTTP ${response.status}`);
        }
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        
        // Parse speaker assignments
        const assignments = (typeof _extractJsonArray === 'function') ? _extractJsonArray(content) : null;
        if (assignments) {
            
            // Apply speaker labels and roles to segments
            assignments.forEach(a => {
                const seg = segments.find(s => s.segment_index === a.segment_index);
                if (seg) {
                    seg.speaker = a.speaker || 'Unknown';
                    seg.role = a.role || 'unknown';
                    seg.speaker_confidence = a.confidence || 0.5;
                }
            });
        }
        
        trackChatUsage('gpt-4o', data.usage);
        saveApiUsage();
        
    } catch (e) {
        console.warn('Speaker identification failed:', e);
        // Fallback: alternate speakers
        segments.forEach((s, i) => {
            s.speaker = i % 2 === 0 ? 'Veterinario' : 'Proprietario';
            s.role = i % 2 === 0 ? 'veterinario' : 'proprietario';
            s.speaker_confidence = 0.3;
        });
    }
    
    return segments;
}


// Heuristic role inference for segments when diarization does not provide roles
function inferRoleByText(text) {
    const t = (text || '').toLowerCase();
    if (!t) return 'unknown';

    const vetHints = [
        'temperatura', 'febbre', 'auscult', 'palpaz', 'esame', 'diagnosi', 'terapia', 'prescr',
        'dose', 'mg', 'ml', 'kg', 'rx', 'radiograf', 'ecograf', 'analisi', 'emocromo', 'biochim',
        'tachicardia', 'dispnea', 'mucose', 'trc', 'linfon', 'somministr', 'iniez', 'endoven',
        'sottocute', 'intramus', 'farmaco', 'antibiotic', 'cortis', 'antinfiamm', 'visita'
    ];
    const ownerHints = [
        'ha', 'ieri', 'stamattina', 'a casa', 'ho notato', 'mi sembra', 'non mangia', 'non beve',
        'vomit', 'diarrea', 'tosse', 'starnut', 'si gratta', 'piange', 'zoppica', 'da ieri',
        'da due giorni', 'stanotte', 'lui', 'lei'
    ];

    let vetScore = 0;
    let ownerScore = 0;

    for (const h of vetHints) if (t.includes(h)) vetScore++;
    for (const h of ownerHints) if (t.includes(h)) ownerScore++;

    if (vetScore >= ownerScore + 2) return 'veterinario';
    if (ownerScore >= vetScore + 2) return 'proprietario';
    return 'unknown';
}

function applyRolesFromSpeakersConfig(segments, speakersConfig) {
    const map = new Map();
    (speakersConfig || []).forEach(s => {
        if (s?.name) map.set(String(s.name).toLowerCase(), s.role || 'unknown');
    });

    for (const seg of segments) {
        const spk = (seg.speaker || '').toLowerCase();
        if (map.has(spk)) {
            seg.role = map.get(spk);
        } else {
            seg.role = seg.role && seg.role !== 'unknown' ? seg.role : inferRoleByText(seg.text);
        }
    }
}

function formatTimeShort(seconds) {
    if (!seconds && seconds !== 0) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Whisper fallback (no diarization) - but WITH segments/timestamps
async function transcribeWithWhisperFallback(recordedMinutes) {
    document.getElementById('recordingStatus').textContent = 'Sto trascrivendo la registrazione.';

    const t0 = performance.now();

    try {
        const formData = new FormData();

        // Preserve original file name/type if uploaded
        if (audioBlob instanceof File && audioBlob.name) {
            formData.append('file', audioBlob, audioBlob.name);
        } else {
            const fileName = audioFileName || 'recording.webm';
            const mimeType = audioFileType || audioBlob.type || 'audio/webm';
            const file = new File([audioBlob], fileName, { type: mimeType });
            formData.append('file', file, fileName);
        }

        formData.append('model', 'whisper-1');
        formData.append('language', 'it');
        formData.append('response_format', 'verbose_json');
        formData.append('timestamp_granularities[]', 'segment');
        formData.append('prompt', 'Trascrizione visita veterinaria. Termini: anamnesi, dispnea, tachicardia, BID, TID.');

        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + API_KEY },
            body: formData,
            signal: getVisitSignal()
        });

        const responseText = await response.text();
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${responseText.substring(0, 200)}`);
        }

        const result = JSON.parse(responseText);
        if (result.error) throw new Error(result.error.message);

        // Build internal segments list (speaker unknown)
        const rawSegs = Array.isArray(result.segments) ? result.segments : [];
        const processedSegments = rawSegs.map((seg, index) => ({
            segment_index: index,
            id: seg.id ?? index,
            text: seg.text || '',
            start: seg.start ?? 0,
            end: seg.end ?? 0,
            speaker: 'sconosciuto',
            role: inferRoleByText(seg.text || '')
        }));

        // Expose for SOAP generation
        transcriptionSegments = processedSegments;

        // Keep also in lastTranscriptionResult
        lastTranscriptionResult = { ...result, segments: processedSegments };
        lastTranscriptionDiarized = false;

        // Display with segment lines (avoids losing timestamps)
        const compacted = compactSegments(processedSegments);
        const displayText = '⚠️ SENZA DIARIZZAZIONE (Whisper)\n\n' + renderCompactLines(compacted);
        if (typeof setTranscriptionFromAudio === 'function') {
            setTranscriptionFromAudio(displayText, processedSegments, false);
        } else {
            document.getElementById('transcriptionText').value = displayText;
        }
        const dt = ((performance.now() - t0) / 1000).toFixed(1);
        document.getElementById('recordingStatus').textContent = 'Sto trascrivendo la registrazione.';

        // Use actual duration when available
        const minutes = (result.duration ? (result.duration / 60) : recordedMinutes);
        if (typeof trackTranscriptionMinutes === 'function') trackTranscriptionMinutes(minutes, 'whisper');
        showToast(`⚠️ Trascrizione Whisper completata (${dt}s)`, 'success');

    } catch (e) {
        console.error('Whisper fallback failed:', e);
        document.getElementById('recordingStatus').textContent = '❌ Errore';
        showToast('Errore: ' + e.message, 'error');
    }
}

// ============================================
// SEGMENT COMPACTION
// ============================================

function normalizeText(text) {
    if (!text) return '';
    
    // Trim and collapse whitespace
    let normalized = text.trim().replace(/\s+/g, ' ');
    
    // Remove isolated fillers only if they're the entire content
    const fillers = ['ehm', 'uhm', 'eh', 'ah', 'allora', 'ok', 'okay', 'ecco', 'dunque', 'quindi', 'cioè'];
    const lowerText = normalized.toLowerCase();
    
    if (fillers.includes(lowerText) || fillers.includes(lowerText.replace(/[.,!?]/g, ''))) {
        return '';
    }
    
    return normalized;
}

function compactSegments(segments) {
    if (!segments || segments.length === 0) return [];
    
    const compacted = [];
    let current = null;
    
    segments.forEach((seg, index) => {
        const text = normalizeText(seg.text);
        if (!text) return; // Skip empty/filler segments
        
        const segmentIndex = seg.segment_index !== undefined ? seg.segment_index : index;
        const speaker = seg.speaker || 'sconosciuto';
        const role = seg.role || 'unknown';
        
        if (!current) {
            current = {
                speaker: speaker,
                role: role,
                start: seg.start || 0,
                end: seg.end || 0,
                text: text,
                segment_ids: [segmentIndex]
            };
        } else if (
            current.speaker === speaker &&
            (seg.start - current.end) <= 1.2 // Gap <= 1.2s
        ) {
            // Merge with current
            current.end = seg.end || current.end;
            current.text += ' ' + text;
            current.segment_ids.push(segmentIndex);
        } else {
            // Save current and start new
            compacted.push(current);
            current = {
                speaker: speaker,
                role: role,
                start: seg.start || 0,
                end: seg.end || 0,
                text: text,
                segment_ids: [segmentIndex]
            };
        }
    });
    
    if (current) {
        compacted.push(current);
    }
    
    return compacted;
}

function renderCompactLines(compactedSegments) {
    // Display-only: omit diarization metadata ([SEG], timestamps).
    // Internal segment data is preserved in transcriptionSegments for SOAP generation.
    return compactedSegments.map(seg => {
        return `${seg.speaker}: ${seg.text}`;
    }).join('\n\n');
}

// ============================================
// SPEAKERS REFERENCE CLIPS (Settings)
// ============================================

const SPEAKERS_DB_NAME = 'ADA_Speakers';
const SPEAKERS_STORE_NAME = 'speakers';
let speakersDB = null;

async function initSpeakersDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(SPEAKERS_DB_NAME, 1);
        
        request.onerror = () => reject(request.error);
        
        request.onsuccess = () => {
            speakersDB = request.result;
            resolve(speakersDB);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(SPEAKERS_STORE_NAME)) {
                db.createObjectStore(SPEAKERS_STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}

async function getSavedSpeakers() {
    if (!speakersDB) await initSpeakersDB();
    
    return new Promise((resolve, reject) => {
        const tx = speakersDB.transaction(SPEAKERS_STORE_NAME, 'readonly');
        const store = tx.objectStore(SPEAKERS_STORE_NAME);
        const request = store.getAll();
        
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

async function saveSpeaker(speaker) {
    if (!speakersDB) await initSpeakersDB();
    
    return new Promise((resolve, reject) => {
        const tx = speakersDB.transaction(SPEAKERS_STORE_NAME, 'readwrite');
        const store = tx.objectStore(SPEAKERS_STORE_NAME);
        const request = store.put(speaker);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function deleteSpeaker(id) {
    if (!speakersDB) await initSpeakersDB();
    
    return new Promise((resolve, reject) => {
        const tx = speakersDB.transaction(SPEAKERS_STORE_NAME, 'readwrite');
        const store = tx.objectStore(SPEAKERS_STORE_NAME);
        const request = store.delete(id);
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function getSavedSpeakersForTranscription() {
    const speakers = await getSavedSpeakers();
    return speakers
        .filter(s => s.name && s.audioBlob)
        .slice(0, 4)
        .map(s => ({ name: s.name, role: s.role || 'unknown', refBlob: s.audioBlob }));
}

// Speaker clip recording
let speakerRecorder = null;
let speakerChunks = [];
let recordingSpeakerId = null;

async function startSpeakerClipRecording(speakerId) {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        speakerRecorder = new MediaRecorder(stream);
        speakerChunks = [];
        recordingSpeakerId = speakerId;
        
        speakerRecorder.ondataavailable = e => speakerChunks.push(e.data);
        speakerRecorder.start();
        
        const btn = document.querySelector(`[data-speaker-id="${speakerId}"] .btn-record-clip`);
        if (btn) {
            btn.textContent = '⏹ Stop';
            btn.classList.add('recording');
        }
        
        showToast('🔴 Registra 3-8 secondi...', 'success');
        
        // Auto-stop after 10 seconds
        setTimeout(() => {
            if (speakerRecorder && speakerRecorder.state === 'recording') {
                stopSpeakerClipRecording();
            }
        }, 10000);
        
    } catch (e) {
        showToast('Errore microfono', 'error');
    }
}

async function stopSpeakerClipRecording() {
    if (!speakerRecorder || speakerRecorder.state !== 'recording') return;
    
    speakerRecorder.onstop = async () => {
        const audioBlob = new Blob(speakerChunks, { type: 'audio/webm' });
        
        // Save to speaker
        const speakers = await getSavedSpeakers();
        const speaker = speakers.find(s => s.id === recordingSpeakerId);
        
        if (speaker) {
            speaker.audioBlob = audioBlob;
            await saveSpeaker(speaker);
            renderSpeakersSettings();
            showToast('Clip salvata!', 'success');
        }
        
        speakerRecorder.stream.getTracks().forEach(t => t.stop());
        speakerRecorder = null;
        speakerChunks = [];
        recordingSpeakerId = null;
    };
    
    speakerRecorder.stop();
}

function toggleSpeakerClipRecording(speakerId) {
    if (speakerRecorder && speakerRecorder.state === 'recording' && recordingSpeakerId === speakerId) {
        stopSpeakerClipRecording();
    } else {
        startSpeakerClipRecording(speakerId);
    }
}

async function playSpeakerClip(speakerId) {
    const speakers = await getSavedSpeakers();
    const speaker = speakers.find(s => s.id === speakerId);
    
    if (speaker?.audioBlob) {
        const url = URL.createObjectURL(speaker.audioBlob);
        const audio = new Audio(url);
        audio.play();
        audio.onended = () => URL.revokeObjectURL(url);
    } else {
        showToast('Nessuna clip registrata', 'error');
    }
}

async function addNewSpeaker() {
    const speakers = await getSavedSpeakers();
    if (speakers.length >= 4) {
        showToast('Massimo 4 parlanti (limite API)', 'error');
        return;
    }
    
    // Alternate default roles
    const defaultRole = speakers.length === 0 ? 'veterinario' : 'proprietario';
    const defaultName = speakers.length === 0 ? 'Veterinario' : `Proprietario${speakers.length > 1 ? ' ' + speakers.length : ''}`;
    
    const newSpeaker = {
        name: defaultName,
        role: defaultRole,
        audioBlob: null
    };
    
    await saveSpeaker(newSpeaker);
    renderSpeakersSettings();
    showToast('Parlante aggiunto', 'success');
}

async function updateSpeakerName(id, name) {
    const speakers = await getSavedSpeakers();
    const speaker = speakers.find(s => s.id === id);
    if (speaker) {
        speaker.name = name;
        await saveSpeaker(speaker);
    }
}

async function updateSpeakerRole(id, role) {
    const speakers = await getSavedSpeakers();
    const speaker = speakers.find(s => s.id === id);
    if (speaker) {
        speaker.role = role;
        await saveSpeaker(speaker);
        showToast('Ruolo aggiornato', 'success');
    }
}

async function removeSpeaker(id) {
    if (confirm('Eliminare questo parlante e la sua clip audio?')) {
        await deleteSpeaker(id);
        renderSpeakersSettings();
        showToast('Parlante eliminato', 'success');
    }
}

async function renderSpeakersSettings() {
    const container = document.getElementById('speakersContainer');
    if (!container) return;
    
    const speakers = await getSavedSpeakers();
    
    if (speakers.length === 0) {
        container.innerHTML = '<p style="color:#888;text-align:center;">Nessun parlante configurato</p>';
    } else {
        container.innerHTML = speakers.map(speaker => `
            <div class="speaker-item" data-speaker-id="${speaker.id}">
                <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;">
                    <input type="text" class="speaker-name-input" value="${speaker.name || ''}" 
                           onchange="updateSpeakerName(${speaker.id}, this.value)" 
                           placeholder="Nome parlante" style="flex:1;">
                    <select class="speaker-role-select" onchange="updateSpeakerRole(${speaker.id}, this.value)">
                        <option value="veterinario" ${speaker.role === 'veterinario' ? 'selected' : ''}>🩺 Veterinario</option>
                        <option value="proprietario" ${speaker.role === 'proprietario' || !speaker.role ? 'selected' : ''}>👤 Proprietario</option>
                        <option value="assistente" ${speaker.role === 'assistente' ? 'selected' : ''}>👥 Assistente</option>
                    </select>
                </div>
                <div class="speaker-actions">
                    <button class="btn btn-small btn-secondary btn-record-clip" 
                            onclick="toggleSpeakerClipRecording(${speaker.id})">
                        ${speaker.audioBlob ? '🔄 Riregistra' : '🎤 Registra (2-10s)'}
                    </button>
                    <button class="btn btn-small btn-secondary" onclick="uploadSpeakerClip(${speaker.id})">
                        📁 Carica
                    </button>
                    <input type="file" id="speakerClipInput-${speaker.id}" accept="audio/*" style="display:none" 
                           onchange="handleSpeakerClipUpload(event, ${speaker.id})">
                    ${speaker.audioBlob ? `
                        <button class="btn btn-small btn-secondary" onclick="playSpeakerClip(${speaker.id})">
                            ▶️
                        </button>
                    ` : ''}
                    <button class="btn btn-small btn-danger" onclick="removeSpeaker(${speaker.id})">
                        🗑
                    </button>
                </div>
                ${speaker.audioBlob ? '<span class="clip-status">✅ Clip salvata</span>' : '<span class="clip-status">⚠️ Clip opzionale</span>'}
            </div>
        `).join('');
    }
    
    // Update add button state
    const addBtn = document.getElementById('btnAddSpeaker');
    if (addBtn) {
        addBtn.disabled = speakers.length >= 4;
    }
}

function uploadSpeakerClip(speakerId) {
    document.getElementById(`speakerClipInput-${speakerId}`).click();
}

async function handleSpeakerClipUpload(event, speakerId) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Check if file is empty
    if (file.size === 0) {
        showToast('Il file audio è vuoto', 'error');
        return;
    }
    
    // Create audio element to check duration
    const audioUrl = URL.createObjectURL(file);
    const audio = new Audio(audioUrl);
    
    audio.onloadedmetadata = async () => {
        URL.revokeObjectURL(audioUrl);
        
        // Check duration (max 11 seconds)
        if (audio.duration > 11) {
            showToast('La clip deve essere massimo 11 secondi (attuale: ' + Math.round(audio.duration) + 's)', 'error');
            return;
        }
        
        if (audio.duration < 0.5) {
            showToast('La clip è troppo corta (minimo 0.5 secondi)', 'error');
            return;
        }
        
        // Save the clip
        const speakers = await getSavedSpeakers();
        const speaker = speakers.find(s => s.id === speakerId);
        if (speaker) {
            speaker.audioBlob = file;
            await saveSpeaker(speaker);
            renderSpeakersSettings();
            showToast('✅ Clip caricata (' + Math.round(audio.duration) + 's)', 'success');
        }
    };
    
    audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        showToast('Formato audio non supportato o file corrotto', 'error');
    };
    
    event.target.value = '';
}
