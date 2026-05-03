export interface SmsMetrics {
  readonly encoding: "GSM-7" | "Unicode";
  readonly length: number;
  readonly segments: number;
  readonly segmentCap: number;
  readonly remaining: number;
}

const GSM_7_BASIC_CHARS = new Set([
  "@",
  "\u00a3",
  "$",
  "\u00a5",
  "\u00e8",
  "\u00e9",
  "\u00f9",
  "\u00ec",
  "\u00f2",
  "\u00c7",
  "\n",
  "\u00d8",
  "\u00f8",
  "\r",
  "\u00c5",
  "\u00e5",
  "\u0394",
  "_",
  "\u03a6",
  "\u0393",
  "\u039b",
  "\u03a9",
  "\u03a0",
  "\u03a8",
  "\u03a3",
  "\u0398",
  "\u039e",
  "\u00c6",
  "\u00e6",
  "\u00df",
  "\u00c9",
  " ",
  "!",
  "\"",
  "#",
  "\u00a4",
  "%",
  "&",
  "'",
  "(",
  ")",
  "*",
  "+",
  ",",
  "-",
  ".",
  "/",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  ":",
  ";",
  "<",
  "=",
  ">",
  "?",
  "\u00a1",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "\u00c4",
  "\u00d6",
  "\u00d1",
  "\u00dc",
  "\u00a7",
  "\u00bf",
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
  "\u00e4",
  "\u00f6",
  "\u00f1",
  "\u00fc",
  "\u00e0",
]);

const GSM_7_EXTENSION_CHARS = new Set([
  "\f",
  "^",
  "{",
  "}",
  "\\",
  "[",
  "~",
  "]",
  "|",
  "\u20ac",
]);

function gsmSeptetLength(text: string): number | null {
  let length = 0;

  for (const char of text) {
    if (GSM_7_BASIC_CHARS.has(char)) {
      length += 1;
      continue;
    }

    if (GSM_7_EXTENSION_CHARS.has(char)) {
      length += 2;
      continue;
    }

    return null;
  }

  return length;
}

function buildMetrics(input: {
  readonly encoding: SmsMetrics["encoding"];
  readonly length: number;
  readonly singleCap: number;
  readonly multiCap: number;
}): SmsMetrics {
  if (input.length === 0) {
    return {
      encoding: input.encoding,
      length: 0,
      segments: 0,
      segmentCap: input.singleCap,
      remaining: input.singleCap,
    };
  }

  if (input.length <= input.singleCap) {
    return {
      encoding: input.encoding,
      length: input.length,
      segments: 1,
      segmentCap: input.singleCap,
      remaining: input.singleCap - input.length,
    };
  }

  const segments = Math.ceil(input.length / input.multiCap);
  return {
    encoding: input.encoding,
    length: input.length,
    segments,
    segmentCap: input.multiCap,
    remaining: segments * input.multiCap - input.length,
  };
}

export function smsMetrics(text: string): SmsMetrics {
  const gsmLength = gsmSeptetLength(text);

  if (gsmLength !== null) {
    return buildMetrics({
      encoding: "GSM-7",
      length: gsmLength,
      singleCap: 160,
      multiCap: 153,
    });
  }

  return buildMetrics({
    encoding: "Unicode",
    length: Array.from(text).length,
    singleCap: 70,
    multiCap: 67,
  });
}
