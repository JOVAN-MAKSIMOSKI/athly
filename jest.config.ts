import type { Config } from 'jest';

const config: Config = {
  rootDir: './server',
  preset: 'ts-jest/presets/default-esm',

  testEnvironment: 'node',

  extensionsToTreatAsEsm: ['.ts'],

  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true }],
  },

  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },

  testMatch: ['**/?(*.)+(spec|test).ts'],

  transformIgnorePatterns: [],
};

export default config;