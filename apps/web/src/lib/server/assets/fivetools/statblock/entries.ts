import { inlinesToPlainText, type Inline } from '$lib/utils/statBlock';
import { asArray, asString, isRecord } from './guards';
import { parseInlineTags } from './tags';

const MAX_ENTRY_DEPTH = 8;

type Paragraph = Inline[];

const text = (value: string): Inline => ({ kind: 'text', text: value });

const prefixFirst = (paragraphs: Paragraph[], prefix: Inline[]): Paragraph[] => {
  const [first, ...rest] = paragraphs;
  return first ? [[...prefix, ...first], ...rest] : [prefix];
};

const parseList = (items: unknown, warnings: string[], depth: number): Paragraph[] =>
  asArray(items).flatMap((item) => prefixFirst(parseBlock(item, warnings, depth + 1), [text('• ')]));

const parseNamed = (block: Record<string, unknown>, warnings: string[], depth: number): Paragraph[] => {
  const children = Array.isArray(block.entries) ? block.entries : [block.entry];
  const paragraphs = children.flatMap((child) => parseBlock(child, warnings, depth + 1));
  const name = asString(block.name);
  if (!name) return paragraphs;
  const label = inlinesToPlainText(parseInlineTags(name));
  return prefixFirst(paragraphs, [{ kind: 'em', text: `${label}. ` }]);
};

const parseBlock = (block: unknown, warnings: string[], depth: number): Paragraph[] => {
  if (depth > MAX_ENTRY_DEPTH) {
    warnings.push('Entry nesting too deep');
    return [];
  }
  if (typeof block === 'string') return [parseInlineTags(block)];
  if (!isRecord(block)) return [];
  if (block.type === 'list') return parseList(block.items, warnings, depth);
  if (block.type === 'table') {
    warnings.push(`Table skipped${asString(block.caption) ? `: ${asString(block.caption)}` : ''}`);
    return [];
  }
  if (block.entries === undefined && block.entry === undefined) return [];
  return parseNamed(block, warnings, depth);
};

export const parseEntries = (entries: unknown, warnings: string[]): Paragraph[] =>
  asArray(entries).flatMap((entry) => parseBlock(entry, warnings, 0));
