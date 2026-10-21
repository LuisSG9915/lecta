import { beforeEach, describe, expect, it, vi } from "vitest";
import { queueBookUpload, runBookQueue } from "./book-queue";
import * as idbModule from "./idb";
import * as booksApi from "./books";

describe("book-queue guards", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

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
    // uploadBook no debe haber sido llamado para 0 bytes
    expect(uploadSpy).not.toHaveBeenCalled();
    // La operación se descartó de la cola
    expect(removeOpSpy).toHaveBeenCalledWith("op-vacio", expect.anything());
    expect(done).toBe(0);
  });
});
