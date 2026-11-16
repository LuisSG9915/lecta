import { describe, expect, it } from "vitest";
import {
  decodeSubtitleBytes,
  detectSubtitleFormat,
  normalizeSubtitleText,
} from "./subtitle-parse";
import { subtitleToForms } from "./screen-guide";

const SRT = `1
00:00:01,000 --> 00:00:03,000
The <i>mysterious</i> lighthouse stood silent.

2
00:00:04,000 --> 00:00:06,000
- Wanderers crossed the frozen harbour.
`;

const VTT = `WEBVTT

NOTE esto es un comentario con palabras extrañas

STYLE
::cue { color: red }

intro
00:00:01.000 --> 00:00:03.000
The mysterious lighthouse stood silent.

00:00:04.000 --> 00:00:06.000
Wanderers crossed the frozen harbour.
`;

const ASS = `[Script Info]
Title: demo

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\i1}The mysterious lighthouse{\\i0} stood silent.
Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,0,,Wanderers crossed\\Nthe frozen harbour, finally.
Comment: 0,0:00:07.00,0:00:08.00,Default,,0,0,0,,not dialogue
`;

const formsOf = (text: string) => subtitleToForms(text, "en").forms;

describe("detectSubtitleFormat", () => {
  it("por extensión y por cabecera", () => {
    expect(detectSubtitleFormat("a.srt", SRT)).toBe("srt");
    expect(detectSubtitleFormat("a.vtt", VTT)).toBe("vtt");
    expect(detectSubtitleFormat("a.ass", ASS)).toBe("ass");
    expect(detectSubtitleFormat("sin-extension", VTT)).toBe("vtt");
    expect(detectSubtitleFormat("sin-extension", ASS)).toBe("ass");
  });
});

describe("normalizeSubtitleText", () => {
  it("srt, vtt y ass dan las mismas formas de diálogo", () => {
    const srt = formsOf(normalizeSubtitleText("a.srt", SRT).text);
    const vtt = formsOf(normalizeSubtitleText("a.vtt", VTT).text);
    const ass = formsOf(normalizeSubtitleText("a.ass", ASS).text);
    for (const forms of [srt, vtt, ass]) {
      expect(forms).toEqual(
        expect.arrayContaining(["mysterious", "lighthouse", "wanderers", "harbour", "frozen"]),
      );
    }
  });

  it("vtt: los bloques NOTE y STYLE no aportan palabras", () => {
    const forms = formsOf(normalizeSubtitleText("a.vtt", VTT).text);
    expect(forms).not.toContain("extrañas");
    expect(forms).not.toContain("color");
  });

  it("ass: solo las líneas Dialogue, sin etiquetas ni comentarios", () => {
    const forms = formsOf(normalizeSubtitleText("a.ass", ASS).text);
    expect(forms).not.toContain("dialogue");
    expect(forms).not.toContain("comment");
    expect(forms).toContain("finally");
  });
});

describe("decodeSubtitleBytes", () => {
  it("utf-8 normal", () => {
    expect(decodeSubtitleBytes(new TextEncoder().encode("canción"))).toBe("canción");
  });

  it("cae a windows-1252 cuando utf-8 deja una estela de U+FFFD", () => {
    // «ñ» = 0xF1 en windows-1252, inválido solo en utf-8.
    const bytes = new Uint8Array(Array.from({ length: 8 }, () => 0xf1));
    expect(decodeSubtitleBytes(bytes)).toBe("ññññññññ");
  });
});
