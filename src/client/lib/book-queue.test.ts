import { beforeEach, describe, expect, it, vi } from "vitest";
import { queueBookDelete, queueBookUpload, runBookQueue } from "./book-queue";
import * as idbModule from "./idb";
import * as booksApi from "./books";
import * as coverModule from "./cover";

describe("book-queue guards and processor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("queueBookUpload & queueBookDelete", () => {
    it("queueBookUpload jamás encola libros con datos ausentes o vacíos (0 bytes)", async () => {
      const enqueueMock = vi.spyOn(idbModule, "enqueueBookOp").mockResolvedValue({
        id: "op-1",
        kind: "upload",
        hash: "b-vacio",
        createdAt: 1000,
      });
      vi.spyOn(idbModule, "getStoredBook").mockResolvedValue({
        hash: "b-vacio",
        name: "vacio.epub",
        addedAt: 1000,
        data: new Blob([]), // 0 bytes
      });

      await queueBookUpload("b-vacio");
      expect(enqueueMock).not.toHaveBeenCalled();
    });

    it("queueBookUpload encola libros con datos válidos", async () => {
      const enqueueMock = vi.spyOn(idbModule, "enqueueBookOp").mockResolvedValue({
        id: "op-valid",
        kind: "upload",
        hash: "b-valid",
        createdAt: 1000,
      });
      vi.spyOn(idbModule, "getStoredBook").mockResolvedValue({
        hash: "b-valid",
        name: "valid.epub",
        addedAt: 1000,
        data: new Blob(["epub-content"]),
      });

      await queueBookUpload("b-valid", "valid.epub");
      expect(enqueueMock).toHaveBeenCalledWith(
        { kind: "upload", hash: "b-valid", name: "valid.epub" },
        expect.anything(),
      );
    });

    it("queueBookDelete encola la operación de borrado", async () => {
      const enqueueMock = vi.spyOn(idbModule, "enqueueBookOp").mockResolvedValue({
        id: "op-del",
        kind: "delete",
        hash: "b-del",
        createdAt: 1000,
      });

      await queueBookDelete("b-del");
      expect(enqueueMock).toHaveBeenCalledWith(
        { kind: "delete", hash: "b-del" },
        undefined,
      );
    });
  });

  describe("runBookQueue", () => {
    it("runBookQueue descarta de la cola cualquier tarea con binario de 0 bytes sin llamar a uploadBook", async () => {
      const uploadSpy = vi.spyOn(booksApi, "uploadBook").mockResolvedValue(true);
      const removeOpSpy = vi.spyOn(idbModule, "removeBookOp").mockResolvedValue();

      vi.spyOn(idbModule, "captureDbScope").mockReturnValue({ userId: "u-1", generation: 0 });
      vi.spyOn(idbModule, "isDbScopeActive").mockReturnValue(true);
      vi.spyOn(idbModule, "listBookOps").mockResolvedValue([
        {
          id: "op-vacio",
          kind: "upload",
          hash: "b-cero",
          createdAt: 1000,
        },
      ]);
      vi.spyOn(idbModule, "getStoredBook").mockResolvedValue({
        hash: "b-cero",
        name: "cero.epub",
        addedAt: 1000,
        data: new Blob([]),
      });

      const done = await runBookQueue();
      expect(uploadSpy).not.toHaveBeenCalled();
      expect(removeOpSpy).toHaveBeenCalledWith("op-vacio", expect.anything());
      expect(done).toBe(0);
    });

    it("retorna 0 si no hay sesión o el scope es inactivo", async () => {
      vi.spyOn(idbModule, "captureDbScope").mockReturnValue({ userId: null, generation: 0 });
      expect(await runBookQueue()).toBe(0);

      vi.spyOn(idbModule, "captureDbScope").mockReturnValue({ userId: "u-1", generation: 0 });
      vi.spyOn(idbModule, "isDbScopeActive").mockReturnValue(false);
      expect(await runBookQueue()).toBe(0);
    });

    it("procesa subida exitosa extrayendo metadatos si faltan y borra la operación", async () => {
      vi.spyOn(idbModule, "captureDbScope").mockReturnValue({ userId: "u-1", generation: 0 });
      vi.spyOn(idbModule, "isDbScopeActive").mockReturnValue(true);
      vi.spyOn(idbModule, "listBookOps").mockResolvedValue([
        { id: "op-1", kind: "upload", hash: "h-full", createdAt: 100 },
      ]);
      vi.spyOn(idbModule, "getStoredBook").mockResolvedValue({
        hash: "h-full",
        name: "book.epub",
        addedAt: 100,
        data: new Blob(["content"]),
      });
      vi.spyOn(coverModule, "readBookMeta").mockResolvedValue({
        title: "Meta Title",
        author: "Meta Author",
        sectionCount: 5,
        language: "es",
        cover: null,
      });
      const uploadSpy = vi.spyOn(booksApi, "uploadBook").mockResolvedValue(true);
      const removeOpSpy = vi.spyOn(idbModule, "removeBookOp").mockResolvedValue();

      const done = await runBookQueue();
      expect(done).toBe(1);
      expect(uploadSpy).toHaveBeenCalledWith(
        "h-full",
        expect.any(File),
        { title: "Meta Title", author: "Meta Author", sectionCount: 5, language: "es" },
        expect.anything(),
      );
      expect(removeOpSpy).toHaveBeenCalledWith("op-1", expect.anything());
    });

    it("procesa borrado exitoso y elimina la operación", async () => {
      vi.spyOn(idbModule, "captureDbScope").mockReturnValue({ userId: "u-1", generation: 0 });
      vi.spyOn(idbModule, "isDbScopeActive").mockReturnValue(true);
      vi.spyOn(idbModule, "listBookOps").mockResolvedValue([
        { id: "op-del", kind: "delete", hash: "h-del", createdAt: 200 },
      ]);
      const deleteSpy = vi.spyOn(booksApi, "deleteBook").mockResolvedValue(true);
      const removeOpSpy = vi.spyOn(idbModule, "removeBookOp").mockResolvedValue();

      const done = await runBookQueue();
      expect(done).toBe(1);
      expect(deleteSpy).toHaveBeenCalledWith("h-del", expect.anything());
      expect(removeOpSpy).toHaveBeenCalledWith("op-del", expect.anything());
    });

    it("si el libro local fue borrado antes de subirse, descarta la op sin marcar error", async () => {
      vi.spyOn(idbModule, "captureDbScope").mockReturnValue({ userId: "u-1", generation: 0 });
      vi.spyOn(idbModule, "isDbScopeActive").mockReturnValue(true);
      vi.spyOn(idbModule, "listBookOps").mockResolvedValue([
        { id: "op-missing", kind: "upload", hash: "h-missing", createdAt: 100 },
      ]);
      vi.spyOn(idbModule, "getStoredBook").mockResolvedValue(undefined);
      const removeOpSpy = vi.spyOn(idbModule, "removeBookOp").mockResolvedValue();

      const done = await runBookQueue();
      expect(done).toBe(0);
      expect(removeOpSpy).toHaveBeenCalledWith("op-missing", expect.anything());
    });

    it("cuando el servidor rechaza la operación (false), marca error y la deja en cola", async () => {
      vi.spyOn(idbModule, "captureDbScope").mockReturnValue({ userId: "u-1", generation: 0 });
      vi.spyOn(idbModule, "isDbScopeActive").mockReturnValue(true);
      vi.spyOn(idbModule, "listBookOps").mockResolvedValue([
        { id: "op-rej", kind: "delete", hash: "h-rej", createdAt: 200 },
      ]);
      vi.spyOn(booksApi, "deleteBook").mockResolvedValue(false);
      const markErrorSpy = vi.spyOn(idbModule, "markBookOpError").mockResolvedValue();
      const removeOpSpy = vi.spyOn(idbModule, "removeBookOp").mockResolvedValue();

      const done = await runBookQueue();
      expect(done).toBe(0);
      expect(markErrorSpy).toHaveBeenCalledWith("op-rej", expect.stringContaining("rechazó"), expect.anything());
      expect(removeOpSpy).not.toHaveBeenCalled();
    });

    it("se detiene sin marcar error si se lanza StaleScopeError", async () => {
      vi.spyOn(idbModule, "captureDbScope").mockReturnValue({ userId: "u-1", generation: 0 });
      vi.spyOn(idbModule, "isDbScopeActive").mockReturnValue(true);
      vi.spyOn(idbModule, "listBookOps").mockResolvedValue([
        { id: "op-stale", kind: "delete", hash: "h-stale", createdAt: 200 },
      ]);
      vi.spyOn(booksApi, "deleteBook").mockRejectedValue(new idbModule.StaleScopeError());
      const markErrorSpy = vi.spyOn(idbModule, "markBookOpError").mockResolvedValue();

      const done = await runBookQueue();
      expect(done).toBe(0);
      expect(markErrorSpy).not.toHaveBeenCalled();
    });

    it("anota el error si se lanza un Error inesperado", async () => {
      vi.spyOn(idbModule, "captureDbScope").mockReturnValue({ userId: "u-1", generation: 0 });
      vi.spyOn(idbModule, "isDbScopeActive").mockReturnValue(true);
      vi.spyOn(idbModule, "listBookOps").mockResolvedValue([
        { id: "op-err", kind: "delete", hash: "h-err", createdAt: 200 },
      ]);
      vi.spyOn(booksApi, "deleteBook").mockRejectedValue(new Error("Unexpected crash"));
      const markErrorSpy = vi.spyOn(idbModule, "markBookOpError").mockResolvedValue();

      const done = await runBookQueue();
      expect(done).toBe(0);
      expect(markErrorSpy).toHaveBeenCalledWith("op-err", "Unexpected crash", expect.anything());
    });
  });
});
