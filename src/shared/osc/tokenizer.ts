export interface OscToken {
  id: number;
  payload: string;
}

const ESC = '\x1b';
const BEL = '\x07';
const MAX_PAYLOAD = 64 * 1024;

/**
 * Streaming OSC extractor. It only observes the stream; callers forward the
 * original bytes untouched. Sequences split across chunks are handled.
 */
export class OscTokenizer {
  private state: 'ground' | 'esc' | 'osc' | 'oscEsc' = 'ground';
  private buf = '';

  push(chunk: string): OscToken[] {
    const out: OscToken[] = [];
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i]!;
      switch (this.state) {
        case 'ground':
          if (c === ESC) this.state = 'esc';
          break;
        case 'esc':
          if (c === ']') {
            this.state = 'osc';
            this.buf = '';
          } else if (c === ESC) {
            this.state = 'esc';
          } else {
            this.state = 'ground';
          }
          break;
        case 'osc':
          if (c === BEL) {
            this.finish(out);
          } else if (c === ESC) {
            this.state = 'oscEsc';
          } else {
            this.buf += c;
            if (this.buf.length > MAX_PAYLOAD) this.reset();
          }
          break;
        case 'oscEsc':
          if (c === '\\') {
            this.finish(out);
          } else {
            // aborted OSC; ESC starts a new sequence
            this.state = c === ']' ? 'osc' : 'ground';
            this.buf = '';
          }
          break;
      }
    }
    return out;
  }

  private finish(out: OscToken[]): void {
    const sep = this.buf.indexOf(';');
    const idText = sep === -1 ? this.buf : this.buf.slice(0, sep);
    if (/^\d+$/.test(idText)) {
      out.push({ id: Number(idText), payload: sep === -1 ? '' : this.buf.slice(sep + 1) });
    }
    this.reset();
  }

  private reset(): void {
    this.state = 'ground';
    this.buf = '';
  }
}
