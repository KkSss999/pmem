export const TRUST_LABEL_VALUES = [
  'system_trusted',
  'user_confirmed',
  'application_trusted',
  'agent_generated',
  'tool_observed',
  'imported_external',
  'untrusted_content',
] as const;

export type TrustLabel = (typeof TRUST_LABEL_VALUES)[number];

const TRUST_LABEL_SET = new Set<string>(TRUST_LABEL_VALUES);

export function isTrustLabel(value: unknown): value is TrustLabel {
  return typeof value === 'string' && TRUST_LABEL_SET.has(value.trim());
}

export function validTrustLabelsMessage(): string {
  return TRUST_LABEL_VALUES.join(', ');
}
