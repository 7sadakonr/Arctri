/** Something the user put in an agent's message: a file or an image. `ref` is what was typed into the conversation. */
export interface Attachment {
  ref: string;
  name: string;
  image: boolean;
  /** Small data URL of an image, for the preview in the agent bar. */
  thumb?: string;
  /** Where the file is on this machine; what the preview opens. Missing for an image that only lives on the clipboard. */
  src?: string;
}
