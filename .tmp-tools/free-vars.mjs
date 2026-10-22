// Lista los identificadores libres (no declarados dentro) de un rango de líneas
// de un .tsx, para saber qué props necesita un bloque al extraerlo.
import ts from "typescript";
import fs from "node:fs";

const [file, startLine, endLine] = process.argv.slice(2);
const source = fs.readFileSync(file, "utf8");
const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function lineOf(pos) {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

let target = null;
function visit(node) {
  const start = lineOf(node.getStart(sf));
  const end = lineOf(node.getEnd());
  if (start <= Number(startLine) && end >= Number(endLine)) {
    if (!target || node.getWidth() < target.getWidth()) target = node;
  }
  ts.forEachChild(node, visit);
}
visit(sf);

if (!target) {
  console.error("no se encontró nodo que cubra el rango");
  process.exit(1);
}

const declared = new Set();
const used = new Map();

function isDeclarationName(node) {
  const p = node.parent;
  return (
    (ts.isVariableDeclaration(p) && p.name === node) ||
    (ts.isParameter(p) && p.name === node) ||
    (ts.isFunctionDeclaration(p) && p.name === node) ||
    (ts.isBindingElement(p) && p.name === node)
  );
}

function walk(node, inside) {
  if (ts.isIdentifier(node)) {
    const name = node.text;
    if (isDeclarationName(node) && inside) {
      declared.add(name);
      return;
    }
    // nombres de propiedad y atributos JSX no cuentan
    const p = node.parent;
    const isPropName =
      (p && (ts.isPropertyAccessExpression(p) || ts.isPropertyAssignment(p) || ts.isJsxAttribute(p))) &&
      (p.name === node);
    const isJsxTag = p && ts.isJsxOpeningElement?.(p) ? false : false;
    if (!isPropName && !isJsxTag) {
      if (!used.has(name)) used.set(name, node.getStart(sf));
    }
  }
  ts.forEachChild(node, (child) => walk(child, inside));
}

walk(target, true);

const free = [...used.keys()].filter((n) => !declared.has(n)).sort();
console.log(JSON.stringify({ start: lineOf(target.getStart(sf)), end: lineOf(target.getEnd()), free }, null, 2));
