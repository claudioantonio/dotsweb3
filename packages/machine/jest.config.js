/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  // Tests run against protocol's source, so no prior build is needed.
  moduleNameMapper: {
    '^@dotsweb3/protocol$': '<rootDir>/../protocol/src/index.ts',
  },
};
