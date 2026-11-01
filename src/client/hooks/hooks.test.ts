// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReaderTts } from './useReaderTts';

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
  });
});
