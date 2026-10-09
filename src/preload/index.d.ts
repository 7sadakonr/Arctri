import type { ArctriApi } from './index';

declare global {
  interface Window {
    arctri: ArctriApi;
  }
}
export {};
