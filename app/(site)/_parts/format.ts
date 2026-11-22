/** The first sentence-sized piece of a post body, cut at a word when the database cut it mid-text. */
export function excerptOf(text: string): string {
  const plain = text.replace(/\s+/g, " ").trim();
  if (plain.length < 200) return plain;
  const cut = plain.slice(0, 200);
  const space = cut.lastIndexOf(" ");
  return `${(space > 120 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
}

export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
