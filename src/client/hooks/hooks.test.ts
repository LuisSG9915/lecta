// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReaderTts } from './useReaderTts';
import { saveTtsLandingPosition, clearTtsLandingPosition } from '../lib/tts-landing';
import { consentTts } from '../lib/ttsSettings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    it('«Continuar escuchando» arranca en la oración del landing, no al inicio', async () => {
      consentTts(undefined, { engine: 'browser' });
      saveTtsLandingPosition({
        bookHash: 'h-resume',
        sectionIndex: 0,
        sentenceIndex: 2,
        paragraphText: 'Tres tres tres.',
        anchor: 'Uno uno uno. Dos dos dos. Tres tres tres.',
        updatedAt: 1,
      });
      Object.defineProperty(window, 'speechSynthesis', {
        value: {
          getVoices: () => [],
          speak: () => undefined,
          cancel: () => undefined,
          pause: () => undefined,
          resume: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        },
        configurable: true,
      });
      class Utt {
        text: string;
        constructor(text: string) {
          this.text = text;
        }
      }
      vi.stubGlobal('SpeechSynthesisUtterance', Utt);
      const el = document.createElement('div');
      el.innerHTML = '<p>Uno uno uno. Dos dos dos. Tres tres tres.</p>';
      document.body.appendChild(el);
      Element.prototype.scrollIntoView = () => undefined;
      const containerRef = { current: el };
      let ttsHook!: ReturnType<typeof useReaderTts>;

      function TestComponent() {
        ttsHook = useReaderTts({
          bookHash: 'h-resume',
          state: 'ready',
          sectionIndex: 0,
          sectionIndexRef: { current: 0 },
          containerRef,
          pendingAudioResume: { key: 1, sectionIndex: 0 },
        });
        return h('div', null, ttsHook.ttsSnap.status);
      }

      await act(async () => {
        root.render(h(TestComponent));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1300));
      });

      expect(ttsHook.ttsSnap.status).not.toBe('idle');
      expect(ttsHook.ttsRef.current?.getCurrentSentence()).toBe('Tres tres tres.');
      clearTtsLandingPosition('h-resume');
      el.remove();
      // @ts-expect-error limpieza del stub
      delete Element.prototype.scrollIntoView;
      vi.unstubAllGlobals();
      // @ts-expect-error limpieza del stub
      delete window.speechSynthesis;
    });
  });
});
