// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  loadUserTheta,
  saveUserTheta,
  migrateLegacyTheta,
  THETA_MIGRATION_KEY,
  predictWordMasteryProbability,
  betaFromZipf,
  updateLanguageTheta,
  loadUserLanguageProfile,
  saveUserLanguageProfile,
  recordChapterCompleted,
  DEFAULT_USER_LANGUAGE_PROFILE,
  getThetaForLanguage,
  raschPriorKnowProbability,
  fsrsRetrievability,
  estimateWordKnowProbability,
  updateThetaForLanguageSignal,
  type MultilingualThetaProfile,
  DEFAULT_THETA_L1,
  DEFAULT_THETA_L2,
} from "./profile-models";

describe("Recalibración en Vivo y Modelo de Nivel de Usuario Theta (Fase 4.3)", () => {
  it("persiste theta por idioma en la llave única del perfil", () => {
    saveUserTheta(1.15, "es");
    saveUserTheta(0.40, "en");

    expect(loadUserTheta("es")).toBeCloseTo(1.15, 2);
    expect(loadUserTheta("en")).toBeCloseTo(0.40, 2);

    const profile = loadUserLanguageProfile();
    expect(profile.thetaByLang.es).toBeCloseTo(1.15, 2);
    expect(profile.thetaByLang.en).toBeCloseTo(0.40, 2);
    // La llave heredada ya no se escribe.
    expect(window.localStorage.getItem("lecta:user_theta:v1")).toBeNull();
    expect(window.localStorage.getItem("lecta:user_theta:en:v1")).toBeNull();
  });

  it("migra el theta viejo (7 − zipf) restando 3 una sola vez", () => {
    window.localStorage.clear();
    window.localStorage.setItem("lecta:user_theta:es:v1", "4.5");

    expect(loadUserTheta("es")).toBeCloseTo(1.5, 2);
    expect(window.localStorage.getItem(THETA_MIGRATION_KEY)).toBe("1");

    // Ya migrado: un valor nuevo en la llave vieja no vuelve a mover el perfil.
    window.localStorage.setItem("lecta:user_theta:es:v1", "6");
    migrateLegacyTheta();
    expect(loadUserTheta("es")).toBeCloseTo(1.5, 2);
  });

  it("no resta 3 a un θ que ya venía en escala Rasch (CAT previo o calibración saltada)", () => {
    window.localStorage.clear();
    window.localStorage.setItem("lecta:user_theta:es:v1", "0.0");
    window.localStorage.setItem("lecta:user_theta:en:v1", "-0.4");

    expect(loadUserTheta("es")).toBeCloseTo(0.0, 2);
    expect(loadUserTheta("en")).toBeCloseTo(-0.4, 2);
  });
});

describe("Modelo Psicométrico Rasch 1PL y theta por idioma (Track 6)", () => {
  it("predictWordMasteryProbability calcula Rasch 1PL sigmoide", () => {
    // Si theta == beta, probabilidad es 0.5
    expect(predictWordMasteryProbability(0.0, 0.0)).toBeCloseTo(0.5, 4);
    expect(predictWordMasteryProbability(1.5, 1.5)).toBeCloseTo(0.5, 4);

    // Si theta > beta, probabilidad > 0.5
    expect(predictWordMasteryProbability(1.0, 0.0)).toBeGreaterThan(0.7);

    // Si theta < beta, probabilidad < 0.5
    expect(predictWordMasteryProbability(0.0, 1.0)).toBeLessThan(0.3);

    // z acotado [-10, 10] para estabilidad numérica
    expect(predictWordMasteryProbability(100, 0)).toBeCloseTo(1, 4);
    expect(predictWordMasteryProbability(-100, 0)).toBeCloseTo(0, 4);
  });

  it("betaFromZipf mapea escala Zipf a dificultad intrinsic beta", () => {
    // zipf 4.0 -> beta 0.0 (dificultad media)
    expect(betaFromZipf(4.0)).toBe(0.0);
    // zipf 2.0 (palabra rara) -> beta 2.0 (difícil)
    expect(betaFromZipf(2.0)).toBe(2.0);
    // zipf 6.0 (palabra común) -> beta -2.0 (fácil)
    expect(betaFromZipf(6.0)).toBe(-2.0);
  });

  it("updateLanguageTheta con outcome = 1 incrementa theta y reduce incertidumbre", () => {
    const profile = { ...DEFAULT_USER_LANGUAGE_PROFILE };
    const beta = 1.0;
    const updated = updateLanguageTheta(profile, "es", beta, 1);

    expect(updated.thetaByLang.es).toBeGreaterThan(0.0);
    expect(updated.uncertaintyByLang.es).toBeLessThan(1.0);
    // El inglés no debe haber cambiado
    expect(updated.thetaByLang.en).toBe(0.0);
  });

  it("updateLanguageTheta con outcome = 0 decrementa theta y reduce incertidumbre", () => {
    const profile = { ...DEFAULT_USER_LANGUAGE_PROFILE, thetaByLang: { es: 1.0 } };
    const beta = -0.5; // Palabra fácil desconocida
    const updated = updateLanguageTheta(profile, "es", beta, 0);

    expect(updated.thetaByLang.es).toBeLessThan(1.0);
    expect(updated.uncertaintyByLang.es).toBeLessThan(1.0);
  });

  it("soporta actualización directa persistida y conteo de capítulos", () => {
    localStorage.clear();
    const updated = updateLanguageTheta("en", 0.5, 1);
    expect(updated.thetaByLang.en).toBeGreaterThan(0.0);

    const loaded = loadUserLanguageProfile();
    expect(loaded.thetaByLang.en).toBe(updated.thetaByLang.en);

    const afterChapter = recordChapterCompleted("en");
    expect(afterChapter.chaptersCompletedByLang.en).toBe(1);
    expect(afterChapter.chaptersCompletedByLang.es ?? 0).toBe(0);

    saveUserLanguageProfile({
      thetaByLang: { es: 1.5, en: 0.5 },
      uncertaintyByLang: { es: 0.8, en: 0.9 },
      chaptersCompletedByLang: { es: 3, en: 1 },
    });
    const loaded2 = loadUserLanguageProfile();
    expect(loaded2.thetaByLang.es).toBe(1.5);
    expect(loaded2.chaptersCompletedByLang.es).toBe(3);
  });

  describe("Desacoplamiento Multilingüe thetaByLang y Probabilidad Rasch + FSRS", () => {
    it("getThetaForLanguage mantiene separados los niveles de español e inglés", () => {
      const profile: MultilingualThetaProfile = {
        theta: 1.2,
        thetaByLang: { es: 1.2, en: -0.4 },
      };

      expect(getThetaForLanguage(profile, "es", "es")).toBe(1.2);
      expect(getThetaForLanguage(profile, "en", "es")).toBe(-0.4);
      // Idioma no calibrado en L2 cae a DEFAULT_THETA_L2 (-0.6)
      expect(getThetaForLanguage(profile, "fr", "es")).toBe(DEFAULT_THETA_L2);
      // Idioma no calibrado pero nativo (L1) cae a DEFAULT_THETA_L1 (0.0)
      expect(getThetaForLanguage({}, "es", "es")).toBe(DEFAULT_THETA_L1);
      // Retrocompatibilidad con profile.theta si bookLang === nativeLang
      expect(getThetaForLanguage({ theta: 2.1 }, "es", "es")).toBe(2.1);
    });

    it("raschPriorKnowProbability calcula la curva logística 1PL correctamente", () => {
      // theta = beta -> P = 0.5
      expect(raschPriorKnowProbability(1.0, 1.0)).toBeCloseTo(0.5, 4);
      // theta > beta -> P > 0.5
      expect(raschPriorKnowProbability(2.0, 1.0)).toBeGreaterThan(0.7);
      // theta < beta -> P < 0.5
      expect(raschPriorKnowProbability(0.0, 1.0)).toBeLessThan(0.3);
    });

    it("fsrsRetrievability calcula el decaimiento de memoria según estabilidad", () => {
      // t = 0 -> R = 1.0 (recuerdo perfecto recién visto)
      expect(fsrsRetrievability(0, 10)).toBe(1.0);
      // Conforme pasan días (t), la recuperabilidad decae
      const rDay1 = fsrsRetrievability(1, 10);
      const rDay10 = fsrsRetrievability(10, 10);
      expect(rDay1).toBeLessThan(1.0);
      expect(rDay10).toBeLessThan(rDay1);
      expect(rDay10).toBeGreaterThan(0.5);
      // Estabilidad inválida devuelve 0
      expect(fsrsRetrievability(5, 0)).toBe(0);
    });

    it("estimateWordKnowProbability sustituye el prior de Rasch por FSRS cuando hay historial", () => {
      const theta = 0.0;
      const beta = 1.0;
      const now = Date.now();

      // 1. Sin historial previo ni estabilidad: usa Rasch prior
      const priorProb = estimateWordKnowProbability({
        thetaUL: theta,
        betaW: beta,
      });
      expect(priorProb).toBeCloseTo(raschPriorKnowProbability(theta, beta), 4);

      // 2. Con conocimiento explícito 'known': devuelve 0.99
      expect(
        estimateWordKnowProbability({
          thetaUL: theta,
          betaW: beta,
          knowledgeStatus: "known",
        }),
      ).toBe(0.99);

      // 3. Con estabilidad y fecha vista previa: sustituye por recuperabilidad FSRS
      const fsrsProb = estimateWordKnowProbability({
        thetaUL: theta,
        betaW: beta,
        stability: 15,
        lastSeenTimestampMs: now - 3 * 86_400_000, // 3 días atrás
        nowMs: now,
      });
      const expectedFsrs = fsrsRetrievability(3, 15);
      expect(fsrsProb).toBeCloseTo(expectedFsrs, 4);
      expect(fsrsProb).not.toBe(priorProb);
    });

    it("updateThetaForLanguageSignal actualiza theta para explicit_known, lookup_surprise y passive_frontier", () => {
      const initialProfile: MultilingualThetaProfile = {
        theta: 0.0,
        thetaByLang: { es: 0.0, en: -0.5 },
      };

      // 1. explicit_known ("✓ Ya la sé"): sube theta en ese idioma
      const afterKnown = updateThetaForLanguageSignal(
        initialProfile,
        "en",
        0.5, // beta > theta
        "explicit_known",
      );
      expect(afterKnown.thetaByLang.en).toBeGreaterThan(-0.5);
      // El español queda intacto
      expect(afterKnown.thetaByLang.es).toBe(0.0);

      // 2. lookup_surprise (consulta en WordPanel): baja theta si se creía conocida
      const afterLookup = updateThetaForLanguageSignal(
        initialProfile,
        "es",
        -1.0, // palabra fácil que se creía conocida
        "lookup_surprise",
      );
      expect(afterLookup.thetaByLang.es).toBeLessThan(0.0);
      expect(afterLookup.theta).toBe(afterLookup.thetaByLang.es); // Sincronizado en es

      // 3. passive_frontier: refuerzo suave si está en frontera (|theta - beta| <= 1.1)
      const afterPassive = updateThetaForLanguageSignal(
        initialProfile,
        "es",
        0.2, // Distancia 0.2 <= 1.1
        "passive_frontier",
      );
      expect(afterPassive.thetaByLang.es).toBeGreaterThan(0.0);

      // 4. passive_frontier no hace nada si la palabra está lejos de la frontera
      const afterPassiveFar = updateThetaForLanguageSignal(
        initialProfile,
        "es",
        2.5, // Distancia 2.5 > 1.1
        "passive_frontier",
      );
      expect(afterPassiveFar.thetaByLang.es).toBe(0.0);
    });
  });
});

