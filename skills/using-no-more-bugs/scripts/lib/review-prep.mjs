// `nmb review prep <feature>`: everything an independent reviewer needs, as plain text.
import fs from 'node:fs';
import path from 'node:path';
import { buildState } from './state.mjs';
import { resolveBase, changedFiles, existsAtBase, diffFromBase, isGitRepo } from './git.mjs';
import { matchAny } from './glob.mjs';
import { readText } from './util.mjs';

export function reviewPacket(root, slug) {
  const state = buildState(root);
  const feature = state.features.find((f) => f.slug === slug);
  if (!feature) throw new Error(`No feature "${slug}". Features: ${state.features.map((f) => f.slug).join(', ') || 'none'}`);
  const out = [];
  out.push(`# Review packet: ${slug}`, '');
  out.push('## Feature file', '', '```markdown', readText(path.join(root, feature.file), '').trim(), '```', '');

  out.push('## Scenarios and their tests', '');
  const files = new Set();
  for (const s of state.scenarios.filter((x) => x.feature === slug)) {
    out.push(`### ${s.id} · ${s.title} (${s.type}, ${s.priority}${s.kind !== 'behavior' ? `, ${s.kind}` : ''})`);
    if (!s.tests.length) out.push('- no test carries this ID yet');
    for (const t of s.tests) {
      out.push(`- ${t.status}: ${t.name}${t.file ? ` (${t.file})` : ''}`);
      if (t.file) files.add(t.file);
    }
    if (s.proof) out.push(`- first seen failing ${s.proof.at}: ${s.proof.message}`);
    else if (s.kind !== 'characterization') out.push('- never seen failing');
    out.push('');
  }
  out.push('## Test files to read', '');
  if (files.size) for (const f of files) out.push(`- ${f}`);
  else out.push('- The reports carry no file paths. Find the tests by searching for the scenario IDs.');
  out.push('');

  if (isGitRepo(root)) {
    const base = resolveBase(root, state.config.base);
    const changedTests = changedFiles(root, base).filter((f) => matchAny(f, state.config.tests || []) && existsAtBase(root, base, f) && fs.existsSync(path.join(root, f)));
    if (changedTests.length) {
      out.push('## Existing test files changed in this change', '', 'Check that no assertion was removed, loosened or mocked away to make code pass.', '');
      for (const f of changedTests) {
        files.add(f);
        out.push(`### ${f}`, '', '```diff', (diffFromBase(root, base, f) || '').trim().slice(0, 20000), '```', '');
      }
    }
  }
  out.push('## Record the verdict', '');
  out.push(`nmb review record ${slug} --verdict pass|fail --files ${[...files].join(',') || '<test files you read>'} --notes "<one-line summary>"`);
  return out.join('\n');
}
