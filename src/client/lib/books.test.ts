import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteBook, downloadBook, listRemoteBooks, uploadBook, type RemoteBook } from "./books";
import * as accountFetchModule from "./account-fetch";
import { StaleScopeError, type DbScope } from "./idb";

describe("books client library", () => {
  const dummyScope: DbScope = { userId: "user-123", generation: 1 };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("uploadBook", () => {
    it("envía PUT con parámetros de metadatos y retorna true en éxito", async () => {
      const fetchSpy = vi.spyOn(accountFetchModule, "accountFetch").mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

      const file = new File([new Uint8Array([1, 2, 3])], "quijote.epub", { type: "application/epub+zip" });
      const ok = await uploadBook(
        "hash-123",
        file,
        {
          title: "Don Quijote",
          author: "Cervantes",
          sectionCount: 12,
          language: "es",
        },
        dummyScope,
      );

      expect(ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/books/hash-123?name=quijote.epub&title=Don+Quijote&author=Cervantes&sections=12&language=es"),
        expect.objectContaining({ method: "PUT", body: file }),
        dummyScope,
      );
    });

    it("retorna false si el servidor responde con error 413 o 500", async () => {
      vi.spyOn(accountFetchModule, "accountFetch").mockResolvedValue(
        new Response(JSON.stringify({ error: "Storage quota exceeded" }), { status: 413 }),
      );

      const file = new File([new Uint8Array([1])], "libro.epub");
      const ok = await uploadBook("hash-413", file, {}, dummyScope);
      expect(ok).toBe(false);
    });

    it("re-lanza StaleScopeError cuando la cuenta cambia a mitad de la subida", async () => {
      vi.spyOn(accountFetchModule, "accountFetch").mockRejectedValue(new StaleScopeError());

      const file = new File([new Uint8Array([1])], "libro.epub");
      await expect(uploadBook("hash-stale", file, {}, dummyScope)).rejects.toThrow(StaleScopeError);
    });

    it("retorna false en error de red ordinario", async () => {
      vi.spyOn(accountFetchModule, "accountFetch").mockRejectedValue(new Error("Network failed"));

      const file = new File([new Uint8Array([1])], "libro.epub");
      const ok = await uploadBook("hash-fail", file, {}, dummyScope);
      expect(ok).toBe(false);
    });
  });

  describe("listRemoteBooks", () => {
    it("retorna la lista de libros remotos", async () => {
      const remoteList: RemoteBook[] = [
        { hash: "h1", uploaded: "2026-10-24T10:00:00Z", name: "libro1.epub", title: "Libro 1" },
      ];
      vi.spyOn(accountFetchModule, "accountFetch").mockResolvedValue(
        new Response(JSON.stringify({ books: remoteList }), { status: 200 }),
      );

      const books = await listRemoteBooks(dummyScope);
      expect(books).toEqual(remoteList);
    });

    it("retorna [] si la respuesta no es ok o viene sin books", async () => {
      vi.spyOn(accountFetchModule, "accountFetch").mockResolvedValue(
        new Response(JSON.stringify({}), { status: 500 }),
      );

      const books = await listRemoteBooks(dummyScope);
      expect(books).toEqual([]);
    });

    it("re-lanza StaleScopeError si el scope cambió", async () => {
      vi.spyOn(accountFetchModule, "accountFetch").mockRejectedValue(new StaleScopeError());

      await expect(listRemoteBooks(dummyScope)).rejects.toThrow(StaleScopeError);
    });

    it("retorna [] en fallo de red ordinario", async () => {
      vi.spyOn(accountFetchModule, "accountFetch").mockRejectedValue(new Error("fetch failed"));

      const books = await listRemoteBooks(dummyScope);
      expect(books).toEqual([]);
    });
  });

  describe("downloadBook", () => {
    it("descarga el binario y retorna un File con el nombre correspondiente", async () => {
      const blobData = new Uint8Array([1, 2, 3, 4]);
      vi.spyOn(accountFetchModule, "accountFetch").mockResolvedValue(
        new Response(blobData, {
          status: 200,
          headers: { "Content-Type": "application/epub+zip" },
        }),
      );

      const file = await downloadBook(
        { hash: "hash-download", uploaded: "now", name: "mi-novela.epub" },
        dummyScope,
      );

      expect(file).not.toBeNull();
      expect(file?.name).toBe("mi-novela.epub");
      expect(file?.type).toBe("application/epub+zip");
    });

    it("retorna null si el libro remoto no existe (404)", async () => {
      vi.spyOn(accountFetchModule, "accountFetch").mockResolvedValue(
        new Response(null, { status: 404 }),
      );

      const file = await downloadBook({ hash: "hash-404", uploaded: "now", name: "" }, dummyScope);
      expect(file).toBeNull();
    });

    it("re-lanza StaleScopeError", async () => {
      vi.spyOn(accountFetchModule, "accountFetch").mockRejectedValue(new StaleScopeError());

      await expect(
        downloadBook({ hash: "hash-stale", uploaded: "now", name: "" }, dummyScope),
      ).rejects.toThrow(StaleScopeError);
    });

    it("retorna null en error genérico", async () => {
      vi.spyOn(accountFetchModule, "accountFetch").mockRejectedValue(new Error("Net error"));

      const file = await downloadBook({ hash: "hash-err", uploaded: "now", name: "" }, dummyScope);
      expect(file).toBeNull();
    });
  });

  describe("deleteBook", () => {
    it("retorna true en eliminación exitosa (200 o 404)", async () => {
      vi.spyOn(accountFetchModule, "accountFetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      expect(await deleteBook("hash-del-200", dummyScope)).toBe(true);

      vi.spyOn(accountFetchModule, "accountFetch").mockResolvedValueOnce(
        new Response(null, { status: 404 }),
      );
      expect(await deleteBook("hash-del-404", dummyScope)).toBe(true);
    });

    it("retorna false en error 500 del servidor", async () => {
      vi.spyOn(accountFetchModule, "accountFetch").mockResolvedValue(
        new Response(null, { status: 500 }),
      );
      expect(await deleteBook("hash-500", dummyScope)).toBe(false);
    });

    it("re-lanza StaleScopeError", async () => {
      vi.spyOn(accountFetchModule, "accountFetch").mockRejectedValue(new StaleScopeError());

      await expect(deleteBook("hash-stale", dummyScope)).rejects.toThrow(StaleScopeError);
    });

    it("retorna false en error genérico", async () => {
      vi.spyOn(accountFetchModule, "accountFetch").mockRejectedValue(new Error("Timeout"));

      expect(await deleteBook("hash-err", dummyScope)).toBe(false);
    });
  });
});
