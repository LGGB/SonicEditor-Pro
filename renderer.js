/**
 * SonicEditor - Core Renderer Logic
 * Handles Audio Processing, Waveform Visualization, and UI Interactions
 */

class AudioEditor {
    constructor() {
        this.canvas = document.getElementById('waveform-canvas');
        this.timelineCanvas = document.getElementById('timeline-canvas');
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.originalBuffer = null;
        this.currentBuffer = null;
        this.sourceNode = null;
        this.isPlaying = false;
        this.startTime = 0;
        this.pauseTime = 0;
        this.selection = { start: 0, end: 0, active: false };
        this.undoStack = [];
        this.maxUndo = 10;
        
        // Nodes
        this.masterGain = this.audioCtx.createGain();
        this.bassFilter = this.audioCtx.createBiquadFilter();
        this.trebleFilter = this.audioCtx.createBiquadFilter();
        this.compressor = this.audioCtx.createDynamicsCompressor(); // Maximizer / Loudness
        this.analyser = this.audioCtx.createAnalyser();
        
        this.setupEffects();
        this.initUI();
        this.startMeterAnimation();
    }

    setupEffects() {
        // EQ Config - More "influential" settings
        this.bassFilter.type = 'lowshelf';
        this.bassFilter.frequency.value = 150; // Lower freq for deeper punch
        this.bassFilter.Q.value = 1.5; // Sharper shelf
        
        this.trebleFilter.type = 'highshelf';
        this.trebleFilter.frequency.value = 4000; // Higher freq for more sizzle
        this.trebleFilter.Q.value = 1.5;

        // Compressor Config (Maximizer)
        this.compressor.threshold.value = -10;
        this.compressor.knee.value = 40;
        this.compressor.ratio.value = 12;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.25;

        // Routing: Source -> Bass -> Treble -> Compressor -> Gain -> Analyser -> Dest
        this.bassFilter.connect(this.trebleFilter);
        this.trebleFilter.connect(this.compressor);
        this.compressor.connect(this.masterGain);
        this.masterGain.connect(this.analyser);
        this.analyser.connect(this.audioCtx.destination);
    }

    initUI() {
        // File Import
        const fileInput = document.getElementById('file-input');
        document.getElementById('btn-import').onclick = () => fileInput.click();
        fileInput.onchange = (e) => this.loadFile(e.target.files[0]);

        // Transport
        document.getElementById('btn-go-to-start').onclick = () => this.seekToPosition(0);
        document.getElementById('btn-play-pause').onclick = () => this.togglePlayback();
        document.getElementById('btn-stop').onclick = () => this.stop();
        document.getElementById('btn-reset').onclick = () => this.reset();

        // Selection Tools
        document.getElementById('btn-cut').onclick = () => this.editSelection('cut');
        document.getElementById('btn-trim').onclick = () => this.editSelection('trim');
        document.getElementById('btn-silence').onclick = () => this.editSelection('silence');

        // Global Effects
        document.getElementById('gain-control').oninput = (e) => {
            this.masterGain.gain.value = e.target.value;
        };
        document.getElementById('bass-control').oninput = (e) => {
            this.bassFilter.gain.value = e.target.value;
        };
        document.getElementById('treble-control').oninput = (e) => {
            this.trebleFilter.gain.value = e.target.value;
        };
        document.getElementById('loudness-control').oninput = (e) => {
            // Adjust threshold and makeup gain to increase perceived loudness
            const val = parseFloat(e.target.value);
            this.compressor.threshold.value = -10 - (val * 1.5); // Deepen compression
            this.masterGain.gain.value = 1 + (val / 10); // Makeup gain
        };
        document.getElementById('btn-fade-in').onclick = () => this.applyFade('in');
        document.getElementById('btn-fade-out').onclick = () => this.applyFade('out');
        document.getElementById('btn-noise-reduce').onclick = () => this.applyNoiseReduction();

        document.getElementById('btn-export').onclick = () => this.exportToWav();

        // Waveform Interaction
        this.canvas = document.getElementById('waveform-canvas');
        this.canvas.onmousedown = (e) => this.startSelection(e);
        window.onmousemove = (e) => {
            this.updateSelection(e);
            this.handleScrubbing(e);
        };
        window.onmouseup = () => {
            this.endSelection();
            this.stopScrubbing();
        };
        
        // Ruler Scrubbing
        this.ruler = document.getElementById('timeline-ruler');
        this.ruler.onmousedown = (e) => this.startScrubbing(e);
        
        // Resize Handler
        window.onresize = () => this.drawWaveform();
        
        // Non-Technical Tools
        document.getElementById('btn-undo').onclick = () => this.undo();
        document.getElementById('btn-enhance').onclick = () => this.magicEnhance();
        document.getElementById('btn-strip-silence').onclick = () => this.stripSilence();

        // Keyboard Shortcuts
        window.onkeydown = (e) => this.handleKeys(e);

        this.loadingOverlay = document.getElementById('loading-overlay');
    }

    showLoading() {
        this.loadingOverlay.classList.remove('loading-hidden');
    }

    hideLoading() {
        this.loadingOverlay.classList.add('loading-hidden');
    }

    async loadFile(file) {
        if (!file) return;
        
        // Validación de tamaño razonable para memoria JS
        if (file.size > 200 * 1024 * 1024) { // 200MB límite sugerido
            if (!confirm("El archivo es muy grande y podría ralentizar la aplicación. ¿Deseas continuar?")) return;
        }

        this.showLoading();
        document.getElementById('file-info').innerText = `Cargando: ${file.name}...`;

        // Liberar buffers anteriores para ayudar al recolector de basura (GC)
        this.originalBuffer = null;
        this.currentBuffer = null;
        this.undoStack = [];

        try {
            const reader = new FileReader();
            reader.onload = (e) => {
                const arrayBuffer = e.target.result;
                
                // USAMOS UN CONTEXTO OFFLINE (VIRTUAL) PARA DECODIFICAR
                // Esto evita conflictos con los drivers de sonido de Windows
                const offlineCtx = new OfflineAudioContext(2, 44100, 44100);
                
                offlineCtx.decodeAudioData(arrayBuffer, (buffer) => {
                    this.originalBuffer = buffer;
                    this.currentBuffer = buffer; 
                    this.drawWaveform();
                    this.updateTotalTime();
                    document.getElementById('file-info').innerText = `${file.name} (${Math.round(buffer.duration)}s)`;
                    this.hideLoading();
                }, (err) => {
                    this.hideLoading();
                    alert("Error decodificando audio.");
                    console.error(err);
                });
            };
            reader.readAsArrayBuffer(file);
        } catch (error) {
            this.hideLoading();
            alert("Error al leer el archivo. Puede que esté dañado o bloqueado.");
            console.error(error);
        }
    }

    cloneBuffer(buffer) {
        if (!buffer) return null;
        const newBuffer = this.audioCtx.createBuffer(
            buffer.numberOfChannels,
            buffer.length,
            buffer.sampleRate
        );
        for (let i = 0; i < buffer.numberOfChannels; i++) {
            newBuffer.copyToChannel(buffer.getChannelData(i), i);
        }
        return newBuffer;
    }

    pushToUndo() {
        if (this.currentBuffer) {
            this.undoStack.push(this.cloneBuffer(this.currentBuffer));
            if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
        }
    }

    undo() {
        if (this.undoStack.length === 0) return;
        this.currentBuffer = this.undoStack.pop();
        this.drawWaveform();
        this.updateTotalTime();
        this.stop();
    }

    drawWaveform() {
        if (!this.currentBuffer) return;
        
        // Draw Waveform
        const ctx = this.canvas.getContext('2d');
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        this.canvas.width = width;
        this.canvas.height = height;

        ctx.clearRect(0, 0, width, height);
        
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, '#00f2ff');
        gradient.addColorStop(0.5, '#7000ff');
        gradient.addColorStop(1, '#00f2ff');

        ctx.fillStyle = gradient;
        
        const data = this.currentBuffer.getChannelData(0);
        const step = Math.ceil(data.length / width);
        const amp = height / 2;

        // OPTIMIZACIÓN: No analizar cada una de las millones de muestras si el paso es muy grande
        const samplesPerPixel = Math.min(step, 1000); 
        const subStep = Math.max(1, Math.floor(step / samplesPerPixel));

        for (let i = 0; i < width; i++) {
            let min = 1.0;
            let max = -1.0;
            const start = i * step;
            
            for (let j = 0; j < step; j += subStep) {
                const index = start + j;
                if (index >= data.length) break;
                const datum = data[index];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }
            const barHeight = Math.max(2, (max - min) * amp);
            const y = (height - barHeight) / 2;
            ctx.fillRect(i, y, 1, barHeight);
        }

        this.drawTimeline();
    }

    drawTimeline() {
        const ctx = this.timelineCanvas.getContext('2d');
        const width = this.timelineCanvas.clientWidth;
        const height = this.timelineCanvas.clientHeight;
        this.timelineCanvas.width = width;
        this.timelineCanvas.height = height;

        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '10px Arial';

        const duration = this.currentBuffer.duration;
        const pixelsPerSecond = width / duration;
        const step = duration > 120 ? 30 : 10; // Adjust density

        for (let i = 0; i < duration; i += step) {
            const x = i * pixelsPerSecond;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, 10);
            ctx.stroke();
            if (i % (step * 2) === 0) {
                ctx.fillText(this.formatTime(i).substring(3), x + 2, 20);
            }
        }
    }

    togglePlayback() {
        if (!this.currentBuffer) return;
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    play() {
        if (this.sourceNode) this.sourceNode.stop();
        
        this.sourceNode = this.audioCtx.createBufferSource();
        this.sourceNode.buffer = this.currentBuffer;
        this.sourceNode.connect(this.bassFilter);
        
        const offset = this.pauseTime % this.currentBuffer.duration;
        this.sourceNode.start(0, offset);
        this.startTime = this.audioCtx.currentTime - offset;
        this.isPlaying = true;
        document.getElementById('btn-play-pause').innerText = '⏸';
        
        this.updatePlayhead();
    }

    pause() {
        if (!this.isPlaying) return;
        this.sourceNode.stop();
        this.pauseTime = this.audioCtx.currentTime - this.startTime;
        this.isPlaying = false;
        document.getElementById('btn-play-pause').innerText = '▶';
    }

    stop() {
        if (this.sourceNode) this.sourceNode.stop();
        this.isPlaying = false;
        this.pauseTime = 0;
        document.getElementById('btn-play-pause').innerText = '▶';
        this.updatePlayhead();
    }

    updatePlayhead() {
        if (!this.isPlaying) return;
        
        const currentTime = this.audioCtx.currentTime - this.startTime;
        const progress = (currentTime % this.currentBuffer.duration) / this.currentBuffer.duration;
        const playhead = document.getElementById('playhead');
        playhead.style.left = `${progress * 100}%`;
        
        document.getElementById('current-time').innerText = this.formatTime(currentTime);
        
        if (this.isPlaying) requestAnimationFrame(() => this.updatePlayhead());
    }

    formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    updateTotalTime() {
        document.getElementById('total-time').innerText = this.formatTime(this.currentBuffer.duration);
    }

    // Selection Logic
    startSelection(e) {
        if (!this.currentBuffer) return;
        this.isSelecting = true;
        this.selectionDragDetected = false;
        const rect = this.canvas.getBoundingClientRect();
        this.selectionStartPx = e.clientX - rect.left;
        this.showSelection(this.selectionStartPx, this.selectionStartPx);
    }

    updateSelection(e) {
        if (!this.isSelecting) return;
        const rect = this.canvas.getBoundingClientRect();
        const currentX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        
        if (Math.abs(currentX - this.selectionStartPx) > 5) {
            this.selectionDragDetected = true;
        }
        this.showSelection(this.selectionStartPx, currentX);
    }

    endSelection() {
        if (!this.isSelecting) return;
        this.isSelecting = false;
        if (!this.selectionDragDetected) {
            this.seekToPosition(this.selection.start);
            this.clearSelection();
        }
    }

    // Ruler Scrubbing
    startScrubbing(e) {
        this.isScrubbing = true;
        this.handleScrubbing(e);
    }

    handleScrubbing(e) {
        if (!this.isScrubbing || !this.currentBuffer) return;
        const rect = this.ruler.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const time = (x / rect.width) * this.currentBuffer.duration;
        this.seekToPosition(time);
    }

    stopScrubbing() {
        this.isScrubbing = false;
    }

    seekToPosition(time) {
        if (!this.currentBuffer) return;
        this.pauseTime = Math.max(0, Math.min(time, this.currentBuffer.duration));
        
        // Immediate visual update of playhead
        const progress = this.pauseTime / this.currentBuffer.duration;
        const playhead = document.getElementById('playhead');
        playhead.style.left = `${progress * 100}%`;
        document.getElementById('current-time').innerText = this.formatTime(this.pauseTime);
        
        if (this.isPlaying) {
            this.play(); // Restart source from new offset immediately
        }
    }

    showSelection(start, end) {
        const overlay = document.getElementById('selection-overlay');
        const x1 = Math.min(start, end);
        const x2 = Math.max(start, end);
        overlay.style.display = 'block';
        overlay.style.left = `${x1}px`;
        overlay.style.width = `${x2 - x1}px`;
        
        // Convert PX to Time
        const rect = this.canvas.getBoundingClientRect();
        this.selection.start = (x1 / rect.width) * this.currentBuffer.duration;
        this.selection.end = (x2 / rect.width) * this.currentBuffer.duration;
        this.selection.active = (x2 - x1) > 2;
    }

    // Editing Operations
    editSelection(type) {
        if (!this.currentBuffer || !this.selection.active) return;
        
        // Clonar antes de la primera edición para proteger el original
        if (this.currentBuffer === this.originalBuffer) {
            this.currentBuffer = this.cloneBuffer(this.originalBuffer);
        }

        this.pushToUndo();
        this.showLoading();

        setTimeout(() => {
            const startSample = Math.floor(this.selection.start * this.currentBuffer.sampleRate);
            const endSample = Math.floor(this.selection.end * this.currentBuffer.sampleRate);
            const durationSamples = endSample - startSample;

            let newBuffer;

            if (type === 'cut') {
                newBuffer = this.audioCtx.createBuffer(
                    this.currentBuffer.numberOfChannels,
                    this.currentBuffer.length - durationSamples,
                    this.currentBuffer.sampleRate
                );
                for (let ch = 0; ch < this.currentBuffer.numberOfChannels; ch++) {
                    const oldData = this.currentBuffer.getChannelData(ch);
                    const newData = newBuffer.getChannelData(ch);
                    newData.set(oldData.subarray(0, startSample));
                    newData.set(oldData.subarray(endSample), startSample);
                }
            } else if (type === 'trim') {
                newBuffer = this.audioCtx.createBuffer(
                    this.currentBuffer.numberOfChannels,
                    durationSamples,
                    this.currentBuffer.sampleRate
                );
                for (let ch = 0; ch < this.currentBuffer.numberOfChannels; ch++) {
                    newBuffer.copyToChannel(this.currentBuffer.getChannelData(ch).subarray(startSample, endSample), ch);
                }
            } else if (type === 'silence') {
                newBuffer = this.cloneBuffer(this.currentBuffer);
                for (let ch = 0; ch < newBuffer.numberOfChannels; ch++) {
                    const data = newBuffer.getChannelData(ch);
                    for (let i = startSample; i < endSample; i++) data[i] = 0;
                }
            }

            this.currentBuffer = newBuffer;
            this.drawWaveform();
            this.updateTotalTime();
            this.clearSelection();
            this.hideLoading();
        }, 50);
    }

    clearSelection() {
        this.selection.active = false;
        document.getElementById('selection-overlay').style.display = 'none';
    }

    reset() {
        if (!this.originalBuffer) return;
        this.currentBuffer = this.cloneBuffer(this.originalBuffer);
        this.drawWaveform();
        this.updateTotalTime();
        this.stop();
    }

    applyFade(type) {
        if (!this.currentBuffer) return;
        this.pushToUndo();
        const fadeTime = parseFloat(document.getElementById(`fade-${type}-time`).value);
        const fadeSamples = Math.floor(fadeTime * this.currentBuffer.sampleRate);
        
        const newBuffer = this.cloneBuffer(this.currentBuffer);
        for (let ch = 0; ch < newBuffer.numberOfChannels; ch++) {
            const data = newBuffer.getChannelData(ch);
            if (type === 'in') {
                for (let i = 0; i < fadeSamples; i++) {
                    data[i] *= (i / fadeSamples);
                }
            } else {
                const len = data.length;
                for (let i = 0; i < fadeSamples; i++) {
                    data[len - i - 1] *= (i / fadeSamples);
                }
            }
        }
        this.currentBuffer = newBuffer;
        this.drawWaveform();

        // COMODIDAD: Saltar al punto del fade para verificar
        if (type === 'in') {
            this.seekToPosition(0);
        } else {
            this.seekToPosition(this.currentBuffer.duration - (fadeTime + 2));
        }
    }

    applyNoiseReduction() {
        if (!this.currentBuffer) return;
        this.pushToUndo();
        this.showLoading();

        setTimeout(() => {
            const intensity = document.getElementById('noise-reduction-intensity').value / 100;
            const newBuffer = this.cloneBuffer(this.currentBuffer);
            const threshold = 0.01 * intensity; 
            
            for (let ch = 0; ch < newBuffer.numberOfChannels; ch++) {
                const data = newBuffer.getChannelData(ch);
                for (let i = 0; i < data.length; i++) {
                    if (Math.abs(data[i]) < threshold) {
                        data[i] *= (1 - intensity); 
                    }
                }
            }
            this.currentBuffer = newBuffer;
            this.drawWaveform();
            this.hideLoading();
            alert("Reducción de ruido aplicada localmente.");
        }, 50);
    }

    startMeterAnimation() {
        const update = () => {
            const mL = document.getElementById('meter-l');
            const mR = document.getElementById('meter-r');
            
            if (this.isPlaying) {
                const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
                this.analyser.getByteFrequencyData(dataArray);
                const average = dataArray.reduce((p, c) => p + c, 0) / dataArray.length;
                const value = Math.min(100, (average / 128) * 100);
                
                mL.style.width = `${value}%`;
                mR.style.width = `${value * 0.9}%`;
                
                // Add Premium Glow
                if (value > 5) {
                    mL.style.boxShadow = `0 0 15px var(--accent-glow)`;
                    mR.style.boxShadow = `0 0 15px var(--accent-glow)`;
                } else {
                    mL.style.boxShadow = mR.style.boxShadow = 'none';
                }
            } else {
                mL.style.width = '0%';
                mR.style.width = '0%';
                mL.style.boxShadow = mR.style.boxShadow = 'none';
            }
            requestAnimationFrame(update);
        };
        update();
    }

    exportToWav() {
        if (!this.currentBuffer) return;
        this.showLoading();

        setTimeout(() => {
            const buffer = this.currentBuffer;
            const length = buffer.length * buffer.numberOfChannels * 2 + 44;
            const bufferView = new ArrayBuffer(length);
            const view = new DataView(bufferView);
            
            const writeString = (offset, string) => {
                for (let i = 0; i < string.length; i++) {
                    view.setUint8(offset + i, string.charCodeAt(i));
                }
            };

            /* RIFF identifier */
            writeString(0, 'RIFF');
            /* file length */
            view.setUint32(4, 32 + buffer.length * buffer.numberOfChannels * 2, true);
            /* RIFF type */
            writeString(8, 'WAVE');
            /* format chunk identifier */
            writeString(12, 'fmt ');
            /* format chunk length */
            view.setUint32(16, 16, true);
            /* sample format (raw) */
            view.setUint16(20, 1, true);
            /* channel count */
            view.setUint16(22, buffer.numberOfChannels, true);
            /* sample rate */
            view.setUint32(24, buffer.sampleRate, true);
            /* byte rate (sample rate * block align) */
            view.setUint32(28, buffer.sampleRate * buffer.numberOfChannels * 2, true);
            /* block align (channel count * bytes per sample) */
            view.setUint16(32, buffer.numberOfChannels * 2, true);
            /* bits per sample */
            view.setUint16(34, 16, true);
            /* data chunk identifier */
            writeString(36, 'data');
            /* data chunk length */
            view.setUint32(40, buffer.length * buffer.numberOfChannels * 2, true);

            // Write PCM samples
            let offset = 44;
            for (let i = 0; i < buffer.length; i++) {
                for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
                    const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
                    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
                    offset += 2;
                }
            }

            const blob = new Blob([bufferView], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `editado_${new Date().getTime()}.wav`;
            link.click();
            
            this.hideLoading();
            alert("Archivo exportado correctamente a tu carpeta local de Descargas.");
        }, 100);
    }

    handleKeys(e) {
        if (e.code === 'Space') {
            e.preventDefault();
            this.togglePlayback();
        } else if (e.code === 'Delete' || e.code === 'Backspace') {
            if (this.selection.active) this.editSelection('cut');
        } else if (e.ctrlKey && e.code === 'KeyZ') {
            this.undo();
        } else if (e.code === 'KeyZ' && !e.ctrlKey) {
            this.undo(); // Simple Z works too
        }
    }

    magicEnhance() {
        // Preset for voice clarity: Boost bass slightly, boost treble for clarity, and maximize loudness
        document.getElementById('bass-control').value = 6;
        document.getElementById('treble-control').value = 10;
        document.getElementById('loudness-control').value = 8;
        
        // Trigger inputs
        document.getElementById('bass-control').dispatchEvent(new Event('input'));
        document.getElementById('treble-control').dispatchEvent(new Event('input'));
        document.getElementById('loudness-control').dispatchEvent(new Event('input'));
        
        alert("¡Voz mejorada! Se han ajustado los controles automáticamente.");
    }

    stripSilence() {
        if (!this.currentBuffer) return;
        this.pushToUndo();
        this.showLoading();
        
        setTimeout(() => {
            const buffer = this.currentBuffer;
            const threshold = 0.005;
            const data = buffer.getChannelData(0);
            
            let start = 0;
            while (start < data.length && Math.abs(data[start]) < threshold) start++;
            
            let end = data.length - 1;
            while (end > start && Math.abs(data[end]) < threshold) end--;
            
            const newLen = end - start + 1;
            const newBuffer = this.audioCtx.createBuffer(buffer.numberOfChannels, newLen, buffer.sampleRate);
            
            for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
                newBuffer.copyToChannel(buffer.getChannelData(ch).subarray(start, end + 1), ch);
            }
            
            this.currentBuffer = newBuffer;
            this.drawWaveform();
            this.updateTotalTime();
            this.hideLoading();
            alert("Silencios eliminados.");
        }, 100);
    }
}

// Initialize Application
window.addEventListener('DOMContentLoaded', () => {
    window.app = new AudioEditor();
});
