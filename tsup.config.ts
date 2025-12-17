import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'worker/index': 'src/worker/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  minify: false, // Keep readable for debugging
  target: 'node18',
  outDir: 'dist',
  // External modules - not bundled
  external: [
    'ws',
    'eventsource',
    '@grpc/grpc-js',
    '@grpc/proto-loader',
  ],
});
