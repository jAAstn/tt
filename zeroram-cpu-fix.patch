// apply-cpu-fixes.js — punktgenaue String-Replacements in background.js
// Run: node apply-cpu-fixes.js

const fs = require('fs');
const PATH = 'background.js';
let src = fs.readFileSync(PATH, 'utf8');

const edits = [
  {
    label: 'suspendTab: Signatur um skipReadyWait erweitern',
    find: 'async function suspendTab(tab, settings, revalidate = false, force = false) {',
    replace: 'async function suspendTab(tab, settings, revalidate = false, force = false, skipReadyWait = false) {',
  },
  {
    label: 'suspendTab: Schnellpfad für skipReadyWait einfügen',
    find: [
      '  const shouldDiscard = settings.useNativeDiscard && !tab.active;',
      '  if (shouldDiscard) {',
      '    beginSuspendedReadyWait(tab.id);',
      '  }',
    ].join('\n'),
    replace: [
      '  const shouldDiscard = settings.useNativeDiscard && !tab.active;',
      '  // Schnellpfad: User hat explizit suspendiert → nicht auf Favicon warten.',
      '  // Spart bis zu DISCARD_READY_TIMEOUT_MS (=10s) Renderer-Last pro Klick.',
      '  if (shouldDiscard && skipReadyWait) {',
      '    try {',
      '      await chrome.tabs.discard(tab.id);',
      '    } catch (_) {}',
      '    return;',
      '  }',
      '',
      '  if (shouldDiscard) {',
      '    beginSuspendedReadyWait(tab.id);',
      '  }',
    ].join('\n'),
  },
  {
    label: 'checkTabs: bereits discardete Tabs mit eigenem Placeholder ueberspringen',
    find: [
      '    if (tab.discarded) {',
      '      suspendTargets.push(tab);',
      '      continue; // Überspringt die restliche Zeitberechnung für diesen Tab',
      '    }',
    ].join('\n'),
    replace: [
      '    if (tab.discarded) {',
      '      // Wenn der Tab bereits unseren suspended-Placeholder hält, nichts tun —',
      '      // sonst Renderer-Wake-Up + Reload + Re-Discard pro Alarm-Tick.',
      '      if (tab.url && tab.url.startsWith(SUSPENDED_PREFIX)) continue;',
      '      suspendTargets.push(tab);',
      '      continue; // Überspringt die restliche Zeitberechnung für diesen Tab',
      '    }',
    ].join('\n'),
  },
  {
    label: 'msg.suspendTab: skipReadyWait durchreichen',
    find: [
      "      if (msg.command === 'suspendTab') {",
      '        const tab = await chrome.tabs.get(msg.tabId);',
      '        const settings = await getSettings();',
      '        await suspendTab(tab, settings);',
      '        respond({ done: true });',
    ].join('\n'),
    replace: [
      "      if (msg.command === 'suspendTab') {",
      '        const tab = await chrome.tabs.get(msg.tabId);',
      '        const settings = await getSettings();',
      '        await suspendTab(tab, settings, false, false, true); // skipReadyWait',
      '        respond({ done: true });',
    ].join('\n'),
  },
  {
    label: 'suspendOthersInAllWindows: skipReadyWait durchreichen',
    find: 'await Promise.allSettled(batch.map(tab => suspendTab(tab, settings, true, force)));',
    replace: 'await Promise.allSettled(batch.map(tab => suspendTab(tab, settings, true, force, true)));',
  },
  {
    label: 'suspendSelectedTabs (bulk): skipReadyWait durchreichen',
    find: 'await Promise.allSettled(batch.map(tab => suspendTab(tab, settings)));',
    replace: 'await Promise.allSettled(batch.map(tab => suspendTab(tab, settings, false, false, true)));',
  },
  {
    label: 'toggleTabSuspension: skipReadyWait durchreichen',
    find: '      await suspendTab(tab, settings);',
    replace: '      await suspendTab(tab, settings, false, false, true); // skipReadyWait',
  },
  {
    label: 'cmd "03-suspend-selected": skipReadyWait durchreichen',
    find: '            await suspendTab(t, settings);',
    replace: '            await suspendTab(t, settings, false, false, true); // skipReadyWait',
  },
];

let ok = 0;
for (const e of edits) {
  if (!src.includes(e.find)) {
    console.error(`\n[FAIL] ${e.label}`);
    console.error('  → Anker nicht gefunden. Ist background.js noch im Originalzustand?');
    process.exit(1);
  }
  if (src.split(e.find).length > 2) {
    console.error(`\n[FAIL] ${e.label}`);
    console.error('  → Anker kommt mehrfach vor, nicht eindeutig.');
    process.exit(1);
  }
  src = src.replace(e.find, e.replace);
  console.log(`[OK]   ${e.label}`);
  ok++;
}

fs.writeFileSync(PATH, src);
console.log(`\n${ok}/${edits.length} Edits angewendet.`);
console.log(`Pruefen mit:  git diff background.js`);