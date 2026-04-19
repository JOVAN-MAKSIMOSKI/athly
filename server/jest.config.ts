import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest/presets/default-esm', // Correct for ESM
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    // This maps the required .js extension in your imports back to .ts for Jest
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true, // Required for ESM support
        tsconfig: 'tsconfig.json',
      },
    ],
  },
  // Ensure we don't ignore the transformation for local files
  transformIgnorePatterns: [
    'node_modules/(?!(some-pkg-to-transform)/)', 
  ],
};

export default config;