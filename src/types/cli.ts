export type CliFormat = 'compact' | 'json' | 'paths' | 'pack';

export interface PmemSessionData {
  latest_task: string;
  latest_context_query?: string;
  latest_context_cards?: string[];
  latest_agent?: string;
  updated_at: string;
}
