// ADA v6 - Text-to-Speech with Medical Abbreviation Expansion

let currentAudio = null;
let isSpeaking = false;

// ============================================
// ABBREVIATION EXPANSION
// ============================================

function expandAbbreviations(text) {
    if (!text) return '';
    
    let expanded = text;
    
    // Sort by length descending to match longer patterns first
    const sortedAbbrevs = Object.entries(MEDICAL_ABBREVIATIONS)
        .sort((a, b) => b[0].length - a[0].length);
    
    for (const [abbrev, expansion] of sortedAbbrevs) {
        // Create regex that matches the abbreviation with word boundaries
        // Handle case variations
        const regex = new RegExp(`\\b${escapeRegex(abbrev)}\\b`, 'gi');
        expanded = expanded.replace(regex, expansion);
    }
    
    return expanded;
}

function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Format numbers for clearer TTS pronunciation
function formatNumbersForTTS(text) {
    if (!text) return '';
    
    // Add pauses between digits for phone numbers and codes
    text = text.replace(/(\d{3,})/g, (match) => {
        if (match.length > 6) {
            // Long numbers: add slight pauses
            return match.split('').join(' ');
        }
        return match;
    });
    
    // Format decimal numbers
    text = text.replace(/(\d+)[.,](\d+)/g, '$1 virgola $2');
    
    return text;
}

// ============================================
// TTS CORE
// ============================================

const TTS_MAX_CHARS = 4000; // OpenAI limit is 4096, use 4000 for safety
let ttsQueue = [];
let ttsCurrentIndex = 0;

async function speak(text, lang = 'IT') {
    if (!text || !text.trim()) {
        showToast('Nessun testo da leggere', 'error');
        return;
    }
    
    // Stop any current playback
    stopSpeaking();
    
    // Preprocess text
    let processedText = expandAbbreviations(text);
    processedText = formatNumbersForTTS(processedText);
    
    // Split text into chunks if too long
    const chunks = splitTextIntoChunks(processedText, TTS_MAX_CHARS);
    
    if (chunks.length > 1) {
        showToast(`Testo lungo: ${chunks.length} parti`, 'success');
    }
    
    // Store chunks for sequential playback
    ttsQueue = chunks;
    ttsCurrentIndex = 0;
    
    showProgress(true);
    await playNextChunk(lang);
}

function splitTextIntoChunks(text, maxLength) {
    const chunks = [];
    let remaining = text;
    
    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }
        
        // Find a good break point (end of sentence or paragraph)
        let breakPoint = maxLength;
        
        // Try to break at paragraph
        const paragraphBreak = remaining.lastIndexOf('\n\n', maxLength);
        if (paragraphBreak > maxLength * 0.5) {
            breakPoint = paragraphBreak + 2;
        } else {
            // Try to break at sentence
            const sentenceBreak = Math.max(
                remaining.lastIndexOf('. ', maxLength),
                remaining.lastIndexOf('! ', maxLength),
                remaining.lastIndexOf('? ', maxLength)
            );
            if (sentenceBreak > maxLength * 0.5) {
                breakPoint = sentenceBreak + 2;
            } else {
                // Try to break at comma or space
                const commaBreak = remaining.lastIndexOf(', ', maxLength);
                if (commaBreak > maxLength * 0.5) {
                    breakPoint = commaBreak + 2;
                } else {
                    const spaceBreak = remaining.lastIndexOf(' ', maxLength);
                    if (spaceBreak > 0) {
                        breakPoint = spaceBreak + 1;
                    }
                }
            }
        }
        
        chunks.push(remaining.substring(0, breakPoint).trim());
        remaining = remaining.substring(breakPoint).trim();
    }
    
    return chunks;
}

async function playNextChunk(lang = 'IT') {
    if (ttsCurrentIndex >= ttsQueue.length) {
        // All chunks played
        isSpeaking = false;
        showProgress(false);
        updateSpeakButtons();
        return;
    }
    
    const chunk = ttsQueue[ttsCurrentIndex];
    
    try {
        const t0 = performance.now();
        const voice = voiceMap[lang] || 'nova';
        
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'tts-1',
                voice: voice,
                input: chunk,
                speed: 0.95
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            logError('TTS', `HTTP ${response.status}: ${errorText}`);
            
            if (errorText.includes('insufficient_quota') || errorText.includes('exceeded')) {
                showCreditExhaustedModal();
                throw new Error('Credito API esaurito');
            }
            
            throw new Error(`TTS request failed: ${response.status}`);
        }
        
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        
        currentAudio = new Audio(audioUrl);
        isSpeaking = true;
        
        currentAudio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            currentAudio = null;
            ttsCurrentIndex++;
            
            if (ttsCurrentIndex < ttsQueue.length) {
                // Play next chunk
                playNextChunk(lang);
            } else {
                // All done
                isSpeaking = false;
                showProgress(false);
                updateSpeakButtons();
            }
        };
        
        currentAudio.onerror = () => {
            isSpeaking = false;
            showProgress(false);
            showToast('Errore riproduzione audio', 'error');
            updateSpeakButtons();
        };
        
        // Small delay to avoid cutting the first syllable on some browsers
        setTimeout(() => {
            if (currentAudio) {
                currentAudio.play().catch(() => {});
            }
        }, 150);
        updateSpeakButtons();

        // Track usage (approx. tokens)
        if (typeof trackTtsTokens === 'function') {
            trackTtsTokens(chunk);
        }

        // Show timing only for the first chunk to avoid spam
        if (ttsCurrentIndex === 0) {
            const dt = ((performance.now() - t0) / 1000).toFixed(1);
            showToast(`Audio pronto (${dt}s)`, 'success');
        }
        
    } catch (error) {
        console.error('TTS error:', error);
        logError('TTS', error.message);
        showToast('Errore TTS: ' + error.message, 'error');
        isSpeaking = false;
        showProgress(false);
        updateSpeakButtons();
    }
}

function stopSpeaking() {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
    }
    // Reset TTS queue
    ttsQueue = [];
    ttsCurrentIndex = 0;
    isSpeaking = false;
    showProgress(false);
    updateSpeakButtons();
}

function updateSpeakButtons() {
    // Update all speak buttons to show current state
    document.querySelectorAll('[id^="btnSpeak"]').forEach(btn => {
        if (isSpeaking) {
            btn.innerHTML = btn.innerHTML.replace('🔊', '⏹');
        } else {
            btn.innerHTML = btn.innerHTML.replace('⏹', '🔊');
        }
    });
}

// ============================================
// SPEAK FUNCTIONS FOR DIFFERENT SECTIONS
// ============================================

function speakSOAP() {
    if (isSpeaking) {
        stopSpeaking();
        return;
    }
    
    const soap = {
        s: document.getElementById('soap-s')?.value || '',
        o: document.getElementById('soap-o')?.value || '',
        a: document.getElementById('soap-a')?.value || '',
        p: document.getElementById('soap-p')?.value || ''
    };
    
    let text = 'Referto S O A P.\n\n';
    text += 'Soggettivo: ' + (soap.s || 'Non rilevato') + '\n\n';
    text += 'Oggettivo: ' + (soap.o || 'Non rilevato') + '\n\n';
    text += 'Assessment: ' + (soap.a || 'Non rilevato') + '\n\n';
    text += 'Piano: ' + (soap.p || 'Non rilevato');
    
    const lang = getSelectedLang('soapLangSelector');
    speak(text, lang);
}

function speakOwnerExplanation() {
    if (isSpeaking) {
        stopSpeaking();
        return;
    }
    
    const text = document.getElementById('ownerExplanation')?.value || '';
    const lang = getSelectedLang('ownerLangSelector');
    speak(text, lang);
}

function speakMedications() {
    if (isSpeaking) {
        stopSpeaking();
        return;
    }
    
    if (!medications || medications.length === 0) {
        showToast('Nessun farmaco da leggere', 'error');
        return;
    }
    
    let text = 'Farmaci prescritti:\n\n';
    
    medications.forEach((med, i) => {
        text += `Farmaco ${i + 1}: ${med.name}.\n`;
        if (med.dosage) text += `Dosaggio: ${med.dosage}.\n`;
        if (med.frequency) text += `Frequenza: ${med.frequency}.\n`;
        if (med.duration) text += `Durata: ${med.duration}.\n`;
        if (med.instructions) text += `Istruzioni: ${med.instructions}.\n`;
        text += '\n';
    });
    
    speak(text, 'IT');
}

function speakFAQ() {
    if (isSpeaking) {
        stopSpeaking();
        return;
    }
    
    const faqItems = document.querySelectorAll('#faqList .faq-item');
    if (faqItems.length === 0) {
        showToast('Nessuna FAQ da leggere', 'error');
        return;
    }
    
    let text = 'Domande frequenti:\n\n';
    
    faqItems.forEach((item, i) => {
        const question = item.querySelector('.faq-question')?.textContent || '';
        const answer = item.querySelector('.faq-answer')?.textContent || '';
        text += `Domanda ${i + 1}: ${question}\n`;
        text += `Risposta: ${answer}\n\n`;
    });
    
    const lang = getSelectedLang('ownerLangSelector');
    speak(text, lang);
}

function speakDiary() {
    if (isSpeaking) {
        stopSpeaking();
        return;
    }
    
    const text = document.getElementById('diaryText').value;
    const lang = getSelectedLang('diaryLangSelector');
    speak(text, lang);
}

function speakQnAAnswer() {
    if (isSpeaking) {
        stopSpeaking();
        return;
    }
    
    const text = document.getElementById('qnaAnswer').value;
    speak(text, 'IT');
}

function speakTips() {
    if (isSpeaking) {
        stopSpeaking();
        return;
    }
    
    const tips = document.querySelectorAll('#tipsTricksList .tip-card');
    if (tips.length === 0) {
        showToast('Nessun tip da leggere', 'error');
        return;
    }
    
    let text = 'Consigli per il tuo pet:\n\n';
    
    tips.forEach((tip, i) => {
        const title = tip.querySelector('.tip-card-title')?.textContent || '';
        const content = tip.querySelector('.tip-card-content')?.textContent || '';
        text += `Consiglio ${i + 1}: ${title}.\n${content}\n\n`;
    });
    
    speak(text, 'IT');
}

// Helper to get selected language from a selector
function getSelectedLang(selectorId) {
    const selector = document.getElementById(selectorId);
    if (!selector) return 'IT';
    
    const activeBtn = selector.querySelector('.lang-btn.active');
    return activeBtn?.dataset?.lang || 'IT';
}
