/**
 * Matching for the homepage finder. Part numbers come first: a short search only matches the start
 * of a part number, so "P" finds P-100033 and PG-8280 instead of every instruction with a "p"
 * somewhere in its title. Longer searches also match the start of words in titles and other text.
 */

/** Lowercase letters and digits only, so "PG-8280", "pg 8280" and "pg8280" compare equal. */
export function compactSearchText(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function searchWords(value: string | null | undefined) {
  return (value ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** True when every word typed starts a word in the text: "pour ins" finds "Pouring Instructions". */
export function everyTermStartsAWord(text: string | null | undefined, query: string) {
  const words = searchWords(text);
  const terms = searchWords(query);
  return terms.length > 0 && terms.every((term) => words.some((word) => word.startsWith(term)));
}

/** How well a part number matches: 3 exact, 2 starts with the search, 1 contains it (3+ characters), 0 no. */
function partNumberRank(partNumber: string | null | undefined, query: string) {
  const compactQuery = compactSearchText(query);
  const part = compactSearchText(partNumber);
  if (!compactQuery || !part) return 0;
  if (part === compactQuery) return 3;
  if (part.startsWith(compactQuery)) return 2;
  if (compactQuery.length >= 3 && part.includes(compactQuery)) return 1;
  return 0;
}

export const SEARCH_RANK = { exactPart: 4, partStart: 3, partContains: 2, words: 1, none: 0 } as const;

export interface SearchableWorkItem {
  part_id: string | null | undefined;
  item_title: string | null | undefined;
  department_name: string | null | undefined;
}

/**
 * How well a part matches the search (see SEARCH_RANK); 0 means it does not match. Titles count from
 * two characters typed and department names from three, always by the start of their words.
 */
export function workItemSearchRank(item: SearchableWorkItem, query: string): number {
  const typed = query.trim().toLowerCase();
  if (!typed) return SEARCH_RANK.words;

  const partRank = partNumberRank(item.part_id, typed);
  if (partRank > 0) return partRank + 1;
  if (typed.length >= 2 && everyTermStartsAWord(item.item_title, typed)) return SEARCH_RANK.words;
  if (typed.length >= 3 && everyTermStartsAWord(item.department_name, typed)) return SEARCH_RANK.words;
  return SEARCH_RANK.none;
}

/**
 * A score for documents, formulas and suggestions, whose first field is their number or name.
 * One character only matches the start of that first field; longer searches match the start of words.
 */
export function scoreSearchFields(query: string, fields: Array<string | null | undefined>) {
  const typed = query.trim().toLowerCase();
  if (!typed) return 0;

  const identifierRank = partNumberRank(fields[0], typed);
  if (typed.length < 2) return identifierRank >= 2 ? 47 : 0;

  const haystack = fields.filter(Boolean).join(" ").toLowerCase();
  if (!haystack) return 0;

  const words = searchWords(haystack);
  let score = [0, 35, 47, 60][identifierRank];
  if (typed.length >= 3 && haystack.includes(typed)) score += 35;
  for (const term of searchWords(typed)) {
    if (words.some((word) => word.startsWith(term))) score += 12;
  }
  return score;
}
