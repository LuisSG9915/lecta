(function () {
  "use strict";

  var COVERAGE_FLUID_MIN = 94;
  var COVERAGE_IDEAL_MIN = 86;
  var MAX_EPUB_BYTES = 30 * 1024 * 1024;
  var MAX_SPINE_SCAN = 25;
  var MAX_TOTAL_WORDS_SCAN = 150000;
  var MIN_SUBSTANTIAL_CHAPTER_WORDS = 180;
  var MAX_BATCH_FORMS = 600;

  var LEVEL_THRESHOLDS = {
    beginner: 4.4,
    intermediate: 3.6,
    advanced: 2.8,
  };

  var COMMON_STOPWORDS = new Set([
    "the", "and", "that", "have", "for", "not", "with", "you", "this", "but", "his", "from", "they",
    "say", "her", "she", "will", "one", "all", "would", "there", "their", "what", "out", "about",
    "who", "get", "which", "when", "make", "can", "like", "time", "just", "him", "know", "take",
    "into", "year", "your", "good", "some", "could", "them", "see", "other", "than", "then", "now",
    "look", "only", "come", "its", "over", "think", "also", "back", "after", "use", "two", "how",
    "our", "work", "first", "well", "way", "even", "new", "want", "because", "any", "these", "give",
    "day", "most", "was", "were", "are", "had", "has", "been", "said", "very", "more", "little",
    "much", "before", "where", "own", "such", "through", "down", "should", "must", "did", "made",
    "man", "men", "here", "upon", "those", "still", "might", "never", "too", "while", "each", "many",
    "que", "las", "los", "una", "con", "por", "para", "como", "pero", "más", "mas", "este", "esta",
    "esto", "estos", "estas", "ese", "esa", "eso", "sin", "sobre", "entre", "todo", "toda", "todos",
    "todas", "muy", "ser", "era", "fue", "son", "han", "hay", "sus", "del", "nos", "cuando", "donde",
    "quien", "desde", "hasta", "porque", "aunque", "tiene", "tenía", "había", "está", "estaba",
  ]);

  var BOOKS = {
    "alice-wonderland": {
      id: "alice-wonderland",
      title: "Alice's Adventures in Wonderland",
      author: "Lewis Carroll",
      length: "~2 h 15 min",
      estimates: { beginner: 81, intermediate: 89, advanced: 96 },
      words: [
        { word: "waistcoat", pos: "sustantivo", gloss: "chaleco" },
        { word: "hedge", pos: "sustantivo", gloss: "seto vivo o arbusto" },
        { word: "tunnel", pos: "sustantivo", gloss: "túnel o pasadizo" },
        { word: "cupboard", pos: "sustantivo", gloss: "alacena o armario" },
        { word: "marmalade", pos: "sustantivo", gloss: "mermelada de naranja" },
        { word: "curious", pos: "adjetivo", gloss: "curioso o extraño" },
        { word: "telescope", pos: "sustantivo", gloss: "catalejo o telescopio" },
        { word: "label", pos: "sustantivo", gloss: "etiqueta" },
        { word: "ventured", pos: "verbo", gloss: "se atrevió" },
        { word: "candle", pos: "sustantivo", gloss: "vela" },
      ],
    },
    "christmas-carol": {
      id: "christmas-carol",
      title: "A Christmas Carol",
      author: "Charles Dickens",
      length: "~2 h 30 min",
      estimates: { beginner: 78, intermediate: 87, advanced: 95 },
      words: [
        { word: "ironmongery", pos: "sustantivo", gloss: "ferretería" },
        { word: "covetous", pos: "adjetivo", gloss: "codicioso, avaro" },
        { word: "flint", pos: "sustantivo", gloss: "pedernal" },
        { word: "frost", pos: "sustantivo", gloss: "escarcha" },
        { word: "clerk", pos: "sustantivo", gloss: "empleado de oficina" },
        { word: "counting-house", pos: "sustantivo", gloss: "despacho contable" },
        { word: "hearth", pos: "sustantivo", gloss: "chimenea, hogar" },
        { word: "humbug", pos: "sustantivo", gloss: "farsa o patraña" },
        { word: "charitable", pos: "adjetivo", gloss: "caritativo" },
        { word: "knocker", pos: "sustantivo", gloss: "aldaba de puerta" },
      ],
    },
    "call-of-the-wild": {
      id: "call-of-the-wild",
      title: "The Call of the Wild",
      author: "Jack London",
      length: "~2 h 45 min",
      estimates: { beginner: 80, intermediate: 89, advanced: 96 },
      words: [
        { word: "prospectors", pos: "sustantivo", gloss: "buscadores de oro" },
        { word: "arctic", pos: "adjetivo", gloss: "ártico" },
        { word: "domain", pos: "sustantivo", gloss: "territorio o dominio" },
        { word: "veranda", pos: "sustantivo", gloss: "porche abierto" },
        { word: "kennel", pos: "sustantivo", gloss: "perrera" },
        { word: "orchard", pos: "sustantivo", gloss: "huerta de frutales" },
        { word: "paddock", pos: "sustantivo", gloss: "potrero o corral" },
        { word: "stately", pos: "adjetivo", gloss: "majestuoso, sereno" },
        { word: "leash", pos: "sustantivo", gloss: "correa" },
        { word: "treachery", pos: "sustantivo", gloss: "traición" },
      ],
    },
    "tom-sawyer": {
      id: "tom-sawyer",
      title: "The Adventures of Tom Sawyer",
      author: "Mark Twain",
      length: "~6 h",
      estimates: { beginner: 79, intermediate: 88, advanced: 95 },
      words: [
        { word: "spectacles", pos: "sustantivo", gloss: "anteojos" },
        { word: "pantry", pos: "sustantivo", gloss: "despensa" },
        { word: "switch", pos: "sustantivo", gloss: "vara flexible" },
        { word: "vanish", pos: "verbo", gloss: "desaparecer" },
        { word: "whittle", pos: "verbo", gloss: "tallar madera con navaja" },
        { word: "whitewash", pos: "verbo", gloss: "encalar o pintar de blanco" },
        { word: "fence", pos: "sustantivo", gloss: "cerca o valla" },
        { word: "hookey", pos: "sustantivo", gloss: "faltar a clases" },
        { word: "dreadful", pos: "adjetivo", gloss: "terrible, espantoso" },
        { word: "reluctant", pos: "adjetivo", gloss: "reacio" },
      ],
    },
    "jekyll-hyde": {
      id: "jekyll-hyde",
      title: "Dr Jekyll and Mr Hyde",
      author: "Robert Louis Stevenson",
      length: "~2 h 15 min",
      estimates: { beginner: 75, intermediate: 85, advanced: 94 },
      words: [
        { word: "rugged", pos: "adjetivo", gloss: "tosco, curtido" },
        { word: "countenance", pos: "sustantivo", gloss: "semblante o rostro" },
        { word: "austere", pos: "adjetivo", gloss: "austero, sobrio" },
        { word: "reputable", pos: "adjetivo", gloss: "respetable" },
        { word: "gable", pos: "sustantivo", gloss: "hastial o muro alto" },
        { word: "blistered", pos: "adjetivo", gloss: "ampollado o descascarado" },
        { word: "by-street", pos: "sustantivo", gloss: "callejuela" },
        { word: "trampled", pos: "verbo", gloss: "pisoteó" },
        { word: "juggernaut", pos: "sustantivo", gloss: "fuerza imparable" },
        { word: "ransom", pos: "sustantivo", gloss: "rescate" },
      ],
    },
    "picture-dorian-gray": {
      id: "picture-dorian-gray",
      title: "The Picture of Dorian Gray",
      author: "Oscar Wilde",
      length: "~6 h 30 min",
      estimates: { beginner: 73, intermediate: 84, advanced: 93 },
      words: [
        { word: "studio", pos: "sustantivo", gloss: "taller de artista" },
        { word: "fragrance", pos: "sustantivo", gloss: "fragancia" },
        { word: "divan", pos: "sustantivo", gloss: "diván o sofá bajo" },
        { word: "easel", pos: "sustantivo", gloss: "caballete de pintura" },
        { word: "portrait", pos: "sustantivo", gloss: "retrato" },
        { word: "cynical", pos: "adjetivo", gloss: "cínico" },
        { word: "vanity", pos: "sustantivo", gloss: "vanidad" },
        { word: "languid", pos: "adjetivo", gloss: "lánguido, pausado" },
        { word: "exquisite", pos: "adjetivo", gloss: "exquisito" },
        { word: "intellect", pos: "sustantivo", gloss: "intelecto" },
      ],
    },
    frankenstein: {
      id: "frankenstein",
      title: "Frankenstein",
      author: "Mary Shelley",
      length: "~6 h 15 min",
      estimates: { beginner: 70, intermediate: 81, advanced: 91 },
      words: [
        { word: "enterprise", pos: "sustantivo", gloss: "empresa o expedición" },
        { word: "foreboding", pos: "sustantivo", gloss: "presagio sombrío" },
        { word: "frost", pos: "sustantivo", gloss: "helada" },
        { word: "perpetual", pos: "adjetivo", gloss: "perpetuo, continuo" },
        { word: "solitude", pos: "sustantivo", gloss: "soledad" },
        { word: "ardour", pos: "sustantivo", gloss: "ardor, entusiasmo" },
        { word: "zeal", pos: "sustantivo", gloss: "celo o empeño" },
        { word: "navigators", pos: "sustantivo", gloss: "navegantes" },
        { word: "ambition", pos: "sustantivo", gloss: "ambición" },
        { word: "wretch", pos: "sustantivo", gloss: "ser desdichado" },
      ],
    },
  };

  function decodeEntities(text) {
    return String(text || "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&apos;|&#39;/gi, "'")
      .replace(/&#(\d+);/g, function (_m, dec) {
        var code = Number(dec);
        return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
      })
      .replace(/&#x([0-9a-f]+);/gi, function (_m, hex) {
        var code = parseInt(hex, 16);
        return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
      });
  }

  function stripHtmlToText(html) {
    var cleaned = String(html || "")
      .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|blockquote|br|tr)>/gi, " ")
      .replace(/<[^>]+>/g, " ");
    return decodeEntities(cleaned).replace(/\s+/g, " ").trim();
  }

  function parseXmlAttrs(tag) {
    var attrs = {};
    var re = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    var match;
    while ((match = re.exec(tag)) !== null) {
      attrs[match[1]] = match[2] !== undefined ? match[2] : match[3] || "";
    }
    return attrs;
  }

  function resolveZipPath(baseDir, href) {
    var cleanHref = decodeEntities(String(href || "").split("#")[0].split("?")[0]);
    try {
      cleanHref = decodeURIComponent(cleanHref);
    } catch {
      // mantener href si trae escapes malformados
    }
    var combined = (baseDir ? baseDir + "/" : "") + cleanHref;
    var parts = combined.split("/");
    var stack = [];
    for (var i = 0; i < parts.length; i += 1) {
      var seg = parts[i];
      if (!seg || seg === ".") continue;
      if (seg === "..") {
        if (stack.length > 0) stack.pop();
      } else {
        stack.push(seg);
      }
    }
    return stack.join("/");
  }

  function parseZipIndex(buffer) {
    var view = new DataView(buffer);
    var len = view.byteLength;
    if (len < 22) {
      throw new Error("El archivo no parece ser un EPUB válido.");
    }
    var minOffset = Math.max(0, len - 65558);
    var eocdOffset = -1;
    for (var i = len - 22; i >= minOffset; i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset < 0) {
      throw new Error("El archivo no parece ser un EPUB válido.");
    }
    var entryCount = view.getUint16(eocdOffset + 10, true);
    var cdOffset = view.getUint32(eocdOffset + 16, true);
    if (entryCount === 0 || cdOffset + 46 > len) {
      throw new Error("El archivo no parece ser un EPUB válido.");
    }

    var decoder = new TextDecoder("utf-8");
    var entries = new Map();
    var cursor = cdOffset;
    for (var idx = 0; idx < entryCount && cursor + 46 <= eocdOffset; idx += 1) {
      if (view.getUint32(cursor, true) !== 0x02014b50) break;
      var method = view.getUint16(cursor + 10, true);
      var compressedSize = view.getUint32(cursor + 20, true);
      var uncompressedSize = view.getUint32(cursor + 24, true);
      var nameLen = view.getUint16(cursor + 28, true);
      var extraLen = view.getUint16(cursor + 30, true);
      var commentLen = view.getUint16(cursor + 32, true);
      var localOffset = view.getUint32(cursor + 42, true);
      if (cursor + 46 + nameLen > len) break;
      var name = decoder.decode(new Uint8Array(buffer, cursor + 46, nameLen));
      entries.set(name, {
        name: name,
        method: method,
        compressedSize: compressedSize,
        uncompressedSize: uncompressedSize,
        localOffset: localOffset,
      });
      cursor += 46 + nameLen + extraLen + commentLen;
    }
    if (entries.size === 0) {
      throw new Error("El archivo no parece ser un EPUB válido.");
    }
    return entries;
  }

  function findZipEntry(entries, targetPath) {
    if (entries.has(targetPath)) return entries.get(targetPath);
    var lower = targetPath.toLowerCase();
    var found = null;
    entries.forEach(function (entry, key) {
      if (!found && key.toLowerCase() === lower) found = entry;
    });
    return found;
  }

  async function inflateRawBytes(compressedBytes) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("Tu navegador no soporta descompresión local de EPUB.");
    }
    var stream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    var ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  }

  async function readZipEntryBytes(buffer, entry, inflateFn) {
    var view = new DataView(buffer);
    var offset = entry.localOffset;
    if (offset + 30 > view.byteLength || view.getUint32(offset, true) !== 0x04034b50) {
      throw new Error("El EPUB tiene una entrada dañada o ilegible.");
    }
    var nameLen = view.getUint16(offset + 26, true);
    var extraLen = view.getUint16(offset + 28, true);
    var dataStart = offset + 30 + nameLen + extraLen;
    var dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > view.byteLength) {
      throw new Error("El EPUB está truncado o incompleto.");
    }
    var slice = new Uint8Array(buffer, dataStart, entry.compressedSize);
    if (entry.method === 0) return slice;
    if (entry.method === 8) {
      return typeof inflateFn === "function" ? inflateFn(slice) : inflateRawBytes(slice);
    }
    throw new Error("Método de compresión de EPUB no compatible.");
  }

  function formatDurationMinutes(totalWords) {
    if (!totalWords || totalWords <= 0) return null;
    var mins = Math.max(1, Math.round(totalWords / 220));
    if (mins < 60) return "~" + mins + " min";
    var hours = Math.floor(mins / 60);
    var rem = Math.round((mins % 60) / 15) * 15;
    if (rem === 60) {
      hours += 1;
      rem = 0;
    }
    return rem > 0 ? "~" + hours + " h " + rem + " min" : "~" + hours + " h";
  }

  async function extractEpubSample(buffer, opts) {
    if (!buffer || buffer.byteLength === 0) {
      throw new Error("El archivo está vacío.");
    }
    if (buffer.byteLength > MAX_EPUB_BYTES) {
      throw new Error("El archivo supera el máximo de 30 MB para analizar en el navegador.");
    }
    var inflateFn = opts && opts.inflateRaw;
    var entries = parseZipIndex(buffer);
    var decoder = new TextDecoder("utf-8");

    var encryptionEntry = findZipEntry(entries, "META-INF/encryption.xml");
    if (encryptionEntry) {
      var encXml = decoder.decode(await readZipEntryBytes(buffer, encryptionEntry, inflateFn));
      var encCount = (encXml.match(/<EncryptedData\b/gi) || []).length;
      if (encCount > 0) {
        var fontObfCount = (
          encXml.match(
            /http:\/\/www\.idpf\.org\/2008\/embedding|http:\/\/ns\.adobe\.com\/pdf\/enc#RC/gi,
          ) || []
        ).length;
        if (fontObfCount < encCount) {
          throw new Error("Este EPUB tiene protección DRM y no se puede analizar.");
        }
      }
    }

    var containerEntry = findZipEntry(entries, "META-INF/container.xml");
    if (!containerEntry) {
      throw new Error("No encontramos la estructura OPF dentro de este EPUB.");
    }
    var containerXml = decoder.decode(await readZipEntryBytes(buffer, containerEntry, inflateFn));
    var opfMatch = containerXml.match(/<rootfile\b[^>]*\bfull-path\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
    var opfPath = opfMatch ? opfMatch[1] || opfMatch[2] : "";
    if (!opfPath) {
      throw new Error("No pudimos ubicar el índice de capítulos del EPUB.");
    }
    var opfEntry = findZipEntry(entries, opfPath);
    if (!opfEntry) {
      throw new Error("El archivo OPF del EPUB no existe o está dañado.");
    }
    var opfXml = decoder.decode(await readZipEntryBytes(buffer, opfEntry, inflateFn));
    var opfDir = opfPath.indexOf("/") >= 0 ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";

    var titleMatch = opfXml.match(/<(?:dc:)?title\b[^>]*>([\s\S]*?)<\/(?:dc:)?title>/i);
    var authorMatch = opfXml.match(/<(?:dc:)?creator\b[^>]*>([\s\S]*?)<\/(?:dc:)?creator>/i);
    var langMatch = opfXml.match(/<(?:dc:)?language\b[^>]*>([\s\S]*?)<\/(?:dc:)?language>/i);

    var title = titleMatch ? stripHtmlToText(titleMatch[1]).slice(0, 140) : "";
    var author = authorMatch ? stripHtmlToText(authorMatch[1]).slice(0, 120) : "";
    var rawLang = langMatch ? stripHtmlToText(langMatch[1]).toLowerCase().slice(0, 2) : "en";
    var language = rawLang === "es" ? "es" : "en";

    var manifestById = new Map();
    var itemRe = /<item\b([^>]*)\/?>/gi;
    var itemMatch;
    while ((itemMatch = itemRe.exec(opfXml)) !== null) {
      var attrs = parseXmlAttrs(itemMatch[1]);
      if (attrs.id && attrs.href) {
        manifestById.set(attrs.id, {
          href: resolveZipPath(opfDir, attrs.href),
          mediaType: attrs["media-type"] || "",
        });
      }
    }

    var spinePaths = [];
    var itemrefRe = /<itemref\b([^>]*)\/?>/gi;
    var refMatch;
    while ((refMatch = itemrefRe.exec(opfXml)) !== null) {
      var refAttrs = parseXmlAttrs(refMatch[1]);
      if (refAttrs.idref && manifestById.has(refAttrs.idref)) {
        var meta = manifestById.get(refAttrs.idref);
        if (!meta.mediaType || /html|xml/i.test(meta.mediaType)) {
          spinePaths.push(meta.href);
        }
      }
    }
    if (spinePaths.length === 0) {
      throw new Error("El EPUB no contiene capítulos legibles.");
    }

    var totalWords = 0;
    var sampleText = "";
    var fallbackText = "";
    var scanned = 0;
    for (var s = 0; s < spinePaths.length && scanned < MAX_SPINE_SCAN; s += 1) {
      var chapEntry = findZipEntry(entries, spinePaths[s]);
      if (!chapEntry) continue;
      scanned += 1;
      var html = decoder.decode(await readZipEntryBytes(buffer, chapEntry, inflateFn));
      var text = stripHtmlToText(html);
      var wordsInSection = (text.match(/[a-zA-ZÀ-ÿ'’-]+/g) || []).length;
      totalWords += wordsInSection;
      if (!sampleText && wordsInSection >= MIN_SUBSTANTIAL_CHAPTER_WORDS) {
        sampleText = text;
      }
      if (!sampleText && fallbackText.length < 10000 && wordsInSection > 0) {
        fallbackText = fallbackText ? fallbackText + " " + text : text;
      }
      if (totalWords >= MAX_TOTAL_WORDS_SCAN && sampleText) break;
    }

    var chosenText = sampleText || fallbackText;
    if (!chosenText) {
      throw new Error("No encontramos texto legible en este EPUB.");
    }

    var rawTokens = chosenText.toLowerCase().match(/[a-zA-ZÀ-ÿ'’-]+/g) || [];
    var sampleWordCounts = Object.create(null);
    var sampleTotalTokens = 0;
    for (var t = 0; t < rawTokens.length; t += 1) {
      var clean = rawTokens[t].replace(/^['’-]+|['’-]+$/g, "");
      if (clean.length < 3 || /\d/.test(clean)) continue;
      sampleTotalTokens += 1;
      sampleWordCounts[clean] = (sampleWordCounts[clean] || 0) + 1;
    }
    if (sampleTotalTokens === 0) {
      throw new Error("No pudimos leer suficientes palabras del primer capítulo.");
    }

    var candidateForms = Object.keys(sampleWordCounts)
      .filter(function (form) {
        return !COMMON_STOPWORDS.has(form);
      })
      .sort(function (a, b) {
        return sampleWordCounts[b] - sampleWordCounts[a];
      })
      .slice(0, MAX_BATCH_FORMS);

    return {
      title: title || "Tu archivo EPUB",
      author: author || "Libro en tu dispositivo",
      language: language,
      totalWords: totalWords,
      length: formatDurationMinutes(totalWords) || "Extensión por confirmar",
      sampleWordCounts: sampleWordCounts,
      sampleTotalTokens: sampleTotalTokens,
      candidateForms: candidateForms,
    };
  }

  function pickBestEntry(list) {
    if (!Array.isArray(list) || list.length === 0) return null;
    for (var i = 0; i < list.length; i += 1) {
      var item = list[i];
      if (typeof item.zipf === "number" && item.senses && item.senses[0] && item.senses[0].definition) {
        return item;
      }
    }
    for (var j = 0; j < list.length; j += 1) {
      if (typeof list[j].zipf === "number") return list[j];
    }
    return list[0];
  }

  function scoreCustomEpub(sample, entriesByForm, lvl) {
    var threshold = LEVEL_THRESHOLDS[lvl] || LEVEL_THRESHOLDS.intermediate;
    var counts = sample.sampleWordCounts || {};
    var forms = Object.keys(counts);
    var measuredWeight = 0;
    var knownWeight = 0;
    var candidates = [];

    for (var i = 0; i < forms.length; i += 1) {
      var form = forms[i];
      var weight = counts[form];
      if (COMMON_STOPWORDS.has(form)) {
        measuredWeight += weight;
        knownWeight += weight;
        continue;
      }
      var entry = entriesByForm ? pickBestEntry(entriesByForm[form]) : null;
      if (entry && typeof entry.zipf === "number" && Number.isFinite(entry.zipf)) {
        measuredWeight += weight;
        if (entry.zipf >= threshold) {
          knownWeight += weight;
        } else {
          var gloss =
            entry.senses && entry.senses[0] && entry.senses[0].definition
              ? String(entry.senses[0].definition).trim()
              : "";
          candidates.push({
            word: form,
            lemma: entry.lemma || form,
            pos: entry.pos || "palabra",
            gloss: gloss,
            zipf: entry.zipf,
            weight: weight,
          });
        }
      }
    }

    var usedFallback = measuredWeight < 30;
    var percent;
    if (usedFallback) {
      var fallbackByLevel = { beginner: 74, intermediate: 85, advanced: 93 };
      percent = fallbackByLevel[lvl] || 85;
    } else {
      percent = Math.max(40, Math.min(99, Math.round((knownWeight / measuredWeight) * 100)));
    }

    candidates.sort(function (a, b) {
      var aHasGloss = a.gloss ? 1 : 0;
      var bHasGloss = b.gloss ? 1 : 0;
      if (aHasGloss !== bHasGloss) return bHasGloss - aHasGloss;
      var distA = Math.abs(threshold - a.zipf);
      var distB = Math.abs(threshold - b.zipf);
      if (distA !== distB) return distA - distB;
      return b.weight - a.weight;
    });

    var seenLemmas = new Set();
    var topWords = [];
    for (var k = 0; k < candidates.length && topWords.length < 10; k += 1) {
      var item = candidates[k];
      var key = String(item.lemma || item.word).toLowerCase();
      if (seenLemmas.has(key)) continue;
      seenLemmas.add(key);
      topWords.push({
        word: item.word,
        pos: item.pos,
        gloss: item.gloss || "Consúltala con un toque al abrir el libro en Lecta.",
      });
    }

    return {
      percent: percent,
      words: topWords,
      usedFallback: usedFallback,
    };
  }

  function verdictFor(pct) {
    if (pct >= COVERAGE_FLUID_MIN) {
      return { text: "Ideal para leer fluido", tone: "fluid", bar: "var(--sage)" };
    }
    if (pct >= COVERAGE_IDEAL_MIN) {
      return { text: "Buen reto con ayudas", tone: "ideal", bar: "var(--ochre)" };
    }
    return { text: "Lectura exigente", tone: "challenge", bar: "var(--vermilion)" };
  }

  function computePercentFromManifest(manifest, lvl) {
    if (!manifest || !Array.isArray(manifest.entries) || manifest.entries.length === 0) {
      return null;
    }
    var threshold = LEVEL_THRESHOLDS[lvl] || LEVEL_THRESHOLDS.intermediate;
    var measured = 0;
    var known = 0;
    for (var i = 0; i < manifest.entries.length; i += 1) {
      var zipf = manifest.entries[i] && manifest.entries[i].zipf;
      if (typeof zipf === "number" && Number.isFinite(zipf)) {
        measured += 1;
        if (zipf >= threshold) known += 1;
      }
    }
    if (measured < 20) return null;
    return Math.max(40, Math.min(99, Math.round((known / measured) * 100)));
  }

  var exportedHelpers = {
    parseZipIndex: parseZipIndex,
    readZipEntryBytes: readZipEntryBytes,
    extractEpubSample: extractEpubSample,
    scoreCustomEpub: scoreCustomEpub,
    computePercentFromManifest: computePercentFromManifest,
  };
  if (typeof globalThis !== "undefined") {
    globalThis.__LECTA_NIVEL_HELPERS__ = exportedHelpers;
  }

  if (typeof document === "undefined") {
    return;
  }

  function resolveNivelSource() {
    try {
      if (typeof sessionStorage !== "undefined") {
        var kept = sessionStorage.getItem("lecta:nivel-src");
        if (kept) return kept;
      }
    } catch {
      /* sin almacenamiento */
    }
    var src = "";
    try {
      if (typeof location !== "undefined") {
        src = new URLSearchParams(location.search).get("utm_source") || "";
        if (!src && document.referrer) {
          var host = new URL(document.referrer).hostname;
          if (host !== location.hostname) src = host;
        }
      }
    } catch {
      /* referrer o URL ilegible */
    }
    src =
      src
        .trim()
        .toLowerCase()
        .replace(/^www\./, "")
        .replace(/[^a-z0-9._-]/g, "")
        .slice(0, 32) || "direct";
    try {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem("lecta:nivel-src", src);
      }
    } catch {
      /* sin almacenamiento */
    }
    return src;
  }

  var nivelSource = resolveNivelSource();
  function trackNivel(event) {
    var body = JSON.stringify({ event: event, source: nivelSource });
    try {
      if (typeof navigator !== "undefined" && navigator.sendBeacon && navigator.sendBeacon("/api/landing-events", body)) {
        return;
      }
      if (typeof fetch === "function") {
        fetch("/api/landing-events", { method: "POST", body: body, keepalive: true }).catch(function () {});
      }
    } catch {
      /* medir nunca rompe la página */
    }
  }

  var level = "intermediate";
  var selectedId = "alice-wonderland";
  var vocabCache = new Map();
  var customEpub = null;

  var titleEl = document.getElementById("resultBookTitle");
  var metaEl = document.getElementById("resultBookMeta");
  var pctEl = document.getElementById("resultPct");
  var verdictEl = document.getElementById("resultVerdict");
  var barEl = document.getElementById("resultBar");
  var noteEl = document.getElementById("resultNote");
  var vocabListEl = document.getElementById("vocabList");
  var ctaEl = document.getElementById("tryBookCta");
  var ctaNoteEl = document.getElementById("ctaNote");
  var headerOpenEl = document.getElementById("headerOpenCta");
  var dropzoneEl = document.getElementById("epubDropzone");
  var pickBtnEl = document.getElementById("epubPickBtn");
  var fileInputEl = document.getElementById("epubFileInput");
  var epubStatusEl = document.getElementById("epubStatus");

  function setEpubStatus(text, isError) {
    if (!epubStatusEl) return;
    epubStatusEl.textContent = text || "";
    if (isError) epubStatusEl.setAttribute("data-error", "true");
    else epubStatusEl.removeAttribute("data-error");
  }

  function renderWords(words, emptyMessage) {
    if (!vocabListEl) return;
    while (vocabListEl.firstChild) {
      vocabListEl.removeChild(vocabListEl.firstChild);
    }
    if (!words || words.length === 0) {
      var emptyLi = document.createElement("li");
      emptyLi.className = "vocab-item";
      emptyLi.textContent = emptyMessage || "No encontramos palabras raras en el primer capítulo.";
      vocabListEl.appendChild(emptyLi);
      return;
    }
    for (var i = 0; i < words.length; i += 1) {
      var entry = words[i];
      var li = document.createElement("li");
      li.className = "vocab-item";

      var head = document.createElement("div");
      head.className = "vocab-item__head";

      var w = document.createElement("span");
      w.className = "vocab-item__word";
      w.lang = customEpub ? customEpub.sample.language : "en";
      w.textContent = entry.word;

      var pos = document.createElement("span");
      pos.className = "vocab-item__pos";
      pos.textContent = entry.pos;

      head.appendChild(w);
      head.appendChild(pos);

      var gloss = document.createElement("p");
      gloss.className = "vocab-item__gloss";
      gloss.textContent = entry.gloss;

      li.appendChild(head);
      li.appendChild(gloss);
      vocabListEl.appendChild(li);
    }
  }

  function syncPressed(selector, attr, activeValue) {
    var buttons = document.querySelectorAll(selector);
    for (var i = 0; i < buttons.length; i += 1) {
      var btn = buttons[i];
      btn.setAttribute("aria-pressed", btn.getAttribute(attr) === activeValue ? "true" : "false");
    }
  }

  function render() {
    if (headerOpenEl) {
      headerOpenEl.setAttribute("href", "/?src=nivel&nivel=" + encodeURIComponent(level));
    }

    if (customEpub) {
      var scored = scoreCustomEpub(customEpub.sample, customEpub.entriesByForm, level);
      var cv = verdictFor(scored.percent);
      if (titleEl) {
        titleEl.lang = customEpub.sample.language;
        titleEl.textContent = customEpub.sample.title;
      }
      if (metaEl) {
        metaEl.textContent = customEpub.sample.author + " · " + customEpub.sample.length;
      }
      if (pctEl) pctEl.textContent = "Entiendes ~" + scored.percent + " %";
      if (verdictEl) {
        verdictEl.textContent = cv.text;
        verdictEl.setAttribute("data-tone", cv.tone);
      }
      if (barEl) {
        barEl.style.width = scored.percent + "%";
        barEl.style.background = cv.bar;
      }
      if (noteEl) {
        noteEl.textContent = scored.usedFallback
          ? "Estimación local en tu navegador (sin conexión con el catálogo de definiciones)."
          : "Calculado 100 % en tu navegador sobre el primer capítulo de tu EPUB; tu archivo no salió de este dispositivo.";
      }
      if (ctaEl) {
        ctaEl.textContent = "Abrir Lecta";
        ctaEl.setAttribute("href", "/?src=nivel&nivel=" + encodeURIComponent(level));
      }
      if (ctaNoteEl) {
        ctaNoteEl.textContent =
          "Arrastra este mismo archivo al entrar a Lecta: es gratis y tu nivel inicial ya quedará ajustado.";
      }
      renderWords(
        scored.words,
        scored.usedFallback
          ? "Conéctate un momento para cargar definiciones del capítulo 1 de este EPUB."
          : "Casi todo el primer capítulo cae dentro de tu nivel actual.",
      );
      return;
    }

    var book = BOOKS[selectedId] || BOOKS["alice-wonderland"];
    var cached = vocabCache.get(book.id);
    var livePct = computePercentFromManifest(cached, level);
    var pct = livePct !== null ? livePct : book.estimates[level] || 85;
    var v = verdictFor(pct);

    if (titleEl) {
      titleEl.lang = "en";
      titleEl.textContent = book.title;
    }
    if (metaEl) metaEl.textContent = book.author + " · " + book.length;
    if (pctEl) pctEl.textContent = "Entiendes ~" + pct + " %";
    if (verdictEl) {
      verdictEl.textContent = v.text;
      verdictEl.setAttribute("data-tone", v.tone);
    }
    if (barEl) {
      barEl.style.width = pct + "%";
      barEl.style.background = v.bar;
    }
    if (noteEl) {
      noteEl.textContent =
        livePct !== null
          ? "Calculado sobre el manifiesto léxico real de este clásico. Al abrirlo en Lecta puedes tocar cualquier palabra para ver su sentido en la frase."
          : "Estimación sobre el vocabulario del libro. Al abrirlo en Lecta puedes tocar cualquier palabra para ver su sentido en la frase.";
    }
    if (ctaEl) {
      ctaEl.textContent = "Leer gratis en Lecta";
      ctaEl.setAttribute(
        "href",
        "/?probar=" +
          encodeURIComponent(book.id) +
          "&src=nivel&nivel=" +
          encodeURIComponent(level),
      );
    }
    if (ctaNoteEl) {
      ctaNoteEl.textContent = "Se abre directo en tu navegador, gratis y sin tarjeta.";
    }
    renderWords(book.words);
  }

  function fetchVocab(bookId) {
    if (vocabCache.has(bookId) || typeof fetch !== "function") return;
    fetch("/api/catalog/" + encodeURIComponent(bookId) + "/vocab")
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (!data) return;
        vocabCache.set(bookId, data);
        if (!customEpub && selectedId === bookId) render();
      })
      .catch(function () {
        // Mantiene la estimación curada sin interrumpir la página pública.
      });
  }

  async function handleEpubFile(file) {
    if (!file) return;
    if (!/\.epub$/i.test(file.name || "") && file.type !== "application/epub+zip") {
      setEpubStatus("Elige un archivo con extensión .epub.", true);
      return;
    }
    setEpubStatus("Analizando primer capítulo en tu navegador…", false);
    try {
      var buffer = await file.arrayBuffer();
      var sample = await extractEpubSample(buffer);
      var entriesByForm = {};
      if (typeof fetch === "function" && sample.candidateForms.length > 0) {
        try {
          var res = await fetch("/api/lexicon/batch", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ forms: sample.candidateForms, language: sample.language }),
          });
          if (res.ok) {
            var body = await res.json();
            if (body && body.entries) entriesByForm = body.entries;
          }
        } catch {
          // Falla silenciosa hacia estimación local sin conexión.
        }
      }
      customEpub = { sample: sample, entriesByForm: entriesByForm };
      trackNivel("nivel:epub");
      syncPressed("[data-book]", "data-book", "");
      setEpubStatus("Listo: «" + sample.title + "» analizado localmente.", false);
      render();
    } catch (err) {
      setEpubStatus(
        err instanceof Error ? err.message : "No pudimos analizar este archivo EPUB.",
        true,
      );
    }
  }

  var levelButtons = document.querySelectorAll("[data-level]");
  for (var i = 0; i < levelButtons.length; i += 1) {
    levelButtons[i].addEventListener("click", function (ev) {
      var next = ev.currentTarget && ev.currentTarget.getAttribute("data-level");
      if (!next || !LEVEL_THRESHOLDS[next]) return;
      level = next;
      syncPressed("[data-level]", "data-level", level);
      render();
    });
  }

  var bookButtons = document.querySelectorAll("[data-book]");
  for (var j = 0; j < bookButtons.length; j += 1) {
    bookButtons[j].addEventListener("click", function (ev) {
      var next = ev.currentTarget && ev.currentTarget.getAttribute("data-book");
      if (!next || !BOOKS[next]) return;
      customEpub = null;
      setEpubStatus("", false);
      selectedId = next;
      syncPressed("[data-book]", "data-book", selectedId);
      render();
      fetchVocab(selectedId);
    });
  }

  if (pickBtnEl && fileInputEl) {
    pickBtnEl.addEventListener("click", function () {
      fileInputEl.click();
    });
    fileInputEl.addEventListener("change", function () {
      var picked = fileInputEl.files && fileInputEl.files[0];
      if (picked) void handleEpubFile(picked);
      fileInputEl.value = "";
    });
  }

  if (dropzoneEl) {
    dropzoneEl.addEventListener("dragover", function (ev) {
      ev.preventDefault();
      dropzoneEl.setAttribute("data-dragging", "true");
    });
    dropzoneEl.addEventListener("dragleave", function () {
      dropzoneEl.setAttribute("data-dragging", "false");
    });
    dropzoneEl.addEventListener("drop", function (ev) {
      ev.preventDefault();
      dropzoneEl.setAttribute("data-dragging", "false");
      var dropped = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (dropped) void handleEpubFile(dropped);
    });
  }

  if (ctaEl) {
    ctaEl.addEventListener("click", function () {
      trackNivel("nivel:cta");
    });
  }
  if (headerOpenEl) {
    headerOpenEl.addEventListener("click", function () {
      trackNivel("nivel:cta");
    });
  }

  trackNivel("nivel:view");
  render();
  fetchVocab(selectedId);
})();
