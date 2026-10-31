import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/memory/schema.ts',
  out: './migrations/memory',
});
