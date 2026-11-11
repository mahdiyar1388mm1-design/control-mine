// Removes colorful emoji "stickers" from any text rendered on the site.
// Only text node values are changed (no DOM nodes are added or removed), so React keeps working normally.
// Add data-keep-emoji to an element to opt it out.

const HAS_EMOJI = /\p{Extended_Pictographic}/u;
const EMOJI_SEQ = /(?![\u00A9\u00AE\u2122])\p{Extended_Pictographic}[\uFE0E\uFE0F]?\u20E3?(?:\u200D\p{Extended_Pictographic}[\uFE0E\uFE0F]?)*/gu;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);

function cleanText(value) {
  return value.replace(EMOJI_SEQ, '').replace(/\uFE0F/g, '');
}

function fixTextNode(node) {
  const parent = node.parentNode;
  if (!parent || SKIP_TAGS.has(parent.nodeName)) return;
  if (parent.closest && parent.closest('[data-keep-emoji]')) return;
  const value = node.nodeValue;
  if (!value || !HAS_EMOJI.test(value)) return;
  const cleaned = cleanText(value);
  if (cleaned !== value) node.nodeValue = cleaned;
}

function scrub(root) {
  if (!root) return;
  if (root.nodeType === 3) {
    fixTextNode(root);
    return;
  }
  if (root.nodeType !== 1 && root.nodeType !== 9) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    fixTextNode(node);
    node = walker.nextNode();
  }
}

export function installEmojiScrubber() {
  if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return;
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'characterData') {
        fixTextNode(m.target);
      } else {
        m.addedNodes.forEach((n) => scrub(n));
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  const run = () => scrub(document.body);
  if (document.body) run();
  else document.addEventListener('DOMContentLoaded', run);
}
