(function () {
  "use strict";

  var COVERAGE_FLUID_MIN = 94;
  var COVERAGE_IDEAL_MIN = 86;

  var LEVEL_THRESHOLDS = {
    beginner: 4.4,
    intermediate: 3.6,
    advanced: 2.8,
  };

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

  var level = "intermediate";
  var selectedId = "alice-wonderland";
  var vocabCache = new Map();

  var titleEl = document.getElementById("resultBookTitle");
  var metaEl = document.getElementById("resultBookMeta");
  var pctEl = document.getElementById("resultPct");
  var verdictEl = document.getElementById("resultVerdict");
  var barEl = document.getElementById("resultBar");
  var noteEl = document.getElementById("resultNote");
  var vocabListEl = document.getElementById("vocabList");
  var ctaEl = document.getElementById("tryBookCta");

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

  function renderWords(words) {
    if (!vocabListEl) return;
    while (vocabListEl.firstChild) {
      vocabListEl.removeChild(vocabListEl.firstChild);
    }
    for (var i = 0; i < words.length; i += 1) {
      var entry = words[i];
      var li = document.createElement("li");
      li.className = "vocab-item";

      var head = document.createElement("div");
      head.className = "vocab-item__head";

      var w = document.createElement("span");
      w.className = "vocab-item__word";
      w.lang = "en";
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

  function render() {
    var book = BOOKS[selectedId] || BOOKS["alice-wonderland"];
    var cached = vocabCache.get(book.id);
    var livePct = computePercentFromManifest(cached, level);
    var pct = livePct !== null ? livePct : book.estimates[level] || 85;
    var v = verdictFor(pct);

    if (titleEl) titleEl.textContent = book.title;
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
      ctaEl.setAttribute("href", "/?probar=" + encodeURIComponent(book.id) + "&src=nivel");
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
        if (selectedId === bookId) render();
      })
      .catch(function () {
        // Mantiene la estimación curada sin interrumpir la página pública.
      });
  }

  function syncPressed(selector, attr, activeValue) {
    var buttons = document.querySelectorAll(selector);
    for (var i = 0; i < buttons.length; i += 1) {
      var btn = buttons[i];
      btn.setAttribute("aria-pressed", btn.getAttribute(attr) === activeValue ? "true" : "false");
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
      selectedId = next;
      syncPressed("[data-book]", "data-book", selectedId);
      render();
      fetchVocab(selectedId);
    });
  }

  render();
  fetchVocab(selectedId);
})();
