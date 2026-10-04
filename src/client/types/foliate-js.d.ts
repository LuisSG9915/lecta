declare module "foliate-js/epub.js" {
  type EpubLoader = {
    loadText: (name: string) => Promise<string>;
    loadBlob: (name: string, type?: string) => Promise<Blob | null>;
    getSize: (name: string) => number;
    sha1?: (data: Uint8Array) => Promise<Uint8Array>;
  };

  type EpubTocItem = {
    label?: string;
    href?: string;
    subitems?: EpubTocItem[];
  };

  type EpubSection = {
    id: string;
    load: () => Promise<string>;
    unload?: () => void;
    createDocument: () => Promise<Document>;
    size: number;
    linear?: string;
    cfi?: string;
    resolveHref: (href: string) => string;
  };

  export class EPUB {
    constructor(loader: EpubLoader);
    init(): Promise<this & EpubBook>;
    loadDocument(item: unknown): Promise<Document>;
  }

  type EpubBook = {
    sections: EpubSection[];
    toc?: EpubTocItem[];
    pageList?: EpubTocItem[];
    landmarks?: EpubTocItem[];
    metadata?: Record<string, unknown>;
    rendition?: Record<string, unknown>;
    dir?: string;
    getCover?: () => Promise<Blob | null>;
  };
}
