/** Логика приложения (без нативных модулей): API-клиент, буфер геопозиции, расчёты отображения. */
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transform: { '^.+\\.tsx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript', tsx: true } } }] },
};
