#!/usr/bin/env node
// Lista las variables libres de un rango de líneas de un .tsx/.ts: las que el
// bloque usa pero no declara dentro. Sirve para saber qué props necesita un
// componente extraído antes de escribirlo.
//
//   node scripts/find-free-vars.mjs src/client/components/Reader.tsx 4233 4345
//
// El rango debe caer dentro de un único nodo del AST (un elemento JSX, una
// función, un bloque). Si no, avisa en vez de devolver el archivo entero.
import fs from "node:fs";
import ts from "typescript";

const [file, startArg, endArg] = process.argv.slice(2);
if (!file || !startArg || !endArg) {
  console.error("Uso: node scripts/find-free-vars.mjs <archivo.tsx> <líneaInicio> <líneaFin>");
  process.exit(2);
}
const startLine = Number(startArg);
const endLine = Number(endArg);

const source = fs.readFileSync(file, "utf8");
const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;

let target = null;
function locate(node) {
  const start = lineOf(node.getStart(sf));
  const end = lineOf(node.getEnd());
  if (start <= startLine && end >= endLine) {
    if (!target || node.getWidth() < target.getWidth()) target = node;
  }
  ts.forEachChild(node, locate);
}
locate(sf);

if (!target) {
  console.error("Ningún nodo cubre ese rango. Ajusta las líneas a un bloque completo.");
  process.exit(1);
}
if (lineOf(target.getStart(sf)) !== startLine || lineOf(target.getEnd()) !== endLine) {
  console.error(
    `Aviso: el nodo que cubre el rango va de la línea ${lineOf(target.getStart(sf))} a la ` +
      `${lineOf(target.getEnd())}; se usará ese bloque completo.`,
  );
}

const declared = new Set();
const used = new Map();

function isDeclarationName(node) {
  const parent = node.parent;
  return (
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && parent.name === node)
  );
}

function walk(node) {
  if (ts.isIdentifier(node)) {
    const parent = node.parent;
    const isPropertyName =
      parent &&
      (ts.isPropertyAccessExpression(parent) ||
        ts.isPropertyAssignment(parent) ||
        ts.isJsxAttribute(parent) ||
        ts.isJsxSelfClosingElement(parent) ||
        ts.isJsxOpeningElement(parent)) &&
      parent.name === node;
    if (isDeclarationName(node)) {
      declared.add(node.text);
    } else if (!isPropertyName && !used.has(node.text)) {
      used.set(node.text, node.getStart(sf));
    }
    return;
  }
  ts.forEachChild(node, walk);
}
walk(target);

// Nombres que no son props: etiquetas JSX, globales y literales.
const IGNORED = new Set(
  (
    "div span button a p ul li h1 h2 h3 h4 em strong svg path section label input select option " +
    "textarea table tr td th tbody thead br hr img small code pre sup sub b i u s nav header " +
    "footer aside main article form fieldset legend figure figcaption time mark abbr cite q " +
    "blockquote dl dt dd ol caption output progress meter dialog style script title window " +
    "document Array Date Math Object String Number Boolean JSON Promise Map Set WeakMap Infinity " +
    "undefined null true false const let var if else return"
  ).split(" "),
);

const free = [...used.keys()].filter((name) => !declared.has(name) && !IGNORED.has(name)).sort();
console.log(JSON.stringify({ start: lineOf(target.getStart(sf)), end: lineOf(target.getEnd()), free }, null, 2));
