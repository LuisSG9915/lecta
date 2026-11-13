(() => {
  document.documentElement.classList.add("js");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---------- Elegir gato ---------- */
  const APP = "https://lecta.luis-sg9915.workers.dev/";
  const picks = $$('input[name="gato"]');
  // El pelaje solo viaja a la app (?gato= y lecta:gato) si la persona lo
  // eligió: al cargar la página no se guarda nada ni se reescribe ningún
  // enlace, para que la app ofrezca el selector a quien no eligió.
  function setCoat(coat, announce) {
    const input = picks.find(i => i.value === coat) || picks[0];
    input.checked = true;
    const name = input.dataset.name;
    $$("img[data-stage]").forEach(im => { im.src = `web/gato-${input.value}-${im.dataset.stage}.webp`; });
    $("#pickCta").textContent = "Empezar con " + name;
    if (!announce) return;
    $$("a[data-cta]").forEach(a => { a.href = `${APP}?gato=${input.value}`; });
    $$("a[data-cta-plus]").forEach(a => { a.href = `${APP}?gato=${input.value}&carne=1`; });
    if (announce) {
      $("#bubble").textContent = `Hola, soy ${name}. Yo te acompaño mientras lees.`;
      const tile = input.closest(".pick");
      tile.classList.remove("hop"); void tile.offsetWidth; tile.classList.add("hop");
    }
    try { localStorage.setItem("lecta:gato", input.value); } catch { /* sin almacenamiento: la elección vale solo en esta visita */ }
  }
  picks.forEach(i => i.addEventListener("change", () => setCoat(i.value, true)));
  let storedCoat = null;
  try { storedCoat = localStorage.getItem("lecta:gato"); } catch { /* sin almacenamiento */ }
  setCoat(storedCoat || "ginger", Boolean(storedCoat));

  /* ---------- Botón fijo en celular ---------- */
  const sticky = $("#stickyCta");
  new IntersectionObserver(([e]) => {
    const on = !e.isIntersecting && e.boundingClientRect.top < 0;
    sticky.classList.toggle("is-on", on);
    sticky.setAttribute("aria-hidden", !on);
    $("a", sticky).tabIndex = on ? 0 : -1;
  }).observe($(".hero__cta"));

  /* ---------- Navegación pegada ---------- */
  const nav = $("#nav");
  const onScrollNav = () => nav.classList.toggle("is-stuck", scrollY > 8);
  addEventListener("scroll", onScrollNav, { passive: true }); onScrollNav();

  /* ---------- Ficha de palabra ---------- */
  const DICT = {
    membrillo: { pos: "sustantivo", def: "Fruto amarillo y muy aromático del árbol del mismo nombre; con él se hace el ate.", quote: "La casa olía a <b>membrillo</b> y a lluvia vieja.", here: "Aquí no hay fruta a la vista: es un olor, y ese olor pinta una casa vieja, dulce y cerrada." },
    perenne: { pos: "adjetivo", def: "Que dura siempre o por mucho tiempo; que no pierde la hoja.", quote: "…un naranjo <b>perenne</b> seguía verde contra el invierno…", here: "Además de la botánica, el naranjo resiste: la palabra le da al árbol algo de terquedad." },
    terco: { pos: "adjetivo", def: "Que se mantiene firme en una idea o actitud aunque haya razones para cambiarla.", quote: "…seguía verde contra el invierno, <b>terco</b>, como si nadie le hubiera avisado del frío.", here: "Se lo dice a un árbol como a una persona: el naranjo se niega a aceptar el invierno." },
  };
  const BUBBLES = ["¡Esa es buena! Va a tu Herbario.", "Otra más. Ya casi crezco.", "Tres palabras y ni saliste de la página."];
  const saved = new Set();
  const ficha = $("#ficha"), wrap = $(".page-wrap");
  let current = null, opener = null;

  function openFicha(btn) {
    const w = btn.dataset.w, d = DICT[w];
    $$(".w").forEach(b => b.setAttribute("aria-expanded", b === btn));
    btn.classList.remove("hint");
    current = w; opener = btn;
    $("#fichaPos").textContent = d.pos;
    $("#fichaWord").textContent = w;
    $("#fichaDef").textContent = d.def;
    $("#fichaQuote").innerHTML = "«" + d.quote + "»";
    const here = $("#fichaHere");
    here.classList.remove("is-on");
    here.innerHTML = d.here + "<small>Así responde «¿Qué significa aquí?» en Lecta+.</small>";
    syncSave();
    if (matchMedia("(min-width: 40.01rem)").matches) {
      const r = btn.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      ficha.style.top = (r.bottom - wr.top + 12) + "px";
    } else ficha.style.top = "";
    ficha.classList.add("is-open");
    $("#fichaSave").focus({ preventScroll: true });
  }
  function closeFicha() {
    if (!ficha.classList.contains("is-open")) return;
    ficha.classList.remove("is-open");
    $$(".w").forEach(b => b.setAttribute("aria-expanded", "false"));
    if (opener) opener.focus({ preventScroll: true });
    current = null;
  }
  function syncSave() {
    const s = $("#fichaSave"), on = saved.has(current);
    s.classList.toggle("is-saved", on);
    s.querySelector("span").textContent = on ? "Guardada" : "Guardar";
    s.setAttribute("aria-pressed", on);
  }
  $$(".w").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); if (b.getAttribute("aria-expanded") === "true") closeFicha(); else openFicha(b); }));
  $(".ficha__close").addEventListener("click", closeFicha);
  $("#fichaWhy").addEventListener("click", () => $("#fichaHere").classList.add("is-on"));
  document.addEventListener("click", e => { if (!ficha.contains(e.target)) closeFicha(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeFicha(); });

  $("#fichaSave").addEventListener("click", e => {
    if (!current || saved.has(current)) return;
    saved.add(current);
    opener.classList.add("is-saved");
    syncSave();
    const count = $("#savedCount");
    if (!reduce) {
      const from = e.currentTarget.getBoundingClientRect(), to = count.getBoundingClientRect();
      const fly = document.createElement("span");
      fly.className = "fly"; fly.textContent = current;
      document.body.append(fly);
      fly.animate([
        { transform: `translate(${from.left}px,${from.top}px) scale(1)`, opacity: 1 },
        { transform: `translate(${(from.left + to.left) / 2}px,${Math.min(from.top, to.top) - 80}px) scale(.9)`, opacity: 1, offset: .5 },
        { transform: `translate(${to.left}px,${to.top}px) scale(.4)`, opacity: 0 }
      ], { duration: 750, easing: "cubic-bezier(.5,0,.3,1)" }).onfinish = () => fly.remove();
    }
    setTimeout(() => {
      count.querySelector(".n").textContent = saved.size;
      count.classList.remove("bump"); void count.offsetWidth; count.classList.add("bump");
    }, reduce ? 0 : 700);
    $("#bubble").textContent = BUBBLES[Math.min(saved.size, 3) - 1];
    addPlant(current, DICT[current].pos, true);
  });

  /* ---------- Herbario ---------- */
  const COLORS = [["#b85a3c", "#9e3a23", "#e8835f"], ["#5d8a63", "#2f4f39", null], ["#8eaab6", "#3f5a63", "#f3efe2"], ["#d2a63c", "#7a5a12", null], ["#4f7a5a", "#24382b", "#b8432a"]];
  const plants = $("#plants");
  let plantIx = 0;
  function plantSVG(i) {
    const [leaf, stem, bloom] = COLORS[i % COLORS.length];
    const lean = [-6, 4, -2, 7, -4][i % 5];
    const top = 18 + (i % 3) * 8;
    const d = `M60 200 C ${58 + lean} 150, ${62 - lean} 90, ${60 + lean * 1.6} ${top}`;
    let leaves = "";
    const n = 6 + (i % 3);
    for (let k = 0; k < n; k++) {
      const t = 0.18 + (k / n) * 0.72;
      const y = 200 - t * (200 - top);
      const x = 60 + lean * t * 1.2;
      const side = k % 2 ? 1 : -1;
      const s = 1 - t * 0.45;
      leaves += `<path class="leaf" style="--o:${side > 0 ? "0% 50%" : "100% 50%"};transition-delay:${0.25 + k * 0.08}s" d="M${x} ${y} q ${side * 16 * s} ${-14 * s} ${side * 34 * s} ${-6 * s} q ${-side * 14 * s} ${14 * s} ${-side * 34 * s} ${6 * s}z" fill="${leaf}" opacity=".92"/>`;
    }
    const b = bloom ? `<g class="bloom" style="--o:50% 50%;transition-delay:${0.3 + n * 0.08}s">${[0, 72, 144, 216, 288].map(a => `<ellipse cx="${60 + lean * 1.6}" cy="${top - 9}" rx="5" ry="10" fill="${bloom}" transform="rotate(${a} ${60 + lean * 1.6} ${top})"/>`).join("")}<circle cx="${60 + lean * 1.6}" cy="${top}" r="3.6" fill="#d4a43a"/></g>` : "";
    return `<svg viewBox="0 0 120 210" aria-hidden="true"><path class="stem" d="${d}" stroke="${stem}" stroke-width="2.2" fill="none" style="--len:220"/>${leaves}${b}<rect x="40" y="150" width="40" height="12" fill="#e9cf86" opacity=".7" transform="rotate(${lean / 2} 60 156)"/></svg>`;
  }
  function addPlant(word, pos, isNew) {
    if ($(`.plant[data-w="${word}"]`, plants)) return;
    const el = document.createElement("div");
    el.className = "plant" + (isNew ? " is-new" : "");
    el.dataset.w = word; el.setAttribute("role", "listitem");
    el.innerHTML = plantSVG(plantIx) + `<div class="tag" style="--rot:${[-2, 1.5, -1, 2, -1.5][plantIx % 5]}deg"><b>${word}</b><small>${pos}</small></div>`;
    plantIx++;
    if (isNew) plants.prepend(el); else plants.append(el);
    if (plantsVisible || reduce) requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("is-grown")));
    if (isNew) $("#herbFoot").textContent = `Ya tienes ${saved.size} ${saved.size === 1 ? "palabra tuya" : "palabras tuyas"} aquí. En Lecta guardas todas las que quieras.`;
  }
  let plantsVisible = false;
  [["arrebol", "sustantivo"], ["sosiego", "sustantivo"], ["bruma", "sustantivo"], ["linde", "sustantivo"], ["desvelo", "sustantivo"]].forEach(([w, p]) => addPlant(w, p, false));
  new IntersectionObserver((es, o) => es.forEach(e => {
    if (!e.isIntersecting) return;
    plantsVisible = true;
    $$(".plant", plants).forEach((p, i) => setTimeout(() => p.classList.add("is-grown"), reduce ? 0 : i * 140));
    o.disconnect();
  }), { threshold: .35 }).observe(plants);

  /* ---------- Repaso ---------- */
  $("#reveal").addEventListener("click", () => {
    $("#cardAnswer").hidden = false;
    const acts = $("#cardActions");
    acts.innerHTML = [["Otra vez", "10 min"], ["Bien", "4 días"], ["Fácil", "11 días"]]
      .map(([a, b], i) => `<button class="btn grade" type="button" data-g="${i}" aria-pressed="false">${a}<small>${b}</small></button>`).join("");
    $(".grade", acts).focus();
    $$(".grade", acts).forEach(g => g.addEventListener("click", () => {
      $$(".grade", acts).forEach(x => x.setAttribute("aria-pressed", x === g));
      $$("#calendar li").forEach(li => li.classList.toggle("is-next", li.dataset.g === g.dataset.g));
      let done = $(".card__done");
      if (!done) { done = document.createElement("p"); done.className = "card__done"; done.setAttribute("aria-live", "polite"); $("#card").append(done); }
      done.textContent = ["La vuelves a ver en un rato, con su frase.", "Nos vemos el jueves, perenne.", "Esta ya es casi tuya."][g.dataset.g];
    }));
  });

  /* ---------- Precios ---------- */
  const PRICES = { anual: ["$499", "MXN al año", "Son $42 al mes: ahorras $209."], mes: ["$59", "MXN al mes", "Pagas mes con mes."] };
  $$(".toggle button").forEach(b => b.addEventListener("click", () => {
    $$(".toggle button").forEach(x => x.setAttribute("aria-pressed", x === b));
    const [n, u, s] = PRICES[b.dataset.period];
    const pn = $("#priceN");
    pn.textContent = n; pn.classList.remove("swap"); void pn.offsetWidth; pn.classList.add("swap");
    $("#priceUnit").textContent = u; $("#priceSub").textContent = s;
  }));

  /* ---------- Revelado ---------- */
  const rev = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("is-in"); rev.unobserve(e.target); } }), { rootMargin: "0px 0px -10% 0px" });
  $$(".reveal").forEach(el => rev.observe(el));
  const code = $("#code");
  new IntersectionObserver((es, o) => es.forEach(e => { if (e.isIntersecting) { code.classList.add("is-on"); o.disconnect(); } }), { threshold: .6 }).observe(code);

  /* ---------- Sendero: tinta, etapas y gato ---------- */
  const trail = $("#sendero"), ink = $("#ink"), base = $("#inkBase"), drawn = $("#inkDrawn");
  const stages = $$(".stage", trail), imgs = $$("#catStack img"), dots = $$("#catDots span");
  let len = 0, nodes = [];
  function layoutInk() {
    const tr = trail.getBoundingClientRect();
    nodes = stages.map(s => { const n = $(".stage__node", s).getBoundingClientRect(); return { x: n.left - tr.left + n.width / 2, y: n.top - tr.top + n.height / 2 }; });
    const startX = matchMedia("(max-width: 60rem)").matches ? nodes[0].x : Math.max(24, nodes[0].x - 120);
    let d = `M ${startX} 0`;
    let prev = { x: startX, y: 0 };
    nodes.forEach((p, i) => {
      const sway = (i % 2 ? 1 : -1) * Math.min(60, tr.width * .05);
      d += ` C ${prev.x + sway} ${prev.y + (p.y - prev.y) * .45}, ${p.x - sway} ${p.y - (p.y - prev.y) * .45}, ${p.x} ${p.y}`;
      prev = p;
    });
    const pl = $("#precios .plans").getBoundingClientRect();
    const endY = pl.bottom - tr.top;
    d += ` L ${prev.x} ${endY}`;
    const end = $("#inkEnd"); end.setAttribute("cx", prev.x); end.setAttribute("cy", endY);
    ink.setAttribute("viewBox", `0 0 ${tr.width} ${tr.height}`);
    base.setAttribute("d", d); drawn.setAttribute("d", d);
    len = drawn.getTotalLength();
    drawn.style.strokeDasharray = len;
    drawInk();
  }
  function drawInk() {
    const tr = trail.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (innerHeight * .55 - tr.top) / tr.height));
    drawn.style.strokeDashoffset = reduce ? 0 : len * (1 - p);
    $("#inkEnd").style.opacity = p > .98 || reduce ? 1 : 0;
    let active = 1;
    stages.forEach((s, i) => {
      const r = $(".stage__node", s).getBoundingClientRect();
      const reached = r.top < innerHeight * .6;
      s.classList.toggle("is-reached", reached);
      if (reached) active = i + 1;
    });
    if (trail.dataset.stage != active) setStage(active);
    const night = trail.dataset.stage === "4" && tr.top < 0 && matchMedia("(min-width: 60.01rem)").matches;
    document.body.classList.toggle("is-night", night);
  }
  function setStage(n) {
    trail.dataset.stage = n;
    imgs.forEach((im, i) => im.classList.toggle("is-on", i === n - 1));
    dots.forEach((d, i) => d.classList.toggle("is-on", i < n));
    $("#catName").textContent = stages[n - 1].dataset.name;
  }
  let raf = 0;
  addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawInk(); }); }, { passive: true });
  addEventListener("resize", () => requestAnimationFrame(layoutInk));
  addEventListener("load", layoutInk);
  if (document.fonts) document.fonts.ready.then(layoutInk);
  new ResizeObserver(() => requestAnimationFrame(layoutInk)).observe($(".stages"));
  layoutInk();
})();
