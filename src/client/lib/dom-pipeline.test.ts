// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  applyUnifiedTextTransforms,
  clearInlineTypographyTransforms,
} from './dom-pipeline';

describe('dom-pipeline unified text transforms', () => {
  it('aplica guía visual de sílabas y división silábica en un único pase y revierte limpiamente', () => {
    const doc = document.implementation.createHTMLDocument('capítulo');
    doc.body.innerHTML = '<p>La arquitectura extraordinaria del palacio.</p>';
    const originalText = doc.body.textContent;

    applyUnifiedTextTransforms(doc, {
      syllableBreaks: true,
      bionicReading: true,
    });

    const bionicSpans = doc.querySelectorAll('span.lecta-bionic');
    expect(bionicSpans.length).toBeGreaterThan(0);
    expect(doc.body.getAttribute('data-lecta-bionic')).toBe('1');
    expect(doc.querySelector('p')?.getAttribute('data-lecta-syllables')).toBe('1');
    expect(doc.body.textContent).toContain('·');

    // Al limpiar, el texto vuelve exactamente a su estado original
    clearInlineTypographyTransforms(doc);
    expect(doc.querySelectorAll('span.lecta-bionic').length).toBe(0);
    expect(doc.body.textContent).toBe(originalText);
  });
});
