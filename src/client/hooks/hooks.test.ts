// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWordInspector } from './useWordInspector';
import { useReaderTts } from './useReaderTts';
import type { BookMeta } from '../lib/idb';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Mock dependencies
vi.mock('../lib/lexicon', () => ({
  lookupWord: vi.fn(async (word: string) => ({
    ok: true,
    found: true,
    entries: [
      {
        lemma: word.toLowerCase(),
        pos: 'sustantivo',
        senses: [{ definition: `Definición de ${word}`, senseOrder: 1 }],
      },
    ],
    word,
    lemma: word.toLowerCase(),
    definitions: [`Definición de ${word}`],
    source: 'catalog',
  })),
}));

vi.mock('../lib/idb', () => ({
  getBookWithData: vi.fn(async () => null),
  captureDbScope: vi.fn(() => ({})),
}));

vi.mock('../lib/vocab', () => ({
  findSavedEntry: vi.fn(async () => null),
  saveVocabEntry: vi.fn(async (entry) => ({
    entry: { id: 'saved-1', ...entry },
  })),
  removeVocabEntry: vi.fn(async () => {}),
  updateVocabNote: vi.fn(async (id, note) => ({
    id,
    note,
    word: 'test',
  })),
}));

vi.mock('../lib/knowledge', () => ({
  getWordKnowledge: vi.fn(async () => null),
  markWordStatus: vi.fn(async () => {}),
  getAllKnowledgeMap: vi.fn(async () => new Map()),
}));

vi.mock('../lib/reviews', () => ({
  scheduleCapturedReview: vi.fn(async () => {}),
}));

vi.mock('../lib/reading-events', () => ({
  recordEvent: vi.fn(async () => {}),
}));

vi.mock('../lib/epub', () => ({
  extractChapters: vi.fn(() => []),
  injectReaderStyles: vi.fn(),
  openEpubElement: vi.fn(async () => ({
    view: { addEventListener: vi.fn(), removeEventListener: vi.fn(), goTo: vi.fn() },
    bookObj: {},
    cleanup: vi.fn(),
  })),
}));

describe('Lecta Custom Hooks (Decoupled Architecture)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    localStorage.clear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const mockBook: BookMeta = {
    id: 'book-123',
    hash: 'book-123',
    title: 'Don Quijote',
    name: 'don-quijote.epub',
    author: 'Cervantes',
    language: 'es',
    sectionCount: 1,
    cover: null,
  };

  describe('useWordInspector', () => {
    it('inspecciona y guarda una palabra agendando repaso intencional en FSRS', async () => {
      let inspectorHook!: ReturnType<typeof useWordInspector>;
      const onVocabChanged = vi.fn();
      const onKnowledgeUpdated = vi.fn();
      const onShowNotice = vi.fn();
      const onAwardCompanion = vi.fn();

      function TestComponent() {
        inspectorHook = useWordInspector({
          book: mockBook,
          phrasesIndex: null,
          onVocabChanged,
          onKnowledgeUpdated,
          onShowNotice,
          onAwardCompanion,
        });
        return h('div', null, inspectorHook.selectedWord?.word || 'none');
      }

      await act(async () => {
        root.render(h(TestComponent));
      });

      expect(inspectorHook.selectedWord).toBeNull();

      // Inspeccionar palabra
      await act(async () => {
        await inspectorHook.inspectWord('hidalgo', 'En un lugar de la Mancha...');
      });

      expect(inspectorHook.selectedWord?.word).toBe('hidalgo');
      expect(inspectorHook.meaning?.definitions[0]).toBe('Definición de hidalgo');
      expect(onAwardCompanion).toHaveBeenCalledWith('word_lookup');

      // Guardar palabra en el cuaderno
      await act(async () => {
        await inspectorHook.handleSaveWord();
      });

      expect(onVocabChanged).toHaveBeenCalled();
      expect(onKnowledgeUpdated).toHaveBeenCalledWith('hidalgo', 'learning');
      expect(onAwardCompanion).toHaveBeenCalledWith('word_saved');
      expect(onShowNotice).toHaveBeenCalledWith(expect.stringContaining('hidalgo'));
    });
  });

  describe('useReaderTts', () => {
    it('solicita consentimiento explícito antes de reproducir voces neuronales Kitten TTS', async () => {
      let ttsHook!: ReturnType<typeof useReaderTts>;
      const onShowNotice = vi.fn();

      function TestComponent() {
        ttsHook = useReaderTts({
          sectionDoc: null,
          onShowNotice,
        });
        return h('div', null, ttsHook.ttsStatus);
      }

      await act(async () => {
        root.render(h(TestComponent));
      });

      // Seleccionar voz neuronal sin consentimiento previo
      act(() => {
        ttsHook.handleChangeVoice('kitten:expr-voice-2-f');
      });

      expect(ttsHook.showTtsConsent).toBe(true);

      // Confirmar consentimiento voluntario
      act(() => {
        ttsHook.handleConfirmConsent();
      });

      expect(ttsHook.showTtsConsent).toBe(false);
      expect(ttsHook.ttsVoiceURI).toBe('kitten:expr-voice-2-f');
    });
  });
});
