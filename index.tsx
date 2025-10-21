/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */

import {GoogleGenAI} from '@google/genai';
import {marked} from 'marked';

const MODEL_NAME = 'gemini-2.5-flash';

interface Note {
  id: string;
  title: string;
  rawTranscription: string;
  polishedNote: string;
  timestamp: number;
}

class VoiceNotesApp {
  private genAI: any;
  private mediaRecorder: MediaRecorder | null = null;
  private recordButton: HTMLButtonElement;
  private recordingStatus: HTMLDivElement;
  private rawTranscription: HTMLDivElement;
  private polishedNote: HTMLDivElement;
  private newButton: HTMLButtonElement;
  private uploadButton: HTMLButtonElement;
  private audioUploadInput: HTMLInputElement;
  private themeToggleButton: HTMLButtonElement;
  private themeToggleIcon: HTMLElement;
  private audioChunks: Blob[] = [];
  private isRecording = false;
  private currentNote: Note | null = null;
  private stream: MediaStream | null = null;
  private editorTitle: HTMLDivElement;

  private recordingInterface: HTMLDivElement;
  private liveRecordingTitle: HTMLDivElement;
  private liveWaveformCanvas: HTMLCanvasElement | null;
  private liveWaveformCtx: CanvasRenderingContext2D | null = null;
  private liveRecordingTimerDisplay: HTMLDivElement;
  private statusIndicatorDiv: HTMLDivElement | null;

  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private waveformDataArray: Uint8Array | null = null;
  private waveformDrawingId: number | null = null;
  private timerIntervalId: number | null = null;
  private recordingStartTime: number = 0;

  // Sidebar and notes management
  private notes: Note[] = [];
  private sidebar: HTMLElement;
  private notesList: HTMLUListElement;
  private clearAllButton: HTMLButtonElement;
  private sidebarToggleButton: HTMLButtonElement;
  private sidebarOverlay: HTMLDivElement;

  constructor() {
    this.genAI = new GoogleGenAI({
      apiKey: process.env.API_KEY,
    });

    this.recordButton = document.getElementById(
      'recordButton',
    ) as HTMLButtonElement;
    this.recordingStatus = document.getElementById(
      'recordingStatus',
    ) as HTMLDivElement;
    this.rawTranscription = document.getElementById(
      'rawTranscription',
    ) as HTMLDivElement;
    this.polishedNote = document.getElementById(
      'polishedNote',
    ) as HTMLDivElement;
    this.newButton = document.getElementById('newButton') as HTMLButtonElement;
    this.uploadButton = document.getElementById(
      'uploadButton',
    ) as HTMLButtonElement;
    this.audioUploadInput = document.getElementById(
      'audioUpload',
    ) as HTMLInputElement;
    this.themeToggleButton = document.getElementById(
      'themeToggleButton',
    ) as HTMLButtonElement;
    this.themeToggleIcon = this.themeToggleButton.querySelector(
      'i',
    ) as HTMLElement;
    this.editorTitle = document.querySelector(
      '.editor-title',
    ) as HTMLDivElement;

    this.recordingInterface = document.querySelector(
      '.recording-interface',
    ) as HTMLDivElement;
    this.liveRecordingTitle = document.getElementById(
      'liveRecordingTitle',
    ) as HTMLDivElement;
    this.liveWaveformCanvas = document.getElementById(
      'liveWaveformCanvas',
    ) as HTMLCanvasElement;
    this.liveRecordingTimerDisplay = document.getElementById(
      'liveRecordingTimerDisplay',
    ) as HTMLDivElement;

    // Sidebar elements
    this.sidebar = document.getElementById('sidebar') as HTMLElement;
    this.notesList = document.getElementById('notesList') as HTMLUListElement;
    this.clearAllButton = document.getElementById(
      'clearAllButton',
    ) as HTMLButtonElement;
    this.sidebarToggleButton = document.getElementById(
      'sidebarToggleButton',
    ) as HTMLButtonElement;
    this.sidebarOverlay = document.getElementById(
      'sidebar-overlay',
    ) as HTMLDivElement;

    if (this.liveWaveformCanvas) {
      this.liveWaveformCtx = this.liveWaveformCanvas.getContext('2d');
    }
    this.statusIndicatorDiv = this.recordingInterface.querySelector(
      '.status-indicator',
    ) as HTMLDivElement;

    this.bindEventListeners();
    this.initTheme();
    this.loadNotesFromLocalStorage();
    this.renderSidebar();
    this.createNewNote();

    this.recordingStatus.textContent = 'Ready to record';
  }

  private bindEventListeners(): void {
    this.recordButton.addEventListener('click', () => this.toggleRecording());
    this.newButton.addEventListener('click', () => this.createNewNote());
    this.uploadButton.addEventListener('click', () =>
      this.audioUploadInput.click(),
    );
    this.audioUploadInput.addEventListener('change', (e) =>
      this.handleFileUpload(e),
    );
    this.themeToggleButton.addEventListener('click', () => this.toggleTheme());
    window.addEventListener('resize', this.handleResize.bind(this));
    this.clearAllButton.addEventListener('click', () => this.clearAllNotes());
    this.sidebarToggleButton.addEventListener('click', () =>
      this.toggleSidebar(),
    );
    this.sidebarOverlay.addEventListener('click', () => this.toggleSidebar());
  }

  private toggleSidebar(): void {
    document.body.classList.toggle('sidebar-open');
  }

  private async handleFileUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }

    const file = input.files[0];
    const maxSizeInMB = 50;
    if (file.size > maxSizeInMB * 1024 * 1024) {
      this.recordingStatus.textContent = `File is too large (max ${maxSizeInMB}MB).`;
      input.value = '';
      return;
    }

    this.createNewNote();
    this.recordingStatus.textContent = `Processing "${file.name}"...`;

    try {
      await this.processAudio(file);
    } catch (error) {
      console.error('Error processing uploaded file:', error);
      this.recordingStatus.textContent = 'Error processing uploaded file.';
    } finally {
      input.value = '';
    }
  }

  private handleResize(): void {
    if (
      this.isRecording &&
      this.liveWaveformCanvas &&
      this.liveWaveformCanvas.style.display === 'block'
    ) {
      requestAnimationFrame(() => {
        this.setupCanvasDimensions();
      });
    }
  }

  private setupCanvasDimensions(): void {
    if (!this.liveWaveformCanvas || !this.liveWaveformCtx) return;
    const canvas = this.liveWaveformCanvas;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    this.liveWaveformCtx.scale(dpr, dpr);
  }

  private initTheme(): void {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      document.body.classList.add('light-mode');
      this.themeToggleIcon.classList.replace('fa-sun', 'fa-moon');
    } else {
      document.body.classList.remove('light-mode');
      this.themeToggleIcon.classList.replace('fa-moon', 'fa-sun');
    }
  }

  private toggleTheme(): void {
    document.body.classList.toggle('light-mode');
    if (document.body.classList.contains('light-mode')) {
      localStorage.setItem('theme', 'light');
      this.themeToggleIcon.classList.replace('fa-sun', 'fa-moon');
    } else {
      localStorage.setItem('theme', 'dark');
      this.themeToggleIcon.classList.replace('fa-moon', 'fa-sun');
    }
  }

  private async toggleRecording(): Promise<void> {
    if (!this.isRecording) {
      await this.startRecording();
    } else {
      await this.stopRecording();
    }
  }

  private setupAudioVisualizer(): void {
    if (!this.stream || this.audioContext) return;

    this.audioContext = new (window.AudioContext ||
      (window as any).webkitAudioContext)();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.75;
    this.waveformDataArray = new Uint8Array(
      this.analyserNode.frequencyBinCount,
    );
    source.connect(this.analyserNode);
  }

  private drawLiveWaveform(): void {
    if (
      !this.analyserNode ||
      !this.waveformDataArray ||
      !this.liveWaveformCtx ||
      !this.liveWaveformCanvas ||
      !this.isRecording
    ) {
      if (this.waveformDrawingId) cancelAnimationFrame(this.waveformDrawingId);
      this.waveformDrawingId = null;
      return;
    }

    this.waveformDrawingId = requestAnimationFrame(() =>
      this.drawLiveWaveform(),
    );
    this.analyserNode.getByteFrequencyData(this.waveformDataArray);

    const ctx = this.liveWaveformCtx;
    const canvas = this.liveWaveformCanvas;
    const logicalWidth = canvas.clientWidth;
    const logicalHeight = canvas.clientHeight;
    ctx.clearRect(0, 0, logicalWidth, logicalHeight);
    const bufferLength = this.analyserNode.frequencyBinCount;
    const numBars = Math.floor(bufferLength * 0.5);
    if (numBars === 0) return;
    const totalBarPlusSpacingWidth = logicalWidth / numBars;
    const barWidth = Math.max(1, Math.floor(totalBarPlusSpacingWidth * 0.7));
    const barSpacing = Math.max(0, Math.floor(totalBarPlusSpacingWidth * 0.3));
    let x = 0;
    const recordingColor =
      getComputedStyle(document.documentElement)
        .getPropertyValue('--color-recording')
        .trim() || '#ff3b30';
    ctx.fillStyle = recordingColor;

    for (let i = 0; i < numBars; i++) {
      if (x >= logicalWidth) break;
      const dataIndex = Math.floor(i * (bufferLength / numBars));
      const barHeightNormalized = this.waveformDataArray[dataIndex] / 255.0;
      let barHeight = barHeightNormalized * logicalHeight;
      if (barHeight < 1 && barHeight > 0) barHeight = 1;
      barHeight = Math.round(barHeight);
      const y = Math.round((logicalHeight - barHeight) / 2);
      ctx.fillRect(Math.floor(x), y, barWidth, barHeight);
      x += barWidth + barSpacing;
    }
  }

  private updateLiveTimer(): void {
    if (!this.isRecording || !this.liveRecordingTimerDisplay) return;
    const elapsedMs = Date.now() - this.recordingStartTime;
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const hundredths = Math.floor((elapsedMs % 1000) / 10);
    this.liveRecordingTimerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
  }

  private startLiveDisplay(): void {
    if (
      !this.recordingInterface ||
      !this.liveRecordingTitle ||
      !this.liveWaveformCanvas ||
      !this.liveRecordingTimerDisplay
    )
      return;
    this.recordingInterface.classList.add('is-live');
    this.setupCanvasDimensions();
    if (this.statusIndicatorDiv) this.statusIndicatorDiv.style.display = 'none';
    const iconElement = this.recordButton.querySelector(
      '.record-button-inner i',
    ) as HTMLElement;
    iconElement?.classList.replace('fa-microphone', 'fa-stop');
    const currentTitle = this.editorTitle.textContent?.trim();
    const placeholder =
      this.editorTitle.getAttribute('placeholder') || 'Untitled Note';
    this.liveRecordingTitle.textContent =
      currentTitle && currentTitle !== placeholder
        ? currentTitle
        : 'New Recording';
    this.setupAudioVisualizer();
    this.drawLiveWaveform();
    this.recordingStartTime = Date.now();
    this.updateLiveTimer();
    if (this.timerIntervalId) clearInterval(this.timerIntervalId);
    this.timerIntervalId = window.setInterval(() => this.updateLiveTimer(), 50);
  }

  private stopLiveDisplay(): void {
    this.recordingInterface.classList.remove('is-live');
    if (this.statusIndicatorDiv)
      this.statusIndicatorDiv.style.display = 'block';
    const iconElement = this.recordButton.querySelector(
      '.record-button-inner i',
    ) as HTMLElement;
    iconElement?.classList.replace('fa-stop', 'fa-microphone');
    if (this.waveformDrawingId) cancelAnimationFrame(this.waveformDrawingId);
    this.waveformDrawingId = null;
    if (this.timerIntervalId) clearInterval(this.timerIntervalId);
    this.timerIntervalId = null;
    if (this.liveWaveformCtx && this.liveWaveformCanvas)
      this.liveWaveformCtx.clearRect(
        0,
        0,
        this.liveWaveformCanvas.width,
        this.liveWaveformCanvas.height,
      );
    if (this.audioContext && this.audioContext.state !== 'closed')
      this.audioContext.close().catch(console.warn);
    this.audioContext = null;
    this.analyserNode = null;
    this.waveformDataArray = null;
  }

  private async startRecording(): Promise<void> {
    try {
      this.audioChunks = [];
      if (this.stream) this.stream.getTracks().forEach((track) => track.stop());
      if (this.audioContext && this.audioContext.state !== 'closed')
        await this.audioContext.close();
      this.audioContext = null;
      this.recordingStatus.textContent = 'Requesting microphone access...';
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({audio: true});
      } catch (err) {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      }
      try {
        this.mediaRecorder = new MediaRecorder(this.stream, {
          mimeType: 'audio/webm',
        });
      } catch (e) {
        this.mediaRecorder = new MediaRecorder(this.stream);
      }
      this.mediaRecorder.ondataavailable = (event) =>
        event.data.size > 0 && this.audioChunks.push(event.data);
      this.mediaRecorder.onstop = () => {
        this.stopLiveDisplay();
        if (this.audioChunks.length > 0) {
          const audioBlob = new Blob(this.audioChunks, {
            type: this.mediaRecorder?.mimeType || 'audio/webm',
          });
          this.processAudio(audioBlob).catch(console.error);
        } else
          this.recordingStatus.textContent =
            'No audio data captured. Please try again.';
        this.stream?.getTracks().forEach((track) => track.stop());
        this.stream = null;
      };
      this.mediaRecorder.start();
      this.isRecording = true;
      this.recordButton.classList.add('recording');
      this.recordButton.setAttribute('title', 'Stop Recording');
      this.startLiveDisplay();
    } catch (error) {
      console.error('Error starting recording:', error);
      const errorName = error instanceof Error ? error.name : 'Unknown';
      if (
        errorName === 'NotAllowedError' ||
        errorName === 'PermissionDeniedError'
      )
        this.recordingStatus.textContent =
          'Microphone permission denied. Please check browser settings.';
      else
        this.recordingStatus.textContent =
          'Error accessing microphone. Please check connection.';
      this.isRecording = false;
      this.stream?.getTracks().forEach((track) => track.stop());
      this.stream = null;
      this.recordButton.classList.remove('recording');
      this.recordButton.setAttribute('title', 'Start Recording');
      this.stopLiveDisplay();
    }
  }

  private async stopRecording(): Promise<void> {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      this.recordButton.classList.remove('recording');
      this.recordButton.setAttribute('title', 'Start Recording');
      this.recordingStatus.textContent = 'Processing audio...';
    } else {
      if (!this.isRecording) this.stopLiveDisplay();
    }
  }

  private async processAudio(audioBlob: Blob): Promise<void> {
    if (audioBlob.size === 0) {
      this.recordingStatus.textContent =
        'No audio data captured. Please try again.';
      return;
    }
    try {
      this.recordingStatus.textContent = 'Converting audio...';
      const reader = new FileReader();
      const readResult = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const base64data = reader.result as string;
          resolve(base64data.split(',')[1]);
        };
        reader.onerror = () => reject(reader.error);
      });
      reader.readAsDataURL(audioBlob);
      const base64Audio = await readResult;
      const mimeType = audioBlob.type;
      if (!base64Audio || !mimeType) throw new Error('Audio conversion failed');
      await this.getTranscription(base64Audio, mimeType);
    } catch (error) {
      console.error('Error in processAudio:', error);
      this.recordingStatus.textContent =
        'Error processing recording. Please try again.';
    }
  }

  private async getTranscription(
    base64Audio: string,
    mimeType: string,
  ): Promise<void> {
    try {
      this.recordingStatus.textContent = 'Getting transcription...';
      const contents = [
        {text: 'Generate a complete, detailed transcript of this audio.'},
        {inlineData: {mimeType: mimeType, data: base64Audio}},
      ];
      const response = await this.genAI.models.generateContent({
        model: MODEL_NAME,
        contents: contents,
      });
      const transcriptionText = response.text;
      if (transcriptionText) {
        this.rawTranscription.textContent = transcriptionText;
        this.rawTranscription.classList.remove('placeholder-active');
        if (this.currentNote)
          this.currentNote.rawTranscription = transcriptionText;
        this.recordingStatus.textContent =
          'Transcription complete. Polishing note...';
        await this.getPolishedNote();
      } else {
        this.recordingStatus.textContent =
          'Transcription failed or returned empty.';
      }
    } catch (error) {
      console.error('Error getting transcription:', error);
      this.recordingStatus.textContent =
        'Error getting transcription. Please try again.';
    }
  }

  private async getPolishedNote(): Promise<void> {
    try {
      if (
        !this.rawTranscription.textContent ||
        this.rawTranscription.textContent.trim() === ''
      ) {
        this.recordingStatus.textContent = 'No transcription to polish';
        return;
      }
      this.recordingStatus.textContent = 'Polishing note...';
      const prompt = `Take this raw transcription and create a polished, well-formatted note. Remove filler words, repetitions, and false starts. Format lists and use markdown for headings. Maintain original content and meaning. Raw transcription: ${this.rawTranscription.textContent}`;
      const contents = [{text: prompt}];
      const response = await this.genAI.models.generateContent({
        model: MODEL_NAME,
        contents: contents,
      });
      const polishedText = response.text;
      if (polishedText) {
        this.polishedNote.innerHTML = marked.parse(polishedText);
        this.polishedNote.classList.remove('placeholder-active');

        let noteTitleSet = false;
        const lines = polishedText.split('\n').map((l) => l.trim());
        for (const line of lines) {
          if (line.startsWith('#')) {
            const title = line.replace(/^#+\s+/, '').trim();
            if (this.editorTitle && title) {
              this.editorTitle.textContent = title;
              this.editorTitle.classList.remove('placeholder-active');
              noteTitleSet = true;
              break;
            }
          }
        }
        if (!noteTitleSet && this.editorTitle) {
          for (const line of lines) {
            if (line.length > 0) {
              let potentialTitle = line.replace(
                /^[\*_\`#\->\s\[\]\(.\d)]+/,
                '',
              );
              potentialTitle = potentialTitle.trim();
              if (potentialTitle.length > 3) {
                const maxLength = 60;
                this.editorTitle.textContent =
                  potentialTitle.substring(0, maxLength) +
                  (potentialTitle.length > maxLength ? '...' : '');
                this.editorTitle.classList.remove('placeholder-active');
                break;
              }
            }
          }
        }
        if (this.currentNote) this.currentNote.polishedNote = polishedText;
        this.saveOrUpdateCurrentNote();
        this.recordingStatus.textContent =
          'Note polished. Ready for next recording.';
      } else {
        this.recordingStatus.textContent =
          'Polishing failed or returned empty.';
      }
    } catch (error) {
      console.error('Error polishing note:', error);
      this.recordingStatus.textContent =
        'Error polishing note. Please try again.';
    }
  }

  private createNewNote(): void {
    this.currentNote = {
      id: `note_${Date.now()}`,
      title: '',
      rawTranscription: '',
      polishedNote: '',
      timestamp: Date.now(),
    };
    this.displayNote(this.currentNote);
    this.recordingStatus.textContent = 'Ready to record';
    if (this.isRecording) {
      this.mediaRecorder?.stop();
      this.isRecording = false;
      this.recordButton.classList.remove('recording');
    } else {
      this.stopLiveDisplay();
    }
    this.renderSidebar();
  }

  private saveOrUpdateCurrentNote(): void {
    if (!this.currentNote) return;
    this.currentNote.title =
      this.editorTitle.textContent?.trim() || 'Untitled Note';
    const hasContent =
      this.currentNote.rawTranscription.trim() ||
      this.currentNote.polishedNote.trim();
    if (!hasContent) return;

    const noteIndex = this.notes.findIndex((n) => n.id === this.currentNote!.id);
    if (noteIndex > -1) {
      this.notes[noteIndex] = this.currentNote;
    } else {
      this.notes.unshift(this.currentNote);
    }
    this.saveNotesToLocalStorage();
    this.renderSidebar();
  }

  private saveNotesToLocalStorage(): void {
    localStorage.setItem('voiceNotes', JSON.stringify(this.notes));
  }

  private loadNotesFromLocalStorage(): void {
    const savedNotes = localStorage.getItem('voiceNotes');
    if (savedNotes) {
      this.notes = JSON.parse(savedNotes);
    }
  }

  private renderSidebar(): void {
    this.notesList.innerHTML = '';
    this.notes.forEach((note) => {
      const li = document.createElement('li');
      li.className = 'note-item';
      li.dataset.noteId = note.id;
      if (this.currentNote && note.id === this.currentNote.id) {
        li.classList.add('active');
      }

      const titleDiv = document.createElement('div');
      titleDiv.className = 'note-item-title';
      titleDiv.textContent = note.title;

      const snippetDiv = document.createElement('div');
      snippetDiv.className = 'note-item-snippet';
      snippetDiv.textContent =
        note.rawTranscription.substring(0, 50) + '...';

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'note-item-actions';
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'note-action-btn';
      deleteBtn.title = 'Delete Note';
      deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        this.deleteNote(note.id);
      };

      actionsDiv.appendChild(deleteBtn);
      li.appendChild(titleDiv);
      li.appendChild(snippetDiv);
      li.appendChild(actionsDiv);
      li.onclick = () => {
        this.displayNoteById(note.id);
        this.toggleSidebar();
      };
      this.notesList.appendChild(li);
    });
  }

  private displayNote(note: Note): void {
    const titlePlaceholder =
      this.editorTitle.getAttribute('placeholder') || 'Untitled Note';
    this.editorTitle.textContent = note.title || titlePlaceholder;
    this.editorTitle.classList.toggle(
      'placeholder-active',
      !note.title || note.title === titlePlaceholder,
    );

    const rawPlaceholder =
      this.rawTranscription.getAttribute('placeholder') || '';
    this.rawTranscription.textContent = note.rawTranscription || rawPlaceholder;
    this.rawTranscription.classList.toggle(
      'placeholder-active',
      !note.rawTranscription,
    );

    const polishedPlaceholder =
      this.polishedNote.getAttribute('placeholder') || '';
    this.polishedNote.innerHTML = note.polishedNote
      ? marked.parse(note.polishedNote)
      : polishedPlaceholder;
    this.polishedNote.classList.toggle('placeholder-active', !note.polishedNote);
  }

  private displayNoteById(noteId: string): void {
    const note = this.notes.find((n) => n.id === noteId);
    if (note) {
      this.currentNote = note;
      this.displayNote(note);
      this.renderSidebar(); // To update active state
    }
  }

  private deleteNote(noteId: string): void {
    this.notes = this.notes.filter((note) => note.id !== noteId);
    this.saveNotesToLocalStorage();
    this.renderSidebar();
    if (this.currentNote && this.currentNote.id === noteId) {
      this.createNewNote();
    }
  }

  private clearAllNotes(): void {
    if (confirm('Are you sure you want to delete all notes?')) {
      this.notes = [];
      this.saveNotesToLocalStorage();
      this.renderSidebar();
      this.createNewNote();
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new VoiceNotesApp();

  document
    .querySelectorAll<HTMLElement>('[contenteditable][placeholder]')
    .forEach((el) => {
      const placeholder = el.getAttribute('placeholder')!;
      function updatePlaceholderState() {
        const currentText = (
          el.id === 'polishedNote' ? el.innerText : el.textContent
        )?.trim();
        if (currentText === '' || currentText === placeholder) {
          if (el.id === 'polishedNote' && currentText === '')
            el.innerHTML = placeholder;
          else if (currentText === '') el.textContent = placeholder;
          el.classList.add('placeholder-active');
        } else {
          el.classList.remove('placeholder-active');
        }
      }
      updatePlaceholderState();
      el.addEventListener('focus', function () {
        const currentText = (
          this.id === 'polishedNote' ? this.innerText : this.textContent
        )?.trim();
        if (currentText === placeholder) {
          if (this.id === 'polishedNote') this.innerHTML = '';
          else this.textContent = '';
          this.classList.remove('placeholder-active');
        }
      });
      el.addEventListener('blur', updatePlaceholderState);
    });
});

export {};