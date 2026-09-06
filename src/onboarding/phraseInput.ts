// src/onboarding/phraseInput.ts
//
// Ported verbatim from mango-mobile's own src/onboarding/phraseInput.ts
// — pure string helpers backing the import-phrase autocomplete.

/** The word currently being typed — the trailing non-whitespace run of the text, or "" if the text ends in whitespace/is empty. */
export function currentWordBeingTyped(text: string): string {
  const match = text.match(/(\S+)$/);
  return match ? match[1] : '';
}

/** Replaces the word currently being typed with `word`, appending a trailing space so the next word starts clean. */
export function replaceCurrentWord(text: string, word: string): string {
  const current = currentWordBeingTyped(text);
  const base = current ? text.slice(0, text.length - current.length) : text;
  return `${base}${word} `;
}
