// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  isHashLikeIdentifier,
  humanizeFilename,
  bookDisplayName,
  displayTitle,
  coverPalette,
  coverToJpegBlob,
  getRemoteCoverObjectUrl,
  setRemoteCoverCache,
} from "./cover";

describe("cover & book identity", () => {
  describe("isHashLikeIdentifier", () => {
    it("detecta hashes puros, con extensión .epub y con prefijo Libro / Book", () => {
      expect(isHashLikeIdentifier("ebe48104")).toBe(true);
      expect(isHashLikeIdentifier("ebe48104.epub")).toBe(true);
      expect(isHashLikeIdentifier("Libro ebe48104.epub")).toBe(true);
      expect(isHashLikeIdentifier("libro ebe48104")).toBe(true);
      expect(isHashLikeIdentifier("Book 1234abcd5678ef90.epub")).toBe(true);
      expect(isHashLikeIdentifier("a".repeat(64))).toBe(true);
      expect(isHashLikeIdentifier(`Libro ${"f".repeat(32)}.epub`)).toBe(true);
    });

    it("no marca como hash títulos legibles o nombres reales", () => {
      expect(isHashLikeIdentifier("mi-libro-genial.epub")).toBe(false);
      expect(isHashLikeIdentifier("Sherlock Holmes")).toBe(false);
      expect(isHashLikeIdentifier("Don Quijote de la Mancha")).toBe(false);
      expect(isHashLikeIdentifier("")).toBe(false);
      expect(isHashLikeIdentifier(null)).toBe(false);
      expect(isHashLikeIdentifier(undefined)).toBe(false);
    });
  });

  describe("humanizeFilename", () => {
    it("convierte nombres de archivo limpios a título legible", () => {
      expect(humanizeFilename("mi-libro-genial.epub")).toBe("Mi Libro Genial");
      expect(humanizeFilename("don_quijote_de_la_mancha.epub")).toBe("Don Quijote De La Mancha");
      expect(humanizeFilename("el_principito")).toBe("El Principito");
    });

    it("devuelve string vacío si el nombre es un hash o identificador técnico", () => {
      expect(humanizeFilename("ebe48104.epub")).toBe("");
      expect(humanizeFilename("Libro ebe48104.epub")).toBe("");
      expect(humanizeFilename("1234abcd5678ef90.epub")).toBe("");
      expect(humanizeFilename("")).toBe("");
      expect(humanizeFilename(null)).toBe("");
    });
  });

  describe("bookDisplayName", () => {
    it("prioriza título limpio y no-hash", () => {
      expect(
        bookDisplayName({
          title: "Estudio en Escarlata",
          name: "estudio_en_escarlata.epub",
          author: "Arthur Conan Doyle",
        }),
      ).toBe("Estudio en Escarlata");
    });

    it("usa humanizeFilename si el título es nulo o parece hash", () => {
      expect(
        bookDisplayName({
          title: "Libro ebe48104.epub",
          name: "mi-gran-novela.epub",
          author: "Autor Anónimo",
        }),
      ).toBe("Mi Gran Novela");

      expect(
        bookDisplayName({
          title: "",
          name: "viaje_al_centro_de_la_tierra.epub",
        }),
      ).toBe("Viaje Al Centro De La Tierra");
    });

    it("usa autor legible si título y nombre no son legibles", () => {
      expect(
        bookDisplayName({
          title: "ebe48104",
          name: "ebe48104.epub",
          author: "H. G. Wells",
        }),
      ).toBe("Libro de H. G. Wells");
    });

    it("recae a Libro en la nube o Libro sin título y JAMÁS devuelve el hash", () => {
      const remote = bookDisplayName({
        hash: "ebe481041234567890abcdef1234567890abcdef",
        isRemoteOnly: true,
      });
      expect(remote).toBe("Libro en la nube");
      expect(remote).not.toContain("ebe48104");

      const local = bookDisplayName({
        hash: "ebe481041234567890abcdef1234567890abcdef",
        isRemoteOnly: false,
      });
      expect(local).toBe("Libro sin título");
      expect(local).not.toContain("ebe48104");
    });

    it("displayTitle delega en bookDisplayName", () => {
      expect(displayTitle("ebe48104.epub", "Libro ebe48104.epub")).toBe("Libro sin título");
      expect(displayTitle("novela.epub", "Cien Años")).toBe("Cien Años");
    });
  });

  describe("coverPalette", () => {
    it("devuelve una paleta consistente para un hash dado", () => {
      const p1 = coverPalette("hash-123");
      const p2 = coverPalette("hash-123");
      expect(p1).toEqual(p2);
      expect(p1.paper).toBeDefined();
      expect(p1.ink).toBeDefined();
    });
  });

  describe("coverToJpegBlob & cache de portadas remotas", () => {
    it("coverToJpegBlob tolera entornos sin canvas y no lanza error", async () => {
      const blob = new Blob(["dummy cover"], { type: "image/jpeg" });
      const converted = await coverToJpegBlob(blob);
      expect(converted).toBeDefined();
    });

    it("guarda y recupera portadas remotas en memoria", async () => {
      const blob = new Blob(["img-data"], { type: "image/jpeg" });
      const url = await setRemoteCoverCache("hash-test-cover", blob);
      expect(url).toBeDefined();
      const cached = await getRemoteCoverObjectUrl("hash-test-cover");
      expect(cached).toBe(url);
    });
  });
});
