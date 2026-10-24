const CLUSTER_TAIL = /([ก-ะาำเ-ๆ])([ัิ-ฺ็-๎]+)$/;
const SUBMIT_OR_CLEAR = /[\r\n\x03\x04\x15]/;

/**
 * Follows what has been typed into a program that draws its own input line (an agent CLI), because the terminal
 * cannot tell from the screen where its caret is. It is only used to see that a Thai consonant with vowel or tone
 * marks sits before the caret; as soon as the text could have been changed some other way it stops answering
 * until the line is submitted or cleared.
 */
export class ThaiInputTracker {
  private text = '';
  private trusted = true;

  /** Everything the terminal sends to the program. */
  feed(data: string): void {
    if (data === '\x1b[I' || data === '\x1b[O') return; // focus reports
    if (SUBMIT_OR_CLEAR.test(data)) {
      this.text = '';
      this.trusted = true;
      return;
    }
    if (data === '\x7f') {
      this.text = this.dropCluster();
      return;
    }
    if (/[\x00-\x1f\x7f]/.test(data)) {
      this.trusted = false; // arrows, paste, Tab, Alt+Backspace and the like
      return;
    }
    this.text += data;
  }

  /**
   * What to send after the Backspace so that only the last mark goes: the program removes the whole cluster,
   * so the consonant and the marks before the last one are typed again. Undefined when Backspace should pass as it is.
   */
  backspace(): string | undefined {
    if (!this.trusted) return undefined;
    const m = CLUSTER_TAIL.exec(this.text);
    if (!m) return undefined;
    const keep = m[1]! + m[2]!.slice(0, -1);
    this.text = this.text.slice(0, m.index) + keep;
    return keep;
  }

  private dropCluster(): string {
    const m = CLUSTER_TAIL.exec(this.text);
    return m ? this.text.slice(0, m.index) : this.text.slice(0, -1);
  }
}
