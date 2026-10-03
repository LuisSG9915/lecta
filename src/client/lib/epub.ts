import {
  BlobReader,
  BlobWriter,
  TextWriter,
  ZipReader,
  type FileEntry,
} from "@zip.js/zip.js";
import { EPUB } from "foliate-js/epub.js";

export type EpubBook = Awaited<ReturnType<EPUB["init"]>>;
export type EpubTocItem = NonNullable<EpubBook["toc"]>[number];

type EpubLoader = {
  loadText: (name: string) => Promise<string>;
  loadBlob: (name: string, type?: string) => Promise<Blob | null>;
  getSize: (name: string) => number;
};

export async function createEpubLoader(file: Blob) {
  const reader = new ZipReader(new BlobReader(file));
  const entries = await reader.getEntries();
  const files = entries.filter((entry): entry is FileEntry => !entry.directory);
  const entriesByName = new Map(files.map((entry) => [entry.filename, entry]));

  const loader: EpubLoader = {
    loadText: async (name) => (await entriesByName.get(name)?.getData(new TextWriter())) ?? "",
    loadBlob: async (name, type) =>
      (await entriesByName.get(name)?.getData(new BlobWriter(type))) ?? null,
    getSize: (name) => entriesByName.get(name)?.uncompressedSize ?? 0,
  };

  return { loader, close: () => reader.close() };
}

export async function openEpub(file: Blob) {
  const { loader, close } = await createEpubLoader(file);
  const book = await new EPUB(loader).init();
  return { book, close };
}
