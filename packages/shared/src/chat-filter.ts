/**
 * Фильтр чата против увода сделок (раздел 12): телефоны, ссылки, почта, мессенджеры, IBAN.
 * Найденное заменяется маской, оригинал сервер хранит зашифрованным для разбора спора.
 */

export type ChatFilterHit = 'phone' | 'link' | 'email' | 'messenger' | 'iban';

export interface ChatFilterResult {
  text: string;
  hits: ChatFilterHit[];
}

const MASK = '•••';

const PATTERNS: ReadonlyArray<[ChatFilterHit, RegExp]> = [
  ['email', /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu],
  ['link', /\b(?:https?:\/\/|www\.)\S+|\b[\p{L}\p{N}-]+\.(?:com|net|org|ru|am|de|es|eu|io|me|ly|link|info|biz)(?:\/\S*)?/giu],
  ['iban', /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g],
  // 7+ цифр, допускаются пробелы, точки, дефисы, скобки и ведущий +
  ['phone', /(?:\+|00)?\d(?:[\s().-]?\d){6,}/g],
  [
    'messenger',
    /\b(?:whats\s?app|wa\.me|telegram|t\.me|viber|signal|imessage|wechat|skype|messenger)\b|(?:ватсап|вотсап|воцап|телеграм\w*|телега|вайбер|вибер|сигнал|скайп)/giu,
  ],
];

export function filterChatMessage(input: string): ChatFilterResult {
  const hits = new Set<ChatFilterHit>();
  let text = input;
  for (const [kind, pattern] of PATTERNS) {
    text = text.replace(pattern, () => {
      hits.add(kind);
      return MASK;
    });
  }
  return { text, hits: [...hits] };
}
