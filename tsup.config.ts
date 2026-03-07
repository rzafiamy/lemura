import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'adapters/index': 'src/adapters/index.ts',
    'context/index': 'src/context/index.ts',
    'tools/index': 'src/tools/index.ts',
    'skills/index': 'src/skills/index.ts',
    'rag/index': 'src/rag/index.ts',
    'logger/index': 'src/logger/index.ts',
    'types/index': 'src/types/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  treeshake: true,
  splitting: false,
  sourcemap: true,
});
