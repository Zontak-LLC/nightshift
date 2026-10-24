/**
 * Following one growing log file. Work is in BYTES until a line is complete: a read can end in the middle of a
 * multibyte character (an emoji, "€"), so text is decoded only once its whole line has arrived.
 */
export type TailState = {
  /** Bytes of the file already read. */
  offset: number;
  /** The start of a line whose end has not been written yet. */
  partial: Buffer;
  /** Started in the middle of the file: everything up to the first line break is a cut line and is dropped. */
  skipping: boolean;
};

export const START: TailState = { offset: 0, partial: Buffer.alloc(0), skipping: false };

/** A line longer than this with no end in sight is dropped (the parser refuses such lines anyway). */
const MAX_PARTIAL = 4_000_000;

/** Adds the bytes read from `state.offset` and returns the complete lines they finished, and where each one ends. */
export function advance(state: TailState, chunk: Buffer): { state: TailState; lines: string[]; ends: number[] } {
  const offset = state.offset + chunk.length;
  let bytes = state.partial.length ? Buffer.concat([state.partial, chunk]) : chunk;
  let origin = state.offset - state.partial.length; // the file position of bytes[0]
  let skipping = state.skipping;
  if (skipping) {
    const end = bytes.indexOf(0x0a);
    if (end === -1) return { state: { offset, partial: Buffer.alloc(0), skipping }, lines: [], ends: [] };
    bytes = bytes.subarray(end + 1);
    origin += end + 1;
    skipping = false;
  }
  const cut = bytes.lastIndexOf(0x0a);
  if (cut === -1) {
    const partial = bytes.length > MAX_PARTIAL ? Buffer.alloc(0) : Buffer.from(bytes);
    return { state: { offset, partial, skipping: bytes.length > MAX_PARTIAL }, lines: [], ends: [] };
  }
  const body = bytes.subarray(0, cut);
  const lines: string[] = [];
  const ends: number[] = [];
  for (let from = 0; from <= body.length; ) {
    const found = body.indexOf(0x0a, from);
    const to = found === -1 ? body.length : found;
    const text = body.subarray(from, to).toString("utf8");
    if (text.trim()) {
      lines.push(text);
      ends.push(origin + to + 1);
    }
    from = to + 1;
  }
  return { state: { offset, partial: Buffer.from(bytes.subarray(cut + 1)), skipping }, lines, ends };
}

/** Bytes of the file that are fully read: the end of the last complete line (a half-written line is not counted). */
export const committed = (state: TailState): number => state.offset - state.partial.length;

/** Where to start a file seen for the first time: `from`, dropping the cut line when that is not the file's start. */
export function startAt(from: number): TailState {
  // One byte early: when that byte is the line break before `from`, only it is dropped and no whole line is lost.
  return from <= 0 ? START : { offset: from - 1, partial: Buffer.alloc(0), skipping: true };
}
