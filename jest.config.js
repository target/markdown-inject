module.exports = {
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/(*.)+(spec|test).+(ts|js)'],
  transform: {
    '.+\\.(ts|tsx)$': 'ts-jest',
  },
}
