import { useCallback, useRef, useState } from 'react';
import type { BookMeta, VocabEntry, WordMeaning } from '../lib/idb';
import { type KnowledgeStatus, getWordKnowledge, markWordStatus } from '../lib/knowledge';
import { lookupWord } from '../lib/lexicon';
import type { PhrasesIndex, PhraseEntry } from '../lib/phrases';
import { findSavedEntry, removeVocabEntry, saveVocabEntry, updateVocabNote } from '../lib/vocab';
import { scheduleCapturedReview } from '../lib/reviews';
import { recordEvent } from '../lib/reading-events';
import { classifyWordLevel, type WordLevel } from '../lib/word-level';
import { translateSentence } from '../lib/translate';
import { hapticLight, hapticSuccess } from '../lib/haptics';

export interface SelectedWord {
  word: string;
  sentence: string;
  cfi?: string;
  phrase?: PhraseEntry;
}

interface UseWordInspectorParams {
  book: BookMeta;
  phrasesIndex: PhrasesIndex | null;
  onVocabChanged: () => void;
  onKnowledgeUpdated: (lemma: string, status: KnowledgeStatus) => void;
  onShowNotice: (msg: string) => void;
  onAwardCompanion?: (ev: string) => void;
}

export function useWordInspector({
  book,
  phrasesIndex,
  onVocabChanged,
  onKnowledgeUpdated,
  onShowNotice,
  onAwardCompanion,
}: UseWordInspectorParams) {
  const [selected, setSelected] = useState<SelectedWord | null>(null);
  const [meaning, setMeaning] = useState<WordMeaning | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedEntry, setSavedEntry] = useState<VocabEntry | null>(null);
  const [wordNote, setWordNote] = useState('');
  const [noteSavedAt, setNoteSavedAt] = useState<number | null>(null);
  const [knowledgeStatus, setKnowledgeStatus] = useState<KnowledgeStatus | null>(null);
  const [wordLevel, setWordLevel] = useState<WordLevel | null>(null);
  const [sentenceTranslation, setSentenceTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);

  const tappedWordsOnPageRef = useRef<Set<string>>(new Set());
  const lookupSeqRef = useRef(0);
  const bookId = book.id || book.hash || '';

  const resetPagesTappedWords = useCallback(() => {
    tappedWordsOnPageRef.current = new Set();
  }, []);

  const inspectWord = useCallback(
    async (
      rawWord: string,
      sentence: string,
      cfi?: string,
      explicitPhrase?: PhraseEntry,
    ) => {
      const cleaned = rawWord.trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
      if (!cleaned) return;

      const seq = ++lookupSeqRef.current;
      hapticLight();
      tappedWordsOnPageRef.current.add(cleaned.toLowerCase());

      // Detectar si la palabra pertenece a una locución en la oración
      const matchedPhrase =
        explicitPhrase ??
        (phrasesIndex ? phrasesIndex.findInSentence(sentence, cleaned) : undefined);

      setSelected({ word: cleaned, sentence, cfi, phrase: matchedPhrase });
      setMeaning(null);
      setError(null);
      setLoading(true);
      setSentenceTranslation(null);
      setTranslationError(null);
      setNoteSavedAt(null);

      recordEvent('word_lookup', { bookId, word: cleaned.toLowerCase() }).catch(
        () => {},
      );
      onAwardCompanion?.('word_lookup');

      try {
        if (matchedPhrase) {
          const phraseMeaning: WordMeaning = {
            word: matchedPhrase.phrase,
            lemma: matchedPhrase.phrase.toLowerCase(),
            partOfSpeech: 'locución',
            ContextualMeaning: matchedPhrase.meaning,
            definitions: [matchedPhrase.meaning],
            examples: matchedPhrase.example ? [matchedPhrase.example] : [],
            source: 'local',
          };
          if (seq !== lookupSeqRef.current) return;
          setMeaning(phraseMeaning);
          const existing = await findSavedEntry(matchedPhrase.phrase, bookId);
          if (seq !== lookupSeqRef.current) return;
          setSavedEntry(existing ?? null);
          setWordNote(existing?.note ?? '');
          const k = await getWordKnowledge(matchedPhrase.phrase.toLowerCase());
          setKnowledgeStatus(k?.status ?? null);
          setWordLevel(classifyWordLevel(matchedPhrase.phrase));
          setLoading(false);
          return;
        }

        const result = await lookupWord(cleaned, sentence);
        if (seq !== lookupSeqRef.current) return;

        setMeaning(result.ok && result.found ? (result as unknown as WordMeaning) : null);
        const targetLemma = (result.lemma || cleaned).toLowerCase();
        const [existing, k] = await Promise.all([
          findSavedEntry(cleaned, bookId),
          getWordKnowledge(targetLemma),
        ]);
        if (seq !== lookupSeqRef.current) return;

        setSavedEntry(existing ?? null);
        setWordNote(existing?.note ?? '');
        setKnowledgeStatus(k?.status ?? null);
        setWordLevel(classifyWordLevel(targetLemma));
      } catch (err) {
        if (seq !== lookupSeqRef.current) return;
        setError(err instanceof Error ? err.message : 'No se pudo consultar la palabra');
      } finally {
        if (seq === lookupSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [bookId, phrasesIndex, onAwardCompanion],
  );

  const handleSaveWord = useCallback(async () => {
    if (!selected || !meaning) return;
    const targetWord = selected.phrase ? selected.phrase.phrase : selected.word;
    const result = await saveVocabEntry({
      word: targetWord,
      lemma: meaning.lemma || targetWord.toLowerCase(),
      bookId,
      bookTitle: book.title,
      sentence: selected.sentence,
      cfi: selected.cfi,
      meaning,
      note: wordNote.trim() || undefined,
    });

    // Agendar en FSRS únicamente cuando el usuario decide guardar la palabra
    await scheduleCapturedReview(targetWord, bookId, selected.sentence).catch(() => {});
    await markWordStatus(meaning.lemma || targetWord.toLowerCase(), 'learning');

    setSavedEntry(result.entry);
    setKnowledgeStatus('learning');
    onKnowledgeUpdated((meaning.lemma || targetWord).toLowerCase(), 'learning');
    onVocabChanged();
    hapticSuccess();
    onAwardCompanion?.('word_saved');
    onShowNotice(`«${targetWord}» guardada en tu vocabulario`);
  }, [
    selected,
    meaning,
    wordNote,
    bookId,
    book.title,
    onKnowledgeUpdated,
    onVocabChanged,
    onAwardCompanion,
    onShowNotice,
  ]);

  const handleRemoveWord = useCallback(async () => {
    if (!savedEntry) return;
    await removeVocabEntry(savedEntry.id);
    setSavedEntry(null);
    setWordNote('');
    onVocabChanged();
    onShowNotice('Palabra eliminada de tu vocabulario');
  }, [savedEntry, onVocabChanged, onShowNotice]);

  const handleSaveWordNote = useCallback(async () => {
    if (!savedEntry) return;
    const updated = await updateVocabNote(savedEntry.id, wordNote.trim());
    if (updated) {
      setSavedEntry(updated);
      setNoteSavedAt(Date.now());
      onVocabChanged();
    }
  }, [savedEntry, wordNote, onVocabChanged]);

  const handleKnowledgeChange = useCallback(
    async (status: KnowledgeStatus) => {
      if (!selected) return;
      const lemma = (meaning?.lemma || selected.word).toLowerCase();
      await markWordStatus(lemma, status);
      if (status === 'learning') {
        await scheduleCapturedReview(selected.word, bookId, selected.sentence).catch(
          () => {},
        );
      }
      setKnowledgeStatus(status);
      onKnowledgeUpdated(lemma, status);
      hapticLight();
    },
    [selected, meaning, bookId, onKnowledgeUpdated],
  );

  const handleTranslateSentence = useCallback(async () => {
    if (!selected?.sentence || translating) return;
    setTranslating(true);
    setTranslationError(null);
    try {
      const translated = await translateSentence(selected.sentence, 'en');
      setSentenceTranslation(translated);
    } catch (err) {
      setTranslationError(
        err instanceof Error ? err.message : 'No se pudo traducir la oración',
      );
    } finally {
      setTranslating(false);
    }
  }, [selected, translating]);

  const closeInspector = useCallback(() => {
    lookupSeqRef.current++;
    setSelected(null);
    setMeaning(null);
    setError(null);
  }, []);

  return {
    selected,
    selectedWord: selected,
    meaning,
    loading,
    wordLoading: loading,
    error,
    wordError: error,
    savedEntry,
    wordNote,
    setWordNote,
    noteSavedAt,
    knowledgeStatus,
    wordLevel,
    sentenceTranslation,
    translating,
    translationError,
    tappedWordsOnPageRef,
    resetPagesTappedWords,
    inspectWord,
    handleSaveWord,
    handleRemoveWord,
    handleSaveWordNote,
    handleKnowledgeChange,
    handleTranslateSentence,
    closeInspector,
  };
}
