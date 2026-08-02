export interface DomainPreset {
  domain: string;
  card_types: string[];
  type_dirs: Record<string, string>;
  foundational_types: string[];
  evidence_types: string[];
  default_type: string;
  creatable_types: string[];
  max_tokens?: Record<string, number>;
  max_sections?: Record<string, number>;
  warn_when_related_count_gt_by_type?: Record<string, number>;
}

export const DOMAIN_PRESETS: Record<string, DomainPreset> = {
  software: {
    domain: 'software',
    card_types: [
      'project', 'module', 'feature', 'task', 'decision',
      'trace', 'risk', 'assumption', 'resource', 'integration'
    ],
    type_dirs: {
      module: 'modules',
      feature: 'features',
      decision: 'decisions',
      task: 'tasks',
      trace: 'traces',
      risk: 'risks',
    },
    foundational_types: ['module'],
    evidence_types: ['decision', 'trace'],
    default_type: 'trace',
    creatable_types: ['decision', 'module', 'task', 'feature', 'risk', 'trace'],
    max_tokens: { module: 1200, feature: 1000, decision: 1000, task: 800, trace: 1000 },
    max_sections: { module: 8, feature: 8, decision: 6, task: 6 },
  },
  novel: {
    domain: 'novel',
    card_types: [
      'project', 'character', 'chapter', 'world', 'arc', 'decision', 'trace'
    ],
    type_dirs: {
      character: 'characters',
      chapter: 'chapters',
      world: 'world',
      arc: 'arc',
      decision: 'decisions',
      trace: 'traces',
    },
    foundational_types: ['character', 'chapter'],
    evidence_types: ['decision', 'trace'],
    default_type: 'trace',
    creatable_types: ['character', 'chapter', 'world', 'arc', 'decision', 'trace'],
    // Creative graphs are intentionally dense: characters commonly connect
    // to most of the cast, chapters, locations, and story decisions.
    warn_when_related_count_gt_by_type: { character: 30, chapter: 25, world: 25 },
    max_tokens: { decision: 1000, trace: 1000, character: 1200, chapter: 1500, world: 1500, arc: 1000 },
    max_sections: { decision: 6, character: 8, chapter: 8, world: 10 },
  },
  research: {
    domain: 'research',
    card_types: [
      'project', 'source', 'claim', 'note', 'experiment', 'decision', 'trace'
    ],
    type_dirs: {
      source: 'sources',
      claim: 'claims',
      note: 'notes',
      experiment: 'experiments',
      decision: 'decisions',
      trace: 'traces',
    },
    foundational_types: ['source', 'claim'],
    evidence_types: ['decision', 'trace'],
    default_type: 'trace',
    creatable_types: ['source', 'claim', 'note', 'experiment', 'decision', 'trace'],
    // A source/claim graph is expected to accumulate many legitimate links
    // as evidence is cross-checked and claims are refined.
    warn_when_related_count_gt_by_type: { source: 20, claim: 20 },
    max_tokens: { decision: 1000, trace: 1000, source: 1200, claim: 1000, note: 1000, experiment: 1200 },
    max_sections: { decision: 6, source: 8, claim: 6, experiment: 8 },
  },
};
