import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

function themeTokens(selector: string): Record<string, string> {
  const selectorStart = stylesheet.indexOf(selector);
  const openBrace = stylesheet.indexOf('{', selectorStart);
  const closeBrace = stylesheet.indexOf('}', openBrace);
  const declarations = selectorStart >= 0 && openBrace >= 0 && closeBrace > openBrace
    ? stylesheet.slice(openBrace + 1, closeBrace)
    : '';
  if (!declarations) throw new Error(`Theme token block not found: ${selector}`);

  const entries = [...declarations.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)].map((match) => {
    const name = match[1];
    const value = match[2];
    if (!name || !value) throw new Error(`Invalid theme token declaration: ${match[0]}`);
    return [name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()), value];
  });
  return Object.fromEntries(entries);
}

function luminance(hex: string): number {
  const channels = hex.match(/[\da-f]{2}/gi);
  if (!channels || channels.length !== 3) throw new Error(`Invalid six-digit hex color: ${hex}`);
  const [red, green, blue] = channels.map((channel) => parseInt(channel, 16) / 255);
  if (red === undefined || green === undefined || blue === undefined) throw new Error(`Invalid hex color: ${hex}`);
  const linear = (channel: number) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const palettes = [
  { name: 'light', selector: ':root', surface: '#ffffff', page: '#f5f6f8' },
  { name: 'system dark', selector: ":root:not([data-theme='light'])", surface: '#1b2029', page: '#12151c' },
  { name: 'dark', selector: ":root[data-theme='dark']", surface: '#1b2029', page: '#12151c' },
];

describe('theme contrast tokens', () => {
  it.each(palettes)('$name text and status tokens meet WCAG AA contrast', ({ selector, surface, page }) => {
    const tokens = themeTokens(selector);
    const textPairs = [
      [tokens.text, page],
      [tokens.text, surface],
      [tokens.muted, page],
      [tokens.muted, surface],
      [tokens.primary, page],
      [tokens.primary, surface],
      [tokens.primaryText, tokens.primary],
      [tokens.danger, surface],
      [tokens.dangerText, tokens.danger],
      [tokens.ok, surface],
      [tokens.warn, surface],
    ];

    for (const [foreground, background] of textPairs) {
      expect(contrast(foreground!, background!)).toBeGreaterThanOrEqual(4.5);
    }

    expect(contrast(tokens.border!, surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(tokens.border!, page)).toBeGreaterThanOrEqual(3);
  });

  it('keeps calendar task actions at least 24 CSS pixels high', () => {
    const taskRule = /\.cal-task\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? '';
    expect(taskRule).toMatch(/display:\s*block/);
    expect(taskRule).toMatch(/width:\s*100%/);
    expect(taskRule).toMatch(/min-height:\s*24px/);
  });
});
