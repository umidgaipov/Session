/**
 * Session — Statistics Mobile Test Platform
 * Stage 2: Test Engine, Answer Evaluation, LocalStorage Persistence & Service Worker
 */

// ============================================================================
// 1. LOCAL STORAGE PERSISTENCE (Safe & Offline-First)
// ============================================================================

export class ProgressStorage {
  constructor(storageKey = 'session_statistics_progress_v1') {
    this.storageKey = storageKey;
    this.memoryState = {
      version: 1,
      answers: {},
      lastActive: { category: 'situational', index: 0 }
    };
    this.isStorageAvailable = this._checkStorage();
    this._load();
  }

  _checkStorage() {
    try {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch {
      console.warn('[Session Storage] LocalStorage unavailable; using memory fallback');
      return false;
    }
  }

  _load() {
    if (!this.isStorageAvailable) return;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.answers === 'object') {
          this.memoryState.answers = parsed.answers || {};
          if (parsed.lastActive && typeof parsed.lastActive.index === 'number') {
            this.memoryState.lastActive = parsed.lastActive;
          }
        }
      }
    } catch (err) {
      console.error('[Session Storage] Failed to parse stored progress, reset state:', err);
    }
  }

  _save() {
    if (!this.isStorageAvailable) return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.memoryState));
    } catch (err) {
      console.error('[Session Storage] Failed to persist progress to LocalStorage:', err);
    }
  }

  _makeKey(category, questionId) {
    return `${category}_${questionId}`;
  }

  getAnswer(category, questionId) {
    const key = this._makeKey(category, questionId);
    return this.memoryState.answers[key] || null;
  }

  saveAnswer(category, questionId, selectedOption, isCorrect) {
    const key = this._makeKey(category, questionId);
    const entry = {
      category,
      questionId: Number(questionId),
      selectedOption: String(selectedOption).toUpperCase(),
      isCorrect: Boolean(isCorrect),
      answeredAt: Date.now()
    };
    this.memoryState.answers[key] = entry;
    this._save();
    return entry;
  }

  getAllAnswersForCategory(category) {
    const result = {};
    for (const [key, val] of Object.entries(this.memoryState.answers)) {
      if (val && val.category === category) {
        result[val.questionId] = val;
      }
    }
    return result;
  }

  getCategoryStats(category, totalQuestionsCount) {
    const answers = this.getAllAnswersForCategory(category);
    const answeredCount = Object.keys(answers).length;
    let correctCount = 0;
    for (const ans of Object.values(answers)) {
      if (ans.isCorrect) correctCount++;
    }
    const incorrectCount = answeredCount - correctCount;
    const percentage = totalQuestionsCount > 0
      ? Math.round((answeredCount / totalQuestionsCount) * 100)
      : 0;

    return {
      total: totalQuestionsCount,
      answered: answeredCount,
      correct: correctCount,
      incorrect: incorrectCount,
      percentage
    };
  }

  saveLastActive(category, index) {
    this.memoryState.lastActive = {
      category,
      index: Number(index) || 0
    };
    this._save();
  }

  getLastActive() {
    return this.memoryState.lastActive || { category: 'situational', index: 0 };
  }

  clearAll() {
    this.memoryState = {
      version: 1,
      answers: {},
      lastActive: { category: 'situational', index: 0 }
    };
    if (this.isStorageAvailable) {
      try {
        localStorage.removeItem(this.storageKey);
      } catch (err) {
        console.error('[Session Storage] Failed to remove storage item:', err);
      }
    }
  }
}

// ============================================================================
// 2. DATA NORMALIZATION
// ============================================================================

export function normalizeSituational(item, index) {
  const id = item.seq_id || (index + 1);
  return {
    id,
    mode: 'situational',
    category: item.category || 'Основы теории статистики и измерительные шкалы',
    topic: item.topic || item.source_title || `Ситуационный кейс ${id}`,
    contextLabel: 'Ситуационный кейс',
    context: item.situation || item.scenario || '',
    question: item.question || '',
    options: (item.options || []).map((opt) => ({
      id: String(opt.id).toUpperCase(),
      text: opt.text || '',
      isCorrect: Boolean(opt.is_correct)
    })),
    correctOptionId: String(item.correct_option_id || '').toUpperCase(),
    explanation: item.explanation || '',
    distractorExplanations: item.distractor_explanations || {}
  };
}

export function normalizePractical(item, index) {
  const id = item.task_id || (index + 1);
  return {
    id,
    mode: 'practical',
    category: 'Практические расчетные задачи',
    topic: item.title || `Практическая задача ${id}`,
    contextLabel: 'Условие задачи',
    context: item.condition || '',
    question: item.question || '',
    options: (item.options || []).map((opt) => ({
      id: String(opt.id).toUpperCase(),
      text: opt.text || '',
      isCorrect: Boolean(opt.is_correct)
    })),
    correctOptionId: String(item.correct_option_id || '').toUpperCase(),
    explanation: item.explanation || '',
    distractorExplanations: item.distractor_explanations || {}
  };
}

// ============================================================================
// 3. SERVICE WORKER REGISTRATION
// ============================================================================

export function registerServiceWorker() {
  if (typeof window === 'undefined') return;

  if (window.location.protocol === 'file:') {
    console.info('[Session SW] Registration skipped: running via file:// protocol.');
    return;
  }

  if (!('serviceWorker' in navigator)) {
    console.info('[Session SW] ServiceWorker not supported by this browser.');
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((registration) => {
        console.log('[Session SW] Registered successfully with scope:', registration.scope);

        registration.addEventListener('updatefound', () => {
          const installingWorker = registration.installing;
          if (!installingWorker) return;
          installingWorker.addEventListener('statechange', () => {
            if (installingWorker.state === 'installed') {
              if (navigator.serviceWorker.controller) {
                console.log('[Session SW] Updated version available.');
              } else {
                console.log('[Session SW] Offline cache initialized for metro/offline use.');
              }
            }
          });
        });
      })
      .catch((error) => {
        console.warn('[Session SW] Registration failed:', error);
      });
  });
}

// ============================================================================
// 4. APPLICATION CONTROLLER
// ============================================================================

export class StatisticsApp {
  constructor() {
    this.storage = new ProgressStorage();

    this.state = {
      mode: 'situational', // 'situational' | 'practical'
      currentIndex: {
        situational: 0,
        practical: 0
      },
      catalogFilter: 'all', // 'all' | 'unsolved' | 'incorrect' | 'correct'
      isCatalogOpen: false,
      datasets: {
        situational: [],
        practical: []
      }
    };

    this.dom = {};
    this.isReady = false;
  }

  init() {
    this._cacheDOM();
    this._bindEvents();
    this._loadInitialDatasets();
    registerServiceWorker();
  }

  _cacheDOM() {
    this.dom = {
      // Header & Tabs
      tabSituational: document.getElementById('tab-situational'),
      tabPractical: document.getElementById('tab-practical'),
      badgeSituational: document.getElementById('badge-situational'),
      badgePractical: document.getElementById('badge-practical'),
      progressBar: document.getElementById('progress-bar'),
      progressFill: document.getElementById('progress-fill'),
      progressText: document.getElementById('progress-text'),
      btnReset: document.getElementById('btn-reset'),

      // Question Meta & Card
      categoryTag: document.getElementById('category-tag'),
      categoryText: document.getElementById('category-text'),
      questionIndexBadge: document.getElementById('question-index-badge'),
      questionCard: document.getElementById('question-card'),
      questionTopic: document.getElementById('question-topic'),
      contextBox: document.getElementById('context-box'),
      contextLabel: document.getElementById('context-label'),
      contextText: document.getElementById('context-text'),
      questionPrompt: document.getElementById('question-prompt'),
      optionsList: document.getElementById('options-list'),

      // Explanation & Distractors
      explanationCard: document.getElementById('explanation-card'),
      explanationStatusPill: document.getElementById('explanation-status-pill'),
      explanationBody: document.getElementById('explanation-body'),
      distractorsWrap: document.getElementById('distractors-wrap'),
      distractorsList: document.getElementById('distractors-list'),

      // Navigation
      btnPrev: document.getElementById('btn-prev'),
      btnCatalog: document.getElementById('btn-catalog'),
      btnNext: document.getElementById('btn-next'),

      // Catalog Bottom Sheet
      sheetBackdrop: document.getElementById('sheet-backdrop'),
      sheetContainer: document.getElementById('sheet-container'),
      sheetHandleBar: document.getElementById('sheet-handle-bar'),
      btnCloseSheet: document.getElementById('btn-close-sheet'),
      sheetFilters: document.querySelectorAll('.filter-chip'),
      filterCountAll: document.getElementById('filter-count-all'),
      filterCountUnsolved: document.getElementById('filter-count-unsolved'),
      filterCountIncorrect: document.getElementById('filter-count-incorrect'),
      filterCountCorrect: document.getElementById('filter-count-correct'),
      sheetGrid: document.getElementById('sheet-grid')
    };
  }

  async _loadInitialDatasets() {
    try {
      const [sitRes, pracRes] = await Promise.all([
        fetch('situational_tests.json'),
        fetch('practical_tests.json')
      ]);

      if (!sitRes.ok || !pracRes.ok) {
        throw new Error(`Data fetch error: sit=${sitRes.status}, prac=${pracRes.status}`);
      }

      const [sitRaw, pracRaw] = await Promise.all([
        sitRes.json(),
        pracRes.json()
      ]);

      this.state.datasets.situational = sitRaw.map(normalizeSituational);
      this.state.datasets.practical = pracRaw.map(normalizePractical);

      // Update badge counts
      if (this.dom.badgeSituational) {
        this.dom.badgeSituational.textContent = this.state.datasets.situational.length;
      }
      if (this.dom.badgePractical) {
        this.dom.badgePractical.textContent = this.state.datasets.practical.length;
      }

      // Restore last active category & question index
      const lastActive = this.storage.getLastActive();
      if (lastActive && (lastActive.category === 'situational' || lastActive.category === 'practical')) {
        this.state.mode = lastActive.category;
        const maxIndex = (this.state.datasets[this.state.mode].length || 1) - 1;
        this.state.currentIndex[this.state.mode] = Math.min(Math.max(0, lastActive.index || 0), maxIndex);
      }

      // Synchronize category tabs UI
      this._updateCategoryTabsUI();

      // Render question and progress
      this.renderCurrentQuestion();
      this.updateProgressIndicator();
      this.updateCatalogFilterCounts();
      this.isReady = true;
    } catch (err) {
      console.error('[Session Engine] Error loading test datasets:', err);
      if (this.dom.questionTopic) {
        this.dom.questionTopic.textContent = 'Ошибка загрузки базы вопросов';
      }
      if (this.dom.contextText) {
        this.dom.contextText.textContent = 'Не удалось загрузить данные тестов. Убедитесь, что сервер запущен или кэш Service Worker активен.';
      }
    }
  }

  _bindEvents() {
    // Mode Switcher Tabs
    if (this.dom.tabSituational) {
      this.dom.tabSituational.addEventListener('click', () => this.switchCategory('situational'));
    }
    if (this.dom.tabPractical) {
      this.dom.tabPractical.addEventListener('click', () => this.switchCategory('practical'));
    }

    // Option Tap (Delegated on options list for zero latency & instant press)
    if (this.dom.optionsList) {
      this.dom.optionsList.addEventListener('click', (e) => {
        const btn = e.target.closest('.option-btn');
        if (!btn || btn.classList.contains('is-disabled') || btn.disabled) return;
        const optionId = btn.dataset.optionId || btn.dataset.option;
        if (optionId) {
          this.handleOptionSelect(optionId);
        }
      });
    }

    // Bottom Navigation
    if (this.dom.btnNext) {
      this.dom.btnNext.addEventListener('click', () => this.goToNext());
    }
    if (this.dom.btnPrev) {
      this.dom.btnPrev.addEventListener('click', () => this.goToPrev());
    }

    // Catalog Sheet
    if (this.dom.btnCatalog) {
      this.dom.btnCatalog.addEventListener('click', () => this.openCatalogSheet());
    }
    if (this.dom.btnCloseSheet) {
      this.dom.btnCloseSheet.addEventListener('click', () => this.closeCatalogSheet());
    }
    if (this.dom.sheetBackdrop) {
      this.dom.sheetBackdrop.addEventListener('click', (e) => {
        if (e.target === this.dom.sheetBackdrop) {
          this.closeCatalogSheet();
        }
      });
    }

    // Reset Progress
    if (this.dom.btnReset) {
      this.dom.btnReset.addEventListener('click', () => this.handleResetProgress());
    }

    // Filter Chips
    if (this.dom.sheetFilters) {
      this.dom.sheetFilters.forEach((chip) => {
        chip.addEventListener('click', () => {
          this.dom.sheetFilters.forEach((c) => c.classList.remove('is-active'));
          chip.classList.add('is-active');
          this.state.catalogFilter = chip.dataset.filter || 'all';
          this.renderCatalogGrid();
        });
      });
    }

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.state.isCatalogOpen) {
        this.closeCatalogSheet();
      } else if (!this.state.isCatalogOpen) {
        if (e.key === 'ArrowRight') this.goToNext();
        if (e.key === 'ArrowLeft') this.goToPrev();
      }
    });

    // Sheet Drag-to-Dismiss Gesture
    this._initSheetDragGesture();
  }

  _initSheetDragGesture() {
    if (!this.dom.sheetHandleBar || !this.dom.sheetContainer) return;

    let startY = 0;
    let currentY = 0;
    let isDragging = false;

    this.dom.sheetHandleBar.addEventListener('pointerdown', (e) => {
      isDragging = true;
      startY = e.clientY;
      currentY = 0;
      this.dom.sheetHandleBar.setPointerCapture(e.pointerId);
      this.dom.sheetContainer.style.transition = 'none';
    });

    this.dom.sheetHandleBar.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dy = e.clientY - startY;
      if (dy > 0) {
        currentY = dy;
        this.dom.sheetContainer.style.transform = `translateY(${dy}px)`;
      }
    });

    const onPointerUp = () => {
      if (!isDragging) return;
      isDragging = false;
      this.dom.sheetContainer.style.transition = '';

      if (currentY > 80) {
        this.closeCatalogSheet();
        this.dom.sheetContainer.style.transform = '';
      } else {
        this.dom.sheetContainer.style.transform = '';
      }
    };

    this.dom.sheetHandleBar.addEventListener('pointerup', onPointerUp);
    this.dom.sheetHandleBar.addEventListener('pointercancel', onPointerUp);
  }

  // --------------------------------------------------------------------------
  // Category Switching
  // --------------------------------------------------------------------------

  switchCategory(newMode) {
    if (this.state.mode === newMode) return;
    this.state.mode = newMode;
    this._updateCategoryTabsUI();

    this.storage.saveLastActive(this.state.mode, this.state.currentIndex[this.state.mode]);
    this.renderCurrentQuestion();
    this.updateProgressIndicator();
    this.updateCatalogFilterCounts();

    if (this.state.isCatalogOpen) {
      this.renderCatalogGrid();
    }
  }

  _updateCategoryTabsUI() {
    const isSituational = this.state.mode === 'situational';
    if (this.dom.tabSituational) {
      this.dom.tabSituational.classList.toggle('is-active', isSituational);
      this.dom.tabSituational.setAttribute('aria-selected', String(isSituational));
    }
    if (this.dom.tabPractical) {
      this.dom.tabPractical.classList.toggle('is-active', !isSituational);
      this.dom.tabPractical.setAttribute('aria-selected', String(!isSituational));
    }
  }

  getCurrentDataset() {
    return this.state.datasets[this.state.mode] || [];
  }

  getCurrentQuestion() {
    const dataset = this.getCurrentDataset();
    const index = this.state.currentIndex[this.state.mode] || 0;
    return dataset[index] || null;
  }

  // --------------------------------------------------------------------------
  // Question Card Rendering
  // --------------------------------------------------------------------------

  renderCurrentQuestion() {
    const q = this.getCurrentQuestion();
    if (!q) return;

    const dataset = this.getCurrentDataset();
    const total = dataset.length;
    const currentNum = (this.state.currentIndex[this.state.mode] || 0) + 1;

    // 1. Meta Bar
    if (this.dom.categoryText) {
      this.dom.categoryText.textContent = q.category;
    }
    if (this.dom.categoryTag) {
      this.dom.categoryTag.title = q.category;
    }
    if (this.dom.questionIndexBadge) {
      this.dom.questionIndexBadge.textContent = `Вопрос ${currentNum} из ${total}`;
    }

    // 2. Question Card Content
    if (this.dom.questionCard) {
      this.dom.questionCard.dataset.seqId = q.id;
      this.dom.questionCard.dataset.type = this.state.mode;
    }
    if (this.dom.questionTopic) {
      this.dom.questionTopic.textContent = q.topic;
    }
    if (this.dom.contextLabel) {
      this.dom.contextLabel.textContent = q.contextLabel;
    }
    if (this.dom.contextText) {
      this.dom.contextText.textContent = q.context;
    }
    if (this.dom.questionPrompt) {
      this.dom.questionPrompt.textContent = q.question;
    }

    // 3. Options List & Saved State Restoration
    this._renderOptions(q);

    // 4. Explanation & Distractors Card
    this._renderExplanation(q);

    // 5. Navigation Controls
    this._updateNavigationControls();
  }

  _renderOptions(q) {
    if (!this.dom.optionsList) return;
    this.dom.optionsList.innerHTML = '';

    const savedAnswer = this.storage.getAnswer(this.state.mode, q.id);
    const isAnswered = Boolean(savedAnswer);

    q.options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option-btn';
      btn.id = `option-${opt.id}`;
      btn.dataset.option = opt.id;
      btn.dataset.optionId = opt.id;

      if (isAnswered) {
        btn.disabled = true;
        btn.classList.add('is-disabled');
        btn.setAttribute('aria-disabled', 'true');

        if (opt.id === q.correctOptionId) {
          btn.classList.add('is-correct');
        } else if (opt.id === savedAnswer.selectedOption && !savedAnswer.isCorrect) {
          btn.classList.add('is-incorrect');
        } else {
          btn.classList.add('is-dimmed');
        }
      }

      const indicator = document.createElement('span');
      indicator.className = 'option-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      indicator.textContent = opt.id;

      const textSpan = document.createElement('span');
      textSpan.className = 'option-text';
      textSpan.textContent = opt.text;

      btn.appendChild(indicator);
      btn.appendChild(textSpan);

      this.dom.optionsList.appendChild(btn);
    });
  }

  _renderExplanation(q) {
    if (!this.dom.explanationCard) return;

    const savedAnswer = this.storage.getAnswer(this.state.mode, q.id);
    if (!savedAnswer) {
      this.dom.explanationCard.classList.remove('is-visible');
      if (this.dom.distractorsList) this.dom.distractorsList.innerHTML = '';
      return;
    }

    // Status pill
    if (this.dom.explanationStatusPill) {
      this.dom.explanationStatusPill.className = `explanation-status-pill ${savedAnswer.isCorrect ? 'is-correct' : 'is-incorrect'}`;
      this.dom.explanationStatusPill.textContent = savedAnswer.isCorrect ? 'Верно' : 'Неверно';
    }

    // Explanation body
    if (this.dom.explanationBody) {
      this.dom.explanationBody.textContent = q.explanation || 'Обоснование отсутствует.';
    }

    // Distractor traps anatomy
    const distractors = q.distractorExplanations || {};
    const distractorKeys = Object.keys(distractors).sort();

    if (this.dom.distractorsList && this.dom.distractorsWrap) {
      this.dom.distractorsList.innerHTML = '';

      if (distractorKeys.length > 0) {
        this.dom.distractorsWrap.style.display = 'block';

        const fragment = document.createDocumentFragment();
        distractorKeys.forEach((key) => {
          const item = document.createElement('div');
          item.className = 'distractor-item';

          const tag = document.createElement('span');
          tag.className = 'distractor-tag';
          tag.textContent = `Вариант ${key}:`;

          item.appendChild(tag);
          item.appendChild(document.createTextNode(' ' + distractors[key]));
          fragment.appendChild(item);
        });
        this.dom.distractorsList.appendChild(fragment);
      } else {
        this.dom.distractorsWrap.style.display = 'none';
      }
    }

    this.dom.explanationCard.classList.add('is-visible');
  }

  // --------------------------------------------------------------------------
  // Answer Handling & Soft State Feedback
  // --------------------------------------------------------------------------

  handleOptionSelect(selectedOptionId) {
    const q = this.getCurrentQuestion();
    if (!q) return;

    // Guard: already answered
    const existing = this.storage.getAnswer(this.state.mode, q.id);
    if (existing) return;

    const chosen = String(selectedOptionId).toUpperCase();
    const correct = String(q.correctOptionId).toUpperCase();
    const isCorrect = chosen === correct;

    // Persist answer
    this.storage.saveAnswer(this.state.mode, q.id, chosen, isCorrect);

    // Apply button visual states
    if (this.dom.optionsList) {
      const buttons = this.dom.optionsList.querySelectorAll('.option-btn');
      buttons.forEach((btn) => {
        const optId = String(btn.dataset.optionId || btn.dataset.option).toUpperCase();
        btn.disabled = true;
        btn.classList.add('is-disabled');
        btn.setAttribute('aria-disabled', 'true');

        if (optId === correct) {
          btn.classList.add('is-correct');
          btn.classList.remove('is-incorrect', 'is-dimmed');
        } else if (optId === chosen && !isCorrect) {
          btn.classList.add('is-incorrect');
          btn.classList.remove('is-correct', 'is-dimmed');
        } else {
          btn.classList.add('is-dimmed');
          btn.classList.remove('is-correct', 'is-incorrect');
        }
      });
    }

    // Reveal explanation card & distractor anatomy
    this._renderExplanation(q);

    // Update progress strip
    this.updateProgressIndicator();
    this.updateCatalogFilterCounts();

    if (this.state.isCatalogOpen) {
      this.renderCatalogGrid();
    }

    // Smooth scroll explanation card into view if needed
    if (this.dom.explanationCard) {
      setTimeout(() => {
        this.dom.explanationCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    }
  }

  // --------------------------------------------------------------------------
  // Progress Bar Strip
  // --------------------------------------------------------------------------

  updateProgressIndicator() {
    const dataset = this.getCurrentDataset();
    const total = dataset.length;
    const stats = this.storage.getCategoryStats(this.state.mode, total);

    if (this.dom.progressBar) {
      this.dom.progressBar.setAttribute('aria-valuenow', stats.answered);
      this.dom.progressBar.setAttribute('aria-valuemax', total);
    }
    if (this.dom.progressFill) {
      this.dom.progressFill.style.width = `${stats.percentage}%`;
    }
    if (this.dom.progressText) {
      this.dom.progressText.textContent = `${stats.answered} / ${total}`;
    }
  }

  // --------------------------------------------------------------------------
  // Navigation
  // --------------------------------------------------------------------------

  _updateNavigationControls() {
    const dataset = this.getCurrentDataset();
    const idx = this.state.currentIndex[this.state.mode] || 0;

    if (this.dom.btnPrev) {
      this.dom.btnPrev.disabled = idx <= 0;
    }
    if (this.dom.btnNext) {
      this.dom.btnNext.disabled = idx >= dataset.length - 1;
    }
  }

  goToNext() {
    const dataset = this.getCurrentDataset();
    const current = this.state.currentIndex[this.state.mode] || 0;
    if (current < dataset.length - 1) {
      this.state.currentIndex[this.state.mode] = current + 1;
      this.storage.saveLastActive(this.state.mode, this.state.currentIndex[this.state.mode]);
      this.renderCurrentQuestion();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  goToPrev() {
    const current = this.state.currentIndex[this.state.mode] || 0;
    if (current > 0) {
      this.state.currentIndex[this.state.mode] = current - 1;
      this.storage.saveLastActive(this.state.mode, this.state.currentIndex[this.state.mode]);
      this.renderCurrentQuestion();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // --------------------------------------------------------------------------
  // Catalog Filter Counters
  // --------------------------------------------------------------------------

  updateCatalogFilterCounts() {
    const dataset = this.getCurrentDataset();
    const total = dataset.length;
    const stats = this.storage.getCategoryStats(this.state.mode, total);
    const unsolved = Math.max(0, total - stats.answered);

    if (this.dom.filterCountAll) {
      this.dom.filterCountAll.textContent = total;
    }
    if (this.dom.filterCountUnsolved) {
      this.dom.filterCountUnsolved.textContent = unsolved;
    }
    if (this.dom.filterCountIncorrect) {
      this.dom.filterCountIncorrect.textContent = stats.incorrect;
    }
    if (this.dom.filterCountCorrect) {
      this.dom.filterCountCorrect.textContent = stats.correct;
    }
  }

  // --------------------------------------------------------------------------
  // Catalog Bottom Sheet Drawer
  // --------------------------------------------------------------------------

  openCatalogSheet() {
    this.state.isCatalogOpen = true;
    if (this.dom.sheetBackdrop) {
      this.dom.sheetBackdrop.classList.add('is-open');
    }
    if (this.dom.btnCatalog) {
      this.dom.btnCatalog.setAttribute('aria-expanded', 'true');
    }
    document.body.style.overflow = 'hidden';

    this.updateCatalogFilterCounts();
    this.renderCatalogGrid();

    // Smooth scroll to current question cell
    requestAnimationFrame(() => {
      if (!this.dom.sheetGrid) return;
      const currentCell = this.dom.sheetGrid.querySelector('.grid-cell.is-current');
      if (currentCell) {
        currentCell.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  closeCatalogSheet() {
    this.state.isCatalogOpen = false;
    if (this.dom.sheetBackdrop) {
      this.dom.sheetBackdrop.classList.remove('is-open');
    }
    if (this.dom.btnCatalog) {
      this.dom.btnCatalog.setAttribute('aria-expanded', 'false');
    }
    document.body.style.overflow = '';
  }

  renderCatalogGrid() {
    if (!this.dom.sheetGrid) return;
    this.dom.sheetGrid.innerHTML = '';

    const dataset = this.getCurrentDataset();
    const currentIndex = this.state.currentIndex[this.state.mode] || 0;
    const filter = this.state.catalogFilter;
    let renderedCount = 0;

    dataset.forEach((q, idx) => {
      const answer = this.storage.getAnswer(this.state.mode, q.id);
      const isAnswered = Boolean(answer);
      const isCorrect = isAnswered && answer.isCorrect;
      const isIncorrect = isAnswered && !answer.isCorrect;

      // Filter logic
      if (filter === 'unsolved' && isAnswered) return;
      if (filter === 'correct' && !isCorrect) return;
      if (filter === 'incorrect' && !isIncorrect) return;

      renderedCount++;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'grid-cell';
      cell.textContent = idx + 1;
      cell.dataset.index = idx;
      cell.setAttribute('aria-label', `Вопрос ${idx + 1}`);

      if (idx === currentIndex) {
        cell.classList.add('is-current');
      }
      if (isCorrect) {
        cell.classList.add('is-correct');
      } else if (isIncorrect) {
        cell.classList.add('is-incorrect');
      }

      cell.addEventListener('click', () => {
        this.state.currentIndex[this.state.mode] = idx;
        this.storage.saveLastActive(this.state.mode, idx);
        this.renderCurrentQuestion();
        this.closeCatalogSheet();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      this.dom.sheetGrid.appendChild(cell);
    });

    if (renderedCount === 0) {
      const notice = document.createElement('div');
      notice.style.gridColumn = '1 / -1';
      notice.style.padding = '24px 0';
      notice.style.textAlign = 'center';
      notice.style.fontSize = '14px';
      notice.style.color = 'var(--text-secondary)';
      notice.textContent = 'Нет заданий в данной категории фильтра';
      this.dom.sheetGrid.appendChild(notice);
    }
  }

  // --------------------------------------------------------------------------
  // Reset Progress Flow
  // --------------------------------------------------------------------------

  handleResetProgress() {
    const confirmed = window.confirm(
      'Сбросить весь сохраненный прогресс тестирования?\n\nВсе ваши ответы и статистика по 152 заданиям будут обнулены.'
    );

    if (confirmed) {
      this.storage.clearAll();
      this.state.currentIndex = { situational: 0, practical: 0 };
      this.renderCurrentQuestion();
      this.updateProgressIndicator();
      this.updateCatalogFilterCounts();
      if (this.state.isCatalogOpen) {
        this.renderCatalogGrid();
      }
    }
  }
}

// ============================================================================
// 5. APPLICATION LAUNCH
// ============================================================================

export const app = new StatisticsApp();

// Expose app globally on window for headless browser evaluation, testing, and debugging
if (typeof window !== 'undefined') {
  window.app = app;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.init());
  } else {
    app.init();
  }
}
