import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const frameDir = mkdtempSync(join(tmpdir(), 'pmem-readme-demo-'));

const screens = [
  {
    phase: 'RESTORE PROJECT CONTEXT',
    prompt: 'pmem context "implement auth"',
    lines: [],
    footer: 'Ask for only the context the task needs.',
  },
  {
    phase: 'TASK CONTEXT IS READY',
    prompt: 'pmem context "implement auth"',
    lines: [
      ['PROJECT', 'storefront-api', 'strong'],
      ['FOCUS', 'Authentication and request policy', 'normal'],
      ['DECISION', 'Tokens stay local and Git-managed', 'normal'],
      ['NEXT', 'Add integration tests', 'normal'],
    ],
    footer: 'The agent starts with state, decisions, and next work.',
  },
  {
    phase: 'CAPTURE A VERIFIED CHANGE',
    prompt: 'pmem capture --auto',
    lines: [
      ['OK', 'Memory updated from the working tree', 'success'],
      ['TRACE', 'Authentication guard captured with project evidence', 'normal'],
    ],
    footer: 'Keep the outcome without creating an opaque chat log.',
  },
  {
    phase: 'START A NEW AGENT SESSION',
    prompt: 'pmem recall --budget 2000',
    lines: [
      ['PROJECT', 'storefront-api', 'strong'],
      ['FOCUS', 'Authentication and request policy', 'normal'],
      ['LAST CHANGE', 'Added authentication guard', 'normal'],
      ['NEXT', 'Add integration tests', 'normal'],
    ],
    footer: 'No repository archaeology. The context is available again.',
  },
  {
    phase: 'CONTEXT RESTORED',
    prompt: 'pmem recall --budget 2000',
    lines: [
      ['PROJECT', 'storefront-api', 'strong'],
      ['FOCUS', 'Authentication and request policy', 'normal'],
      ['LAST CHANGE', 'Added authentication guard', 'normal'],
      ['NEXT', 'Add integration tests', 'normal'],
      ['READY', 'Context restored. Work continues.', 'success'],
    ],
    footer: 'Persistent project memory for the next agent action.',
  },
];

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function text(x, y, value, className) {
  return `<text x="${x}" y="${y}" class="${className}">${escapeXml(value)}</text>`;
}

function render(screen) {
  const output = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">',
    '<defs>',
    '<linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#08111f"/><stop offset="1" stop-color="#132746"/></linearGradient>',
    '<filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#020617" flood-opacity=".5"/></filter>',
    '<style>.mono{font-family:Menlo,monospace;fill:#cbd5e1;font-size:25px}.eyebrow{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:19px;font-weight:700;letter-spacing:3px;fill:#93c5fd}.headline{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:34px;font-weight:700;fill:#f8fafc}.prompt{font-family:Menlo,monospace;font-size:34px;font-weight:700;fill:#7dd3fc}.label{font-family:Menlo,monospace;font-size:23px;font-weight:700;fill:#a5b4fc}.value{font-family:Menlo,monospace;font-size:27px;fill:#cbd5e1}.valueStrong{font-family:Menlo,monospace;font-size:29px;font-weight:700;fill:#f8fafc}.valueSuccess{font-family:Menlo,monospace;font-size:28px;font-weight:700;fill:#86efac}.footer{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:23px;fill:#94a3b8}</style>',
    '</defs>',
    '<rect width="1440" height="900" fill="url(#bg)"/>',
    '<circle cx="70" cy="95" r="240" fill="#2563eb" opacity=".12"/><circle cx="1360" cy="830" r="300" fill="#7c3aed" opacity=".13"/>',
    '<rect x="55" y="54" width="1330" height="792" rx="26" fill="#0b1220" stroke="#334155" stroke-width="3" filter="url(#shadow)"/>',
    '<path d="M55 146h1330" stroke="#334155" stroke-width="3"/>',
    '<circle cx="96" cy="101" r="10" fill="#fb7185"/><circle cx="128" cy="101" r="10" fill="#fbbf24"/><circle cx="160" cy="101" r="10" fill="#4ade80"/>',
    text(205, 110, 'pmem / persistent project memory', 'mono'),
    text(105, 201, screen.phase, 'eyebrow'),
    text(105, 252, 'A 20-second cross-session terminal flow', 'headline'),
    '<rect x="101" y="296" width="1238" height="451" rx="18" fill="#111c30" stroke="#263d60" stroke-width="2"/>',
    text(146, 357, '$', 'prompt'),
    text(190, 357, screen.prompt, 'prompt'),
  ];

  screen.lines.forEach(([label, value, kind], index) => {
    const y = 434 + index * 58;
    const className = kind === 'strong' ? 'valueStrong' : kind === 'success' ? 'valueSuccess' : 'value';
    output.push(text(146, y, `${label}:`, 'label'));
    output.push(text(390, y, value, className));
  });

  output.push(text(105, 802, screen.footer, 'footer'));
  output.push('</svg>');
  return output.join('');
}

screens.forEach((screen, index) => {
  writeFileSync(join(frameDir, `${index}.svg`), render(screen));
});

process.stdout.write(frameDir);
